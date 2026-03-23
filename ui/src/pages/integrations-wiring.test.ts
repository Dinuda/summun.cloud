// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("integrations page wiring", () => {
  it("registers the integrations route in App", () => {
    const source = readFileSync(resolve(process.cwd(), "ui/src/App.tsx"), "utf8");
    expect(source).toContain('path="company/integrations"');
  });

  it("shows integrations entry in the sidebar", () => {
    const source = readFileSync(resolve(process.cwd(), "ui/src/components/Sidebar.tsx"), "utf8");
    expect(source).toContain('to="/company/integrations"');
    expect(source).toContain('label="Integrations"');
  });
});
