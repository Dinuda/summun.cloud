export const KNOWLEDGE_SCOPES = ["project", "org"] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

export const KNOWLEDGE_KINDS = [
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
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_QUALITIES = ["high", "medium", "low", "auto"] as const;
export type KnowledgeQuality = (typeof KNOWLEDGE_QUALITIES)[number];

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  agent_outcome: "Agent Outcome",
  agent_reasoning: "Agent Reasoning",
  decision_rationale: "Decision",
  issue_analysis: "Issue Analysis",
  external_insight: "External Insight",
  lead_intelligence: "Lead Intelligence",
  project_context: "Project Context",
  manual_note: "Manual Note",
  troubleshooting: "Troubleshooting",
};

export const KNOWLEDGE_KIND_COLORS: Record<KnowledgeKind, string> = {
  agent_outcome: "#10b981",
  agent_reasoning: "#8b5cf6",
  decision_rationale: "#f59e0b",
  issue_analysis: "#6366f1",
  external_insight: "#ec4899",
  lead_intelligence: "#14b8a6",
  project_context: "#3b82f6",
  manual_note: "#64748b",
  troubleshooting: "#ef4444",
};
