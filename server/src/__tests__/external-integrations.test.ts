import { describe, expect, it } from "vitest";
import {
  assertSinglePluginSource,
  deriveEventIdempotencyKey,
  evaluateRulesConfig,
  extractLeadContactForWhatsApp,
  extractNumericMetric,
  normalizePhoneToE164,
  resolveManagedMetaRuntimeEnv,
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

  it("parses managed Meta runtime env when all required variables are present", () => {
    const resolved = resolveManagedMetaRuntimeEnv({
      SUMMUN_META_MANAGED_APP_ID: "1234567890",
      SUMMUN_META_MANAGED_APP_SECRET: "app-secret",
      SUMMUN_META_MANAGED_VERIFY_TOKEN: "verify-token",
    });
    expect(resolved).toEqual({
      metaAppId: "1234567890",
      appSecret: "app-secret",
      verifyToken: "verify-token",
    });
  });

  it("returns null when managed Meta runtime env is fully unset", () => {
    const resolved = resolveManagedMetaRuntimeEnv({});
    expect(resolved).toBeNull();
  });

  it("fails when managed Meta runtime env is partially configured", () => {
    expect(() =>
      resolveManagedMetaRuntimeEnv({
        SUMMUN_META_MANAGED_APP_ID: "1234567890",
        SUMMUN_META_MANAGED_APP_SECRET: "app-secret",
      }),
    ).toThrow("Managed Meta credentials are partially configured.");
  });

  it("enforces one-source-per-company guard for plugin sources", () => {
    expect(() =>
      assertSinglePluginSource(
        [{ id: "source-1" }, { id: "source-2" }],
        "meta_whatsapp_business",
      ),
    ).toThrow("Only one meta_whatsapp_business source is allowed per company");
  });

  it("allows updating the existing plugin source when exclude id is provided", () => {
    expect(() =>
      assertSinglePluginSource(
        [{ id: "source-1" }],
        "meta_whatsapp_business",
        "source-1",
      ),
    ).not.toThrow();
  });

  it("normalizes lead phone values to e164", () => {
    expect(normalizePhoneToE164("+94 77 123 4567")).toBe("+94771234567");
    expect(normalizePhoneToE164("0771234567", "+94")).toBe("+94771234567");
    expect(normalizePhoneToE164("0094-77-123-4567")).toBe("+94771234567");
    expect(normalizePhoneToE164("123")).toBeNull();
  });

  it("extracts lead contact name and phone from enriched field data", () => {
    const contact = extractLeadContactForWhatsApp(
      {
        full_name: "Dinuda Yaggahavita",
        phone_number: "0771234567",
      },
      "+94",
    );
    expect(contact.name).toBe("Dinuda Yaggahavita");
    expect(contact.phoneE164).toBe("+94771234567");
  });
});
