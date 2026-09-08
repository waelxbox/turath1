import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BILLING_LAUNCH_ENABLED,
  FREE_DOCUMENT_LIMIT,
  PLANS,
  UNLIMITED_OWNER_EMAIL,
  getDocumentLimit,
  isUnlimitedOwnerEmail,
} from "./billing/products";
import { PLATFORM_OWNER_EMAIL } from "../shared/admin";

describe("free-tier safeguards", () => {
  it("defines a 20-document lifetime free tier alongside approved monthly prices", () => {
    expect(FREE_DOCUMENT_LIMIT).toBe(20);
    expect(getDocumentLimit("free")).toBe(20);
    expect(PLANS.free.features).toContain("20 documents");
    expect(BILLING_LAUNCH_ENABLED).toBe(true);
    expect([PLANS.pro.documentLimit, PLANS.team.documentLimit, PLANS.enterprise.documentLimit]).toEqual([100,300,1000]);
    expect([PLANS.pro.priceMonthly, PLANS.team.priceMonthly, PLANS.enterprise.priceMonthly]).toEqual([2000,5000,10000]);
  });

  it("only grants unlimited document access to Adam's normalized owner email", () => {
    expect(UNLIMITED_OWNER_EMAIL).toBe(PLATFORM_OWNER_EMAIL);
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
    expect(uploadBlock).toContain("lifetime free-tier");
    expect(uploadBlock).toContain("quota.reservationId");
  });

  it("keeps checkout behind runtime configuration checks", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const billingStart = source.indexOf("const billingRouter = router");
    const billingBlock = source.slice(billingStart);

    expect(billingBlock).toContain("if (!isPricingEnabled())");
    expect(billingBlock).toContain("Paid checkout is not configured yet.");
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
