import { z } from "zod";
import type { ExternalIngestionPlugin, ExternalPluginSource } from "./types.js";

const secretRefSchema = z.object({
  type: z.literal("secret_ref"),
  secretId: z.string().uuid(),
  version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
});

const waSenderWhatsAppSourceConfigSchema = z.object({
  apiKeySecret: secretRefSchema,
  sessionId: z.string().min(1).optional().nullable(),
  webhookSecret: z.string().min(1).optional().nullable(),
  baseUrl: z.string().url().optional().default("https://wasenderapi.com"),
});

function readSourceConfig(source: ExternalPluginSource) {
  return waSenderWhatsAppSourceConfigSchema.parse(source.sourceConfig ?? {});
}

export const metaWhatsAppBusinessPlugin: ExternalIngestionPlugin = {
  metadata: {
    pluginId: "meta_whatsapp_business",
    name: "WhatsApp (WaSender)",
    version: "2.0.0",
    description: "WaSender-backed WhatsApp source with simple API key setup.",
    capabilities: {
      webhookChallenge: false,
      signatureVerification: true,
      enrichment: false,
    },
    sourceConfigFields: [
      {
        key: "apiKeySecret",
        label: "WaSender API Key Secret",
        type: "secret_ref",
        required: true,
        description: "Secret reference to the WaSender API key for this session.",
      },
      {
        key: "sessionId",
        label: "WaSender Session ID",
        type: "string",
        required: false,
        description: "Optional WaSender session identifier used by outbound APIs.",
      },
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        type: "string",
        required: false,
        description: "Optional shared secret configured in WaSender webhook settings.",
      },
      {
        key: "baseUrl",
        label: "WaSender Base URL",
        type: "string",
        required: false,
        defaultValue: "https://wasenderapi.com",
        description: "Base URL for WaSender API calls.",
      },
    ],
    companyConfigFields: [],
  },

  validateSourceConfig: (input: unknown) => waSenderWhatsAppSourceConfigSchema.parse(input),

  verifyDelivery: async (source, _input, _ctx) => {
    const config = readSourceConfig(source);
    const expectedSecret = config.webhookSecret?.trim() ?? "";
    if (expectedSecret.length > 0) {
      const signature = _input.headers["x-webhook-signature"]?.trim() ?? "";
      if (signature !== expectedSecret) {
        return { ok: false, reason: "invalid_webhook_signature" };
      }
    }
    return { ok: true };
  },

  extractEvents: async () => {
    // v1 setup scope only: no inbound message processing yet.
    return [];
  },

  buildRuleContext: () => {
    return {
      metrics: {
        eventCount: 0,
      },
    };
  },
};
