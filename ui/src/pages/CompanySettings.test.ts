// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("CompanySettings external source handoff", () => {
  it("shows integrations builder CTA and removes old quick-connect section text", () => {
    const source = readFileSync(resolve(process.cwd(), "ui/src/pages/CompanySettings.tsx"), "utf8");
    expect(source).toContain("Open Integrations Builder");
    expect(source).toContain("Managed Meta Integrations");
  });
});
