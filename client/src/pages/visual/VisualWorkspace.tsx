import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import {
  Archive, ArrowLeft, Check, ChevronRight, Download, FileImage, FolderKanban, ImagePlus,
  Images, LayoutDashboard, LibraryBig, Link2, Loader2, Menu, Plus, Save,
  MessageSquare, Search, Sparkles, Upload, X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type VisualProject = {
  id: number;
  name: string;
  description: string | null;
  archiveMode: "document_transcription" | "visual_vra";
  _memberRole?: "owner" | "editor" | "viewer";
};

type IdentificationCandidate = {
  name: string;
  classification: string;
  location: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
  verificationNote: string;
};

type GroupingSuggestion = {
  relationship: "same_work" | "same_site" | "same_image" | "related" | "uncertain";
  proposedWorkTitle: string;
  classification: string;
  location: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
  verificationNote: string;
  reviewedByHuman: false;
  evaluatedRecordIds: string[];
};

type PageCursor = { createdAt: string; id: string };

type VisualAsset = {
  id: string;
  filename: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  status: "uploaded" | "ready" | "failed" | "deletion_pending";
  thumbnailUrl: string | null;
};

type VisualRecordListItem = {
  id: string;
  recordType: "collection" | "work" | "image";
  status: "draft" | "needs_review" | "approved" | "archived";
  title: string;
  localIdentifier: string | null;
  revision: number;
  assetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  asset?: { thumbnailUrl: string | null; displayUrl?: string | null } | null;
};

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assets", label: "Visual assets", icon: Images },
  { href: "/catalog", label: "VRA catalog", icon: LibraryBig },
  { href: "/search", label: "Discover", icon: Search },
  { href: "/ask", label: "Ask archive", icon: MessageSquare },
  { href: "/exports", label: "Exports", icon: Download },
  { href: "/relationships", label: "Relationships", icon: Link2 },
];

const ARRAY_FIELDS = new Set([
  "workType", "agents", "dates", "locations", "subjects", "culturalContext",
  "materials", "techniques", "inscriptions", "stylePeriod",
]);

const CATALOG_FIELDS = [
  ["description", "Description"],
  ["workType", "Work type"],
  ["agents", "Agents / creators"],
  ["dates", "Dates"],
  ["locations", "Locations"],
  ["subjects", "Subjects"],
  ["culturalContext", "Cultural context"],
  ["materials", "Materials"],
  ["techniques", "Techniques"],
  ["inscriptions", "Inscriptions"],
  ["stylePeriod", "Style / period"],
] as const;

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="rounded-full border border-emerald-700/15 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100">Approved</Badge>;
  if (status === "needs_review") return <Badge className="rounded-full border border-amber-700/15 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">Needs review</Badge>;
  if (status === "archived") return <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px] font-semibold">Archived</Badge>;
  return <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[11px] font-semibold">Draft</Badge>;
}

function VisualPageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
      <h1 className="font-serif text-3xl font-semibold tracking-[-0.025em] md:text-4xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
    {actions && <div className="shrink-0">{actions}</div>}
  </div>;
}

function VisualEmptyState({ icon: Icon, title, description, action }: { icon: typeof Images; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-border/90 bg-card/40 px-5 py-12 text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/5 text-primary"><Icon className="h-5 w-5" /></div>
    <p className="font-serif text-xl font-semibold">{title}</p>
    <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>;
}

function formatFieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseFieldValue(field: string, value: string): string | string[] {
  if (!ARRAY_FIELDS.has(field)) return value.trim();
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function identificationCandidates(value: unknown): IdentificationCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is IdentificationCandidate => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return ["name", "classification", "location", "rationale", "confidence", "verificationNote"]
      .every(key => typeof candidate[key] === "string")
      && ["high", "medium", "low"].includes(candidate.confidence as string);
  });
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(",");
  if (separator === -1) throw new Error(`Could not encode ${file.name}`);
  return dataUrl.slice(separator + 1);
}

function isTransientVisualUploadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|timeout|429|resource_exhausted|temporar/i.test(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function VisualShell({ project, children }: { project: VisualProject; children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(value => !value)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <a href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Projects
          </a>
          <div className="h-5 w-px bg-border" />
          <div className="min-w-0">
            <div className="truncate font-serif font-semibold">{project.name}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-primary">Visual archive · VRA Core</div>
          </div>
          <Badge variant="outline" className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]">Controlled beta</Badge>
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-64px)]">
        <aside className={`${mobileOpen ? "fixed inset-x-0 top-16 z-30 block max-h-[calc(100vh-4rem)] overflow-y-auto shadow-2xl" : "hidden"} border-b border-slate-700 bg-[#1A1D23] p-3 text-slate-200 md:sticky md:top-16 md:block md:h-[calc(100vh-4rem)] md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r md:shadow-none`}>
          <div className="mb-3 px-3 pt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Catalog workspace</div>
          <nav className="grid grid-cols-2 gap-1 md:block">
            {navItems.map(item => {
              const active = item.href === "/" ? location === "/" : location.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`mb-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${active ? "bg-white/10 font-medium text-white shadow-sm" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-8 hidden border-t border-slate-700 px-3 pt-4 text-xs leading-relaxed text-slate-500 md:block">
            Original files remain immutable. AI output is stored separately until a reviewer accepts it.
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function OverviewPage({ projectId }: { projectId: number }) {
  const { data: stats, isLoading } = trpc.visualArchives.stats.useQuery({ projectId });
  const { data: records } = trpc.visualArchives.listRecords.useQuery({ projectId });
  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
  const items = [
    ["Assets", stats?.assets ?? 0, FileImage],
    ["Collections", stats?.collections ?? 0, Archive],
    ["Works", stats?.works ?? 0, FolderKanban],
    ["Images", stats?.images ?? 0, Images],
  ] as const;
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <VisualPageHeading eyebrow="Visual Archives" title="Catalog visual culture with evidence intact." description="Preserve original images, describe Collections, Works, and Images with VRA-aligned fields, and keep every AI suggestion reviewable." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(([label, value, Icon]) => (
          <div key={label} className="border border-border/90 bg-card px-4 py-5">
            <Icon className="mb-4 h-5 w-5 text-primary" />
            <div className="font-serif text-3xl font-semibold">{value}</div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <section>
          <div className="mb-3 flex items-end justify-between">
            <div><h2 className="font-serif text-xl font-semibold">Recent records</h2><p className="text-sm text-muted-foreground">Reviewed catalog data remains distinct from model suggestions.</p></div>
            <Link href="/catalog" className="text-sm font-medium text-primary">Open catalog</Link>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {(records ?? []).slice(0, 6).map(record => (
              <Link key={record.id} href={`/records/${record.id}`} className="flex items-center gap-3 py-3 hover:text-primary">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{record.title}</div><div className="text-xs capitalize text-muted-foreground">{record.recordType}</div></div>
                {statusBadge(record.status)}<ChevronRight className="h-4 w-4" />
              </Link>
            ))}
            {(records ?? []).length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No catalog records yet.</div>}
          </div>
        </section>
        <aside className="border border-primary/25 bg-primary/5 px-5 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Review queue</p>
          <div className="mt-3 font-serif text-4xl font-semibold">{stats?.needsReview ?? 0}</div>
          <p className="mt-1 text-sm text-muted-foreground">records waiting for human review</p>
          <Link href="/catalog" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">Review catalog <ChevronRight className="h-4 w-4" /></Link>
        </aside>
      </div>
      <section className="border-t border-border pt-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Working path</p><h2 className="mt-1 font-serif text-xl font-semibold">From image to evidence</h2></div><p className="text-xs text-muted-foreground">AI drafts remain separate until a reviewer confirms them.</p></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[
          ["1", "Intake", "Upload images"], ["2", "AI draft", "Reviewable suggestions"], ["3", "Human review", "Approve or correct"], ["4", "Organize", "Associate Images to a Work"], ["5", "Discover", "Search approved evidence"], ["6", "Export", "Share reviewed records"],
        ].map(([number, label, detail]) => <div key={number} className="border-l border-primary/35 pl-3"><span className="text-[11px] font-bold text-primary">{number}</span><p className="mt-1 text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>)}</div>
      </section>
    </div>
  );
}

function AssetsPage({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState({ total: 0, completed: 0, failed: 0, active: 0, running: false });
  const [failedFiles, setFailedFiles] = useState<string[]>([]);
  const [assetCursor, setAssetCursor] = useState<PageCursor | undefined>();
  const [assetPages, setAssetPages] = useState<VisualAsset[][]>([]);
  const utils = trpc.useUtils();
  const assetPageQuery = trpc.visualArchives.listAssetsPage.useQuery({ projectId, cursor: assetCursor, limit: 48 });
  const upload = trpc.visualArchives.uploadAsset.useMutation();

  useEffect(() => {
    setAssetCursor(undefined);
    setAssetPages([]);
  }, [projectId]);

  useEffect(() => {
    if (!assetPageQuery.data) return;
    setAssetPages(current => assetCursor ? [...current, assetPageQuery.data.items as VisualAsset[]] : [assetPageQuery.data.items as VisualAsset[]]);
  }, [assetPageQuery.data, assetCursor]);

  useEffect(() => {
    if (!batch.running) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Visual Archive intake is still running. Completed images will remain available, but unfinished files will need to be selected again.";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [batch.running]);

  const assets = assetPages.flat();

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;
    setBatch({ total: selectedFiles.length, completed: 0, failed: 0, active: 0, running: true });
    setFailedFiles([]);
    const uploadOne = async (file: File) => {
      let succeeded = false;
      if (!["image/jpeg", "image/png"].includes(file.type)) {
        toast.error(`${file.name}: only JPEG and PNG are supported`);
      } else if (file.size > 15 * 1024 * 1024) {
        toast.error(`${file.name}: file must be 15 MB or smaller`);
      } else {
        try {
          setBatch(current => ({ ...current, active: current.active + 1 }));
          const fileBase64 = await fileToBase64(file);
          let result: Awaited<ReturnType<typeof upload.mutateAsync>> | undefined;
          let lastError: unknown;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              result = await upload.mutateAsync({ projectId, filename: file.name, mimeType: file.type as "image/jpeg" | "image/png", fileBase64 });
              break;
            } catch (error) {
              lastError = error;
              if (attempt === 2 || !isTransientVisualUploadError(error)) break;
              await delay((attempt + 1) * 1500);
            }
          }
          if (!result) throw lastError instanceof Error ? lastError : new Error("Could not upload image");
          succeeded = true;
          toast.success(
            result.autoCatalog.suggestionStatus === "already_present"
              ? `${file.name}: already cataloged; restored to your review workflow`
              : result.autoCatalog.suggestionStatus === "generated"
                ? `${file.name}: Image record and AI draft ready for review`
                : `${file.name}: Image record ready for review; AI suggestions can be retried`,
          );
        } catch (error) {
          toast.error(error instanceof Error ? error.message : `Could not upload ${file.name}`);
          setFailedFiles(current => [...current, file.name]);
        } finally {
          setBatch(current => ({ ...current, active: Math.max(0, current.active - 1) }));
        }
      }
      setBatch(current => ({
        ...current,
        completed: current.completed + 1,
        failed: current.failed + (succeeded ? 0 : 1),
      }));
    };
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < selectedFiles.length) {
        const file = selectedFiles[nextIndex++];
        await uploadOne(file);
      }
    };
    // Two concurrent image+Gemini operations keep the preview responsive and avoid a burst of premium model calls.
    await Promise.all(Array.from({ length: Math.min(2, selectedFiles.length) }, worker));
    setBatch(current => ({ ...current, running: false }));
    await Promise.all([
      utils.visualArchives.listAssets.invalidate({ projectId }),
      utils.visualArchives.listAssetsPage.invalidate({ projectId }),
      utils.visualArchives.listRecords.invalidate({ projectId }),
      utils.visualArchives.listRecordsPage.invalidate({ projectId }),
      utils.visualArchives.stats.invalidate({ projectId }),
    ]);
    setAssetCursor(undefined);
    setAssetPages([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <VisualPageHeading eyebrow="Intake" title="Visual assets" description="JPEG and PNG · 15 MB maximum. Every upload creates an Image record and a review-required Gemini draft." actions={canEdit ? <><input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={event => handleFiles(event.target.files)} /><Button onClick={() => inputRef.current?.click()} disabled={batch.running} className="gap-2">{batch.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{batch.running ? `Processing ${batch.completed}/${batch.total}` : "Upload images"}</Button></> : undefined} />
      {batch.total > 0 && <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{batch.running ? "Batch cataloging in progress" : "Batch cataloging complete"}</span><span className="text-muted-foreground">{batch.completed} of {batch.total} complete{batch.running ? ` · ${batch.active} active` : ""}{batch.failed > 0 ? ` · ${batch.failed} failed` : ""}</span></div><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Each image receives immutable derivatives, an Image record, and a separate Gemini draft. <strong>Keep this tab open while work is active.</strong> If your connection drops or the page reloads, select the same files again: already cataloged images are detected and skipped; incomplete files resume through normal intake. TURATH retries temporary failures up to two times.</p>{failedFiles.length > 0 && <p className="mt-2 text-xs text-destructive">Failed: {failedFiles.slice(0, 6).join(", ")}{failedFiles.length > 6 ? ` and ${failedFiles.length - 6} more` : ""}. Select these files again after checking your connection.</p>}</div>}
      {assetPageQuery.isLoading && assets.length === 0 ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="animate-pulse overflow-hidden rounded-lg border border-border bg-card"><div className="aspect-[4/3] bg-muted" /><div className="space-y-2 p-3"><div className="h-3 w-3/4 bg-muted" /><div className="h-2.5 w-1/2 bg-muted" /></div></div>)}</div> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {assets.map(asset => (
            <article key={asset.id} className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/50">
              <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-900">
                {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><ImagePlus className="h-8 w-8 text-muted-foreground" /></div>}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium" title={asset.filename}>{asset.filename}</div>
                <div className="mt-1 text-xs text-muted-foreground">{asset.width} × {asset.height} · {(asset.byteSize / 1024 / 1024).toFixed(1)} MB</div>
                <div className="mt-3 flex items-center justify-between">
                  <Badge variant={asset.status === "ready" ? "outline" : "secondary"}>{asset.status}</Badge>
                  {asset.status === "ready" && <span className="text-xs text-muted-foreground">Image record created automatically</span>}
                </div>
              </div>
            </article>
          ))}
          {assets.length === 0 && <div className="col-span-full"><VisualEmptyState icon={Images} title="No visual assets yet" description="Upload a JPEG or PNG to begin a catalog. Each image becomes a reviewable Image record automatically." action={canEdit ? <Button onClick={() => inputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Upload images</Button> : undefined} /></div>}
        </div>
      )}
      {assets.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted-foreground"><span>Showing {assets.length} of {assetPageQuery.data?.total ?? assets.length} assets</span>{assetPageQuery.data?.nextCursor && <Button variant="outline" onClick={() => setAssetCursor(assetPageQuery.data?.nextCursor ?? undefined)} disabled={assetPageQuery.isFetching}>{assetPageQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Load more</Button>}</div>}
    </div>
  );
}

function CatalogPage({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [recordType, setRecordType] = useState<"collection" | "work" | "image">("work");
  const [title, setTitle] = useState("");
  const [localIdentifier, setLocalIdentifier] = useState("");
  const [assetId, setAssetId] = useState("");
  const [filter, setFilter] = useState<"all" | "collection" | "work" | "image">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "needs_review" | "approved" | "draft" | "archived">("all");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<PageCursor | undefined>();
  const [pages, setPages] = useState<VisualRecordListItem[][]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [lastBulkChange, setLastBulkChange] = useState<Array<{ id: string; status: VisualRecordListItem["status"] }> | null>(null);
  const [workRecordId, setWorkRecordId] = useState("");
  const [newWorkTitle, setNewWorkTitle] = useState("");
  const [groupingSuggestion, setGroupingSuggestion] = useState<GroupingSuggestion | null>(null);
  const utils = trpc.useUtils();
  const catalogPage = trpc.visualArchives.listRecordsPage.useQuery({
    projectId,
    recordType: filter === "all" ? undefined : filter,
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.trim() || undefined,
    cursor,
    limit: 48,
  });
  const { data: assets } = trpc.visualArchives.listAssetsPage.useQuery({ projectId, limit: 100 });
  const { data: worksPage } = trpc.visualArchives.listRecordsPage.useQuery({ projectId, recordType: "work", limit: 100 });
  const matchingRecordIds = trpc.visualArchives.listRecordIds.useQuery({
    projectId,
    recordType: filter === "all" ? undefined : filter,
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.trim() || undefined,
    limit: 500,
  }, { enabled: false });
  const records = pages.flat();
  const selectedImages = records.filter(record => selectedRecordIds.includes(record.id) && record.recordType === "image");
  const selectedCount = selectedRecordIds.length;

  const resetCatalog = useCallback(() => {
    setCursor(undefined);
    setPages([]);
    setSelectedRecordIds([]);
  }, []);

  useEffect(() => { resetCatalog(); }, [projectId, filter, statusFilter, search, resetCatalog]);
  useEffect(() => {
    if (!catalogPage.data) return;
    setPages(current => cursor ? [...current, catalogPage.data.items as VisualRecordListItem[]] : [catalogPage.data.items as VisualRecordListItem[]]);
  }, [catalogPage.data, cursor]);

  const create = trpc.visualArchives.createRecord.useMutation({
    onSuccess: async () => {
      toast.success("Catalog record created"); setShowCreate(false); setTitle(""); setLocalIdentifier(""); setAssetId("");
      resetCatalog();
      await Promise.all([utils.visualArchives.listRecords.invalidate(), utils.visualArchives.listRecordsPage.invalidate(), utils.visualArchives.stats.invalidate({ projectId })]);
    },
    onError: error => toast.error(error.message),
  });
  const bulkStatus = trpc.visualArchives.bulkSetRecordStatus.useMutation({
    onSuccess: async result => {
      toast.success(`${result.updated} record${result.updated === 1 ? "" : "s"} updated`);
      resetCatalog();
      await Promise.all([utils.visualArchives.listRecords.invalidate(), utils.visualArchives.listRecordsPage.invalidate(), utils.visualArchives.stats.invalidate({ projectId })]);
    },
    onError: error => toast.error(error.message),
  });
  const groupExisting = trpc.visualArchives.linkImagesToWork.useMutation({
    onSuccess: async result => {
      toast.success(`${result.linked} Image record${result.linked === 1 ? "" : "s"} linked to this Work`);
      setShowGroup(false); setWorkRecordId(""); setNewWorkTitle(""); resetCatalog();
      await Promise.all([utils.visualArchives.listRecords.invalidate(), utils.visualArchives.listRecordsPage.invalidate(), utils.visualArchives.listRelations.invalidate({ projectId })]);
    },
    onError: error => toast.error(error.message),
  });
  const createWorkAndGroup = trpc.visualArchives.createRecord.useMutation({
    onSuccess: async work => {
      try {
        await groupExisting.mutateAsync({ projectId, workRecordId: work.id, imageRecordIds: selectedImages.map(record => record.id) });
      } catch {
        toast.error("The Work was created, but one or more Images could not be linked. You can link them from Relationships.");
      }
    },
    onError: error => toast.error(error.message),
  });
  const suggestGrouping = trpc.visualArchives.suggestImageGrouping.useMutation({
    onSuccess: result => {
      setGroupingSuggestion(result as GroupingSuggestion);
      toast.success("Comparison ready for your review");
    },
    onError: error => toast.error(error.message),
  });
  const toggleSelection = (recordId: string) => setSelectedRecordIds(current => current.includes(recordId) ? current.filter(id => id !== recordId) : [...current, recordId]);
  const selectPage = () => setSelectedRecordIds(current => Array.from(new Set([...current, ...records.map(record => record.id)])));
  const selectFiltered = async () => {
    const result = await matchingRecordIds.refetch();
    const ids = result.data?.map(record => record.id) ?? [];
    setSelectedRecordIds(ids);
    toast.success(`Selected ${ids.length} matching record${ids.length === 1 ? "" : "s"}${ids.length === 500 ? " (first 500)" : ""}`);
  };
  const applyBulkStatus = async (status: VisualRecordListItem["status"]) => {
    const loadedStates = new Map(records.map(record => [record.id, record.status]));
    let before = selectedRecordIds.map(id => ({ id, status: loadedStates.get(id) })).filter((record): record is { id: string; status: VisualRecordListItem["status"] } => Boolean(record.status));
    if (before.length !== selectedRecordIds.length) {
      const matching = await matchingRecordIds.refetch();
      const states = new Map((matching.data ?? []).map(record => [record.id, record.status]));
      before = selectedRecordIds.map(id => ({ id, status: states.get(id) })).filter((record): record is { id: string; status: VisualRecordListItem["status"] } => Boolean(record.status));
    }
    try {
      for (let index = 0; index < selectedRecordIds.length; index += 100) {
        await bulkStatus.mutateAsync({ projectId, recordIds: selectedRecordIds.slice(index, index + 100), status });
      }
      setLastBulkChange(before.length === selectedRecordIds.length ? before : null);
    } catch {
      // Mutation-level feedback already explains the failed request.
    }
  };
  const undoBulkStatus = async () => {
    if (!lastBulkChange?.length) return;
    const grouped = lastBulkChange.reduce<Record<string, string[]>>((groups, record) => {
      groups[record.status] = [...(groups[record.status] ?? []), record.id];
      return groups;
    }, {});
    try {
      for (const [status, ids] of Object.entries(grouped)) {
        for (let index = 0; index < ids.length; index += 100) {
          await bulkStatus.mutateAsync({ projectId, recordIds: ids.slice(index, index + 100), status: status as VisualRecordListItem["status"] });
        }
      }
      toast.success("Bulk status change undone");
      setLastBulkChange(null);
    } catch {
      // Mutation-level feedback already explains the failed request.
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <VisualPageHeading eyebrow="VRA Core 4" title="Catalog" description="Collections contain Works; Images document Works. Approved catalog data stays distinct from AI suggestions." actions={canEdit ? <Button className="gap-2" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New record</Button> : undefined} />
      <div className="sticky top-16 z-20 -mx-4 border-y border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1">{(["all", "collection", "work", "image"] as const).map(value => <button key={value} onClick={() => setFilter(value)} className={`px-3 py-2 text-sm capitalize ${filter === value ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}>{value}</button>)}</div><div className="flex gap-1 rounded-md border border-border p-1"><Button size="sm" variant={viewMode === "grid" ? "secondary" : "ghost"} onClick={() => setViewMode("grid")}>Grid</Button><Button size="sm" variant={viewMode === "list" ? "secondary" : "ghost"} onClick={() => setViewMode("list")}>List</Button></div></div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_190px_auto]"><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search catalog titles…" aria-label="Search catalog titles" /><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All review states</option><option value="needs_review">Needs review</option><option value="approved">Approved</option><option value="draft">Draft</option><option value="archived">Archived</option></select>{canEdit && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={selectPage} disabled={records.length === 0}>Select page</Button><Button size="sm" variant="outline" onClick={() => void selectFiltered()} disabled={matchingRecordIds.isFetching}>Select all</Button></div>}</div>
      </div>
      {canEdit && selectedCount > 0 && <div className="sticky top-[13.25rem] z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary px-4 py-3 text-primary-foreground shadow-md sm:top-[10.25rem] md:top-[8.5rem]"><span className="mr-2 text-sm font-medium">{selectedCount} selected</span><Button size="sm" variant="secondary" onClick={() => void applyBulkStatus("needs_review")} disabled={bulkStatus.isPending}>Needs review</Button><Button size="sm" variant="secondary" onClick={() => void applyBulkStatus("approved")} disabled={bulkStatus.isPending}>Approve</Button>{selectedImages.length > 0 && <Button size="sm" variant="secondary" onClick={() => { setGroupingSuggestion(null); setShowGroup(true); }} disabled={groupExisting.isPending || createWorkAndGroup.isPending}>Organize {selectedImages.length} image{selectedImages.length === 1 ? "" : "s"} as a Work</Button>}{lastBulkChange && <Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={() => void undoBulkStatus()} disabled={bulkStatus.isPending}>Undo</Button>}<Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={() => setSelectedRecordIds([])}>Clear</Button></div>}
      {catalogPage.isLoading && records.length === 0 ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }, (_, index) => <div key={index} className="animate-pulse overflow-hidden rounded-lg border border-border bg-card"><div className="aspect-[4/3] bg-muted" /><div className="space-y-2 p-3"><div className="h-3 w-3/4 bg-muted" /><div className="h-2.5 w-1/2 bg-muted" /></div></div>)}</div> : records.length === 0 ? <VisualEmptyState icon={Images} title="No matching catalog records" description="Adjust the filters, search another title, or upload images to create review records automatically." action={canEdit ? <Link href="/assets"><Button><Upload className="mr-2 h-4 w-4" />Open intake</Button></Link> : undefined} /> : viewMode === "grid" ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"><div className="col-span-full flex items-center justify-between text-xs text-muted-foreground"><span>Click a card to review. Select Images to organize them under a Work or site.</span><span>{selectedCount ? `${selectedCount} selected` : "No selection"}</span></div>{records.map(record => <article key={record.id} className={`group overflow-hidden rounded-lg border bg-card transition-colors ${selectedRecordIds.includes(record.id) ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60"}`}><div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-900">{record.asset?.thumbnailUrl ? <img src={record.asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><LibraryBig className="h-7 w-7 text-muted-foreground" /></div>}{canEdit && <label className="absolute left-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border/60 bg-background/90 shadow-sm"><input type="checkbox" aria-label={`Select ${record.title}`} checked={selectedRecordIds.includes(record.id)} onChange={() => toggleSelection(record.id)} className="h-4 w-4" /></label>}<div className="absolute bottom-2 right-2">{statusBadge(record.status)}</div></div><Link href={`/records/${record.id}`} className="block p-3"><p className="truncate text-sm font-medium group-hover:text-primary">{record.title}</p><p className="mt-1 truncate text-xs text-muted-foreground capitalize">{record.recordType}{record.localIdentifier ? ` · ${record.localIdentifier}` : ""}</p><p className="mt-2 text-[11px] text-muted-foreground">Revision {record.revision}</p></Link></article>)}</div> : <div className="divide-y divide-border rounded-lg border border-border bg-card">{records.map(record => <div key={record.id} className={`grid grid-cols-[auto_52px_1fr_auto] items-center gap-3 px-3 py-3 transition-colors ${selectedRecordIds.includes(record.id) ? "bg-primary/5" : "hover:bg-muted/40"}`}><input type="checkbox" aria-label={`Select ${record.title}`} checked={selectedRecordIds.includes(record.id)} onChange={() => toggleSelection(record.id)} disabled={!canEdit} /><div className="flex h-12 w-12 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-900">{record.asset?.thumbnailUrl ? <img src={record.asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <span className="m-auto"><LibraryBig className="h-4 w-4 text-muted-foreground" /></span>}</div><Link href={`/records/${record.id}`} className="min-w-0 hover:text-primary"><div className="truncate font-medium">{record.title}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="capitalize">{record.recordType}</span>{record.localIdentifier && <><span>·</span><span>{record.localIdentifier}</span></>}<span>·</span><span>rev. {record.revision}</span></div></Link><div className="flex items-center gap-3">{statusBadge(record.status)}<ChevronRight className="h-4 w-4" /></div></div>)}</div>}
      {records.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span>Showing {records.length} of {catalogPage.data?.total ?? records.length} records</span>{catalogPage.data?.nextCursor && <Button variant="outline" onClick={() => setCursor(catalogPage.data?.nextCursor ?? undefined)} disabled={catalogPage.isFetching}>{catalogPage.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Load more</Button>}</div>}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent><DialogHeader><DialogTitle className="font-serif">Create VRA record</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="space-y-1.5"><Label>Record type</Label><select value={recordType} onChange={event => setRecordType(event.target.value as typeof recordType)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="collection">Collection</option><option value="work">Work</option><option value="image">Image</option></select></div><div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={event => setTitle(event.target.value)} placeholder="Untitled photograph, architectural work, collection..." /></div><div className="space-y-1.5"><Label>Local identifier</Label><Input value={localIdentifier} onChange={event => setLocalIdentifier(event.target.value)} placeholder="Optional accession or local ID" /></div>{recordType === "image" && <div className="space-y-1.5"><Label>Visual asset</Label><select value={assetId} onChange={event => setAssetId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">No asset attached</option>{(assets?.items ?? []).filter(item => item.status === "ready").map(item => <option key={item.id} value={item.id}>{item.filename}</option>)}</select></div>}</div><DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={() => create.mutate({ projectId, recordType, title, localIdentifier: localIdentifier || undefined, assetId: assetId || undefined, reviewedJson: {} })} disabled={!title.trim() || create.isPending}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create record</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={showGroup} onOpenChange={setShowGroup}>
        <DialogContent><DialogHeader><DialogTitle className="font-serif">Organize selected Images as one Work or site</DialogTitle></DialogHeader><div className="space-y-4 py-2"><p className="text-sm text-muted-foreground">This creates reviewed Work → Image links. It never merges, deletes, or replaces the selected Image records.</p><div className="border-y border-amber-500/30 bg-amber-500/5 px-3 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Compare selected Images</p><p className="mt-1 text-xs text-muted-foreground">Gemini may identify a common Work, site, or duplicate. It cannot create links or change metadata.</p></div><Button size="sm" variant="outline" onClick={() => suggestGrouping.mutate({ projectId, imageRecordIds: selectedImages.map(record => record.id) })} disabled={suggestGrouping.isPending || selectedImages.length < 2}>{suggestGrouping.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Compare with AI</Button></div>{groupingSuggestion && <div className="mt-3 border-t border-amber-500/20 pt-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium capitalize">Possible relationship: {groupingSuggestion.relationship.replace(/_/g, " ")}</p><Badge variant="outline" className="capitalize">{groupingSuggestion.confidence} confidence</Badge></div>{groupingSuggestion.proposedWorkTitle && <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p><span className="font-medium">Candidate Work:</span> {groupingSuggestion.proposedWorkTitle}</p><Button size="sm" variant="ghost" className="h-7 px-0 text-xs text-primary" onClick={() => { setNewWorkTitle(groupingSuggestion.proposedWorkTitle); setWorkRecordId(""); }}>Use proposed title</Button></div>}<p className="mt-2 leading-relaxed">{groupingSuggestion.rationale}</p><p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Verify:</span> {groupingSuggestion.verificationNote}</p></div>}</div><div className="space-y-1.5"><Label>Link to an existing Work</Label><select value={workRecordId} onChange={event => { setWorkRecordId(event.target.value); setNewWorkTitle(""); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose a Work</option>{(worksPage?.items ?? []).map(work => <option key={work.id} value={work.id}>{work.title}</option>)}</select></div><div className="relative py-1 text-center text-xs uppercase tracking-[0.16em] text-muted-foreground before:absolute before:left-0 before:top-1/2 before:h-px before:w-[43%] before:bg-border after:absolute after:right-0 after:top-1/2 after:h-px after:w-[43%] after:bg-border">or</div><div className="space-y-1.5"><Label>Create a new Work or site</Label><Input value={newWorkTitle} onChange={event => { setNewWorkTitle(event.target.value); setWorkRecordId(""); }} placeholder="e.g. Nasir al-Mulk Mosque, Shiraz" /></div></div><DialogFooter><Button variant="outline" onClick={() => setShowGroup(false)}>Cancel</Button>{workRecordId ? <Button onClick={() => groupExisting.mutate({ projectId, workRecordId, imageRecordIds: selectedImages.map(record => record.id) })} disabled={groupExisting.isPending}>{groupExisting.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Link Images</Button> : <Button onClick={() => createWorkAndGroup.mutate({ projectId, recordType: "work", title: newWorkTitle, reviewedJson: {} })} disabled={!newWorkTitle.trim() || createWorkAndGroup.isPending}>{createWorkAndGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Work and link Images</Button>}</DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

const DISCOVERY_FACETS = ["workType", "locations", "subjects", "materials", "techniques", "stylePeriod"] as const;
const DISCOVERY_FACET_LABELS: Record<(typeof DISCOVERY_FACETS)[number], string> = {
  workType: "Work type",
  locations: "Location",
  subjects: "Subject",
  materials: "Material",
  techniques: "Technique",
  stylePeriod: "Style / period",
};

function VisualSearchPage({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [searchOffset, setSearchOffset] = useState(0);
  const [facets, setFacets] = useState<Partial<Record<(typeof DISCOVERY_FACETS)[number], string[]>>>({});
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const [referenceResults, setReferenceResults] = useState<Array<{ asset: { id: string; thumbnailUrl: string | null; filename: string }; record: { id: string; title: string; recordType: string } | null; score: number; classification: string; explanation: string }> | null>(null);
  const search = trpc.visualArchives.searchReviewedCatalog.useQuery({ projectId, query, facets, includeDrafts, offset: searchOffset, limit: 48 });
  const availability = trpc.visualArchives.availability.useQuery();
  const findSimilar = trpc.visualArchives.findSimilarToUploadedImage.useMutation({
    onSuccess: result => {
      setReferenceResults(result.items as typeof referenceResults extends Array<infer Item> ? Item[] : never);
      toast.success(result.items.length ? "Visual matches ready for review" : "No close matches found in the current scope");
    },
    onError: error => toast.error(error.message),
  });
  const searchReference = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      toast.error("Choose a JPEG or PNG of 15 MB or smaller");
      return;
    }
    setReferenceName(file.name);
    setReferenceResults(null);
    const fileBase64 = await fileToBase64(file);
    findSimilar.mutate({ projectId, mimeType: file.type as "image/jpeg" | "image/png", fileBase64, includeDrafts, limit: 24 });
  };
  const toggleFacet = (field: (typeof DISCOVERY_FACETS)[number], value: string) => {
    setFacets(current => {
      const values = current[field] ?? [];
      const next = values.includes(value) ? values.filter(item => item !== value) : [...values, value];
      return { ...current, [field]: next };
    });
    setSearchOffset(0);
  };
  const clearFilters = () => { setFacets({}); setDraftQuery(""); setQuery(""); setSearchOffset(0); };
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <VisualPageHeading eyebrow="Discovery" title="Explore approved catalog evidence" description="Search titles and reviewed metadata, or compare a temporary reference image with this archive. AI drafts and unreviewed identifications stay out of results by default." actions={canEdit ? <label className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm"><input type="checkbox" checked={includeDrafts} onChange={event => { setIncludeDrafts(event.target.checked); setReferenceResults(null); setSearchOffset(0); }} /> Include draft records</label> : undefined} />
      <form className="rounded-lg border border-border bg-card p-3 sm:flex sm:gap-2" onSubmit={event => { event.preventDefault(); setSearchOffset(0); setQuery(draftQuery.trim()); }}><Input value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder="Search places, subjects, materials, titles…" aria-label="Search approved visual catalog" /><Button type="submit" className="mt-2 w-full sm:mt-0 sm:w-auto"><Search className="mr-2 h-4 w-4" />Search</Button></form>
      <section className="rounded-lg border border-border bg-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">Search by reference image</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Compare a local JPEG or PNG against project fingerprints. The reference is processed in memory and never saved. Results are visual signals, not catalog facts.</p></div><div className="shrink-0"><input ref={referenceInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={event => void searchReference(event.target.files?.[0])} /><Button variant="outline" onClick={() => referenceInputRef.current?.click()} disabled={findSimilar.isPending}>{findSimilar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}{findSimilar.isPending ? "Comparing…" : "Choose reference image"}</Button></div></div>{referenceName && <p className="mt-3 text-xs text-muted-foreground">Reference: <span className="font-medium text-foreground">{referenceName}</span> · {includeDrafts ? "approved and draft records" : "approved records only"}</p>}{referenceResults && <div className="mt-4 border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-medium">Visual matches</p><Button size="sm" variant="ghost" className="h-7 px-0 text-xs" onClick={() => { setReferenceResults(null); setReferenceName(null); }}>Clear</Button></div>{referenceResults.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{referenceResults.map(item => <Link key={item.asset.id} href={item.record ? `/records/${item.record.id}` : "/assets"} className="group overflow-hidden rounded-md border border-border hover:border-primary/60"><div className="aspect-square bg-slate-100 dark:bg-slate-900">{item.asset.thumbnailUrl ? <img src={item.asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><Images className="h-5 w-5 text-muted-foreground" /></div>}</div><div className="p-2"><p className="truncate text-xs font-medium group-hover:text-primary">{item.record?.title ?? item.asset.filename}</p><p className="mt-1 text-[11px] text-muted-foreground">{Math.round(item.score * 100)}% · {item.classification}</p></div></Link>)}</div> : <p className="py-6 text-sm text-muted-foreground">No close visual matches were found in this project scope.</p>}</div>}</section>
      {!availability.data?.memoryEnabled && <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/25 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Semantic visual memory is not enabled</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Text-vector and hybrid semantic results are intentionally unavailable until the dedicated Visual Archives migration is applied and the feature is explicitly enabled. No semantic results are being simulated.</p></div><Badge variant="outline" className="w-fit rounded-full">Unavailable</Badge></div>}
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="space-y-5 border-y border-border py-4 lg:border-y-0 lg:border-r lg:py-0 lg:pr-6"><div className="flex items-center justify-between"><h2 className="font-serif text-lg font-semibold">Refine</h2>{(query || Object.values(facets).some(values => values?.length)) && <Button size="sm" variant="ghost" className="h-7 px-0 text-xs" onClick={clearFilters}>Clear all</Button>}</div>{DISCOVERY_FACETS.map(field => { const options = search.data?.facets?.[field] ?? []; return options.length > 0 ? <div key={field}><p className="mb-2 text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">{DISCOVERY_FACET_LABELS[field]}</p><div className="space-y-1.5">{options.map(option => <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={(facets[field] ?? []).includes(option.value)} onChange={() => toggleFacet(field, option.value)} /><span className="min-w-0 flex-1 truncate">{option.value}</span><span className="text-xs text-muted-foreground">{option.count}</span></label>)}</div></div> : null; })}</aside>
        <section>{search.isLoading ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="animate-pulse overflow-hidden rounded-lg border border-border bg-card"><div className="aspect-[4/3] bg-muted" /><div className="space-y-2 p-3"><div className="h-3 w-2/3 bg-muted" /><div className="h-2 w-1/2 bg-muted" /></div></div>)}</div> : <><div className="mb-3 flex items-center justify-between text-sm text-muted-foreground"><span>{search.data?.total ?? 0} {includeDrafts ? "catalog" : "approved"} record{(search.data?.total ?? 0) === 1 ? "" : "s"} found</span><span>Results {searchOffset + 1}–{Math.min(searchOffset + (search.data?.items.length ?? 0), search.data?.total ?? 0)}</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(search.data?.items ?? []).map(record => <Link key={record.id} href={`/records/${record.id}`} className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/50"><div className="aspect-[4/3] bg-slate-100 dark:bg-slate-900">{record.asset?.thumbnailUrl ? <img src={record.asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><LibraryBig className="h-8 w-8 text-muted-foreground" /></div>}</div><div className="p-3"><div className="truncate font-medium group-hover:text-primary">{record.title}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="capitalize">{record.recordType}</span>{record.localIdentifier && <><span>·</span><span className="truncate">{record.localIdentifier}</span></>}</div>{record.matchReasons.length > 0 && <p className="mt-2 truncate text-[11px] text-primary">{record.matchReasons.join(" · ")}</p>}</div></Link>)}{(search.data?.items ?? []).length === 0 && <div className="col-span-full"><VisualEmptyState icon={Search} title="No approved catalog records match" description="Review and approve catalog records before they appear in Discover, or broaden the search and filters." /></div>}</div>{(search.data?.total ?? 0) > 48 && <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm"><Button variant="outline" onClick={() => setSearchOffset(Math.max(0, searchOffset - 48))} disabled={searchOffset === 0}>Previous</Button><span className="text-xs text-muted-foreground">Page {Math.floor(searchOffset / 48) + 1}</span><Button variant="outline" onClick={() => setSearchOffset(search.data?.nextOffset ?? searchOffset)} disabled={!search.data?.nextOffset}>Next</Button></div>}</>}</section>
      </div>
    </div>
  );
}

type VisualChatSource = { index: number; recordId: string; title: string; recordType: string; excerpt: string; matchedFields: string[]; reviewedJson: unknown; thumbnailUrl: string | null };
type VisualChatMessage = { role: "user" | "assistant"; content: string; sources?: VisualChatSource[]; insufficientEvidence?: boolean };

function VisualAskArchivePage({ projectId }: { projectId: number }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<VisualChatMessage[]>([]);
  const [activeEvidence, setActiveEvidence] = useState<VisualChatSource | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyKey = `turath.visual-archive.${projectId}.conversation.v1`;
  useEffect(() => {
    setHistoryLoaded(false);
    try {
      const saved = window.localStorage.getItem(historyKey);
      const parsed = saved ? JSON.parse(saved) : [];
      setMessages(Array.isArray(parsed) ? parsed.slice(-24) : []);
    } catch {
      setMessages([]);
    } finally {
      setHistoryLoaded(true);
    }
  }, [historyKey]);
  useEffect(() => {
    if (!historyLoaded) return;
    try {
      window.localStorage.setItem(historyKey, JSON.stringify(messages.slice(-24)));
    } catch {
      // Conversation persistence is a convenience only; the live archive answer remains available.
    }
  }, [historyKey, historyLoaded, messages]);
  const ask = trpc.visualArchives.askArchive.useMutation({
    onSuccess: result => setMessages(current => [...current, { role: "assistant", content: result.answer, sources: result.sources, insufficientEvidence: result.insufficientEvidence }]),
    onError: error => { toast.error(error.message); setMessages(current => current.slice(0, -1)); },
  });
  const submit = () => {
    const content = question.trim();
    if (!content || ask.isPending) return;
    const history = messages.map(message => ({ role: message.role, content: message.content }));
    setMessages(current => [...current, { role: "user", content }]);
    setQuestion("");
    ask.mutate({ projectId, question: content, history });
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <VisualPageHeading eyebrow="Evidence-linked Q&A" title="Ask this Visual Archive" description="Answers are grounded in human-approved VRA records and cite the exact Images, Works, or Collections used. Drafts and unreviewed identifications are excluded." actions={messages.length ? <Button size="sm" variant="outline" onClick={() => { setMessages([]); window.localStorage.removeItem(historyKey); }}>Clear conversation</Button> : undefined} />
      <div className="flex flex-wrap gap-2"><Badge variant="outline" className="rounded-full">Approved evidence only</Badge><Badge variant="outline" className="rounded-full">This Visual Archive</Badge><Badge variant="outline" className="rounded-full">{messages.length ? `${messages.length} messages saved on this device` : "Private device history"}</Badge></div>
      <div className="min-h-[420px] rounded-lg border border-border bg-card p-4 sm:p-6"><div className="space-y-6">{messages.length === 0 && <div className="py-16 text-center"><MessageSquare className="mx-auto mb-4 h-10 w-10 text-primary" /><p className="font-serif text-xl">Begin with a question grounded in the catalog</p><p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">Ask about approved Images, Works, places, materials, or patterns. TURATH will cite the evidence it used—or say when evidence is insufficient.</p><div className="mx-auto mt-6 grid max-w-2xl gap-2 text-left sm:grid-cols-2">{["Which approved Images depict religious architecture?", "What materials recur in this collection?", "Which records are associated with this Work or site?", "What places appear in the approved catalog?"].map(example => <button key={example} type="button" className="rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground" onClick={() => setQuestion(example)}>{example}</button>)}</div></div>}{messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-2xl rounded-lg bg-primary px-4 py-3 text-primary-foreground" : "max-w-4xl border-l-2 border-primary py-1 pl-4"}><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">{message.role === "user" ? "You" : "TURATH"}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>{message.insufficientEvidence && <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">No answer was inferred beyond the approved evidence currently available.</p>}{message.sources && message.sources.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{message.sources.map(source => <button key={source.recordId} type="button" onClick={() => setActiveEvidence(source)} className="grid grid-cols-[48px_1fr] gap-2 rounded-md border border-border bg-background p-2 text-left text-foreground hover:border-primary/50"><div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded bg-slate-100 dark:bg-slate-900">{source.thumbnailUrl ? <img src={source.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <LibraryBig className="h-4 w-4 text-muted-foreground" />}</div><div className="min-w-0"><p className="truncate text-xs font-medium">[Record {source.index}] {source.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground capitalize">{source.recordType}{source.matchedFields.length ? ` · ${source.matchedFields.join(", ")}` : ""}</p></div></button>)}</div>}</div>)}{ask.isPending && <div className="flex items-center gap-2 border-l-2 border-primary py-2 pl-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading approved visual evidence…</div>}</div></div>
      <div className="rounded-lg border border-border bg-card p-3"><Textarea value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(); }} placeholder="Ask a question about approved records in this Visual Archive…" rows={3} disabled={ask.isPending} /><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Use ⌘/Ctrl + Enter to send. Follow-up questions include this conversation’s prior answers.</p><Button onClick={submit} disabled={!question.trim() || ask.isPending}>{ask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ask archive</Button></div></div>
      <Dialog open={Boolean(activeEvidence)} onOpenChange={open => { if (!open) setActiveEvidence(null); }}><DialogContent><DialogHeader><DialogTitle className="font-serif">[Record {activeEvidence?.index}] {activeEvidence?.title}</DialogTitle></DialogHeader>{activeEvidence && <div className="space-y-4"><div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-slate-100 dark:bg-slate-900">{activeEvidence.thumbnailUrl ? <img src={activeEvidence.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <LibraryBig className="h-8 w-8 text-muted-foreground" />}</div><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Matched approved fields</p><p className="mt-1 text-sm">{activeEvidence.matchedFields.length ? activeEvidence.matchedFields.join(", ") : "Included as approved archive context"}</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Reviewed metadata</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{JSON.stringify(activeEvidence.reviewedJson, null, 2)}</pre></div><Link href={`/records/${activeEvidence.recordId}`} target="_blank" rel="noreferrer" className="inline-flex text-sm font-medium text-primary">Open full record in a new tab →</Link></div>}</DialogContent></Dialog>
    </div>
  );
}

function VisualExportsPage({ projectId }: { projectId: number }) {
  const [includeUnapproved, setIncludeUnapproved] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [downloadingFormat, setDownloadingFormat] = useState<"csv" | "json" | "xml" | null>(null);
  const [zipState, setZipState] = useState<"idle" | "started">("idle");
  const assets = trpc.visualArchives.listAssetsPage.useQuery({ projectId, status: "ready", limit: 100 });
  const exportText = async (format: "csv" | "json" | "xml") => {
    setDownloadingFormat(format);
    try {
      const query = new URLSearchParams({ includeUnapproved: String(includeUnapproved) });
      const response = await fetch(`/api/storage/projects/${projectId}/visual-exports/catalog.${format}?${query.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error(`Could not prepare ${format.toUpperCase()} export (${response.status})`);
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("The export was empty. Please try again.");
      const filename = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1]
        ?? `turath-visual-catalog.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      toast.success(`${filename} download started`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setDownloadingFormat(null);
    }
  };
  const toggleAsset = (assetId: string) => setSelectedAssetIds(current => current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId]);
  const downloadZip = () => {
    if (selectedAssetIds.length === 0) return;
    const query = new URLSearchParams({ assetIds: selectedAssetIds.join(",") });
    const anchor = document.createElement("a");
    anchor.href = `/api/storage/projects/${projectId}/visual-exports/selected.zip?${query.toString()}`;
    anchor.download = "";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setZipState("started");
    toast.success("ZIP download started. Your browser will show streaming progress.");
  };
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <VisualPageHeading eyebrow="Portability" title="Export approved visual evidence" description="Exports exclude AI drafts by default and preserve record identifiers and reviewed relationships. Image files remain private until you deliberately request a selected-image ZIP." />
      <section className="rounded-lg border border-border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-serif text-xl font-semibold">Catalog data</h2><p className="mt-1 text-sm text-muted-foreground">Download reviewed Collections, Works, Images, and their relationships.</p></div><label className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm"><input type="checkbox" checked={includeUnapproved} onChange={event => setIncludeUnapproved(event.target.checked)} disabled={downloadingFormat !== null} /> Include unapproved working records</label></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{(["csv", "json", "xml"] as const).map(format => <button key={format} type="button" onClick={() => exportText(format)} disabled={downloadingFormat !== null} className="rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.02] disabled:opacity-60"><p className="flex items-center gap-2 font-medium">{downloadingFormat === format && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{format === "xml" ? "VRA Core 4 XML" : format.toUpperCase()}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{format === "csv" ? "Spreadsheet-ready catalog table" : format === "json" ? "Structured records and relationships" : "Standards-oriented Work, Collection, and Image export"}</p></button>)}</div>{downloadingFormat && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing your {downloadingFormat.toUpperCase()} download…</p>}</section>
      <section className="rounded-lg border border-border bg-card p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-serif text-xl font-semibold">Selected original images</h2><p className="mt-1 text-sm text-muted-foreground">Choose up to 100 ready images. The protected ZIP includes originals plus a manifest of file identifiers.</p></div><Button onClick={downloadZip} disabled={selectedAssetIds.length === 0 || selectedAssetIds.length > 100}><Download className="mr-2 h-4 w-4" />Download {selectedAssetIds.length || "selected"} as ZIP</Button></div>{zipState === "started" && <p className="mt-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">ZIP stream started. Keep this tab open until your browser reports the download is complete. If it fails, select the same images and try again.</p>}{assets.isLoading ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="animate-pulse rounded-md border border-border p-2"><div className="aspect-square bg-muted" /><div className="mt-2 h-2.5 w-3/4 bg-muted" /></div>)}</div> : <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{(assets.data?.items ?? []).map(asset => <label key={asset.id} className={`cursor-pointer overflow-hidden rounded-md border p-2 transition-colors ${selectedAssetIds.includes(asset.id) ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50"}`}><input type="checkbox" className="sr-only" checked={selectedAssetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} /><div className="aspect-square bg-slate-100 dark:bg-slate-900">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><Images className="h-5 w-5 text-muted-foreground" /></div>}</div><p className="mt-2 truncate text-xs">{asset.filename}</p></label>)}{(assets.data?.items ?? []).length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No ready image assets are available for ZIP export.</p>}</div>}<p className="mt-3 text-xs text-muted-foreground">{assets.data?.total && assets.data.total > 100 ? "The first 100 ready assets are shown. Use a focused project export or select up to 100 at a time." : `${selectedAssetIds.length} of 100 selected`}</p></section>
    </div>
  );
}

