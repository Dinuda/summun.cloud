import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { externalEventSources } from "./external_event_sources.js";
import { externalEvents } from "./external_events.js";
import { externalWorkflowRuns } from "./external_workflow_runs.js";

export const externalLeads = pgTable(
  "external_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sourceId: uuid("source_id").notNull().references(() => externalEventSources.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => externalEvents.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").references(() => externalWorkflowRuns.id, { onDelete: "set null" }),
    leadgenId: text("leadgen_id").notNull(),
    pageId: text("page_id"),
    formId: text("form_id"),
    adId: text("ad_id"),
    adgroupId: text("adgroup_id"),
    campaignId: text("campaign_id"),
    createdTime: timestamp("created_time", { withTimezone: true }),
    status: text("status").notNull().default("received"),
    error: text("error"),
    fieldData: jsonb("field_data").$type<Record<string, unknown>>().notNull().default({}),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceLeadgenUq: uniqueIndex("external_leads_source_leadgen_uq").on(table.sourceId, table.leadgenId),
    companyStatusCreatedIdx: index("external_leads_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
    companySourceCreatedIdx: index("external_leads_company_source_created_idx").on(
      table.companyId,
      table.sourceId,
      table.createdAt,
    ),
  }),
);
