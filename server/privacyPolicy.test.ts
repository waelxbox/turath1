import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const privacyPolicyPath = path.resolve(process.cwd(), "client/src/pages/PrivacyPolicy.tsx");

describe("Privacy policy infrastructure claims", () => {
  it("uses accurate managed-service language instead of unverified provider, region, and compliance promises", async () => {
    const source = await readFile(privacyPolicyPath, "utf8");

    expect(source).toContain("Managed, access-controlled object storage");
    expect(source).toContain("Supabase-managed PostgreSQL");
    expect(source).toContain("applicable Google API terms and data-use policy");
    expect(source).not.toContain("AWS S3");
    expect(source).not.toContain("AWS) S3");
    expect(source).not.toContain("US region");
    expect(source).not.toContain("AES-256");
    expect(source).not.toContain("TLS 1.2+");
    expect(source).not.toContain("GDPR Compliance");
    expect(source).not.toContain("not retained by Google");
    expect(source).not.toContain("within 7 business days");
  });
});
