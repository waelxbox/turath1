import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Edit3, SkipForward, Loader2,
  Flame, Zap, Star, Trophy, ImageIcon, Maximize2, X, Minus, Plus
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface Props {
  projectId: number;
}

// Pyramid configuration — 10 rows, bottom-up, each row is narrower
// Row 0 = bottom (widest), Row 9 = top (capstone)
const BLOCKS_PER_ROW = [11, 10, 9, 8, 7, 6, 5, 4, 3, 1]; // bottom to top
const TOTAL_BLOCKS = BLOCKS_PER_ROW.reduce((a, b) => a + b, 0); // 64 blocks

// Calculate which row and column a block index falls into
// Blocks fill from bottom row (row 0) left-to-right, then move up
function getBlockPosition(blockIndex: number): { row: number; col: number; rowWidth: number } {
  let remaining = blockIndex;
  for (let row = 0; row < BLOCKS_PER_ROW.length; row++) {
    if (remaining < BLOCKS_PER_ROW[row]) {
      return { row, col: remaining, rowWidth: BLOCKS_PER_ROW[row] };
    }
    remaining -= BLOCKS_PER_ROW[row];
  }
  return { row: BLOCKS_PER_ROW.length - 1, col: 0, rowWidth: 1 };
}

// SVG Pyramid component — proper bottom-up stacking with textured blocks
function PyramidVisualization({
  filledBlocks,
  totalBlocks,
  lastBlockIsCorrection,
  animatingBlock,
  pagesCompleted,
}: {
  filledBlocks: number;
  totalBlocks: number;
  lastBlockIsCorrection: boolean;
  animatingBlock: number | null;
  pagesCompleted: number;
}) {
  const W = 300; // viewBox width
  const H = 200; // viewBox height
  const padding = 10;
  const usableW = W - padding * 2;
  const usableH = H - padding * 2;
  const numRows = BLOCKS_PER_ROW.length;
  const blockH = usableH / numRows;
  const maxRowBlocks = BLOCKS_PER_ROW[0]; // widest row (bottom)

  // Calculate pyramid stage name
  const progress = filledBlocks / totalBlocks;
  const stageName = progress >= 1 ? "Complete!" :
    progress >= 0.8 ? "Capstone" :
    progress >= 0.6 ? "Upper Chambers" :
    progress >= 0.4 ? "Mid Section" :
    progress >= 0.2 ? "Lower Chambers" : "Foundation";

  return (
    <div className="relative flex flex-col items-center h-full">
      {/* Desert sky gradient background */}
      <div className="absolute inset-0 rounded-lg overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c0618] via-[#1a0d3a] to-[#3d2b1f]" />
        {/* Stars */}
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: `${1 + Math.random()}px`,
              height: `${1 + Math.random()}px`,
              top: `${5 + Math.random() * 30}%`,
              left: `${5 + Math.random() * 90}%`,
              opacity: 0.3 + Math.random() * 0.4,
            }}
          />
        ))}
        {/* Sand ground */}
        <div className="absolute bottom-0 left-0 right-0 h-[20%] bg-gradient-to-t from-[#8b6914]/40 to-transparent" />
      </div>

      {/* Pyramid SVG */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="relative z-10 w-full h-full"
        preserveAspectRatio="xMidYMax meet"
      >
        <defs>
          {/* Stone texture gradient */}
          <linearGradient id="stoneBase" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#d4a56a" />
            <stop offset="50%" stopColor="#b8894e" />
            <stop offset="100%" stopColor="#9c7040" />
          </linearGradient>
          <linearGradient id="stoneMid" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e8c88a" />
            <stop offset="50%" stopColor="#d4a86a" />
            <stop offset="100%" stopColor="#c49555" />
          </linearGradient>
          <linearGradient id="stoneTop" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffd700" />
            <stop offset="50%" stopColor="#e6b800" />
            <stop offset="100%" stopColor="#cc9900" />
          </linearGradient>
          <linearGradient id="stoneGold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffd700" />
            <stop offset="50%" stopColor="#ffed4a" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
          {/* Block shadow filter */}
          <filter id="blockShadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0.5" dy="1" stdDeviation="0.5" floodOpacity="0.3" />
          </filter>
        </defs>

        {/* Ghost outline of full pyramid */}
        {BLOCKS_PER_ROW.map((rowBlocks, rowIdx) => {
          // Row 0 = bottom, positioned at bottom of SVG
          const rowY = padding + usableH - (rowIdx + 1) * blockH;
          const rowW = (rowBlocks / maxRowBlocks) * usableW;
          const rowX = (W - rowW) / 2;
          return (
            <rect
              key={`ghost-${rowIdx}`}
              x={rowX}
              y={rowY}
              width={rowW}
              height={blockH}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              rx={1}
            />
          );
        })}

        {/* Filled blocks — bottom up, left to right */}
        {Array.from({ length: Math.min(filledBlocks, totalBlocks) }).map((_, i) => {
          const { row, col, rowWidth } = getBlockPosition(i);
          // Row 0 at bottom of SVG
          const rowY = padding + usableH - (row + 1) * blockH;
          const rowW = (rowWidth / maxRowBlocks) * usableW;
          const rowX = (W - rowW) / 2;
          const singleBlockW = rowW / rowWidth;
          const blockX = rowX + col * singleBlockW;

          const isAnimating = animatingBlock === i;
          const isCorrection = isAnimating && lastBlockIsCorrection;

          // Gradient based on row height
          let gradientId = "stoneBase";
          if (row >= 7) gradientId = "stoneTop";
          else if (row >= 4) gradientId = "stoneMid";
          if (isCorrection) gradientId = "stoneGold";

          const gap = 0.8;

          return (
            <motion.g key={i}>
              {/* Main block */}
              <motion.rect
                x={blockX + gap}
                y={rowY + gap}
                width={Math.max(singleBlockW - gap * 2, 2)}
                height={Math.max(blockH - gap * 2, 2)}
                rx={1.5}
                fill={`url(#${gradientId})`}
                stroke="rgba(0,0,0,0.4)"
                strokeWidth={0.5}
                filter="url(#blockShadow)"
                initial={isAnimating ? { opacity: 0, y: rowY - 30, scaleY: 0.3 } : false}
                animate={{ opacity: 1, y: rowY + gap, scaleY: 1 }}
                transition={isAnimating ? {
                  type: "spring",
                  stiffness: 400,
                  damping: 15,
                } : { duration: 0 }}
              />
              {/* Top highlight (3D effect) */}
              <rect
                x={blockX + gap + 1}
                y={rowY + gap + 0.5}
                width={Math.max(singleBlockW - gap * 2 - 2, 1)}
                height={Math.max(blockH * 0.25, 1)}
                rx={0.5}
                fill="rgba(255,255,255,0.15)"
              />
              {/* Bottom shadow line */}
              <line
                x1={blockX + gap + 1}
                y1={rowY + blockH - gap - 0.5}
                x2={blockX + singleBlockW - gap - 1}
                y2={rowY + blockH - gap - 0.5}
                stroke="rgba(0,0,0,0.2)"
                strokeWidth={0.5}
              />
            </motion.g>
          );
        })}

        {/* Capstone glow when complete */}
        {filledBlocks >= totalBlocks && (
          <motion.circle
            cx={W / 2}
            cy={padding + blockH / 2}
            r={8}
            fill="none"
            stroke="#ffd700"
            strokeWidth={1.5}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
      </svg>

      {/* Stage label */}
      <div className="absolute bottom-1 left-0 right-0 z-10 text-center">
        <p className="text-[10px] text-amber-300/80 font-medium tracking-wider uppercase">
          {stageName}
        </p>
        <p className="text-[8px] text-white/40">
          {filledBlocks}/{totalBlocks} blocks • Pyramid #{pagesCompleted + 1}
        </p>
      </div>
    </div>
  );
}

// Row completion celebration overlay
function RowCompleteCelebration({ show, rowNum }: { show: boolean; rowNum: number }) {
  if (!show) return null;
  return (
    <motion.div
      className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-amber-500/20 backdrop-blur-sm rounded-xl px-6 py-3 border border-amber-400/30"
        initial={{ scale: 0.5, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.5, opacity: 0 }}
      >
        <p className="text-amber-300 font-bold text-sm text-center">
          Row {rowNum} Complete!
        </p>
        <p className="text-amber-200/60 text-[10px] text-center mt-0.5">
          The stones are sealed with hieroglyphs
        </p>
      </motion.div>
    </motion.div>
  );
}

// XP animation
function XpPopup({ xp, show }: { xp: number; show: boolean }) {
  if (!show) return null;
  return (
    <motion.div
      className="absolute -top-6 left-1/2 -translate-x-1/2 text-yellow-400 font-bold text-sm pointer-events-none z-50"
      initial={{ opacity: 1, y: 0 }}
      animate={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.8 }}
    >
      +{xp} XP
    </motion.div>
  );
}

