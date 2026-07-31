import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useSessionState } from "@/hooks/useSessionState";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users,
  MapPin,
  Building2,
  BookOpenText,
  Search,
  FileText,
  ArrowRight,
  Loader2,
  Link2,
  Network,
  List,
  Merge,
  CheckSquare,
  X,
  Trash2,
} from "lucide-react";
import { useLocation } from "wouter";

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  person: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  location: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  organization: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  location: "Place",
  organization: "Organization",
};

const TYPE_ICONS: Record<string, typeof Users> = {
  person: Users,
  location: MapPin,
  organization: Building2,
};

const TYPE_DOT_COLORS: Record<string, string> = {
  person: "bg-orange-400",
  location: "bg-green-400",
  organization: "bg-indigo-400",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function EntityDirectoryPage({ projectId }: { projectId: number }) {
  const [searchQuery, setSearchQuery] = useSessionState(`turath-entities-search-${projectId}`, "");
  const [typeFilter, setTypeFilter] = useSessionState(`turath-entities-filter-${projectId}`, "all");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(() => {
    // Check URL hash for pre-selected entity (e.g., #entity=42)
    const hash = window.location.hash;
    const match = hash.match(/entity=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  });
  const [, navigate] = useLocation();

  // Manual merge state
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<number>>(new Set());
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [canonicalName, setCanonicalName] = useState("");
  const [isMerging, setIsMerging] = useState(false);
  const utils = trpc.useUtils();

  const deleteEntitiesMutation = trpc.entities.delete.useMutation({
    onSuccess: () => {
      utils.entities.list.invalidate();
      utils.entities.stats.invalidate();
    },
  });

  const manualMergeMutation = trpc.merge.manual.useMutation({
    onSuccess: () => {
      toast.success("Entities merged successfully");
      utils.entities.list.invalidate();
      utils.entities.stats.invalidate();
      utils.merge.stats.invalidate();
      setSelectedForMerge(new Set());
      setMergeMode(false);
      setShowMergeDialog(false);
      setIsMerging(false);
      setSelectedEntityId(null);
    },
    onError: (err) => {
      toast.error(`Merge failed: ${err.message}`);
      setIsMerging(false);
    },
  });

  const toggleMergeSelection = (entityId: number) => {
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  };

  const openMergeDialog = () => {
    if (selectedForMerge.size < 2) {
      toast.error("Select at least 2 entities to merge");
      return;
    }
    // Default canonical name to the first selected entity's name
    const firstSelected = allEntities?.find(e => e.id === Array.from(selectedForMerge)[0]);
    setCanonicalName(firstSelected?.name || "");
    setShowMergeDialog(true);
  };

  const handleManualMerge = () => {
    if (!canonicalName.trim() || selectedForMerge.size < 2) return;
    setIsMerging(true);
    manualMergeMutation.mutate({
      projectId,
      canonicalName: canonicalName.trim(),
      entityIds: Array.from(selectedForMerge),
    });
  };

  // Debounced search for server-side alias matching
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch entities with server-side search (includes alias matching)
  const { data: allEntities, isLoading: listLoading } = trpc.entities.list.useQuery({
    projectId,
    search: debouncedSearch || undefined,
  });

  // Fetch details for selected entity
  const { data: details, isLoading: detailsLoading } = trpc.entities.getDetails.useQuery(
    { projectId, entityId: selectedEntityId! },
    { enabled: !!selectedEntityId },
  );

  // Filter and sort entities
  const filteredEntities = useMemo(() => {
    if (!allEntities) return [];
    let filtered = allEntities;

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter((e) => e.type === typeFilter);
    }

    // Search is now handled server-side (includes alias matching)

    // Sort alphabetically
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [allEntities, typeFilter]);

  // Group by first letter for alphabetical headers
  const groupedEntities = useMemo(() => {
    const groups: Record<string, typeof filteredEntities> = {};
    for (const entity of filteredEntities) {
      const letter = entity.name.charAt(0).toUpperCase();
      // Use # for non-alpha characters
      const key = /[A-Z]/.test(letter) ? letter : /[\u0600-\u06FF]/.test(letter) ? letter : "#";
      if (!groups[key]) groups[key] = [];
      groups[key].push(entity);
    }
    return groups;
  }, [filteredEntities]);

  const sortedLetters = Object.keys(groupedEntities).sort((a, b) => a.localeCompare(b));

  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {/* ─── Left Pane: Master List ─────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col h-full bg-muted/20">
        {/* Header */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpenText className="h-5 w-5 text-amber-700 dark:text-amber-400" />
              <h2 className="text-base font-semibold">Entities</h2>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={mergeMode ? "default" : "ghost"}
                size="sm"
                className={`text-xs gap-1.5 h-7 ${mergeMode ? "" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => {
                  setMergeMode(!mergeMode);
                  setSelectedForMerge(new Set());
                }}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {mergeMode ? "Cancel" : "Select"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground gap-1.5 h-7"
                onClick={() => navigate("/entities/merge")}
              >
                <Merge className="w-3.5 h-3.5" />
                AI Merge
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground gap-1.5 h-7"
                onClick={() => navigate("/graph")}
              >
                <Network className="w-3.5 h-3.5" />
                Graph
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>

          {/* Type filter tabs */}
          <Tabs value={typeFilter} onValueChange={setTypeFilter}>
            <TabsList className="w-full grid grid-cols-4 h-8">
              <TabsTrigger value="all" className="text-xs h-7">All</TabsTrigger>
              <TabsTrigger value="person" className="text-xs h-7">
                <Users className="h-3 w-3 mr-1" />People
              </TabsTrigger>
              <TabsTrigger value="location" className="text-xs h-7">
                <MapPin className="h-3 w-3 mr-1" />Places
              </TabsTrigger>
              <TabsTrigger value="organization" className="text-xs h-7">
                <Building2 className="h-3 w-3 mr-1" />Organizations
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Count */}
          <p className="text-xs text-muted-foreground">
            {filteredEntities.length} {filteredEntities.length === 1 ? "entity" : "entities"}
          </p>
        </div>

        {/* Entity list */}
        <div className="flex-1 overflow-y-auto">
          {listLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-muted-foreground mb-1">
                {searchQuery ? "No entities match your search." : "No entities discovered yet"}
              </p>
              {!searchQuery && (
                <p className="text-xs text-muted-foreground/70">
                  Entities (people, places, organizations) are automatically extracted when you approve documents.
                </p>
              )}
            </div>
          ) : (
            <div className="py-1">
              {sortedLetters.map((letter) => (
                <div key={letter}>
                  {/* Letter header */}
                  <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 sticky top-0">
                    {letter}
                  </div>
                  {groupedEntities[letter].map((entity) => {
                    const isActive = selectedEntityId === entity.id;
                    const isChecked = selectedForMerge.has(entity.id);
                    return (
                      <button
                        key={entity.id}
                        onClick={() => mergeMode ? toggleMergeSelection(entity.id) : setSelectedEntityId(entity.id)}
                        className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors hover:bg-muted/60 ${
                          isActive && !mergeMode ? "bg-muted border-l-2 border-amber-400" : isChecked ? "bg-amber-500/10 border-l-2 border-amber-400" : "border-l-2 border-transparent"
                        }`}
                      >
                        {mergeMode && (
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleMergeSelection(entity.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0"
                          />
                        )}
                        {!mergeMode && <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT_COLORS[entity.type] || "bg-slate-400"}`} />}
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm truncate ${isActive && !mergeMode ? "font-medium" : ""}`}>
                            {entity.name}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] flex-shrink-0 ${TYPE_COLORS[entity.type] || ""}`}
                        >
                          {TYPE_LABELS[entity.type] || entity.type}
                        </Badge>
                      </button>
                    );                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Right Pane: Detail View ────────────────────────────────────── */}
      <div className="flex-1 h-full overflow-y-auto bg-muted/10">
        {!selectedEntityId ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <BookOpenText className="h-16 w-16 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-medium mb-2">Select an entity</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Click any person, place, or organization to see which documents mention them
              and how they connect to other entities in your archive.
            </p>
          </div>
        ) : detailsLoading ? (
          /* Loading skeleton */
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        ) : details ? (
          /* Entity profile */
          <div className="p-6 space-y-8">
            {/* Header */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                {(() => {
                  const Icon = TYPE_ICONS[details.entity.type] || Users;
                  return <Icon className="h-6 w-6" style={{ color: details.entity.type === "person" ? "#f97316" : details.entity.type === "location" ? "#22c55e" : "#6366f1" }} />;
                })()}
                <h2 className="text-2xl font-bold">{details.entity.name}</h2>
              </div>
              <Badge
                variant="outline"
                className={`${TYPE_COLORS[details.entity.type] || ""}`}
              >
                {TYPE_LABELS[details.entity.type] || details.entity.type}
              </Badge>
              <p className="text-sm text-muted-foreground mt-2">
                Appears in {details.mentions.length} {details.mentions.length === 1 ? "document" : "documents"}
                {details.coOccurring.length > 0 && ` · Connected to ${details.coOccurring.length} other entities`}
              </p>
            </div>

            {/* Section: Aliases / Variant Names */}
            {details.aliases && details.aliases.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Also Known As ({details.aliases.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {details.aliases.map((alias: { id: number; alias: string; language?: string | null }) => (
                    <Badge key={alias.id} variant="secondary" className="text-sm py-1 px-3">
                      {alias.alias}
                      {alias.language && <span className="ml-1.5 text-xs text-muted-foreground">({alias.language})</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Section 1: Document Mentions */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Document Mentions ({details.mentions.length})
              </h3>
              {details.mentions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No document mentions found.</p>
              ) : (
                <div className="space-y-2">
                  {details.mentions.map((mention, i) => (
                    <Card key={i} className="bg-muted/20 border-border">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium mb-1 flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              {mention.filename}
                            </p>
                            {mention.contextSnippet && (
                              <p className="text-sm text-muted-foreground italic leading-relaxed pl-5">
                                "{mention.contextSnippet}"
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-shrink-0 text-xs"
                            onClick={() => navigate(`/review/${mention.documentId}`)}
                          >
                            View <ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Section 2: Related Entities */}
            {details.coOccurring.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Related Entities ({details.coOccurring.length})
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Other entities that appear in the same documents. Click to navigate.
                </p>
                <div className="flex flex-wrap gap-2">
                  {details.coOccurring.map((related) => {
                    const Icon = TYPE_ICONS[related.type] || Users;
                    return (
                      <Button
                        key={related.id}
                        variant="outline"
                        size="sm"
                        className={`h-auto py-1.5 px-3 text-sm ${TYPE_COLORS[related.type] || ""}`}
                        onClick={() => setSelectedEntityId(related.id)}
                      >
                        <Icon className="h-3 w-3 mr-1.5" />
                        {related.name}
                        {related.frequency > 1 && (
                          <span className="ml-1.5 text-[10px] opacity-70">
                            ({related.frequency})
                          </span>
                        )}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* ─── Merge Mode Floating Action Bar ─────────────────────────── */}
      {mergeMode && selectedForMerge.size > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-card border border-amber-500/30 shadow-lg shadow-amber-500/10">
            <span className="text-sm font-medium">
              {selectedForMerge.size} selected
            </span>
            <Button
              size="sm"
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={openMergeDialog}
              disabled={selectedForMerge.size < 2}
            >
              <Merge className="h-3.5 w-3.5" />
              Merge Selected
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={async () => {
                if (!confirm(`Delete ${selectedForMerge.size} ${selectedForMerge.size === 1 ? "entity" : "entities"} permanently? This cannot be undone.`)) return;
                try {
                  await deleteEntitiesMutation.mutateAsync({
                    projectId,
                    entityIds: Array.from(selectedForMerge),
                  });
                  toast.success(`Deleted ${selectedForMerge.size} ${selectedForMerge.size === 1 ? "entity" : "entities"}`);
                  setSelectedForMerge(new Set());
                  setMergeMode(false);
                  setSelectedEntityId(null);
                } catch (err) {
                  toast.error("Failed to delete entities");
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedForMerge(new Set())}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* ─── Manual Merge Dialog ────────────────────────────────────── */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="h-5 w-5 text-amber-700 dark:text-amber-400" />
              Merge Entities
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Merging {selectedForMerge.size} entities into one:
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {Array.from(selectedForMerge).map(id => {
                  const entity = allEntities?.find(e => e.id === id);
                  return entity ? (
                    <Badge key={id} variant="outline" className="text-xs">
                      {entity.name}
                    </Badge>
                  ) : null;
                })}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Canonical name</label>
              <Input
                value={canonicalName}
                onChange={(e) => setCanonicalName(e.target.value)}
                placeholder="Enter the preferred name..."
                className="h-9"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                This will be the primary name shown everywhere. Other names become aliases.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowMergeDialog(false)}>Cancel</Button>
            <Button
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleManualMerge}
              disabled={isMerging || !canonicalName.trim()}
            >
              {isMerging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
              Confirm Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
