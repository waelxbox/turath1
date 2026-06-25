import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Edit3, SkipForward, Loader2,
  Flame, Zap, Star, Trophy, ChevronUp, ChevronDown,
  Minus, Plus, Maximize2, X
} from "lucide-react";

interface Props {
  projectId: number;
}

// Pyramid config: 8 rows, bottom-up
const ROWS = [9, 8, 7, 6, 5, 4, 3, 1]; // bottom to top
const TOTAL_BLOCKS = ROWS.reduce((a, b) => a + b, 0); // 43

function getBlockPosition(idx: number) {
  let remaining = idx;
  for (let row = 0; row < ROWS.length; row++) {
    if (remaining < ROWS[row]) return { row, col: remaining, rowWidth: ROWS[row] };
    remaining -= ROWS[row];
  }
  return { row: ROWS.length - 1, col: 0, rowWidth: 1 };
}

/**
 * Compact isometric pyramid widget — sits in the header area.
 * Small, elegant, always visible. Shows progress as filled stone blocks.
 */
function CompactPyramid({ filled, total, animIdx }: { filled: number; total: number; animIdx: number | null }) {
  const W = 160;
  const H = 100;
  const bH = (H - 10) / ROWS.length;
  const maxW = W - 20;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="pStone" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e8c170" />
          <stop offset="100%" stopColor="#a67c3d" />
        </linearGradient>
        <linearGradient id="pGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd700" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id="pSky" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1a0a2e" />
          <stop offset="60%" stopColor="#2d1854" />
          <stop offset="100%" stopColor="#4a2c17" />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect x="0" y="0" width={W} height={H} rx="8" fill="url(#pSky)" />

      {/* Sand ground */}
      <rect x="0" y={H - 12} width={W} height="12" rx="0" fill="#3d2a14" opacity="0.6" />
      <ellipse cx={W / 2} cy={H - 6} rx={W * 0.45} ry="5" fill="#5c3d1e" opacity="0.4" />

      {/* Pyramid blocks */}
      {Array.from({ length: Math.min(filled, total) }).map((_, i) => {
        const { row, col, rowWidth } = getBlockPosition(i);
        const rowW = (rowWidth / ROWS[0]) * maxW;
        const rowX = (W - rowW) / 2;
        const singleW = rowW / rowWidth;
        const bx = rowX + col * singleW;
        const by = H - 16 - (row + 1) * bH;
        const isAnim = animIdx === i;
        const isTop = row >= 6;

        return (
          <motion.rect
            key={i}
            x={bx + 0.5}
            y={by + 0.5}
            width={singleW - 1}
            height={bH - 1}
            rx={1}
            fill={isTop ? "url(#pGold)" : "url(#pStone)"}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth={0.3}
            initial={isAnim ? { opacity: 0, y: by - 15, scale: 0.6 } : false}
            animate={{ opacity: 1, y: by + 0.5, scale: 1 }}
            transition={isAnim ? { type: "spring", stiffness: 500, damping: 20 } : { duration: 0 }}
          />
        );
      })}

      {/* Ghost outline for unfilled */}
      {ROWS.map((rowWidth, row) => {
        const rowW = (rowWidth / ROWS[0]) * maxW;
        const rowX = (W - rowW) / 2;
        const by = H - 16 - (row + 1) * bH;
        // Only show ghost for rows that aren't fully filled
        let startBlock = 0;
        for (let r = 0; r < row; r++) startBlock += ROWS[r];
        if (filled >= startBlock + rowWidth) return null;
        return (
          <rect
            key={`g-${row}`}
            x={rowX}
            y={by}
            width={rowW}
            height={bH}
            rx={1}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={0.5}
            strokeDasharray="2 1.5"
          />
        );
      })}

      {/* Stars */}
      <circle cx="15" cy="12" r="0.8" fill="white" opacity="0.5" />
      <circle cx="35" cy="8" r="0.5" fill="white" opacity="0.3" />
      <circle cx={W - 20} cy="15" r="0.7" fill="white" opacity="0.4" />
      <circle cx={W - 40} cy="10" r="0.5" fill="white" opacity="0.3" />
    </svg>
  );
}

