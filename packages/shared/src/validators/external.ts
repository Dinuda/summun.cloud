import { z } from "zod";
import {
  EXTERNAL_PLUGIN_IDS,
  EXTERNAL_SOURCE_PROVIDERS,
  EXTERNAL_SOURCE_STATUSES,
  EXTERNAL_WORKFLOW_ENGINES,
  ISSUE_PRIORITIES,
} from "../constants.js";

export const externalSecretRefSchema = z.object({
  type: z.literal("secret_ref"),
  secretId: z.string().uuid(),
  version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
});

export type ExternalSecretRefInput = z.infer<typeof externalSecretRefSchema>;

export const externalRuleSchema = z.object({
  id: z.string().min(1).optional().nullable(),
  metric: z.string().min(1),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]),
  threshold: z.number(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(ISSUE_PRIORITIES).optional().default("medium"),
});

export type ExternalRuleInput = z.infer<typeof externalRuleSchema>;

export const externalRulesConfigSchema = z
  .object({
    mode: z.enum(["any", "all"]).optional().default("any"),
    rules: z.array(externalRuleSchema).optional().default([]),
  })
  .strict();

export type ExternalRulesConfigInput = z.infer<typeof externalRulesConfigSchema>;

export const externalVerificationConfigSchema = z
  .object({
    verifyTokenSecret: externalSecretRefSchema.optional().nullable(),
    appSecret: externalSecretRefSchema.optional().nullable(),
    challengeParam: z.string().min(1).optional().nullable(),
  })
  .strict();

export type ExternalVerificationConfigInput = z.infer<typeof externalVerificationConfigSchema>;

