import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * UX Improvements Verification Tests
 * 
 * These tests verify that the UX overhaul changes are structurally correct
 * by checking that key files exist and contain the expected updated content.
 */

const CLIENT_SRC = resolve(__dirname, "../client/src");

describe("UX Improvements - Sidebar Navigation", () => {
  it("ProjectWorkspace contains grouped navigation with Process/Explore/Output/Project", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/ProjectWorkspace.tsx"), "utf-8");
    expect(content).toContain("Process");
    expect(content).toContain("Explore");
    expect(content).toContain("Output");
    expect(content).toContain("Project");
  });

  it("Sidebar uses renamed labels: Search archive, Ask Archive, Entities", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/ProjectWorkspace.tsx"), "utf-8");
    expect(content).toContain("Search archive");
    expect(content).toContain("Ask Archive");
    expect(content).toContain("Entities");
  });

  it("Sidebar shows disabled state with reason when no documents exist", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/ProjectWorkspace.tsx"), "utf-8");
    expect(content).toContain("disabledReason");
    expect(content).toContain("Upload documents first");
    expect(content).toContain("Approve documents to enable search");
  });

  it("Sidebar includes breadcrumb navigation", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/ProjectWorkspace.tsx"), "utf-8");
    expect(content).toContain("ChevronRight");
    expect(content).toContain("Projects");
  });
});

describe("UX Improvements - Project Overview (Next-Step Dashboard)", () => {
  it("Contains state-driven next-step dashboard", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ProjectOverview.tsx"), "utf-8");
    expect(content).toContain("Next step");
    expect(content).toContain("getWorkflowSteps");
    expect(content).toContain("getNextAction");
  });

  it("Has a persistent workflow checklist with all steps", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ProjectOverview.tsx"), "utf-8");
    expect(content).toContain("Your workflow");
    expect(content).toContain("Configure transcription");
    expect(content).toContain("Upload documents");
    expect(content).toContain("Review transcriptions");
    expect(content).toContain("Explore your archive");
    expect(content).toContain("Export data");
  });

  it("Shows dominant action card with ArrowRight CTA", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ProjectOverview.tsx"), "utf-8");
    expect(content).toContain("nextAction.action.label");
    expect(content).toContain("ArrowRight");
  });

  it("Shows quick actions only when reviewed content exists", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ProjectOverview.tsx"), "utf-8");
    expect(content).toContain("hasReviewed");
    expect(content).toContain("Search archive");
    expect(content).toContain("Ask Archive");
  });
});

describe("UX Improvements - Review Page", () => {
  it("Review actions use plain language: Approve, Flag for later, Re-read", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ReviewPage.tsx"), "utf-8");
    expect(content).toContain("Approve");
    expect(content).toContain("Flag for later");
    expect(content).toContain("Re-read");
  });

  it("Approval toast explains what becomes available", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ReviewPage.tsx"), "utf-8");
    expect(content).toContain("now available in Search, Ask Archive, and Entities");
  });

  it("Empty state explains what approval enables", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ReviewPage.tsx"), "utf-8");
    expect(content).toContain("Approving a document makes it available in Search, Ask Archive, and Entities");
  });
});
