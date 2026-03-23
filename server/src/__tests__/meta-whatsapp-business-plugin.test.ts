import { describe, expect, it } from "vitest";
import { metaWhatsAppBusinessPlugin } from "../external-plugins/meta-whatsapp-business.js";

describe("wasender whatsapp plugin", () => {
  it("validates source config for wasender", () => {
    const parsed = metaWhatsAppBusinessPlugin.validateSourceConfig({
      apiKeySecret: {
        type: "secret_ref",
        secretId: "00000000-0000-0000-0000-000000000001",
        version: "latest",
      },
      sessionId: "session-1",
      baseUrl: "https://wasenderapi.com",
    });

    expect(parsed).toMatchObject({
      sessionId: "session-1",
      baseUrl: "https://wasenderapi.com",
    });
  });

  it("accepts webhook deliveries without challenge/signature requirements", async () => {
    const payload = { event: "message" };
    const rawBody = Buffer.from(JSON.stringify(payload));

    const result = await metaWhatsAppBusinessPlugin.verifyDelivery(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_whatsapp_business",
        sourceConfig: {
          apiKeySecret: {
            type: "secret_ref",
            secretId: "00000000-0000-0000-0000-000000000001",
            version: "latest",
          },
        },
      },
      {
        headers: {},
        rawBody,
        payload,
      },
      {
        resolveSecretRef: async () => "api-key",
        fetchJson: async () => ({ status: 200, body: {} }),
      },
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects delivery when webhook secret is configured and signature mismatches", async () => {
    const payload = { event: "messages.upsert" };
    const rawBody = Buffer.from(JSON.stringify(payload));

    const result = await metaWhatsAppBusinessPlugin.verifyDelivery(
      {
        id: "source-1",
        companyId: "company-1",
        pluginId: "meta_whatsapp_business",
        sourceConfig: {
          apiKeySecret: {
            type: "secret_ref",
            secretId: "00000000-0000-0000-0000-000000000001",
            version: "latest",
          },
          webhookSecret: "expected-secret",
        },
      },
      {
        headers: {
          "x-webhook-signature": "wrong-secret",
        },
        rawBody,
        payload,
      },
      {
        resolveSecretRef: async () => "api-key",
        fetchJson: async () => ({ status: 200, body: {} }),
      },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_webhook_signature" });
  });
});
