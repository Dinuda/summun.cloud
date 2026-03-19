import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { externalEventSources } from "./external_event_sources.js";

export const externalEvents = pgTable(
  "external_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sourceId: uuid("source_id").notNull().references(() => externalEventSources.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    deliveryAttempt: integer("delivery_attempt").notNull().default(1),
    status: text("status").notNull().default("received"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    headers: jsonb("headers").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceIdempotencyIdx: uniqueIndex("external_events_source_idempotency_idx").on(
      table.sourceId,
      table.idempotencyKey,
    ),
    companySourceReceivedIdx: index("external_events_company_source_received_idx").on(
      table.companyId,
      table.sourceId,
      table.receivedAt,
    ),
    companyStatusReceivedIdx: index("external_events_company_status_received_idx").on(
      table.companyId,
      table.status,
      table.receivedAt,
    ),
  }),
);
