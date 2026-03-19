import { describe, expect, it } from "vitest";
import {
  deriveEventIdempotencyKey,
  evaluateRulesConfig,
  extractNumericMetric,
} from "../services/external-integrations.js";

describe("external integration helpers", () => {
  it("extracts numeric metric values from nested payload paths", () => {
    const payload = {
      entry: [
        {
          metrics: {
            spend: "42.5",
            leads: 7,
          },
        },
      ],
    };

    expect(extractNumericMetric(payload, "entry.0.metrics.spend")).toBe(42.5);
    expect(extractNumericMetric(payload, "entry.0.metrics.leads")).toBe(7);
    expect(extractNumericMetric(payload, "entry.0.metrics.ctr")).toBeNull();
  });

  it("evaluates matching rules in any mode", () => {
    const payload = {
      metrics: {
        spend: 150,
        leads: 2,
      },
    };
    const rulesConfig = {
      mode: "any",
      rules: [
        { id: "spend-high", metric: "metrics.spend", operator: "gt", threshold: 100, title: "Spend spike" },
        { id: "lead-drop", metric: "metrics.leads", operator: "lt", threshold: 5, title: "Lead drop" },
      ],
    };

    const matches = evaluateRulesConfig(rulesConfig, payload);
    expect(matches).toHaveLength(2);
    expect(matches.map((item) => item.ruleKey)).toEqual(["spend-high", "lead-drop"]);
  });

  it("returns deterministic idempotency key from provider event id or body hash", () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(
      deriveEventIdempotencyKey({
        providerEventId: "meta-event-123",
        rawBody,
      }),
    ).toBe("provider:meta-event-123");

    const bodyKey = deriveEventIdempotencyKey({
      providerEventId: null,
      rawBody,
    });
    expect(bodyKey.startsWith("body:")).toBe(true);
    expect(bodyKey.length).toBeGreaterThan(20);
  });
});
