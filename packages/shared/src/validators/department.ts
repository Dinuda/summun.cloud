import { z } from "zod";

export const DEPARTMENT_TEMPLATE_TYPES = [
  "sales",
  "support",
  "engineering",
  "marketing",
  "operations",
  "custom",
] as const;
export type DepartmentTemplateType = (typeof DEPARTMENT_TEMPLATE_TYPES)[number];

export const DEPARTMENT_MEMBER_ROLES = ["head", "member"] as const;
export type DepartmentMemberRole = (typeof DEPARTMENT_MEMBER_ROLES)[number];

export const createDepartmentSchema = z.object({
  name: z.string().min(1, "Department name is required").max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens")
    .optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().optional().default("building2"),
  color: z.string().optional().default("#6366f1"),
  headAgentId: z.string().uuid().optional().nullable(),
  templateType: z.enum(DEPARTMENT_TEMPLATE_TYPES).optional().default("custom"),
  budgetMonthlyCents: z.number().int().min(0).optional().default(0),
  settings: z.record(z.unknown()).optional().default({}),
});

export type CreateDepartment = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().optional(),
  color: z.string().optional(),
  headAgentId: z.string().uuid().optional().nullable(),
  budgetMonthlyCents: z.number().int().min(0).optional(),
  settings: z.record(z.unknown()).optional(),
});

export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;

export const addDepartmentMemberSchema = z.object({
  agentId: z.string().uuid(),
  role: z.enum(DEPARTMENT_MEMBER_ROLES).optional().default("member"),
});

export type AddDepartmentMember = z.infer<typeof addDepartmentMemberSchema>;

export const updateDepartmentMemberSchema = z.object({
  role: z.enum(DEPARTMENT_MEMBER_ROLES),
});

export type UpdateDepartmentMember = z.infer<typeof updateDepartmentMemberSchema>;
