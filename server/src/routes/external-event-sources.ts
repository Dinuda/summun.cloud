import { createHmac } from "node:crypto";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  companyExternalPluginConfigUpsertSchema,
  createExternalEventSourceSchema,
  type ExternalMetaOauthStartResult,
  externalPluginIdParamSchema,
  externalOpsQuerySchema,
  listExternalEventSourcesQuerySchema,
  metaConnectFormsSchema,
  metaConnectPagesSchema,
  metaConnectSourceSchema,
  metaOauthCallbackQuerySchema,
  metaOauthStartQuerySchema,
  whatsappConnectSourceSchema,
  reprocessExternalEventSchema,
  requestActionItemApprovalSchema,
  updateExternalEventSourceSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { externalIntegrationService, logActivity, secretService } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

const DEFAULT_META_OAUTH_RETURN_TO = "/company/settings";
const DEFAULT_META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "leads_retrieval",
];

interface MetaOauthState {
  version: 1;
  companyId: string;
  userId: string;
  returnTo: string;
  redirectUri: string;
  expiresAt: number;
}

function sanitizeReturnTo(value: string | undefined) {
  if (!value) return DEFAULT_META_OAUTH_RETURN_TO;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_META_OAUTH_RETURN_TO;
  return value;
}

function makeStateToken(payload: MetaOauthState, secret: string) {
  const json = JSON.stringify(payload);
  const encodedPayload = Buffer.from(json).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function decodeStateToken(stateToken: string): MetaOauthState | null {
  const [encodedPayload] = stateToken.split(".");
  if (!encodedPayload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as MetaOauthState;
    if (parsed.version !== 1) return null;
    if (!parsed.companyId || !parsed.userId || !parsed.returnTo || !parsed.redirectUri || !parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseStateToken(stateToken: string, secret: string): MetaOauthState | null {
  const [encodedPayload, signature] = stateToken.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  if (signature !== expectedSignature) return null;
  return decodeStateToken(stateToken);
}

function trimErrorMessage(message: string) {
  const trimmed = message.trim();
  return trimmed.length <= 250 ? trimmed : `${trimmed.slice(0, 250)}...`;
}

function requestBaseUrl(req: { header(name: string): string | undefined; protocol?: string }): string | null {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
  const host = req.header("x-forwarded-host")?.split(",")[0]?.trim() || req.header("host");
  if (!host) return null;
  return `${proto}://${host}`;
}

function resolveMetaOauthScopes(): string {
  const override = process.env.SUMMUN_META_OAUTH_SCOPES?.trim();
  if (!override) return DEFAULT_META_OAUTH_SCOPES.join(",");
  return override
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");
}

export function externalEventSourceRoutes(db: Db) {
  const router = Router();
  const externalSvc = externalIntegrationService(db);
  const secretsSvc = secretService(db);

  function getPublicBaseUrl() {
    const configured = process.env.SUMMUN_PUBLIC_BASE_URL?.trim();
    if (configured) return configured.replace(/\/+$/, "");
    return null;
  }

  async function fetchMetaJson(path: string, params: Record<string, string>) {
    const baseUrl = (process.env.SUMMUN_META_GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/+$/, "");
    const normalizedPath = path.replace(/^\/+/, "");
    const query = new URLSearchParams(params);
    const url = `${baseUrl}/${normalizedPath}?${query.toString()}`;
    const response = await fetch(url);
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { text };
    }
    if (response.status < 200 || response.status >= 300) {
      const err = (body?.error ?? {}) as Record<string, unknown>;
      const message =
        (typeof err.message === "string" ? err.message : null) ??
        (typeof body.error === "string" ? body.error : null) ??
        `Meta API error (${response.status})`;
      throw new Error(message);
    }
    return body;
  }

  async function upsertManagedSecret(
    companyId: string,
    name: string,
    value: string,
    description: string,
    userId: string,
  ) {
    const existing = await secretsSvc.getByName(companyId, name);
    if (existing) {
      return secretsSvc.rotate(existing.id, { value }, { userId, agentId: null });
    }
    return secretsSvc.create(
      companyId,
      {
        name,
        provider: "local_encrypted",
        value,
        description,
      },
      { userId, agentId: null },
    );
  }

  function buildMetaCallbackRedirect(baseUrl: string, returnTo: string, params: Record<string, string>) {
    const target = new URL(returnTo, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value);
    }
    return target.toString();
  }

  router.get("/external-plugins", async (req, res) => {
    assertBoard(req);
    const plugins = await externalSvc.listPlugins();
    res.json(plugins);
  });

  router.get("/companies/:companyId/external-plugin-configs/:pluginId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { pluginId } = externalPluginIdParamSchema.parse(req.params);
    const config = await externalSvc.getCompanyPluginConfig(companyId, pluginId);
    if (!config) {
      res.status(404).json({ error: "External plugin config not found" });
      return;
    }
    res.json(config);
  });

  router.put(
    "/companies/:companyId/external-plugin-configs/:pluginId",
    validate(companyExternalPluginConfigUpsertSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { pluginId } = externalPluginIdParamSchema.parse(req.params);
      const config = await externalSvc.upsertCompanyPluginConfig(companyId, pluginId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        action: "external_plugin_config.upserted",
        entityType: "external_plugin_config",
        entityId: config.id,
        details: { pluginId },
      });
      res.json(config);
    },
  );

  router.get("/companies/:companyId/external-event-sources/meta/oauth/start", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = metaOauthStartQuerySchema.parse(req.query);
    if (!req.actor.userId) {
      res.status(403).json({ error: "Board user identity is required for Meta OAuth" });
      return;
    }

    const metaConfig = await externalSvc.getRequiredMetaRuntimeConfig(companyId);
    const baseUrl = getPublicBaseUrl() ?? requestBaseUrl(req) ?? `${req.protocol}://${req.get("host")}`;
    const returnTo = sanitizeReturnTo(query.returnTo);
    const redirectUri =
      process.env.SUMMUN_META_OAUTH_REDIRECT_URI?.trim() ??
      `${baseUrl}/api/external-event-sources/meta/oauth/callback`;
    const stateSecret = process.env.SUMMUN_META_OAUTH_STATE_SECRET?.trim() || metaConfig.appSecret;

    const stateToken = makeStateToken(
      {
        version: 1,
        companyId,
        userId: req.actor.userId,
        returnTo,
        redirectUri,
        expiresAt: Date.now() + 10 * 60 * 1000,
      },
      stateSecret,
    );
    const graphVersion =
      process.env.SUMMUN_META_GRAPH_API_VERSION?.trim() ||
      metaConfig.graphApiVersion ||
      "v22.0";
    const authorizeUrl = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
    authorizeUrl.searchParams.set("client_id", metaConfig.metaAppId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", stateToken);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", resolveMetaOauthScopes());

    const payload: ExternalMetaOauthStartResult = { authorizeUrl: authorizeUrl.toString() };
    res.json(payload);
  });

  router.get("/external-event-sources/meta/oauth/callback", async (req, res) => {
    assertBoard(req);
    if (!req.actor.userId) {
      res.status(403).json({ error: "Board user identity is required for Meta OAuth" });
      return;
    }

    const query = metaOauthCallbackQuerySchema.parse(req.query);
    const baseUrl = getPublicBaseUrl() ?? requestBaseUrl(req) ?? `${req.protocol}://${req.get("host")}`;
    const unsignedState = query.state ? decodeStateToken(query.state) : null;
    const returnTo = sanitizeReturnTo(unsignedState?.returnTo);
    const fallbackRedirect = buildMetaCallbackRedirect(baseUrl, returnTo, {
      meta_oauth: "error",
      meta_oauth_error: "Invalid OAuth state",
    });
    if (!unsignedState) {
      res.redirect(302, fallbackRedirect);
      return;
    }
    assertCompanyAccess(req, unsignedState.companyId);

    let metaConfig: Awaited<ReturnType<typeof externalSvc.getRequiredMetaRuntimeConfig>>;
    try {
      metaConfig = await externalSvc.getRequiredMetaRuntimeConfig(unsignedState.companyId);
    } catch (err) {
      const message = err instanceof Error ? trimErrorMessage(err.message) : "Meta OAuth configuration is invalid";
      res.redirect(
        302,
        buildMetaCallbackRedirect(baseUrl, returnTo, {
          meta_oauth: "error",
          meta_oauth_company_id: unsignedState.companyId,
          meta_oauth_error: message,
        }),
      );
      return;
    }
    const stateSecret = process.env.SUMMUN_META_OAUTH_STATE_SECRET?.trim() || metaConfig.appSecret;
    const parsedState = query.state ? parseStateToken(query.state, stateSecret) : null;
    if (!parsedState) {
      res.redirect(302, fallbackRedirect);
      return;
    }
    if (parsedState.userId !== req.actor.userId) {
      res.redirect(
        302,
        buildMetaCallbackRedirect(baseUrl, returnTo, {
          meta_oauth: "error",
          meta_oauth_company_id: parsedState.companyId,
          meta_oauth_error: "Meta OAuth callback user mismatch",
        }),
      );
      return;
    }
    if (parsedState.expiresAt < Date.now()) {
      res.redirect(
        302,
        buildMetaCallbackRedirect(baseUrl, returnTo, {
          meta_oauth: "error",
          meta_oauth_company_id: parsedState.companyId,
          meta_oauth_error: "Meta OAuth state expired. Start again.",
        }),
      );
      return;
    }
    if (query.error) {
      res.redirect(
        302,
        buildMetaCallbackRedirect(baseUrl, returnTo, {
          meta_oauth: "error",
          meta_oauth_company_id: parsedState.companyId,
          meta_oauth_error: trimErrorMessage(query.error_description ?? query.error),
        }),
      );
      return;
    }
    if (!query.code) {
      res.redirect(
        302,
        buildMetaCallbackRedirect(baseUrl, returnTo, {
          meta_oauth: "error",
          meta_oauth_company_id: parsedState.companyId,
          meta_oauth_error: "Meta OAuth callback missing code",
        }),
      );
      return;
    }

    try {
      const graphVersion =
        process.env.SUMMUN_META_GRAPH_API_VERSION?.trim() ||
        metaConfig.graphApiVersion ||
        "v22.0";
      const tokenBody = await fetchMetaJson(`${graphVersion}/oauth/access_token`, {
        client_id: metaConfig.metaAppId,
        client_secret: metaConfig.appSecret,
        redirect_uri: parsedState.redirectUri,
        code: query.code,
      });
      const shortLivedToken = typeof tokenBody.access_token === "string" ? tokenBody.access_token : null;
      if (!shortLivedToken) {
        throw new Error("Meta OAuth did not return an access token");
      }

      let userAccessToken = shortLivedToken;
      try {
        const extendedBody = await fetchMetaJson(`${graphVersion}/oauth/access_token`, {
          grant_type: "fb_exchange_token",
          client_id: metaConfig.metaAppId,
          client_secret: metaConfig.appSecret,
          fb_exchange_token: shortLivedToken,
        });
        const longToken = typeof extendedBody.access_token === "string" ? extendedBody.access_token : null;
        if (longToken) userAccessToken = longToken;
      } catch {
        // Keep the short-lived token if exchange fails.
      }

      const userTokenSecret = await upsertManagedSecret(
        parsedState.companyId,
        "meta oauth user access token",
        userAccessToken,
        "Auto-managed Meta user access token (OAuth).",
        req.actor.userId,
      );

      res.redirect(
        302,
        buildMetaCallbackRedirect(baseUrl, returnTo, {
          meta_oauth: "success",
          meta_oauth_company_id: parsedState.companyId,
          meta_user_token_secret_id: userTokenSecret.id,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? trimErrorMessage(err.message) : "Meta OAuth failed";
      res.redirect(
        302,
        buildMetaCallbackRedirect(baseUrl, returnTo, {
          meta_oauth: "error",
          meta_oauth_company_id: parsedState.companyId,
          meta_oauth_error: message,
        }),
      );
    }
  });

  router.get("/companies/:companyId/external-event-sources/meta/pages", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const input = metaConnectPagesSchema.parse(req.query);
    const pages = await externalSvc.listMetaPages(companyId, input);
    res.json(pages);
  });

  router.get("/companies/:companyId/external-event-sources/meta/forms", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const input = metaConnectFormsSchema.parse(req.query);
    const forms = await externalSvc.listMetaLeadForms(companyId, input);
    res.json(forms);
  });

  router.post(
    "/companies/:companyId/external-event-sources/meta/connect",
    validate(metaConnectSourceSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await externalSvc.connectMetaLeadSource(
        companyId,
        req.body,
        actor.actorType === "user"
          ? { userId: actor.actorId, agentId: null }
          : { userId: null, agentId: actor.agentId },
      );

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        action: "external_source.meta_connected",
        entityType: "external_event_source",
        entityId: result.source.id,
        details: {
          sourceId: result.source.id,
          pageId: result.page.id,
          pageName: result.page.name,
          formId: result.formId,
        },
      });

      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/external-event-sources/whatsapp/connect",
    validate(whatsappConnectSourceSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await externalSvc.connectWhatsAppBusinessSource(
        companyId,
        req.body,
        actor.actorType === "user"
          ? { userId: actor.actorId, agentId: null }
          : { userId: null, agentId: actor.agentId },
        {
          publicBaseUrl: getPublicBaseUrl() ?? requestBaseUrl(req),
        },
      );

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        action: "external_source.whatsapp_connected",
        entityType: "external_event_source",
        entityId: result.source.id,
        details: {
          sourceId: result.source.id,
          apiKeySecretId: result.apiKeySecretId,
          sessionId: result.sessionId,
          sessionStatus: result.sessionStatus,
          baseUrl: result.baseUrl,
          webhookUrl: result.webhookUrl,
        },
      });

      res.json(result);
    },
  );

  router.get("/companies/:companyId/external-event-sources", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const filters = listExternalEventSourcesQuerySchema.parse(req.query);
    const sources = await externalSvc.listSources(companyId, filters);
    res.json(sources);
  });

  router.post(
    "/companies/:companyId/external-event-sources",
    validate(createExternalEventSourceSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const source = await externalSvc.createSource(companyId, req.body);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "external_source.created",
        entityType: "external_event_source",
        entityId: source.id,
        details: {
          pluginId: source.pluginId,
          name: source.name,
          reviewerAgentId: source.reviewerAgentId,
        },
      });

      res.status(201).json(source);
    },
  );

  router.get("/external-event-sources/:id", async (req, res) => {
    const id = req.params.id as string;
    const source = await externalSvc.getSourceById(id);
    if (!source) {
      res.status(404).json({ error: "External event source not found" });
      return;
    }
    assertCompanyAccess(req, source.companyId);
    res.json(source);
  });

  router.patch("/external-event-sources/:id", validate(updateExternalEventSourceSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await externalSvc.getSourceById(id);
    if (!existing) {
      res.status(404).json({ error: "External event source not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const source = await externalSvc.updateSource(id, req.body);
    await logActivity(db, {
      companyId: source.companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "external_source.updated",
      entityType: "external_event_source",
      entityId: source.id,
      details: req.body,
    });
    res.json(source);
  });

  router.delete("/external-event-sources/:id", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await externalSvc.getSourceById(id);
    if (!existing) {
      res.status(404).json({ error: "External event source not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const removed = await externalSvc.deleteSource(id);
    if (!removed) {
      res.status(404).json({ error: "External event source not found" });
      return;
    }

    await logActivity(db, {
      companyId: removed.companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "external_source.deleted",
      entityType: "external_event_source",
      entityId: removed.id,
      details: {
        pluginId: removed.pluginId,
        name: removed.name,
      },
    });

    res.json({ ok: true });
  });

  router.post("/external-event-sources/:id/pause", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await externalSvc.getSourceById(id);
    if (!existing) {
      res.status(404).json({ error: "External event source not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const source = await externalSvc.setSourceStatus(id, "paused");
    await logActivity(db, {
      companyId: source.companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "external_source.paused",
      entityType: "external_event_source",
      entityId: source.id,
    });
    res.json(source);
  });

  router.post("/external-event-sources/:id/resume", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await externalSvc.getSourceById(id);
    if (!existing) {
      res.status(404).json({ error: "External event source not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const source = await externalSvc.setSourceStatus(id, "active");
    await logActivity(db, {
      companyId: source.companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "external_source.resumed",
      entityType: "external_event_source",
      entityId: source.id,
    });
    res.json(source);
  });

  router.get("/companies/:companyId/meta-ops", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = externalOpsQuerySchema.parse(req.query);
    const snapshot = await externalSvc.getOpsSnapshot(companyId, query.limit);
    res.json(snapshot);
  });

  router.get("/companies/:companyId/external-ops", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = externalOpsQuerySchema.parse(req.query);
    const snapshot = await externalSvc.getOpsSnapshot(companyId, query.limit);
    res.json(snapshot);
  });

  router.post(
    "/companies/:companyId/external-events/reprocess",
    validate(reprocessExternalEventSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await externalSvc.reprocess(companyId, req.body);
      res.status(202).json({
        workflowRunId: result.run.id,
        eventId: result.run.eventId,
        skipped: result.skipped,
      });
    },
  );

  router.post(
    "/external-action-items/:id/request-approval",
    validate(requestActionItemApprovalSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const actor = getActorInfo(req);
      const result = await externalSvc.requestApprovalForActionItem(
        id,
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          companyId: req.actor.type === "agent" ? req.actor.companyId : null,
        },
        req.body,
      );
      res.status(201).json(result.approval);
    },
  );

  return router;
}
