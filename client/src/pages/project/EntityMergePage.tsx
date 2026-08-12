import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Merge,
  X,
  SkipForward,
  Sparkles,
  FileText,
  Check,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  Users,
  MapPin,
  Building2,
  Pencil,
} from "lucide-react";
import { useLocation } from "wouter";

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, typeof Users> = {
  person: Users,
  location: MapPin,
  organization: Building2,
};

const TYPE_COLORS: Record<string, string> = {
  person: "text-orange-700 dark:text-orange-400",
  location: "text-green-700 dark:text-green-400",
  organization: "text-indigo-600 dark:text-indigo-400",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  low: "bg-red-500/15 text-red-600 dark:text-red-600 dark:text-red-400 border-red-500/30",
};

const ALL_STEPS = [
  { id: "person_fuzzy" as const, label: "People (spelling variants)" },
  { id: "person_cross" as const, label: "People (Arabic ↔ Latin)" },
  { id: "location_fuzzy" as const, label: "Locations (spelling variants)" },
  { id: "location_cross" as const, label: "Locations (Arabic ↔ Latin)" },
  { id: "organization_fuzzy" as const, label: "Organizations (spelling variants)" },
  { id: "organization_cross" as const, label: "Organizations (Arabic ↔ Latin)" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function EntityMergePage({ projectId }: { projectId: number }) {
  const [, navigate] = useLocation();

  const [editingCanonical, setEditingCanonical] = useState<number | null>(null);
  const [editedName, setEditedName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [totalFound, setTotalFound] = useState(0);
  const abortRef = useRef(false);

  const utils = trpc.useUtils();

  // Fetch merge suggestions
  const { data: suggestions, isLoading } = trpc.merge.list.useQuery(
    { projectId, status: "pending" },
    { refetchInterval: isGenerating ? 5000 : false },
  );

  // Fetch stats
  const { data: stats } = trpc.merge.stats.useQuery(
    { projectId },
    { refetchInterval: isGenerating ? 5000 : false },
  );

  // Process step mutation
  const processStepMutation = trpc.merge.processStep.useMutation();

  // Run all steps sequentially — each step is its own HTTP request
  const runAllSteps = async () => {
    setIsGenerating(true);
    setCurrentStepIdx(0);
    setTotalFound(0);
    abortRef.current = false;

    let found = 0;
    for (let i = 0; i < ALL_STEPS.length; i++) {
      if (abortRef.current) break;
      setCurrentStepIdx(i);
      try {
        const result = await processStepMutation.mutateAsync({
          projectId,
          step: ALL_STEPS[i].id,
        });
        found += result.suggestionsCreated;
        setTotalFound(found);
        // Refresh the list after each step so new suggestions appear
        utils.merge.list.invalidate();
        utils.merge.stats.invalidate();
      } catch (err: any) {
        toast.error(`Step "${ALL_STEPS[i].label}" failed: ${err.message}`);
        // Continue with next step instead of stopping entirely
      }
    }

    setIsGenerating(false);
    if (found > 0) {
      toast.success(`Done! Found ${found} new potential duplicates to review.`);
    } else {
      toast.info("Analysis complete — no new duplicates found.");
    }
    utils.merge.list.invalidate();
    utils.merge.stats.invalidate();
  };

  // Accept mutation
  const acceptMutation = trpc.merge.accept.useMutation({
    onSuccess: () => {
      toast.success("Entities merged successfully");
      utils.merge.list.invalidate();
      utils.merge.stats.invalidate();
    },
    onError: (err: any) => {
      toast.error(`Merge failed: ${err.message}`);
    },
  });

  // Reject mutation
  const rejectMutation = trpc.merge.reject.useMutation({
    onSuccess: () => {
      toast.success("Marked as different entities");
      utils.merge.list.invalidate();
      utils.merge.stats.invalidate();
    },
  });

  // Skip mutation
  const skipMutation = trpc.merge.skip.useMutation({
    onSuccess: () => {
      utils.merge.list.invalidate();
      utils.merge.stats.invalidate();
    },
  });

  const handleAccept = (suggestion: any) => {
    const canonicalName = editingCanonical === suggestion.id
      ? editedName
      : suggestion.suggestedCanonical;

    acceptMutation.mutate({
      suggestionId: suggestion.id,
      canonicalName,
      entityIds: suggestion.entityIds as number[],
      projectId,
    });
    setEditingCanonical(null);
  };

  const totalReviewed = (stats?.accepted || 0) + (stats?.rejected || 0);
  const totalAll = (stats?.total || 0);
  const reviewProgress = totalAll > 0 ? (totalReviewed / totalAll) * 100 : 0;

  const stepProgress = isGenerating ? ((currentStepIdx + 1) / ALL_STEPS.length) * 100 : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => navigate("/entities")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Merge className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                Entity Merge Review
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Review AI-suggested entity merges. Confirm duplicates or mark as different.
              </p>
            </div>
          </div>

          <Button
            onClick={runAllSteps}
            disabled={isGenerating}
            className="gap-2"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isGenerating ? "Analyzing..." : "Find Duplicates"}
          </Button>
        </div>

        {/* Generation progress banner */}
        {isGenerating && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {ALL_STEPS[currentStepIdx]?.label || "Starting..."}
                </span>
              </div>
              <span className="text-xs text-amber-700 dark:text-amber-400/70">
                Step {currentStepIdx + 1} of {ALL_STEPS.length}
                {totalFound > 0 && ` · ${totalFound} found`}
              </span>
            </div>
            <Progress value={stepProgress} className="h-1.5" />
            <p className="text-xs text-muted-foreground mt-1.5">
              Suggestions appear below as each step completes. You can start reviewing now.
            </p>
          </div>
        )}

        {/* Review progress bar */}
        {!isGenerating && stats && totalAll > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{totalReviewed} of {totalAll} reviewed</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  {stats.accepted} merged
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {stats.rejected} rejected
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  {stats.pending} pending
                </span>
              </span>
            </div>
            <Progress value={reviewProgress} className="h-1.5" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {isLoading && !suggestions ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : !suggestions || suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Merge className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-base font-medium text-muted-foreground">
              {totalAll > 0 ? "All suggestions reviewed!" : "No merge suggestions yet"}
            </h3>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
              {totalAll > 0
                ? `You've reviewed all ${totalAll} suggestions. Click "Find Duplicates" to scan for new ones.`
                : "Click \"Find Duplicates\" to analyze your entities and find potential duplicates using AI."}
            </p>
          </div>
        ) : (
          suggestions.map((suggestion: any) => {
            const TypeIcon = TYPE_ICONS[suggestion.entities?.[0]?.type] || Users;
            const typeColor = TYPE_COLORS[suggestion.entities?.[0]?.type] || "text-muted-foreground";

            return (
              <Card key={suggestion.id} className="border-border/60 bg-card/50">
                <CardContent className="p-5">
                  {/* Suggestion header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <TypeIcon className={`h-4 w-4 ${typeColor}`} />
                      <Badge variant="outline" className={CONFIDENCE_COLORS[suggestion.confidence] || ""}>
                        {suggestion.confidence} confidence
                      </Badge>
                    </div>
                  </div>

                  {/* Canonical name */}
                  <div className="mb-4">
                    <div className="text-xs text-muted-foreground mb-1">Suggested canonical name:</div>
                    {editingCanonical === suggestion.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editedName}
                          onChange={(e) => setEditedName(e.target.value)}
                          className="h-8 text-sm max-w-xs"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => setEditingCanonical(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-base font-medium text-foreground">
                          {suggestion.suggestedCanonical}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditingCanonical(suggestion.id);
                            setEditedName(suggestion.suggestedCanonical);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Entity variants */}
                  <div className="mb-4">
                    <div className="text-xs text-muted-foreground mb-2">
                      Variants to merge ({suggestion.entities?.length || 0}):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestion.entities?.map((entity: any) => (
                        <span
                          key={entity.id}
                          className="inline-flex items-center px-2.5 py-1 rounded-md bg-muted/50 border border-border/50 text-sm"
                        >
                          {entity.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Document mentions */}
                  {suggestion.mentions && suggestion.mentions.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-muted-foreground mb-2">
                        Document mentions:
                      </div>
                      <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {suggestion.mentions.slice(0, 8).map((mention: any, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-start gap-2 text-xs"
                          >
                            <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-foreground/80">
                                {mention.documentFilename}
                              </span>
                              {mention.contextSnippet && (
                                <span className="text-muted-foreground ml-1.5">
                                  — "{mention.contextSnippet.slice(0, 80)}
                                  {mention.contextSnippet.length > 80 ? "..." : ""}"
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {suggestion.mentions.length > 8 && (
                          <div className="text-xs text-muted-foreground pl-5">
                            +{suggestion.mentions.length - 8} more mentions
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Reasoning */}
                  {suggestion.reasoning && (
                    <div className="mb-4 p-2.5 rounded-md bg-muted/30 border border-border/30">
                      <div className="text-xs text-muted-foreground">
                        <AlertTriangle className="h-3 w-3 inline mr-1" />
                        AI reasoning: {suggestion.reasoning}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleAccept(suggestion)}
                      disabled={acceptMutation.isPending}
                    >
                      {acceptMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Merge
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-600 dark:text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => rejectMutation.mutate({ suggestionId: suggestion.id, projectId })}
                      disabled={rejectMutation.isPending}
                    >
                      <X className="h-3.5 w-3.5" />
                      Different
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => skipMutation.mutate({ suggestionId: suggestion.id, projectId })}
                      disabled={skipMutation.isPending}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
