import { useParams, useLocation, Router, Route, Switch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { Loader2, BookOpen, Upload, Eye, Download, Settings, ArrowLeft, ChevronRight, MessageSquare, Search, Network } from "lucide-react";
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
import EntityMergePage from "./project/EntityMergePage";
import { toast } from "sonner";

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  badge?: number;
  disabled?: boolean;
  disabledReason?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

function buildNavGroups(stats: { total: number; reviewed: number; needsReview: number } | null | undefined): NavGroup[] {
  const hasDocuments = (stats?.total ?? 0) > 0;
  const hasReviewed = (stats?.reviewed ?? 0) > 0;

  return [
    {
      label: "Process",
      items: [
        { id: "overview", label: "Overview", icon: BookOpen, path: "/" },
        { id: "upload", label: "Upload", icon: Upload, path: "/upload" },
        {
          id: "review",
          label: "Review",
          icon: Eye,
          path: "/review",
          badge: stats?.needsReview ?? 0,
          disabled: !hasDocuments,
          disabledReason: "Upload documents first",
        },
      ],
    },
    {
      label: "Explore",
      items: [
        {
          id: "search",
          label: "Search archive",
          icon: Search,
          path: "/search",
          disabled: !hasReviewed,
          disabledReason: "Approve documents to enable search",
        },
        {
          id: "chat",
          label: "Ask Archive",
          icon: MessageSquare,
          path: "/chat",
          disabled: !hasReviewed,
          disabledReason: "Approve documents to enable Ask Archive",
        },
        {
          id: "entities",
          label: "Entities",
          icon: Network,
          path: "/entities",
          disabled: !hasReviewed,
          disabledReason: "Approve documents to discover entities",
        },
      ],
    },
    {
      label: "Output",
      items: [
        {
          id: "export",
          label: "Export",
          icon: Download,
          path: "/export",
          disabled: !hasReviewed,
          disabledReason: "Approve documents to enable export",
        },
      ],
    },
    {
      label: "Project",
      items: [
        { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
      ],
    },
  ];
}

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
  const navGroups = buildNavGroups(stats);

  // Determine active nav from relative path
  const allItems = navGroups.flatMap(g => g.items);
  const activeNav =
    allItems.find(n => n.path !== "/" && location.startsWith(n.path))?.id ?? "overview";

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Top header with breadcrumb */}
      <header className="border-b border-border bg-card/50 flex-shrink-0">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2 text-sm">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { window.location.href = "/dashboard"; }}>
              <ArrowLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-muted-foreground">Projects</span>
            <ChevronRight className="w-3 h-3 text-border" />
            <span className="font-medium">{project.name}</span>
            {activeNav !== "overview" && (
              <>
                <ChevronRight className="w-3 h-3 text-border" />
                <span className="text-muted-foreground capitalize">
                  {allItems.find(i => i.id === activeNav)?.label}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stats && stats.total > 0 && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{stats.total} docs</span>
                <span className="text-green-400">{stats.reviewed} approved</span>
                {stats.needsReview > 0 && (
                  <span className="text-yellow-400">{stats.needsReview} to review</span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar with grouped navigation */}
        <aside className="w-52 border-r border-border bg-sidebar flex-shrink-0 flex flex-col">
          <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
            {navGroups.map(group => (
              <div key={group.label}>
                <div className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider px-3 mb-1.5">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const Icon = item.icon;
                    const isActive = activeNav === item.id;
                    const handleClick = () => {
                      if (item.disabled) {
                        toast.info(item.disabledReason ?? "Not available yet");
                        return;
                      }
                      navigate(item.path);
                    };
                    const tourMap: Record<string, string> = { upload: "upload", review: "review", search: "search", chat: "ask", entities: "entities", settings: "settings" };
                    return (
                      <button
                        key={item.id}
                        onClick={handleClick}
                        data-tour={tourMap[item.id] || undefined}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left
                          ${isActive
                            ? "bg-sidebar-accent text-sidebar-primary font-medium"
                            : item.disabled
                              ? "text-sidebar-foreground/30 cursor-not-allowed"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                          }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {item.label}
                        {item.badge && item.badge > 0 ? (
                          <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                            {item.badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Progress bar at bottom */}
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
              {/* search */}
              <Route path="/search">
                <SemanticSearchPage projectId={projectId} project={project} />
              </Route>
              {/* ask archive */}
              <Route path="/chat">
                <SemanticChatPage projectId={projectId} project={project} />
              </Route>
              {/* entities — combined graph + directory */}
              <Route path="/entities">
                <EntityDirectoryPage projectId={projectId} />
              </Route>
              <Route path="/entities/merge">
                <EntityMergePage projectId={projectId} />
              </Route>
              <Route path="/graph">
                <KnowledgeGraphPage projectId={projectId} />
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
      <Router base={basePath}>
        <WorkspaceInner projectId={projectId} project={project} stats={stats} />
      </Router>
    </div>
  );
}
