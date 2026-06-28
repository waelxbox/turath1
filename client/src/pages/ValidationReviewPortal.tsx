import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, Loader2, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

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

// ─── Dynamic Magnifying Glass (Loupe) + Zoom/Pan Image Viewer ───────────────

function LoupeImageViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });

  // Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);

  // Loupe state
  const [showLoupe, setShowLoupe] = useState(false);
  const [loupePos, setLoupePos] = useState({ x: 0, y: 0 });
  const [loupeEnabled, setLoupeEnabled] = useState(true);

  const LOUPE_SIZE = 180;
  const LOUPE_ZOOM = 2.5;

  const resetView = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  // ── Mouse handlers ──
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      // Pan mode when zoomed in
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      translateStart.current = { ...translate };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTranslate({ x: translateStart.current.x + dx, y: translateStart.current.y + dy });
      setShowLoupe(false);
      return;
    }

    // Loupe on hover (only when not dragging and loupe is enabled)
    if (!loupeEnabled || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      setShowLoupe(true);
      setLoupePos({ x: e.clientX, y: e.clientY });
    } else {
      setShowLoupe(false);
    }
  };

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => {
    setIsDragging(false);
    setShowLoupe(false);
  };

  // ── Wheel zoom ──
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => {
      const next = Math.max(1, Math.min(s * delta, 5));
      if (next <= 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  };

  // ── Touch handlers (pinch zoom + single-finger pan) ──
  // Track midpoint for two-finger pan
  const lastMidpoint = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Two-finger: start pinch-zoom + pan
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      lastMidpoint.current = { x: midX, y: midY };
      translateStart.current = { ...translate };
      setShowLoupe(false);
    } else if (e.touches.length === 1 && scale > 1) {
      // Single finger pan when zoomed
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      translateStart.current = { ...translate };
    } else if (e.touches.length === 1 && scale <= 1 && loupeEnabled && imgRef.current) {
      // Single touch on non-zoomed = loupe
      const touch = e.touches[0];
      const rect = imgRef.current.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        setShowLoupe(true);
        setLoupePos({ x: touch.clientX, y: touch.clientY });
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Two-finger: pinch zoom + drag pan simultaneously
      e.preventDefault();
      setShowLoupe(false);

      // Pinch zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastPinchDist.current !== null) {
        const delta = dist / lastPinchDist.current;
        setScale((s) => Math.max(1, Math.min(s * delta, 5)));
      }
      lastPinchDist.current = dist;

      // Two-finger drag pan
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      if (lastMidpoint.current) {
        const dx = midX - lastMidpoint.current.x;
        const dy = midY - lastMidpoint.current.y;
        setTranslate((t) => ({ x: t.x + dx, y: t.y + dy }));
      }
      lastMidpoint.current = { x: midX, y: midY };
    } else if (e.touches.length === 1) {
      if (scale > 1 && isDragging) {
        // Single-finger pan when zoomed
        const touch = e.touches[0];
        const dx = touch.clientX - dragStart.current.x;
        const dy = touch.clientY - dragStart.current.y;
        setTranslate({ x: translateStart.current.x + dx, y: translateStart.current.y + dy });
        setShowLoupe(false);
      } else if (scale <= 1 && loupeEnabled && imgRef.current) {
        // Loupe on touch drag
        const touch = e.touches[0];
        const rect = imgRef.current.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
          setShowLoupe(true);
          setLoupePos({ x: touch.clientX, y: touch.clientY });
        } else {
          setShowLoupe(false);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    lastPinchDist.current = null;
    lastMidpoint.current = null;
    setShowLoupe(false);
  };

  // ── Loupe style computation ──
  const getLoupeStyle = (): React.CSSProperties => {
    if (!imgRef.current) return {};
    const rect = imgRef.current.getBoundingClientRect();
    const relX = loupePos.x - rect.left;
    const relY = loupePos.y - rect.top;

    const scaleX = imgNatural.w / rect.width;
    const scaleY = imgNatural.h / rect.height;

    const bgW = imgNatural.w * LOUPE_ZOOM;
    const bgH = imgNatural.h * LOUPE_ZOOM;
    const bgX = -(relX * scaleX * LOUPE_ZOOM - LOUPE_SIZE / 2);
    const bgY = -(relY * scaleY * LOUPE_ZOOM - LOUPE_SIZE / 2);

    return {
      position: "fixed",
      left: loupePos.x - LOUPE_SIZE / 2,
      top: loupePos.y - LOUPE_SIZE / 2,
      width: LOUPE_SIZE,
      height: LOUPE_SIZE,
      borderRadius: "50%",
      border: "3px solid rgba(34, 197, 94, 0.7)",
      boxShadow: "0 0 20px rgba(34, 197, 94, 0.3), 0 4px 20px rgba(0,0,0,0.5)",
      backgroundImage: `url(${src})`,
      backgroundSize: `${bgW}px ${bgH}px`,
      backgroundPosition: `${bgX}px ${bgY}px`,
      backgroundRepeat: "no-repeat",
      pointerEvents: "none",
      zIndex: 1000,
    };
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative bg-neutral-900 overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      style={{ cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "crosshair" }}
    >
      <div className="w-full h-full flex items-center justify-center">
        <img
          ref={imgRef}
          src={src}
          alt="Document"
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
          onLoad={(e) => {
            const img = e.currentTarget;
            setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
      </div>

      {/* Loupe overlay */}
      {showLoupe && loupeEnabled && <div style={getLoupeStyle()} />}

      {/* Controls */}
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={() => setScale((s) => Math.min(s * 1.3, 5))}
          className="p-1.5 bg-neutral-800/80 hover:bg-neutral-700 rounded text-white"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setScale((s) => {
              const next = Math.max(s / 1.3, 1);
              if (next <= 1) setTranslate({ x: 0, y: 0 });
              return next;
            });
          }}
          className="p-1.5 bg-neutral-800/80 hover:bg-neutral-700 rounded text-white"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={resetView}
          className="p-1.5 bg-neutral-800/80 hover:bg-neutral-700 rounded text-white"
          title="Reset view"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={() => setLoupeEnabled((v) => !v)}
          className={`p-1.5 rounded text-white ${
            loupeEnabled ? "bg-green-700/80 hover:bg-green-600" : "bg-neutral-800/80 hover:bg-neutral-700"
          }`}
          title={loupeEnabled ? "Disable magnifier" : "Enable magnifier"}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="11" y1="8" x2="11" y2="14" />
          </svg>
        </button>
      </div>

      {/* Hint */}
      <div className="absolute bottom-2 left-2 text-[10px] text-neutral-500 bg-neutral-900/80 px-2 py-0.5 rounded">
        {scale > 1 ? "Drag to pan · Scroll to zoom" : "Hover for loupe · Scroll to zoom"}
      </div>
    </div>
  );
}

