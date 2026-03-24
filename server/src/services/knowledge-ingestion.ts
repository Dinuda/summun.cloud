import { eq, and, gt, asc, desc, sql, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "@paperclipai/db";
import {
  knowledgeEntries,
  knowledgeIngestionCursors,
  heartbeatRuns,
  heartbeatRunEvents,
  issues,
  issueComments,
  approvals,
  externalActionItems,
  externalLeads,
  goals,
  activityLog,
} from "@paperclipai/db";
import type { IngestionResult } from "@paperclipai/shared";

function contentHash(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase().slice(0, 2000)).digest("hex");
}

async function getCursor(db: Db, companyId: string, sourceTable: string): Promise<Date | null> {
  const rows = await db
    .select({ lastIngestedAt: knowledgeIngestionCursors.lastIngestedAt })
    .from(knowledgeIngestionCursors)
    .where(
      and(
        eq(knowledgeIngestionCursors.companyId, companyId),
        eq(knowledgeIngestionCursors.sourceTable, sourceTable),
      ),
    )
    .limit(1);
  return rows[0]?.lastIngestedAt ?? null;
}

async function upsertCursor(db: Db, companyId: string, sourceTable: string, lastSourceId?: string): Promise<void> {
  await db
    .insert(knowledgeIngestionCursors)
    .values({
      companyId,
      sourceTable,
      lastIngestedAt: new Date(),
      lastSourceId: lastSourceId ?? null,
    })
    .onConflictDoUpdate({
      target: [knowledgeIngestionCursors.companyId, knowledgeIngestionCursors.sourceTable],
      set: {
        lastIngestedAt: new Date(),
        lastSourceId: lastSourceId ?? null,
        updatedAt: new Date(),
      },
    });
}

async function insertKnowledgeEntry(
  db: Db,
  entry: {
    companyId: string;
    projectId?: string | null;
    title: string;
    summary?: string | null;
    body: string;
    scope: "project" | "org";
    kind: string;
    tags?: string[];
    sourceType: "auto_ingest" | "manual";
    sourceEntity: string;
    sourceEntityId: string;
    createdByAgentId?: string | null;
    quality?: string;
  },
): Promise<boolean> {
  const hash = contentHash(entry.body);

  // Check dedup by source
  const existingBySource = await db
    .select({ id: knowledgeEntries.id })
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.companyId, entry.companyId),
        eq(knowledgeEntries.sourceEntity, entry.sourceEntity),
        eq(knowledgeEntries.sourceEntityId, entry.sourceEntityId),
      ),
    )
    .limit(1);
  if (existingBySource.length > 0) return false;

  // Check dedup by content hash
  const existingByHash = await db
    .select({ id: knowledgeEntries.id })
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.companyId, entry.companyId),
        eq(knowledgeEntries.contentHash, hash),
      ),
    )
    .limit(1);
  if (existingByHash.length > 0) {
    await db
      .update(knowledgeEntries)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, existingByHash[0].id));
    return false;
  }

  await db.insert(knowledgeEntries).values({
    ...entry,
    contentHash: hash,
    tags: entry.tags ?? [],
    quality: entry.quality ?? "auto",
  });
  return true;
}

