import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { externalEvents } from "./external_events.js";
import { externalEventSources } from "./external_event_sources.js";

export const externalWorkflowRuns = pgTable(
  "external_workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sourceId: uuid("source_id").notNull().references(() => externalEventSources.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => externalEvents.id, { onDelete: "cascade" }),
    workflowType: text("workflow_type").notNull().default("process_external_event"),
    engine: text("engine").notNull().default("inline"),
    status: text("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    context: jsonb("context").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventAttemptIdx: uniqueIndex("external_workflow_runs_event_attempt_idx").on(
      table.eventId,
      table.attempt,
    ),
    companyStatusCreatedIdx: index("external_workflow_runs_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
    companySourceCreatedIdx: index("external_workflow_runs_company_source_created_idx").on(
      table.companyId,
      table.sourceId,
      table.createdAt,
    ),
  }),
);
