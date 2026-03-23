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

  it("preserves workflow with fallback lead details when Graph enrichment fails", async () => {
    const result = await metaLeadgenPlugin.enrichEvent!(
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
    );

    expect(result.leadRecord?.leadgenId).toBe("lead-1");
    expect(result.leadRecord?.status).toBe("failed");
    expect(result.leadRecord?.error).toContain("Unsupported get request");
    expect(result.ruleContext.metrics.leadCount).toBe(1);
  });

  it("parses numeric created_time from webhook payload when enrichment fails", async () => {
    const createdTime = 1774284695;
    const result = await metaLeadgenPlugin.enrichEvent!(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_leadgen",
        sourceConfig: {},
      },
      {
        providerEventId: "lead-2",
        idempotencyHint: "lead-2",
        eventType: "leadgen",
        payload: { leadgen_id: "lead-2", created_time: createdTime },
      },
      {
        resolveSecretRef: async () => "page-token",
        fetchJson: async () => ({
          status: 400,
          body: { error: { message: "Unsupported get request", code: 100, error_subcode: 33 } },
        }),
      },
    );

    expect(result.leadRecord?.createdTime?.toISOString()).toBe("2026-03-23T16:51:35.000Z");
  });

  it("uses webhook field_data as fallback when Graph enrichment fails", async () => {
    const result = await metaLeadgenPlugin.enrichEvent!(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_leadgen",
        sourceConfig: {},
      },
      {
        providerEventId: "lead-3",
        idempotencyHint: "lead-3",
        eventType: "leadgen",
        payload: {
          leadgen_id: "lead-3",
          field_data: [
            { name: "email", values: ["ydinuda@gmail.com"] },
            { name: "phone_number", values: ["+94767819556"] },
          ],
        },
      },
      {
        resolveSecretRef: async () => "page-token",
        fetchJson: async () => ({
          status: 400,
          body: { error: { message: "Unsupported get request", code: 100, error_subcode: 33 } },
        }),
      },
    );

    expect(result.ruleContext.metrics.hasEmail).toBe(1);
    expect(result.ruleContext.metrics.hasPhone).toBe(1);
    expect(result.leadRecord?.fieldData).toMatchObject({
      email: "ydinuda@gmail.com",
      phone_number: "+94767819556",
    });
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
