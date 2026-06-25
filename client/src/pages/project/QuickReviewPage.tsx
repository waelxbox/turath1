import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useReviewSession } from "@/hooks/useReviewSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  CheckCircle2, Edit3, ChevronRight, ChevronLeft, Zap,
  Flame, Trophy, Star, SkipForward, Loader2, ImageIcon,
  ThumbsUp, ThumbsDown, ClipboardCheck,
  Maximize2, X, Minus, Plus, Pyramid
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useSessionState } from "@/hooks/useSessionState";
import PyramidReviewMode from "./PyramidReviewMode";

type ReviewMode = "classic" | "pyramid";

interface Props {
  projectId: number;
}

type ReviewPhase = "lines" | "metadata" | "complete";

// XP animation component
function XpPopup({ xp, show }: { xp: number; show: boolean }) {
  if (!show) return null;
  return (
    <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce text-yellow-400 font-bold text-lg pointer-events-none z-50">
      +{xp} XP
    </div>
  );
}

// Level badge
function LevelBadge({ level }: { level: number }) {
  const colors = [
    "bg-zinc-700 text-zinc-300",
    "bg-emerald-900 text-emerald-300",
    "bg-blue-900 text-blue-300",
    "bg-purple-900 text-purple-300",
    "bg-amber-900 text-amber-300",
    "bg-red-900 text-red-300",
  ];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${colors[Math.min(level, colors.length - 1)]}`}>
      <Star className="w-3 h-3" />
      Lvl {level}
    </span>
  );
}

// Fields that are per-page (text content) — NOT shown in metadata verification
const TEXT_FIELDS = new Set([
  "transcription", "original_text", "text", "content", "translation",
  "transliteration", "notes", "marginalia", "commentary"
]);

// Fields to skip in metadata verification (internal/obvious)
const SKIP_FIELDS = new Set([
  "page_number", "section_of_act", "folio_number"
]);

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// Swipe gesture hook
function useSwipe(
  ref: React.RefObject<HTMLElement | null>,
  { onSwipeLeft, onSwipeRight, threshold = 50 }: {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    threshold?: number;
  }
) {
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      swiping.current = true;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!swiping.current) return;
      swiping.current = false;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const deltaX = endX - startX.current;
      const deltaY = endY - startY.current;

      // Only trigger if horizontal movement is dominant
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight();
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft();
        }
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [ref, onSwipeLeft, onSwipeRight, threshold]);
}

/**
 * Pan & Zoom image viewer.
 * - Drag/one-finger pan to move around the image
 * - Pinch to zoom on touch devices
 * - Double-tap to toggle between fit and 2.5x zoom
 * - +/- buttons and fullscreen mode
 * - "Reset" button to snap back to fit view
 */
export function PanZoomImageViewer({
  src,
  alt,
  isMobile,
}: {
  src: string;
  alt: string;
  isMobile: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const lastTap = useRef(0);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.5, 6));
  };
  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - 0.5, 1);
    setZoom(newZoom);
    if (newZoom === 1) setPan({ x: 0, y: 0 });
  };
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Double-tap to toggle zoom
  const handleDoubleTap = (clientX: number, clientY: number) => {
    if (zoom > 1.5) {
      // Zoom out to fit
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      // Zoom in to 2.5x centered on tap point
      const container = containerRef.current;
      if (!container) { setZoom(2.5); return; }
      const rect = container.getBoundingClientRect();
      const tapX = clientX - rect.left - rect.width / 2;
      const tapY = clientY - rect.top - rect.height / 2;
      setZoom(2.5);
      setPan({ x: -tapX * 1.5, y: -tapY * 1.5 });
    }
  };

  // Mouse events for desktop drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  };
  const handleMouseUp = () => { dragging.current = false; };

  // Touch events for mobile pan + pinch + double-tap
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      // Check for double-tap
      const now = Date.now();
      if (now - lastTap.current < 300) {
        handleDoubleTap(e.touches[0].clientX, e.touches[0].clientY);
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;

      // Start drag (only if zoomed in)
      if (zoom > 1) {
        dragging.current = true;
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    } else if (e.touches.length === 2) {
      // Start pinch
      dragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && dragging.current) {
      const dx = e.touches[0].clientX - lastPos.current.x;
      const dy = e.touches[0].clientY - lastPos.current.y;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist.current > 0) {
        const scale = dist / lastPinchDist.current;
        setZoom(prev => Math.max(1, Math.min(6, prev * scale)));
      }
      lastPinchDist.current = dist;
    }
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    dragging.current = false;
    if (e.touches.length < 2) lastPinchDist.current = 0;
    // Snap back if zoom is near 1
    if (zoom < 1.1) { setZoom(1); setPan({ x: 0, y: 0 }); }
  };

  // Mouse wheel zoom for desktop
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    const newZoom = Math.max(1, Math.min(6, zoom + delta));
    setZoom(newZoom);
    if (newZoom === 1) setPan({ x: 0, y: 0 });
  };

  const viewer = (
    <div className={`relative flex flex-col ${fullscreen ? "fixed inset-0 z-[100] bg-black" : "h-full"}`}>
      {/* Controls bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 bg-black/80 border-b border-white/10">
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleZoomOut}
            disabled={zoom <= 1}
            className="p-1.5 rounded text-white/70 hover:text-white disabled:text-white/30 active:bg-white/10"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-[11px] text-white/70 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={handleZoomIn}
            disabled={zoom >= 6}
            className="p-1.5 rounded text-white/70 hover:text-white disabled:text-white/30 active:bg-white/10"
          >
            <Plus className="w-4 h-4" />
          </button>
          {zoom > 1 && (
            <button
              onClick={handleReset}
              className="ml-1 px-2 py-0.5 rounded text-[10px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10"
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isMobile && zoom <= 1 && (
            <span className="text-[9px] text-white/40">double-tap to zoom</span>
          )}
          {isMobile && zoom > 1 && (
            <span className="text-[9px] text-white/40">drag to pan</span>
          )}
          {!fullscreen ? (
            <button
              onClick={() => setFullscreen(true)}
              className="p-1.5 rounded text-white/70 hover:text-white active:bg-white/10"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => setFullscreen(false)}
              className="p-1.5 rounded text-white/70 hover:text-white active:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Pan/zoom image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center bg-black/40"
        style={{ cursor: zoom > 1 ? "grab" : "default", touchAction: "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
      >
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-full object-contain select-none pointer-events-none"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transition: dragging.current ? "none" : "transform 0.15s ease-out",
          }}
          draggable={false}
        />
      </div>
    </div>
  );

  if (fullscreen) return <>{viewer}</>;
  return viewer;
}

export default function QuickReviewPage({ projectId }: Props) {
  const [mode, setMode] = useSessionState<ReviewMode>(`turath-review-mode-${projectId}`, "classic");

  // Mode toggle — shown at top of both modes
  if (mode === "pyramid") {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Mode toggle bar */}
        <div className="flex-shrink-0 flex items-center justify-center gap-1 px-3 py-1.5 bg-card/30 border-b border-border">
          <button
            onClick={() => setMode("classic")}
            className="px-3 py-1 rounded-full text-[10px] font-medium transition-colors text-muted-foreground hover:text-foreground"
          >
            Classic
          </button>
          <button
            onClick={() => setMode("pyramid")}
            className="px-3 py-1 rounded-full text-[10px] font-medium transition-colors bg-amber-500/20 text-amber-300 border border-amber-500/30"
          >
            <span className="inline-flex items-center gap-1"><Pyramid className="w-3 h-3" /> Pyramid</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <PyramidReviewMode projectId={projectId} />
        </div>
      </div>
    );
  }

  return <ClassicReviewMode projectId={projectId} mode={mode} setMode={setMode} />;
}

function ClassicReviewMode({ projectId, mode, setMode }: Props & { mode: ReviewMode; setMode: (m: ReviewMode) => void }) {
  const [currentDocIndex, setCurrentDocIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedLine, setEditedLine] = useState("");
  const [reviewedLines, setReviewedLines] = useState<Map<number, { original: string; reviewed: string }>>(new Map());
  const [showXp, setShowXp] = useState(false);
  const [lastXp, setLastXp] = useState(0);
  const [phase, setPhase] = useState<ReviewPhase>("lines");
  const [metadataIndex, setMetadataIndex] = useState(0);
  const [metadataVerifications, setMetadataVerifications] = useState<Map<string, boolean>>(new Map());
  const [metadataCorrections, setMetadataCorrections] = useState<Map<string, string>>(new Map());
  const [editingMetaField, setEditingMetaField] = useState<string | null>(null);
  const [editingMetaValue, setEditingMetaValue] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [showImage, setShowImage] = useState(true); // mobile image toggle — default ON
  const inputRef = useRef<HTMLInputElement>(null);
  const metaInputRef = useRef<HTMLInputElement>(null);
  const swipeRef = useRef<HTMLDivElement>(null);
  const metaSwipeRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();

  // Fetch available languages for this project
  const { data: languages } = trpc.documents.getLanguages.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  // Fetch documents that need review (filtered by language if selected)
  const { data: documents, isLoading: docsLoading } = trpc.documents.listPaginated.useQuery(
    { projectId, status: "needs_review", limit: 100, language: selectedLanguage || undefined },
    { enabled: !!projectId }
  );

  // Fetch user stats
  const { data: stats, refetch: refetchStats } = trpc.gamification.myStats.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  // Fetch leaderboard
  const { data: leaderboard } = trpc.gamification.leaderboard.useQuery(
    { projectId, limit: 5 },
    { enabled: !!projectId }
  );

  // Persistent session (auto-save/restore across reloads)
  const currentDoc = documents?.documents?.[currentDocIndex];
  useReviewSession({
    projectId,
    mode,
    currentDocumentId: currentDoc?.id ?? null,
    currentLineIndex,
    reviewedLines,
    selectedLanguage,
    setCurrentDocIndex,
    setCurrentLineIndex,
    setReviewedLines,
    setSelectedLanguage,
    documents: documents?.documents,
  });

  // Fetch transcription for current document
  const { data: transcription } = trpc.transcriptions.getByDocument.useQuery(
    { documentId: currentDoc?.id ?? 0, projectId },
    { enabled: !!currentDoc?.id }
  );

  // Extract lines from transcription (text fields only)
  const lines = useMemo(() => {
    if (!transcription?.rawJson) return [];
    const raw = transcription.rawJson as Record<string, unknown>;
    const textFields = ["transcription", "original_text", "text", "content"];
    for (const f of textFields) {
      if (typeof raw[f] === "string" && (raw[f] as string).trim().length > 0) {
        return (raw[f] as string).split("\n").filter(l => l.trim().length > 0);
      }
    }
    return [];
  }, [transcription]);

  // Extract metadata fields for verification (non-text fields with values)
  const metadataFields = useMemo(() => {
    if (!transcription?.rawJson) return [];
    const raw = transcription.rawJson as Record<string, unknown>;
    const fields: { key: string; label: string; value: string }[] = [];

    for (const [key, value] of Object.entries(raw)) {
      if (TEXT_FIELDS.has(key)) continue;
      if (SKIP_FIELDS.has(key)) continue;
      if (value === null || value === undefined || value === "") continue;

      const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      let displayValue: string;

      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        displayValue = value.join(", ");
      } else if (typeof value === "boolean") {
        displayValue = value ? "Yes" : "No";
      } else {
        displayValue = String(value);
      }

      if (displayValue.trim().length === 0) continue;
      fields.push({ key, label, value: displayValue });
    }

    return fields;
  }, [transcription]);

  const currentLine = lines[currentLineIndex] ?? "";
  const totalLines = lines.length;
  const lineProgress = totalLines > 0 ? Math.round((reviewedLines.size / totalLines) * 100) : 0;
  const currentMetaField = metadataFields[metadataIndex];
  const totalMetaFields = metadataFields.length;

  // Mutations
  const submitLine = trpc.gamification.submitLineReview.useMutation();
  const completePage = trpc.gamification.completePage.useMutation();

  // Handle line approval (no changes)
  const handleApprove = useCallback(async () => {
    if (!currentDoc || !transcription) return;

    const result = await submitLine.mutateAsync({
      projectId,
      documentId: currentDoc.id,
      transcriptionId: transcription.id,
      lineIndex: currentLineIndex,
      originalLine: currentLine,
      reviewedLine: currentLine,
      isCorrection: false,
    });

    setReviewedLines(prev => new Map(prev).set(currentLineIndex, { original: currentLine, reviewed: currentLine }));
    setLastXp(result.xpEarned);
    setShowXp(true);
    setTimeout(() => setShowXp(false), 1000);

    if (result.dailyBonus > 0 && currentLineIndex === 0 && reviewedLines.size === 0) {
      toast.success(`🔥 Daily streak bonus! +${result.dailyBonus} XP`);
    }
    if (result.leveledUp) {
      toast.success(`⭐ Level up! You're now Level ${result.level}!`);
    }

    refetchStats();
    advanceLine();
  }, [currentDoc, transcription, currentLineIndex, currentLine, projectId, reviewedLines]);

  // Handle line correction
  const handleCorrect = useCallback(async () => {
    if (!currentDoc || !transcription || !editedLine.trim()) return;

    const result = await submitLine.mutateAsync({
      projectId,
      documentId: currentDoc.id,
      transcriptionId: transcription.id,
      lineIndex: currentLineIndex,
      originalLine: currentLine,
      reviewedLine: editedLine.trim(),
      isCorrection: true,
    });

    setReviewedLines(prev => new Map(prev).set(currentLineIndex, { original: currentLine, reviewed: editedLine.trim() }));
    setLastXp(result.xpEarned);
    setShowXp(true);
    setTimeout(() => setShowXp(false), 1000);
    setEditMode(false);
    setEditedLine("");

    if (result.leveledUp) {
      toast.success(`⭐ Level up! You're now Level ${result.level}!`);
    }

    refetchStats();
    advanceLine();
  }, [currentDoc, transcription, currentLineIndex, currentLine, editedLine, projectId]);

  // Advance to next line or transition to metadata phase
  const advanceLine = useCallback(() => {
    for (let i = currentLineIndex + 1; i < totalLines; i++) {
      if (!reviewedLines.has(i)) {
        setCurrentLineIndex(i);
        return;
      }
    }
    if (reviewedLines.size + 1 >= totalLines) {
      if (metadataFields.length > 0) {
        setPhase("metadata");
        setMetadataIndex(0);
        setMetadataVerifications(new Map());
        setMetadataCorrections(new Map());
      } else {
        handlePageComplete();
      }
    } else {
      for (let i = 0; i < currentLineIndex; i++) {
        if (!reviewedLines.has(i)) {
          setCurrentLineIndex(i);
          return;
        }
      }
    }
  }, [currentLineIndex, totalLines, reviewedLines, metadataFields]);

  // Handle metadata confirmation (yes)
  const handleMetaConfirm = useCallback(() => {
    if (!currentMetaField) return;
    setMetadataVerifications(prev => new Map(prev).set(currentMetaField.key, true));

    if (metadataIndex < totalMetaFields - 1) {
      setMetadataIndex(prev => prev + 1);
    } else {
      handlePageComplete();
    }
  }, [currentMetaField, metadataIndex, totalMetaFields]);

  // Handle metadata rejection (no — needs correction)
  const handleMetaReject = useCallback(() => {
    if (!currentMetaField) return;
    setEditingMetaField(currentMetaField.key);
    setEditingMetaValue(currentMetaField.value);
    setTimeout(() => metaInputRef.current?.focus(), 50);
  }, [currentMetaField]);

  // Submit metadata correction
  const handleMetaCorrectionSubmit = useCallback(() => {
    if (!editingMetaField) return;
    setMetadataVerifications(prev => new Map(prev).set(editingMetaField, false));
    setMetadataCorrections(prev => new Map(prev).set(editingMetaField, editingMetaValue));
    setEditingMetaField(null);
    setEditingMetaValue("");

    if (metadataIndex < totalMetaFields - 1) {
      setMetadataIndex(prev => prev + 1);
    } else {
      handlePageComplete();
    }
  }, [editingMetaField, editingMetaValue, metadataIndex, totalMetaFields]);

  // Handle page completion (called after BOTH lines and metadata are done)
  const handlePageComplete = useCallback(async () => {
    if (!currentDoc || !transcription) return;

    const allReviewed = Array.from(reviewedLines.entries()).map(([idx, data]) => ({
      index: idx,
      original: data.original,
      reviewed: data.reviewed,
    }));

    if (!reviewedLines.has(currentLineIndex) && phase === "lines") {
      allReviewed.push({ index: currentLineIndex, original: currentLine, reviewed: editMode ? editedLine : currentLine });
    }

    try {
      const result = await completePage.mutateAsync({
        projectId,
        documentId: currentDoc.id,
        transcriptionId: transcription.id,
        reviewedLines: allReviewed,
        metadataCorrections: Object.fromEntries(metadataCorrections),
      });

      toast.success(`🎉 Page complete! +${result.xpEarned} XP bonus!`);
      refetchStats();

      if (documents?.documents && currentDocIndex < documents.documents.length - 1) {
        setCurrentDocIndex(prev => prev + 1);
        setCurrentLineIndex(0);
        setReviewedLines(new Map());
        setEditMode(false);
        setPhase("lines");
        setMetadataIndex(0);
        setMetadataVerifications(new Map());
        setMetadataCorrections(new Map());
      } else {
        setPhase("complete");
        toast.success("🏆 All documents reviewed! Amazing work!");
      }
    } catch (err) {
      toast.error("Failed to save page review");
    }
  }, [currentDoc, transcription, reviewedLines, currentLineIndex, currentLine, editMode, editedLine, projectId, currentDocIndex, documents, metadataCorrections, phase]);

  // Enter edit mode
  const startEdit = useCallback(() => {
    setEditMode(true);
    setEditedLine(currentLine);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [currentLine]);

  // Skip line (move to next without reviewing)
  const skipLine = useCallback(() => {
    if (currentLineIndex < totalLines - 1) {
      setCurrentLineIndex(prev => prev + 1);
    }
    setEditMode(false);
  }, [currentLineIndex, totalLines]);

  // Skip entire document (move to next doc without reviewing)
  const skipDocument = useCallback(() => {
    if (documents?.documents && currentDocIndex < documents.documents.length - 1) {
      setCurrentDocIndex(prev => prev + 1);
      setCurrentLineIndex(0);
      setReviewedLines(new Map());
      setEditMode(false);
      setPhase("lines");
      setMetadataIndex(0);
      setMetadataVerifications(new Map());
      setMetadataCorrections(new Map());
      setEditingMetaField(null);
      toast.info("Document skipped");
    } else {
      toast.info("No more documents to skip to");
    }
  }, [currentDocIndex, documents]);

  // Swipe gestures for line review
  useSwipe(swipeRef, {
    onSwipeRight: handleApprove,
    onSwipeLeft: skipLine,
    threshold: 60,
  });

  // Swipe gestures for metadata verification
  useSwipe(metaSwipeRef, {
    onSwipeRight: handleMetaConfirm,
    onSwipeLeft: handleMetaReject,
    threshold: 60,
  });

  // Keyboard shortcuts (hidden on mobile)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (phase === "metadata") {
        if (editingMetaField) {
          if (e.key === "Enter") { e.preventDefault(); handleMetaCorrectionSubmit(); }
          if (e.key === "Escape") { setEditingMetaField(null); setEditingMetaValue(""); }
          return;
        }
        if (e.key === "Enter" || e.key === "y" || e.key === "Y") { e.preventDefault(); handleMetaConfirm(); }
        else if (e.key === "n" || e.key === "N") { e.preventDefault(); handleMetaReject(); }
        return;
      }
      if (editMode) return;
      if (e.key === "Enter") { e.preventDefault(); handleApprove(); }
      else if (e.key === "e" || e.key === "E") { e.preventDefault(); startEdit(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipLine(); }
      else if (e.key === "ArrowLeft" && currentLineIndex > 0) {
        e.preventDefault();
        setCurrentLineIndex(prev => prev - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, editMode, editingMetaField, handleApprove, startEdit, skipLine, currentLineIndex, handleMetaConfirm, handleMetaReject, handleMetaCorrectionSubmit]);

  // Reset when document changes
  useEffect(() => {
    setCurrentLineIndex(0);
    setReviewedLines(new Map());
    setEditMode(false);
    setPhase("lines");
    setMetadataIndex(0);
    setMetadataVerifications(new Map());
    setMetadataCorrections(new Map());
    setEditingMetaField(null);
    setShowImage(true);
  }, [currentDoc?.id]);

  // Loading state
  if (docsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // No documents to review
  if (!documents?.documents?.length || phase === "complete") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-6">
        <Trophy className="w-12 h-12 text-yellow-400" />
        <h2 className="text-xl font-semibold text-foreground">All caught up!</h2>
        <p className="text-center">No documents need review right now. Check back later.</p>
        {stats && stats.totalXp > 0 && (
          <div className="mt-4 text-center">
            <p className="text-sm">Your total XP: <span className="text-yellow-400 font-bold">{stats.totalXp}</span></p>
            <LevelBadge level={stats.level} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mode toggle bar */}
      <div className="flex-shrink-0 flex items-center justify-center gap-1 px-3 py-1.5 bg-card/30 border-b border-border">
        <button
          onClick={() => setMode("classic")}
          className="px-3 py-1 rounded-full text-[10px] font-medium transition-colors bg-primary/20 text-primary border border-primary/30"
        >
          Classic
        </button>
        <button
          onClick={() => setMode("pyramid")}
          className="px-3 py-1 rounded-full text-[10px] font-medium transition-colors text-muted-foreground hover:text-foreground"
        >
          <span className="inline-flex items-center gap-1"><Pyramid className="w-3 h-3" /> Pyramid</span>
        </button>
      </div>
      {/* Compact stats bar — single row on mobile */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-3 md:px-6 py-2 md:py-3">
        <div className="flex items-center justify-between gap-2">
          {/* Left: XP + Level + Streak */}
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            {stats && (
              <>
                <div className="flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 md:w-4 md:h-4 text-yellow-400 flex-shrink-0" />
                  <span className="text-xs md:text-sm font-semibold whitespace-nowrap">{stats.totalXp}</span>
                </div>
                <LevelBadge level={stats.level} />
                {stats.currentStreak > 0 && (
                  <div className="flex items-center gap-0.5 text-orange-400">
                    <Flame className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs font-semibold">{stats.currentStreak}</span>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Right: Language + Doc/Line counter */}
          <div className="flex items-center gap-2 text-[10px] md:text-xs text-muted-foreground flex-shrink-0">
            {languages && languages.length > 1 && (
              <select
                value={selectedLanguage}
                onChange={e => {
                  setSelectedLanguage(e.target.value);
                  setCurrentDocIndex(0);
                  setCurrentLineIndex(0);
                  setPhase("lines");
                  setReviewedLines(new Map());
                }}
                className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px] md:text-xs max-w-[80px] md:max-w-none"
              >
                <option value="">All</option>
                {languages.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            )}
            <span className="hidden md:inline">Doc {currentDocIndex + 1}/{documents.documents.length}</span>
            <span className="md:hidden">{currentDocIndex + 1}/{documents.documents.length}</span>
            <span className="hidden md:inline">•</span>
            {phase === "lines" ? (
              <span className="hidden md:inline">Line {currentLineIndex + 1}/{totalLines}</span>
            ) : (
              <span className="text-blue-400 hidden md:inline">Meta {metadataIndex + 1}/{totalMetaFields}</span>
            )}
          </div>
        </div>
        {/* XP progress bar — hidden on mobile to save space */}
        {stats && (
          <div className="hidden md:block mt-2">
            <Progress value={stats.progress.needed > 0 ? (stats.progress.current / stats.progress.needed) * 100 : 0} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.progress.current}/{stats.progress.needed} XP to Level {stats.level + 1}
            </p>
          </div>
        )}
      </div>

      {/* Main review area — stacked on mobile, side-by-side on desktop */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Document image — top on mobile (collapsible with smart zoom), left on desktop */}
        {isMobile ? (
          <>
            {/* Mobile: tap to toggle image viewer */}
            <button
              onClick={() => setShowImage(!showImage)}
              className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-black/20 border-b border-border text-xs text-muted-foreground active:bg-black/30"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{showImage ? "Hide document" : "View document"}</span>
              {showImage ? <ChevronLeft className="w-3 h-3 rotate-90" /> : <ChevronRight className="w-3 h-3 rotate-90" />}
            </button>
            {showImage && currentDoc?.storageUrl && (
              <div className="flex-shrink-0" style={{ height: "40vh" }}>
                <PanZoomImageViewer
                  src={currentDoc.storageUrl}
                  alt={currentDoc.filename}
                  isMobile={true}
                />
              </div>
            )}
            {showImage && !currentDoc?.storageUrl && (
              <div className="flex-shrink-0 h-24 bg-black/20 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <ImageIcon className="w-8 h-8" />
                  <span className="text-[10px]">No image</span>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Desktop: side-by-side left panel with smart viewer */
          <div className="w-1/2 border-r border-border bg-black/20 overflow-hidden">
            {currentDoc?.storageUrl ? (
              <PanZoomImageViewer
                src={currentDoc.storageUrl}
                alt={currentDoc.filename}
                isMobile={false}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageIcon className="w-12 h-12" />
                <span className="text-sm">No image available</span>
              </div>
            )}
          </div>
        )}

        {/* Review panel — bottom on mobile, right on desktop */}
        <div className="flex-1 md:w-1/2 flex flex-col min-h-0 overflow-hidden">
          {/* Document info bar */}
          <div className="px-3 md:px-6 py-2 md:py-3 border-b border-border bg-card/30 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs md:text-sm font-medium truncate flex-1">{currentDoc?.filename}</h3>
              <button
                onClick={skipDocument}
                className="flex items-center gap-1 px-2 py-1 text-[10px] md:text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded transition-colors"
                title="Skip this document"
              >
                <SkipForward className="w-3 h-3" />
                <span className="hidden md:inline">Skip Doc</span>
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {phase === "lines" ? (
                <>
                  <Progress value={lineProgress} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-muted-foreground">{lineProgress}%</span>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 text-[10px] md:text-xs text-blue-400">
                    <ClipboardCheck className="w-3 h-3" />
                    <span>Metadata</span>
                  </div>
                  <Progress value={totalMetaFields > 0 ? (metadataIndex / totalMetaFields) * 100 : 0} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-muted-foreground">{metadataIndex}/{totalMetaFields}</span>
                </>
              )}
            </div>
          </div>

          {/* Phase: Line review */}
          {phase === "lines" && (
            <>
              {/* Scrollable line content with swipe area */}
              <div ref={swipeRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-3 md:py-4 min-h-0">
                {/* Previous lines context */}
                <div className="space-y-1.5 md:space-y-2 mb-4 md:mb-6">
                  {lines.slice(Math.max(0, currentLineIndex - 2), currentLineIndex).map((line, i) => {
                    const actualIdx = Math.max(0, currentLineIndex - 2) + i;
                    const isReviewed = reviewedLines.has(actualIdx);
                    return (
                      <div key={actualIdx} className={`text-xs md:text-sm py-1 px-2 rounded ${isReviewed ? "text-muted-foreground/50 line-through" : "text-muted-foreground/70"}`}>
                        {line}
                      </div>
                    );
                  })}
                </div>

                {/* Current line — the card users swipe */}
                <div className="relative border-2 border-primary/50 rounded-lg p-3 md:p-4 bg-primary/5">
                  <div className="absolute -top-2.5 left-3 bg-background px-2 text-[10px] md:text-xs text-primary font-medium">
                    Line {currentLineIndex + 1}/{totalLines}
                  </div>

                  {!editMode ? (
                    <div className="text-sm md:text-base font-medium leading-relaxed">
                      {currentLine}
                    </div>
                  ) : (
                    <Input
                      ref={inputRef}
                      value={editedLine}
                      onChange={e => setEditedLine(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleCorrect();
                        if (e.key === "Escape") { setEditMode(false); setEditedLine(""); }
                      }}
                      className="text-base font-medium p-3"
                      style={{ fontSize: "16px" }} // prevent iOS zoom
                      placeholder="Type the corrected text..."
                      autoFocus
                    />
                  )}

                  <XpPopup xp={lastXp} show={showXp} />
                </div>

                {/* Swipe hint — mobile only, shown briefly */}
                {isMobile && !editMode && (
                  <div className="flex items-center justify-between mt-3 text-[10px] text-muted-foreground/50 px-2">
                    <span>← swipe skip</span>
                    <span>swipe approve →</span>
                  </div>
                )}

                {/* Next lines preview */}
                <div className="space-y-1.5 md:space-y-2 mt-4 md:mt-6">
                  {lines.slice(currentLineIndex + 1, currentLineIndex + 3).map((line, i) => (
                    <div key={currentLineIndex + 1 + i} className="text-xs md:text-sm py-1 px-2 text-muted-foreground/40">
                      {line}
                    </div>
                  ))}
                </div>
              </div>

              {/* Line action buttons — large and thumb-friendly on mobile */}
              <div className="flex-shrink-0 border-t border-border px-3 md:px-6 py-3 md:py-4 bg-background">
                {!editMode ? (
                  <div className="flex items-center gap-2 md:gap-3">
                    <Button
                      onClick={handleApprove}
                      className="flex-1 h-12 md:h-10 bg-emerald-600 hover:bg-emerald-700 text-sm md:text-sm font-semibold"
                      disabled={submitLine.isPending}
                    >
                      <CheckCircle2 className="w-5 h-5 md:w-4 md:h-4 mr-1.5" />
                      <span className="md:hidden">Correct</span>
                      <span className="hidden md:inline">Correct (+2 XP)</span>
                    </Button>
                    <Button
                      onClick={startEdit}
                      variant="outline"
                      className="flex-1 h-12 md:h-10 text-sm font-semibold"
                    >
                      <Edit3 className="w-5 h-5 md:w-4 md:h-4 mr-1.5" />
                      <span className="md:hidden">Edit</span>
                      <span className="hidden md:inline">Edit (+5 XP)</span>
                    </Button>
                    <Button
                      onClick={skipLine}
                      variant="ghost"
                      className="h-12 md:h-10 w-12 md:w-10 p-0"
                      title="Skip this line"
                    >
                      <SkipForward className="w-5 h-5 md:w-4 md:h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 md:gap-3">
                    <Button
                      onClick={handleCorrect}
                      className="flex-1 h-12 md:h-10 bg-blue-600 hover:bg-blue-700 text-sm font-semibold"
                      disabled={submitLine.isPending || !editedLine.trim()}
                    >
                      <CheckCircle2 className="w-5 h-5 md:w-4 md:h-4 mr-1.5" />
                      Submit
                    </Button>
                    <Button
                      onClick={() => { setEditMode(false); setEditedLine(""); }}
                      variant="ghost"
                      className="h-12 md:h-10"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                {/* Keyboard hints — desktop only */}
                <p className="hidden md:block text-[10px] text-muted-foreground mt-2 text-center">
                  Keyboard: Enter = approve/submit • E = edit • → = skip • ← = back
                </p>
              </div>
            </>
          )}

          {/* Phase: Metadata verification */}
          {phase === "metadata" && currentMetaField && (
            <>
              <div ref={metaSwipeRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6 min-h-0">
                {/* Phase transition header */}
                <div className="mb-4 md:mb-6 p-3 md:p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <div className="flex items-center gap-2 text-blue-400 mb-1">
                    <ClipboardCheck className="w-4 h-4" />
                    <span className="text-xs md:text-sm font-semibold">Metadata Verification</span>
                  </div>
                  <p className="text-[10px] md:text-xs text-muted-foreground">
                    Lines done! Verify each metadata field — swipe right to confirm, left to fix.
                  </p>
                </div>

                {/* Previously verified fields */}
                {metadataIndex > 0 && (
                  <div className="space-y-1.5 md:space-y-2 mb-4 md:mb-6">
                    {metadataFields.slice(Math.max(0, metadataIndex - 3), metadataIndex).map(field => {
                      const wasConfirmed = metadataVerifications.get(field.key);
                      const correction = metadataCorrections.get(field.key);
                      return (
                        <div key={field.key} className="flex items-center gap-2 text-[10px] md:text-xs text-muted-foreground/60">
                          {wasConfirmed ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                          ) : (
                            <Edit3 className="w-3 h-3 text-blue-400 flex-shrink-0" />
                          )}
                          <span className="font-medium truncate">{field.label}:</span>
                          <span className={`truncate ${correction ? "line-through" : ""}`}>{field.value}</span>
                          {correction && <span className="text-blue-400 truncate">→ {correction}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Current metadata field — card style for swipe */}
                <div className="relative border-2 border-blue-500/50 rounded-lg p-4 md:p-6 bg-blue-500/5">
                  <div className="absolute -top-2.5 left-3 bg-background px-2 text-[10px] md:text-xs text-blue-400 font-medium">
                    {currentMetaField.label} ({metadataIndex + 1}/{totalMetaFields})
                  </div>

                  {!editingMetaField ? (
                    <div className="text-center py-2">
                      <p className="text-base md:text-lg font-medium mb-2 break-words">{currentMetaField.value}</p>
                      <p className="text-xs md:text-sm text-muted-foreground">Is this correct?</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[10px] md:text-xs text-muted-foreground mb-2">
                        Original: <span className="line-through">{currentMetaField.value}</span>
                      </p>
                      <Input
                        ref={metaInputRef}
                        value={editingMetaValue}
                        onChange={e => setEditingMetaValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleMetaCorrectionSubmit();
                          if (e.key === "Escape") { setEditingMetaField(null); setEditingMetaValue(""); }
                        }}
                        className="text-base p-3"
                        style={{ fontSize: "16px" }} // prevent iOS zoom
                        placeholder="Type the correct value..."
                        autoFocus
                      />
                    </div>
                  )}
                </div>

                {/* Swipe hint — mobile only */}
                {isMobile && !editingMetaField && (
                  <div className="flex items-center justify-between mt-3 text-[10px] text-muted-foreground/50 px-2">
                    <span>← swipe to fix</span>
                    <span>swipe to confirm →</span>
                  </div>
                )}

                {/* Remaining fields preview */}
                {metadataIndex < totalMetaFields - 1 && (
                  <div className="space-y-1.5 md:space-y-2 mt-4 md:mt-6">
                    {metadataFields.slice(metadataIndex + 1, metadataIndex + 3).map(field => (
                      <div key={field.key} className="text-[10px] md:text-xs text-muted-foreground/40 py-1 px-2">
                        <span className="font-medium">{field.label}:</span> {field.value}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Metadata action buttons — large on mobile */}
              <div className="flex-shrink-0 border-t border-border px-3 md:px-6 py-3 md:py-4 bg-background">
                {!editingMetaField ? (
                  <div className="flex items-center gap-2 md:gap-3">
                    <Button
                      onClick={handleMetaConfirm}
                      className="flex-1 h-12 md:h-10 bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold"
                    >
                      <ThumbsUp className="w-5 h-5 md:w-4 md:h-4 mr-1.5" />
                      <span className="md:hidden">Yes</span>
                      <span className="hidden md:inline">Yes, correct (+2 XP)</span>
                    </Button>
                    <Button
                      onClick={handleMetaReject}
                      variant="outline"
                      className="flex-1 h-12 md:h-10 border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-semibold"
                    >
                      <ThumbsDown className="w-5 h-5 md:w-4 md:h-4 mr-1.5" />
                      <span className="md:hidden">Fix</span>
                      <span className="hidden md:inline">No, fix it (+5 XP)</span>
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 md:gap-3">
                    <Button
                      onClick={handleMetaCorrectionSubmit}
                      className="flex-1 h-12 md:h-10 bg-blue-600 hover:bg-blue-700 text-sm font-semibold"
                      disabled={!editingMetaValue.trim()}
                    >
                      <CheckCircle2 className="w-5 h-5 md:w-4 md:h-4 mr-1.5" />
                      Submit
                    </Button>
                    <Button
                      onClick={() => { setEditingMetaField(null); setEditingMetaValue(""); }}
                      variant="ghost"
                      className="h-12 md:h-10"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                {/* Keyboard hints — desktop only */}
                <p className="hidden md:block text-[10px] text-muted-foreground mt-2 text-center">
                  Keyboard: Enter/Y = confirm • N = reject/fix
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom: Mini leaderboard — hidden on mobile to save space */}
      {leaderboard && leaderboard.length > 0 && (
        <div className="hidden md:flex flex-shrink-0 border-t border-border bg-card/30 px-6 py-2 items-center gap-6">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Trophy className="w-3 h-3 text-yellow-400" />
            <span>Leaderboard:</span>
          </div>
          {leaderboard.slice(0, 5).map((entry, i) => (
            <div key={entry.userId} className="flex items-center gap-1.5 text-xs">
              <span className={`font-bold ${i === 0 ? "text-yellow-400" : i === 1 ? "text-zinc-300" : i === 2 ? "text-amber-600" : "text-muted-foreground"}`}>
                #{entry.rank}
              </span>
              <span className="text-foreground truncate max-w-[80px]">{entry.name}</span>
              <span className="text-muted-foreground">{entry.totalXp} XP</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
