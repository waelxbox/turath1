/**
 * SemanticSearchPage — Natural language search across reviewed transcriptions.
 *
 * Researchers type a query in plain English (or Arabic) and get back the most
 * semantically similar documents ranked by cosine similarity. Each result shows
 * the document filename, similarity score, and a content excerpt.
 *
 * Clicking a result navigates directly to the review page for that document.
 */

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Loader2,
  FileText,
  ArrowRight,
  Sparkles,
  Info,
} from "lucide-react";
import type { Project } from "../../../../drizzle/schema";

interface Props {
  projectId: number;
  project: Project;
}

// Similarity score → human-readable label + colour
function similarityLabel(score: number): { label: string; className: string } {
  if (score >= 0.025) return { label: "Excellent match", className: "text-green-400 bg-green-400/10" };
  if (score >= 0.018) return { label: "Strong match",   className: "text-emerald-400 bg-emerald-400/10" };
  if (score >= 0.012) return { label: "Good match",     className: "text-yellow-400 bg-yellow-400/10" };
  return                     { label: "Partial match", className: "text-orange-400 bg-orange-400/10" };
}

// Match type badge for hybrid/semantic/keyword
function matchTypeBadge(matchType: string): { label: string; className: string } {
  if (matchType === "hybrid")   return { label: "Best match",   className: "text-violet-400 bg-violet-400/10" };
  if (matchType === "semantic") return { label: "Meaning match",  className: "text-blue-400 bg-blue-400/10" };
  return                               { label: "Exact match",   className: "text-amber-400 bg-amber-400/10" };
}

const EXAMPLE_QUERIES = [
  "Documents mentioning land grants or property transfers",
  "Records with dates from the Ottoman period",
  "Correspondence involving tribal leaders",
  "Documents with monetary values or prices",
];

export default function SemanticSearchPage({ projectId, project }: Props) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: results, isFetching, refetch } = trpc.rag.search.useQuery(
    { projectId, query: submitted, limit: 10 },
    {
      enabled: submitted.trim().length > 0,
      staleTime: 30_000,
    }
  );

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSubmitted(q);
    // If same query, force a refetch
    if (q === submitted) refetch();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleExampleClick = (q: string) => {
    setQuery(q);
    setSubmitted(q);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-card/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Search className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Search archive</h1>
            <p className="text-xs text-muted-foreground">
              Find information across your approved documents
            </p>
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-background/50">
        <div className="flex gap-2 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you're looking for…"
              className="pl-9 pr-4"
            />
          </div>
          <Button
            onClick={handleSearch}
            disabled={!query.trim() || isFetching}
            className="gap-2"
          >
            {isFetching
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />
            }
            Search
          </Button>
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Empty / initial state */}
        {!submitted && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Search className="w-8 h-8 text-primary/50" />
            </div>
            <div>
              <h2 className="text-base font-semibold mb-1">Search your archive</h2>
              <p className="text-xs text-muted-foreground max-w-sm">
                Search by meaning or by exact words. Describe what you're looking for
                and the AI will find the most relevant documents.
              </p>
            </div>

            <div className="flex items-start gap-2 bg-muted/40 rounded-lg p-3 max-w-sm text-left">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Only <strong>approved</strong> documents appear in search results.
                Approve documents in the Review page to make them searchable.
              </p>
            </div>

            <div className="w-full max-w-md">
              <p className="text-xs text-muted-foreground mb-2">Try an example query:</p>
              <div className="grid grid-cols-1 gap-2">
                {EXAMPLE_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleExampleClick(q)}
                    className="text-left text-xs bg-card border border-border rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {submitted && isFetching && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Searching across your documents…</p>
          </div>
        )}

        {/* No results */}
        {submitted && !isFetching && results && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center">
              <FileText className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No matching documents found</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Try rephrasing your query, or make sure you have reviewed documents in this project.
              </p>
            </div>
          </div>
        )}

        {/* Results list */}
        {submitted && !isFetching && results && results.length > 0 && (
          <div className="max-w-2xl space-y-3">
            <p className="text-xs text-muted-foreground mb-4">
              Found <strong>{results.length}</strong> result{results.length !== 1 ? "s" : ""} for{" "}
              <span className="font-medium text-foreground">"{submitted}"</span>
            </p>

            {results.map((result, i) => {
              const sim = similarityLabel(result.similarity);
              const filename = (result.metadata as Record<string, unknown>)?.filename as string
                ?? `Document ${result.documentId}`;
              const excerpt = result.content.slice(0, 300) + (result.content.length > 300 ? "…" : "");

              return (
                <div
                  key={result.documentId}
                  className="group bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={() => navigate(`/review/${result.documentId}`)}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground/50 flex-shrink-0">
                        #{i + 1}
                      </span>
                      <FileText className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{filename}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {(() => {
                        const mt = matchTypeBadge((result as unknown as { matchType: string }).matchType ?? "semantic");
                        return (
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 border-0 ${mt.className}`}
                          >
                            {mt.label}
                          </Badge>
                        );
                      })()}
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 border-0 ${sim.className}`}
                      >
                        {sim.label}
                      </Badge>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {excerpt}
                  </p>

                  <div className="flex items-center gap-1 mt-3 text-[11px] text-primary/60 group-hover:text-primary transition-colors">
                    <span>Open in review</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
