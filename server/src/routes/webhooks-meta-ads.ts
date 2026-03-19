import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { metaAdsWebhookVerifyQuerySchema } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { externalIntegrationService } from "../services/index.js";

function asWebhookBody(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function webhooksMetaAdsRoutes(db: Db) {
  const router = Router();
  const externalSvc = externalIntegrationService(db);

  router.get("/webhooks/meta-ads/:sourceId", async (req, res) => {
    const sourceId = req.params.sourceId as string;
    const query = metaAdsWebhookVerifyQuerySchema.parse(req.query);
    const result = await externalSvc.verifyMetaWebhookChallenge(sourceId, {
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
      const result = await externalSvc.ingestMetaWebhook(sourceId, {
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
      logger.warn({ err, sourceId }, "meta ads webhook rejected");
      throw err;
    }
  });

  return router;
}
