import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BILLING_LAUNCH_ENABLED,
  FREE_DOCUMENT_LIMIT,
  PLANS,
  getDocumentLimit,
  isUnlimitedOwnerEmail,
} from "./billing/products";

describe("free-tier safeguards", () => {
  it("defines a 20-document free tier while paid checkout remains disabled", () => {
    expect(FREE_DOCUMENT_LIMIT).toBe(20);
    expect(getDocumentLimit("free")).toBe(20);
    expect(PLANS.free.features).toContain("20 documents");
    expect(BILLING_LAUNCH_ENABLED).toBe(false);
  });

  it("only grants unlimited document access to Adam's normalized owner email", () => {
    expect(isUnlimitedOwnerEmail(" ADAMAMIN2027@GMAIL.COM ")).toBe(true);
    expect(isUnlimitedOwnerEmail("researcher@example.com")).toBe(false);
    expect(isUnlimitedOwnerEmail(null)).toBe(false);
  });

  it("reserves a server-side document slot before storing an uploaded file and releases it on failure", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const uploadStart = source.indexOf("upload: protectedProcedure");
    const uploadEnd = source.indexOf("transcribe: protectedProcedure", uploadStart);
    const uploadBlock = source.slice(uploadStart, uploadEnd);

    expect(uploadBlock.indexOf("reserveDocumentQuotaSlot")).toBeGreaterThan(-1);
    expect(uploadBlock.indexOf("reserveDocumentQuotaSlot")).toBeLessThan(uploadBlock.indexOf("storagePut"));
    expect(uploadBlock).toContain("releaseDocumentQuotaSlot");
    expect(uploadBlock).toContain("document free-tier limit");
    expect(uploadBlock).toContain("Paid upgrades are not available yet.");
  });

  it("keeps paid checkout behind an explicit disabled launch gate", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const billingStart = source.indexOf("const billingRouter = router");
    const billingBlock = source.slice(billingStart);

    expect(billingBlock).toContain("if (!BILLING_LAUNCH_ENABLED)");
    expect(billingBlock).toContain("Paid upgrades are not available yet.");
  });

  it("charges project-owner capacity and blocks an oversized multi-page group before upload", () => {
    const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const uploadSource = readFileSync(new URL("../client/src/pages/project/UploadPage.tsx", import.meta.url), "utf8");

    expect(routerSource).toContain("reserveDocumentQuotaSlot(project.userId)");
    expect(uploadSource).toContain("isMultiPage && remaining !== null && pending.length > remaining");
    expect(uploadSource).toContain("This multi-page document has ${pending.length} pages");
  });

  it("directs capped users to Adam for additional usage", () => {
    const uploadSource = readFileSync(new URL("../client/src/pages/project/UploadPage.tsx", import.meta.url), "utf8");
    const billingSource = readFileSync(new URL("../client/src/pages/BillingPage.tsx", import.meta.url), "utf8");

    expect(uploadSource).toContain("Email adamamin2027@gmail.com for additional usage.");
    expect(uploadSource).toContain("mailto:adamamin2027@gmail.com");
    expect(billingSource).toContain("Email {CONTACT_EMAIL} for additional usage.");
  });
});