export const createExternalEventSourceSchema = z.object({
  pluginId: z.string().min(1).optional().default("meta_leadgen"),
  pluginVersion: z.string().min(1).max(64).optional().nullable(),
  sourceConfig: z.record(z.unknown()).optional().default({}),
  // Deprecated legacy field retained for backward compatibility.
  provider: z.enum(EXTERNAL_SOURCE_PROVIDERS).optional(),
  name: z.string().min(1).max(120),
  status: z.enum(EXTERNAL_SOURCE_STATUSES).optional().default("active"),
  reviewerAgentId: z.string().uuid().optional().nullable(),
  rulesConfig: externalRulesConfigSchema.optional().default({
    mode: "any",
    rules: [],
  }),
  llmReviewTemplate: z.string().max(16_000).optional().nullable(),
  verificationConfig: externalVerificationConfigSchema.optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CreateExternalEventSource = z.infer<typeof createExternalEventSourceSchema>;

export const updateExternalEventSourceSchema = createExternalEventSourceSchema.partial();

export type UpdateExternalEventSource = z.infer<typeof updateExternalEventSourceSchema>;

export const listExternalEventSourcesQuerySchema = z.object({
  pluginId: z.string().min(1).optional(),
  provider: z.enum(EXTERNAL_SOURCE_PROVIDERS).optional(),
  status: z.enum(EXTERNAL_SOURCE_STATUSES).optional(),
});

export type ListExternalEventSourcesQuery = z.infer<typeof listExternalEventSourcesQuerySchema>;

export const externalOpsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type ExternalOpsQuery = z.infer<typeof externalOpsQuerySchema>;

export const metaAdsWebhookVerifyQuerySchema = z.object({
  "hub.mode": z.string().optional(),
  "hub.challenge": z.string().optional(),
  "hub.verify_token": z.string().optional(),
});

export type MetaAdsWebhookVerifyQuery = z.infer<typeof metaAdsWebhookVerifyQuerySchema>;
export const externalWebhookVerifyQuerySchema = metaAdsWebhookVerifyQuerySchema;
export type ExternalWebhookVerifyQuery = MetaAdsWebhookVerifyQuery;

export const externalPluginIdParamSchema = z.object({
  pluginId: z.string().min(1),
});
export type ExternalPluginIdParam = z.infer<typeof externalPluginIdParamSchema>;

export const externalPluginIdEnumSchema = z.enum(EXTERNAL_PLUGIN_IDS);
export type ExternalPluginIdInput = z.infer<typeof externalPluginIdEnumSchema>;

export const externalWorkflowEngineSchema = z.enum(EXTERNAL_WORKFLOW_ENGINES);
export type ExternalWorkflowEngineInput = z.infer<typeof externalWorkflowEngineSchema>;

export const companyExternalPluginConfigUpsertSchema = z.object({
  config: z.record(z.unknown()),
});
export type CompanyExternalPluginConfigUpsertInput = z.infer<typeof companyExternalPluginConfigUpsertSchema>;

export const metaLeadgenCompanyPluginConfigSchema = z
  .object({
    metaAppId: z.string().min(1),
    appSecret: externalSecretRefSchema,
    verifyTokenSecret: externalSecretRefSchema,
    graphApiVersion: z.string().min(1).max(32).optional().default("v22.0"),
  })
  .strict();
export type MetaLeadgenCompanyPluginConfigInput = z.infer<typeof metaLeadgenCompanyPluginConfigSchema>;

export const requestActionItemApprovalSchema = z.object({
  summary: z.string().max(8_000).optional().nullable(),
  recommendation: z.string().max(8_000).optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
});

export type RequestActionItemApproval = z.infer<typeof requestActionItemApprovalSchema>;

export const reprocessExternalEventSchema = z
  .object({
    eventId: z.string().uuid().optional(),
    sourceId: z.string().uuid().optional(),
    leadgenId: z.string().min(1).optional(),
    force: z.boolean().optional().default(true),
  })
  .refine((value) => Boolean(value.eventId || value.leadgenId), {
    message: "Provide eventId or leadgenId to reprocess",
  });

export type ReprocessExternalEventInput = z.infer<typeof reprocessExternalEventSchema>;

export const metaConnectPagesSchema = z.object({
  userAccessTokenSecretId: z.string().uuid(),
});
export type MetaConnectPagesInput = z.infer<typeof metaConnectPagesSchema>;

export const metaConnectFormsSchema = z.object({
  userAccessTokenSecretId: z.string().uuid(),
  pageId: z.string().min(1),
});
export type MetaConnectFormsInput = z.infer<typeof metaConnectFormsSchema>;

export const metaConnectSourceSchema = z.object({
  sourceId: z.string().uuid().optional(),
  sourceName: z.string().min(1).max(120),
  reviewerAgentId: z.string().uuid().optional().nullable(),
  rulesConfig: externalRulesConfigSchema.optional().default({
    mode: "any",
    rules: [],
  }),
  llmReviewTemplate: z.string().max(16_000).optional().nullable(),
  userAccessTokenSecretId: z.string().uuid(),
  pageId: z.string().min(1),
  formId: z.string().min(1).optional().nullable(),
  graphApiVersion: z.string().min(1).max(32).optional().default("v22.0"),
});
export type MetaConnectSourceInput = z.infer<typeof metaConnectSourceSchema>;

export const metaOauthStartQuerySchema = z.object({
  returnTo: z.string().max(512).optional(),
});
export type MetaOauthStartQueryInput = z.infer<typeof metaOauthStartQuerySchema>;

export const metaOauthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});
export type MetaOauthCallbackQueryInput = z.infer<typeof metaOauthCallbackQuerySchema>;

export const whatsappConnectSourceSchema = z.object({
  sourceId: z.string().uuid().optional(),
  sourceName: z.string().min(1).max(120),
  reviewerAgentId: z.string().uuid().optional().nullable(),
  rulesConfig: externalRulesConfigSchema.optional().default({
    mode: "any",
    rules: [],
  }),
  llmReviewTemplate: z.string().max(16_000).optional().nullable(),
  apiKeySecretId: z.string().uuid().optional(),
  apiKey: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional().nullable(),
  webhookSecret: z.string().min(1).optional().nullable(),
  baseUrl: z.string().url().optional().default("https://wasenderapi.com"),
});
export type WhatsAppConnectSourceInput = z.infer<typeof whatsappConnectSourceSchema>;
