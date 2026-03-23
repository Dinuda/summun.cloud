import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ExternalSecretRef } from "@paperclipai/shared";
import type {
  EnrichedExternalEventResult,
  ExternalIngestionPlugin,
  ExternalPluginSource,
  ExtractedExternalEvent,
} from "./types.js";

const secretRefSchema = z.object({
  type: z.literal("secret_ref"),
  secretId: z.string().uuid(),
  version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
});

const metaLeadgenSourceConfigSchema = z.object({
  verifyTokenSecret: secretRefSchema.optional().nullable(),
  appSecret: secretRefSchema.optional().nullable(),
  pageAccessTokenSecret: secretRefSchema.optional().nullable(),
  graphApiVersion: z.string().min(1).max(32).optional().default("v22.0"),
});

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeLeadFieldData(input: unknown) {
  const output: Record<string, unknown> = {};
  if (!Array.isArray(input)) return output;
  for (const item of input) {
    const record = asRecord(item);
    if (!record) continue;
    const name = typeof record.name === "string" ? record.name : null;
    if (!name) continue;
    const values = Array.isArray(record.values) ? record.values : [];
    output[name] = values.length <= 1 ? values[0] ?? null : values;
  }
  return output;
}

function safeCompareString(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readSourceConfig(source: ExternalPluginSource) {
  return metaLeadgenSourceConfigSchema.parse(source.sourceConfig ?? {});
}

function parseCreatedTime(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string" || value.length === 0) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 10_000_000_000 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseGraphErrorMessage(body: Record<string, unknown>): string {
  const error = asRecord(body.error);
  if (!error) return "Meta Graph API error";
  const message = typeof error.message === "string" && error.message.length > 0 ? error.message : null;
  const code =
    typeof error.code === "number" || typeof error.code === "string" ? String(error.code) : null;
  const subcode =
    typeof error.error_subcode === "number" || typeof error.error_subcode === "string"
      ? String(error.error_subcode)
      : null;
  const details = [code ? `code ${code}` : null, subcode ? `subcode ${subcode}` : null]
    .filter((part): part is string => part !== null)
    .join(", ");
  if (!details) return message ?? "Meta Graph API error";
  return `${message ?? "Meta Graph API error"} (${details})`;
}

function toExtractedEvent(value: Record<string, unknown>): ExtractedExternalEvent | null {
  const leadgenId = typeof value.leadgen_id === "string" ? value.leadgen_id : null;
  if (!leadgenId) return null;

  return {
    providerEventId: leadgenId,
    idempotencyHint: leadgenId,
    eventType: "leadgen",
    payload: value,
  };
}

async function fetchLeadDetails(args: {
  source: ExternalPluginSource;
  event: ExtractedExternalEvent;
  graphApiVersion: string;
  pageAccessTokenSecret: ExternalSecretRef | null | undefined;
  resolveSecretRef: (companyId: string, secretRef: ExternalSecretRef | null | undefined) => Promise<string | null>;
  fetchJson: (url: string) => Promise<{ status: number; body: Record<string, unknown> }>;
}) {
  const accessToken = await args.resolveSecretRef(args.source.companyId, args.pageAccessTokenSecret);
  if (!accessToken) {
    throw new Error("Meta page access token secret is missing for this source");
  }

  const leadgenId = typeof args.event.payload.leadgen_id === "string" ? args.event.payload.leadgen_id : null;
  if (!leadgenId) {
    throw new Error("leadgen_id is missing from Meta webhook payload");
  }

  const baseUrl = (process.env.SUMMUN_META_GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/+$/, "");
  const version = args.graphApiVersion.replace(/^\/+/, "");
  const url = `${baseUrl}/${version}/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(accessToken)}`;
  const response = await args.fetchJson(url);
  if (response.status < 200 || response.status >= 300) {
    const errorMessage = parseGraphErrorMessage(response.body);
    throw new Error(`Meta Graph API error (${response.status}): ${errorMessage} [leadgen_id=${leadgenId}]`);
  }
  return response.body;
}

export const metaLeadgenPlugin: ExternalIngestionPlugin = {
  metadata: {
    pluginId: "meta_leadgen",
    name: "Meta Leadgen",
    version: "1.0.0",
    description: "Meta Page leadgen webhook ingestion with Graph API lead enrichment.",
    capabilities: {
      webhookChallenge: true,
      signatureVerification: true,
      enrichment: true,
    },
    sourceConfigFields: [
      {
        key: "graphApiVersion",
        label: "Graph API Version",
        type: "string",
        required: false,
        defaultValue: "v22.0",
        description: "Graph API version for lead enrichment requests.",
      },
    ],
    companyConfigFields: [
      {
        key: "metaAppId",
        label: "Meta App ID",
        type: "string",
        required: true,
        description: "Meta app ID used for company-scoped OAuth.",
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "secret_ref",
        required: true,
        description: "Secret reference for this company's Meta app secret.",
      },
      {
        key: "verifyTokenSecret",
        label: "Verify Token Secret",
        type: "secret_ref",
        required: true,
        description: "Secret reference used to validate webhook challenge tokens.",
      },
      {
        key: "graphApiVersion",
        label: "Graph API Version",
        type: "string",
        required: false,
        defaultValue: "v22.0",
        description: "Default Graph API version for OAuth and enrichment requests.",
      },
    ],
  },

  validateSourceConfig: (input: unknown) => metaLeadgenSourceConfigSchema.parse(input),

  verifyChallenge: async (source, input, ctx) => {
    const config = readSourceConfig(source);
    if (input.mode !== "subscribe" || !input.token) {
      return { ok: false, challenge: null };
    }
    const verifyToken = await ctx.resolveSecretRef(source.companyId, config.verifyTokenSecret);
    if (!verifyToken) {
      return { ok: false, challenge: null };
    }
    const ok = safeCompareString(input.token, verifyToken);
    return { ok, challenge: ok ? input.challenge : null };
  },

  verifyDelivery: async (source, input, ctx) => {
    const config = readSourceConfig(source);
    const appSecret = await ctx.resolveSecretRef(source.companyId, config.appSecret);
    if (!appSecret) {
      return { ok: false, reason: "app_secret_missing" };
    }
    const signature = input.headers["x-hub-signature-256"];
    if (!signature || !signature.startsWith("sha256=")) {
      return { ok: false, reason: "signature_missing" };
    }
    const supplied = signature.slice("sha256=".length).trim();
    const expected = createHmac("sha256", appSecret).update(input.rawBody).digest("hex");
    return { ok: safeCompareString(supplied, expected), reason: "signature_invalid" };
  },

  extractEvents: async (_source, input) => {
    const payload = asRecord(input.payload) ?? {};

    // Meta dashboard "Test" deliveries can send a simplified sample envelope.
    const sample = asRecord(payload.sample);
    if (sample?.field === "leadgen") {
      const sampleValue = asRecord(sample.value);
      if (sampleValue) {
        const extracted = toExtractedEvent(sampleValue);
        if (extracted) return [extracted];
      }
    }

    const objectType = typeof payload.object === "string" ? payload.object : "";
    if (objectType !== "page") return [];

    const output: ExtractedExternalEvent[] = [];
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      const entryRecord = asRecord(entry);
      if (!entryRecord) continue;
      const changes = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];
      for (const change of changes) {
        const changeRecord = asRecord(change);
        if (!changeRecord) continue;
        if (changeRecord.field !== "leadgen") continue;
        const value = asRecord(changeRecord.value);
        if (!value) continue;
        const extracted = toExtractedEvent(value);
        if (extracted) output.push(extracted);
      }
    }
    return output;
  },

  enrichEvent: async (source, event, ctx) => {
    const config = readSourceConfig(source);
    let leadResponse: Record<string, unknown> | null = null;
    let enrichmentError: string | null = null;
    try {
      leadResponse = await fetchLeadDetails({
        source,
        event,
        graphApiVersion: config.graphApiVersion,
        pageAccessTokenSecret: config.pageAccessTokenSecret,
        resolveSecretRef: ctx.resolveSecretRef,
        fetchJson: ctx.fetchJson,
      });
    } catch (err) {
      enrichmentError = err instanceof Error ? err.message : String(err);
    }

    const fallbackLeadgenId =
      typeof event.payload.leadgen_id === "string"
        ? event.payload.leadgen_id
        : typeof event.providerEventId === "string"
          ? event.providerEventId
          : null;
    const leadgenId = typeof leadResponse?.id === "string" ? leadResponse.id : fallbackLeadgenId;
    if (!leadgenId) {
      throw new Error("leadgen_id is missing from Meta webhook payload");
    }

    const fieldData = leadResponse ? normalizeLeadFieldData(leadResponse.field_data) : {};
    const output: EnrichedExternalEventResult = {
      ruleContext: {
        metrics: {
          leadCount: 1,
          hasEmail: typeof fieldData.email === "string" && fieldData.email.length > 0 ? 1 : 0,
          hasPhone: typeof fieldData.phone_number === "string" && fieldData.phone_number.length > 0 ? 1 : 0,
        },
        lead: {
          id: (typeof leadResponse?.id === "string" ? leadResponse.id : leadgenId) ?? null,
          createdTime: (leadResponse?.created_time as string | null | undefined) ?? null,
          fieldData,
          enrichmentError,
        },
      },
      leadRecord: {
        leadgenId,
        pageId: typeof event.payload.page_id === "string" ? event.payload.page_id : null,
        formId: typeof event.payload.form_id === "string" ? event.payload.form_id : null,
        adId: typeof event.payload.ad_id === "string" ? event.payload.ad_id : null,
        adgroupId: typeof event.payload.adgroup_id === "string" ? event.payload.adgroup_id : null,
        campaignId: typeof event.payload.campaign_id === "string" ? event.payload.campaign_id : null,
        createdTime: parseCreatedTime((leadResponse?.created_time ?? event.payload.created_time) as unknown),
        status: enrichmentError ? "failed" : "enriched",
        error: enrichmentError,
        fieldData,
        rawPayload: leadResponse ?? event.payload,
      },
      output: {
        leadgenId,
        graphApiVersion: config.graphApiVersion,
        enrichmentError,
      },
    };
    return output;
  },

  buildRuleContext: (_source, _event, enriched) => {
    if (enriched?.ruleContext) return enriched.ruleContext;
    return {
      metrics: {
        leadCount: 1,
      },
    };
  },
};