// Mini PanZoom image viewer for pyramid mode
function MiniImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const lastTap = useRef(0);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 6));
  const handleZoomOut = () => {
    const nz = Math.max(zoom - 0.5, 1);
    setZoom(nz);
    if (nz === 1) setPan({ x: 0, y: 0 });
  };
  const handleReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleDoubleTap = (cx: number, cy: number) => {
    if (zoom > 1.5) { setZoom(1); setPan({ x: 0, y: 0 }); }
    else {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) { setZoom(2.5); return; }
      const tx = cx - rect.left - rect.width / 2;
      const ty = cy - rect.top - rect.height / 2;
      setZoom(2.5);
      setPan({ x: -tx * 1.5, y: -ty * 1.5 });
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
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
    dragging.current = false;
    if (e.touches.length < 2) lastPinchDist.current = 0;
    if (zoom < 1.1) { setZoom(1); setPan({ x: 0, y: 0 }); }
  };

  const viewer = (
    <div className={`relative flex flex-col ${fullscreen ? "fixed inset-0 z-[100] bg-black" : "h-full"}`}>
      {/* Controls */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 bg-black/80 border-b border-white/10">
        <div className="flex items-center gap-0.5">
          <button onClick={handleZoomOut} disabled={zoom <= 1} className="p-1 rounded text-white/70 hover:text-white disabled:text-white/30"><Minus className="w-3.5 h-3.5" /></button>
          <span className="text-[10px] text-white/70 font-mono w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} disabled={zoom >= 6} className="p-1 rounded text-white/70 hover:text-white disabled:text-white/30"><Plus className="w-3.5 h-3.5" /></button>
          {zoom > 1 && <button onClick={handleReset} className="ml-1 px-1.5 py-0.5 rounded text-[9px] text-white/60 bg-white/5">Reset</button>}
        </div>
        <div className="flex items-center gap-1">
          {zoom <= 1 && <span className="text-[8px] text-white/40">double-tap zoom</span>}
          {!fullscreen ? (
            <button onClick={() => setFullscreen(true)} className="p-1 rounded text-white/70 hover:text-white"><Maximize2 className="w-3.5 h-3.5" /></button>
          ) : (
            <button onClick={() => setFullscreen(false)} className="p-1 rounded text-white/70 hover:text-white"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>
      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center bg-black/40"
        style={{ cursor: zoom > 1 ? "grab" : "default", touchAction: "none" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
  const [showImage, setShowImage] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Swipe refs
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);

  // Fetch data
  const { data: languages } = trpc.documents.getLanguages.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const { data: documents, isLoading: docsLoading } = trpc.documents.listPaginated.useQuery(
    { projectId, status: "needs_review", limit: 100, language: selectedLanguage || undefined },
    { enabled: !!projectId }
  );

  const { data: stats, refetch: refetchStats } = trpc.gamification.myStats.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const currentDoc = documents?.documents?.[currentDocIndex];

  const { data: transcription } = trpc.transcriptions.getByDocument.useQuery(
    { documentId: currentDoc?.id ?? 0, projectId },
    { enabled: !!currentDoc?.id }
  );

  // Extract lines from transcription
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

  const currentLine = lines[currentLineIndex] ?? "";
  const totalLines = lines.length;

  // Calculate pyramid blocks filled
  const sessionBlocks = reviewedLines.size;
  const historicalBlocks = stats ? (stats.pagesCompleted * 10 + stats.linesReviewed) % TOTAL_BLOCKS : 0;
  const pyramidBlocks = Math.min((historicalBlocks + sessionBlocks) % TOTAL_BLOCKS, TOTAL_BLOCKS);

  // Check if a row was just completed
  const checkRowCompletion = useCallback((newBlockCount: number) => {
    let cumulative = 0;
    for (let row = 0; row < BLOCKS_PER_ROW.length; row++) {
      cumulative += BLOCKS_PER_ROW[row];
      if (newBlockCount === cumulative) {
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

  // Handle line approval
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

    const newReviewed = new Map(reviewedLines).set(currentLineIndex, { original: currentLine, reviewed: currentLine });
    setReviewedLines(newReviewed);
    setLastXp(result.xpEarned);
    setShowXp(true);
    setLastBlockIsCorrection(false);
    setAnimatingBlock(pyramidBlocks);
    setTimeout(() => { setShowXp(false); setAnimatingBlock(null); }, 800);

    checkRowCompletion((historicalBlocks + newReviewed.size) % TOTAL_BLOCKS);

    if (result.dailyBonus > 0 && currentLineIndex === 0 && reviewedLines.size === 0) {
      toast.success(`Daily streak bonus! +${result.dailyBonus} XP`);
    }
    if (result.leveledUp) {
      toast.success(`Level up! You're now Level ${result.level}!`);
    }

    refetchStats();
    advanceLine(newReviewed);
  }, [currentDoc, transcription, currentLineIndex, currentLine, projectId, reviewedLines, pyramidBlocks, historicalBlocks]);

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

    const newReviewed = new Map(reviewedLines).set(currentLineIndex, { original: currentLine, reviewed: editedLine.trim() });
    setReviewedLines(newReviewed);
    setLastXp(result.xpEarned);
    setShowXp(true);
    setLastBlockIsCorrection(true);
    setAnimatingBlock(pyramidBlocks);
    setTimeout(() => { setShowXp(false); setAnimatingBlock(null); }, 800);
    setEditMode(false);
    setEditedLine("");

    checkRowCompletion((historicalBlocks + newReviewed.size) % TOTAL_BLOCKS);

    if (result.leveledUp) {
      toast.success(`Level up! You're now Level ${result.level}!`);
    }

    refetchStats();
    advanceLine(newReviewed);
  }, [currentDoc, transcription, currentLineIndex, currentLine, editedLine, projectId, reviewedLines, pyramidBlocks, historicalBlocks]);

  // Advance to next line
  const advanceLine = useCallback((reviewed: Map<number, any>) => {
    for (let i = currentLineIndex + 1; i < totalLines; i++) {
      if (!reviewed.has(i)) { setCurrentLineIndex(i); return; }
    }
    if (reviewed.size >= totalLines) {
      handlePageComplete(reviewed);
    } else {
      for (let i = 0; i < currentLineIndex; i++) {
        if (!reviewed.has(i)) { setCurrentLineIndex(i); return; }
      }
    }
  }, [currentLineIndex, totalLines]);

  // Handle page completion
  const handlePageComplete = useCallback(async (reviewed: Map<number, any>) => {
    if (!currentDoc || !transcription) return;
    const allReviewed = Array.from(reviewed.entries()).map(([idx, data]) => ({
      index: idx, original: data.original, reviewed: data.reviewed,
    }));
    try {
      const result = await completePage.mutateAsync({
        projectId,
        documentId: currentDoc.id,
        transcriptionId: transcription.id,
        reviewedLines: allReviewed,
        metadataCorrections: {},
      });
      toast.success(`Document complete! +${result.xpEarned} XP bonus!`);
      refetchStats();
      if (documents?.documents && currentDocIndex < documents.documents.length - 1) {
        setCurrentDocIndex(prev => prev + 1);
        setCurrentLineIndex(0);
        setReviewedLines(new Map());
        setEditMode(false);
      } else {
        toast.success("All documents reviewed! Your pyramid stands tall!");
      }
    } catch {
      toast.error("Failed to save page review");
    }
  }, [currentDoc, transcription, projectId, currentDocIndex, documents]);

  // Enter edit mode
  const startEdit = useCallback(() => {
    setEditMode(true);
    setEditedLine(currentLine);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [currentLine]);

  // Skip line
  const skipLine = useCallback(() => {
    if (currentLineIndex < totalLines - 1) setCurrentLineIndex(prev => prev + 1);
    setEditMode(false);
  }, [currentLineIndex, totalLines]);

  // Touch swipe handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swiping.current = true;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return;
    swiping.current = false;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - startX.current;
    const deltaY = endY - startY.current;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
      if (deltaX > 0) handleApprove();
      else skipLine();
    }
  }, [handleApprove, skipLine]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editMode) return;
      if (e.key === "Enter") { e.preventDefault(); handleApprove(); }
      else if (e.key === "e" || e.key === "E") { e.preventDefault(); startEdit(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipLine(); }
      else if (e.key === "ArrowLeft" && currentLineIndex > 0) { e.preventDefault(); setCurrentLineIndex(prev => prev - 1); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, handleApprove, startEdit, skipLine, currentLineIndex]);

  // Reset when document changes
  useEffect(() => {
    setCurrentLineIndex(0);
    setReviewedLines(new Map());
    setEditMode(false);
  }, [currentDoc?.id]);

  // Loading
  if (docsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // No documents
  if (!documents?.documents?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-6">
        <Trophy className="w-12 h-12 text-yellow-400" />
        <h2 className="text-xl font-semibold text-foreground">All caught up!</h2>
        <p className="text-center">No documents need review. Your pyramid stands complete.</p>
      </div>
    );
  }

  const lineProgress = totalLines > 0 ? Math.round((reviewedLines.size / totalLines) * 100) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top section: Pyramid + optional image */}
      <div className="flex-shrink-0">
        {/* Compact stats row */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-card/30 border-b border-border">
          <div className="flex items-center gap-2">
            {stats && (
              <>
                <div className="flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-xs font-semibold text-foreground">{stats.totalXp}</span>
                </div>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-900/50 text-amber-300">
                  <Star className="w-2.5 h-2.5" /> Lvl {stats.level}
                </span>
                {stats.currentStreak > 0 && (
                  <div className="flex items-center gap-0.5 text-orange-400">
                    <Flame className="w-3 h-3" />
                    <span className="text-[10px] font-semibold">{stats.currentStreak}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {/* Image toggle */}
            {currentDoc?.storageUrl && (
              <button
                onClick={() => setShowImage(!showImage)}
                className={`p-1 rounded ${showImage ? "text-amber-400 bg-amber-500/20" : "text-muted-foreground hover:text-foreground"}`}
                title="Toggle document image"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
            )}
            {languages && languages.length > 1 && (
              <select
                value={selectedLanguage}
                onChange={e => { setSelectedLanguage(e.target.value); setCurrentDocIndex(0); setCurrentLineIndex(0); setReviewedLines(new Map()); }}
                className="bg-background/50 border border-border rounded px-1.5 py-0.5 text-[10px]"
              >
                <option value="">All</option>
                {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
              </select>
            )}
            <span>{currentDocIndex + 1}/{documents.documents.length}</span>
          </div>
        </div>

        {/* Pyramid or Image viewer */}
        {showImage && currentDoc?.storageUrl ? (
          <div style={{ height: "30vh", minHeight: "160px" }}>
            <MiniImageViewer src={currentDoc.storageUrl} alt={currentDoc.filename} />
          </div>
        ) : (
          <div className="relative" style={{ height: "26vh", minHeight: "140px" }}>
            <PyramidVisualization
              filledBlocks={pyramidBlocks}
              totalBlocks={TOTAL_BLOCKS}
              lastBlockIsCorrection={lastBlockIsCorrection}
              animatingBlock={animatingBlock}
              pagesCompleted={stats?.pagesCompleted ?? 0}
            />
            <AnimatePresence>
              <RowCompleteCelebration show={showRowComplete} rowNum={completedRow} />
            </AnimatePresence>
          </div>
        )}

        {/* Document progress bar */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-card/20">
          <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{currentDoc?.filename}</span>
          <Progress value={lineProgress} className="h-1 flex-1" />
          <span className="text-[9px] text-muted-foreground">{lineProgress}%</span>
        </div>
      </div>

      {/* Bottom: Review card with swipe */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Scrollable line content */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Previous lines context */}
          <div className="space-y-1 mb-3">
            {lines.slice(Math.max(0, currentLineIndex - 2), currentLineIndex).map((line, i) => {
              const actualIdx = Math.max(0, currentLineIndex - 2) + i;
              const isReviewed = reviewedLines.has(actualIdx);
              return (
                <div key={actualIdx} className={`text-xs py-0.5 px-2 rounded ${isReviewed ? "text-muted-foreground/40 line-through" : "text-muted-foreground/60"}`}>
                  {line}
                </div>
              );
            })}
          </div>

          {/* Active line card */}
          <div className="relative border-2 border-amber-500/50 rounded-lg p-3 bg-amber-500/5">
            <div className="absolute -top-2.5 left-3 bg-background px-2 text-[10px] text-amber-400 font-medium">
              Line {currentLineIndex + 1}/{totalLines}
            </div>

            {!editMode ? (
              <div className="text-sm font-medium leading-relaxed min-h-[2.5rem]">
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
                className="text-sm font-medium p-2"
                style={{ fontSize: "16px" }}
                placeholder="Type the corrected text..."
                autoFocus
              />
            )}

            <XpPopup xp={lastXp} show={showXp} />
          </div>

          {/* Swipe hint */}
          <div className="flex items-center justify-between mt-2 text-[9px] text-muted-foreground/40 px-2">
            <span>← swipe skip</span>
            <span>swipe approve →</span>
          </div>

          {/* Next lines preview */}
          <div className="space-y-1 mt-3">
            {lines.slice(currentLineIndex + 1, currentLineIndex + 3).map((line, i) => (
              <div key={currentLineIndex + 1 + i} className="text-xs py-0.5 px-2 text-muted-foreground/30">
                {line}
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0 border-t border-border px-3 py-3 bg-background/80 backdrop-blur-sm">
          {!editMode ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleApprove}
                className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold"
                disabled={submitLine.isPending}
              >
                <CheckCircle2 className="w-5 h-5 mr-1.5" />
                Correct
              </Button>
              <Button
                onClick={startEdit}
                variant="outline"
                className="flex-1 h-12 text-sm font-semibold border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
              >
                <Edit3 className="w-5 h-5 mr-1.5" />
                Edit
              </Button>
              <Button
                onClick={skipLine}
                variant="ghost"
                className="h-12 w-12 p-0"
                title="Skip"
              >
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleCorrect}
                className="flex-1 h-12 bg-amber-600 hover:bg-amber-700 text-sm font-semibold"
                disabled={submitLine.isPending || !editedLine.trim()}
              >
                <CheckCircle2 className="w-5 h-5 mr-1.5" />
                Submit
              </Button>
              <Button
                onClick={() => { setEditMode(false); setEditedLine(""); }}
                variant="ghost"
                className="h-12"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
