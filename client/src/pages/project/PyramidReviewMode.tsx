import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import {
  CheckCircle2, Edit3, SkipForward, Loader2,
  Flame, Zap, Star, Trophy
} from "lucide-react";
import { PanZoomImageViewer } from "./QuickReviewPage";

interface Props {
  projectId: number;
}

// Pyramid config
const ROWS = [9, 8, 7, 6, 5, 4, 3, 1];
const TOTAL_BLOCKS = ROWS.reduce((a, b) => a + b, 0); // 43

function getBlockPosition(idx: number) {
  let remaining = idx;
  for (let row = 0; row < ROWS.length; row++) {
    if (remaining < ROWS[row]) return { row, col: remaining, rowWidth: ROWS[row] };
    remaining -= ROWS[row];
  }
  return { row: ROWS.length - 1, col: 0, rowWidth: 1 };
}

// ─── ISOMETRIC PYRAMID (Large, central, warm lighting) ───────────────────────
function IsometricPyramid({ filled, total, animIdx, showIncoming }: {
  filled: number; total: number; animIdx: number | null; showIncoming: boolean;
}) {
  const W = 320;
  const H = 280;
  const bH = 22;
  const maxRowW = 240;
  const baseY = H - 30;

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Warm stone gradients */}
          <linearGradient id="iso-stone-face" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#c9a05c" />
            <stop offset="100%" stopColor="#8b6b3a" />
          </linearGradient>
          <linearGradient id="iso-stone-side" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a07d42" />
            <stop offset="100%" stopColor="#6b4f2a" />
          </linearGradient>
          <linearGradient id="iso-stone-top" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e0c080" />
            <stop offset="100%" stopColor="#c9a05c" />
          </linearGradient>
          <linearGradient id="iso-gold-face" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffd700" />
            <stop offset="100%" stopColor="#b8860b" />
          </linearGradient>
          <linearGradient id="iso-glow" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#ffd700" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ff8c00" stopOpacity="0" />
          </linearGradient>
          {/* Capstone triangle gradient */}
          <linearGradient id="capstone-grad" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#ffd700" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#e6ac00" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#b8860b" stopOpacity="0.2" />
          </linearGradient>
          <filter id="glow-filter">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Capstone triangle (ghost outline, always visible) */}
        <polygon
          points={`${W / 2},${baseY - ROWS.length * bH - 30} ${W / 2 - maxRowW / 2 - 10},${baseY + 5} ${W / 2 + maxRowW / 2 + 10},${baseY + 5}`}
          fill="url(#capstone-grad)"
          stroke="rgba(255,215,0,0.15)"
          strokeWidth="1"
        />

        {/* Ground shadow */}
        <ellipse cx={W / 2} cy={baseY + 8} rx={maxRowW / 2 + 20} ry="8" fill="rgba(0,0,0,0.3)" />

        {/* Filled blocks as isometric cubes */}
        {Array.from({ length: Math.min(filled, total) }).map((_, i) => {
          const { row, col, rowWidth } = getBlockPosition(i);
          const rowW = (rowWidth / ROWS[0]) * maxRowW;
          const singleW = rowW / rowWidth;
          const rowX = (W - rowW) / 2 + col * singleW;
          const rowY = baseY - (row + 1) * bH;
          const isAnim = animIdx === i;
          const isGold = row >= 6;
          const depth = 6; // isometric depth

          // Isometric block: front face + top face + right face
          const frontPath = `M${rowX + 1},${rowY + bH - 1} L${rowX + 1},${rowY + 1} L${rowX + singleW - 1},${rowY + 1} L${rowX + singleW - 1},${rowY + bH - 1} Z`;
          const topPath = `M${rowX + 1},${rowY + 1} L${rowX + 1 + depth / 2},${rowY + 1 - depth} L${rowX + singleW - 1 + depth / 2},${rowY + 1 - depth} L${rowX + singleW - 1},${rowY + 1} Z`;
          const rightPath = `M${rowX + singleW - 1},${rowY + 1} L${rowX + singleW - 1 + depth / 2},${rowY + 1 - depth} L${rowX + singleW - 1 + depth / 2},${rowY + bH - 1 - depth} L${rowX + singleW - 1},${rowY + bH - 1} Z`;

          return (
            <motion.g
              key={i}
              initial={isAnim ? { opacity: 0, y: -40, scale: 0.5 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={isAnim ? { type: "spring", stiffness: 300, damping: 18, delay: 0.1 } : { duration: 0 }}
            >
              {/* Front face */}
              <path d={frontPath} fill={isGold ? "url(#iso-gold-face)" : "url(#iso-stone-face)"} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
              {/* Top face */}
              <path d={topPath} fill={isGold ? "#ffe44d" : "url(#iso-stone-top)"} stroke="rgba(0,0,0,0.2)" strokeWidth="0.3" />
              {/* Right face */}
              <path d={rightPath} fill={isGold ? "#b8860b" : "url(#iso-stone-side)"} stroke="rgba(0,0,0,0.3)" strokeWidth="0.3" />
              {/* Glow on newly placed block */}
              {isAnim && (
                <rect
                  x={rowX}
                  y={rowY}
                  width={singleW}
                  height={bH}
                  fill="rgba(255,215,0,0.4)"
                  filter="url(#glow-filter)"
                  rx="1"
                >
                  <animate attributeName="opacity" values="0.6;0;0" dur="1s" fill="freeze" />
                </rect>
              )}
            </motion.g>
          );
        })}

        {/* Ghost blocks for unfilled rows */}
        {ROWS.map((rowWidth, row) => {
          let startBlock = 0;
          for (let r = 0; r < row; r++) startBlock += ROWS[r];
          if (filled >= startBlock + rowWidth) return null;
          const rowW = (rowWidth / ROWS[0]) * maxRowW;
          const rowX = (W - rowW) / 2;
          const rowY = baseY - (row + 1) * bH;
          return (
            <rect
              key={`ghost-${row}`}
              x={rowX}
              y={rowY}
              width={rowW}
              height={bH}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="0.5"
              strokeDasharray="3 2"
              rx="1"
            />
          );
        })}

        {/* Incoming block animation arrow (when showIncoming) */}
        {showIncoming && (
          <motion.g
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {/* Curved arrow */}
            <path
              d={`M${W / 2 + 60},${baseY - filled * 0.5 - 20} Q${W / 2 + 30},${baseY - filled * 0.8 - 50} ${W / 2},${baseY - (Math.floor(filled / ROWS[0]) + 1) * bH - 10}`}
              fill="none"
              stroke="#d4a020"
              strokeWidth="2"
              strokeDasharray="4 3"
              opacity="0.7"
              markerEnd="url(#arrowhead)"
            />
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#d4a020" />
              </marker>
            </defs>
          </motion.g>
        )}
      </svg>
    </div>
  );
}

