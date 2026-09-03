import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BILLING_LAUNCH_ENABLED,
  FREE_DOCUMENT_LIMIT,
  PLANS,
  getDocumentLimit,
} from "./billing/products";

describe("free-tier safeguards", () => {
  it("defines a 50-document free tier while paid checkout remains disabled", () => {
    expect(FREE_DOCUMENT_LIMIT).toBe(50);
    expect(getDocumentLimit("free")).toBe(50);
    expect(PLANS.free.features).toContain("50 documents");
    expect(BILLING_LAUNCH_ENABLED).toBe(false);
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
});
