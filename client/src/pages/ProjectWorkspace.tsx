import { useParams, useLocation, Router, Route, Switch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { Loader2, BookOpen, Upload, Eye, Download, Settings, ArrowLeft, ChevronRight, MessageSquare, Search, Network, BookOpenText } from "lucide-react";
import { Button } from "@/components/ui/button";
import UploadPage from "./project/UploadPage";
import ReviewPage from "./project/ReviewPage";
import ExportPage from "./project/ExportPage";
import ProjectSettings from "./project/ProjectSettings";
import ProjectOverview from "./project/ProjectOverview";
import SemanticChatPage from "./project/SemanticChatPage";
import SemanticSearchPage from "./project/SemanticSearchPage";
import KnowledgeGraphPage from "./project/KnowledgeGraphPage";
import EntityDirectoryPage from "./project/EntityDirectoryPage";

const NAV_ITEMS = [
  { id: "overview", label: "Overview",    icon: BookOpen,      path: "/" },
  { id: "upload",   label: "Upload",      icon: Upload,        path: "/upload" },
  { id: "review",   label: "Review",      icon: Eye,           path: "/review" },
  { id: "search",   label: "Search",      icon: Search,        path: "/search" },
  { id: "chat",     label: "Ask Archive", icon: MessageSquare, path: "/chat" },
  { id: "graph",    label: "Knowledge Graph", icon: Network,  path: "/graph" },
  { id: "directory",label: "Entity Directory", icon: BookOpenText, path: "/directory" },
  { id: "export",   label: "Export",      icon: Download,      path: "/export" },
  { id: "settings", label: "Settings",    icon: Settings,      path: "/settings" },
];

/**
 * Inner workspace rendered inside a <Router base="/projects/:id">.
 * All useLocation / Route / useRoute calls here are relative to that base.
 */
function WorkspaceInner({
  projectId,
  project,
  stats,
}: {
  projectId: number;
  project: import("../../../drizzle/schema").Project;
  stats: { total: number; reviewed: number; flagged: number; needsReview: number; processing: number; pending: number; errors: number } | null | undefined;
}) {
  const [location, navigate] = useLocation();

  // Determine active nav from relative path
  const activeNav =
    NAV_ITEMS.find(n => n.path !== "/" && location.startsWith(n.path))?.id ?? "overview";

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Top header */}
      <header className="border-b border-border bg-card/50 flex-shrink-0">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2 text-sm">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { window.location.href = "/dashboard"; }}>
              <ArrowLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-muted-foreground">Projects</span>
            <ChevronRight className="w-3 h-3 text-border" />
            <span className="font-medium">{project.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {stats && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{stats.total} docs</span>
                <span className="text-green-400">{stats.reviewed} reviewed</span>
                {stats.needsReview > 0 && (
                  <span className="text-yellow-400">{stats.needsReview} pending review</span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 border-r border-border bg-sidebar flex-shrink-0 flex flex-col">
          <div className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{project.name}</div>
                <div className="text-[10px] text-sidebar-foreground/50 capitalize">
                  {project.pipelineType.replace("_", " ")}
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-2 space-y-0.5">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              // Navigate to the nav item's relative path (wouter will prepend the base)
              const handleClick = () => navigate(item.path);
              return (
                <button
                  key={item.id}
                  onClick={handleClick}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left
                    ${isActive
                      ? "bg-sidebar-accent text-sidebar-primary font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                  {item.id === "review" && stats && stats.needsReview > 0 && (
                    <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                      {stats.needsReview}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Progress */}
          {stats && stats.total > 0 && (
            <div className="p-4 border-t border-sidebar-border">
              <div className="flex items-center justify-between text-[10px] text-sidebar-foreground/50 mb-1.5">
                <span>Progress</span>
                <span>{Math.round((stats.reviewed / stats.total) * 100)}%</span>
              </div>
              <div className="h-1 bg-sidebar-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${Math.round((stats.reviewed / stats.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </aside>

        {/* Main content — nested Switch relative to base */}
        <main className="flex-1 overflow-hidden relative">
          <div className="absolute inset-0 overflow-auto">
            <Switch>
              <Route path="/upload">
                <UploadPage projectId={projectId} project={project} />
              </Route>
              <Route path="/export">
                <ExportPage projectId={projectId} project={project} />
              </Route>
              <Route path="/settings">
                <ProjectSettings projectId={projectId} project={project} />
              </Route>
              {/* review with a specific document selected */}
              <Route path="/review/:docId">
                {(params) => (
                  <ReviewPage projectId={projectId} project={project} docId={params.docId} />
                )}
              </Route>
              {/* review queue (no specific doc) */}
              <Route path="/review">
                <ReviewPage projectId={projectId} project={project} />
              </Route>
              {/* semantic search */}
              <Route path="/search">
                <SemanticSearchPage projectId={projectId} project={project} />
              </Route>
              {/* semantic chat */}
              <Route path="/chat">
                <SemanticChatPage projectId={projectId} project={project} />
              </Route>
              {/* knowledge graph */}
              <Route path="/graph">
                <KnowledgeGraphPage projectId={projectId} />
              </Route>
              {/* entity directory */}
              <Route path="/directory">
                <EntityDirectoryPage projectId={projectId} />
              </Route>
              {/* default: overview */}
              <Route>
                <ProjectOverview projectId={projectId} project={project} stats={stats} />
              </Route>
            </Switch>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id ?? "0");
  const { isAuthenticated, loading: authLoading } = useAuth();

  const { data: project, isLoading } = trpc.projects.get.useQuery(
    { id: projectId },
    { enabled: !!projectId && isAuthenticated }
  );
  const { data: stats } = trpc.projects.stats.useQuery(
    { id: projectId },
    { enabled: !!projectId && isAuthenticated }
  );

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) { window.location.href = getLoginUrl(); return null; }
  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Project not found
      </div>
    );
  }

  const basePath = `/projects/${projectId}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/*
        Wrap the entire workspace in a nested Router with base="/projects/:id".
        This makes all child Route, useLocation, and useRoute calls relative to this base,
        so "/review/:docId" correctly matches "/projects/30001/review/90016".
      */}
      <Router base={basePath}>
        <WorkspaceInner projectId={projectId} project={project} stats={stats} />
      </Router>
    </div>
  );
}
