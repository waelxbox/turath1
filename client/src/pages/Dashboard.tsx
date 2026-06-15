import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { Plus, FolderOpen, Clock, CheckCircle2, AlertCircle, Loader2, ArrowRight, BookOpen, Sparkles, HelpCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import GuidedTour, { useTourState } from "@/components/GuidedTour";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  onboarding: { label: "Setting up", color: "text-blue-400" },
  validating: { label: "Validating", color: "text-amber-400" },
  active: { label: "Active", color: "text-green-400" },
  archived: { label: "Archived", color: "text-muted-foreground" },
};

function ProjectCard({ project }: { project: { id: number; name: string; description: string | null; status: string; createdAt: Date; _memberRole?: "owner" | "editor" | "viewer" } }) {
  const [, navigate] = useLocation();
  const { data: stats } = trpc.projects.stats.useQuery({ id: project.id });
  const statusInfo = STATUS_LABELS[project.status] ?? { label: project.status, color: "text-muted-foreground" };

  const progress = stats && stats.total > 0
    ? Math.round((stats.reviewed / stats.total) * 100)
    : 0;

  // Determine recommended action text
  const getRecommendedAction = () => {
    if (project.status === "onboarding" || project.status === "validating") return "Continue setup";
    if (stats && stats.needsReview > 0) return `Review ${stats.needsReview} doc${stats.needsReview !== 1 ? "s" : ""}`;
    if (stats && stats.total === 0) return "Upload documents";
    return "Open archive";
  };

  return (
    <button
      className="bg-card border border-border rounded-xl p-5 hover:border-primary/40 transition-all cursor-pointer group text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={`${project.name} — ${getRecommendedAction()}`}
      onClick={() => {
        if (project.status === "onboarding" || project.status === "validating") {
          navigate(`/projects/${project.id}/onboarding`);
        } else {
          navigate(`/projects/${project.id}`);
        }
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-primary" />
        </div>
        <div className="flex items-center gap-2">
          {project._memberRole && project._memberRole !== "owner" && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
              {project._memberRole === "editor" ? "Editor" : "Viewer"}
            </span>
          )}
          <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
        </div>
      </div>
      <h3 className="font-semibold text-base mb-1 font-sans group-hover:text-primary transition-colors">{project.name}</h3>
      {project.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
      )}

      {stats && stats.total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{stats.reviewed} / {stats.total} reviewed</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {stats && (stats.needsReview > 0 || stats.flagged > 0 || (stats.reviewed > 0 && stats.needsReview === 0)) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {stats.needsReview > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <Clock className="w-3 h-3" /> {stats.needsReview} to review
            </span>
          )}
          {stats.flagged > 0 && (
            <span className="flex items-center gap-1 text-orange-400">
              <AlertCircle className="w-3 h-3" /> {stats.flagged} flagged
            </span>
          )}
          {stats.reviewed > 0 && stats.needsReview === 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <CheckCircle2 className="w-3 h-3" /> Up to date
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {new Date(project.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <span className="text-xs font-medium text-primary flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
          {getRecommendedAction()}
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { showTour, hasCompletedTour, startTour, endTour } = useTourState();

  const { data: projects, isLoading, refetch } = trpc.projects.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Auto-start tour for first-time users with no projects
  useEffect(() => {
    if (!hasCompletedTour && !isLoading && projects && projects.length === 0) {
      startTour();
    }
  }, [hasCompletedTour, isLoading, projects, startTour]);

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      toast.success("Project created!");
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      refetch();
      if (project) navigate(`/projects/${project.id}/onboarding`);
    },
    onError: (err) => toast.error(err.message),
  });

  const createDemo = trpc.projects.createDemo.useMutation({
    onSuccess: (result) => {
      toast.success("Demo project created! Explore it to see how TURATH works.");
      refetch();
      if (result) navigate(`/projects/${result.projectId}`);
    },
    onError: (err) => {
      if (err.data?.code === "CONFLICT") {
        toast.info("You already have a demo project.");
      } else {
        toast.error(err.message);
      }
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">ت</span>
            </div>
            <span className="font-serif font-semibold text-lg">TURATH</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.name ?? user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => navigate("/logout")} className="bg-transparent">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-10">
        {/* Page header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-3xl font-serif font-semibold mb-1">Your projects</h1>
            <p className="text-muted-foreground text-sm">
              Each project is a separate archive with its own AI reader trained on your documents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowCreate(true)} className="gap-2" data-tour="new-project">
              <Plus className="w-4 h-4" /> New project
            </Button>
            <Button variant="ghost" size="icon" onClick={startTour} title="Take a tour" className="h-9 w-9">
              <HelpCircle className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Projects grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !projects || projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-primary/60" />
            </div>
            <h3 className="font-serif text-xl font-semibold mb-2">No projects yet</h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              Create your first project to start transcribing. You'll teach the AI how to read your documents by showing it a few examples.
            </p>
            <div className="flex items-center gap-3">
              <Button onClick={() => setShowCreate(true)} className="gap-2">
                <Plus className="w-4 h-4" /> Create your first project
              </Button>
              <Button
                variant="outline"
                onClick={() => createDemo.mutate()}
                disabled={createDemo.isPending}
                className="gap-2 bg-transparent"
              >
                {createDemo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Try a demo project
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">The demo uses real 1923 Egyptian magazine pages so you can explore all features immediately.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map(p => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </main>

      {/* Create project dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Create a new project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">Project name</Label>
              <Input
                id="proj-name"
                placeholder="e.g. Brovarski Index Cards, Selim Hassan Archive"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea
                id="proj-desc"
                placeholder="Brief description of your archive and what you're transcribing..."
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="bg-background resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="bg-transparent">Cancel</Button>
            <Button
              onClick={() => createProject.mutate({ name: newName, description: newDesc || undefined })}
              disabled={!newName.trim() || createProject.isPending}
              className="gap-2"
            >
              {createProject.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create & set up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Guided Tour */}
      <GuidedTour isOpen={showTour} onClose={endTour} />
    </div>
  );
}