function RecordEditor({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const { recordId } = useParams<{ recordId: string }>();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: record, isLoading } = trpc.visualArchives.getRecord.useQuery({ projectId, recordId: recordId ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(recordId) });
  const { data: asset } = trpc.visualArchives.getAsset.useQuery({ projectId, assetId: record?.assetId ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(record?.assetId) });
  const neighbors = trpc.visualArchives.findVisualNeighbors.useQuery({ projectId, assetId: asset?.id ?? "00000000-0000-4000-8000-000000000000", limit: 12 }, { enabled: Boolean(asset?.id) });
  const { data: reviewSequence = [] } = trpc.visualArchives.listRecordIds.useQuery({ projectId, recordType: "image", limit: 500 });
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!record) return;
    setTitle(record.title);
    const reviewed = record.reviewedJson as Record<string, unknown>;
    setFields(Object.fromEntries(CATALOG_FIELDS.map(([key]) => [key, formatFieldValue(reviewed[key])])));
  }, [record?.id, record?.revision]);
  const update = trpc.visualArchives.updateRecord.useMutation({
    onSuccess: async () => { toast.success("Record saved"); await Promise.all([utils.visualArchives.getRecord.invalidate(), utils.visualArchives.listRecords.invalidate(), utils.visualArchives.listRecordsPage.invalidate(), utils.visualArchives.searchReviewedCatalog.invalidate(), utils.visualArchives.stats.invalidate({ projectId })]); },
    onError: error => toast.error(error.message),
  });
  const suggest = trpc.visualArchives.generateSuggestions.useMutation({
    onSuccess: async () => { toast.success("Suggestions ready for review"); await Promise.all([utils.visualArchives.getRecord.invalidate(), utils.visualArchives.listRecords.invalidate(), utils.visualArchives.listRecordsPage.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  const accept = trpc.visualArchives.acceptSuggestionFields.useMutation({
    onSuccess: async () => { toast.success("Suggestion accepted into reviewed data"); await Promise.all([utils.visualArchives.getRecord.invalidate(), utils.visualArchives.listRecords.invalidate(), utils.visualArchives.listRecordsPage.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  const reject = trpc.visualArchives.rejectSuggestionFields.useMutation({
    onSuccess: async () => { toast.success("Suggestion rejected and preserved in review provenance"); await Promise.all([utils.visualArchives.getRecord.invalidate(), utils.visualArchives.listRecords.invalidate(), utils.visualArchives.listRecordsPage.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
  if (!record) return <div className="text-sm text-muted-foreground">Record not found.</div>;
  const suggestions = record.aiSuggestedJson as Record<string, unknown>;
  const rejectedFields = new Set(
    Array.isArray((record.suggestionProvenance as Record<string, unknown> | null)?.rejectedFields)
      ? ((record.suggestionProvenance as Record<string, unknown>).rejectedFields as unknown[]).filter((field): field is string => typeof field === "string")
      : [],
  );
  const reviewableSuggestionFields = (["title", ...CATALOG_FIELDS.map(([key]) => key)] as string[])
    .filter(field => !rejectedFields.has(field) && suggestions[field] !== undefined && formatFieldValue(suggestions[field]) !== "");
  const reviewMutationBusy = accept.isPending || reject.isPending || update.isPending;
  const candidates = identificationCandidates(suggestions.identificationCandidates);
  const save = (status: "draft" | "needs_review" | "approved" | "archived" = "draft") => update.mutate({
    projectId,
    recordId: record.id,
    title,
    reviewedJson: Object.fromEntries(CATALOG_FIELDS.map(([key]) => [key, parseFieldValue(key, fields[key] ?? "")])),
    status,
    changeSummary: status === "approved" ? "Record approved" : status === "archived" ? "Record rejected from active review" : "Catalog fields updated",
  });
  const currentSequenceIndex = reviewSequence.findIndex(item => item.id === record.id);
  const previousRecordId = currentSequenceIndex > 0 ? reviewSequence[currentSequenceIndex - 1]?.id : undefined;
  const nextRecordId = currentSequenceIndex >= 0 ? reviewSequence[currentSequenceIndex + 1]?.id : undefined;
  const moveToRecord = (nextId: string | undefined) => {
    if (nextId) navigate(`/records/${nextId}`);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); moveToRecord(previousRecordId); }
      if (event.key === "ArrowRight") { event.preventDefault(); moveToRecord(nextRecordId); }
      if (canEdit && !reviewMutationBusy && event.key.toLowerCase() === "a") { event.preventDefault(); save("approved"); }
      if (canEdit && !reviewMutationBusy && event.key.toLowerCase() === "r") { event.preventDefault(); save("archived"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, nextRecordId, previousRecordId, reviewMutationBusy, record.id, title, fields]);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <button onClick={() => navigate("/catalog")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Catalog</button>
      <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex items-center gap-2"><Badge variant="outline" className="capitalize">{record.recordType}</Badge>{statusBadge(record.status)}<span className="text-xs text-muted-foreground">Revision {record.revision}</span></div><Input className="h-auto border-0 bg-transparent p-0 font-serif text-3xl font-semibold shadow-none focus-visible:ring-0" value={title} onChange={event => setTitle(event.target.value)} disabled={!canEdit || reviewMutationBusy} /></div><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => moveToRecord(previousRecordId)} disabled={!previousRecordId || reviewMutationBusy}>← Previous</Button><Button size="sm" variant="outline" onClick={() => moveToRecord(nextRecordId)} disabled={!nextRecordId || reviewMutationBusy}>Next →</Button>{canEdit && <><Button variant="outline" onClick={() => save()} disabled={reviewMutationBusy}><Save className="mr-2 h-4 w-4" />Save</Button><Button variant="outline" onClick={() => save("archived")} disabled={reviewMutationBusy}>Reject / archive</Button><Button onClick={() => save("approved")} disabled={reviewMutationBusy}><Check className="mr-2 h-4 w-4" />Approve</Button></>}</div></div>
      <p className="-mt-3 text-xs text-muted-foreground">Shortcuts outside a field: <kbd>←</kbd>/<kbd>→</kbd> previous/next · <kbd>A</kbd> approve · <kbd>R</kbd> reject/archive. Suggestions are saved one action at a time.</p>
      <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="space-y-4">{asset ? <div className="sticky top-24 border border-border bg-slate-100 dark:bg-slate-900"><img src={asset.displayUrl ?? asset.originalUrl} alt="" className="max-h-[70vh] w-full object-contain" /></div> : <div className="flex aspect-[4/3] items-center justify-center border border-dashed border-border text-sm text-muted-foreground">No image attached</div>}{asset && <section className="border-y border-border py-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Visual neighborhood</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Image-only similarity signals. They do not change catalog data, create links, or prove identity.</p>{neighbors.isLoading && <Loader2 className="mt-3 h-4 w-4 animate-spin text-primary" />}{neighbors.data?.unavailable && <p className="mt-3 text-xs text-muted-foreground">{neighbors.data.unavailable}</p>}{neighbors.data?.items.length ? <div className="mt-3 grid grid-cols-3 gap-2">{neighbors.data.items.map(item => <Link key={item.asset.id} href={item.record ? `/records/${item.record.id}` : "/assets"} className="group border border-border bg-card p-1 hover:border-primary/60"><div className="aspect-square bg-slate-100 dark:bg-slate-900">{item.asset.thumbnailUrl ? <img src={item.asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><Images className="h-3.5 w-3.5 text-muted-foreground" /></div>}</div><p className="mt-1 truncate text-[10px] font-medium capitalize group-hover:text-primary">{item.classification}</p><p className="text-[10px] text-muted-foreground">{Math.round(item.score * 100)}% visual signal</p></Link>)}</div> : neighbors.data && !neighbors.data.unavailable ? <p className="mt-3 text-xs text-muted-foreground">No close visual neighbors were found in this project.</p> : null}</section>}</aside>
        <section className="space-y-5">
          {reviewableSuggestionFields.length > 0 && canEdit && <div className="flex flex-wrap items-center justify-between gap-3 border-y border-primary/30 bg-primary/5 px-4 py-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">AI review batch</p><p className="mt-1 text-xs text-muted-foreground">Apply all {reviewableSuggestionFields.length} remaining suggested catalog fields in one revision, or review each field below.</p></div><Button size="sm" onClick={() => accept.mutate({ projectId, recordId: record.id, acceptedFields: reviewableSuggestionFields as Array<"title" | "description" | "workType" | "agents" | "dates" | "locations" | "subjects" | "culturalContext" | "materials" | "techniques" | "inscriptions" | "stylePeriod"> })} disabled={reviewMutationBusy}>{accept.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}Accept all remaining</Button></div>}
          {typeof suggestions.title === "string" && suggestions.title.trim() && (
            <div className="border-y border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Suggested catalog title</p><p className="mt-1 font-medium">{suggestions.title}</p>{rejectedFields.has("title") && <p className="mt-1 text-xs text-muted-foreground">Rejected for this suggestion round.</p>}</div>
                {canEdit && !rejectedFields.has("title") && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => accept.mutate({ projectId, recordId: record.id, acceptedFields: ["title"] })} disabled={reviewMutationBusy}><Check className="mr-1 h-3.5 w-3.5" /> Accept</Button><Button size="sm" variant="ghost" onClick={() => reject.mutate({ projectId, recordId: record.id, rejectedFields: ["title"] })} disabled={reviewMutationBusy}>Reject</Button></div>}
              </div>
            </div>
          )}
          {candidates.length > 0 && (
            <div className="border-y border-amber-500/30 bg-amber-500/5 px-4 py-4">
              <div className="mb-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800 dark:text-amber-300">Candidate identification</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">AI hypotheses only. Verify against authoritative sources before saving as catalog fact.</p></div>
              <div className="space-y-4">
                {candidates.map((candidate, index) => <article key={`${candidate.name}-${index}`} className="border-t border-amber-500/20 pt-3 first:border-t-0 first:pt-0"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{candidate.name}</p><p className="text-xs text-muted-foreground">{candidate.classification}{candidate.location ? ` · ${candidate.location}` : ""}</p></div><Badge variant="outline" className="capitalize">{candidate.confidence} confidence</Badge></div><p className="mt-2 text-sm leading-relaxed">{candidate.rationale}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Verify:</span> {candidate.verificationNote}</p>{canEdit && <Button size="sm" variant="ghost" className="mt-2 h-7 px-0 text-xs text-primary hover:bg-transparent hover:text-primary" onClick={() => setTitle(candidate.name)}>Use as title, then save</Button>}</article>)}
              </div>
            </div>
          )}
          {CATALOG_FIELDS.map(([key, label]) => {
            const suggestion = suggestions[key];
            const hasSuggestion = suggestion !== undefined && formatFieldValue(suggestion) !== "";
            const isRejected = rejectedFields.has(key);
            return <div key={key} className="border-b border-border pb-5"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor={key}>{label}</Label>{canEdit && hasSuggestion && !isRejected && <div className="flex gap-2"><Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => accept.mutate({ projectId, recordId: record.id, acceptedFields: [key] })} disabled={reviewMutationBusy}><Check className="mr-1 h-3 w-3" /> Accept</Button><Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => reject.mutate({ projectId, recordId: record.id, rejectedFields: [key] })} disabled={reviewMutationBusy}>Reject</Button></div>}</div>{key === "description" ? <Textarea id={key} rows={4} value={fields[key] ?? ""} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} disabled={!canEdit || reviewMutationBusy} /> : <Input id={key} value={fields[key] ?? ""} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} placeholder={ARRAY_FIELDS.has(key) ? "Comma-separated values" : undefined} disabled={!canEdit || reviewMutationBusy} />}{hasSuggestion && <div className="mt-2 bg-primary/5 px-3 py-2 text-xs leading-relaxed"><span className="font-semibold text-primary">AI suggestion:</span> {formatFieldValue(suggestion)}{isRejected && <span className="ml-2 text-muted-foreground">— rejected for this suggestion round</span>}</div>}</div>;
          })}
          {canEdit && asset && <div className="border-y border-border py-5"><div className="flex items-center justify-between gap-4"><div><div className="font-medium">Generate catalog suggestions</div><p className="text-xs text-muted-foreground">Gemini proposes detailed descriptions and clearly labeled identification candidates. Nothing enters reviewed data automatically.</p></div><Button variant="outline" onClick={() => suggest.mutate({ projectId, recordId: record.id })} disabled={suggest.isPending}>{suggest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Suggest fields</Button></div></div>}
        </section>
      </div>
    </div>
  );
}

function RelationshipsPage({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const [sourceRecordId, setSourceRecordId] = useState("");
  const [targetRecordId, setTargetRecordId] = useState("");
  const [relationType, setRelationType] = useState("imageOf");
  const utils = trpc.useUtils();
  const { data: relations, isLoading } = trpc.visualArchives.listRelations.useQuery({ projectId });
  const { data: records } = trpc.visualArchives.listRecords.useQuery({ projectId });
  const names = useMemo(() => new Map((records ?? []).map(record => [record.id, record.title])), [records]);
  const create = trpc.visualArchives.createRelation.useMutation({
    onSuccess: async () => {
      toast.success("Relationship created");
      setSourceRecordId("");
      setTargetRecordId("");
      await utils.visualArchives.listRelations.invalidate({ projectId });
    },
    onError: error => toast.error(error.message),
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Connections</p>
        <h1 className="font-serif text-3xl font-semibold">Relationships</h1>
        <p className="mt-2 text-sm text-muted-foreground">Approved links between Collections, Works, and Images.</p>
      </div>
      {canEdit && (
        <div className="grid gap-3 border-y border-border py-5 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Source record</Label>
            <select value={sourceRecordId} onChange={event => setSourceRecordId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Choose a record</option>
              {(records ?? []).map(record => <option key={record.id} value={record.id}>{record.title} ({record.recordType})</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Relationship</Label>
            <select value={relationType} onChange={event => setRelationType(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="imageOf">image of</option>
              <option value="partOf">part of</option>
              <option value="depicts">depicts</option>
              <option value="relatedTo">related to</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Target record</Label>
            <select value={targetRecordId} onChange={event => setTargetRecordId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Choose a record</option>
              {(records ?? []).filter(record => record.id !== sourceRecordId).map(record => <option key={record.id} value={record.id}>{record.title} ({record.recordType})</option>)}
            </select>
          </div>
          <Button onClick={() => create.mutate({ projectId, sourceRecordId, targetRecordId, relationType })} disabled={!sourceRecordId || !targetRecordId || create.isPending}>
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}Link
          </Button>
        </div>
      )}
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : (
        <div className="divide-y divide-border border-y border-border">
          {(relations ?? []).map(relation => (
            <div key={relation.id} className="grid gap-2 py-4 md:grid-cols-[1fr_auto_1fr]">
              <span className="font-medium">{names.get(relation.sourceRecordId) ?? "Unknown record"}</span>
              <Badge variant="outline">{relation.relationType}</Badge>
              <span className="font-medium md:text-right">{names.get(relation.targetRecordId) ?? "Unknown record"}</span>
            </div>
          ))}
          {(relations ?? []).length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No relationships yet.</div>}
        </div>
      )}
    </div>
  );
}

export default function VisualWorkspace({ projectId, project }: { projectId: number; project: VisualProject }) {
  const canEdit = project._memberRole !== "viewer";
  return (
    <VisualShell project={project}>
      <Switch>
        <Route path="/assets"><AssetsPage projectId={projectId} canEdit={canEdit} /></Route>
        <Route path="/catalog"><CatalogPage projectId={projectId} canEdit={canEdit} /></Route>
      <Route path="/search"><VisualSearchPage projectId={projectId} canEdit={canEdit} /></Route>
        <Route path="/ask"><VisualAskArchivePage projectId={projectId} /></Route>
        <Route path="/exports"><VisualExportsPage projectId={projectId} /></Route>
        <Route path="/records/:recordId"><RecordEditor projectId={projectId} canEdit={canEdit} /></Route>
        <Route path="/relationships"><RelationshipsPage projectId={projectId} canEdit={canEdit} /></Route>
        <Route><OverviewPage projectId={projectId} /></Route>
      </Switch>
    </VisualShell>
  );
}
