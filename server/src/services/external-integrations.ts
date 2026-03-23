import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  approvals,
  companyExternalPluginConfigs,
  externalActionItems,
  externalEventSources,
  externalEvents,
  externalLeads,
  externalWorkflowRuns,
} from "@paperclipai/db";
import type {
  CompanyExternalPluginConfigUpsertInput,
  CreateExternalEventSource,
  ExternalMetaConnectResult,
  ExternalMetaLeadFormSummary,
  ExternalMetaPageSummary,
  ExternalWhatsAppConnectResult,
  ExternalActionItemStatus,
  ExternalOpsSnapshot,
  ExternalOpsSummary,
  ExternalRuleInput,
  ExternalWorkflowEngine,
  ExternalWorkflowEngineInput,
  ExternalSecretRef,
  ReprocessExternalEventInput,
  RequestActionItemApproval,
  UpdateExternalEventSource,
  MetaConnectPagesInput,
  MetaConnectFormsInput,
  MetaConnectSourceInput,
  WhatsAppConnectSourceInput,
} from "@paperclipai/shared";
import { externalWorkflowEngineSchema, metaLeadgenCompanyPluginConfigSchema } from "@paperclipai/shared";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { getExternalIngestionPlugin, listExternalIngestionPlugins } from "../external-plugins/index.js";
import type {
  EnrichedExternalEventResult,
  EnrichedLeadRecord,
  ExternalIngestionPlugin,
  ExternalPluginSource,
  ExtractedExternalEvent,
} from "../external-plugins/index.js";
import { logActivity } from "./activity-log.js";
import { heartbeatService } from "./heartbeat.js";
import { issueApprovalService } from "./issue-approvals.js";
import { issueService } from "./issues.js";
import { secretService } from "./secrets.js";

const ACTIONABLE_APPROVAL_STATUSES = ["pending", "revision_requested"] as const;
const MAX_DESCRIPTION_BYTES = 20_000;

type ExternalSourceRow = typeof externalEventSources.$inferSelect;
type ExternalEventRow = typeof externalEvents.$inferSelect;
type ExternalWorkflowRunRow = typeof externalWorkflowRuns.$inferSelect;
type ExternalActionItemRow = typeof externalActionItems.$inferSelect;
type ExternalLeadRow = typeof externalLeads.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type CompanyExternalPluginConfigRow = typeof companyExternalPluginConfigs.$inferSelect;

const META_LEADGEN_PLUGIN_ID = "meta_leadgen";
const META_WHATSAPP_PLUGIN_ID = "meta_whatsapp_business";
const DEFAULT_META_GRAPH_API_VERSION = "v22.0";
const META_MANAGED_APP_ID_ENV = "SUMMUN_META_MANAGED_APP_ID";
const META_MANAGED_APP_SECRET_ENV = "SUMMUN_META_MANAGED_APP_SECRET";
const META_MANAGED_VERIFY_TOKEN_ENV = "SUMMUN_META_MANAGED_VERIFY_TOKEN";
const META_MANAGED_APP_SECRET_NAME = "meta managed app secret";
const META_MANAGED_VERIFY_TOKEN_NAME = "meta managed verify token";
const WASENDER_API_KEY_SECRET_NAME = "wasender api key";
const DEFAULT_WASENDER_BASE_URL = "https://wasenderapi.com";
const DEFAULT_WASENDER_WEBHOOK_EVENTS = ["messages.upsert", "messages.received", "session.status"] as const;
const DEFAULT_WASENDER_LEAD_AUTO_REPLY_TEMPLATE =
  "Hi {{name}}, thanks for your inquiry. We received your details and will contact you shortly. Could you share your preferred area and budget range?";
const META_COMPANY_CONFIG_REQUIRED_ERROR =
  `Meta app configuration is missing. Configure managed credentials (${META_MANAGED_APP_ID_ENV}, ${META_MANAGED_APP_SECRET_ENV}, ${META_MANAGED_VERIFY_TOKEN_ENV}) or save legacy company-level Meta app settings.`;
const META_MANAGED_CONFIG_PARTIAL_ERROR =
  `Managed Meta credentials are partially configured. Set all of ${META_MANAGED_APP_ID_ENV}, ${META_MANAGED_APP_SECRET_ENV}, and ${META_MANAGED_VERIFY_TOKEN_ENV}, or unset all three to use legacy company-level Meta app settings.`;

interface EvaluatedRule {
  rule: ExternalRuleInput;
  ruleKey: string;
  metric: string;
  actualValue: number;
}

interface ProcessExternalEventResult {
  run: ExternalWorkflowRunRow;
  actionItemsCreated: number;
  issuesCreated: number;
  skipped: boolean;
}

interface WebhookIngestResult {
  kind: "accepted" | "duplicate" | "ignored";
  event: ExternalEventRow | null;
  run: ExternalWorkflowRunRow | null;
}

interface ProcessEventOptions {
  force?: boolean;
}

export interface ExternalWorkflowEngineAdapter {
  readonly name: ExternalWorkflowEngine;
  processEvent(eventId: string, options?: ProcessEventOptions): Promise<ProcessExternalEventResult>;
}

interface ManagedMetaRuntimeEnv {
  metaAppId: string;
  appSecret: string;
  verifyToken: string;
}

interface ConnectWhatsAppBusinessSourceOptions {
  publicBaseUrl?: string | null;
}

