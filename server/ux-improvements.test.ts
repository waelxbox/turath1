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

describe("UX Improvements - Settings Page", () => {
  it("Advanced settings are collapsed by default", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ProjectSettings.tsx"), "utf-8");
    expect(content).toContain("showAdvanced");
    expect(content).toContain("Advanced settings");
    // Default state should be false (collapsed)
    expect(content).toContain("useState(false)");
  });

  it("Uses plain language labels for pipeline type", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ProjectSettings.tsx"), "utf-8");
    expect(content).toContain("How the AI reads documents");
    expect(content).toContain("Direct extraction");
    expect(content).toContain("Two-step");
  });

  it("Temperature slider uses plain language: Precise vs Creative", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/ProjectSettings.tsx"), "utf-8");
    expect(content).toContain("Precise");
    expect(content).toContain("Creative");
  });
});

describe("UX Improvements - Upload Page", () => {
  it("Shows success state with next-step guidance after upload", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/UploadPage.tsx"), "utf-8");
    expect(content).toContain("Upload complete");
    expect(content).toContain("Review transcriptions");
  });

  it("Uses simplified status labels", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/UploadPage.tsx"), "utf-8");
    expect(content).toContain("AI reading");
    expect(content).not.toContain("Transcribing…");
  });
});

describe("UX Improvements - Onboarding", () => {
  it("Uses plain language step labels", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/Onboarding.tsx"), "utf-8");
    expect(content).toContain("Teach the AI");
    expect(content).toContain("Check accuracy");
    expect(content).toContain("Start project");
  });

  it("Main CTA says Build my AI reader", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/Onboarding.tsx"), "utf-8");
    expect(content).toContain("Build my AI reader");
  });

  it("Generating step uses friendly language", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/Onboarding.tsx"), "utf-8");
    expect(content).toContain("Building your custom AI reader");
    expect(content).toContain("usually takes 30–60 seconds");
  });
});

describe("UX Improvements - Home Page", () => {
  it("Hero uses simplified copy without technical jargon", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/Home.tsx"), "utf-8");
    expect(content).toContain("Show the AI a few examples");
    expect(content).toContain("Start transcribing");
    expect(content).not.toContain("onboarding agent");
    expect(content).not.toContain("JSON schema");
  });

  it("Features section uses plain language", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/Home.tsx"), "utf-8");
    expect(content).toContain("Smart review interface");
    expect(content).toContain("Learns your terminology");
    expect(content).toContain("Track your progress");
  });
});

describe("UX Improvements - Entity Directory", () => {
  it("Empty state explains how entities are discovered", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/EntityDirectoryPage.tsx"), "utf-8");
    expect(content).toContain("automatically extracted when you approve documents");
  });
});

describe("UX Improvements - Search & Chat Pages", () => {
  it("Search page is renamed to Search archive", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/SemanticSearchPage.tsx"), "utf-8");
    expect(content).toContain("Search archive");
    expect(content).not.toContain(">Semantic Search<");
  });

  it("Chat page is renamed to Ask Archive", () => {
    const content = readFileSync(resolve(CLIENT_SRC, "pages/project/SemanticChatPage.tsx"), "utf-8");
    expect(content).toContain("Ask Archive");
    expect(content).not.toContain(">Semantic Chat<");
  });

  it("Uses 'approved' instead of 'reviewed' in user-facing copy", () => {
    const searchContent = readFileSync(resolve(CLIENT_SRC, "pages/project/SemanticSearchPage.tsx"), "utf-8");
    const chatContent = readFileSync(resolve(CLIENT_SRC, "pages/project/SemanticChatPage.tsx"), "utf-8");
    expect(searchContent).toContain("approved");
    expect(chatContent).toContain("approved");
  });
});
