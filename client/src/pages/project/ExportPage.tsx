import { useState } from "react";
import type { Project } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, FileText, FileJson, Loader2, CheckCircle2 } from "lucide-react";

interface Props {
  projectId: number;
  project: Project;
}

export default function ExportPage({ projectId, project }: Props) {
  const [exporting, setExporting] = useState<"csv" | "json" | "tei" | null>(null);

  const exportCsv = trpc.export.csv.useMutation({
    onSuccess: (data: { csv: string; count: number }) => {
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
    { projectId },
    { enabled: false }
  );

  const { refetch: fetchTeiXml } = trpc.entities.exportTeiXml.useQuery(
    { projectId },
    { enabled: false }
  );

  const { data: stats } = trpc.projects.stats.useQuery({ id: projectId });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-serif font-semibold mb-1">Export transcriptions</h2>
        <p className="text-muted-foreground text-sm">
          Download reviewed transcriptions in your preferred format. Only documents with status "reviewed" are included.
        </p>
      </div>

      {stats && (
        <div className="bg-card border border-border rounded-xl p-5 mb-8 flex items-center gap-6">
          <div>
            <div className="text-2xl font-semibold">{stats.reviewed}</div>
            <div className="text-xs text-muted-foreground">Reviewed documents</div>
          </div>
          <div className="text-border">|</div>
          <div>
            <div className="text-2xl font-semibold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total documents</div>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* CSV export */}
        <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 rounded-lg bg-green-500/15 border border-green-500/30 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">CSV Export</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Flat spreadsheet with one row per document. Columns are dynamically generated from your project's schema fields.
                Compatible with Excel, Google Sheets, and most data tools.
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-4 space-y-1">
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> Dynamic columns from schema</div>
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> Filename and review metadata included</div>
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> UTF-8 encoded for multilingual text</div>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => { setExporting("csv"); exportCsv.mutate({ projectId }); }}
            disabled={!!exporting || (stats?.reviewed ?? 0) === 0}
          >
            {exporting === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting === "csv" ? "Exporting…" : "Download CSV"}
          </Button>
        </div>

        {/* JSON export */}
        <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <FileJson className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">JSON Export</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Structured JSON array with full transcription data including nested fields, arrays, and all metadata.
                Ideal for programmatic processing and academic publishing pipelines.
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-4 space-y-1">
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> Full nested structure preserved</div>
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> Array fields kept as arrays</div>
            <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> Includes original AI output for comparison</div>
          </div>
          <Button
            variant="outline"
            className="w-full gap-2 bg-transparent"
            onClick={async () => { setExporting("json"); const r = await fetchJson(); if (r.data) { const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${project.name.replace(/\s+/g, "_")}_export.json`; a.click(); URL.revokeObjectURL(url); toast.success(`Exported ${r.data.length} records`); } setExporting(null); }}
            disabled={!!exporting || (stats?.reviewed ?? 0) === 0}
          >
            {exporting === "json" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting === "json" ? "Exporting…" : "Download JSON"}
          </Button>
        </div>
      </div>

      {/* TEI-XML Entity Export */}
      <div className="mt-5 bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold mb-1">TEI-XML Entity Authority File</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Export your named entity registry as a TEI-XML authority file. Each entity gets a unique numeric ID with all variant names (aliases),
              document mentions, and type classification. Ideal for linking across digital humanities projects.
            </p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mb-4 space-y-1">
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> Unique numeric IDs for each entity</div>
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> All variant names / aliases included</div>
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-400" /> Document mention references with context</div>
        </div>
        <Button
          variant="outline"
          className="w-full gap-2 bg-transparent"
          onClick={async () => {
            setExporting("tei");
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
          {exporting === "tei" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {exporting === "tei" ? "Exporting…" : "Download TEI-XML"}
        </Button>
      </div>
    </div>
  );
}
