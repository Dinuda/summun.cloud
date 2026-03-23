import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webhooksExternalRoutes } from "../routes/webhooks-external.js";
import { errorHandler } from "../middleware/index.js";

const mockExternalService = vi.hoisted(() => ({
  verifyWebhookChallenge: vi.fn(),
  verifyWebhookChallengeForCompany: vi.fn(),
  ingestWebhook: vi.fn(),
  ingestWebhookForCompany: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  externalIntegrationService: () => mockExternalService,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = { type: "none", source: "none" };
    next();
  });
  app.use("/api", webhooksExternalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("external webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes challenge requests via plugin and source ids", async () => {
    mockExternalService.verifyWebhookChallenge.mockResolvedValue({
      ok: true,
      challenge: "challenge-123",
    });

    const res = await request(createApp()).get("/api/webhooks/meta_leadgen/source-1").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
      "hub.challenge": "challenge-123",
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe("challenge-123");
    expect(mockExternalService.verifyWebhookChallenge).toHaveBeenCalledWith("meta_leadgen", "source-1", {
      mode: "subscribe",
      token: "token",
      challenge: "challenge-123",
    });
  });

  it("routes deliveries via plugin and source ids", async () => {
    mockExternalService.ingestWebhook.mockResolvedValue({
      kind: "accepted",
      event: { id: "event-1" },
      run: { id: "run-1" },
    });

    const res = await request(createApp())
      .post("/api/webhooks/meta_leadgen/source-1")
      .set("x-hub-signature-256", "sha256=abc")
      .send({ object: "page", entry: [] });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      accepted: true,
      duplicate: false,
      ignored: false,
      eventId: "event-1",
      workflowRunId: "run-1",
    });
    expect(mockExternalService.ingestWebhook).toHaveBeenCalled();
  });

  it("routes company meta challenge requests", async () => {
    mockExternalService.verifyWebhookChallengeForCompany.mockResolvedValue({
      ok: true,
      challenge: "company-challenge-123",
    });

    const res = await request(createApp()).get("/api/webhooks/meta_leadgen/company/company-1").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
      "hub.challenge": "company-challenge-123",
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe("company-challenge-123");
    expect(mockExternalService.verifyWebhookChallengeForCompany).toHaveBeenCalledWith(
      "meta_leadgen",
      "company-1",
      {
        mode: "subscribe",
        token: "token",
        challenge: "company-challenge-123",
      },
    );
  });

  it("routes generic company challenge requests for plugin ids", async () => {
    mockExternalService.verifyWebhookChallengeForCompany.mockResolvedValue({
      ok: true,
      challenge: "company-challenge-456",
    });

    const res = await request(createApp()).get("/api/webhooks/meta_whatsapp_business/company/company-2").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
      "hub.challenge": "company-challenge-456",
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe("company-challenge-456");
    expect(mockExternalService.verifyWebhookChallengeForCompany).toHaveBeenCalledWith(
      "meta_whatsapp_business",
      "company-2",
      {
        mode: "subscribe",
        token: "token",
        challenge: "company-challenge-456",
      },
    );
  });

  it("routes generic company deliveries for plugin ids", async () => {
    mockExternalService.ingestWebhookForCompany.mockResolvedValue({
      kind: "accepted",
      event: { id: "event-2" },
      run: { id: "run-2" },
    });

    const res = await request(createApp())
      .post("/api/webhooks/meta_whatsapp_business/company/company-2")
      .set("x-hub-signature-256", "sha256=abc")
      .send({ object: "whatsapp_business_account", entry: [] });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      accepted: true,
      duplicate: false,
      ignored: false,
      eventId: "event-2",
      workflowRunId: "run-2",
    });
    expect(mockExternalService.ingestWebhookForCompany).toHaveBeenCalled();
  });
});
