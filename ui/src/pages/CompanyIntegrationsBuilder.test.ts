// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("CompanyIntegrationsBuilder", () => {
  it("contains managed meta one-click controls and zapier-like flow labels", () => {
    const source = readFileSync(resolve(process.cwd(), "ui/src/pages/CompanyIntegrationsBuilder.tsx"), "utf8");
    expect(source).toContain("Integrations Builder");
    expect(source).toContain("Connect with Meta login");
    expect(source).toContain("2. Meta Source Connect");
    expect(source).toContain("Advanced");
  });
});

