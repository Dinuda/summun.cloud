import type { KnowledgeScope, KnowledgeKind, KnowledgeQuality } from "../constants/knowledge.js";

export interface KnowledgeEntry {
  id: string;
  companyId: string;
  projectId: string | null;
  goalId: string | null;
  title: string;
  summary: string | null;
  body: string;
  scope: KnowledgeScope;
  kind: KnowledgeKind;
  tags: string[];
  sourceType: "auto_ingest" | "manual";
  sourceEntity: string | null;
  sourceEntityId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  contentHash: string;
  quality: KnowledgeQuality;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchHit {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  scope: string;
  kind: string;
  tags: string[];
  sourceType: string;
  sourceEntity: string | null;
  projectId: string | null;
  createdByAgentId: string | null;
  createdAt: string;
  rank: number;
  snippet: string;
}

export interface KnowledgeSearchResult {
  entries: KnowledgeSearchHit[];
  total: number;
}

export interface KnowledgeIngestionStats {
  totalEntries: number;
  byKind: Record<string, number>;
  byScope: Record<string, number>;
  lastIngestedAt: string | null;
  cursors: Array<{ source: string; lastIngestedAt: string }>;
}

export interface IngestionResult {
  entriesCreated: number;
  entriesSkipped: number;
  entriesFailed: number;
}