/**
 * Pan & Zoom image viewer (reusable)
 */
function ImageViewer({ src, alt, compact }: { src: string; alt: string; compact?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const lastTap = useRef(0);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 6));
  const handleZoomOut = () => { const nz = Math.max(zoom - 0.5, 1); setZoom(nz); if (nz === 1) setPan({ x: 0, y: 0 }); };
  const handleReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleDoubleTap = (cx: number, cy: number) => {
    if (zoom > 1.5) { setZoom(1); setPan({ x: 0, y: 0 }); }
    else {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) { setZoom(2.5); return; }
      setZoom(2.5);
      setPan({ x: -(cx - rect.left - rect.width / 2) * 1.5, y: -(cy - rect.top - rect.height / 2) * 1.5 });
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) { handleDoubleTap(e.touches[0].clientX, e.touches[0].clientY); lastTap.current = 0; return; }
      lastTap.current = now;
      if (zoom > 1) { dragging.current = true; lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
    } else if (e.touches.length === 2) {
      dragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 1 && dragging.current) {
      const dx = e.touches[0].clientX - lastPos.current.x;
      const dy = e.touches[0].clientY - lastPos.current.y;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist.current > 0) setZoom(prev => Math.max(1, Math.min(6, prev * (dist / lastPinchDist.current))));
      lastPinchDist.current = dist;
    }
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    dragging.current = false;
    if (e.touches.length < 2) lastPinchDist.current = 0;
    if (zoom < 1.1) { setZoom(1); setPan({ x: 0, y: 0 }); }
  };

  const handleMouseDown = (e: React.MouseEvent) => { if (zoom <= 1) return; e.preventDefault(); dragging.current = true; lastPos.current = { x: e.clientX, y: e.clientY }; };
  const handleMouseMove = (e: React.MouseEvent) => { if (!dragging.current) return; setPan(prev => ({ x: prev.x + e.clientX - lastPos.current.x, y: prev.y + e.clientY - lastPos.current.y })); lastPos.current = { x: e.clientX, y: e.clientY }; };
  const handleMouseUp = () => { dragging.current = false; };
  const handleWheel = (e: React.WheelEvent) => { e.preventDefault(); const nz = Math.max(1, Math.min(6, zoom + (e.deltaY > 0 ? -0.2 : 0.2))); setZoom(nz); if (nz === 1) setPan({ x: 0, y: 0 }); };

  const viewer = (
    <div className={`relative flex flex-col ${fullscreen ? "fixed inset-0 z-[100] bg-black" : "h-full"}`}>
      {/* Controls */}
      <div className={`flex-shrink-0 flex items-center justify-between px-2 py-1 bg-black/70 ${compact ? "" : "border-b border-white/10"}`}>
        <div className="flex items-center gap-0.5">
          <button onClick={handleZoomOut} disabled={zoom <= 1} className="p-1 rounded text-white/70 hover:text-white disabled:text-white/30"><Minus className="w-3.5 h-3.5" /></button>
          <span className="text-[10px] text-white/60 font-mono w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} disabled={zoom >= 6} className="p-1 rounded text-white/70 hover:text-white disabled:text-white/30"><Plus className="w-3.5 h-3.5" /></button>
          {zoom > 1 && <button onClick={handleReset} className="ml-1 px-1.5 py-0.5 rounded text-[9px] text-white/50 bg-white/10">Reset</button>}
        </div>
        <div className="flex items-center gap-1">
          {zoom <= 1 && <span className="text-[8px] text-white/30">double-tap to zoom</span>}
          {!fullscreen ? (
            <button onClick={() => setFullscreen(true)} className="p-1 rounded text-white/60 hover:text-white"><Maximize2 className="w-3.5 h-3.5" /></button>
          ) : (
            <button onClick={() => setFullscreen(false)} className="p-1 rounded text-white/60 hover:text-white"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>
      {/* Image */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center bg-neutral-900"
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
          style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transition: dragging.current ? "none" : "transform 0.15s ease-out" }}
          draggable={false}
        />
      </div>
    </div>
  );

  if (fullscreen) return <>{viewer}</>;
  return viewer;
}