// ─── DIGITAL RULER (Draggable golden bar overlay) ────────────────────────────
function DigitalRuler({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [position, setPosition] = useState(40); // percentage from top
  const dragging = useRef(false);
  const startY = useRef(0);
  const startPos = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startPos.current = position;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dy = e.clientY - startY.current;
    const pctChange = (dy / rect.height) * 100;
    setPosition(Math.max(5, Math.min(90, startPos.current + pctChange)));
  }, [containerRef]);

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleTouchStart = (e: React.TouchEvent) => {
    dragging.current = true;
    startY.current = e.touches[0].clientY;
    startPos.current = position;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dy = e.touches[0].clientY - startY.current;
    const pctChange = (dy / rect.height) * 100;
    setPosition(Math.max(5, Math.min(90, startPos.current + pctChange)));
  };

  const handleTouchEnd = () => { dragging.current = false; };

  return (
    <div
      className="absolute left-0 right-0 z-20 cursor-ns-resize select-none"
      style={{ top: `${position}%` }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Golden ruler bar */}
      <div className="relative h-8 mx-2">
        <div className="absolute inset-0 rounded bg-gradient-to-r from-amber-600/70 via-amber-400/80 to-amber-600/70 border border-amber-500/60 shadow-lg shadow-amber-500/20 backdrop-blur-sm" />
        {/* Ruler markings */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-semibold text-amber-900/80 tracking-wider uppercase">Digital Ruler</span>
        </div>
        {/* Grab handles */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-8 h-1.5 rounded-full bg-amber-300/60" />
        <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-8 h-1.5 rounded-full bg-amber-300/60" />
      </div>
    </div>
  );
}

// ─── SWIPE CARD (Mobile) ─────────────────────────────────────────────────────
function SwipeCard({
  line,
  lineIndex,
  totalLines,
  onApprove,
  onSkip,
  onEdit,
  isPending,
}: {
  line: string;
  lineIndex: number;
  totalLines: number;
  onApprove: () => void;
  onSkip: () => void;
  onEdit: () => void;
  isPending: boolean;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  const opacity = useTransform(x, [-200, -100, 0, 100, 200], [0.5, 0.8, 1, 0.8, 0.5]);
  const approveOpacity = useTransform(x, [0, 80, 150], [0, 0.5, 1]);
  const skipOpacity = useTransform(x, [-150, -80, 0], [1, 0.5, 0]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.x > 100) onApprove();
    else if (info.offset.x < -100) onSkip();
  };

  return (
    <div className="relative w-full">
      {/* Swipe indicators */}
      <motion.div
        className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400 font-bold text-sm z-10"
        style={{ opacity: skipOpacity }}
      >
        ← SKIP
      </motion.div>
      <motion.div
        className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold text-sm z-10"
        style={{ opacity: approveOpacity }}
      >
        VERIFY →
      </motion.div>

      {/* The card */}
      <motion.div
        className="relative mx-auto w-[90%] rounded-xl border-2 border-amber-500/40 bg-card/90 backdrop-blur-sm p-4 shadow-xl cursor-grab active:cursor-grabbing"
        style={{ x, rotate, opacity }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.8}
        onDragEnd={handleDragEnd}
        whileDrag={{ scale: 1.02 }}
      >
        {/* Card header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-muted-foreground">← skip</span>
          <span className="text-xs text-amber-400 font-semibold">Line {lineIndex + 1}/{totalLines}</span>
          <span className="text-[10px] text-muted-foreground">verify →</span>
        </div>

        {/* Line text */}
        <div className="text-base font-medium leading-relaxed min-h-[2.5rem] text-center py-2">
          {line}
        </div>
      </motion.div>
    </div>
  );
}

// ─── XP POPUP ────────────────────────────────────────────────────────────────
function XpPopup({ xp, show }: { xp: number; show: boolean }) {
  if (!show) return null;
  return (
    <motion.div
      className="absolute top-0 left-1/2 -translate-x-1/2 text-amber-400 font-bold text-lg pointer-events-none z-50"
      initial={{ opacity: 1, y: 0, scale: 1.3 }}
      animate={{ opacity: 0, y: -30, scale: 0.7 }}
      transition={{ duration: 0.8 }}
    >
      +{xp} XP
    </motion.div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function PyramidReviewMode({ projectId }: Props) {
  const [currentDocIndex, setCurrentDocIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedLine, setEditedLine] = useState("");
  const [reviewedLines, setReviewedLines] = useState<Map<number, { original: string; reviewed: string }>>(new Map());
  const [showXp, setShowXp] = useState(false);
  const [lastXp, setLastXp] = useState(0);
  const [animatingBlock, setAnimatingBlock] = useState<number | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [showIncoming, setShowIncoming] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mobile detection
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

  // Mutations
  const submitLine = trpc.gamification.submitLineReview.useMutation();
  const completePage = trpc.gamification.completePage.useMutation();

  const handleApprove = useCallback(async () => {
    if (!currentDoc || !transcription) return;
    setShowIncoming(false);
    const result = await submitLine.mutateAsync({
      projectId, documentId: currentDoc.id, transcriptionId: transcription.id,
      lineIndex: currentLineIndex, originalLine: currentLine, reviewedLine: currentLine, isCorrection: false,
    });
    const newReviewed = new Map(reviewedLines).set(currentLineIndex, { original: currentLine, reviewed: currentLine });
    setReviewedLines(newReviewed);
    setLastXp(result.xpEarned); setShowXp(true);
    setAnimatingBlock(pyramidBlocks);
    setTimeout(() => { setShowXp(false); setAnimatingBlock(null); setShowIncoming(true); }, 900);
    if (result.leveledUp) toast.success(`Level up! Now Level ${result.level}!`);
    refetchStats();
    advanceLine(newReviewed);
  }, [currentDoc, transcription, currentLineIndex, currentLine, projectId, reviewedLines, pyramidBlocks]);

  const handleCorrect = useCallback(async () => {
    if (!currentDoc || !transcription || !editedLine.trim()) return;
    setShowIncoming(false);
    const result = await submitLine.mutateAsync({
      projectId, documentId: currentDoc.id, transcriptionId: transcription.id,
      lineIndex: currentLineIndex, originalLine: currentLine, reviewedLine: editedLine.trim(), isCorrection: true,
    });
    const newReviewed = new Map(reviewedLines).set(currentLineIndex, { original: currentLine, reviewed: editedLine.trim() });
    setReviewedLines(newReviewed);
    setLastXp(result.xpEarned); setShowXp(true);
    setAnimatingBlock(pyramidBlocks);
    setTimeout(() => { setShowXp(false); setAnimatingBlock(null); setShowIncoming(true); }, 900);
    setEditMode(false); setEditedLine("");
    if (result.leveledUp) toast.success(`Level up! Now Level ${result.level}!`);
    refetchStats();
    advanceLine(newReviewed);
  }, [currentDoc, transcription, currentLineIndex, currentLine, editedLine, projectId, reviewedLines, pyramidBlocks]);

  const advanceLine = useCallback((reviewed: Map<number, any>) => {
    for (let i = currentLineIndex + 1; i < totalLines; i++) {
      if (!reviewed.has(i)) { setCurrentLineIndex(i); return; }
    }
    if (reviewed.size >= totalLines) handlePageComplete(reviewed);
    else { for (let i = 0; i < currentLineIndex; i++) { if (!reviewed.has(i)) { setCurrentLineIndex(i); return; } } }
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
      } else toast.success("All documents reviewed!");
    } catch { toast.error("Failed to save"); }
  }, [currentDoc, transcription, projectId, currentDocIndex, documents]);

  const startEdit = useCallback(() => { setEditMode(true); setEditedLine(currentLine); setTimeout(() => inputRef.current?.focus(), 50); }, [currentLine]);
  const skipLine = useCallback(() => { if (currentLineIndex < totalLines - 1) setCurrentLineIndex(prev => prev + 1); setEditMode(false); }, [currentLineIndex, totalLines]);

  // Keyboard shortcuts (desktop)
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (editMode) return;
      if (e.key === "Enter") { e.preventDefault(); handleApprove(); }
      else if (e.key === "e" || e.key === "E" || e.key === "Tab") { e.preventDefault(); startEdit(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipLine(); }
      else if (e.key === "ArrowLeft" && currentLineIndex > 0) { e.preventDefault(); setCurrentLineIndex(prev => prev - 1); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [editMode, handleApprove, startEdit, skipLine, currentLineIndex]);

  useEffect(() => { setCurrentLineIndex(0); setReviewedLines(new Map()); setEditMode(false); }, [currentDoc?.id]);

  if (docsLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!documents?.documents?.length) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
      <Trophy className="w-12 h-12 text-yellow-400" />
      <h2 className="text-xl font-semibold">All caught up!</h2>
      <p className="text-muted-foreground text-center">No documents need review.</p>
    </div>
  );

  const blocksText = `${pyramidBlocks}/${TOTAL_BLOCKS} blocks verified`;

  // ═══════════════════════════════════════════════════════════════════════════
  // DESKTOP: Canvas & Quarry
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isMobile) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-background">
        {/* Top nav bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
          <div className="flex items-center gap-3">
            {stats && (
              <>
                <div className="flex items-center gap-1">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-bold">{stats.totalXp} XP</span>
                </div>
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-900/40 text-amber-300 border border-amber-700/30">
                  <Star className="w-3 h-3" /> Lvl {stats.level}
                </span>
                {stats.currentStreak > 0 && (
                  <div className="flex items-center gap-0.5 text-orange-400">
                    <Flame className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">{stats.currentStreak} Streak</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="truncate max-w-[180px]">{currentDoc?.filename}</span>
            {languages && languages.length > 1 && (
              <select
                value={selectedLanguage}
                onChange={e => { setSelectedLanguage(e.target.value); setCurrentDocIndex(0); setCurrentLineIndex(0); setReviewedLines(new Map()); }}
                className="bg-background border border-border rounded px-2 py-1 text-xs"
              >
                <option value="">All</option>
                {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
              </select>
            )}
            <span>{currentDocIndex + 1}/{documents.documents.length} docs</span>
          </div>
        </div>

        {/* Main split */}
        <div className="flex-1 flex min-h-0">
          {/* LEFT: Document image with digital ruler */}
          <div className="w-[45%] flex flex-col min-h-0 border-r border-border relative">
            <div className="flex-1 min-h-0">
              {currentDoc?.storageUrl ? (
                <PanZoomImageViewer
                  src={currentDoc.storageUrl}
                  alt={currentDoc.filename || "Document"}
                  isMobile={false}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">No image</div>
              )}
            </div>
          </div>

          {/* RIGHT: Pyramid + Review */}
          <div className="w-[55%] flex flex-col min-h-0 bg-gradient-to-b from-[#0a0515] via-[#120a25] to-background">
            {/* Stats row */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2">
              <span className="text-xs text-amber-400/80">{blocksText}</span>
              <span className="text-xs text-muted-foreground">{currentDocIndex + 1}/{documents.documents.length} docs</span>
            </div>

            {/* Pyramid visualization (main focus) */}
            <div className="flex-1 min-h-0 relative px-4">
              <IsometricPyramid
                filled={pyramidBlocks}
                total={TOTAL_BLOCKS}
                animIdx={animatingBlock}
                showIncoming={showIncoming}
              />
              <AnimatePresence>
                {showXp && (
                  <motion.div
                    className="absolute top-4 left-1/2 -translate-x-1/2 text-amber-400 font-bold text-xl z-50"
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -30 }}
                    transition={{ duration: 0.8 }}
                  >
                    +{lastXp} XP
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Current line card */}
            <div className="flex-shrink-0 px-4 pb-2">
              <div className="relative border-2 border-amber-500/50 rounded-xl p-4 bg-card/50 backdrop-blur-sm">
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
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex-shrink-0 px-4 pb-4">
              {!editMode ? (
                <div className="flex items-center gap-3">
                  <Button onClick={handleApprove} className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-base font-semibold" disabled={submitLine.isPending}>
                    <CheckCircle2 className="w-5 h-5 mr-2" /> Correct
                  </Button>
                  <Button onClick={startEdit} className="flex-1 h-12 bg-amber-500 hover:bg-amber-600 text-black text-base font-semibold">
                    <Edit3 className="w-5 h-5 mr-2" /> Edit
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Button onClick={handleCorrect} className="flex-1 h-12 bg-amber-600 hover:bg-amber-700 text-base font-semibold" disabled={submitLine.isPending || !editedLine.trim()}>
                    <CheckCircle2 className="w-5 h-5 mr-2" /> Submit
                  </Button>
                  <Button onClick={() => { setEditMode(false); setEditedLine(""); }} variant="ghost" className="h-12 text-base">Cancel</Button>
                </div>
              )}
              {/* Keyboard hints */}
              <div className="flex items-center justify-center gap-6 mt-2 text-[10px] text-muted-foreground/50">
                <span>Enter = approve</span>
                <span>Tab = edit</span>
                <span>→ = skip</span>
                <span>← = back</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE: Locked Deck
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Mobile header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border">
        {stats && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-xs font-bold">{stats.totalXp} XP</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-300 font-semibold">
              <Star className="w-2.5 h-2.5 inline mr-0.5" />Lvl {stats.level}
            </span>
            {stats.currentStreak > 0 && (
              <span className="flex items-center gap-0.5 text-orange-400 text-[10px]">
                <Flame className="w-3 h-3" />{stats.currentStreak} Streak
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Top 40%: Locked document viewer */}
      <div className="flex-shrink-0 border-b border-border" style={{ height: "40%" }}>
        {currentDoc?.storageUrl ? (
          <PanZoomImageViewer
            src={currentDoc.storageUrl}
            alt={currentDoc.filename || "Document"}
            isMobile={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-neutral-900 text-muted-foreground text-sm">No image</div>
        )}
      </div>

      {/* Bottom 60%: Swipe deck + pyramid + buttons */}
      <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-b from-[#0a0515] to-background">
        {/* Mini pyramid + swipe card area */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-3 py-2 relative">
          {/* Swipe card */}
          {!editMode ? (
            <SwipeCard
              line={currentLine}
              lineIndex={currentLineIndex}
              totalLines={totalLines}
              onApprove={handleApprove}
              onSkip={skipLine}
              onEdit={startEdit}
              isPending={submitLine.isPending}
            />
          ) : (
            <div className="w-[90%] mx-auto rounded-xl border-2 border-amber-500/40 bg-card/90 backdrop-blur-sm p-4">
              <div className="text-xs text-amber-400 font-semibold mb-2">Line {currentLineIndex + 1}/{totalLines} — Editing</div>
              <Input
                ref={inputRef}
                value={editedLine}
                onChange={e => setEditedLine(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCorrect(); if (e.key === "Escape") { setEditMode(false); setEditedLine(""); } }}
                className="text-base font-medium"
                style={{ fontSize: "16px" }}
                placeholder="Type corrected text..."
                autoFocus
              />
            </div>
          )}

          {/* Mini pyramid below card */}
          <div className="w-full max-w-[200px] h-[100px] mt-2">
            <IsometricPyramid filled={pyramidBlocks} total={TOTAL_BLOCKS} animIdx={animatingBlock} showIncoming={false} />
          </div>

          {/* XP popup */}
          <AnimatePresence>
            {showXp && (
              <motion.div
                className="absolute top-2 left-1/2 -translate-x-1/2 text-amber-400 font-bold text-lg z-50"
                initial={{ opacity: 1, y: 0 }}
                animate={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.7 }}
              >
                +{lastXp} XP
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0 px-3 pb-3 pt-1">
          {!editMode ? (
            <div className="flex items-center gap-2">
              <Button onClick={handleApprove} className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold" disabled={submitLine.isPending}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Correct
              </Button>
              <Button onClick={startEdit} className="flex-1 h-11 bg-amber-500 hover:bg-amber-600 text-black text-sm font-semibold">
                <Edit3 className="w-4 h-4 mr-1" /> Edit
              </Button>
              <Button onClick={skipLine} variant="ghost" className="h-11 px-3 text-sm text-muted-foreground">
                Skip
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button onClick={handleCorrect} className="flex-1 h-11 bg-amber-600 hover:bg-amber-700 text-sm font-semibold" disabled={submitLine.isPending || !editedLine.trim()}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Submit
              </Button>
              <Button onClick={() => { setEditMode(false); setEditedLine(""); }} variant="ghost" className="h-11">Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
