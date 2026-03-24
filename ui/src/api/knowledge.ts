import type {
  KnowledgeSearchResult,
  KnowledgeEntry,
  KnowledgeIngestionStats,
  IngestionResult,
} from "@paperclipai/shared";
import { api } from "./client";

function buildQuery(params?: Record<string, string | number | undefined | null>): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export const knowledgeApi = {
  list: (companyId: string, params?: Record<string, string | number | undefined>) =>
    api.get<KnowledgeSearchResult>(`/companies/${companyId}/knowledge${buildQuery(params)}`),

  projectKnowledge: (companyId: string, projectId: string, params?: Record<string, string | number | undefined>) =>
    api.get<KnowledgeSearchResult>(`/companies/${companyId}/projects/${projectId}/knowledge${buildQuery(params)}`),

  stats: (companyId: string) =>
    api.get<KnowledgeIngestionStats>(`/companies/${companyId}/knowledge/stats`),

  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<{ id: string }>(`/companies/${companyId}/knowledge`, data),

  get: (entryId: string) =>
    api.get<KnowledgeEntry>(`/knowledge/${entryId}`),

  update: (entryId: string, data: Record<string, unknown>) =>
    api.patch<KnowledgeEntry>(`/knowledge/${entryId}`, data),

  remove: (entryId: string) =>
    api.delete<{ ok: boolean }>(`/knowledge/${entryId}`),

  ingest: (companyId: string, source?: string) =>
    api.post<IngestionResult>(
      source
        ? `/companies/${companyId}/knowledge/ingest/${source}`
        : `/companies/${companyId}/knowledge/ingest`,
      {},
    ),
};
