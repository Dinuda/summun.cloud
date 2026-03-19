import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyExternalPluginConfigs = pgTable(
  "company_external_plugin_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    pluginId: text("plugin_id").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPluginUq: uniqueIndex("company_external_plugin_configs_company_plugin_uq").on(
      table.companyId,
      table.pluginId,
    ),
    companyIdx: index("company_external_plugin_configs_company_idx").on(table.companyId),
    companyUpdatedIdx: index("company_external_plugin_configs_company_updated_idx").on(
      table.companyId,
      table.updatedAt,
    ),
  }),
);
