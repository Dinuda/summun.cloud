import type { ExternalPluginMetadata, ExternalSecretRef } from "@paperclipai/shared";

export interface ExtractedExternalEvent {
  providerEventId: string | null;
  idempotencyHint: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface EnrichedLeadRecord {
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  adId: string | null;
  adgroupId: string | null;
  campaignId: string | null;
  createdTime: Date | null;
  status: "received" | "enriched" | "failed";
  error: string | null;
  fieldData: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface EnrichedExternalEventResult {
  ruleContext: Record<string, unknown>;
  leadRecord?: EnrichedLeadRecord | null;
  output?: Record<string, unknown> | null;
}

export interface ExternalPluginSource {
  id: string;
  companyId: string;
  pluginId: string;
  sourceConfig: Record<string, unknown>;
}

export interface WebhookVerifyInput {
  mode: string | null;
  token: string | null;
  challenge: string | null;
}

export interface VerifyDeliveryInput {
  headers: Record<string, string>;
  rawBody: Buffer;
  payload: Record<string, unknown>;
}

export interface ExternalIngestionPluginContext {
  resolveSecretRef: (companyId: string, secretRef: ExternalSecretRef | null | undefined) => Promise<string | null>;
  fetchJson: (url: string) => Promise<{ status: number; body: Record<string, unknown> }>;
}

export interface ExternalIngestionPlugin {
  metadata: ExternalPluginMetadata;
  validateSourceConfig: (input: unknown) => Record<string, unknown>;
  verifyChallenge?: (
    source: ExternalPluginSource,
    input: WebhookVerifyInput,
    ctx: ExternalIngestionPluginContext,
  ) => Promise<{ ok: boolean; challenge: string | null }>;
  verifyDelivery: (
    source: ExternalPluginSource,
    input: VerifyDeliveryInput,
    ctx: ExternalIngestionPluginContext,
  ) => Promise<{ ok: boolean; reason?: string | null }>;
  extractEvents: (
    source: ExternalPluginSource,
    input: { payload: Record<string, unknown>; headers: Record<string, string> },
  ) => Promise<ExtractedExternalEvent[]>;
  enrichEvent?: (
    source: ExternalPluginSource,
    event: ExtractedExternalEvent,
    ctx: ExternalIngestionPluginContext,
  ) => Promise<EnrichedExternalEventResult>;
  buildRuleContext: (
    source: ExternalPluginSource,
    event: ExtractedExternalEvent,
    enriched: EnrichedExternalEventResult | null,
  ) => Record<string, unknown>;
  opsProjection?: (
    input: {
      sourceIds: string[];
      from: Date;
      to: Date;
    },
  ) => Promise<Record<string, unknown>>;
}