/**
 * XP popup animation
 */
function XpPopup({ xp, show }: { xp: number; show: boolean }) {
  if (!show) return null;
  return (
    <motion.div
      className="absolute -top-5 left-1/2 -translate-x-1/2 text-amber-400 font-bold text-xs pointer-events-none z-50"
      initial={{ opacity: 1, y: 0, scale: 1.2 }}
      animate={{ opacity: 0, y: -16, scale: 0.8 }}
      transition={{ duration: 0.7 }}
    >
      +{xp} XP
    </motion.div>
  );
}

/**
 * Row completion celebration
 */
function RowCelebration({ show, row }: { show: boolean; row: number }) {
  if (!show) return null;
  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-amber-900/60 backdrop-blur-sm rounded-lg px-4 py-2 border border-amber-500/40"
        initial={{ scale: 0.7 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
      >
        <p className="text-amber-200 font-semibold text-sm text-center">Row {row} sealed!</p>
      </motion.div>
    </motion.div>
  );
}

export default function PyramidReviewMode({ projectId }: Props) {
  const [currentDocIndex, setCurrentDocIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedLine, setEditedLine] = useState("");
  const [reviewedLines, setReviewedLines] = useState<Map<number, { original: string; reviewed: string }>>(new Map());
  const [showXp, setShowXp] = useState(false);
  const [lastXp, setLastXp] = useState(0);
  const [animatingBlock, setAnimatingBlock] = useState<number | null>(null);
  const [lastBlockIsCorrection, setLastBlockIsCorrection] = useState(false);
  const [showRowComplete, setShowRowComplete] = useState(false);
  const [completedRow, setCompletedRow] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [mobileImageOpen, setMobileImageOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Swipe refs for review card
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);

  // Detect mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Fetch data
  const { data: languages } = trpc.documents.getLanguages.useQuery({ projectId }, { enabled: !!projectId });
  const { data: documents, isLoading: docsLoading } = trpc.documents.listPaginated.useQuery(
    { projectId, status: "needs_review", limit: 100, language: selectedLanguage || undefined },
    { enabled: !!projectId }
  );
  const { data: stats, refetch: refetchStats } = trpc.gamification.myStats.useQuery({ projectId }, { enabled: !!projectId });

  const currentDoc = documents?.documents?.[currentDocIndex];
  const { data: transcription } = trpc.transcriptions.getByDocument.useQuery(
    { documentId: currentDoc?.id ?? 0, projectId },
    { enabled: !!currentDoc?.id }
  );

  // Extract lines
  const lines = useMemo(() => {
    if (!transcription?.rawJson) return [];
    const raw = transcription.rawJson as Record<string, unknown>;
    for (const f of ["transcription", "original_text", "text", "content"]) {
      if (typeof raw[f] === "string" && (raw[f] as string).trim().length > 0) {
        return (raw[f] as string).split("\n").filter(l => l.trim().length > 0);
      }
    }
    return [];
  }, [transcription]);

  const currentLine = lines[currentLineIndex] ?? "";
  const totalLines = lines.length;

  // Pyramid progress
  const sessionBlocks = reviewedLines.size;
  const historicalBlocks = stats ? (stats.pagesCompleted * 8 + stats.linesReviewed) % TOTAL_BLOCKS : 0;
  const pyramidBlocks = Math.min((historicalBlocks + sessionBlocks) % TOTAL_BLOCKS, TOTAL_BLOCKS);

  const checkRowCompletion = useCallback((newCount: number) => {
    let cum = 0;
    for (let row = 0; row < ROWS.length; row++) {
      cum += ROWS[row];
      if (newCount === cum) {
        setShowRowComplete(true);
        setCompletedRow(row + 1);
        setTimeout(() => setShowRowComplete(false), 2000);
        return;
      }
    }
  }, []);

  // Mutations
  const submitLine = trpc.gamification.submitLineReview.useMutation();
  const completePage = trpc.gamification.completePage.useMutation();

  const handleApprove = useCallback(async () => {
    if (!currentDoc || !transcription) return;
    const result = await submitLine.mutateAsync({
      projectId, documentId: currentDoc.id, transcriptionId: transcription.id,
      lineIndex: currentLineIndex, originalLine: currentLine, reviewedLine: currentLine, isCorrection: false,
    });
    const newReviewed = new Map(reviewedLines).set(currentLineIndex, { original: currentLine, reviewed: currentLine });
    setReviewedLines(newReviewed);
    setLastXp(result.xpEarned); setShowXp(true); setLastBlockIsCorrection(false);
    setAnimatingBlock(pyramidBlocks);
    setTimeout(() => { setShowXp(false); setAnimatingBlock(null); }, 800);
    checkRowCompletion((historicalBlocks + newReviewed.size) % TOTAL_BLOCKS);
    if (result.leveledUp) toast.success(`Level up! Now Level ${result.level}!`);
    refetchStats();
    advanceLine(newReviewed);
  }, [currentDoc, transcription, currentLineIndex, currentLine, projectId, reviewedLines, pyramidBlocks, historicalBlocks]);

  const handleCorrect = useCallback(async () => {
    if (!currentDoc || !transcription || !editedLine.trim()) return;
    const result = await submitLine.mutateAsync({
      projectId, documentId: currentDoc.id, transcriptionId: transcription.id,
      lineIndex: currentLineIndex, originalLine: currentLine, reviewedLine: editedLine.trim(), isCorrection: true,
    });
    const newReviewed = new Map(reviewedLines).set(currentLineIndex, { original: currentLine, reviewed: editedLine.trim() });
    setReviewedLines(newReviewed);
    setLastXp(result.xpEarned); setShowXp(true); setLastBlockIsCorrection(true);
    setAnimatingBlock(pyramidBlocks);
    setTimeout(() => { setShowXp(false); setAnimatingBlock(null); }, 800);
    setEditMode(false); setEditedLine("");
    checkRowCompletion((historicalBlocks + newReviewed.size) % TOTAL_BLOCKS);
    if (result.leveledUp) toast.success(`Level up! Now Level ${result.level}!`);
    refetchStats();
    advanceLine(newReviewed);
  }, [currentDoc, transcription, currentLineIndex, currentLine, editedLine, projectId, reviewedLines, pyramidBlocks, historicalBlocks]);

  const advanceLine = useCallback((reviewed: Map<number, any>) => {
    for (let i = currentLineIndex + 1; i < totalLines; i++) {
      if (!reviewed.has(i)) { setCurrentLineIndex(i); return; }
    }
    if (reviewed.size >= totalLines) { handlePageComplete(reviewed); }
    else {
      for (let i = 0; i < currentLineIndex; i++) {
        if (!reviewed.has(i)) { setCurrentLineIndex(i); return; }
      }
    }
  }, [currentLineIndex, totalLines]);

  const handlePageComplete = useCallback(async (reviewed: Map<number, any>) => {
    if (!currentDoc || !transcription) return;
    try {
      const result = await completePage.mutateAsync({
        projectId, documentId: currentDoc.id, transcriptionId: transcription.id,
        reviewedLines: Array.from(reviewed.entries()).map(([idx, d]) => ({ index: idx, original: d.original, reviewed: d.reviewed })),
        metadataCorrections: {},
      });
      toast.success(`Document complete! +${result.xpEarned} XP`);
      refetchStats();
      if (documents?.documents && currentDocIndex < documents.documents.length - 1) {
        setCurrentDocIndex(prev => prev + 1); setCurrentLineIndex(0); setReviewedLines(new Map()); setEditMode(false);
      } else { toast.success("All documents reviewed!"); }
    } catch { toast.error("Failed to save"); }
  }, [currentDoc, transcription, projectId, currentDocIndex, documents]);

  const startEdit = useCallback(() => { setEditMode(true); setEditedLine(currentLine); setTimeout(() => inputRef.current?.focus(), 50); }, [currentLine]);
  const skipLine = useCallback(() => { if (currentLineIndex < totalLines - 1) setCurrentLineIndex(prev => prev + 1); setEditMode(false); }, [currentLineIndex, totalLines]);

  // Swipe handlers for review card
  const handleSwipeStart = useCallback((e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  }, []);
  const handleSwipeEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
      if (dx > 0) handleApprove(); else skipLine();
    }
  }, [handleApprove, skipLine]);

  // Keyboard shortcuts
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (editMode) return;
      if (e.key === "Enter") { e.preventDefault(); handleApprove(); }
      else if (e.key === "e" || e.key === "E") { e.preventDefault(); startEdit(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipLine(); }
      else if (e.key === "ArrowLeft" && currentLineIndex > 0) { e.preventDefault(); setCurrentLineIndex(prev => prev - 1); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [editMode, handleApprove, startEdit, skipLine, currentLineIndex]);

  useEffect(() => { setCurrentLineIndex(0); setReviewedLines(new Map()); setEditMode(false); }, [currentDoc?.id]);

  if (docsLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!documents?.documents?.length) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-6">
      <Trophy className="w-12 h-12 text-yellow-400" />
      <h2 className="text-xl font-semibold text-foreground">All caught up!</h2>
      <p className="text-center">No documents need review.</p>
    </div>
  );

  const lineProgress = totalLines > 0 ? Math.round((reviewedLines.size / totalLines) * 100) : 0;

  // === DESKTOP LAYOUT: side-by-side (image left, review right) with compact pyramid in header ===
  if (!isMobile) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header bar: pyramid + stats + doc info */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-card/50">
          {/* Compact pyramid */}
          <div className="w-[120px] h-[75px] flex-shrink-0 rounded-lg overflow-hidden border border-amber-900/30">
            <CompactPyramid filled={pyramidBlocks} total={TOTAL_BLOCKS} animIdx={animatingBlock} />
          </div>
          {/* Stats */}
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-center gap-3">
              {stats && (
                <>
                  <div className="flex items-center gap-1">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    <span className="text-sm font-bold text-foreground">{stats.totalXp} XP</span>
                  </div>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-900/40 text-amber-300 border border-amber-700/30">
                    <Star className="w-3 h-3" /> Lvl {stats.level}
                  </span>
                  {stats.currentStreak > 0 && (
                    <div className="flex items-center gap-0.5 text-orange-400">
                      <Flame className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">{stats.currentStreak}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate max-w-[200px]">{currentDoc?.filename}</span>
              <span>•</span>
              <span>{pyramidBlocks}/{TOTAL_BLOCKS} blocks</span>
              {languages && languages.length > 1 && (
                <select
                  value={selectedLanguage}
                  onChange={e => { setSelectedLanguage(e.target.value); setCurrentDocIndex(0); setCurrentLineIndex(0); setReviewedLines(new Map()); }}
                  className="bg-background border border-border rounded px-1.5 py-0.5 text-xs ml-2"
                >
                  <option value="">All</option>
                  {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                </select>
              )}
              <span className="ml-auto">{currentDocIndex + 1}/{documents.documents.length} docs</span>
            </div>
          </div>
        </div>

        {/* Main content: side-by-side */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Document image */}
          <div className="w-1/2 border-r border-border flex flex-col min-h-0">
            {currentDoc?.storageUrl ? (
              <ImageViewer src={currentDoc.storageUrl} alt={currentDoc.filename} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                No image available
              </div>
            )}
          </div>

          {/* Right: Review panel */}
          <div className="w-1/2 flex flex-col min-h-0">
            {/* Progress bar */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${lineProgress}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{lineProgress}%</span>
            </div>

            {/* Lines */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {/* Context lines */}
              <div className="space-y-1 mb-3">
                {lines.slice(Math.max(0, currentLineIndex - 3), currentLineIndex).map((line, i) => {
                  const idx = Math.max(0, currentLineIndex - 3) + i;
                  return (
                    <div key={idx} className={`text-sm px-3 py-1 rounded ${reviewedLines.has(idx) ? "text-muted-foreground/40 line-through" : "text-muted-foreground/60"}`}>
                      {line}
                    </div>
                  );
                })}
              </div>

              {/* Active line */}
              <div className="relative border-2 border-amber-500/60 rounded-xl p-4 bg-amber-500/5 shadow-lg shadow-amber-500/5">
                <div className="absolute -top-2.5 left-4 bg-background px-2 text-[11px] text-amber-400 font-semibold">
                  Line {currentLineIndex + 1}/{totalLines}
                </div>
                {!editMode ? (
                  <div className="text-base font-medium leading-relaxed min-h-[2rem]">{currentLine}</div>
                ) : (
                  <Input
                    ref={inputRef}
                    value={editedLine}
                    onChange={e => setEditedLine(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleCorrect(); if (e.key === "Escape") { setEditMode(false); setEditedLine(""); } }}
                    className="text-base font-medium"
                    placeholder="Type corrected text..."
                    autoFocus
                  />
                )}
                <XpPopup xp={lastXp} show={showXp} />
              </div>

              {/* Next lines */}
              <div className="space-y-1 mt-3">
                {lines.slice(currentLineIndex + 1, currentLineIndex + 4).map((line, i) => (
                  <div key={currentLineIndex + 1 + i} className="text-sm px-3 py-1 text-muted-foreground/30">{line}</div>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex-shrink-0 border-t border-border px-4 py-3">
              {!editMode ? (
                <div className="flex items-center gap-2">
                  <Button onClick={handleApprove} className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 font-semibold" disabled={submitLine.isPending}>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Correct
                  </Button>
                  <Button onClick={startEdit} variant="outline" className="flex-1 h-11 font-semibold border-amber-500/30 text-amber-300 hover:bg-amber-500/10">
                    <Edit3 className="w-4 h-4 mr-1.5" /> Edit
                  </Button>
                  <Button onClick={skipLine} variant="ghost" className="h-11 w-11 p-0"><SkipForward className="w-4 h-4" /></Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button onClick={handleCorrect} className="flex-1 h-11 bg-amber-600 hover:bg-amber-700 font-semibold" disabled={submitLine.isPending || !editedLine.trim()}>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Submit
                  </Button>
                  <Button onClick={() => { setEditMode(false); setEditedLine(""); }} variant="ghost" className="h-11">Cancel</Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row celebration overlay */}
        <AnimatePresence><RowCelebration show={showRowComplete} row={completedRow} /></AnimatePresence>
      </div>
    );
  }

  // === MOBILE LAYOUT: pyramid header, collapsible image, review card ===
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mobile header: compact pyramid + stats */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/30">
        {/* Tiny pyramid */}
        <div className="w-[72px] h-[48px] flex-shrink-0 rounded-md overflow-hidden border border-amber-900/20">
          <CompactPyramid filled={pyramidBlocks} total={TOTAL_BLOCKS} animIdx={animatingBlock} />
        </div>
        {/* Stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {stats && (
              <>
                <div className="flex items-center gap-0.5">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  <span className="text-xs font-bold">{stats.totalXp}</span>
                </div>
                <span className="text-[9px] px-1 py-0.5 rounded-full bg-amber-900/40 text-amber-300 font-semibold">
                  Lvl {stats.level}
                </span>
                {stats.currentStreak > 0 && (
                  <span className="flex items-center gap-0.5 text-orange-400 text-[10px]">
                    <Flame className="w-2.5 h-2.5" />{stats.currentStreak}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[9px] text-muted-foreground truncate max-w-[100px]">{currentDoc?.filename}</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${lineProgress}%` }} />
            </div>
            <span className="text-[9px] text-muted-foreground">{lineProgress}%</span>
          </div>
        </div>
        {/* Language + doc count */}
        <div className="flex flex-col items-end gap-0.5">
          {languages && languages.length > 1 && (
            <select
              value={selectedLanguage}
              onChange={e => { setSelectedLanguage(e.target.value); setCurrentDocIndex(0); setCurrentLineIndex(0); setReviewedLines(new Map()); }}
              className="bg-background border border-border rounded px-1 py-0.5 text-[9px]"
            >
              <option value="">All</option>
              {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
            </select>
          )}
          <span className="text-[9px] text-muted-foreground">{currentDocIndex + 1}/{documents.documents.length}</span>
        </div>
      </div>

      {/* Collapsible image panel */}
      {currentDoc?.storageUrl && (
        <>
          <button
            onClick={() => setMobileImageOpen(!mobileImageOpen)}
            className="flex-shrink-0 flex items-center justify-center gap-1 py-1 bg-neutral-900/50 border-b border-border text-[10px] text-muted-foreground hover:text-foreground"
          >
            {mobileImageOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {mobileImageOpen ? "Hide document" : "View document"}
          </button>
          {mobileImageOpen && (
            <motion.div
              className="flex-shrink-0 border-b border-border"
              style={{ height: "35vh" }}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "35vh", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ImageViewer src={currentDoc.storageUrl} alt={currentDoc.filename} compact />
            </motion.div>
          )}
        </>
      )}

      {/* Review card with swipe */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
      >
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Context */}
          <div className="space-y-1 mb-2">
            {lines.slice(Math.max(0, currentLineIndex - 2), currentLineIndex).map((line, i) => {
              const idx = Math.max(0, currentLineIndex - 2) + i;
              return (
                <div key={idx} className={`text-xs px-2 py-0.5 rounded ${reviewedLines.has(idx) ? "text-muted-foreground/30 line-through" : "text-muted-foreground/50"}`}>
                  {line}
                </div>
              );
            })}
          </div>

          {/* Active line */}
          <div className="relative border-2 border-amber-500/50 rounded-lg p-3 bg-amber-500/5">
            <div className="absolute -top-2.5 left-3 bg-background px-2 text-[10px] text-amber-400 font-medium">
              Line {currentLineIndex + 1}/{totalLines}
            </div>
            {!editMode ? (
              <div className="text-sm font-medium leading-relaxed min-h-[2rem]">{currentLine}</div>
            ) : (
              <Input
                ref={inputRef}
                value={editedLine}
                onChange={e => setEditedLine(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCorrect(); if (e.key === "Escape") { setEditMode(false); setEditedLine(""); } }}
                className="text-sm font-medium"
                style={{ fontSize: "16px" }}
                placeholder="Type corrected text..."
                autoFocus
              />
            )}
            <XpPopup xp={lastXp} show={showXp} />
          </div>

          {/* Swipe hints */}
          <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground/30 px-2">
            <span>← skip</span>
            <span>approve →</span>
          </div>

          {/* Next lines */}
          <div className="space-y-1 mt-2">
            {lines.slice(currentLineIndex + 1, currentLineIndex + 3).map((line, i) => (
              <div key={currentLineIndex + 1 + i} className="text-xs px-2 py-0.5 text-muted-foreground/25">{line}</div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0 border-t border-border px-3 py-2.5 bg-background/80 backdrop-blur-sm">
          {!editMode ? (
            <div className="flex items-center gap-2">
              <Button onClick={handleApprove} className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold" disabled={submitLine.isPending}>
                <CheckCircle2 className="w-5 h-5 mr-1.5" /> Correct
              </Button>
              <Button onClick={startEdit} variant="outline" className="flex-1 h-12 text-sm font-semibold border-amber-500/30 text-amber-300 hover:bg-amber-500/10">
                <Edit3 className="w-5 h-5 mr-1.5" /> Edit
              </Button>
              <Button onClick={skipLine} variant="ghost" className="h-12 w-12 p-0"><SkipForward className="w-5 h-5" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button onClick={handleCorrect} className="flex-1 h-12 bg-amber-600 hover:bg-amber-700 text-sm font-semibold" disabled={submitLine.isPending || !editedLine.trim()}>
                <CheckCircle2 className="w-5 h-5 mr-1.5" /> Submit
              </Button>
              <Button onClick={() => { setEditMode(false); setEditedLine(""); }} variant="ghost" className="h-12">Cancel</Button>
            </div>
          )}
        </div>
      </div>

      {/* Row celebration */}
      <AnimatePresence><RowCelebration show={showRowComplete} row={completedRow} /></AnimatePresence>
    </div>
  );
}