export function resolveManagedMetaRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): ManagedMetaRuntimeEnv | null {
  const metaAppId = env[META_MANAGED_APP_ID_ENV]?.trim() ?? "";
  const appSecret = env[META_MANAGED_APP_SECRET_ENV]?.trim() ?? "";
  const verifyToken = env[META_MANAGED_VERIFY_TOKEN_ENV]?.trim() ?? "";
  const populatedCount = [metaAppId, appSecret, verifyToken].filter((value) => value.length > 0).length;
  if (populatedCount === 0) return null;
  if (populatedCount !== 3) {
    throw unprocessable(META_MANAGED_CONFIG_PARTIAL_ERROR);
  }
  return {
    metaAppId,
    appSecret,
    verifyToken,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value.join(", ");
      continue;
    }
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function safeJsonPreview(value: unknown, max = MAX_DESCRIPTION_BYTES) {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...truncated`;
}

function readNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parseGraphErrorMessage(body: Record<string, unknown>) {
  const error = asRecord(body.error);
  const message = readString(error?.message);
  const code = readString(error?.code) ?? (typeof error?.code === "number" ? String(error.code) : null);
  if (message && code) return `${message} (code ${code})`;
  return message ?? "Meta Graph API error";
}

function normalizeLeadFieldKey(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collectTextValues(input: unknown): string[] {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (typeof input === "number" && Number.isFinite(input)) {
    return [String(input)];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => collectTextValues(item));
  }
  return [];
}

function firstMatchingValue(
  fieldValuesByKey: Map<string, string[]>,
  candidateKeys: string[],
): string | null {
  for (const key of candidateKeys) {
    const values = fieldValuesByKey.get(normalizeLeadFieldKey(key)) ?? [];
    const first = values[0]?.trim();
    if (first) return first;
  }
  return null;
}

export function normalizePhoneToE164(rawInput: string, defaultCountryCode?: string | null): string | null {
  const raw = rawInput.trim();
  if (!raw) return null;
  const defaultCcDigits = (defaultCountryCode ?? "")
    .trim()
    .replace(/^\+/, "")
    .replace(/\D/g, "");

  const plusNormalized = raw.replace(/[^\d+]/g, "");
  if (plusNormalized.startsWith("+")) {
    const digits = plusNormalized.slice(1).replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    return null;
  }

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  let candidateDigits = digits;
  if (candidateDigits.startsWith("00")) {
    candidateDigits = candidateDigits.slice(2);
  } else if (defaultCcDigits) {
    if (candidateDigits.startsWith("0")) {
      candidateDigits = `${defaultCcDigits}${candidateDigits.slice(1)}`;
    } else if (!candidateDigits.startsWith(defaultCcDigits) && candidateDigits.length <= 10) {
      candidateDigits = `${defaultCcDigits}${candidateDigits}`;
    }
  }
  if (candidateDigits.length < 8 || candidateDigits.length > 15) return null;
  return `+${candidateDigits}`;
}

export function extractLeadContactForWhatsApp(
  fieldDataInput: unknown,
  defaultCountryCode?: string | null,
): { name: string | null; phoneE164: string | null } {
  const fieldData = asRecord(fieldDataInput) ?? {};
  const fieldValuesByKey = new Map<string, string[]>();
  const allValues: string[] = [];

  for (const [key, value] of Object.entries(fieldData)) {
    const values = collectTextValues(value);
    if (values.length === 0) continue;
    fieldValuesByKey.set(normalizeLeadFieldKey(key), values);
    allValues.push(...values);
  }

  const firstName = firstMatchingValue(fieldValuesByKey, ["first_name", "firstname"]);
  const lastName = firstMatchingValue(fieldValuesByKey, ["last_name", "lastname"]);
  const combinedName =
    [firstName, lastName]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part && part.length > 0))
      .join(" ")
      .trim() || null;
  const name =
    combinedName ??
    firstMatchingValue(fieldValuesByKey, ["full_name", "fullname", "name", "customer_name", "contact_name"]);

  const directPhone =
    firstMatchingValue(fieldValuesByKey, [
      "phone_number",
      "phonenumber",
      "phone",
      "mobile_number",
      "mobilenumber",
      "mobile",
      "whatsapp_number",
      "whatsappnumber",
      "whatsapp",
      "contact_number",
      "contactnumber",
    ]) ?? null;
  let phoneCandidate = directPhone;
  if (!phoneCandidate) {
    const phoneLike = allValues.find((value) => /(\+?\d[\d()\s.-]{7,}\d)/.test(value));
    phoneCandidate = phoneLike ?? null;
  }

  const phoneE164 = phoneCandidate ? normalizePhoneToE164(phoneCandidate, defaultCountryCode) : null;
  return { name, phoneE164 };
}

function parseLegacyProviderToPluginId(provider: string | null | undefined): string {
  if (provider === "meta_ads") return META_LEADGEN_PLUGIN_ID;
  if (provider === "meta_whatsapp" || provider === "wasender_whatsapp") return META_WHATSAPP_PLUGIN_ID;
  return provider ?? META_LEADGEN_PLUGIN_ID;
}

function deriveProviderFromPluginId(pluginId: string): string {
  if (pluginId === META_LEADGEN_PLUGIN_ID) return "meta_ads";
  if (pluginId === META_WHATSAPP_PLUGIN_ID) return "wasender_whatsapp";
  return pluginId;
}

function coerceSourcePluginId(source: ExternalSourceRow) {
  return source.pluginId ?? parseLegacyProviderToPluginId(source.provider);
}

export function assertSinglePluginSource(
  sources: Array<{ id: string }>,
  pluginId: string,
  excludeSourceId?: string,
) {
  const conflictSource = sources.find((source) => source.id !== excludeSourceId);
  if (conflictSource) {
    throw conflict(`Only one ${pluginId} source is allowed per company`);
  }
}

function toPluginSource(source: ExternalSourceRow): ExternalPluginSource {
  return {
    id: source.id,
    companyId: source.companyId,
    pluginId: coerceSourcePluginId(source),
    sourceConfig: asRecord(source.sourceConfig) ?? {},
  };
}

function parseEngineSetting(rawValue: string | undefined): ExternalWorkflowEngineInput {
  const parsed = externalWorkflowEngineSchema.safeParse(rawValue ?? "inline");
  if (!parsed.success) return "inline";
  return parsed.data;
}

function evaluateOperator(
  actualValue: number,
  operator: ExternalRuleInput["operator"],
  threshold: number,
) {
  switch (operator) {
    case "gt":
      return actualValue > threshold;
    case "gte":
      return actualValue >= threshold;
    case "lt":
      return actualValue < threshold;
    case "lte":
      return actualValue <= threshold;
    case "eq":
      return actualValue === threshold;
    case "neq":
      return actualValue !== threshold;
    default:
      return false;
  }
}

export function extractNumericMetric(payload: Record<string, unknown>, metricPath: string): number | null {
  const path = metricPath
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (path.length === 0) return null;

  let current: unknown = payload;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return null;
      current = current[index];
      continue;
    }
    const record = asRecord(current);
    if (!record) return null;
    current = record[segment];
  }
  return readNumeric(current);
}

export function evaluateRulesConfig(
  rulesConfigInput: unknown,
  payload: Record<string, unknown>,
): EvaluatedRule[] {
  const record = asRecord(rulesConfigInput);
  const mode = record?.mode === "all" ? "all" : "any";
  const rules = Array.isArray(record?.rules) ? record.rules : [];
  const evaluated: EvaluatedRule[] = [];

  for (let index = 0; index < rules.length; index += 1) {
    const rawRule = asRecord(rules[index]);
    if (!rawRule) continue;

    const metric = typeof rawRule.metric === "string" ? rawRule.metric : "";
    const operator = typeof rawRule.operator === "string" ? rawRule.operator : "";
    const threshold = readNumeric(rawRule.threshold);
    const title = typeof rawRule.title === "string" ? rawRule.title : "";
    if (!metric || !operator || threshold === null || !title) continue;

    const actualValue = extractNumericMetric(payload, metric);
    if (actualValue === null) continue;

    const matched = evaluateOperator(actualValue, operator as ExternalRuleInput["operator"], threshold);
    if (!matched) continue;

    evaluated.push({
      rule: {
        id: typeof rawRule.id === "string" ? rawRule.id : null,
        metric,
        operator: operator as ExternalRuleInput["operator"],
        threshold,
        title,
        description: typeof rawRule.description === "string" ? rawRule.description : null,
        priority:
          rawRule.priority === "critical" || rawRule.priority === "high" || rawRule.priority === "low"
            ? rawRule.priority
            : "medium",
      },
      ruleKey: typeof rawRule.id === "string" && rawRule.id.length > 0 ? rawRule.id : String(index),
      metric,
      actualValue,
    });
  }

  if (mode === "all" && evaluated.length !== rules.length) {
    return [];
  }
  return evaluated;
}

export function deriveEventIdempotencyKey(input: {
  providerEventId: string | null;
  rawBody: Buffer;
  idempotencyHint?: string | null;
}) {
  if (input.providerEventId) {
    return `provider:${input.providerEventId}`;
  }
  if (input.idempotencyHint) {
    return `hint:${input.idempotencyHint}`;
  }
  const digest = createHash("sha256").update(input.rawBody).digest("hex");
  return `body:${digest}`;
}

function toSecretRef(value: unknown): ExternalSecretRef | null {
  const record = asRecord(value);
  if (!record || record.type !== "secret_ref" || typeof record.secretId !== "string") return null;
  const version = record.version;
  if (version === undefined || version === "latest" || typeof version === "number") {
    return {
      type: "secret_ref",
      secretId: record.secretId,
      version: version as number | "latest" | undefined,
    };
  }
  return null;
}

async function retry<T>(fn: () => Promise<T>, attempts = 3) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
  throw lastError;
}

export function externalIntegrationService(db: Db) {
  const issuesSvc = issueService(db);
  const issueApprovalsSvc = issueApprovalService(db);
  const heartbeat = heartbeatService(db);
  const secretsSvc = secretService(db);

  async function fetchJson(url: string) {
    const response = await fetch(url);
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(text);
      body = asRecord(parsed) ?? { value: parsed };
    } catch {
      body = { text };
    }
    return { status: response.status, body };
  }

  async function fetchMetaGraph(
    path: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const baseUrl = (process.env.SUMMUN_META_GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/+$/, "");
    const normalizedPath = path.replace(/^\/+/, "");
    const query = new URLSearchParams(params);
    const url = `${baseUrl}/${normalizedPath}?${query.toString()}`;
    const response = await fetchJson(url);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Meta Graph API error (${response.status}): ${parseGraphErrorMessage(response.body)}`);
    }
    return response.body;
  }

  async function postMetaGraph(
    path: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const baseUrl = (process.env.SUMMUN_META_GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/+$/, "");
    const normalizedPath = path.replace(/^\/+/, "");
    const body = new URLSearchParams(params);
    const url = `${baseUrl}/${normalizedPath}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = asRecord(JSON.parse(text)) ?? { text };
    } catch {
      payload = { text };
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Meta Graph API error (${response.status}): ${parseGraphErrorMessage(payload)}`);
    }
    return payload;
  }

  function parseWaSenderErrorMessage(body: unknown, status: number) {
    const record = asRecord(body);
    const directMessage = readString(record?.message);
    if (directMessage) return directMessage;
    const directError = readString(record?.error);
    if (directError) return directError;
    const nestedError = asRecord(record?.error);
    const nestedMessage = readString(nestedError?.message);
    if (nestedMessage) return nestedMessage;
    const errors = record?.errors;
    if (Array.isArray(errors)) {
      const first = errors.find((item) => typeof item === "string");
      if (typeof first === "string" && first.trim().length > 0) return first.trim();
    }
    return `HTTP ${status}`;
  }

  async function requestWaSender(
    baseUrl: string,
    accessToken: string,
    path: string,
    init?: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${baseUrl}${normalizedPath}`;
    const method = init?.method ?? (init?.body ? "POST" : "GET");
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    const record = asRecord(payload);
    if (response.status < 200 || response.status >= 300 || record?.success === false) {
      const message = parseWaSenderErrorMessage(payload, response.status);
      throw unprocessable(`WaSender API error: ${message}`);
    }
    if (record && Object.prototype.hasOwnProperty.call(record, "data")) {
      return record.data;
    }
    return payload;
  }

  function readWaSenderSessionId(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    return null;
  }

  function isWaSenderSessionConnected(status: string | null) {
    if (!status) return false;
    const normalized = status.trim().toLowerCase();
    return normalized === "connected" || normalized === "ready" || normalized === "open";
  }

  function renderWaSenderLeadAutoReplyMessage(name: string | null) {
    const template = (process.env.SUMMUN_WASENDER_LEAD_AUTO_REPLY_TEMPLATE ?? DEFAULT_WASENDER_LEAD_AUTO_REPLY_TEMPLATE)
      .trim();
    const safeName = name?.trim() || "there";
    return template.replace(/\{\{\s*name\s*\}\}/gi, safeName);
  }

  async function sendLeadAutoReplyToWaSender(input: {
    source: ExternalSourceRow;
    event: ExternalEventRow;
    lead: EnrichedLeadRecord;
  }): Promise<{ sent: boolean; reason?: string; to?: string; messageId?: string }> {
    const whatsappSource = await getSinglePluginSource(input.source.companyId, META_WHATSAPP_PLUGIN_ID);
    if (!whatsappSource || whatsappSource.status !== "active") {
      return { sent: false, reason: "whatsapp_source_not_active" };
    }

    const defaultCountryCode = process.env.SUMMUN_WASENDER_DEFAULT_COUNTRY_CODE ?? null;
    const contact = extractLeadContactForWhatsApp(input.lead.fieldData, defaultCountryCode);
    if (!contact.phoneE164) {
      return { sent: false, reason: "lead_phone_missing" };
    }

    const waConfig = asRecord(whatsappSource.sourceConfig) ?? {};
    const apiKeySecretRef = toSecretRef(waConfig.apiKeySecret);
    if (!apiKeySecretRef) {
      return { sent: false, reason: "wasender_api_key_secret_missing" };
    }
    const waSenderToken = await resolveSecret(input.source.companyId, apiKeySecretRef);
    if (!waSenderToken) {
      return { sent: false, reason: "wasender_api_key_unresolved" };
    }
    const baseUrl = (readString(waConfig.baseUrl) ?? DEFAULT_WASENDER_BASE_URL).trim().replace(/\/+$/, "");
    const text = renderWaSenderLeadAutoReplyMessage(contact.name);

    const sendPayload = await requestWaSender(baseUrl, waSenderToken, "/api/send-message", {
      method: "POST",
      body: {
        to: contact.phoneE164,
        text,
      },
    });
    const sendRecord = asRecord(sendPayload) ?? {};
    const messageId = readString(sendRecord.msgId) ?? (typeof sendRecord.msgId === "number" ? String(sendRecord.msgId) : null);

    await logActivity(db, {
      companyId: input.source.companyId,
      actorType: "system",
      actorId: "external_workflow",
      action: "external_lead.whatsapp_auto_replied",
      entityType: "external_event",
      entityId: input.event.id,
      details: {
        sourceId: input.source.id,
        leadgenId: input.lead.leadgenId,
        phone: contact.phoneE164,
        whatsappSourceId: whatsappSource.id,
        messageId,
      },
    });

    return {
      sent: true,
      to: contact.phoneE164,
      messageId: messageId ?? undefined,
    };
  }

  async function getSourceById(id: string) {
    return db
      .select()
      .from(externalEventSources)
      .where(eq(externalEventSources.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function findEventById(eventId: string) {
    return db
      .select()
      .from(externalEvents)
      .where(eq(externalEvents.id, eventId))
      .then((rows) => rows[0] ?? null);
  }

  async function resolveSecret(companyId: string, secretRef: ExternalSecretRef | null | undefined): Promise<string | null> {
    if (!secretRef) return null;
    const { env } = await secretsSvc.resolveEnvBindings(companyId, {
      EXTERNAL_SECRET: secretRef,
    });
    return env.EXTERNAL_SECRET ?? null;
  }

  async function assertSecretInCompany(companyId: string, secretId: string) {
    const secret = await secretsSvc.getById(secretId);
    if (!secret || secret.companyId !== companyId) {
      throw unprocessable(`Secret not found for company: ${secretId}`);
    }
    return secret;
  }

  async function resolveSecretById(companyId: string, secretId: string) {
    await assertSecretInCompany(companyId, secretId);
    const value = await resolveSecret(companyId, {
      type: "secret_ref",
      secretId,
      version: "latest",
    });
    if (!value) throw unprocessable(`Secret value could not be resolved: ${secretId}`);
    return value;
  }

  async function fetchMetaPagesWithTokens(
    companyId: string,
    userAccessTokenSecretId: string,
  ): Promise<Array<{ id: string; name: string; category: string | null; tasks: string[]; accessToken: string | null }>> {
    const userAccessToken = await resolveSecretById(companyId, userAccessTokenSecretId);
    let body: Record<string, unknown>;
    try {
      body = await fetchMetaGraph("v25.0/me/accounts", {
        access_token: userAccessToken,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      if (
        lower.includes("invalid oauth access token") ||
        lower.includes("error validating access token") ||
        lower.includes("malformed access token") ||
        lower.includes("code 190")
      ) {
        throw unprocessable(
          "Invalid or expired Meta user access token. Reconnect with Meta login and use the 'meta oauth user access token' secret.",
        );
      }
      throw unprocessable("Failed to load Meta pages from Meta Graph API.");
    }
    const rows = Array.isArray(body.data) ? body.data : [];
    const pages: Array<{ id: string; name: string; category: string | null; tasks: string[]; accessToken: string | null }> = [];
    for (const row of rows) {
      const record = asRecord(row);
      if (!record) continue;
      const id = readString(record.id);
      if (!id) continue;
      pages.push({
        id,
        name: readString(record.name) ?? id,
        category: readString(record.category),
        tasks: toStringArray(record.tasks),
        accessToken: readString(record.access_token),
      });
    }
    return pages;
  }

  function ensurePageAccess(
    pages: Array<{ id: string; name: string; category: string | null; tasks: string[]; accessToken: string | null }>,
    pageId: string,
  ) {
    const page = pages.find((item) => item.id === pageId);
    if (!page) throw unprocessable("Selected Meta page is not accessible with the provided user access token");
    if (!page.accessToken) throw unprocessable("Meta page access token is unavailable for the selected page");
    return page;
  }

  async function assertSecretRefsInCompany(companyId: string, sourceConfig: Record<string, unknown>) {
    async function visit(value: unknown): Promise<void> {
      if (Array.isArray(value)) {
        for (const item of value) {
          await visit(item);
        }
        return;
      }
      const record = asRecord(value);
      if (!record) return;
      const maybeRef = toSecretRef(record);
      if (maybeRef) {
        const secret = await secretsSvc.getById(maybeRef.secretId);
        if (!secret || secret.companyId !== companyId) {
          throw unprocessable(`Secret not found for source config: ${maybeRef.secretId}`);
        }
        return;
      }
      for (const child of Object.values(record)) {
        await visit(child);
      }
    }

    await visit(sourceConfig);
  }

  function validateCompanyPluginConfig(pluginId: string, configInput: unknown): Record<string, unknown> {
    if (pluginId === META_LEADGEN_PLUGIN_ID) {
      return metaLeadgenCompanyPluginConfigSchema.parse(configInput);
    }
    const record = asRecord(configInput);
    return record ?? {};
  }

  async function getCompanyPluginConfig(
    companyId: string,
    pluginId: string,
  ): Promise<CompanyExternalPluginConfigRow | null> {
    return db
      .select()
      .from(companyExternalPluginConfigs)
      .where(
        and(
          eq(companyExternalPluginConfigs.companyId, companyId),
          eq(companyExternalPluginConfigs.pluginId, pluginId),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function upsertCompanyPluginConfig(
    companyId: string,
    pluginId: string,
    input: CompanyExternalPluginConfigUpsertInput,
  ): Promise<CompanyExternalPluginConfigRow> {
    getExternalIngestionPlugin(pluginId);
    const config = validateCompanyPluginConfig(pluginId, input.config);
    await assertSecretRefsInCompany(companyId, config);

    const existing = await getCompanyPluginConfig(companyId, pluginId);
    if (existing) {
      const [updated] = await db
        .update(companyExternalPluginConfigs)
        .set({
          config,
          updatedAt: new Date(),
        })
        .where(eq(companyExternalPluginConfigs.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(companyExternalPluginConfigs)
      .values({
        companyId,
        pluginId,
        config,
      })
      .returning();
    return created;
  }

  async function getRequiredMetaCompanyConfig(companyId: string) {
    const row = await getCompanyPluginConfig(companyId, META_LEADGEN_PLUGIN_ID);
    if (!row) {
      throw unprocessable(META_COMPANY_CONFIG_REQUIRED_ERROR);
    }
    const parsed = metaLeadgenCompanyPluginConfigSchema.safeParse(asRecord(row.config) ?? {});
    if (!parsed.success) {
      throw unprocessable(`Invalid Meta app configuration: ${parsed.error.issues[0]?.message ?? "invalid config"}`);
    }
    await assertSecretRefsInCompany(companyId, parsed.data as unknown as Record<string, unknown>);
    return {
      row,
      config: parsed.data,
    };
  }

  async function resolveRequiredSecretRef(companyId: string, secretRef: ExternalSecretRef, purpose: string) {
    const value = await resolveSecret(companyId, secretRef);
    if (!value) {
      throw unprocessable(`Meta app configuration secret is missing: ${purpose}`);
    }
    return value;
  }

  async function ensureManagedSecretRef(
    companyId: string,
    name: string,
    value: string,
    description: string,
  ) {
    const existing = await secretsSvc.getByName(companyId, name);
    if (!existing) {
      const created = await secretsSvc.create(
        companyId,
        {
          name,
          provider: "local_encrypted",
          value,
          description,
        },
        { userId: null, agentId: null },
      );
      return {
        type: "secret_ref" as const,
        secretId: created.id,
        version: "latest" as const,
      };
    }

    const currentValue = await resolveSecret(companyId, {
      type: "secret_ref",
      secretId: existing.id,
      version: "latest",
    });
    if (currentValue !== value) {
      await secretsSvc.rotate(
        existing.id,
        { value },
        { userId: null, agentId: null },
      );
    }
    return {
      type: "secret_ref" as const,
      secretId: existing.id,
      version: "latest" as const,
    };
  }

  async function getRequiredMetaRuntimeConfig(companyId: string) {
    const managedEnv = resolveManagedMetaRuntimeEnv();
    if (managedEnv) {
      const appSecretSecretRef = await ensureManagedSecretRef(
        companyId,
        META_MANAGED_APP_SECRET_NAME,
        managedEnv.appSecret,
        "Auto-managed Meta app secret from instance environment settings.",
      );
      const verifyTokenSecretRef = await ensureManagedSecretRef(
        companyId,
        META_MANAGED_VERIFY_TOKEN_NAME,
        managedEnv.verifyToken,
        "Auto-managed Meta verify token from instance environment settings.",
      );
      return {
        mode: "managed_env" as const,
        metaAppId: managedEnv.metaAppId,
        appSecret: managedEnv.appSecret,
        appSecretSecretRef,
        verifyTokenSecret: verifyTokenSecretRef,
        graphApiVersion: process.env.SUMMUN_META_GRAPH_API_VERSION?.trim() || DEFAULT_META_GRAPH_API_VERSION,
      };
    }

    const { config } = await getRequiredMetaCompanyConfig(companyId);
    const appSecret = await resolveRequiredSecretRef(companyId, config.appSecret, "appSecret");
    return {
      mode: "company_config" as const,
      metaAppId: config.metaAppId,
      appSecret,
      appSecretSecretRef: config.appSecret,
      verifyTokenSecret: config.verifyTokenSecret,
      graphApiVersion: config.graphApiVersion ?? DEFAULT_META_GRAPH_API_VERSION,
    };
  }

  async function listPluginSources(companyId: string, pluginId: string) {
    return db
      .select()
      .from(externalEventSources)
      .where(
        and(
          eq(externalEventSources.companyId, companyId),
          eq(externalEventSources.pluginId, pluginId),
        ),
      )
      .orderBy(asc(externalEventSources.createdAt));
  }

  async function getSinglePluginSource(companyId: string, pluginId: string) {
    const matches = await listPluginSources(companyId, pluginId);
    if (matches.length > 1) {
      throw conflict(`Multiple ${pluginId} sources found for company; only one is supported`);
    }
    return matches[0] ?? null;
  }

  async function assertOnePluginSourcePerCompany(companyId: string, pluginId: string, excludeSourceId?: string) {
    const matches = await listPluginSources(companyId, pluginId);
    assertSinglePluginSource(matches, pluginId, excludeSourceId);
  }

  async function normalizeSourceConfigForPlugin(
    companyId: string,
    pluginId: string,
    sourceConfigInput: Record<string, unknown>,
  ) {
    if (pluginId !== META_LEADGEN_PLUGIN_ID) {
      return sourceConfigInput;
    }
    const metaRuntimeConfig = await getRequiredMetaRuntimeConfig(companyId);
    const graphApiVersion =
      typeof sourceConfigInput.graphApiVersion === "string" && sourceConfigInput.graphApiVersion.length > 0
        ? sourceConfigInput.graphApiVersion
        : (metaRuntimeConfig.graphApiVersion ?? DEFAULT_META_GRAPH_API_VERSION);
    return {
      ...sourceConfigInput,
      verifyTokenSecret: metaRuntimeConfig.verifyTokenSecret,
      appSecret: metaRuntimeConfig.appSecretSecretRef,
      graphApiVersion,
    };
  }

  async function assertReviewerAgent(companyId: string, reviewerAgentId: string | null | undefined) {
    if (!reviewerAgentId) return;
    const reviewer = await db
      .select({ id: agents.id, companyId: agents.companyId, status: agents.status })
      .from(agents)
      .where(eq(agents.id, reviewerAgentId))
      .then((rows) => rows[0] ?? null);
    if (!reviewer || reviewer.companyId !== companyId) {
      throw unprocessable("Reviewer agent must belong to the same company");
    }
    if (reviewer.status === "terminated" || reviewer.status === "pending_approval") {
      throw unprocessable("Reviewer agent is not active");
    }
  }

  async function updateSourceWebhookStatus(sourceId: string, status: string, error?: string | null) {
    await db
      .update(externalEventSources)
      .set({
        lastWebhookAt: new Date(),
        lastWebhookStatus: status,
        lastWebhookError: error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(externalEventSources.id, sourceId));
  }

  async function updateEventStatus(
    eventId: string,
    status: typeof externalEvents.$inferInsert.status,
    patch?: Partial<typeof externalEvents.$inferInsert>,
  ) {
    await db
      .update(externalEvents)
      .set({
        status,
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(externalEvents.id, eventId));
  }

  async function upsertLeadRecord(input: {
    source: ExternalSourceRow;
    event: ExternalEventRow;
    workflowRunId: string | null;
    lead: EnrichedLeadRecord;
  }) {
    const values = {
      companyId: input.source.companyId,
      sourceId: input.source.id,
      eventId: input.event.id,
      workflowRunId: input.workflowRunId,
      leadgenId: input.lead.leadgenId,
      pageId: input.lead.pageId,
      formId: input.lead.formId,
      adId: input.lead.adId,
      adgroupId: input.lead.adgroupId,
      campaignId: input.lead.campaignId,
      createdTime: input.lead.createdTime,
      status: input.lead.status,
      error: input.lead.error,
      fieldData: input.lead.fieldData,
      rawPayload: input.lead.rawPayload,
      updatedAt: new Date(),
    };

    const existing = await db
      .select()
      .from(externalLeads)
      .where(and(eq(externalLeads.sourceId, input.source.id), eq(externalLeads.leadgenId, input.lead.leadgenId)))
      .then((rows) => rows[0] ?? null);
    if (existing) {
      return db
        .update(externalLeads)
        .set(values)
        .where(eq(externalLeads.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);
    }
    return db
      .insert(externalLeads)
      .values(values)
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function createIssueForActionItem(source: ExternalSourceRow, actionItem: ExternalActionItemRow) {
    const issue = await issuesSvc.create(source.companyId, {
      projectId: null,
      goalId: null,
      parentId: null,
      title: `[${source.pluginId ?? "External"}] ${actionItem.title}`,
      description: actionItem.description,
      status: "todo",
      priority:
        actionItem.priority === "critical" || actionItem.priority === "high" || actionItem.priority === "low"
          ? actionItem.priority
          : "medium",
      assigneeAgentId: source.reviewerAgentId,
      assigneeUserId: null,
      requestDepth: 0,
      billingCode: null,
      assigneeAdapterOverrides: null,
      executionWorkspaceSettings: null,
      createdByAgentId: null,
      createdByUserId: null,
    });

    await db
      .update(externalActionItems)
      .set({
        issueId: issue.id,
        updatedAt: new Date(),
      })
      .where(eq(externalActionItems.id, actionItem.id));

    await logActivity(db, {
      companyId: source.companyId,
      actorType: "system",
      actorId: "external_workflow",
      action: "issue.created",
      entityType: "issue",
      entityId: issue.id,
      details: {
        title: issue.title,
        source: "external_action_item",
        actionItemId: actionItem.id,
        identifier: issue.identifier,
      },
    });

    return issue;
  }

  async function buildExtractedEventFromStoredEvent(event: ExternalEventRow): Promise<ExtractedExternalEvent> {
    const payload = asRecord(event.payload) ?? {};
    const rawPayload = asRecord(payload.payload) ?? payload;
    const eventType = typeof payload.eventType === "string" ? payload.eventType : "event";
    const idempotencyHint = typeof payload.idempotencyHint === "string" ? payload.idempotencyHint : null;
    return {
      providerEventId: event.providerEventId,
      idempotencyHint,
      eventType,
      payload: rawPayload,
    };
  }

  async function persistEventAndRunWorkflow(input: {
    source: ExternalSourceRow;
    plugin: ExternalIngestionPlugin;
    extracted: ExtractedExternalEvent;
    headers: Record<string, string>;
    rawBody: Buffer;
  }): Promise<WebhookIngestResult> {
    const providerEventId = input.extracted.providerEventId;
    const idempotencyKey = deriveEventIdempotencyKey({
      providerEventId,
      rawBody: input.rawBody,
      idempotencyHint: input.extracted.idempotencyHint,
    });

    const now = new Date();
    const inserted = await db
      .insert(externalEvents)
      .values({
        companyId: input.source.companyId,
        sourceId: input.source.id,
        providerEventId,
        idempotencyKey,
        deliveryAttempt: 1,
        status: "received",
        payload: {
          eventType: input.extracted.eventType,
          idempotencyHint: input.extracted.idempotencyHint,
          payload: input.extracted.payload,
        },
        headers: input.headers,
        receivedAt: now,
      })
      .onConflictDoNothing()
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!inserted) {
      const duplicate = await db
        .select()
        .from(externalEvents)
        .where(and(eq(externalEvents.sourceId, input.source.id), eq(externalEvents.idempotencyKey, idempotencyKey)))
        .then((rows) => rows[0] ?? null);
      if (!duplicate) throw conflict("Webhook was not persisted");

      await updateSourceWebhookStatus(input.source.id, "duplicate");
      await logActivity(db, {
        companyId: input.source.companyId,
        actorType: "system",
        actorId: `webhook.${input.plugin.metadata.pluginId}`,
        action: "external_event.duplicate",
        entityType: "external_event",
        entityId: duplicate.id,
        details: {
          sourceId: input.source.id,
          pluginId: input.plugin.metadata.pluginId,
          providerEventId,
          idempotencyKey,
        },
      });
      return { kind: "duplicate", event: duplicate, run: null };
    }

    await updateSourceWebhookStatus(input.source.id, "received");
    await logActivity(db, {
      companyId: input.source.companyId,
      actorType: "system",
      actorId: `webhook.${input.plugin.metadata.pluginId}`,
      action: "external_event.received",
      entityType: "external_event",
      entityId: inserted.id,
      details: {
        sourceId: input.source.id,
        pluginId: input.plugin.metadata.pluginId,
        providerEventId,
        idempotencyKey,
      },
    });

    const engine = selectWorkflowEngine();
    const result = await engine.processEvent(inserted.id);
    await logActivity(db, {
      companyId: input.source.companyId,
      actorType: "system",
      actorId: "external_workflow",
      action: "external_workflow.completed",
      entityType: "external_workflow_run",
      entityId: result.run.id,
      details: {
        sourceId: input.source.id,
        eventId: inserted.id,
        pluginId: input.plugin.metadata.pluginId,
        engine: engine.name,
        skipped: result.skipped,
        actionItemsCreated: result.actionItemsCreated,
        issuesCreated: result.issuesCreated,
      },
    });

    return { kind: "accepted", event: inserted, run: result.run };
  }

  const inlineEngine: ExternalWorkflowEngineAdapter = {
    name: "inline",
    processEvent: async (eventId: string, options?: ProcessEventOptions) => {
      const event = await findEventById(eventId);
      if (!event) throw notFound("External event not found");
      const source = await getSourceById(event.sourceId);
      if (!source) throw notFound("External event source not found");

      const pluginId = coerceSourcePluginId(source);
      const plugin = getExternalIngestionPlugin(pluginId);
      const pluginSource = toPluginSource(source);

      if (!options?.force) {
        const existingRun = await db
          .select()
          .from(externalWorkflowRuns)
          .where(
            and(
              eq(externalWorkflowRuns.eventId, event.id),
              inArray(externalWorkflowRuns.status, ["succeeded", "skipped"]),
            ),
          )
          .orderBy(desc(externalWorkflowRuns.attempt))
          .then((rows) => rows[0] ?? null);
        if (existingRun) {
          return {
            run: existingRun,
            actionItemsCreated: 0,
            issuesCreated: 0,
            skipped: existingRun.status === "skipped",
          };
        }
      }

      const previousAttempts = await db
        .select({ maxAttempt: sql<number>`coalesce(max(${externalWorkflowRuns.attempt}), 0)::int` })
        .from(externalWorkflowRuns)
        .where(eq(externalWorkflowRuns.eventId, event.id))
        .then((rows) => Number(rows[0]?.maxAttempt ?? 0));
      const attempt = previousAttempts + 1;

      const [run] = await db
        .insert(externalWorkflowRuns)
        .values({
          companyId: source.companyId,
          sourceId: source.id,
          eventId: event.id,
          workflowType: "process_external_event",
          engine: "inline",
          status: "running",
          attempt,
          startedAt: new Date(),
          context: {
            eventId: event.id,
            sourceId: source.id,
            pluginId,
          },
          output: null,
        })
        .returning();

      try {
        const extracted = await buildExtractedEventFromStoredEvent(event);
        let enriched: EnrichedExternalEventResult | null = null;
        if (plugin.enrichEvent) {
          try {
            enriched = await retry(
              () =>
                plugin.enrichEvent!(pluginSource, extracted, {
                  resolveSecretRef: resolveSecret,
                  fetchJson,
                }),
              3,
            );
          } catch (err) {
            const leadgenId = typeof extracted.payload.leadgen_id === "string" ? extracted.payload.leadgen_id : null;
            if (leadgenId) {
              await upsertLeadRecord({
                source,
                event,
                workflowRunId: run.id,
                lead: {
                  leadgenId,
                  pageId: typeof extracted.payload.page_id === "string" ? extracted.payload.page_id : null,
                  formId: typeof extracted.payload.form_id === "string" ? extracted.payload.form_id : null,
                  adId: typeof extracted.payload.ad_id === "string" ? extracted.payload.ad_id : null,
                  adgroupId: typeof extracted.payload.adgroup_id === "string" ? extracted.payload.adgroup_id : null,
                  campaignId: typeof extracted.payload.campaign_id === "string" ? extracted.payload.campaign_id : null,
                  createdTime: null,
                  status: "failed",
                  error: err instanceof Error ? err.message : String(err),
                  fieldData: {},
                  rawPayload: extracted.payload,
                },
              });
            }
            throw err;
          }
        }

        if (enriched?.leadRecord) {
          await upsertLeadRecord({
            source,
            event,
            workflowRunId: run.id,
            lead: enriched.leadRecord,
          });
        }

        let waSenderAutoReplyResult: { sent: boolean; reason?: string; to?: string; messageId?: string } | null = null;
        if (pluginId === META_LEADGEN_PLUGIN_ID && attempt === 1 && enriched?.leadRecord) {
          try {
            waSenderAutoReplyResult = await sendLeadAutoReplyToWaSender({
              source,
              event,
              lead: enriched.leadRecord,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(
              { err, sourceId: source.id, eventId: event.id, pluginId },
              "failed to auto-reply lead via WaSender",
            );
            waSenderAutoReplyResult = {
              sent: false,
              reason: message,
            };
          }
        }

        const ruleContext = plugin.buildRuleContext(pluginSource, extracted, enriched);
        const matches = evaluateRulesConfig(source.rulesConfig, ruleContext);
        if (matches.length === 0) {
          const [updated] = await db
            .update(externalWorkflowRuns)
            .set({
              status: "skipped",
              finishedAt: new Date(),
              output: {
                pluginId,
                matchedRules: 0,
                createdActionItems: 0,
                createdIssues: 0,
                waSenderAutoReply: waSenderAutoReplyResult,
              },
              updatedAt: new Date(),
            })
            .where(eq(externalWorkflowRuns.id, run.id))
            .returning();
          await updateEventStatus(event.id, "processed", {
            processedAt: new Date(),
            rejectedAt: null,
            rejectionReason: null,
          });
          return {
            run: updated,
            actionItemsCreated: 0,
            issuesCreated: 0,
            skipped: true,
          };
        }

        let actionItemsCreated = 0;
        let issuesCreated = 0;
        const wakeAssignments = new Map<string, { primaryIssueId: string; issueIds: Set<string> }>();

        for (const match of matches) {
          const dedupeKey = `${event.idempotencyKey}:${match.ruleKey}`;
          const descriptionLines = [
            match.rule.description ? String(match.rule.description) : null,
            "",
            `Plugin: ${pluginId}`,
            `Rule: ${match.rule.title}`,
            `Metric: ${match.metric}`,
            `Threshold: ${match.rule.operator} ${match.rule.threshold}`,
            `Actual: ${match.actualValue}`,
            "",
            "Rule context excerpt:",
            "```json",
            safeJsonPreview(ruleContext, 3_000),
            "```",
            "",
            "Raw event excerpt:",
            "```json",
            safeJsonPreview(extracted.payload, 2_000),
            "```",
          ].filter((line) => line !== null);

          const inserted = await db
            .insert(externalActionItems)
            .values({
              companyId: source.companyId,
              sourceId: source.id,
              eventId: event.id,
              workflowRunId: run.id,
              issueId: null,
              approvalId: null,
              reviewerAgentId: source.reviewerAgentId,
              title: match.rule.title,
              description: descriptionLines.join("\n"),
              priority: match.rule.priority ?? "medium",
              status: "pending_review",
              dedupeKey,
              evidence: {
                metric: match.metric,
                operator: match.rule.operator,
                threshold: match.rule.threshold,
                actualValue: match.actualValue,
                pluginId,
              },
              recommendation: {
                mode: "rules_plus_review",
                pluginId,
                output: enriched?.output ?? null,
              },
            })
            .onConflictDoNothing()
            .returning()
            .then((rows) => rows[0] ?? null);

          const actionItem =
            inserted ??
            (await db
              .select()
              .from(externalActionItems)
              .where(
                and(
                  eq(externalActionItems.companyId, source.companyId),
                  eq(externalActionItems.sourceId, source.id),
                  eq(externalActionItems.dedupeKey, dedupeKey),
                ),
              )
              .then((rows) => rows[0] ?? null));
          if (!actionItem) continue;
          if (inserted) {
            actionItemsCreated += 1;
            await logActivity(db, {
              companyId: source.companyId,
              actorType: "system",
              actorId: "external_workflow",
              action: "external_action_item.created",
              entityType: "external_action_item",
              entityId: actionItem.id,
              details: {
                sourceId: source.id,
                eventId: event.id,
                pluginId,
                dedupeKey,
              },
            });
          }

          if (!actionItem.issueId) {
            const issue = await createIssueForActionItem(source, actionItem);
            issuesCreated += 1;
            if (issue.assigneeAgentId) {
              const existingWake = wakeAssignments.get(issue.assigneeAgentId);
              if (existingWake) {
                existingWake.issueIds.add(issue.id);
              } else {
                wakeAssignments.set(issue.assigneeAgentId, {
                  primaryIssueId: issue.id,
                  issueIds: new Set([issue.id]),
                });
              }
            }
          }
        }

        for (const [reviewerAgentId, wake] of wakeAssignments.entries()) {
          const issueIds = Array.from(wake.issueIds);
          try {
            await heartbeat.wakeup(reviewerAgentId, {
              source: "assignment",
              triggerDetail: "system",
              reason: "issue_assigned",
              payload: {
                issueId: wake.primaryIssueId,
                issueIds,
                eventId: event.id,
                sourceId: source.id,
                pluginId,
                mutation: "external_event",
              },
              requestedByActorType: "system",
              requestedByActorId: "external_workflow",
              contextSnapshot: {
                issueId: wake.primaryIssueId,
                issueIds,
                source: "external.workflow",
                wakeReason: "external_action_item_created",
                eventId: event.id,
                sourceId: source.id,
                pluginId,
              },
            });
          } catch (err) {
            logger.warn(
              { err, reviewerAgentId, sourceId: source.id, eventId: event.id, pluginId },
              "failed to wake reviewer agent for external action item",
            );
          }
        }

        const [updated] = await db
          .update(externalWorkflowRuns)
          .set({
            status: "succeeded",
            finishedAt: new Date(),
            output: {
              pluginId,
              matchedRules: matches.length,
              createdActionItems: actionItemsCreated,
              createdIssues: issuesCreated,
              enrichment: enriched?.output ?? null,
              waSenderAutoReply: waSenderAutoReplyResult,
            },
            updatedAt: new Date(),
          })
          .where(eq(externalWorkflowRuns.id, run.id))
          .returning();
        await updateEventStatus(event.id, "processed", {
          processedAt: new Date(),
          rejectedAt: null,
          rejectionReason: null,
        });
        return {
          run: updated,
          actionItemsCreated,
          issuesCreated,
          skipped: false,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [updated] = await db
          .update(externalWorkflowRuns)
          .set({
            status: "failed",
            finishedAt: new Date(),
            error: message,
            updatedAt: new Date(),
          })
          .where(eq(externalWorkflowRuns.id, run.id))
          .returning();
        await updateEventStatus(event.id, "failed", {
          rejectedAt: new Date(),
          rejectionReason: message,
        });
        throw new Error(`External workflow failed: ${message}`, { cause: err });
      }
    },
  };

  const temporalEngine: ExternalWorkflowEngineAdapter = {
    name: "temporal",
    processEvent: async (eventId: string, options?: ProcessEventOptions) => {
      logger.warn(
        { eventId },
        "Temporal external workflow adapter is not configured; falling back to inline engine",
      );
      return inlineEngine.processEvent(eventId, options);
    },
  };

  function selectWorkflowEngine(): ExternalWorkflowEngineAdapter {
    const selected = parseEngineSetting(process.env.SUMMUN_EXTERNAL_WORKFLOW_ENGINE);
    return selected === "temporal" ? temporalEngine : inlineEngine;
  }

  async function markActionItemFromApproval(
    approval: ApprovalRow,
    mode: "created" | "resolved" | "revision_requested" | "resubmitted",
  ) {
    if (approval.type !== "approve_action_item") return null;
    const payload = asRecord(approval.payload);
    const actionItemId = typeof payload?.actionItemId === "string" ? payload.actionItemId : null;
    if (!actionItemId) return null;

    let status: ExternalActionItemStatus = "pending_approval";
    let closedAt: Date | null = null;
    if (mode === "resolved") {
      if (approval.status === "approved") {
        status = "approved";
        closedAt = new Date();
      } else if (approval.status === "rejected") {
        status = "rejected";
        closedAt = new Date();
      }
    } else if (mode === "revision_requested") {
      status = "pending_review";
      closedAt = null;
    } else if (mode === "resubmitted") {
      status = "pending_approval";
      closedAt = null;
    }

    const [updated] = await db
      .update(externalActionItems)
      .set({
        approvalId: approval.id,
        status,
        closedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(externalActionItems.id, actionItemId), eq(externalActionItems.companyId, approval.companyId)))
      .returning();
    return updated ?? null;
  }

  async function getOpsSummary(companyId: string): Promise<ExternalOpsSummary> {
    const sourceRows = await db
      .select({
        status: externalEventSources.status,
        count: sql<number>`count(*)`,
        lastWebhookAt: sql<string | null>`max(${externalEventSources.lastWebhookAt})`,
        failures: sql<number>`sum(case when ${externalEventSources.lastWebhookStatus} in ('failed', 'rejected') then 1 else 0 end)::int`,
      })
      .from(externalEventSources)
      .where(eq(externalEventSources.companyId, companyId))
      .groupBy(externalEventSources.status);

    const sources = {
      total: 0,
      active: 0,
      paused: 0,
      failures: 0,
      lastWebhookAt: null as string | null,
    };
    for (const row of sourceRows) {
      const count = Number(row.count);
      sources.total += count;
      if (row.status === "active") sources.active += count;
      if (row.status === "paused") sources.paused += count;
      sources.failures += Number(row.failures ?? 0);
      if (row.lastWebhookAt && (!sources.lastWebhookAt || row.lastWebhookAt > sources.lastWebhookAt)) {
        sources.lastWebhookAt = row.lastWebhookAt;
      }
    }

    const now = Date.now();
    const since = new Date(now - 24 * 60 * 60 * 1000);
    const eventRows = await db
      .select({
        status: externalEvents.status,
        count: sql<number>`count(*)`,
      })
      .from(externalEvents)
      .where(and(eq(externalEvents.companyId, companyId), gte(externalEvents.receivedAt, since)))
      .groupBy(externalEvents.status);
    const events24h = {
      received: 0,
      processed: 0,
      rejected: 0,
      duplicate: 0,
      failed: 0,
    };
    for (const row of eventRows) {
      const key = row.status as keyof typeof events24h;
      if (key in events24h) events24h[key] += Number(row.count);
    }

    const itemRows = await db
      .select({
        status: externalActionItems.status,
        count: sql<number>`count(*)`,
      })
      .from(externalActionItems)
      .where(eq(externalActionItems.companyId, companyId))
      .groupBy(externalActionItems.status);
    const actionItems = {
      pendingReview: 0,
      pendingApproval: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    };
    for (const row of itemRows) {
      if (row.status === "pending_review") actionItems.pendingReview += Number(row.count);
      if (row.status === "pending_approval") actionItems.pendingApproval += Number(row.count);
      if (row.status === "approved") actionItems.approved += Number(row.count);
      if (row.status === "rejected") actionItems.rejected += Number(row.count);
      if (row.status === "cancelled") actionItems.cancelled += Number(row.count);
    }

    const leadRows = await db
      .select({
        status: externalLeads.status,
        count: sql<number>`count(*)`,
      })
      .from(externalLeads)
      .where(and(eq(externalLeads.companyId, companyId), gte(externalLeads.createdAt, since)))
      .groupBy(externalLeads.status);
    const leads24h = {
      received: 0,
      enriched: 0,
      failed: 0,
    };
    for (const row of leadRows) {
      if (row.status === "received") leads24h.received += Number(row.count);
      if (row.status === "enriched") leads24h.enriched += Number(row.count);
      if (row.status === "failed") leads24h.failed += Number(row.count);
    }

    const pendingApprovals = await db
      .select({ count: sql<number>`count(*)` })
      .from(approvals)
      .where(
        and(
          eq(approvals.companyId, companyId),
          eq(approvals.type, "approve_action_item"),
          inArray(approvals.status, ACTIONABLE_APPROVAL_STATUSES as unknown as string[]),
        ),
      )
      .then((rows) => Number(rows[0]?.count ?? 0));

    return {
      sources,
      events24h,
      actionItems,
      pendingApprovals,
      leads24h,
    };
  }

  const verifyWebhookChallenge = async (
    pluginId: string,
    sourceId: string,
    input: { mode: string | null; token: string | null; challenge: string | null },
  ) => {
    const source = await getSourceById(sourceId);
    if (!source) throw notFound("External event source not found");
    const sourcePluginId = coerceSourcePluginId(source);
    if (sourcePluginId !== pluginId) throw badRequest("Webhook plugin does not match source configuration");
    if (source.status !== "active") throw forbidden("Source is paused");
    const plugin = getExternalIngestionPlugin(pluginId);
    if (!plugin.verifyChallenge) return { ok: false, challenge: null as string | null };
    const result = await plugin.verifyChallenge(toPluginSource(source), input, {
      resolveSecretRef: resolveSecret,
      fetchJson,
    });
    await updateSourceWebhookStatus(source.id, result.ok ? "challenge_verified" : "challenge_rejected");
    return result;
  };

  const ingestWebhook = async (
    pluginId: string,
    sourceId: string,
    input: {
      payload: Record<string, unknown>;
      headers: Record<string, string | string[] | undefined>;
      rawBody: Buffer;
    },
  ): Promise<WebhookIngestResult> => {
    const source = await getSourceById(sourceId);
    if (!source) throw notFound("External event source not found");
    const sourcePluginId = coerceSourcePluginId(source);
    if (sourcePluginId !== pluginId) throw badRequest("Webhook plugin does not match source configuration");
    if (source.status !== "active") {
      await updateSourceWebhookStatus(source.id, "rejected", "source_paused");
      throw forbidden("External source is paused");
    }

    const plugin = getExternalIngestionPlugin(pluginId);
    const normalizedHeaders = normalizeHeaders(input.headers);
    const deliveryResult = await plugin.verifyDelivery(
      toPluginSource(source),
      {
        payload: input.payload,
        headers: normalizedHeaders,
        rawBody: input.rawBody,
      },
      {
        resolveSecretRef: resolveSecret,
        fetchJson,
      },
    );
    if (!deliveryResult.ok) {
      await updateSourceWebhookStatus(source.id, "rejected", deliveryResult.reason ?? "delivery_invalid");
      throw forbidden("Invalid webhook delivery");
    }

    const extractedEvents = await plugin.extractEvents(toPluginSource(source), {
      payload: input.payload,
      headers: normalizedHeaders,
    });
    if (extractedEvents.length === 0) {
      await updateSourceWebhookStatus(source.id, "ignored", "ignored_non_matching_event");
      return { kind: "ignored", event: null, run: null };
    }

    let lastResult: WebhookIngestResult = { kind: "ignored", event: null, run: null };
    for (const extracted of extractedEvents) {
      lastResult = await persistEventAndRunWorkflow({
        source,
        plugin,
        extracted,
        headers: normalizedHeaders,
        rawBody: input.rawBody,
      });
    }
    return lastResult;
  };

  const verifyWebhookChallengeForCompany = async (
    pluginId: string,
    companyId: string,
    input: { mode: string | null; token: string | null; challenge: string | null },
  ) => {
    const source = await getSinglePluginSource(companyId, pluginId);
    if (!source) {
      throw notFound(`No ${pluginId} source is configured for this company`);
    }
    return verifyWebhookChallenge(pluginId, source.id, input);
  };

  const ingestWebhookForCompany = async (
    pluginId: string,
    companyId: string,
    input: {
      payload: Record<string, unknown>;
      headers: Record<string, string | string[] | undefined>;
      rawBody: Buffer;
    },
  ) => {
    const source = await getSinglePluginSource(companyId, pluginId);
    if (!source) {
      throw notFound(`No ${pluginId} source is configured for this company`);
    }
    return ingestWebhook(pluginId, source.id, input);
  };

  const listSources = async (
    companyId: string,
    filters?: { pluginId?: string; provider?: string; status?: string },
  ) => {
    const conditions = [eq(externalEventSources.companyId, companyId)];
    if (filters?.pluginId) conditions.push(eq(externalEventSources.pluginId, filters.pluginId));
    if (filters?.provider) conditions.push(eq(externalEventSources.provider, filters.provider));
    if (filters?.status) conditions.push(eq(externalEventSources.status, filters.status));
    return db
      .select()
      .from(externalEventSources)
      .where(and(...conditions))
      .orderBy(asc(externalEventSources.createdAt));
  };

  const createSource = async (companyId: string, input: CreateExternalEventSource) => {
    await assertReviewerAgent(companyId, input.reviewerAgentId);
    const pluginId = input.pluginId ?? parseLegacyProviderToPluginId(input.provider);
    const plugin = getExternalIngestionPlugin(pluginId);
    if (pluginId === META_LEADGEN_PLUGIN_ID || pluginId === META_WHATSAPP_PLUGIN_ID) {
      await assertOnePluginSourcePerCompany(companyId, pluginId);
    }
    const sourceConfigInput = asRecord(input.sourceConfig) ?? asRecord(input.verificationConfig) ?? {};
    const normalizedSourceConfigInput = await normalizeSourceConfigForPlugin(companyId, pluginId, sourceConfigInput);
    if (pluginId === META_LEADGEN_PLUGIN_ID && !toSecretRef(normalizedSourceConfigInput.pageAccessTokenSecret)) {
      throw unprocessable("Meta source requires pageAccessTokenSecret. Use the Meta connect endpoint.");
    }
    const sourceConfig = plugin.validateSourceConfig(normalizedSourceConfigInput);
    await assertSecretRefsInCompany(companyId, sourceConfig);

    const [created] = await db
      .insert(externalEventSources)
      .values({
        companyId,
        pluginId,
        pluginVersion: input.pluginVersion ?? plugin.metadata.version,
        sourceConfig,
        provider: deriveProviderFromPluginId(pluginId),
        name: input.name,
        status: input.status,
        reviewerAgentId: input.reviewerAgentId ?? null,
        rulesConfig: input.rulesConfig as unknown as Record<string, unknown>,
        llmReviewTemplate: input.llmReviewTemplate ?? null,
        verificationConfig: input.verificationConfig as unknown as Record<string, unknown>,
        metadata: input.metadata ?? null,
      })
      .returning();
    return created;
  };

  const updateSource = async (id: string, patch: UpdateExternalEventSource) => {
    const existing = await getSourceById(id);
    if (!existing) throw notFound("External event source not found");
    await assertReviewerAgent(existing.companyId, patch.reviewerAgentId ?? existing.reviewerAgentId);

    const pluginId = patch.pluginId ?? existing.pluginId ?? parseLegacyProviderToPluginId(existing.provider);
    const plugin = getExternalIngestionPlugin(pluginId);
    if (pluginId === META_LEADGEN_PLUGIN_ID || pluginId === META_WHATSAPP_PLUGIN_ID) {
      await assertOnePluginSourcePerCompany(existing.companyId, pluginId, existing.id);
    }
    const mergedSourceConfigInput =
      patch.sourceConfig !== undefined
        ? {
            ...(asRecord(existing.sourceConfig) ?? asRecord(existing.verificationConfig) ?? {}),
            ...(asRecord(patch.sourceConfig) ?? {}),
          }
        : asRecord(existing.sourceConfig) ?? asRecord(existing.verificationConfig) ?? {};
    const normalizedSourceConfigInput = await normalizeSourceConfigForPlugin(
      existing.companyId,
      pluginId,
      mergedSourceConfigInput,
    );
    if (pluginId === META_LEADGEN_PLUGIN_ID && !toSecretRef(normalizedSourceConfigInput.pageAccessTokenSecret)) {
      throw unprocessable("Meta source requires pageAccessTokenSecret. Reconnect Meta source.");
    }
    const sourceConfig = plugin.validateSourceConfig(normalizedSourceConfigInput);
    await assertSecretRefsInCompany(existing.companyId, sourceConfig);

    const [updated] = await db
      .update(externalEventSources)
      .set({
        pluginId,
        pluginVersion: patch.pluginVersion === undefined ? existing.pluginVersion : patch.pluginVersion,
        sourceConfig,
        provider: patch.provider ?? existing.provider ?? deriveProviderFromPluginId(pluginId),
        name: patch.name ?? existing.name,
        status: patch.status ?? existing.status,
        reviewerAgentId: patch.reviewerAgentId === undefined ? existing.reviewerAgentId : patch.reviewerAgentId,
        rulesConfig:
          patch.rulesConfig === undefined
            ? existing.rulesConfig
            : (patch.rulesConfig as unknown as Record<string, unknown>),
        llmReviewTemplate:
          patch.llmReviewTemplate === undefined ? existing.llmReviewTemplate : patch.llmReviewTemplate,
        verificationConfig:
          patch.verificationConfig === undefined
            ? existing.verificationConfig
            : (patch.verificationConfig as unknown as Record<string, unknown>),
        metadata: patch.metadata === undefined ? existing.metadata : patch.metadata,
        updatedAt: new Date(),
      })
      .where(eq(externalEventSources.id, id))
      .returning();
    return updated;
  };

  return {
    listPlugins: async () => listExternalIngestionPlugins(),

    getCompanyPluginConfig,

    upsertCompanyPluginConfig,

    getRequiredMetaRuntimeConfig,

    listMetaPages: async (
      companyId: string,
      input: MetaConnectPagesInput,
    ): Promise<ExternalMetaPageSummary[]> => {
      const pages = await fetchMetaPagesWithTokens(companyId, input.userAccessTokenSecretId);
      return pages.map((page) => ({
        id: page.id,
        name: page.name,
        category: page.category,
        tasks: page.tasks,
        hasManageLeads: page.tasks.includes("MANAGE_LEADS"),
      }));
    },

    listMetaLeadForms: async (
      companyId: string,
      input: MetaConnectFormsInput,
    ): Promise<ExternalMetaLeadFormSummary[]> => {
      const pages = await fetchMetaPagesWithTokens(companyId, input.userAccessTokenSecretId);
      const page = ensurePageAccess(pages, input.pageId);
      const body = await fetchMetaGraph(`v25.0/${encodeURIComponent(input.pageId)}/leadgen_forms`, {
        fields: "id,name,status,locale",
        access_token: page.accessToken!,
      });
      const rows = Array.isArray(body.data) ? body.data : [];
      const forms: ExternalMetaLeadFormSummary[] = [];
      for (const row of rows) {
        const record = asRecord(row);
        if (!record) continue;
        const id = readString(record.id);
        if (!id) continue;
        forms.push({
          id,
          name: readString(record.name) ?? id,
          status: readString(record.status) ?? "UNKNOWN",
          locale: readString(record.locale),
        });
      }
      return forms;
    },

    connectMetaLeadSource: async (
      companyId: string,
      input: MetaConnectSourceInput,
      actor?: { userId?: string | null; agentId?: string | null },
    ): Promise<ExternalMetaConnectResult> => {
      const metaRuntimeConfig = await getRequiredMetaRuntimeConfig(companyId);
      await assertSecretInCompany(companyId, input.userAccessTokenSecretId);
      await assertReviewerAgent(companyId, input.reviewerAgentId ?? null);

      const pages = await fetchMetaPagesWithTokens(companyId, input.userAccessTokenSecretId);
      const page = ensurePageAccess(pages, input.pageId);

      if (!page.tasks.includes("MANAGE_LEADS")) {
        throw unprocessable("Selected page is missing MANAGE_LEADS permission");
      }

      if (input.formId) {
        const forms = await fetchMetaGraph(`v25.0/${encodeURIComponent(input.pageId)}/leadgen_forms`, {
          fields: "id",
          access_token: page.accessToken!,
        });
        const rows = Array.isArray(forms.data) ? forms.data : [];
        const found = rows.some((row) => asRecord(row)?.id === input.formId);
        if (!found) {
          throw unprocessable("Selected lead form is not available for the selected page");
        }
      }

      await postMetaGraph(`v25.0/${encodeURIComponent(input.pageId)}/subscribed_apps`, {
        subscribed_fields: "leadgen",
        access_token: page.accessToken!,
      });

      const pageTokenSecretName = `meta page token ${input.pageId}`;
      const existingPageTokenSecret = await secretsSvc.getByName(companyId, pageTokenSecretName);
      const pageTokenSecret = existingPageTokenSecret
        ? await secretsSvc.rotate(existingPageTokenSecret.id, { value: page.accessToken! }, actor)
        : await secretsSvc.create(
            companyId,
            {
              name: pageTokenSecretName,
              provider: "local_encrypted",
              value: page.accessToken!,
              description: `Auto-managed Meta page access token for page ${input.pageId}`,
            },
            actor,
          );

      const sourceConfig = {
        verifyTokenSecret: {
          type: "secret_ref" as const,
          secretId: metaRuntimeConfig.verifyTokenSecret.secretId,
          version: "latest" as const,
        },
        appSecret: {
          type: "secret_ref" as const,
          secretId: metaRuntimeConfig.appSecretSecretRef.secretId,
          version: "latest" as const,
        },
        pageAccessTokenSecret: {
          type: "secret_ref" as const,
          secretId: pageTokenSecret.id,
          version: "latest" as const,
        },
        graphApiVersion: input.graphApiVersion ?? metaRuntimeConfig.graphApiVersion,
      };

      const metadata = {
        metaConnection: {
          pageId: input.pageId,
          pageName: page.name,
          formId: input.formId ?? null,
          connectedAt: new Date().toISOString(),
        },
      };

      let source;
      if (input.sourceId) {
        const sourceId = input.sourceId;
        const existingSource = await getSourceById(sourceId);
        if (!existingSource || existingSource.companyId !== companyId) {
          throw notFound("External event source not found");
        }
        if (coerceSourcePluginId(existingSource) !== META_LEADGEN_PLUGIN_ID) {
          throw unprocessable("Selected source must use the meta_leadgen plugin");
        }
        await assertOnePluginSourcePerCompany(companyId, META_LEADGEN_PLUGIN_ID, sourceId);
        source = await updateSource(sourceId, {
          pluginId: META_LEADGEN_PLUGIN_ID,
          name: input.sourceName,
          reviewerAgentId: input.reviewerAgentId ?? null,
          rulesConfig: input.rulesConfig,
          llmReviewTemplate: input.llmReviewTemplate ?? null,
          sourceConfig,
          metadata,
          status: existingSource.status === "paused" ? "paused" : "active",
        });
      } else {
        const existingMetaSource = await getSinglePluginSource(companyId, META_LEADGEN_PLUGIN_ID);
        if (existingMetaSource) {
          source = await updateSource(existingMetaSource.id, {
            pluginId: META_LEADGEN_PLUGIN_ID,
            name: input.sourceName,
            reviewerAgentId: input.reviewerAgentId ?? null,
            rulesConfig: input.rulesConfig,
            llmReviewTemplate: input.llmReviewTemplate ?? null,
            sourceConfig,
            metadata,
            status: existingMetaSource.status === "paused" ? "paused" : "active",
          });
        } else {
          source = await createSource(companyId, {
            pluginId: META_LEADGEN_PLUGIN_ID,
            name: input.sourceName,
            status: "active",
            reviewerAgentId: input.reviewerAgentId ?? null,
            rulesConfig: input.rulesConfig,
            llmReviewTemplate: input.llmReviewTemplate ?? null,
            sourceConfig,
            metadata,
          });
        }
      }
      const normalizedSource = source as unknown as ExternalMetaConnectResult["source"];

      return {
        source: normalizedSource,
        page: {
          id: page.id,
          name: page.name,
        },
        formId: input.formId ?? null,
        pageAccessTokenSecretId: pageTokenSecret.id,
      };
    },

    connectWhatsAppBusinessSource: async (
      companyId: string,
      input: WhatsAppConnectSourceInput,
      actor?: { userId?: string | null; agentId?: string | null },
      options?: ConnectWhatsAppBusinessSourceOptions,
    ): Promise<ExternalWhatsAppConnectResult> => {
      const rawApiKey = input.apiKey?.trim() ?? "";
      let apiKeySecretId = input.apiKeySecretId ?? null;
      if (rawApiKey) {
        if (apiKeySecretId) {
          await assertSecretInCompany(companyId, apiKeySecretId);
          const rotated = await secretsSvc.rotate(apiKeySecretId, { value: rawApiKey }, actor);
          apiKeySecretId = rotated.id;
        } else {
          const existingApiKey = await secretsSvc.getByName(companyId, WASENDER_API_KEY_SECRET_NAME);
          const rotatedOrCreated = existingApiKey
            ? await secretsSvc.rotate(existingApiKey.id, { value: rawApiKey }, actor)
            : await secretsSvc.create(
                companyId,
                {
                  name: WASENDER_API_KEY_SECRET_NAME,
                  provider: "local_encrypted",
                  value: rawApiKey,
                  description: "WaSender API key for WhatsApp source",
                },
                actor,
              );
          apiKeySecretId = rotatedOrCreated.id;
        }
      } else if (apiKeySecretId) {
        await assertSecretInCompany(companyId, apiKeySecretId);
      } else {
        const existingApiKey = await secretsSvc.getByName(companyId, WASENDER_API_KEY_SECRET_NAME);
        if (!existingApiKey) {
          throw unprocessable(
            "WaSender token not found. Log in to WaSender, generate a Personal Access Token, and save it as company secret `wasender api key`.",
          );
        }
        apiKeySecretId = existingApiKey.id;
      }
      if (!apiKeySecretId) {
        throw unprocessable("WaSender API key secret could not be resolved");
      }
      await assertReviewerAgent(companyId, input.reviewerAgentId ?? null);

      const normalizedBaseUrl = (input.baseUrl ?? DEFAULT_WASENDER_BASE_URL).trim().replace(/\/+$/, "");
      const publicBaseUrl = (options?.publicBaseUrl ?? process.env.SUMMUN_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
      if (!publicBaseUrl) {
        throw unprocessable(
          "Public base URL is required to auto-configure WaSender webhook. Set SUMMUN_PUBLIC_BASE_URL or run behind a forwarded host/protocol.",
        );
      }
      const webhookUrl = `${publicBaseUrl}/api/webhooks/${META_WHATSAPP_PLUGIN_ID}/company/${companyId}`;
      const webhookSecret = (input.webhookSecret?.trim() ?? "") || randomBytes(24).toString("hex");
      const waSenderToken = await resolveSecretById(companyId, apiKeySecretId);

      let resolvedSessionId = input.sessionId?.trim() ?? "";
      if (!resolvedSessionId) {
        const sessionsPayload = await requestWaSender(normalizedBaseUrl, waSenderToken, "/api/whatsapp-sessions", {
          method: "GET",
        });
        const sessionRows = Array.isArray(sessionsPayload) ? sessionsPayload : [];
        const sessionRecords = sessionRows
          .map((row) => asRecord(row))
          .filter((row): row is Record<string, unknown> => row !== null);
        const preferredSession =
          sessionRecords.find((row) => isWaSenderSessionConnected(readString(row.status))) ??
          sessionRecords[0] ??
          null;
        resolvedSessionId = preferredSession ? readWaSenderSessionId(preferredSession.id) ?? "" : "";
      }
      if (!resolvedSessionId) {
        throw unprocessable(
          "No WaSender session found for this API token. Create a session in WaSender, then reconnect.",
        );
      }

      await requestWaSender(
        normalizedBaseUrl,
        waSenderToken,
        `/api/whatsapp-sessions/${encodeURIComponent(resolvedSessionId)}`,
        {
          method: "PUT",
          body: {
            webhook_url: webhookUrl,
            webhook_enabled: true,
            webhook_events: [...DEFAULT_WASENDER_WEBHOOK_EVENTS],
            webhook_secret: webhookSecret,
          },
        },
      );

      try {
        await requestWaSender(
          normalizedBaseUrl,
          waSenderToken,
          `/api/whatsapp-sessions/${encodeURIComponent(resolvedSessionId)}/connect`,
          { method: "POST" },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : "";
        const alreadyConnected = message.includes("already") && message.includes("connect");
        if (!alreadyConnected) throw err;
      }

      const sessionDetailsPayload = await requestWaSender(
        normalizedBaseUrl,
        waSenderToken,
        `/api/whatsapp-sessions/${encodeURIComponent(resolvedSessionId)}`,
        { method: "GET" },
      );
      const sessionDetails = asRecord(sessionDetailsPayload) ?? {};
      const sessionStatus = readString(sessionDetails.status);
      const sessionIdFromDetails = readWaSenderSessionId(sessionDetails.id);
      if (sessionIdFromDetails) {
        resolvedSessionId = sessionIdFromDetails;
      }

      let qrCode: string | null = null;
      if (!isWaSenderSessionConnected(sessionStatus)) {
        try {
          const qrPayload = await requestWaSender(
            normalizedBaseUrl,
            waSenderToken,
            `/api/whatsapp-sessions/${encodeURIComponent(resolvedSessionId)}/qrcode`,
            { method: "GET" },
          );
          const qrRecord = asRecord(qrPayload);
          qrCode = readString(qrRecord?.qrCode) ?? readString(qrRecord?.qr_code);
        } catch (err) {
          logger.warn(
            { err, companyId, sessionId: resolvedSessionId },
            "failed to fetch wasender qr code; continuing with configured source",
          );
        }
      }

      const sourceConfig = {
        apiKeySecret: {
          type: "secret_ref" as const,
          secretId: apiKeySecretId,
          version: "latest" as const,
        },
        sessionId: resolvedSessionId,
        webhookSecret,
        baseUrl: normalizedBaseUrl,
      };

      const metadata = {
        whatsappConnection: {
          provider: "wasender",
          sessionId: resolvedSessionId,
          sessionStatus,
          webhookUrl,
          webhookSecretConfigured: true,
          baseUrl: normalizedBaseUrl,
          qrCodeAvailable: Boolean(qrCode),
          connectedAt: new Date().toISOString(),
        },
      };

      let source;
      if (input.sourceId) {
        const sourceId = input.sourceId;
        const existingSource = await getSourceById(sourceId);
        if (!existingSource || existingSource.companyId !== companyId) {
          throw notFound("External event source not found");
        }
        if (coerceSourcePluginId(existingSource) !== META_WHATSAPP_PLUGIN_ID) {
          throw unprocessable("Selected source must use the meta_whatsapp_business plugin");
        }
        await assertOnePluginSourcePerCompany(companyId, META_WHATSAPP_PLUGIN_ID, sourceId);
        source = await updateSource(sourceId, {
          pluginId: META_WHATSAPP_PLUGIN_ID,
          name: input.sourceName,
          reviewerAgentId: input.reviewerAgentId ?? null,
          rulesConfig: input.rulesConfig,
          llmReviewTemplate: input.llmReviewTemplate ?? null,
          sourceConfig,
          metadata,
          status: existingSource.status === "paused" ? "paused" : "active",
        });
      } else {
        const existingSource = await getSinglePluginSource(companyId, META_WHATSAPP_PLUGIN_ID);
        if (existingSource) {
          source = await updateSource(existingSource.id, {
            pluginId: META_WHATSAPP_PLUGIN_ID,
            name: input.sourceName,
            reviewerAgentId: input.reviewerAgentId ?? null,
            rulesConfig: input.rulesConfig,
            llmReviewTemplate: input.llmReviewTemplate ?? null,
            sourceConfig,
            metadata,
            status: existingSource.status === "paused" ? "paused" : "active",
          });
        } else {
          source = await createSource(companyId, {
            pluginId: META_WHATSAPP_PLUGIN_ID,
            name: input.sourceName,
            status: "active",
            reviewerAgentId: input.reviewerAgentId ?? null,
            rulesConfig: input.rulesConfig,
            llmReviewTemplate: input.llmReviewTemplate ?? null,
            sourceConfig,
            metadata,
          });
        }
      }

      return {
        source: source as unknown as ExternalWhatsAppConnectResult["source"],
        apiKeySecretId,
        sessionId: resolvedSessionId,
        sessionStatus,
        baseUrl: normalizedBaseUrl,
        webhookUrl,
        webhookSecretConfigured: true,
        qrCode,
      };
    },

    listSources,

    getSourceById,

    createSource,

    updateSource,

    deleteSource: async (id: string) => {
      const existing = await getSourceById(id);
      if (!existing) return null;
      await db.delete(externalEventSources).where(eq(externalEventSources.id, id));
      return existing;
    },

    setSourceStatus: async (id: string, status: "active" | "paused") => {
      const [updated] = await db
        .update(externalEventSources)
        .set({ status, updatedAt: new Date() })
        .where(eq(externalEventSources.id, id))
        .returning();
      if (!updated) throw notFound("External event source not found");
      return updated;
    },

    verifyWebhookChallenge,

    verifyWebhookChallengeForCompany,

    // Backward-compatible alias for previous meta-specific route.
    verifyMetaWebhookChallenge: async (
      sourceId: string,
      input: { mode: string | null; token: string | null; challenge: string | null },
    ) => {
      return verifyWebhookChallenge(META_LEADGEN_PLUGIN_ID, sourceId, input);
    },

    ingestWebhook,

    ingestWebhookForCompany,

    // Backward-compatible alias for previous meta-specific route.
    ingestMetaWebhook: async (
      sourceId: string,
      input: {
        payload: Record<string, unknown>;
        headers: Record<string, string | string[] | undefined>;
        rawBody: Buffer;
      },
    ): Promise<WebhookIngestResult> => {
      return ingestWebhook(META_LEADGEN_PLUGIN_ID, sourceId, input);
    },

    reprocess: async (companyId: string, input: ReprocessExternalEventInput) => {
      let event: ExternalEventRow | null = null;
      if (input.eventId) {
        event = await findEventById(input.eventId);
      } else if (input.leadgenId) {
        const lead = await db
          .select()
          .from(externalLeads)
          .where(
            and(
              eq(externalLeads.companyId, companyId),
              eq(externalLeads.leadgenId, input.leadgenId),
              input.sourceId ? eq(externalLeads.sourceId, input.sourceId) : sql`true`,
            ),
          )
          .orderBy(desc(externalLeads.updatedAt))
          .then((rows) => rows[0] ?? null);
        if (lead) {
          event = await findEventById(lead.eventId);
        }
      }
      if (!event || event.companyId !== companyId) {
        throw notFound("External event not found for replay");
      }
      const engine = selectWorkflowEngine();
      return engine.processEvent(event.id, { force: input.force ?? true });
    },

    getOpsSummary,

    getOpsSnapshot: async (companyId: string, limit = 20): Promise<ExternalOpsSnapshot> => {
      const summary = await getOpsSummary(companyId);
      const boundedLimit = Math.max(1, Math.min(limit, 100));
      const recentEvents = await db
        .select({
          id: externalEvents.id,
          sourceId: externalEvents.sourceId,
          sourceName: externalEventSources.name,
          status: externalEvents.status,
          providerEventId: externalEvents.providerEventId,
          receivedAt: externalEvents.receivedAt,
          processedAt: externalEvents.processedAt,
          rejectionReason: externalEvents.rejectionReason,
        })
        .from(externalEvents)
        .innerJoin(externalEventSources, eq(externalEvents.sourceId, externalEventSources.id))
        .where(eq(externalEvents.companyId, companyId))
        .orderBy(desc(externalEvents.receivedAt))
        .limit(boundedLimit);

      const recentActionItems = await db
        .select({
          id: externalActionItems.id,
          sourceId: externalActionItems.sourceId,
          sourceName: externalEventSources.name,
          issueId: externalActionItems.issueId,
          approvalId: externalActionItems.approvalId,
          status: externalActionItems.status,
          title: externalActionItems.title,
          priority: externalActionItems.priority,
          approvalStatus: approvals.status,
          createdAt: externalActionItems.createdAt,
          updatedAt: externalActionItems.updatedAt,
        })
        .from(externalActionItems)
        .innerJoin(externalEventSources, eq(externalActionItems.sourceId, externalEventSources.id))
        .leftJoin(approvals, eq(externalActionItems.approvalId, approvals.id))
        .where(eq(externalActionItems.companyId, companyId))
        .orderBy(desc(externalActionItems.createdAt))
        .limit(boundedLimit);

      const recentLeads = await db
        .select({
          id: externalLeads.id,
          companyId: externalLeads.companyId,
          sourceId: externalLeads.sourceId,
          sourceName: externalEventSources.name,
          eventId: externalLeads.eventId,
          workflowRunId: externalLeads.workflowRunId,
          leadgenId: externalLeads.leadgenId,
          pageId: externalLeads.pageId,
          formId: externalLeads.formId,
          adId: externalLeads.adId,
          adgroupId: externalLeads.adgroupId,
          campaignId: externalLeads.campaignId,
          createdTime: externalLeads.createdTime,
          status: externalLeads.status,
          error: externalLeads.error,
          fieldData: externalLeads.fieldData,
          rawPayload: externalLeads.rawPayload,
          createdAt: externalLeads.createdAt,
          updatedAt: externalLeads.updatedAt,
        })
        .from(externalLeads)
        .innerJoin(externalEventSources, eq(externalLeads.sourceId, externalEventSources.id))
        .where(eq(externalLeads.companyId, companyId))
        .orderBy(desc(externalLeads.createdAt))
        .limit(boundedLimit);

      return {
        summary,
        recentEvents: recentEvents.map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          status: row.status as ExternalOpsSnapshot["recentEvents"][number]["status"],
          providerEventId: row.providerEventId,
          receivedAt: row.receivedAt.toISOString(),
          processedAt: row.processedAt?.toISOString() ?? null,
          rejectionReason: row.rejectionReason,
        })),
        recentActionItems: recentActionItems.map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          issueId: row.issueId,
          approvalId: row.approvalId,
          status: row.status as ExternalOpsSnapshot["recentActionItems"][number]["status"],
          title: row.title,
          priority: row.priority as ExternalOpsSnapshot["recentActionItems"][number]["priority"],
          approvalStatus: (row.approvalStatus ?? null) as ExternalOpsSnapshot["recentActionItems"][number]["approvalStatus"],
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        recentLeads: recentLeads.map((row) => ({
          id: row.id,
          companyId: row.companyId,
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          eventId: row.eventId,
          workflowRunId: row.workflowRunId,
          leadgenId: row.leadgenId,
          pageId: row.pageId,
          formId: row.formId,
          adId: row.adId,
          adgroupId: row.adgroupId,
          campaignId: row.campaignId,
          createdTime: row.createdTime?.toISOString() ?? null,
          status: row.status as "received" | "enriched" | "failed",
          error: row.error,
          fieldData: (asRecord(row.fieldData) ?? {}) as Record<string, unknown>,
          rawPayload: (asRecord(row.rawPayload) ?? {}) as Record<string, unknown>,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    },

    requestApprovalForActionItem: async (
      actionItemId: string,
      actor: { actorType: "agent" | "user"; actorId: string; agentId: string | null; companyId?: string | null },
      payload: RequestActionItemApproval,
    ) => {
      const actionItem = await db
        .select()
        .from(externalActionItems)
        .where(eq(externalActionItems.id, actionItemId))
        .then((rows) => rows[0] ?? null);
      if (!actionItem) throw notFound("External action item not found");
      if (actor.companyId && actor.companyId !== actionItem.companyId) {
        throw forbidden("Cross-company access is not allowed");
      }
      if (actor.actorType !== "agent" || !actor.agentId) {
        throw forbidden("Only agents can request action-item approvals");
      }
      if (actionItem.reviewerAgentId && actionItem.reviewerAgentId !== actor.agentId) {
        throw forbidden("Only the configured reviewer agent can request approval");
      }
      const [approval] = await db
        .insert(approvals)
        .values({
          companyId: actionItem.companyId,
          type: "approve_action_item",
          requestedByAgentId: actor.agentId,
          requestedByUserId: null,
          status: "pending",
          payload: {
            actionItemId: actionItem.id,
            issueId: actionItem.issueId,
            summary: payload.summary ?? null,
            recommendation: payload.recommendation ?? null,
            confidence: payload.confidence ?? null,
          },
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          updatedAt: new Date(),
        })
        .returning();

      if (actionItem.issueId) {
        await issueApprovalsSvc.link(actionItem.issueId, approval.id, { agentId: actor.agentId, userId: null });
      }

      await markActionItemFromApproval(approval, "created");

      await logActivity(db, {
        companyId: actionItem.companyId,
        actorType: "agent",
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "external_action_item.approval_requested",
        entityType: "external_action_item",
        entityId: actionItem.id,
        details: {
          approvalId: approval.id,
          issueId: actionItem.issueId,
        },
      });

      return { actionItemId: actionItem.id, approval };
    },

    getActionItemById: async (id: string) =>
      db
        .select()
        .from(externalActionItems)
        .where(eq(externalActionItems.id, id))
        .then((rows) => rows[0] ?? null),

    markActionItemApprovalRequested: (approval: ApprovalRow) => markActionItemFromApproval(approval, "created"),

    syncActionItemFromApprovalResolution: (approval: ApprovalRow) => markActionItemFromApproval(approval, "resolved"),

    syncActionItemFromRevisionRequest: (approval: ApprovalRow) => markActionItemFromApproval(approval, "revision_requested"),

    syncActionItemFromResubmission: (approval: ApprovalRow) => markActionItemFromApproval(approval, "resubmitted"),
  };
}
