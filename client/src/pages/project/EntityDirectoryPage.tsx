import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { useLocation } from "wouter";

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  person: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  location: "bg-green-500/15 text-green-400 border-green-500/30",
  organization: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
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
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [, navigate] = useLocation();

  // Fetch all entities for the master list
  const { data: allEntities, isLoading: listLoading } = trpc.entities.list.useQuery({
    projectId,
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

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((e) => e.name.toLowerCase().includes(q));
    }

    // Sort alphabetically
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [allEntities, typeFilter, searchQuery]);

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
          <div className="flex items-center gap-2">
            <BookOpenText className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-semibold">Entity Directory</h2>
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
                <Building2 className="h-3 w-3 mr-1" />Orgs
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
            <div className="p-6 text-center text-sm text-muted-foreground">
              {searchQuery ? "No entities match your search." : "No entities extracted yet."}
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
                    return (
                      <button
                        key={entity.id}
                        onClick={() => setSelectedEntityId(entity.id)}
                        className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors hover:bg-muted/60 ${
                          isActive ? "bg-muted border-l-2 border-amber-400" : "border-l-2 border-transparent"
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT_COLORS[entity.type] || "bg-slate-400"}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm truncate ${isActive ? "font-medium" : ""}`}>
                            {entity.name}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize flex-shrink-0 ${TYPE_COLORS[entity.type] || ""}`}
                        >
                          {entity.type}
                        </Badge>
                      </button>
                    );
                  })}
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
              Choose an entity from the directory to view its document mentions,
              context snippets, and connections to other entities.
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
                className={`capitalize ${TYPE_COLORS[details.entity.type] || ""}`}
              >
                {details.entity.type}
              </Badge>
              <p className="text-sm text-muted-foreground mt-2">
                Appears in {details.mentions.length} {details.mentions.length === 1 ? "document" : "documents"}
                {details.coOccurring.length > 0 && ` · Connected to ${details.coOccurring.length} other entities`}
              </p>
            </div>

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
    </div>
  );
}
