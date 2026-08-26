import { useState } from "react";
import { useParams, useLocation, Router, Route, Switch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { Loader2, BookOpen, Upload, Eye, Download, Settings, ArrowLeft, ChevronRight, MessageSquare, Search, Network, Gamepad2, Menu, X, ClipboardCheck, Microscope, Activity, ListTodo, Users, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
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
import QuickReviewPage from "./project/QuickReviewPage";
import SimpleReviewPage from "./project/SimpleReviewPage";
import ValidationAdminPage from "./project/ValidationAdminPage";
import ResearchPage from "./project/ResearchPage";
import ActivityFeedPage from "./project/ActivityFeedPage";
import ReviewQueuePage from "./project/ReviewQueuePage";
import VisualWorkspace from "./visual/VisualWorkspace";
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

/** Compact sun/moon toggle for the workspace header */
function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  if (!toggleTheme) return null;
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

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
        {
          id: "quick-review",
          label: "Quick Review",
          icon: Gamepad2,
          path: "/quick-review",
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
        {
          id: "validation",
          label: "Validation",
          icon: ClipboardCheck,
          path: "/validation",
          disabled: !hasReviewed,
          disabledReason: "Approve documents to enable validation",
        },
      ],
    },
    {
      label: "Team",
      items: [
        { id: "activity", label: "Activity", icon: Activity, path: "/activity" },
        { id: "queue", label: "Review Queue", icon: ListTodo, path: "/queue" },
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navGroups = buildNavGroups(stats);

  // Determine active nav from relative path
  const allItems = navGroups.flatMap(g => g.items);
  const activeNav =
    allItems.find(n => n.path !== "/" && location.startsWith(n.path))?.id ?? "overview";

  // Check if we're on the quick-review page (full-screen on mobile)
  const isQuickReview = activeNav === "quick-review";
  // Check if we're in the full-screen document review (SimpleReviewPage)
  const isDocReview = location.match(/^\/review\/\d+\/full/);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Top header with breadcrumb — compact on mobile */}
      <header className={`border-b border-border bg-card/50 flex-shrink-0 ${isQuickReview ? "md:block hidden" : ""} ${isDocReview ? "hidden" : ""}`}>
        <div className="container flex items-center justify-between h-12 md:h-14 px-3 md:px-4">
          <div className="flex items-center gap-2 text-sm min-w-0">
            {/* Mobile menu toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:hidden flex-shrink-0"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 hidden md:flex" onClick={() => { window.location.href = "/dashboard"; }}>
              <ArrowLeft className="w-3.5 h-3.5" />
            </Button>
            <a href="/dashboard" className="hidden md:flex items-center gap-1.5 hover:opacity-80 transition-opacity">
              <div className="w-5 h-5 rounded bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-[9px]">ت</span>
              </div>
              <span className="font-serif font-semibold text-sm">TURATH</span>
              <span className="sr-only">Projects</span>
            </a>
            <ChevronRight className="w-3 h-3 text-border hidden md:inline" />
            <span className="font-medium truncate">{project.name}</span>
            {activeNav !== "overview" && (
              <>
                <ChevronRight className="w-3 h-3 text-border hidden md:inline" />
                <span className="text-muted-foreground capitalize hidden md:inline">
                  {allItems.find(i => i.id === activeNav)?.label}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stats && stats.total > 0 && (
              <div className="flex items-center gap-2 md:gap-3 text-[10px] md:text-xs text-muted-foreground">
                <span>{stats.total} docs</span>
                <span className="text-green-700 dark:text-green-400">{stats.reviewed} approved</span>
                {stats.needsReview > 0 && (
                  <span className="text-yellow-700 dark:text-yellow-400 hidden md:inline">{stats.needsReview} to review</span>
                )}
              </div>
            )}
            <ThemeToggleButton />
          </div>
        </div>
      </header>

      {/* Mobile: Quick Review gets a minimal top bar instead */}
      {isQuickReview && (
        <header className="md:hidden border-b border-border bg-card/50 flex-shrink-0">
          <div className="flex items-center justify-between h-11 px-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-1.5">
                <Gamepad2 className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium">Quick Review</span>
              </div>
            </div>
            {stats && stats.needsReview > 0 && (
              <span className="text-[10px] text-yellow-700 dark:text-yellow-400">{stats.needsReview} to review</span>
            )}
          </div>
        </header>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay menu */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* Slide-in sidebar */}
            <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-border flex flex-col animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMobileMenuOpen(false); window.location.href = "/dashboard"; }}>
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="text-sm font-medium truncate">{project.name}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobileMenuOpen(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
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
                          setMobileMenuOpen(false);
                        };
                        return (
                          <button
                            key={item.id}
                            onClick={handleClick}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors text-left
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
                              <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded-full">
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
          </div>
        )}

        {/* Desktop sidebar — hidden on mobile, hidden in doc review */}
        <aside className={`hidden md:flex w-52 border-r border-border bg-sidebar flex-shrink-0 flex-col ${isDocReview ? "!hidden" : ""}`}>
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
                          <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded-full">
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
              {/* Full-screen review viewer (accessed via button) */}
              <Route path="/review/:docId/full">
                {(params) => (
                  <SimpleReviewPage projectId={projectId} project={project} docId={params.docId} />
                )}
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
              {/* gamified quick review */}
              <Route path="/quick-review">
                <QuickReviewPage projectId={projectId} />
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
              {/* research agent (codex) */}
              <Route path="/research">
                <ResearchPage projectId={projectId} />
              </Route>
              {/* validation admin */}
              <Route path="/validation">
                <ValidationAdminPage projectId={projectId} />
              </Route>
              {/* activity feed */}
              <Route path="/activity">
                <ActivityFeedPage projectId={projectId} />
              </Route>
              {/* review queue / assignments */}
              <Route path="/queue">
                <ReviewQueuePage projectId={projectId} />
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
    { enabled: !!projectId && isAuthenticated && project?.archiveMode === "document_transcription" }
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

  if (project.archiveMode === "visual_vra") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Router base={basePath}>
          <VisualWorkspace projectId={projectId} project={project} />
        </Router>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Router base={basePath}>
        <WorkspaceInner projectId={projectId} project={project} stats={stats} />
      </Router>
    </div>
  );
}
