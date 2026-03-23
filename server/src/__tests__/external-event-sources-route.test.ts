import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { externalEventSourceRoutes } from "../routes/external-event-sources.js";
import { errorHandler } from "../middleware/index.js";

const mockExternalService = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  getCompanyPluginConfig: vi.fn(),
  upsertCompanyPluginConfig: vi.fn(),
  getRequiredMetaRuntimeConfig: vi.fn(),
  connectMetaLeadSource: vi.fn(),
  connectWhatsAppBusinessSource: vi.fn(),
  listMetaPages: vi.fn(),
  listMetaLeadForms: vi.fn(),
  listSources: vi.fn(),
  getSourceById: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  setSourceStatus: vi.fn(),
  getOpsSnapshot: vi.fn(),
  reprocess: vi.fn(),
  requestApprovalForActionItem: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  getByName: vi.fn(),
  create: vi.fn(),
  rotate: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  externalIntegrationService: () => mockExternalService,
  secretService: () => mockSecretService,
  logActivity: mockLogActivity,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      source: "local_implicit",
      userId: "user-1",
      agentId: null,
      runId: null,
    };
    next();
  });
  app.use("/api", externalEventSourceRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("external event source routes - whatsapp connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes whatsapp connect endpoint to service with wasender payload", async () => {
    mockExternalService.connectWhatsAppBusinessSource.mockResolvedValue({
      source: { id: "source-1" },
      apiKeySecretId: "00000000-0000-0000-0000-000000000001",
      sessionId: "session-1",
      sessionStatus: "disconnected",
      baseUrl: "https://wasenderapi.com",
      webhookUrl: "https://summun.local/api/webhooks/meta_whatsapp_business/company/company-1",
      webhookSecretConfigured: true,
      qrCode: null,
    });

    const res = await request(createApp())
      .post("/api/companies/company-1/external-event-sources/whatsapp/connect")
      .send({
        sourceName: "WhatsApp Source",
        reviewerAgentId: null,
        rulesConfig: { mode: "any", rules: [] },
        llmReviewTemplate: null,
        apiKeySecretId: "00000000-0000-0000-0000-000000000001",
        sessionId: "session-1",
        webhookSecret: "secret-1",
        baseUrl: "https://wasenderapi.com",
      });

    expect(res.status).toBe(200);
    expect(mockExternalService.connectWhatsAppBusinessSource).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        sourceName: "WhatsApp Source",
        apiKeySecretId: "00000000-0000-0000-0000-000000000001",
      }),
      {
        userId: "user-1",
        agentId: null,
      },
      expect.objectContaining({
        publicBaseUrl: expect.any(String),
      }),
    );
  });

  it("returns 404 for removed whatsapp oauth start endpoint", async () => {
    const res = await request(createApp()).get(
      "/api/companies/company-1/external-event-sources/whatsapp/oauth/start",
    );

    expect(res.status).toBe(404);
  });
});
