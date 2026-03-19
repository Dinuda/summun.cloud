import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const externalEventSources = pgTable(
  "external_event_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    pluginId: text("plugin_id").notNull().default("meta_leadgen"),
    pluginVersion: text("plugin_version"),
    sourceConfig: jsonb("source_config").$type<Record<string, unknown>>().notNull().default({}),
    // Deprecated legacy field retained for backward compatibility.
    provider: text("provider").notNull().default("meta_ads"),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    reviewerAgentId: uuid("reviewer_agent_id").references(() => agents.id, { onDelete: "set null" }),
    rulesConfig: jsonb("rules_config").$type<Record<string, unknown>>().notNull().default({}),
    llmReviewTemplate: text("llm_review_template"),
    verificationConfig: jsonb("verification_config").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    lastWebhookStatus: text("last_webhook_status"),
    lastWebhookError: text("last_webhook_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProviderStatusIdx: index("external_event_sources_company_provider_status_idx").on(
      table.companyId,
      table.provider,
      table.status,
    ),
    companyPluginStatusIdx: index("external_event_sources_company_plugin_status_idx").on(
      table.companyId,
      table.pluginId,
      table.status,
    ),
    companyUpdatedIdx: index("external_event_sources_company_updated_idx").on(
      table.companyId,
      table.updatedAt,
    ),
  }),
);
