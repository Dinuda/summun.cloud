import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { approvals } from "./approvals.js";
import { issues } from "./issues.js";
import { externalEventSources } from "./external_event_sources.js";
import { externalEvents } from "./external_events.js";
import { externalWorkflowRuns } from "./external_workflow_runs.js";

export const externalActionItems = pgTable(
  "external_action_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sourceId: uuid("source_id").notNull().references(() => externalEventSources.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => externalEvents.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => externalWorkflowRuns.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    reviewerAgentId: uuid("reviewer_agent_id").references(() => agents.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("pending_review"),
    dedupeKey: text("dedupe_key").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    recommendation: jsonb("recommendation").$type<Record<string, unknown>>(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySourceDedupeIdx: uniqueIndex("external_action_items_company_source_dedupe_idx").on(
      table.companyId,
      table.sourceId,
      table.dedupeKey,
    ),
    companyStatusCreatedIdx: index("external_action_items_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
    companyReviewerStatusIdx: index("external_action_items_company_reviewer_status_idx").on(
      table.companyId,
      table.reviewerAgentId,
      table.status,
    ),
  }),
);
