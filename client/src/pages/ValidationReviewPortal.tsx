import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, Loader2, ChevronRight } from "lucide-react";

// ─── Username Gate ──────────────────────────────────────────────────────────

function UsernameGate({ onSubmit }: { onSubmit: (username: string) => void }) {
  const [name, setName] = useState("");

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold text-white">TURATH Review</h1>
          <p className="text-neutral-400 mt-2 text-sm">
            Enter your name to begin reviewing transcriptions
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) {
              localStorage.setItem("turath_reviewer_username", name.trim());
              onSubmit(name.trim());
            }
          }}
          className="space-y-4"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-lg placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-semibold rounded-lg transition-colors"
          >
            Start Reviewing
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Fixed Highlight Review Interface ───────────────────────────────────────

function ReviewInterface({
  shareToken,
  username,
}: {
  shareToken: string;
  username: string;
}) {
  const [currentLineIdx, setCurrentLineIdx] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [allDocsComplete, setAllDocsComplete] = useState(false);
  const linesContainerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Fetch assignment
  const getAssignment = trpc.validation.getNextAssignment.useMutation();
  const submitVerdict = trpc.validation.submitVerdict.useMutation();
  const completeAssignmentMut = trpc.validation.completeAssignment.useMutation();
  const progress = trpc.validation.getProgress.useQuery(
    { shareToken, reviewerUsername: username },
    { refetchInterval: 10000 }
  );

  const [assignment, setAssignment] = useState<{
    id: number;
    sessionId: number;
    documentId: number;
    status: string;
    linesReviewed: number;
    totalLines: number;
  } | null>(null);
  const [document, setDocument] = useState<{
    id: number;
    filename: string;
    storageUrl: string | null;
  } | null>(null);
  const [lines, setLines] = useState<{ index: number; text: string }[]>([]);
  const [reviewedVerdicts, setReviewedVerdicts] = useState<
    Record<number, "correct" | "incorrect">
  >({});

  const loadNextAssignment = useCallback(async () => {
    try {
      const result = await getAssignment.mutateAsync({
        shareToken,
        reviewerUsername: username,
      });
      if (!result.assignment) {
        setAllDocsComplete(true);
        return;
      }
      setAssignment(result.assignment);
      setDocument(result.document);
      setLines(result.lines);
      // Restore already-reviewed lines
      const existing: Record<number, "correct" | "incorrect"> = {};
      for (const r of result.existingReviews) {
        existing[r.lineIndex] = r.verdict as "correct" | "incorrect";
      }
      setReviewedVerdicts(existing);
      // Start from first unreviewed line
      const firstUnreviewed = result.lines.findIndex(
        (l) => !existing[l.index]
      );
      setCurrentLineIdx(firstUnreviewed >= 0 ? firstUnreviewed : 0);
      setIsComplete(false);
    } catch (err) {
      console.error("Failed to load assignment:", err);
    }
  }, [shareToken, username]);

  useEffect(() => {
    loadNextAssignment();
  }, []);

  // Scroll to keep current line centered in the highlight zone
  useEffect(() => {
    if (!linesContainerRef.current) return;
    const container = linesContainerRef.current;
    const lineElements = container.querySelectorAll("[data-line-idx]");
    const targetEl = lineElements[currentLineIdx] as HTMLElement | undefined;
    if (targetEl) {
      const containerHeight = container.clientHeight;
      const targetTop = targetEl.offsetTop;
      const targetHeight = targetEl.offsetHeight;
      // Center the target line in the container
      const scrollTo = targetTop - containerHeight / 2 + targetHeight / 2;
      container.scrollTo({ top: scrollTo, behavior: "smooth" });
    }
  }, [currentLineIdx, lines]);

  const handleVerdict = async (verdict: "correct" | "incorrect") => {
    if (!assignment || isSubmitting || currentLineIdx >= lines.length) return;
    setIsSubmitting(true);

    const line = lines[currentLineIdx];
    try {
      await submitVerdict.mutateAsync({
        assignmentId: assignment.id,
        sessionId: assignment.sessionId,
        documentId: assignment.documentId,
        reviewerUsername: username,
        lineIndex: line.index,
        lineText: line.text,
        verdict,
      });

      setReviewedVerdicts((prev) => ({ ...prev, [line.index]: verdict }));

      // Move to next unreviewed line
      const nextIdx = lines.findIndex(
        (l, i) =>
          i > currentLineIdx && !reviewedVerdicts[l.index] && l.index !== line.index
      );

      if (nextIdx >= 0) {
        setCurrentLineIdx(nextIdx);
      } else {
        // All lines reviewed - complete assignment
        await completeAssignmentMut.mutateAsync({
          assignmentId: assignment.id,
          totalLines: lines.length,
        });
        setIsComplete(true);
      }
    } catch (err) {
      console.error("Failed to submit verdict:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Swipe gesture handling
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) handleVerdict("correct");
      else handleVerdict("incorrect");
    }
  };

  // All docs complete screen
  if (allDocsComplete) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
          </div>
          <h2 className="text-xl font-bold text-white">All Done!</h2>
          <p className="text-neutral-400 max-w-xs mx-auto">
            You've reviewed all available documents. Thank you for your help!
          </p>
          {progress.data && (
            <p className="text-sm text-neutral-500">
              Documents completed: {progress.data.completed}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Document complete - load next
  if (isComplete) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-orange-500/20 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-orange-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Document Complete!</h2>
          <p className="text-neutral-400">
            {document?.filename ?? "Document"} reviewed successfully.
          </p>
          <button
            onClick={() => {
              setIsComplete(false);
              setAssignment(null);
              setDocument(null);
              setLines([]);
              setReviewedVerdicts({});
              setCurrentLineIdx(0);
              loadNextAssignment();
            }}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
          >
            Next Document <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (!assignment) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  // If assignment loaded but no lines (no Arabic text in this doc), auto-skip to next
  if (lines.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <p className="text-neutral-400">No Arabic text found in this document. Skipping...</p>
          <button
            onClick={() => {
              completeAssignmentMut.mutate(
                { assignmentId: assignment.id, totalLines: 0 },
                {
                  onSuccess: () => {
                    setAssignment(null);
                    setDocument(null);
                    setLines([]);
                    setReviewedVerdicts({});
                    setCurrentLineIdx(0);
                    loadNextAssignment();
                  },
                }
              );
            }}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
          >
            Skip to Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  const currentLine = lines[currentLineIdx];
  const reviewedCount = Object.keys(reviewedVerdicts).length;
  const progressPct = lines.length > 0 ? (reviewedCount / lines.length) * 100 : 0;

  return (
    <div
      className="min-h-screen bg-neutral-950 flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="flex-shrink-0 border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-neutral-500 truncate max-w-[50%]">
            {document?.filename}
          </div>
          <div className="text-xs text-neutral-400">
            {reviewedCount}/{lines.length} lines
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-orange-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Document image (collapsible on mobile) */}
      {document?.storageUrl && (
        <div className="flex-shrink-0 h-[30vh] border-b border-neutral-800 bg-neutral-900 overflow-hidden">
          <img
            src={document.storageUrl}
            alt="Document"
            className="w-full h-full object-contain"
          />
        </div>
      )}

      {/* Lines viewport with fixed orange highlight */}
      <div className="flex-1 relative overflow-hidden">
        {/* Fixed orange highlight box - centered vertically */}
        <div
          ref={highlightRef}
          className="absolute left-2 right-2 top-1/2 -translate-y-1/2 border-2 border-orange-500 rounded-lg bg-orange-500/10 pointer-events-none z-10"
          style={{ minHeight: "3rem", padding: "0.5rem 0" }}
        />

        {/* Scrollable lines container */}
        <div
          ref={linesContainerRef}
          className="absolute inset-0 overflow-y-auto px-4"
          style={{ scrollBehavior: "smooth" }}
        >
          {/* Top spacer to allow first line to reach center */}
          <div style={{ height: "45vh" }} />

          {lines.map((line, idx) => {
            const isCurrentLine = idx === currentLineIdx;
            const verdict = reviewedVerdicts[line.index];
            return (
              <div
                key={line.index}
                data-line-idx={idx}
                className={`py-2 px-3 text-right leading-relaxed transition-all duration-200 rounded-lg mb-1 ${
                  isCurrentLine
                    ? "text-white text-lg font-medium"
                    : verdict === "correct"
                    ? "text-green-400/70 text-base"
                    : verdict === "incorrect"
                    ? "text-red-400/70 text-base line-through"
                    : "text-white/80 text-base"
                }`}
                dir="rtl"
                style={{ fontFamily: "'Noto Naskh Arabic', serif" }}
              >
                {line.text}
                {verdict && (
                  <span className="inline-block ml-2 text-xs">
                    {verdict === "correct" ? "✓" : "✗"}
                  </span>
                )}
              </div>
            );
          })}

          {/* Bottom spacer */}
          <div style={{ height: "45vh" }} />
        </div>
      </div>

      {/* Action buttons - fixed at bottom */}
      <div className="flex-shrink-0 border-t border-neutral-800 p-4 bg-neutral-950">
        <div className="flex gap-3 max-w-md mx-auto">
          <button
            onClick={() => handleVerdict("incorrect")}
            disabled={isSubmitting}
            className="flex-1 py-4 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-400 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-95"
          >
            <XCircle className="w-5 h-5" />
            Incorrect
          </button>
          <button
            onClick={() => handleVerdict("correct")}
            disabled={isSubmitting}
            className="flex-1 py-4 bg-green-600/20 hover:bg-green-600/30 border border-green-600/50 text-green-400 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-95"
          >
            <CheckCircle2 className="w-5 h-5" />
            Correct
          </button>
        </div>
        <p className="text-center text-xs text-neutral-600 mt-2">
          Swipe right = correct · Swipe left = incorrect
        </p>
      </div>
    </div>
  );
}

// ─── Main Portal Component ──────────────────────────────────────────────────

export default function ValidationReviewPortal() {
  const [, params] = useRoute("/review/:token");
  const shareToken = params?.token ?? "";
  const [username, setUsername] = useState<string | null>(
    () => localStorage.getItem("turath_reviewer_username")
  );

  // Verify session exists
  const sessionQuery = trpc.validation.getSession.useQuery(
    { shareToken },
    { enabled: !!shareToken, retry: false }
  );

  if (!shareToken) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-400">Invalid review link</p>
      </div>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (sessionQuery.error || !sessionQuery.data) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <p className="text-red-400 font-medium">Review session not found</p>
          <p className="text-neutral-500 text-sm">
            This link may be expired or invalid.
          </p>
        </div>
      </div>
    );
  }

  if (sessionQuery.data.status === "closed") {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <p className="text-orange-400 font-medium">Session Closed</p>
          <p className="text-neutral-500 text-sm">
            This review session has been closed by the administrator.
          </p>
        </div>
      </div>
    );
  }

  if (!username) {
    return <UsernameGate onSubmit={setUsername} />;
  }

  return <ReviewInterface shareToken={shareToken} username={username} />;
}
