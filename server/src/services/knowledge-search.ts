import { eq, and, sql, desc, asc, count } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { knowledgeEntries, knowledgeIngestionCursors } from "@paperclipai/db";
import type { KnowledgeSearchResult, KnowledgeIngestionStats } from "@paperclipai/shared";

export function knowledgeSearchService(db: Db) {
  return {
    async search(params: {
      companyId: string;
      query?: string;
      scope?: string;
      kind?: string;
      projectId?: string;
      limit: number;
      offset: number;
    }): Promise<KnowledgeSearchResult> {
      const { companyId, query, scope, kind, projectId, limit, offset } = params;

      const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [
        eq(knowledgeEntries.companyId, companyId),
      ];
      if (scope) conditions.push(eq(knowledgeEntries.scope, scope));
      if (kind) conditions.push(eq(knowledgeEntries.kind, kind));
      if (projectId) conditions.push(eq(knowledgeEntries.projectId, projectId));

      if (query && query.trim().length > 0) {
        const tsQuery = query
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => `${w}:*`)
          .join(" & ");
        const searchSql = sql`to_tsvector('english', coalesce(${knowledgeEntries.title}, '') || ' ' || coalesce(${knowledgeEntries.summary}, '') || ' ' || coalesce(${knowledgeEntries.body}, '')) @@ to_tsquery('english', ${tsQuery})`;
        conditions.push(searchSql);

        const rows = await db
          .select({
            id: knowledgeEntries.id,
            title: knowledgeEntries.title,
            summary: knowledgeEntries.summary,
            body: knowledgeEntries.body,
            scope: knowledgeEntries.scope,
            kind: knowledgeEntries.kind,
            tags: knowledgeEntries.tags,
            sourceType: knowledgeEntries.sourceType,
            sourceEntity: knowledgeEntries.sourceEntity,
            projectId: knowledgeEntries.projectId,
            createdByAgentId: knowledgeEntries.createdByAgentId,
            createdAt: knowledgeEntries.createdAt,
            rank: sql<number>`ts_rank(to_tsvector('english', coalesce(${knowledgeEntries.title}, '') || ' ' || coalesce(${knowledgeEntries.summary}, '') || ' ' || coalesce(${knowledgeEntries.body}, '')), to_tsquery('english', ${tsQuery}))`,
            snippet: sql<string>`ts_headline('english', left(${knowledgeEntries.body}, 500), to_tsquery('english', ${tsQuery}), 'MaxWords=35, MinWords=10, HighlightAll=false')`,
          })
          .from(knowledgeEntries)
          .where(and(...conditions))
          .orderBy(
            desc(
              sql`ts_rank(to_tsvector('english', coalesce(${knowledgeEntries.title}, '') || ' ' || coalesce(${knowledgeEntries.summary}, '') || ' ' || coalesce(${knowledgeEntries.body}, '')), to_tsquery('english', ${tsQuery}))`,
            ),
          )
          .limit(limit)
          .offset(offset);

        return {
          entries: rows.map((r) => ({
            ...r,
            rank: Number(r.rank),
            snippet: r.snippet ?? r.body.slice(0, 200),
            createdAt: r.createdAt.toISOString(),
          })),
          total: rows.length,
        };
      }

      // No search query — return recent entries
      const rows = await db
        .select({
          id: knowledgeEntries.id,
          title: knowledgeEntries.title,
          summary: knowledgeEntries.summary,
          body: knowledgeEntries.body,
          scope: knowledgeEntries.scope,
          kind: knowledgeEntries.kind,
          tags: knowledgeEntries.tags,
          sourceType: knowledgeEntries.sourceType,
          sourceEntity: knowledgeEntries.sourceEntity,
          projectId: knowledgeEntries.projectId,
          createdByAgentId: knowledgeEntries.createdByAgentId,
          createdAt: knowledgeEntries.createdAt,
        })
        .from(knowledgeEntries)
        .where(and(...conditions))
        .orderBy(desc(knowledgeEntries.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        entries: rows.map((r) => ({
          ...r,
          rank: 1,
          snippet: (r.summary ?? r.body).slice(0, 200),
          createdAt: r.createdAt.toISOString(),
        })),
        total: rows.length,
      };
    },

    async getStats(companyId: string): Promise<KnowledgeIngestionStats> {
      const totalRows = await db
        .select({ count: count() })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.companyId, companyId));

      const byKindRows = await db
        .select({ kind: knowledgeEntries.kind, count: count() })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.companyId, companyId))
        .groupBy(knowledgeEntries.kind);

      const byScopeRows = await db
        .select({ scope: knowledgeEntries.scope, count: count() })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.companyId, companyId))
        .groupBy(knowledgeEntries.scope);

      const cursors = await db
        .select({
          sourceTable: knowledgeIngestionCursors.sourceTable,
          lastIngestedAt: knowledgeIngestionCursors.lastIngestedAt,
        })
        .from(knowledgeIngestionCursors)
        .where(eq(knowledgeIngestionCursors.companyId, companyId));

      const byKind: Record<string, number> = {};
      for (const row of byKindRows) byKind[row.kind] = Number(row.count);

      const byScope: Record<string, number> = {};
      for (const row of byScopeRows) byScope[row.scope] = Number(row.count);

      const lastCursor = cursors.reduce(
        (latest, c) => (c.lastIngestedAt > (latest ?? new Date(0)) ? c.lastIngestedAt : latest),
        null as Date | null,
      );

      return {
        totalEntries: Number(totalRows[0]?.count ?? 0),
        byKind,
        byScope,
        lastIngestedAt: lastCursor?.toISOString() ?? null,
        cursors: cursors.map((c) => ({
          source: c.sourceTable,
          lastIngestedAt: c.lastIngestedAt.toISOString(),
        })),
      };
    },
  };
}
