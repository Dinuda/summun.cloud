import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon").default("building2"),
    color: text("color").default("#6366f1"),
    headAgentId: uuid("head_agent_id").references(() => agents.id, { onDelete: "set null" }),
    templateType: text("template_type").notNull().default("custom"),
    budgetMonthlyCents: jsonb("budget_monthly_cents").$type<number>().default(0),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugIdx: index("departments_company_slug_idx").on(table.companyId, table.slug),
    companyCreatedIdx: index("departments_company_created_idx").on(table.companyId, table.createdAt),
  }),
);
