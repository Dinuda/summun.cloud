import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { metaLeadgenPlugin } from "../external-plugins/meta-leadgen.js";

describe("meta leadgen plugin extraction", () => {
  it("extracts events from standard page leadgen payload", async () => {
    const events = await metaLeadgenPlugin.extractEvents(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_leadgen",
        sourceConfig: {},
      },
      {
        headers: {},
        payload: {
          object: "page",
          entry: [
            {
              changes: [
                {
                  field: "leadgen",
                  value: {
                    leadgen_id: "123",
                    page_id: "p1",
                  },
                },
              ],
            },
          ],
        },
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.providerEventId).toBe("123");
  });

  it("extracts events from dashboard sample payload", async () => {
    const events = await metaLeadgenPlugin.extractEvents(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_leadgen",
        sourceConfig: {},
      },
      {
        headers: {},
        payload: {
          sample: {
            field: "leadgen",
            value: {
              leadgen_id: "sample-123",
              page_id: "p1",
            },
          },
        },
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.providerEventId).toBe("sample-123");
  });

  it("surfaces Graph API error details during enrichment", async () => {
    await expect(
      metaLeadgenPlugin.enrichEvent!(
        {
          id: "source-1",
          companyId: "company-1",
          pluginId: "meta_leadgen",
          sourceConfig: {},
        },
        {
          providerEventId: "lead-1",
          idempotencyHint: "lead-1",
          eventType: "leadgen",
          payload: { leadgen_id: "lead-1" },
        },
        {
          resolveSecretRef: async () => "page-token",
          fetchJson: async () => ({
            status: 400,
            body: {
              error: {
                message: "Unsupported get request",
                code: 100,
                error_subcode: 33,
              },
            },
          }),
        },
      ),
    ).rejects.toThrow(
      "Meta Graph API error (400): Unsupported get request (code 100, subcode 33) [leadgen_id=lead-1]",
    );
  });

  it("accepts webhook challenge with configured verify token secret ref", async () => {
    const result = await metaLeadgenPlugin.verifyChallenge!(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_leadgen",
        sourceConfig: {
          verifyTokenSecret: {
            type: "secret_ref",
            secretId: "00000000-0000-0000-0000-000000000001",
            version: "latest",
          },
        },
      },
      {
        mode: "subscribe",
        token: "verify-token",
        challenge: "challenge-123",
      },
      {
        resolveSecretRef: async () => "verify-token",
        fetchJson: async () => ({ status: 200, body: {} }),
      },
    );

    expect(result).toEqual({
      ok: true,
      challenge: "challenge-123",
    });
  });

  it("accepts webhook delivery with valid app secret signature", async () => {
    const payload = { object: "page", entry: [] as unknown[] };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const secret = "app-secret";
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

    const result = await metaLeadgenPlugin.verifyDelivery(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_leadgen",
        sourceConfig: {
          appSecret: {
            type: "secret_ref",
            secretId: "00000000-0000-0000-0000-000000000002",
            version: "latest",
          },
        },
      },
      {
        headers: {
          "x-hub-signature-256": `sha256=${signature}`,
        },
        rawBody,
        payload,
      },
      {
        resolveSecretRef: async () => secret,
        fetchJson: async () => ({ status: 200, body: {} }),
      },
    );

    expect(result).toEqual({ ok: true, reason: "signature_invalid" });
  });
});
