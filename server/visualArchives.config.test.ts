import { afterEach, describe, expect, it, vi } from "vitest";

describe("Visual Archives feature flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is disabled unless the environment value is exactly true", async () => {
    vi.stubEnv("TURATH_VISUAL_ARCHIVES_ENABLED", "false");
    const { isVisualArchivesEnabled, isVisualArchivesMemoryEnabled } = await import("./visualArchives/config");
    expect(isVisualArchivesEnabled()).toBe(false);
    expect(isVisualArchivesMemoryEnabled()).toBe(false);
  });

  it("enables the controlled visual project mode when explicitly set", async () => {
    vi.stubEnv("TURATH_VISUAL_ARCHIVES_ENABLED", "true");
    const { isVisualArchivesEnabled } = await import("./visualArchives/config");
    expect(isVisualArchivesEnabled()).toBe(true);
  });

  it("keeps vector-backed visual memory unavailable until explicitly enabled", async () => {
    vi.stubEnv("TURATH_VISUAL_ARCHIVES_ENABLED", "true");
    vi.stubEnv("TURATH_VISUAL_ARCHIVES_MEMORY_ENABLED", "false");
    const { isVisualArchivesMemoryEnabled } = await import("./visualArchives/config");
    expect(isVisualArchivesMemoryEnabled()).toBe(false);
  });
});