// ─── Review Interface ───────────────────────────────────────────────────────

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
  const [showFullContext, setShowFullContext] = useState(false);

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
      setShowFullContext(false);
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

      const newVerdicts = { ...reviewedVerdicts, [line.index]: verdict };
      setReviewedVerdicts(newVerdicts);

      // Move to next unreviewed line
      const nextIdx = lines.findIndex(
        (l, i) => i > currentLineIdx && !newVerdicts[l.index]
      );

      if (nextIdx >= 0) {
        setCurrentLineIdx(nextIdx);
      } else {
        // Check if there are any unreviewed lines before current
        const prevIdx = lines.findIndex((l) => !newVerdicts[l.index]);
        if (prevIdx >= 0) {
          setCurrentLineIdx(prevIdx);
        } else {
          // All lines reviewed - complete assignment
          await completeAssignmentMut.mutateAsync({
            assignmentId: assignment.id,
            totalLines: lines.length,
          });
          setIsComplete(true);
        }
      }
    } catch (err) {
      console.error("Failed to submit verdict:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Swipe gesture handling
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleSwipeStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleSwipeEnd = (e: React.TouchEvent) => {
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

  // If assignment loaded but no lines, auto-skip
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

  // Context lines: 2 before and 2 after current
  const CONTEXT_LINES = 2;
  const contextStart = Math.max(0, currentLineIdx - CONTEXT_LINES);
  const contextEnd = Math.min(lines.length - 1, currentLineIdx + CONTEXT_LINES);
  const contextLines = lines.slice(contextStart, contextEnd + 1);

  return (
    <div className="h-screen bg-neutral-950 flex flex-col overflow-hidden">
      {/* Compact header with progress */}
      <div className="flex-shrink-0 border-b border-neutral-800 px-3 py-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-neutral-500 truncate max-w-[40%]">
            {document?.filename}
          </div>
          <div className="text-[11px] text-neutral-400 font-mono">
            {reviewedCount}/{lines.length} · Line {currentLineIdx + 1}
          </div>
        </div>
        <div className="mt-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-orange-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Document image with loupe — ~55% of screen */}
      {document?.storageUrl && (
        <div className="flex-shrink-0" style={{ height: "55vh" }}>
          <LoupeImageViewer src={document.storageUrl} />
        </div>
      )}

      {/* Context lines section */}
      <div
        className="flex-1 min-h-0 overflow-y-auto border-t border-neutral-800 px-4 py-2"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
      >
        {!showFullContext ? (
          <div className="space-y-1">
            {contextLines.map((line, i) => {
              const actualIdx = contextStart + i;
              const isCurrent = actualIdx === currentLineIdx;
              return (
                <div
                  key={line.index}
                  className={`px-3 py-1.5 text-right leading-relaxed rounded ${
                    isCurrent
                      ? "border border-orange-500 bg-orange-500/5"
                      : ""
                  }`}
                  dir="rtl"
                  style={{ fontFamily: "'Noto Naskh Arabic', serif" }}
                >
                  <span className={`text-white ${isCurrent ? "text-base font-medium" : "text-sm"}`}>
                    {line.text}
                  </span>
                </div>
              );
            })}
            <button
              onClick={() => setShowFullContext(true)}
              className="w-full mt-2 py-1.5 text-xs text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-500 rounded transition-colors"
            >
              View Full Context
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {lines.map((line, idx) => {
              const isCurrent = idx === currentLineIdx;
              return (
                <div
                  key={line.index}
                  className={`px-3 py-1 text-right leading-relaxed rounded ${
                    isCurrent
                      ? "border border-orange-500 bg-orange-500/5"
                      : ""
                  }`}
                  dir="rtl"
                  style={{ fontFamily: "'Noto Naskh Arabic', serif" }}
                >
                  <span className={`text-white ${isCurrent ? "text-sm font-medium" : "text-xs"}`}>
                    {line.text}
                  </span>
                </div>
              );
            })}
            <button
              onClick={() => setShowFullContext(false)}
              className="w-full mt-2 py-1.5 text-xs text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-500 rounded transition-colors"
            >
              Collapse Context
            </button>
          </div>
        )}
      </div>

      {/* Action buttons - fixed at bottom */}
      <div className="flex-shrink-0 border-t border-neutral-800 px-4 py-3 bg-neutral-950">
        <div className="flex gap-3 max-w-md mx-auto">
          <button
            onClick={() => handleVerdict("incorrect")}
            disabled={isSubmitting}
            className="flex-1 py-3.5 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-400 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-95"
          >
            <XCircle className="w-5 h-5" />
            Incorrect
          </button>
          <button
            onClick={() => handleVerdict("correct")}
            disabled={isSubmitting}
            className="flex-1 py-3.5 bg-green-600/20 hover:bg-green-600/30 border border-green-600/50 text-green-400 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-95"
          >
            <CheckCircle2 className="w-5 h-5" />
            Correct
          </button>
        </div>
        <p className="text-center text-[10px] text-neutral-600 mt-1">
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
