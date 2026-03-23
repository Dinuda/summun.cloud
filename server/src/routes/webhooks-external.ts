import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { externalWebhookVerifyQuerySchema } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { externalIntegrationService } from "../services/index.js";
import { HttpError } from "../errors.js";

function asWebhookBody(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function webhooksExternalRoutes(db: Db) {
  const router = Router();
  const externalSvc = externalIntegrationService(db);

  function isPostIngestWorkflowFailure(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.message.startsWith("External workflow failed:");
  }

  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  router.get("/webhooks/:pluginId/:sourceId", async (req, res) => {
    const pluginId = req.params.pluginId as string;
    const sourceId = req.params.sourceId as string;
    const query = externalWebhookVerifyQuerySchema.parse(req.query);
    const result = await externalSvc.verifyWebhookChallenge(pluginId, sourceId, {
      mode: query["hub.mode"] ?? null,
      token: query["hub.verify_token"] ?? null,
      challenge: query["hub.challenge"] ?? null,
    });

    if (!result.ok || !result.challenge) {
      res.status(403).json({ error: "Webhook challenge verification failed" });
      return;
    }

    res.status(200).type("text/plain").send(result.challenge);
  });

  router.post("/webhooks/:pluginId/:sourceId", async (req, res) => {
    const pluginId = req.params.pluginId as string;
    const sourceId = req.params.sourceId as string;
    const payload = asWebhookBody(req.body);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));

    try {
      const result = await externalSvc.ingestWebhook(pluginId, sourceId, {
        payload,
        headers: req.headers,
        rawBody,
      });
      res.status(202).json({
        accepted: result.kind !== "ignored",
        duplicate: result.kind === "duplicate",
        ignored: result.kind === "ignored",
        eventId: result.event?.id ?? null,
        workflowRunId: result.run?.id ?? null,
      });
    } catch (err) {
      logger.warn({ err, sourceId, pluginId }, "external webhook rejected");
      if (isPostIngestWorkflowFailure(err)) {
        res.status(202).json({
          accepted: true,
          duplicate: false,
          ignored: false,
          failed: true,
          error: errorMessage(err),
        });
        return;
      }
      if (err instanceof HttpError && err.status < 500) throw err;
      throw err;
    }
  });

  router.get("/webhooks/:pluginId/company/:companyId", async (req, res) => {
    const pluginId = req.params.pluginId as string;
    const companyId = req.params.companyId as string;
    const query = externalWebhookVerifyQuerySchema.parse(req.query);
    const result = await externalSvc.verifyWebhookChallengeForCompany(pluginId, companyId, {
      mode: query["hub.mode"] ?? null,
      token: query["hub.verify_token"] ?? null,
      challenge: query["hub.challenge"] ?? null,
    });
    if (!result.ok || !result.challenge) {
      res.status(403).json({ error: "Webhook challenge verification failed" });
      return;
    }
    res.status(200).type("text/plain").send(result.challenge);
  });

  router.post("/webhooks/:pluginId/company/:companyId", async (req, res) => {
    const pluginId = req.params.pluginId as string;
    const companyId = req.params.companyId as string;
    const payload = asWebhookBody(req.body);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));
    try {
      const result = await externalSvc.ingestWebhookForCompany(pluginId, companyId, {
        payload,
        headers: req.headers,
        rawBody,
      });
      res.status(202).json({
        accepted: result.kind !== "ignored",
        duplicate: result.kind === "duplicate",
        ignored: result.kind === "ignored",
        eventId: result.event?.id ?? null,
        workflowRunId: result.run?.id ?? null,
      });
    } catch (err) {
      logger.warn({ err, companyId, pluginId }, "external company webhook rejected");
      if (isPostIngestWorkflowFailure(err)) {
        res.status(202).json({
          accepted: true,
          duplicate: false,
          ignored: false,
          failed: true,
          error: errorMessage(err),
        });
        return;
      }
      if (err instanceof HttpError && err.status < 500) throw err;
      throw err;
    }
  });

  router.get("/webhooks/meta_leadgen/company/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const query = externalWebhookVerifyQuerySchema.parse(req.query);
    const result = await externalSvc.verifyWebhookChallengeForCompany("meta_leadgen", companyId, {
      mode: query["hub.mode"] ?? null,
      token: query["hub.verify_token"] ?? null,
      challenge: query["hub.challenge"] ?? null,
    });
    if (!result.ok || !result.challenge) {
      res.status(403).json({ error: "Webhook challenge verification failed" });
      return;
    }
    res.status(200).type("text/plain").send(result.challenge);
  });

  router.post("/webhooks/meta_leadgen/company/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const payload = asWebhookBody(req.body);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));
    try {
      const result = await externalSvc.ingestWebhookForCompany("meta_leadgen", companyId, {
        payload,
        headers: req.headers,
        rawBody,
      });
      res.status(202).json({
        accepted: result.kind !== "ignored",
        duplicate: result.kind === "duplicate",
        ignored: result.kind === "ignored",
        eventId: result.event?.id ?? null,
        workflowRunId: result.run?.id ?? null,
      });
    } catch (err) {
      logger.warn({ err, companyId, pluginId: "meta_leadgen" }, "meta leadgen company webhook rejected");
      if (isPostIngestWorkflowFailure(err)) {
        res.status(202).json({
          accepted: true,
          duplicate: false,
          ignored: false,
          failed: true,
          error: errorMessage(err),
        });
        return;
      }
      if (err instanceof HttpError && err.status < 500) throw err;
      throw err;
    }
  });

  // Deprecated compatibility alias for existing deployments.
  router.get("/webhooks/meta-ads/:sourceId", async (req, res) => {
    const sourceId = req.params.sourceId as string;
    const query = externalWebhookVerifyQuerySchema.parse(req.query);
    const result = await externalSvc.verifyWebhookChallenge("meta_leadgen", sourceId, {
      mode: query["hub.mode"] ?? null,
      token: query["hub.verify_token"] ?? null,
      challenge: query["hub.challenge"] ?? null,
    });
    if (!result.ok || !result.challenge) {
      res.status(403).json({ error: "Webhook challenge verification failed" });
      return;
    }
    res.status(200).type("text/plain").send(result.challenge);
  });

  router.post("/webhooks/meta-ads/:sourceId", async (req, res) => {
    const sourceId = req.params.sourceId as string;
    const payload = asWebhookBody(req.body);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));
    try {
      const result = await externalSvc.ingestWebhook("meta_leadgen", sourceId, {
        payload,
        headers: req.headers,
        rawBody,
      });
      res.status(202).json({
        accepted: result.kind !== "ignored",
        duplicate: result.kind === "duplicate",
        ignored: result.kind === "ignored",
        eventId: result.event?.id ?? null,
        workflowRunId: result.run?.id ?? null,
      });
    } catch (err) {
      logger.warn({ err, sourceId, pluginId: "meta_leadgen" }, "meta ads webhook rejected");
      if (isPostIngestWorkflowFailure(err)) {
        res.status(202).json({
          accepted: true,
          duplicate: false,
          ignored: false,
          failed: true,
          error: errorMessage(err),
        });
        return;
      }
      if (err instanceof HttpError && err.status < 500) throw err;
      throw err;
    }
  });

  return router;
}
