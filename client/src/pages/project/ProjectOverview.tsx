import type { Project } from "../../../../drizzle/schema";
import { Upload, Eye, Search, MessageSquare, Download, CheckCircle2, Circle, ArrowRight, Sparkles, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface Props {
  projectId: number;
  project: Project;
  stats?: {
    total: number;
    reviewed: number;
    flagged: number;
    needsReview: number;
    processing: number;
    pending: number;
    errors: number;
  } | null;
}

type WorkflowStep = {
  id: string;
  label: string;
  description: string;
  done: boolean;
  active: boolean;
  action?: { label: string; path: string };
};

function getWorkflowSteps(project: Project, stats: Props["stats"]): WorkflowStep[] {
  const hasDocuments = (stats?.total ?? 0) > 0;
  const hasReviewed = (stats?.reviewed ?? 0) > 0;
  const allReviewed = hasDocuments && (stats?.needsReview ?? 0) === 0 && (stats?.processing ?? 0) === 0 && (stats?.pending ?? 0) === 0;
  const hasSchema = project.jsonSchema && Object.keys(project.jsonSchema as Record<string, unknown>).length > 0;
  const isConfigured = !!hasSchema && !!project.systemPrompt;

  return [
    {
      id: "configure",
      label: "Configure transcription",
      description: "Set up how the AI reads your documents",
      done: isConfigured,
      active: !isConfigured,
      action: !isConfigured ? { label: "Finish setup", path: "/settings" } : undefined,
    },
    {
      id: "upload",
      label: "Upload documents",
      description: "Add scanned images to your archive",
      done: hasDocuments,
      active: isConfigured && !hasDocuments,
      action: !hasDocuments ? { label: "Upload documents", path: "/upload" } : undefined,
    },
    {
      id: "review",
      label: "Review transcriptions",
      description: "Check and correct the AI's work",
      done: allReviewed && hasDocuments,
      active: hasDocuments && !allReviewed,
      action: hasDocuments && !allReviewed
        ? { label: `Review ${stats?.needsReview ?? 0} document${(stats?.needsReview ?? 0) !== 1 ? "s" : ""}`, path: "/review" }
        : undefined,
    },
    {
      id: "explore",
      label: "Explore your archive",
      description: "Search, ask questions, and discover entities",
      done: false,
      active: hasReviewed,
      action: hasReviewed ? { label: "Search archive", path: "/search" } : undefined,
    },
    {
      id: "export",
      label: "Export data",
      description: "Download your transcriptions as CSV or JSON",
      done: false,
      active: hasReviewed,
      action: hasReviewed ? { label: "Export archive", path: "/export" } : undefined,
    },
  ];
}

function getNextAction(steps: WorkflowStep[]): WorkflowStep | null {
  // Find the first incomplete step that has an action
  return steps.find(s => !s.done && s.action) ?? null;
}

export default function ProjectOverview({ projectId, project, stats }: Props) {
  const [, navigate] = useLocation();
  const steps = getWorkflowSteps(project, stats);
  const nextAction = getNextAction(steps);

  const hasReviewed = (stats?.reviewed ?? 0) > 0;
  const total = stats?.total ?? 0;
  const reviewed = stats?.reviewed ?? 0;
  const needsReview = stats?.needsReview ?? 0;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-serif font-semibold mb-1">{project.name}</h2>
        {project.description && <p className="text-muted-foreground text-sm">{project.description}</p>}
      </div>

      {/* Primary action card */}
      {nextAction && nextAction.action && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-xs font-medium text-primary uppercase tracking-wide">Next step</span>
          </div>
          <h3 className="text-lg font-semibold mb-1">{nextAction.label}</h3>
          <p className="text-sm text-muted-foreground mb-4">{nextAction.description}</p>
          <Button onClick={() => navigate(nextAction.action!.path)} className="gap-2">
            {nextAction.action.label}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Progress summary — only show when there are documents */}
      {total > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Archive progress</span>
            <span className="text-sm text-muted-foreground">{reviewed} of {total} reviewed</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${total > 0 ? Math.round((reviewed / total) * 100) : 0}%` }}
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {needsReview > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                {needsReview} awaiting review
              </span>
            )}
            {(stats?.flagged ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                {stats?.flagged} flagged
              </span>
            )}
            {reviewed > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                {reviewed} approved
              </span>
            )}
          </div>
        </div>
      )}

      {/* Workflow checklist */}
      <div className="bg-card border border-border rounded-xl p-5 mb-8">
        <h3 className="text-sm font-medium mb-4">Your workflow</h3>
        <div className="space-y-3">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`flex items-start gap-3 ${step.done ? "opacity-60" : ""}`}
            >
              {step.done ? (
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              ) : (
                <Circle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${step.active ? "text-primary" : "text-muted-foreground/40"}`} />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${step.done ? "line-through text-muted-foreground" : ""}`}>
                  {step.label}
                </div>
                <div className="text-xs text-muted-foreground">{step.description}</div>
              </div>
              {step.action && !step.done && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-primary hover:text-primary flex-shrink-0"
                  onClick={() => navigate(step.action!.path)}
                >
                  {step.action.label}
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions — only show when archive has reviewed content */}
      {hasReviewed && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => navigate("/search")}
            className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 transition-colors group"
          >
            <Search className="w-4 h-4 text-muted-foreground group-hover:text-primary mb-2" />
            <div className="text-sm font-medium group-hover:text-primary transition-colors">Search archive</div>
            <div className="text-xs text-muted-foreground mt-0.5">Find information across documents</div>
          </button>
          <button
            onClick={() => navigate("/chat")}
            className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 transition-colors group"
          >
            <MessageSquare className="w-4 h-4 text-muted-foreground group-hover:text-primary mb-2" />
            <div className="text-sm font-medium group-hover:text-primary transition-colors">Ask Archive</div>
            <div className="text-xs text-muted-foreground mt-0.5">Ask questions about your documents</div>
          </button>
          <button
            onClick={() => navigate("/entities")}
            className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 transition-colors group"
          >
            <Network className="w-4 h-4 text-muted-foreground group-hover:text-primary mb-2" />
            <div className="text-sm font-medium group-hover:text-primary transition-colors">Entities</div>
            <div className="text-xs text-muted-foreground mt-0.5">People, places, and organizations</div>
          </button>
        </div>
      )}
    </div>
  );
}
