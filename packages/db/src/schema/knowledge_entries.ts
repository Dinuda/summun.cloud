import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";

export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    scope: text("scope").notNull().default("project"),
    kind: text("kind").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    sourceType: text("source_type").notNull().default("auto_ingest"),
    sourceEntity: text("source_entity"),
    sourceEntityId: text("source_entity_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    contentHash: text("content_hash").notNull(),
    quality: text("quality").notNull().default("auto"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyScopeKindIdx: index("knowledge_entries_company_scope_kind_idx").on(
      table.companyId, table.scope, table.kind,
    ),
    companyProjectIdx: index("knowledge_entries_company_project_idx").on(
      table.companyId, table.projectId,
    ),
    companyCreatedIdx: index("knowledge_entries_company_created_idx").on(
      table.companyId, table.createdAt,
    ),
    dedupIdx: uniqueIndex("knowledge_entries_dedup_idx").on(
      table.companyId, table.sourceEntity, table.sourceEntityId,
    ),
    contentHashIdx: index("knowledge_entries_content_hash_idx").on(
      table.companyId, table.contentHash,
    ),
  }),
);

export const knowledgeIngestionCursors = pgTable(
  "knowledge_ingestion_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    sourceTable: text("source_table").notNull(),
    lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }).notNull().defaultNow(),
    lastSourceId: text("last_source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySourceIdx: uniqueIndex("knowledge_ingestion_cursors_company_source_idx").on(
      table.companyId, table.sourceTable,
    ),
  }),
);
