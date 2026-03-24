import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createKnowledgeEntrySchema,
  updateKnowledgeEntrySchema,
  knowledgeSearchQuerySchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { knowledgeIngestionService } from "../services/knowledge-ingestion.js";
import { knowledgeSearchService } from "../services/knowledge-search.js";
import { logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { knowledgeEntries } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";

export function knowledgeRoutes(db: Db) {
  const router = Router();
  const ingestion = knowledgeIngestionService(db);
  const search = knowledgeSearchService(db);

  // List/search knowledge entries
  router.get("/companies/:companyId/knowledge", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = knowledgeSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
      return;
    }
    const { q, scope, kind, projectId, limit, offset } = parsed.data;

    const results = await search.search({
      companyId,
      query: q,
      scope,
      kind,
      projectId,
      limit,
      offset,
    });
    res.json(results);
  });

  // Get project-scoped knowledge
  router.get("/companies/:companyId/projects/:projectId/knowledge", async (req, res) => {
    const companyId = req.params.companyId as string;
    const projectId = req.params.projectId as string;
    assertCompanyAccess(req, companyId);

    const parsed = knowledgeSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
      return;
    }
    const { q, kind, limit, offset } = parsed.data;

    const results = await search.search({
      companyId,
      query: q,
      kind,
      projectId,
      limit,
      offset,
    });
    res.json(results);
  });

  // Get ingestion stats
  router.get("/companies/:companyId/knowledge/stats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const stats = await search.getStats(companyId);
    res.json(stats);
  });

  // Create manual entry
  router.post(
    "/companies/:companyId/knowledge",
    validate(createKnowledgeEntrySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const actor = getActorInfo(req);
      const entryId = await ingestion.createManualEntry({
        companyId,
        ...req.body,
        createdByAgentId: actor.actorType === "agent" ? actor.agentId : null,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "knowledge.created",
        entityType: "knowledge_entry",
        entityId: entryId,
        details: { title: req.body.title, kind: "manual_note" },
      });

      res.status(201).json({ id: entryId });
    },
  );

  // Get single entry
  router.get("/knowledge/:entryId", async (req, res) => {
    const entryId = req.params.entryId as string;
    const rows = await db
      .select()
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.id, entryId))
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Knowledge entry not found" });
      return;
    }
    assertCompanyAccess(req, rows[0].companyId);
    res.json(rows[0]);
  });

  // Update entry
  router.patch("/knowledge/:entryId", validate(updateKnowledgeEntrySchema), async (req, res) => {
    const entryId = req.params.entryId as string;
    const existing = await db
      .select()
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.id, entryId))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Knowledge entry not found" });
      return;
    }
    assertCompanyAccess(req, existing[0].companyId);

    const [updated] = await db
      .update(knowledgeEntries)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, entryId))
      .returning();

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing[0].companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "knowledge.updated",
      entityType: "knowledge_entry",
      entityId: entryId,
      details: req.body,
    });

    res.json(updated);
  });

  // Delete entry
  router.delete("/knowledge/:entryId", async (req, res) => {
    const entryId = req.params.entryId as string;
    const existing = await db
      .select()
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.id, entryId))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Knowledge entry not found" });
      return;
    }
    assertCompanyAccess(req, existing[0].companyId);

    await db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, entryId));

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing[0].companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "knowledge.deleted",
      entityType: "knowledge_entry",
      entityId: entryId,
    });

    res.json({ ok: true });
  });

  // Trigger ingestion
  router.post("/companies/:companyId/knowledge/ingest", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await ingestion.ingestAll(companyId);
    res.json(result);
  });

  // Trigger single source ingestion
  router.post("/companies/:companyId/knowledge/ingest/:source", async (req, res) => {
    const companyId = req.params.companyId as string;
    const source = req.params.source as string;
    assertCompanyAccess(req, companyId);
    const result = await ingestion.ingestSource(companyId, source);
    res.json(result);
  });

  return router;
}
