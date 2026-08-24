import { describe, expect, it } from "vitest";
import { assertRuntimeConfig, validateRuntimeConfig } from "./runtimeConfig";

const validEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@database.example/turath",
  APP_ORIGIN: "https://staging.turath.example",
  JWT_SECRET: "a-secure-secret-with-more-than-32-bytes",
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
  BUILT_IN_FORGE_API_URL: "https://forge.example/v1",
  BUILT_IN_FORGE_API_KEY: "forge-secret",
  TURATH_PRICING_ENABLED: "false",
};

describe("runtime configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(validateRuntimeConfig(validEnvironment)).toEqual([]);
    expect(() => assertRuntimeConfig(validEnvironment)).not.toThrow();
  });

  it("rejects missing and weak production secrets", () => {
    const issues = validateRuntimeConfig({
      ...validEnvironment,
      JWT_SECRET: "too-short",
      GOOGLE_CLIENT_SECRET: "",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "JWT_SECRET" }),
        expect.objectContaining({ key: "GOOGLE_CLIENT_SECRET" }),
      ])
    );
    expect(() =>
      assertRuntimeConfig({
        ...validEnvironment,
        JWT_SECRET: "too-short",
      })
    ).toThrow(/Unsafe production configuration/);
  });

  it("requires both Stripe secrets when pricing is enabled", () => {
    const issues = validateRuntimeConfig({
      ...validEnvironment,
      TURATH_PRICING_ENABLED: "true",
    });

    expect(issues.map(issue => issue.key)).toEqual(
      expect.arrayContaining([
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRO_PRICE_ID",
        "STRIPE_TEAM_PRICE_ID",
        "PUBLIC_APP_URL",
      ])
    );
  });

  it("reports issues without throwing outside production", () => {
    expect(() =>
      assertRuntimeConfig({ NODE_ENV: "development" })
    ).not.toThrow();
    expect(
      assertRuntimeConfig({ NODE_ENV: "development" }).length
    ).toBeGreaterThan(0);
  });
});
