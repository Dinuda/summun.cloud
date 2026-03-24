import { z } from "zod";

export const KNOWLEDGE_KIND_VALUES = [
  "agent_outcome",
  "agent_reasoning",
  "decision_rationale",
  "issue_analysis",
  "external_insight",
  "lead_intelligence",
  "project_context",
  "manual_note",
  "troubleshooting",
] as const;

export const createKnowledgeEntrySchema = z.object({
  title: z.string().min(1).max(500),
  summary: z.string().max(1000).optional().nullable(),
  body: z.string().min(1),
  scope: z.enum(["project", "org"]).optional().default("project"),
  tags: z.array(z.string()).max(10).optional().default([]),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  quality: z.enum(["high", "medium", "low", "auto"]).optional().default("medium"),
});

export type CreateKnowledgeEntry = z.infer<typeof createKnowledgeEntrySchema>;

export const updateKnowledgeEntrySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  summary: z.string().max(1000).optional().nullable(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).max(10).optional(),
  quality: z.enum(["high", "medium", "low", "auto"]).optional(),
});

export type UpdateKnowledgeEntry = z.infer<typeof updateKnowledgeEntrySchema>;

export const knowledgeSearchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  scope: z.enum(["project", "org"]).optional(),
  kind: z.string().optional(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type KnowledgeSearchQuery = z.infer<typeof knowledgeSearchQuerySchema>;
