import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  CheckCircle2, Edit3, ChevronRight, ChevronLeft, Zap,
  Flame, Trophy, Star, SkipForward, Loader2, ImageIcon
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface Props {
  projectId: number;
}

// XP animation component
function XpPopup({ xp, show }: { xp: number; show: boolean }) {
  if (!show) return null;
  return (
    <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce text-yellow-400 font-bold text-sm pointer-events-none">
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

export default function QuickReviewPage({ projectId }: Props) {
  const [currentDocIndex, setCurrentDocIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedLine, setEditedLine] = useState("");
  const [reviewedLines, setReviewedLines] = useState<Map<number, { original: string; reviewed: string }>>(new Map());
  const [showXp, setShowXp] = useState(false);
  const [lastXp, setLastXp] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch documents that need review
  const { data: documents, isLoading: docsLoading } = trpc.documents.listPaginated.useQuery(
    { projectId, status: "needs_review", limit: 100 },
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

  // Current document
  const currentDoc = documents?.documents?.[currentDocIndex];

  // Fetch transcription for current document
  const { data: transcription } = trpc.transcriptions.getByDocument.useQuery(
    { documentId: currentDoc?.id ?? 0, projectId },
    { enabled: !!currentDoc?.id }
  );

  // Extract lines from transcription
  const lines = useMemo(() => {
    if (!transcription?.rawJson) return [];
    const raw = transcription.rawJson as Record<string, unknown>;
    // Find the main text field
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
  const progress = totalLines > 0 ? Math.round((reviewedLines.size / totalLines) * 100) : 0;

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
  }, [currentDoc, transcription, currentLineIndex, currentLine, projectId]);

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

  // Advance to next line or complete page
  const advanceLine = useCallback(() => {
    // Find next unreviewed line
    for (let i = currentLineIndex + 1; i < totalLines; i++) {
      if (!reviewedLines.has(i)) {
        setCurrentLineIndex(i);
        return;
      }
    }
    // Check if all lines are done
    if (reviewedLines.size + 1 >= totalLines) {
      // Page complete!
      handlePageComplete();
    } else {
      // Wrap around to find unreviewed lines
      for (let i = 0; i < currentLineIndex; i++) {
        if (!reviewedLines.has(i)) {
          setCurrentLineIndex(i);
          return;
        }
      }
    }
  }, [currentLineIndex, totalLines, reviewedLines]);

  // Handle page completion
  const handlePageComplete = useCallback(async () => {
    if (!currentDoc || !transcription) return;

    const allReviewed = Array.from(reviewedLines.entries()).map(([idx, data]) => ({
      index: idx,
      original: data.original,
      reviewed: data.reviewed,
    }));

    // Add the current line that just got reviewed
    allReviewed.push({ index: currentLineIndex, original: currentLine, reviewed: editMode ? editedLine : currentLine });

    try {
      const result = await completePage.mutateAsync({
        projectId,
        documentId: currentDoc.id,
        transcriptionId: transcription.id,
        reviewedLines: allReviewed,
      });

      toast.success(`🎉 Page complete! +${result.xpEarned} XP bonus!`);
      refetchStats();

      // Move to next document
      if (documents?.documents && currentDocIndex < documents.documents.length - 1) {
        setCurrentDocIndex(prev => prev + 1);
        setCurrentLineIndex(0);
        setReviewedLines(new Map());
        setEditMode(false);
      } else {
        toast.success("🏆 All documents reviewed! Amazing work!");
      }
    } catch (err) {
      toast.error("Failed to save page review");
    }
  }, [currentDoc, transcription, reviewedLines, currentLineIndex, currentLine, editMode, editedLine, projectId, currentDocIndex, documents]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when editing
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

  // Loading state
  if (docsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // No documents to review
  if (!documents?.documents?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Trophy className="w-12 h-12 text-yellow-400" />
        <h2 className="text-xl font-semibold text-foreground">All caught up!</h2>
        <p>No documents need review right now. Check back later.</p>
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
    <div className="flex flex-col h-full">
      {/* Top stats bar */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {stats && (
              <>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-semibold">{stats.totalXp} XP</span>
                </div>
                <LevelBadge level={stats.level} />
                {stats.currentStreak > 0 && (
                  <div className="flex items-center gap-1 text-orange-400">
                    <Flame className="w-4 h-4" />
                    <span className="text-sm font-semibold">{stats.currentStreak} day streak</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Doc {currentDocIndex + 1}/{documents.documents.length}</span>
            <span>•</span>
            <span>Line {currentLineIndex + 1}/{totalLines}</span>
          </div>
        </div>
        {stats && (
          <div className="mt-2">
            <Progress value={stats.progress.needed > 0 ? (stats.progress.current / stats.progress.needed) * 100 : 0} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.progress.current}/{stats.progress.needed} XP to Level {stats.level + 1}
            </p>
          </div>
        )}
      </div>

      {/* Main review area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Document image */}
        <div className="w-1/2 border-r border-border bg-black/20 flex items-center justify-center overflow-hidden p-4">
          {currentDoc?.storageUrl ? (
            <img
              src={currentDoc.storageUrl}
              alt={currentDoc.filename}
              className="max-w-full max-h-full object-contain rounded"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <ImageIcon className="w-12 h-12" />
              <span className="text-sm">No image available</span>
            </div>
          )}
        </div>

        {/* Right: Line review */}
        <div className="w-1/2 flex flex-col">
          {/* Document info */}
          <div className="px-6 py-3 border-b border-border bg-card/30">
            <h3 className="text-sm font-medium truncate">{currentDoc?.filename}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="text-[10px] text-muted-foreground">{progress}%</span>
            </div>
          </div>

          {/* Line context (previous lines) */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-2 mb-6">
              {lines.slice(Math.max(0, currentLineIndex - 3), currentLineIndex).map((line, i) => {
                const actualIdx = Math.max(0, currentLineIndex - 3) + i;
                const isReviewed = reviewedLines.has(actualIdx);
                return (
                  <div key={actualIdx} className={`text-sm py-1 px-2 rounded ${isReviewed ? "text-muted-foreground/50 line-through" : "text-muted-foreground/70"}`}>
                    {line}
                  </div>
                );
              })}
            </div>

            {/* Current line — the focus */}
            <div className="relative border-2 border-primary/50 rounded-lg p-4 bg-primary/5">
              <div className="absolute -top-3 left-3 bg-background px-2 text-xs text-primary font-medium">
                Line {currentLineIndex + 1}
              </div>

              {!editMode ? (
                <div className="text-base font-medium leading-relaxed">
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
                  className="text-base font-medium"
                  placeholder="Type the corrected text..."
                />
              )}

              <XpPopup xp={lastXp} show={showXp} />
            </div>

            {/* Next lines preview */}
            <div className="space-y-2 mt-6">
              {lines.slice(currentLineIndex + 1, currentLineIndex + 4).map((line, i) => (
                <div key={currentLineIndex + 1 + i} className="text-sm py-1 px-2 text-muted-foreground/40">
                  {line}
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex-shrink-0 border-t border-border px-6 py-4">
            {!editMode ? (
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleApprove}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={submitLine.isPending}
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Correct (+2 XP)
                </Button>
                <Button
                  onClick={startEdit}
                  variant="outline"
                  className="flex-1"
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  Edit (+5 XP)
                </Button>
                <Button
                  onClick={skipLine}
                  variant="ghost"
                  size="icon"
                  title="Skip this line"
                >
                  <SkipForward className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleCorrect}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={submitLine.isPending || !editedLine.trim()}
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Submit correction (+5 XP)
                </Button>
                <Button
                  onClick={() => { setEditMode(false); setEditedLine(""); }}
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Keyboard: Enter = approve/submit • E = edit • → = skip
            </p>
          </div>
        </div>
      </div>

      {/* Bottom: Mini leaderboard */}
      {leaderboard && leaderboard.length > 0 && (
        <div className="flex-shrink-0 border-t border-border bg-card/30 px-6 py-2">
          <div className="flex items-center gap-6">
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
        </div>
      )}
    </div>
  );
}