export function knowledgeIngestionService(db: Db) {
  async function ingestHeartbeatRuns(companyId: string, cursor: Date | null): Promise<IngestionResult> {
    let created = 0;
    let skipped = 0;

    const conditions = [
      eq(heartbeatRuns.companyId, companyId),
      inArray(heartbeatRuns.status, ["succeeded", "failed"]),
    ];
    if (cursor) {
      conditions.push(gt(heartbeatRuns.finishedAt, cursor));
    }

    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(and(...conditions))
      .orderBy(asc(heartbeatRuns.finishedAt))
      .limit(100);

    for (const run of runs) {
      const body = [run.stdoutExcerpt, run.error, run.stderrExcerpt].filter(Boolean).join("\n");
      if (!body || body.length < 30) {
        skipped++;
        continue;
      }

      const title =
        run.status === "failed"
          ? `Run failed: ${(run.error ?? "unknown error").slice(0, 100)}`
          : `Agent run completed (${run.id.slice(0, 8)})`;

      const inserted = await insertKnowledgeEntry(db, {
        companyId,
        projectId: (run.contextSnapshot as Record<string, unknown>)?.projectId as string | null,
        title,
        summary: body.slice(0, 500),
        body,
        scope: (run.contextSnapshot as Record<string, unknown>)?.projectId ? "project" : "org",
        kind: run.status === "failed" ? "troubleshooting" : "agent_outcome",
        sourceType: "auto_ingest",
        sourceEntity: "heartbeat_run",
        sourceEntityId: run.id,
        createdByAgentId: run.agentId,
        quality: run.status === "failed" ? "medium" : "auto",
      });
      if (inserted) created++;
      else skipped++;
    }

    await upsertCursor(db, companyId, "heartbeat_runs");
    return { entriesCreated: created, entriesSkipped: skipped, entriesFailed: 0 };
  }

  async function ingestIssueComments(companyId: string, cursor: Date | null): Promise<IngestionResult> {
    let created = 0;
    let skipped = 0;

    const conditions = [eq(issueComments.companyId, companyId)];
    if (cursor) conditions.push(gt(issueComments.createdAt, cursor));

      const comments = await db
      .select({
        id: issueComments.id,
        body: issueComments.body,
        issueId: issueComments.issueId,
        authorAgentId: issueComments.authorAgentId,
        createdAt: issueComments.createdAt,
        projectId: issues.projectId,
      })
      .from(issueComments)
      .innerJoin(issues, eq(issueComments.issueId, issues.id))
      .where(and(...conditions))
      .orderBy(asc(issueComments.createdAt))
      .limit(100);

    for (const comment of comments) {
      if (!comment.body || comment.body.length < 50) {
        skipped++;
        continue;
      }

      const inserted = await insertKnowledgeEntry(db, {
        companyId,
        projectId: comment.projectId,
        title: `Comment on issue ${comment.issueId.slice(0, 8)}`,
        summary: comment.body.slice(0, 500),
        body: comment.body,
        scope: comment.projectId ? "project" : "org",
        kind: "issue_analysis",
        sourceType: "auto_ingest",
        sourceEntity: "issue_comment",
        sourceEntityId: comment.id,
        createdByAgentId: comment.authorAgentId,
      });
      if (inserted) created++;
      else skipped++;
    }

    await upsertCursor(db, companyId, "issue_comments");
    return { entriesCreated: created, entriesSkipped: skipped, entriesFailed: 0 };
  }

  async function ingestApprovals(companyId: string, cursor: Date | null): Promise<IngestionResult> {
    let created = 0;
    let skipped = 0;

    const conditions = [
      eq(approvals.companyId, companyId),
      inArray(approvals.status, ["approved", "rejected"]),
    ];
    if (cursor) conditions.push(gt(approvals.updatedAt, cursor));

    const resolvedApprovals = await db
      .select()
      .from(approvals)
      .where(and(...conditions))
      .orderBy(asc(approvals.updatedAt))
      .limit(50);

    for (const approval of resolvedApprovals) {
      const payload = (approval.payload as Record<string, unknown>) ?? {};
      const decisionNote = approval.decisionNote;
      const body = [
        decisionNote ? `Decision: ${decisionNote}` : null,
        payload.description ? `Context: ${payload.description}` : null,
        `Status: ${approval.status}`,
      ]
        .filter(Boolean)
        .join("\n");

      if (!body || body.length < 20) {
        skipped++;
        continue;
      }

      const inserted = await insertKnowledgeEntry(db, {
        companyId,
        title: `Approval ${approval.status}: ${(approval.type ?? "unknown").replace(/_/g, " ")}`,
        summary: body.slice(0, 500),
        body,
        scope: "org",
        kind: "decision_rationale",
        sourceType: "auto_ingest",
        sourceEntity: "approval",
        sourceEntityId: approval.id,
        createdByAgentId: approval.requestedByAgentId,
        quality: "high",
      });
      if (inserted) created++;
      else skipped++;
    }

    await upsertCursor(db, companyId, "approvals");
    return { entriesCreated: created, entriesSkipped: skipped, entriesFailed: 0 };
  }

  async function ingestExternalActionItems(companyId: string, cursor: Date | null): Promise<IngestionResult> {
    let created = 0;
    let skipped = 0;

    const conditions = [eq(externalActionItems.companyId, companyId)];
    if (cursor) conditions.push(gt(externalActionItems.createdAt, cursor));

    const items = await db
      .select()
      .from(externalActionItems)
      .where(and(...conditions))
      .orderBy(asc(externalActionItems.createdAt))
      .limit(50);

    for (const item of items) {
      const recommendation = (item.recommendation as Record<string, unknown>) ?? {};
      const body = [
        item.description,
        recommendation.reasoning ? `Reasoning: ${recommendation.reasoning}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      if (!body || body.length < 30) {
        skipped++;
        continue;
      }

      const inserted = await insertKnowledgeEntry(db, {
        companyId,
        title: item.title,
        summary: body.slice(0, 500),
        body,
        scope: "project",
        kind: "external_insight",
        sourceType: "auto_ingest",
        sourceEntity: "external_action_item",
        sourceEntityId: item.id,
        createdByAgentId: item.reviewerAgentId,
      });
      if (inserted) created++;
      else skipped++;
    }

    await upsertCursor(db, companyId, "external_action_items");
    return { entriesCreated: created, entriesSkipped: skipped, entriesFailed: 0 };
  }

  async function ingestExternalLeads(companyId: string, cursor: Date | null): Promise<IngestionResult> {
    let created = 0;
    let skipped = 0;

    const conditions = [eq(externalLeads.companyId, companyId)];
    if (cursor) conditions.push(gt(externalLeads.createdAt, cursor));

    const leads = await db
      .select()
      .from(externalLeads)
      .where(and(...conditions))
      .orderBy(asc(externalLeads.createdAt))
      .limit(50);

    for (const lead of leads) {
      const fieldData = (lead.fieldData as Record<string, unknown>) ?? {};
      const name = (fieldData.full_name as string) ?? (fieldData.name as string) ?? "Unknown";
      const email = (fieldData.email as string) ?? "";
      const message = (fieldData.message as string) ?? (fieldData.body as string) ?? "";

      const body = [`Lead: ${name}`, email ? `Email: ${email}` : null, message ? `Message: ${message}` : null, `Status: ${lead.status}`]
        .filter(Boolean)
        .join("\n");

      if (!body || body.length < 20) {
        skipped++;
        continue;
      }

      const inserted = await insertKnowledgeEntry(db, {
        companyId,
        title: `Lead: ${name}`,
        summary: body.slice(0, 500),
        body,
        scope: "project",
        kind: "lead_intelligence",
        sourceType: "auto_ingest",
        sourceEntity: "external_lead",
        sourceEntityId: lead.id,
      });
      if (inserted) created++;
      else skipped++;
    }

    await upsertCursor(db, companyId, "external_leads");
    return { entriesCreated: created, entriesSkipped: skipped, entriesFailed: 0 };
  }

  async function ingestGoals(companyId: string, cursor: Date | null): Promise<IngestionResult> {
    let created = 0;
    let skipped = 0;

    const conditions = [eq(goals.companyId, companyId)];
    if (cursor) conditions.push(gt(goals.updatedAt, cursor));

    const goalList = await db
      .select()
      .from(goals)
      .where(and(...conditions))
      .orderBy(asc(goals.updatedAt))
      .limit(20);

    for (const goal of goalList) {
      if (!goal.description || goal.description.length < 30) {
        skipped++;
        continue;
      }

      const inserted = await insertKnowledgeEntry(db, {
        companyId,
        title: `Goal: ${goal.title}`,
        summary: goal.description.slice(0, 500),
        body: `Goal: ${goal.title}\n${goal.description}\nStatus: ${goal.status}\nLevel: ${goal.level}`,
        scope: "project",
        kind: "project_context",
        sourceType: "auto_ingest",
        sourceEntity: "goal",
        sourceEntityId: goal.id,
      });
      if (inserted) created++;
      else skipped++;
    }

    await upsertCursor(db, companyId, "goals");
    return { entriesCreated: created, entriesSkipped: skipped, entriesFailed: 0 };
  }

  return {
    async ingestAll(companyId: string): Promise<IngestionResult> {
      const sources = [
        { name: "heartbeat_runs", fn: ingestHeartbeatRuns },
        { name: "issue_comments", fn: ingestIssueComments },
        { name: "approvals", fn: ingestApprovals },
        { name: "external_action_items", fn: ingestExternalActionItems },
        { name: "external_leads", fn: ingestExternalLeads },
        { name: "goals", fn: ingestGoals },
      ];

      const aggregate: IngestionResult = { entriesCreated: 0, entriesSkipped: 0, entriesFailed: 0 };
      for (const source of sources) {
        try {
          const cursor = await getCursor(db, companyId, source.name);
          const result = await source.fn(companyId, cursor);
          aggregate.entriesCreated += result.entriesCreated;
          aggregate.entriesSkipped += result.entriesSkipped;
          aggregate.entriesFailed += result.entriesFailed;
        } catch (err) {
          aggregate.entriesFailed++;
        }
      }
      return aggregate;
    },

    async ingestSource(companyId: string, sourceName: string): Promise<IngestionResult> {
      const sourceMap: Record<string, (companyId: string, cursor: Date | null) => Promise<IngestionResult>> = {
        heartbeat_runs: ingestHeartbeatRuns,
        issue_comments: ingestIssueComments,
        approvals: ingestApprovals,
        external_action_items: ingestExternalActionItems,
        external_leads: ingestExternalLeads,
        goals: ingestGoals,
      };
      const fn = sourceMap[sourceName];
      if (!fn) throw new Error(`Unknown source: ${sourceName}`);
      const cursor = await getCursor(db, companyId, sourceName);
      return fn(companyId, cursor);
    },

    async createManualEntry(input: {
      companyId: string;
      projectId?: string | null;
      title: string;
      summary?: string | null;
      body: string;
      scope?: "project" | "org";
      tags?: string[];
      quality?: string;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }): Promise<string> {
      const hash = contentHash(input.body);

      const [row] = await db
        .insert(knowledgeEntries)
        .values({
          companyId: input.companyId,
          projectId: input.projectId ?? null,
          title: input.title,
          summary: input.summary ?? null,
          body: input.body,
          scope: input.scope ?? "project",
          kind: "manual_note",
          tags: input.tags ?? [],
          sourceType: "manual",
          sourceEntity: "manual",
          sourceEntityId: `manual_${Date.now()}`,
          createdByAgentId: input.createdByAgentId ?? null,
          createdByUserId: input.createdByUserId ?? null,
          contentHash: hash,
          quality: input.quality ?? "medium",
        })
        .returning({ id: knowledgeEntries.id });
      return row.id;
    },
  };
}
