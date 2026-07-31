import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Tests for the SimpleReviewPage component structure and design decisions.
 * Since this is a frontend component, we test the file structure and key patterns.
 */

const componentPath = resolve(__dirname, "../client/src/pages/project/SimpleReviewPage.tsx");
const workspacePath = resolve(__dirname, "../client/src/pages/ProjectWorkspace.tsx");
const componentSource = readFileSync(componentPath, "utf-8");
const workspaceSource = readFileSync(workspacePath, "utf-8");

describe("SimpleReviewPage", () => {
  describe("Component structure", () => {
    it("exports a default function component", () => {
      expect(componentSource).toContain("export default function SimpleReviewPage");
    });

    it("accepts projectId, project, and optional docId props", () => {
      expect(componentSource).toContain("projectId: number");
      expect(componentSource).toContain("project: Project");
      expect(componentSource).toContain("docId?: string");
    });

    it("uses full-screen fixed positioning for takeover layout", () => {
      expect(componentSource).toContain("fixed inset-0 z-50");
    });
  });

  describe("Image viewer", () => {
    it("includes an ImageViewer component with zoom controls", () => {
      expect(componentSource).toContain("function ImageViewer");
      expect(componentSource).toContain("handleZoomIn");
      expect(componentSource).toContain("handleZoomOut");
    });

    it("supports rotation", () => {
      expect(componentSource).toContain("handleRotate");
      expect(componentSource).toContain("rotation");
    });

    it("supports brightness/contrast adjustment", () => {
      expect(componentSource).toContain("brightness");
      expect(componentSource).toContain("type=\"range\"");
    });

    it("supports pinch-to-zoom on mobile", () => {
      expect(componentSource).toContain("handleTouchStart");
      expect(componentSource).toContain("lastPinchDist");
    });

    it("supports fullscreen mode", () => {
      expect(componentSource).toContain("fullscreen");
      expect(componentSource).toContain("setFullscreen");
    });
  });

  describe("Transcription panel", () => {
    it("renders tags from metadata fields", () => {
      expect(componentSource).toContain("TAG_FIELDS");
      expect(componentSource).toContain("tags.map");
    });

    it("has collapsible metadata section", () => {
      expect(componentSource).toContain("metadataExpanded");
      expect(componentSource).toContain("setMetadataExpanded");
    });

    it("supports inline editing with contentEditable", () => {
      expect(componentSource).toContain("contentEditable");
      expect(componentSource).toContain("suppressContentEditableWarning");
    });

    it("shows auto-saved indicator", () => {
      expect(componentSource).toContain("Auto-saved");
      expect(componentSource).toContain("autoSaved");
    });

    it("includes researcher notes section", () => {
      expect(componentSource).toContain("Researcher Notes");
    });

    it("uses RTL-aware text direction", () => {
      expect(componentSource).toContain("dir=\"auto\"");
    });
  });

  describe("Action bar", () => {
    it("has Prev/Next navigation buttons", () => {
      expect(componentSource).toContain("handlePrev");
      expect(componentSource).toContain("handleNext");
      expect(componentSource).toContain("← Prev");
      expect(componentSource).toContain("→ Next");
    });

    it("has Skip button", () => {
      expect(componentSource).toContain("handleSkip");
      expect(componentSource).toContain("Skip");
    });

    it("has Flag button", () => {
      expect(componentSource).toContain("Flag");
      expect(componentSource).toContain("\"flagged\"");
    });

    it("has Approve button as primary action", () => {
      expect(componentSource).toContain("Approve");
      expect(componentSource).toContain("\"reviewed\"");
    });

    it("shows keyboard shortcut hints", () => {
      expect(componentSource).toContain("⌘ + Enter");
    });
  });

  describe("Keyboard shortcuts", () => {
    it("registers keyboard event listener", () => {
      expect(componentSource).toContain("addEventListener(\"keydown\"");
    });

    it("handles Cmd+Enter for approve", () => {
      expect(componentSource).toContain("(e.metaKey || e.ctrlKey) && e.key === \"Enter\"");
    });

    it("handles F key for flag", () => {
      expect(componentSource).toContain("e.key === \"f\" || e.key === \"F\"");
    });

    it("handles arrow keys for navigation", () => {
      expect(componentSource).toContain("e.key === \"ArrowLeft\"");
      expect(componentSource).toContain("e.key === \"ArrowRight\"");
    });

    it("skips shortcuts when typing in inputs", () => {
      expect(componentSource).toContain("tag === \"INPUT\" || tag === \"TEXTAREA\"");
    });
  });

  describe("Data integration", () => {
    it("fetches document list with needs_review filter", () => {
      expect(componentSource).toContain("trpc.documents.listPaginated.useQuery");
      expect(componentSource).toContain("status: \"needs_review\"");
    });

    it("fetches transcription by document", () => {
      expect(componentSource).toContain("trpc.transcriptions.getByDocument.useQuery");
    });

    it("fetches image URL", () => {
      expect(componentSource).toContain("trpc.documents.getImageUrl.useQuery");
    });

    it("fetches entities for highlighting", () => {
      expect(componentSource).toContain("trpc.entities.byDocument.useQuery");
    });

    it("uses saveReview mutation", () => {
      expect(componentSource).toContain("trpc.transcriptions.saveReview.useMutation");
    });

    it("supports cross-check AI verification", () => {
      expect(componentSource).toContain("trpc.documents.crossCheck.useMutation");
    });
  });

  describe("Header", () => {
    it("shows document counter (X of Y)", () => {
      expect(componentSource).toContain("{currentIndex + 1} of {total}");
    });

    it("shows remaining/approved/flagged stats", () => {
      expect(componentSource).toContain("{remaining} remaining");
      expect(componentSource).toContain("{approved} approved");
      expect(componentSource).toContain("{flagged} flagged");
    });

    it("has Check AI button", () => {
      expect(componentSource).toContain("Check AI");
    });

    it("has back navigation", () => {
      expect(componentSource).toContain("ArrowLeft");
    });

    it("shows progress bar", () => {
      expect(componentSource).toContain("progressPct");
    });
  });

  describe("Responsive layout", () => {
    it("uses flex-col on mobile, flex-row on desktop", () => {
      expect(componentSource).toContain("flex flex-col md:flex-row");
    });

    it("image panel takes 40vh on mobile, 50% on desktop", () => {
      expect(componentSource).toContain("h-[40vh] md:h-auto");
      expect(componentSource).toContain("md:w-1/2");
    });
  });

  describe("Workspace integration", () => {
    it("SimpleReviewPage is imported in ProjectWorkspace", () => {
      expect(workspaceSource).toContain("import SimpleReviewPage from \"./project/SimpleReviewPage\"");
    });

    it("route /review/:docId renders SimpleReviewPage", () => {
      expect(workspaceSource).toContain("SimpleReviewPage projectId={projectId} project={project} docId={params.docId}");
    });

    it("hides workspace chrome when in doc review", () => {
      expect(workspaceSource).toContain("isDocReview");
      expect(workspaceSource).toContain("location.match(/^\\/review\\/\\d+/)");
    });

    it("hides sidebar when in doc review", () => {
      expect(workspaceSource).toContain("isDocReview ? \"!hidden\" : \"\"");
    });
  });

  describe("Entity highlighting", () => {
    it("includes HighlightedText component", () => {
      expect(componentSource).toContain("function HighlightedText");
    });

    it("color-codes entities by type (person, location, organization)", () => {
      expect(componentSource).toContain("decoration-orange-400/60");
      expect(componentSource).toContain("decoration-emerald-400/60");
      expect(componentSource).toContain("decoration-indigo-400/60");
    });
  });

  describe("Dark theme consistency", () => {
    it("uses the archival dark background color", () => {
      expect(componentSource).toContain("bg-[#0f0e0a]");
    });

    it("uses warm cream text color", () => {
      expect(componentSource).toContain("text-[#e6e2db]");
    });

    it("uses the gold accent color for primary actions", () => {
      expect(componentSource).toContain("bg-[#f0bd8b]");
    });
  });
});
