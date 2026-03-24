import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  addDepartmentMemberSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { departmentService } from "../services/index.js";
import { logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function departmentRoutes(db: Db) {
  const router = Router();
  const svc = departmentService(db);

  // List departments for a company
  router.get("/companies/:companyId/departments", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  // Get department detail with members
  router.get("/departments/:id", async (req, res) => {
    const id = req.params.id as string;
    const dept = await svc.getByIdWithMembers(id);
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, dept.companyId);
    res.json(dept);
  });

  // Create a department
  router.post(
    "/companies/:companyId/departments",
    validate(createDepartmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const dept = await svc.create(companyId, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "department.created",
        entityType: "department",
        entityId: dept.id,
        details: { name: dept.name, templateType: dept.templateType },
      });

      res.status(201).json(dept);
    },
  );

  // Update a department
  router.patch("/departments/:id", validate(updateDepartmentSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const dept = await svc.update(id, req.body);
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: dept.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "department.updated",
      entityType: "department",
      entityId: dept.id,
      details: req.body,
    });

    res.json(dept);
  });

  // Delete a department
  router.delete("/departments/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const dept = await svc.remove(id);

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "department.deleted",
      entityType: "department",
      entityId: id,
      details: { name: existing.name },
    });

    res.json(dept);
  });

  // Add member to department
  router.post(
    "/departments/:id/members",
    validate(addDepartmentMemberSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Department not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      await svc.addMember(id, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "department.member_added",
        entityType: "department",
        entityId: id,
        details: { agentId: req.body.agentId, role: req.body.role ?? "member" },
      });

      res.status(201).json({ ok: true });
    },
  );

  // Remove member from department
  router.delete("/departments/:id/members/:agentId", async (req, res) => {
    const id = req.params.id as string;
    const agentId = req.params.agentId as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await svc.removeMember(id, agentId);

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "department.member_removed",
      entityType: "department",
      entityId: id,
      details: { agentId },
    });

    res.json({ ok: true });
  });

  // Get department crew (agents with live intent)
  router.get("/departments/:id/crew", async (req, res) => {
    const id = req.params.id as string;
    const dept = await svc.getById(id);
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, dept.companyId);
    const crew = await svc.getCrew(id);
    res.json(crew);
  });

  // Get department processor (pipeline stages)
  router.get("/departments/:id/processor", async (req, res) => {
    const id = req.params.id as string;
    const dept = await svc.getById(id);
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, dept.companyId);
    const processor = await svc.getProcessor(id);
    res.json(processor);
  });

  // Get department vitals (health metrics)
  router.get("/departments/:id/vitals", async (req, res) => {
    const id = req.params.id as string;
    const dept = await svc.getById(id);
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, dept.companyId);
    const vitals = await svc.getVitals(id);
    res.json(vitals);
  });

  // Get signal transformation detail
  router.get("/departments/:id/signals/:signalId", async (req, res) => {
    const id = req.params.id as string;
    const signalId = req.params.signalId as string;
    const dept = await svc.getById(id);
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, dept.companyId);
    const signal = await svc.getSignalDetail(id, signalId);
    if (!signal) {
      res.status(404).json({ error: "Signal not found" });
      return;
    }
    res.json(signal);
  });

  return router;
}
