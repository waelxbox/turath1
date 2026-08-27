import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../client/src/pages/visual/VisualWorkspace.tsx", import.meta.url), "utf8");

describe("VisualWorkspace Projects navigation", () => {
  it("uses an absolute dashboard anchor outside the project-scoped router", () => {
    expect(source).toContain('<a href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">');
    expect(source).not.toContain('<Link href="/dashboard"');
  });
});
