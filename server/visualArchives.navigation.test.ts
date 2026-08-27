import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../client/src/pages/visual/VisualWorkspace.tsx", import.meta.url), "utf8");

describe("VisualWorkspace Projects navigation", () => {
  it("uses an absolute dashboard anchor outside the project-scoped router", () => {
    expect(source).toContain('href="/dashboard" aria-label="Return to projects"');
    expect(source).toContain('href="/dashboard" className="hidden items-center gap-2 text-sm text-muted-foreground hover:text-foreground md:flex"');
    expect(source).not.toContain('<Link href="/dashboard"');
  });

  it("keeps the visual workspace self-contained with persistent evidence chat, explicit export feedback, and no simulated vector search", () => {
    expect(source).toContain("turath.visual-archive.${projectId}.conversation.v1");
    expect(source).toContain("ZIP download started. Your browser will show streaming progress.");
    expect(source).toContain("Semantic visual memory is not enabled");
    expect(source).toContain("findSimilarToUploadedImage");
  });

  it("declares record-review hooks before loading or missing-record returns", () => {
    const recordEditor = source.slice(source.indexOf("function RecordEditor"), source.indexOf("function RelationshipsPage"));
    const keyboardEffect = recordEditor.indexOf('useEffect(() => {\n    const onKeyDown');
    const loadingReturn = recordEditor.indexOf('if (isLoading) return');
    const missingReturn = recordEditor.indexOf('if (!record) return <div className="text-sm text-muted-foreground">Record not found.</div>');
    expect(keyboardEffect).toBeGreaterThan(-1);
    expect(loadingReturn).toBeGreaterThan(keyboardEffect);
    expect(missingReturn).toBeGreaterThan(keyboardEffect);
  });

  it("reconciles accept-all visibly and moves completed review actions to the next actionable Image", () => {
    const recordEditor = source.slice(source.indexOf("function RecordEditor"), source.indexOf("function RelationshipsPage"));
    expect(recordEditor).toContain('status: "needs_review", limit: 500');
    expect(recordEditor).toContain('setReviewOutcome({ kind: action === "accept" ? "accepted" : "rejected", count: fieldsToReview.length })');
    expect(recordEditor).toContain('The form and remaining review controls now reflect the saved revision.');
    expect(recordEditor).toContain('save("approved", true)');
    expect(recordEditor).toContain('navigate(`/records/${nextActionableRecordId}`)');
  });
});
