// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("CompanyIntegrationsBuilder", () => {
  it("contains Meta and WhatsApp quick-connect flow labels", () => {
    const source = readFileSync(resolve(process.cwd(), "ui/src/pages/CompanyIntegrationsBuilder.tsx"), "utf8");
    expect(source).toContain("1. Facebook Lead Ads");
    expect(source).toContain("2. WhatsApp Business");
    expect(source).toContain("3. Summun Pipeline");
    expect(source).toContain("Continue with Facebook");
    expect(source).toContain("Connect WaSender");
  });

  it("uses direct WhatsApp connect without oauth popup flow", () => {
    const source = readFileSync(resolve(process.cwd(), "ui/src/pages/CompanyIntegrationsBuilder.tsx"), "utf8");
    expect(source).toContain("apiKeySecretId");
    expect(source).not.toContain("summun_whatsapp_oauth_result");
    expect(source).not.toContain("WA_EMBEDDED_SIGNUP");
  });

  it("retains meta oauth callback handling", () => {
    const source = readFileSync(resolve(process.cwd(), "ui/src/pages/CompanyIntegrationsBuilder.tsx"), "utf8");
    expect(source).toContain("meta_oauth");
    expect(source).toContain("meta_user_token_secret_id");
  });
});
