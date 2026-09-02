import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: getDbMock }));

import {
  getPresentationUsageState,
  isPresentationUsageExempt,
  PRESENTATION_CONTACT_EMAIL,
  PRESENTATION_DOCUMENT_LIMIT,
  PRESENTATION_LIMIT_MESSAGE,
  PresentationUsageLimitError,
  reservePresentationDocumentUsage,
} from "./presentationUsage";

describe("presentation usage cap", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it("only exempts Adam's normalized email address", () => {
    expect(isPresentationUsageExempt(" ADAMAMIN2027@GMAIL.COM ")).toBe(true);
    expect(isPresentationUsageExempt("researcher@example.com")).toBe(false);
    expect(isPresentationUsageExempt(null)).toBe(false);
  });

  it("reports bounded remaining usage for demo accounts", () => {
    expect(getPresentationUsageState("researcher@example.com", 7)).toEqual({
      isExempt: false,
      used: 7,
      limit: PRESENTATION_DOCUMENT_LIMIT,
      remaining: 13,
    });
    expect(getPresentationUsageState("researcher@example.com", 25).remaining).toBe(0);
  });

  it("reports unlimited presenter access for Adam", () => {
    expect(getPresentationUsageState(PRESENTATION_CONTACT_EMAIL, 500)).toEqual({
      isExempt: true,
      used: 500,
      limit: null,
      remaining: null,
    });
  });

  it("uses a non-commercial limit message with a contact path", () => {
    expect(PRESENTATION_LIMIT_MESSAGE).toContain("20-document demo limit");
    expect(PRESENTATION_LIMIT_MESSAGE).toContain(PRESENTATION_CONTACT_EMAIL);
    expect(PRESENTATION_LIMIT_MESSAGE.toLowerCase()).not.toContain("upgrade");
  });

  it("rejects invalid reservation sizes before touching the database", async () => {
    await expect(reservePresentationDocumentUsage({
      userId: 1,
      email: "researcher@example.com",
      count: 0,
    })).rejects.toThrow("positive integer");
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("never consults or increments the counter for Adam", async () => {
    await expect(reservePresentationDocumentUsage({
      userId: 1,
      email: "AdamAmin2027@gmail.com",
      count: 100,
    })).resolves.toEqual({ isExempt: true, used: null, remaining: null });
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("fails closed when usage cannot be verified", async () => {
    getDbMock.mockResolvedValue(null);
    await expect(reservePresentationDocumentUsage({
      userId: 2,
      email: "researcher@example.com",
    })).rejects.toThrow("usage could not be verified");
  });

  it("returns the atomically reserved balance", async () => {
    const returning = vi.fn().mockResolvedValue([{ used: 12 }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    getDbMock.mockResolvedValue({ update });

    await expect(reservePresentationDocumentUsage({
      userId: 2,
      email: "researcher@example.com",
      count: 3,
    })).resolves.toEqual({ isExempt: false, used: 12, remaining: 8 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("rejects the whole reservation when the atomic cap predicate does not match", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    getDbMock.mockResolvedValue({ update });

    await expect(reservePresentationDocumentUsage({
      userId: 2,
      email: "researcher@example.com",
      count: 2,
    })).rejects.toBeInstanceOf(PresentationUsageLimitError);
  });

  it("guards every document AI entry point", () => {
    const source = readFileSync(resolve(__dirname, "../routers.ts"), "utf8");
    const routeRanges = [
      ["transcribe: protectedProcedure", "crossCheck: protectedProcedure"],
      ["crossCheck: protectedProcedure", "batchTranscribe: protectedProcedure"],
      ["batchTranscribe: protectedProcedure", "retryAllPending: protectedProcedure"],
      ["retryAllPending: protectedProcedure", "delete: protectedProcedure"],
      ["batchTranscribeAll: protectedProcedure", "transcribeWithContext: protectedProcedure"],
      ["transcribeWithContext: protectedProcedure", "// ─── Gamification Router"],
    ];

    for (const [startMarker, endMarker] of routeRanges) {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start + startMarker.length);
      expect(start, `${startMarker} route is missing`).toBeGreaterThanOrEqual(0);
      expect(end, `${endMarker} boundary is missing`).toBeGreaterThan(start);
      expect(source.slice(start, end), `${startMarker} must reserve usage`).toContain(
        "await reserveDocumentProcessingUsage(ctx.user",
      );
    }
  });
});
