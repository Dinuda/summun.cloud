import type {
  ApprovalStatus,
  ExternalActionItemStatus,
  ExternalEventStatus,
  ExternalPluginId,
  ExternalSourceProvider,
  ExternalSourceStatus,
  ExternalWorkflowEngine,
  ExternalWorkflowRunStatus,
  IssuePriority,
} from "../constants.js";

export interface ExternalSecretRef {
  type: "secret_ref";
  secretId: string;
  version?: number | "latest";
}

export interface ExternalRule {
  id?: string | null;
  metric: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
  threshold: number;
  title: string;
  description?: string | null;
  priority?: IssuePriority;
}

export interface ExternalRulesConfig {
  mode: "any" | "all";
  rules: ExternalRule[];
}

export interface ExternalVerificationConfig {
  verifyTokenSecret?: ExternalSecretRef | null;
  appSecret?: ExternalSecretRef | null;
  pageAccessTokenSecret?: ExternalSecretRef | null;
  challengeParam?: string | null;
  graphApiVersion?: string | null;
}

export interface ExternalEventSource {
  id: string;
  companyId: string;
  pluginId: string;
  pluginVersion: string | null;
  sourceConfig: Record<string, unknown>;
  // Deprecated legacy field retained for backward compatibility.
  provider: ExternalSourceProvider;
  name: string;
  status: ExternalSourceStatus;
  reviewerAgentId: string | null;
  rulesConfig: ExternalRulesConfig;
  llmReviewTemplate: string | null;
  verificationConfig: ExternalVerificationConfig;
  metadata: Record<string, unknown> | null;
  lastWebhookAt: Date | null;
  lastWebhookStatus: string | null;
  lastWebhookError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ExternalPluginConfigFieldType = "string" | "number" | "boolean" | "secret_ref" | "json";

export interface ExternalPluginConfigField {
  key: string;
  label: string;
  type: ExternalPluginConfigFieldType;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface ExternalPluginMetadata {
  pluginId: ExternalPluginId | string;
  name: string;
  version: string;
  description: string;
  capabilities: {
    webhookChallenge: boolean;
    signatureVerification: boolean;
    enrichment: boolean;
  };
  sourceConfigFields: ExternalPluginConfigField[];
  companyConfigFields?: ExternalPluginConfigField[];
}

export interface CompanyExternalPluginConfig {
  id: string;
  companyId: string;
  pluginId: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetaLeadgenCompanyPluginConfig {
  metaAppId: string;
  appSecret: ExternalSecretRef;
  verifyTokenSecret: ExternalSecretRef;
  graphApiVersion?: string;
}

export interface ExternalEvent {
  id: string;
  companyId: string;
  sourceId: string;
  providerEventId: string | null;
  idempotencyKey: string;
  deliveryAttempt: number;
  status: ExternalEventStatus;
  payload: Record<string, unknown>;
  headers: Record<string, unknown> | null;
  receivedAt: Date;
  processedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalWorkflowRun {
  id: string;
  companyId: string;
  sourceId: string;
  eventId: string;
  workflowType: string;
  engine: ExternalWorkflowEngine;
  status: ExternalWorkflowRunStatus;
  attempt: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  context: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalActionItem {
  id: string;
  companyId: string;
  sourceId: string;
  eventId: string;
  workflowRunId: string;
  issueId: string | null;
  approvalId: string | null;
  reviewerAgentId: string | null;
  title: string;
  description: string | null;
  priority: IssuePriority;
  status: ExternalActionItemStatus;
  dedupeKey: string;
  evidence: Record<string, unknown> | null;
  recommendation: Record<string, unknown> | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalOpsSummary {
  sources: {
    total: number;
    active: number;
    paused: number;
    failures: number;
    lastWebhookAt: string | null;
  };
  events24h: {
    received: number;
    processed: number;
    rejected: number;
    duplicate: number;
    failed: number;
  };
  actionItems: {
    pendingReview: number;
    pendingApproval: number;
    approved: number;
    rejected: number;
    cancelled: number;
  };
  pendingApprovals: number;
  leads24h?: {
    received: number;
    enriched: number;
    failed: number;
  };
}

export interface ExternalOpsRecentEvent {
  id: string;
  sourceId: string;
  sourceName: string;
  status: ExternalEventStatus;
  providerEventId: string | null;
  receivedAt: string;
  processedAt: string | null;
  rejectionReason: string | null;
}

export interface ExternalOpsRecentActionItem {
  id: string;
  sourceId: string;
  sourceName: string;
  issueId: string | null;
  approvalId: string | null;
  status: ExternalActionItemStatus;
  title: string;
  priority: IssuePriority;
  approvalStatus: ApprovalStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalOpsSnapshot {
  summary: ExternalOpsSummary;
  recentEvents: ExternalOpsRecentEvent[];
  recentActionItems: ExternalOpsRecentActionItem[];
  recentLeads?: ExternalLeadRecord[];
}

export interface ExternalLeadRecord {
  id: string;
  companyId: string;
  sourceId: string;
  sourceName?: string;
  eventId: string;
  workflowRunId: string | null;
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  adId: string | null;
  adgroupId: string | null;
  campaignId: string | null;
  createdTime: string | null;
  status: "received" | "enriched" | "failed";
  error: string | null;
  fieldData: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalMetaPageSummary {
  id: string;
  name: string;
  category: string | null;
  tasks: string[];
  hasManageLeads: boolean;
}

export interface ExternalMetaLeadFormSummary {
  id: string;
  name: string;
  status: string;
  locale: string | null;
}

export interface ExternalMetaConnectResult {
  source: ExternalEventSource;
  page: {
    id: string;
    name: string;
  };
  formId: string | null;
  pageAccessTokenSecretId: string;
}

export interface ExternalMetaOauthStartResult {
  authorizeUrl: string;
}

export interface ExternalWhatsAppConnectResult {
  source: ExternalEventSource;
  apiKeySecretId: string;
  sessionId: string;
  sessionStatus: string | null;
  baseUrl: string;
  webhookUrl: string;
  webhookSecretConfigured: boolean;
  qrCode: string | null;
}
