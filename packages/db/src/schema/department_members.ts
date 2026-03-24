import { index, pgTable, text, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";
import { departments } from "./departments.js";
import { agents } from "./agents.js";

export const departmentMembers = pgTable(
  "department_members",
  {
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.departmentId, table.agentId] }),
    agentIdx: index("department_members_agent_idx").on(table.agentId),
  }),
);
