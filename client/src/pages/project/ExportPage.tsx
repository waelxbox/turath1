import { useState, useMemo } from "react";
import type { Project } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, FileText, FileJson, Loader2, CheckCircle2, Filter, CheckSquare, Square, MinusSquare } from "lucide-react";

interface Props {
  projectId: number;
  project: Project;
}

type StatusFilter = "all" | "reviewed" | "needs_review" | "flagged" | "pending" | "error";

export default function ExportPage({ projectId, project }: Props) {
  const [exporting, setExporting] = useState<"csv" | "json" | "tei" | "tei-entity" | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // Fetch documents for selection
  const { data: allDocs } = trpc.documents.list.useQuery({ projectId });

  const { data: stats } = trpc.projects.stats.useQuery({ id: projectId });

  // Filter documents by status
  const filteredDocs = useMemo(() => {
    if (!allDocs) return [];
    if (statusFilter === "all") return allDocs;
    return allDocs.filter(d => d.status === statusFilter);
  }, [allDocs, statusFilter]);

  // Count for export button
  const exportCount = selectionMode
    ? selectedIds.size
    : filteredDocs.length;

  // Build export params
  const getExportParams = () => {
    const base: { projectId: number; includeAll: boolean; documentIds?: number[]; statusFilter?: string } = {
      projectId,
      includeAll: false,
    };
    if (selectionMode && selectedIds.size > 0) {
      base.documentIds = Array.from(selectedIds);
    } else if (statusFilter !== "all") {
      base.statusFilter = statusFilter;
    } else {
      base.includeAll = true;
    }
    return base;
  };

  const exportCsv = trpc.export.csv.useMutation({
    onSuccess: (data: { csv: string; count: number }) => {
      if (data.count === 0) { toast.info("No documents match your selection"); setExporting(null); return; }
      const blob = new Blob([data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, "_")}_export.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.count} transcriptions`);
      setExporting(null);
    },
    onError: (err: { message: string }) => { toast.error(err.message); setExporting(null); },
  });

  const { refetch: fetchJson } = trpc.export.jsonZip.useQuery(
    getExportParams(),
    { enabled: false }
  );

  const { refetch: fetchTeiCorpus } = trpc.export.teiXmlCorpus.useQuery(
    getExportParams(),
    { enabled: false }
  );

  const { refetch: fetchTeiXml } = trpc.entities.exportTeiXml.useQuery(
    { projectId },
    { enabled: false }
  );

  // Selection helpers
  const toggleDoc = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredDocs.map(d => d.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const allSelected = filteredDocs.length > 0 && filteredDocs.every(d => selectedIds.has(d.id));
  const someSelected = filteredDocs.some(d => selectedIds.has(d.id));

  const statusOptions: { value: StatusFilter; label: string; color: string }[] = [
    { value: "all", label: "All documents", color: "text-muted-foreground" },
    { value: "reviewed", label: "Reviewed", color: "text-green-700 dark:text-green-700 dark:text-green-400" },
    { value: "needs_review", label: "Needs review", color: "text-amber-700 dark:text-amber-700 dark:text-amber-400" },
    { value: "flagged", label: "Flagged", color: "text-red-600 dark:text-red-600 dark:text-red-400" },
    { value: "pending", label: "Pending", color: "text-muted-foreground" },
    { value: "error", label: "Error", color: "text-red-600 dark:text-red-600 dark:text-red-400" },
  ];

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h2 className="text-2xl font-serif font-semibold mb-1">Export transcriptions</h2>
        <p className="text-muted-foreground text-sm">
          Download transcriptions in your preferred format. Select specific documents or filter by status.
        </p>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="bg-card border border-border rounded-xl p-5 mb-6 flex items-center gap-6">
          <div>
            <div className="text-2xl font-semibold">{stats.reviewed}</div>
            <div className="text-xs text-muted-foreground">Reviewed</div>
          </div>
          <div className="text-border">|</div>
          <div>
            <div className="text-2xl font-semibold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-border">|</div>
          <div>
            <div className="text-2xl font-semibold">
              {project.jsonSchema ? Object.keys(project.jsonSchema as object).length : 0}
            </div>
            <div className="text-xs text-muted-foreground">Schema fields</div>
          </div>
        </div>
      )}

      {/* Filter & Selection Controls */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filter documents</span>
          </div>
          <button
            onClick={() => { setSelectionMode(!selectionMode); if (selectionMode) setSelectedIds(new Set()); }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              selectionMode
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
            }`}
          >
            {selectionMode ? "Exit selection" : "Select specific docs"}
          </button>
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {statusOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setStatusFilter(opt.value); setSelectedIds(new Set()); }}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                statusFilter === opt.value
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
              }`}
            >
              {opt.label}
              {allDocs && opt.value !== "all" && (
                <span className="ml-1.5 opacity-60">
                  ({allDocs.filter(d => d.status === opt.value).length})
                </span>
              )}
              {allDocs && opt.value === "all" && (
                <span className="ml-1.5 opacity-60">({allDocs.length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Document selection list (only shown in selection mode) */}
        {selectionMode && (
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={allSelected ? selectNone : selectAll}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allSelected ? (
                    <CheckSquare className="w-4 h-4 text-primary" />
                  ) : someSelected ? (
                    <MinusSquare className="w-4 h-4 text-primary/60" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size} of {filteredDocs.length} selected
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-primary hover:underline">Select all</button>
                <button onClick={selectNone} className="text-xs text-muted-foreground hover:underline">Clear</button>
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
              {filteredDocs.map(doc => (
                <label
                  key={doc.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    selectedIds.has(doc.id)
                      ? "bg-primary/5 border border-primary/20"
                      : "hover:bg-muted/50 border border-transparent"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(doc.id)}
                    onChange={() => toggleDoc(doc.id)}
                    className="rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-sm truncate flex-1">{doc.filename}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    doc.status === "reviewed" ? "bg-green-500/10 text-green-700 dark:text-green-400" :
                    doc.status === "needs_review" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" :
                    doc.status === "flagged" ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                    doc.status === "error" ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {doc.status.replace("_", " ")}
                  </span>
                </label>
              ))}
              {filteredDocs.length === 0 && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No documents match this filter
                </div>
              )}
            </div>
          </div>
        )}

        {/* Export summary */}
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-sm text-muted-foreground">
            {selectionMode && selectedIds.size > 0
              ? <><span className="text-foreground font-medium">{selectedIds.size}</span> documents selected for export</>
              : statusFilter !== "all"
                ? <><span className="text-foreground font-medium">{filteredDocs.length}</span> documents with status "{statusFilter.replace("_", " ")}"</>
                : <><span className="text-foreground font-medium">{allDocs?.length ?? 0}</span> total documents will be exported</>
            }
          </div>
        </div>
      </div>

      {/* Export format cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* CSV export */}
        <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 rounded-lg bg-green-500/15 border border-green-500/30 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-green-700 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">CSV Export</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Flat spreadsheet with one row per document. Dynamic columns from your schema.
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-4 space-y-1">
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> Dynamic columns from schema</div>
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> UTF-8 encoded for multilingual text</div>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => { setExporting("csv"); exportCsv.mutate(getExportParams()); }}
            disabled={!!exporting || exportCount === 0}
          >
            {exporting === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting === "csv" ? "Exporting…" : `Download CSV (${exportCount} docs)`}
          </Button>
        </div>

        {/* JSON export */}
        <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <FileJson className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">JSON Export</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Structured JSON array with full transcription data including nested fields.
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-4 space-y-1">
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> Full nested structure preserved</div>
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> Includes original AI output</div>
          </div>
          <Button
            variant="outline"
            className="w-full gap-2 bg-transparent"
            onClick={async () => {
              setExporting("json");
              const r = await fetchJson();
              if (r.data) {
                if (r.data.length === 0) { toast.info("No documents match your selection"); setExporting(null); return; }
                const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${project.name.replace(/\s+/g, "_")}_export.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`Exported ${r.data.length} records`);
              }
              setExporting(null);
            }}
            disabled={!!exporting || exportCount === 0}
          >
            {exporting === "json" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting === "json" ? "Exporting…" : `Download JSON (${exportCount} docs)`}
          </Button>
        </div>
      </div>

      {/* TEI-XML Corpus Export */}
      <div className="mt-5 bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-amber-700 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold mb-1">TEI-XML Corpus</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Full TEI-XML corpus with inline entity markup. Ready for digital humanities tools.
            </p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mb-4 space-y-1">
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> Full teiCorpus structure with headers</div>
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> Inline entity markup (persName, placeName, orgName)</div>
        </div>
        <Button
          className="w-full gap-2"
          onClick={async () => {
            setExporting("tei");
            try {
              const result = await fetchTeiCorpus();
              if (result.data) {
                const blob = new Blob([result.data.xml], { type: "application/xml" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = result.data.filename;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`TEI-XML corpus exported (${result.data.count} documents)`);
              }
            } catch (err: any) {
              toast.error(err.message || "Export failed");
            }
            setExporting(null);
          }}
          disabled={!!exporting || exportCount === 0}
        >
          {exporting === "tei" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {exporting === "tei" ? "Exporting…" : `Download TEI-XML Corpus (${exportCount} docs)`}
        </Button>
      </div>

      {/* TEI-XML Entity Authority File */}
      <div className="mt-5 bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-purple-700 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold mb-1">TEI-XML Entity Authority File</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Named entity registry as a TEI-XML authority file with variant names and document mentions.
            </p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mb-4 space-y-1">
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> Unique numeric IDs for each entity</div>
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-700 dark:text-green-400" /> Document mention references with context</div>
        </div>
        <Button
          variant="outline"
          className="w-full gap-2 bg-transparent"
          onClick={async () => {
            setExporting("tei-entity");
            try {
              const result = await fetchTeiXml();
              if (result.data) {
                const blob = new Blob([result.data.xml], { type: "application/xml" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = result.data.filename;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("TEI-XML entity file exported");
              }
            } catch (err: any) {
              toast.error(err.message || "Export failed");
            }
            setExporting(null);
          }}
          disabled={!!exporting}
        >
          {exporting === "tei-entity" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {exporting === "tei-entity" ? "Exporting…" : "Download Entity Authority File"}
        </Button>
      </div>
    </div>
  );
}
