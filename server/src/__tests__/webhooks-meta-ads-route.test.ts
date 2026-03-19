import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webhooksMetaAdsRoutes } from "../routes/webhooks-meta-ads.js";
import { errorHandler } from "../middleware/index.js";

const mockExternalService = vi.hoisted(() => ({
  verifyMetaWebhookChallenge: vi.fn(),
  ingestMetaWebhook: vi.fn(),
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
  app.use("/api", webhooksMetaAdsRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("meta ads webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns challenge text when verification succeeds", async () => {
    mockExternalService.verifyMetaWebhookChallenge.mockResolvedValue({
      ok: true,
      challenge: "challenge-123",
    });

    const res = await request(createApp()).get("/api/webhooks/meta-ads/source-1").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
      "hub.challenge": "challenge-123",
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe("challenge-123");
  });

  it("returns accepted payload for event deliveries", async () => {
    mockExternalService.ingestMetaWebhook.mockResolvedValue({
      kind: "accepted",
      event: { id: "event-1" },
      run: { id: "run-1" },
    });

    const res = await request(createApp())
      .post("/api/webhooks/meta-ads/source-1")
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
  });
});
