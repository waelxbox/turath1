import { useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Persistent review session hook.
 * Auto-restores position on mount, auto-saves on every state change.
 * Survives reload, tab change, and browser close (stored in DB).
 */

interface ReviewState {
  mode: string;
  currentDocumentId: number | null;
  currentLineIndex: number;
  reviewedLines: Map<number, { original: string; reviewed: string }>;
  selectedLanguage: string;
}

interface UseReviewSessionOptions {
  projectId: number;
  mode: string;
  currentDocumentId: number | null;
  currentLineIndex: number;
  reviewedLines: Map<number, { original: string; reviewed: string }>;
  selectedLanguage: string;
  // Setters for restoring state
  setCurrentDocIndex: (idx: number) => void;
  setCurrentLineIndex: (idx: number) => void;
  setReviewedLines: (lines: Map<number, { original: string; reviewed: string }>) => void;
  setSelectedLanguage: (lang: string) => void;
  // Documents list to find doc index from doc id
  documents: { id: number }[] | undefined;
}

export function useReviewSession(opts: UseReviewSessionOptions) {
  const {
    projectId, mode, currentDocumentId, currentLineIndex,
    reviewedLines, selectedLanguage,
    setCurrentDocIndex, setCurrentLineIndex, setReviewedLines, setSelectedLanguage,
    documents,
  } = opts;

  const hasRestored = useRef(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch saved session
  const { data: savedSession } = trpc.reviewSession.get.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  // Save mutation
  const saveMutation = trpc.reviewSession.save.useMutation();

  // Restore session on mount (once documents are loaded)
  useEffect(() => {
    if (hasRestored.current || !savedSession || !documents || documents.length === 0) return;
    hasRestored.current = true;

    // Restore language
    if (savedSession.selectedLanguage) {
      setSelectedLanguage(savedSession.selectedLanguage);
    }

    // Find the document index from saved document id
    if (savedSession.currentDocumentId) {
      const idx = documents.findIndex(d => d.id === savedSession.currentDocumentId);
      if (idx >= 0) {
        setCurrentDocIndex(idx);
      }
    }

    // Restore line index
    if (savedSession.currentLineIndex > 0) {
      setCurrentLineIndex(savedSession.currentLineIndex);
    }

    // Restore reviewed lines
    if (savedSession.reviewedLines && typeof savedSession.reviewedLines === "object") {
      const restored = new Map<number, { original: string; reviewed: string }>();
      const rl = savedSession.reviewedLines as Record<string, { original: string; reviewed: string }>;
      for (const [key, val] of Object.entries(rl)) {
        if (val && typeof val === "object" && "original" in val && "reviewed" in val) {
          restored.set(Number(key), { original: val.original, reviewed: val.reviewed });
        }
      }
      if (restored.size > 0) {
        setReviewedLines(restored);
      }
    }
  }, [savedSession, documents]);

  // Auto-save with debounce (500ms after last change)
  const saveSession = useCallback(() => {
    if (!currentDocumentId && !reviewedLines.size) return; // nothing to save

    // Convert Map to plain object for JSON serialization
    const reviewedObj: Record<string, { original: string; reviewed: string }> = {};
    reviewedLines.forEach((val, key) => {
      reviewedObj[String(key)] = val;
    });

    saveMutation.mutate({
      projectId,
      mode,
      currentDocumentId: currentDocumentId ?? null,
      currentLineIndex,
      reviewedLines: reviewedObj,
      selectedLanguage,
    });
  }, [projectId, mode, currentDocumentId, currentLineIndex, reviewedLines, selectedLanguage]);

  // Debounced save on state changes
  useEffect(() => {
    if (!hasRestored.current) return; // Don't save during restore
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(saveSession, 500);
    return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
  }, [currentDocumentId, currentLineIndex, reviewedLines.size, selectedLanguage, mode]);

  // Save immediately on page unload
  useEffect(() => {
    const handleBeforeUnload = () => saveSession();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveSession]);

  // Save on visibility change (tab switch)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") saveSession();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [saveSession]);

  return { hasRestored: hasRestored.current };
}
