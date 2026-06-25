import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Edit3, SkipForward, Loader2,
  Flame, Zap, Star, Trophy
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface Props {
  projectId: number;
}

// Pyramid configuration
const BLOCKS_PER_ROW = [15, 13, 11, 9, 7, 5, 3, 1]; // bottom to top (8 rows)
const TOTAL_BLOCKS = BLOCKS_PER_ROW.reduce((a, b) => a + b, 0); // 64 blocks total

// Calculate which row and position a block index falls into
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

// SVG Pyramid component
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
  const pyramidWidth = 320;
  const pyramidHeight = 240;
  const blockHeight = pyramidHeight / BLOCKS_PER_ROW.length;
  const maxRowWidth = pyramidWidth * 0.9;

  // Calculate pyramid stage name
  const progress = filledBlocks / totalBlocks;
  const stageName = progress >= 1 ? "Capstone" :
    progress >= 0.75 ? "Upper Chambers" :
    progress >= 0.5 ? "Mid Section" :
    progress >= 0.25 ? "Lower Chambers" : "Foundation";

  return (
    <div className="relative flex flex-col items-center">
      {/* Desert sky gradient background */}
      <div className="absolute inset-0 rounded-lg overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#1a0a2e] via-[#2d1b4e] to-[#d4a574]" />
        {/* Stars */}
        <div className="absolute top-2 left-4 w-1 h-1 bg-white/60 rounded-full" />
        <div className="absolute top-6 left-12 w-0.5 h-0.5 bg-white/40 rounded-full" />
        <div className="absolute top-3 right-8 w-1 h-1 bg-white/50 rounded-full" />
        <div className="absolute top-8 right-16 w-0.5 h-0.5 bg-white/30 rounded-full" />
        <div className="absolute top-5 left-1/3 w-0.5 h-0.5 bg-white/40 rounded-full" />
        {/* Sand dunes at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#c4956a] to-transparent" />
      </div>

      {/* Pyramid SVG */}
      <svg
        viewBox={`0 0 ${pyramidWidth} ${pyramidHeight}`}
        className="relative z-10 w-full max-w-[320px] h-auto"
        style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.3))" }}
      >
        {/* Pyramid outline (ghost) */}
        <polygon
          points={`${pyramidWidth / 2},8 ${pyramidWidth * 0.05},${pyramidHeight - 4} ${pyramidWidth * 0.95},${pyramidHeight - 4}`}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {/* Filled blocks */}
        {Array.from({ length: Math.min(filledBlocks, totalBlocks) }).map((_, i) => {
          const { row, col, rowWidth } = getBlockPosition(i);
          const rowY = pyramidHeight - (row + 1) * blockHeight;
          const blockWidth = maxRowWidth * (rowWidth / BLOCKS_PER_ROW[0]);
          const singleBlockW = blockWidth / rowWidth;
          const rowStartX = (pyramidWidth - blockWidth) / 2;
          const blockX = rowStartX + col * singleBlockW;

          const isAnimating = animatingBlock === i;
          const isCorrection = isAnimating && lastBlockIsCorrection;
          const isLastRow = row === BLOCKS_PER_ROW.length - 1; // capstone

          // Color based on position and type
          let fill = "#c4956a"; // sandstone base
          if (row >= 6) fill = "#ffd700"; // gold top
          else if (row >= 4) fill = "#e8c88a"; // limestone mid
          if (isCorrection) fill = "#fbbf24"; // golden for corrections

          return (
            <motion.rect
              key={i}
              x={blockX + 0.5}
              y={rowY + 0.5}
              width={singleBlockW - 1}
              height={blockHeight - 1}
              rx={1}
              fill={fill}
              stroke="rgba(0,0,0,0.3)"
              strokeWidth={0.5}
              initial={isAnimating ? { opacity: 0, y: rowY - 20, scale: 0.5 } : { opacity: 1 }}
              animate={{
                opacity: 1,
                y: rowY + 0.5,
                scale: 1,
              }}
              transition={isAnimating ? {
                type: "spring",
                stiffness: 300,
                damping: 20,
                duration: 0.5,
              } : { duration: 0 }}
            />
          );
        })}

        {/* Capstone glow when complete */}
        {filledBlocks >= totalBlocks && (
          <motion.polygon
            points={`${pyramidWidth / 2},4 ${pyramidWidth / 2 - 12},${blockHeight + 4} ${pyramidWidth / 2 + 12},${blockHeight + 4}`}
            fill="url(#goldGradient)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}

        <defs>
          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffd700" />
            <stop offset="100%" stopColor="#ff8c00" />
          </linearGradient>
        </defs>
      </svg>

      {/* Stage label */}
      <div className="relative z-10 mt-1 text-center">
        <p className="text-[10px] text-white/60 font-medium tracking-wider uppercase">
          {stageName}
        </p>
        <p className="text-[9px] text-white/40">
          {filledBlocks}/{totalBlocks} blocks • Pyramid {pagesCompleted + 1}
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
          ✨ Row {rowNum} Complete!
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

// Fields that are per-page (text content) — NOT shown in metadata verification
const TEXT_FIELDS = new Set([
  "transcription", "original_text", "text", "content", "translation",
  "body", "body_text", "main_text", "full_text", "raw_text"
]);
const SKIP_FIELDS = new Set([
  "line_count", "word_count", "char_count", "confidence",
  "page_number", "section_of_act", "folio_number"
]);

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
  const inputRef = useRef<HTMLInputElement>(null);
  const swipeRef = useRef<HTMLDivElement>(null);

  // Swipe gesture hook (inline)
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

  // Calculate pyramid blocks filled based on lines reviewed in current session + historical pages
  const sessionBlocks = reviewedLines.size;
  const historicalBlocks = stats ? (stats.pagesCompleted * 10 + stats.linesReviewed) % TOTAL_BLOCKS : 0;
  const pyramidBlocks = Math.min((historicalBlocks + sessionBlocks) % TOTAL_BLOCKS, TOTAL_BLOCKS);
  const pyramidsCompleted = stats ? Math.floor((historicalBlocks + sessionBlocks) / TOTAL_BLOCKS) : 0;

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

    // Check row completion
    checkRowCompletion((historicalBlocks + newReviewed.size) % TOTAL_BLOCKS);

    if (result.dailyBonus > 0 && currentLineIndex === 0 && reviewedLines.size === 0) {
      toast.success(`🔥 Daily streak bonus! +${result.dailyBonus} XP`);
    }
    if (result.leveledUp) {
      toast.success(`⭐ Level up! You're now Level ${result.level}!`);
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
      toast.success(`⭐ Level up! You're now Level ${result.level}!`);
    }

    refetchStats();
    advanceLine(newReviewed);
  }, [currentDoc, transcription, currentLineIndex, currentLine, editedLine, projectId, reviewedLines, pyramidBlocks, historicalBlocks]);

  // Advance to next line
  const advanceLine = useCallback((reviewed: Map<number, any>) => {
    for (let i = currentLineIndex + 1; i < totalLines; i++) {
      if (!reviewed.has(i)) {
        setCurrentLineIndex(i);
        return;
      }
    }
    // Check if all lines done
    if (reviewed.size >= totalLines) {
      handlePageComplete(reviewed);
    } else {
      for (let i = 0; i < currentLineIndex; i++) {
        if (!reviewed.has(i)) {
          setCurrentLineIndex(i);
          return;
        }
      }
    }
  }, [currentLineIndex, totalLines]);

  // Handle page completion
  const handlePageComplete = useCallback(async (reviewed: Map<number, any>) => {
    if (!currentDoc || !transcription) return;

    const allReviewed = Array.from(reviewed.entries()).map(([idx, data]) => ({
      index: idx,
      original: data.original,
      reviewed: data.reviewed,
    }));

    try {
      const result = await completePage.mutateAsync({
        projectId,
        documentId: currentDoc.id,
        transcriptionId: transcription.id,
        reviewedLines: allReviewed,
        metadataCorrections: {},
      });

      toast.success(`🏛️ Document complete! +${result.xpEarned} XP bonus!`);
      refetchStats();

      if (documents?.documents && currentDocIndex < documents.documents.length - 1) {
        setCurrentDocIndex(prev => prev + 1);
        setCurrentLineIndex(0);
        setReviewedLines(new Map());
        setEditMode(false);
      } else {
        toast.success("🏆 All documents reviewed! Your pyramid stands tall!");
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
    if (currentLineIndex < totalLines - 1) {
      setCurrentLineIndex(prev => prev + 1);
    }
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
      else if (e.key === "ArrowLeft" && currentLineIndex > 0) {
        e.preventDefault();
        setCurrentLineIndex(prev => prev - 1);
      }
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
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-b from-[#0d0520] to-background">
      {/* Top: Pyramid visualization + stats */}
      <div className="flex-shrink-0 relative px-3 pt-2 pb-1">
        {/* Compact stats row */}
        <div className="flex items-center justify-between mb-2">
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
            {languages && languages.length > 1 && (
              <select
                value={selectedLanguage}
                onChange={e => {
                  setSelectedLanguage(e.target.value);
                  setCurrentDocIndex(0);
                  setCurrentLineIndex(0);
                  setReviewedLines(new Map());
                }}
                className="bg-background/50 border border-border rounded px-1.5 py-0.5 text-[10px]"
              >
                <option value="">All</option>
                {languages.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            )}
            <span>{currentDocIndex + 1}/{documents.documents.length}</span>
          </div>
        </div>

        {/* Pyramid */}
        <div className="relative rounded-lg overflow-hidden" style={{ height: "28vh", minHeight: "160px" }}>
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

        {/* Document progress bar */}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{currentDoc?.filename}</span>
          <Progress value={lineProgress} className="h-1 flex-1" />
          <span className="text-[9px] text-muted-foreground">{lineProgress}%</span>
        </div>
      </div>

      {/* Bottom: Review card */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Current line card */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Previous lines context (faded) */}
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
