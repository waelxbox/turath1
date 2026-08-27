import { afterEach, describe, expect, it, vi } from "vitest";

describe("Visual Archives feature flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is disabled unless the environment value is exactly true", async () => {
    vi.stubEnv("TURATH_VISUAL_ARCHIVES_ENABLED", "false");
    const { isVisualArchivesEnabled } = await import("./visualArchives/config");
    expect(isVisualArchivesEnabled()).toBe(false);
  });

  it("enables the controlled visual project mode when explicitly set", async () => {
    vi.stubEnv("TURATH_VISUAL_ARCHIVES_ENABLED", "true");
    const { isVisualArchivesEnabled } = await import("./visualArchives/config");
    expect(isVisualArchivesEnabled()).toBe(true);
  });
});
