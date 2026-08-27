import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import {
  Archive, ArrowLeft, Check, ChevronRight, Download, FileImage, FolderKanban, ImagePlus,
  Images, LayoutDashboard, LibraryBig, Link2, Loader2, Menu, Plus, Save,
  MessageSquare, Search, Sparkles, Upload, X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildVisualCatalogCsv, buildVraCoreXml, downloadTextFile, type VisualCatalogExport } from "@/lib/visualExports";
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
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Approved</Badge>;
  if (status === "needs_review") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Needs review</Badge>;
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>;
  return <Badge variant="outline">Draft</Badge>;
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
          <Badge variant="outline" className="ml-auto hidden sm:inline-flex">Controlled beta</Badge>
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-64px)]">
        <aside className={`${mobileOpen ? "block" : "hidden"} w-full border-b border-slate-700 bg-[#1A1D23] p-3 text-slate-200 md:block md:w-64 md:border-b-0 md:border-r`}>
          <div className="mb-3 px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Catalog workspace</div>
          <nav className="grid grid-cols-2 gap-1 md:block">
            {navItems.map(item => {
              const active = item.href === "/" ? location === "/" : location.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`mb-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
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
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
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
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Visual Archives</p>
        <h1 className="font-serif text-3xl font-semibold md:text-4xl">Catalog visual culture with evidence intact.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Preserve original images, describe Collections, Works, and Images with VRA-aligned fields, and keep every AI suggestion reviewable.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(([label, value, Icon]) => (
          <div key={label} className="border-y border-border bg-card px-4 py-5">
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
        <aside className="border-y border-primary/30 bg-primary/5 px-5 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Review queue</p>
          <div className="mt-3 font-serif text-4xl font-semibold">{stats?.needsReview ?? 0}</div>
          <p className="mt-1 text-sm text-muted-foreground">records waiting for human review</p>
          <Link href="/catalog" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">Review catalog <ChevronRight className="h-4 w-4" /></Link>
        </aside>
      </div>
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
            result.autoCatalog.suggestionStatus === "generated"
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Ingestion</p><h1 className="font-serif text-3xl font-semibold">Visual assets</h1><p className="mt-2 text-sm text-muted-foreground">JPEG and PNG · 15 MB maximum · each upload creates an Image record and Gemini review draft automatically</p></div>
        {canEdit && <><input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={event => handleFiles(event.target.files)} /><Button onClick={() => inputRef.current?.click()} disabled={batch.running} className="gap-2">{batch.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{batch.running ? `Processing ${batch.completed}/${batch.total}` : "Upload images"}</Button></>}
      </div>
      {batch.total > 0 && <div className="border-y border-primary/30 bg-primary/5 px-4 py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{batch.running ? "Batch cataloging in progress" : "Batch cataloging complete"}</span><span className="text-muted-foreground">{batch.completed} of {batch.total} complete{batch.running ? ` · ${batch.active} active` : ""}{batch.failed > 0 ? ` · ${batch.failed} failed` : ""}</span></div><p className="mt-1 text-xs text-muted-foreground">Each image receives immutable derivatives, an Image record, and a separate Gemini draft. <strong>Keep this tab open and do not reload or navigate away until the batch finishes.</strong> TURATH retries temporary upload failures up to two times.</p>{failedFiles.length > 0 && <p className="mt-2 text-xs text-destructive">Failed: {failedFiles.slice(0, 6).join(", ")}{failedFiles.length > 6 ? ` and ${failedFiles.length - 6} more` : ""}. These can be uploaded again; completed images remain safely cataloged.</p>}</div>}
      {assetPageQuery.isLoading && assets.length === 0 ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {assets.map(asset => (
            <article key={asset.id} className="group border border-border bg-card">
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
          {assets.length === 0 && <div className="col-span-full border-y border-border py-20 text-center"><Images className="mx-auto mb-4 h-10 w-10 text-muted-foreground" /><p className="font-serif text-xl">No visual assets yet</p><p className="mt-1 text-sm text-muted-foreground">Upload a JPEG or PNG to begin the catalog.</p></div>}
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">VRA Core 4</p><h1 className="font-serif text-3xl font-semibold">Catalog</h1><p className="mt-2 text-sm text-muted-foreground">Collections contain Works; Images document Works. Approved catalog data stays distinct from AI suggestions.</p></div>{canEdit && <Button className="gap-2" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New record</Button>}</div>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {(["all", "collection", "work", "image"] as const).map(value => <button key={value} onClick={() => setFilter(value)} className={`px-3 py-2 text-sm capitalize ${filter === value ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}>{value}</button>)}
      </div>
      <div className="grid gap-3 border-y border-border py-3 md:grid-cols-[1fr_190px]">
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search catalog titles…" aria-label="Search catalog titles" />
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All review states</option><option value="needs_review">Needs review</option><option value="approved">Approved</option><option value="draft">Draft</option><option value="archived">Archived</option></select>
      </div>
      {canEdit && selectedCount > 0 && <div className="flex flex-wrap items-center gap-2 border-y border-primary/30 bg-primary/5 px-4 py-3"><span className="mr-2 text-sm font-medium">{selectedCount} selected</span><Button size="sm" variant="outline" onClick={() => bulkStatus.mutate({ projectId, recordIds: selectedRecordIds, status: "needs_review" })} disabled={bulkStatus.isPending}>Needs review</Button><Button size="sm" variant="outline" onClick={() => bulkStatus.mutate({ projectId, recordIds: selectedRecordIds, status: "approved" })} disabled={bulkStatus.isPending}>Approve</Button>{selectedImages.length > 0 && <Button size="sm" onClick={() => { setGroupingSuggestion(null); setShowGroup(true); }} disabled={groupExisting.isPending || createWorkAndGroup.isPending}>Organize {selectedImages.length} image{selectedImages.length === 1 ? "" : "s"} as a Work</Button>}<Button size="sm" variant="ghost" onClick={() => setSelectedRecordIds([])}>Clear</Button></div>}
      {catalogPage.isLoading && records.length === 0 ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <div className="divide-y divide-border border-y border-border">
        {records.map(record => <div key={record.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-4"><input type="checkbox" aria-label={`Select ${record.title}`} checked={selectedRecordIds.includes(record.id)} onChange={() => toggleSelection(record.id)} disabled={!canEdit} /><Link href={`/records/${record.id}`} className="min-w-0 hover:text-primary"><div className="truncate font-medium">{record.title}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="capitalize">{record.recordType}</span>{record.localIdentifier && <><span>·</span><span>{record.localIdentifier}</span></>}<span>·</span><span>rev. {record.revision}</span></div></Link><div className="flex items-center gap-3">{statusBadge(record.status)}<ChevronRight className="h-4 w-4" /></div></div>)}
        {records.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No {filter === "all" ? "catalog" : filter} records match these filters.</div>}
      </div>}
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

function VisualSearchPage({ projectId }: { projectId: number }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<Partial<Record<(typeof DISCOVERY_FACETS)[number], string[]>>>({});
  const search = trpc.visualArchives.searchReviewedCatalog.useQuery({ projectId, query, facets, limit: 48 });
  const toggleFacet = (field: (typeof DISCOVERY_FACETS)[number], value: string) => {
    setFacets(current => {
      const values = current[field] ?? [];
      const next = values.includes(value) ? values.filter(item => item !== value) : [...values, value];
      return { ...current, [field]: next };
    });
  };
  const clearFilters = () => { setFacets({}); setDraftQuery(""); setQuery(""); };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Discovery</p><h1 className="font-serif text-3xl font-semibold">Explore approved catalog evidence</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Search titles and human-reviewed metadata across this Visual Archive. AI drafts and unreviewed candidate identifications never appear here.</p></div>
      <form className="flex gap-2 border-y border-border py-4" onSubmit={event => { event.preventDefault(); setQuery(draftQuery.trim()); }}><Input value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder="Search places, subjects, materials, titles…" aria-label="Search approved visual catalog" /><Button type="submit"><Search className="mr-2 h-4 w-4" />Search</Button></form>
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="space-y-5 border-y border-border py-4 lg:border-y-0 lg:border-r lg:py-0 lg:pr-6"><div className="flex items-center justify-between"><h2 className="font-serif text-lg font-semibold">Refine</h2>{(query || Object.values(facets).some(values => values?.length)) && <Button size="sm" variant="ghost" className="h-7 px-0 text-xs" onClick={clearFilters}>Clear all</Button>}</div>{DISCOVERY_FACETS.map(field => { const options = search.data?.facets?.[field] ?? []; return options.length > 0 ? <div key={field}><p className="mb-2 text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">{DISCOVERY_FACET_LABELS[field]}</p><div className="space-y-1.5">{options.map(option => <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={(facets[field] ?? []).includes(option.value)} onChange={() => toggleFacet(field, option.value)} /><span className="min-w-0 flex-1 truncate">{option.value}</span><span className="text-xs text-muted-foreground">{option.count}</span></label>)}</div></div> : null; })}</aside>
        <section>{search.isLoading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <><div className="mb-3 flex items-center justify-between text-sm text-muted-foreground"><span>{search.data?.total ?? 0} approved record{(search.data?.total ?? 0) === 1 ? "" : "s"} found</span><span>up to 48 results</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(search.data?.items ?? []).map(record => <Link key={record.id} href={`/records/${record.id}`} className="group border border-border bg-card hover:border-primary/50"><div className="aspect-[4/3] bg-slate-100 dark:bg-slate-900">{record.asset?.thumbnailUrl ? <img src={record.asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><LibraryBig className="h-8 w-8 text-muted-foreground" /></div>}</div><div className="p-3"><div className="truncate font-medium group-hover:text-primary">{record.title}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="capitalize">{record.recordType}</span>{record.localIdentifier && <><span>·</span><span className="truncate">{record.localIdentifier}</span></>}</div></div></Link>)}{(search.data?.items ?? []).length === 0 && <div className="col-span-full border-y border-border py-16 text-center text-sm text-muted-foreground">No approved catalog records match this search. Review and approve records before they appear in Discover.</div>}</div></>}</section>
      </div>
    </div>
  );
}

type VisualChatSource = { index: number; recordId: string; title: string; recordType: string; excerpt: string; thumbnailUrl: string | null };
type VisualChatMessage = { role: "user" | "assistant"; content: string; sources?: VisualChatSource[] };

function VisualAskArchivePage({ projectId }: { projectId: number }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<VisualChatMessage[]>([]);
  const ask = trpc.visualArchives.askArchive.useMutation({
    onSuccess: result => setMessages(current => [...current, { role: "assistant", content: result.answer, sources: result.sources }]),
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Evidence-linked Q&A</p><h1 className="font-serif text-3xl font-semibold">Ask this Visual Archive</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Answers are grounded in human-approved VRA records and cite the exact Images, Works, or Collections used. AI drafts and unreviewed identifications are excluded.</p></div>
      <div className="min-h-[420px] border-y border-border py-5"><div className="space-y-6">{messages.length === 0 && <div className="py-24 text-center"><MessageSquare className="mx-auto mb-4 h-10 w-10 text-primary" /><p className="font-serif text-xl">Begin with a question grounded in the catalog</p><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">For example: “Which approved Images depict religious architecture?” or “What materials recur in this collection?”</p></div>}{messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-2xl bg-primary px-4 py-3 text-primary-foreground" : "max-w-4xl border-l-2 border-primary py-1 pl-4"}><p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] opacity-70">{message.role === "user" ? "You" : "TURATH"}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>{message.sources && message.sources.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{message.sources.map(source => <Link key={source.recordId} href={`/records/${source.recordId}`} className="grid grid-cols-[48px_1fr] gap-2 border border-border bg-background p-2 text-foreground hover:border-primary/50"><div className="flex h-12 w-12 items-center justify-center bg-slate-100 dark:bg-slate-900">{source.thumbnailUrl ? <img src={source.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <LibraryBig className="h-4 w-4 text-muted-foreground" />}</div><div className="min-w-0"><p className="truncate text-xs font-medium">[Record {source.index}] {source.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground capitalize">{source.recordType}</p></div></Link>)}</div>}</div>)}{ask.isPending && <div className="flex items-center gap-2 border-l-2 border-primary py-2 pl-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading approved visual evidence…</div>}</div></div>
      <div className="border border-border bg-card p-3"><Textarea value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(); }} placeholder="Ask a question about approved records in this Visual Archive…" rows={3} disabled={ask.isPending} /><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Use ⌘/Ctrl + Enter to send. Answers cite reviewed catalog evidence.</p><Button onClick={submit} disabled={!question.trim() || ask.isPending}>{ask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ask archive</Button></div></div>
    </div>
  );
}

function VisualExportsPage({ projectId }: { projectId: number }) {
  const [includeUnapproved, setIncludeUnapproved] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const assets = trpc.visualArchives.listAssetsPage.useQuery({ projectId, status: "ready", limit: 100 });
  const exportCatalog = trpc.visualArchives.exportCatalog.useQuery({ projectId, includeUnapproved }, { enabled: false });
  const getExport = async () => {
    const result = await exportCatalog.refetch();
    if (!result.data) throw new Error("The catalog export is unavailable");
    return result.data as unknown as VisualCatalogExport;
  };
  const exportText = async (format: "csv" | "json" | "xml") => {
    try {
      const data = await getExport();
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "csv") downloadTextFile(`turath-visual-catalog-${stamp}.csv`, buildVisualCatalogCsv(data), "text/csv;charset=utf-8");
      if (format === "json") downloadTextFile(`turath-visual-catalog-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      if (format === "xml") downloadTextFile(`turath-visual-catalog-${stamp}.xml`, buildVraCoreXml(data), "application/xml");
      toast.success(`${format.toUpperCase()} export prepared`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  };
  const toggleAsset = (assetId: string) => setSelectedAssetIds(current => current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId]);
  const downloadZip = () => {
    if (selectedAssetIds.length === 0) return;
    const query = new URLSearchParams({ assetIds: selectedAssetIds.join(",") });
    window.location.assign(`/api/storage/projects/${projectId}/visual-exports/selected.zip?${query.toString()}`);
  };
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Portability</p><h1 className="font-serif text-3xl font-semibold">Export approved visual evidence</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Exports exclude AI drafts by default and preserve record identifiers and reviewed relationships. Image files remain private until you deliberately request a selected-image ZIP.</p></div>
      <section className="border-y border-border py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-serif text-xl font-semibold">Catalog data</h2><p className="mt-1 text-sm text-muted-foreground">Download reviewed Collections, Works, Images, and their relationships.</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeUnapproved} onChange={event => setIncludeUnapproved(event.target.checked)} /> Include unapproved working records</label></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><button type="button" onClick={() => exportText("csv")} disabled={exportCatalog.isFetching} className="border border-border p-4 text-left hover:border-primary/50 disabled:opacity-60"><p className="font-medium">CSV</p><p className="mt-1 text-xs text-muted-foreground">Spreadsheet-ready catalog table</p></button><button type="button" onClick={() => exportText("json")} disabled={exportCatalog.isFetching} className="border border-border p-4 text-left hover:border-primary/50 disabled:opacity-60"><p className="font-medium">JSON</p><p className="mt-1 text-xs text-muted-foreground">Structured records and relationships</p></button><button type="button" onClick={() => exportText("xml")} disabled={exportCatalog.isFetching} className="border border-border p-4 text-left hover:border-primary/50 disabled:opacity-60"><p className="font-medium">VRA Core 4 XML</p><p className="mt-1 text-xs text-muted-foreground">Standards-oriented Work, Collection, and Image export</p></button></div>{exportCatalog.isFetching && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing reviewed catalog data…</p>}</section>
      <section className="border-y border-border py-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-serif text-xl font-semibold">Selected original images</h2><p className="mt-1 text-sm text-muted-foreground">Choose up to 100 ready images. The protected ZIP includes originals plus a manifest of file identifiers.</p></div><Button onClick={downloadZip} disabled={selectedAssetIds.length === 0 || selectedAssetIds.length > 100}><Download className="mr-2 h-4 w-4" />Download {selectedAssetIds.length || "selected"} as ZIP</Button></div>{assets.isLoading ? <Loader2 className="mt-5 h-5 w-5 animate-spin text-primary" /> : <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{(assets.data?.items ?? []).map(asset => <label key={asset.id} className={`cursor-pointer border p-2 ${selectedAssetIds.includes(asset.id) ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" className="sr-only" checked={selectedAssetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} /><div className="aspect-square bg-slate-100 dark:bg-slate-900">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><Images className="h-5 w-5 text-muted-foreground" /></div>}</div><p className="mt-2 truncate text-xs">{asset.filename}</p></label>)}{(assets.data?.items ?? []).length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No ready image assets are available for ZIP export.</p>}</div>}<p className="mt-3 text-xs text-muted-foreground">{assets.data?.total && assets.data.total > 100 ? "The first 100 ready assets are shown. Use a focused project export or select up to 100 at a time." : `${selectedAssetIds.length} of 100 selected`}</p></section>
    </div>
  );
}

function RecordEditor({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const { recordId } = useParams<{ recordId: string }>();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: record, isLoading } = trpc.visualArchives.getRecord.useQuery({ projectId, recordId: recordId ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(recordId) });
  const { data: asset } = trpc.visualArchives.getAsset.useQuery({ projectId, assetId: record?.assetId ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(record?.assetId) });
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
  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
  if (!record) return <div className="text-sm text-muted-foreground">Record not found.</div>;
  const suggestions = record.aiSuggestedJson as Record<string, unknown>;
  const candidates = identificationCandidates(suggestions.identificationCandidates);
  const save = (status: "draft" | "needs_review" | "approved" | "archived" = "draft") => update.mutate({
    projectId,
    recordId: record.id,
    title,
    reviewedJson: Object.fromEntries(CATALOG_FIELDS.map(([key]) => [key, parseFieldValue(key, fields[key] ?? "")])),
    status,
    changeSummary: status === "approved" ? "Record approved" : "Catalog fields updated",
  });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <button onClick={() => navigate("/catalog")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Catalog</button>
      <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex items-center gap-2"><Badge variant="outline" className="capitalize">{record.recordType}</Badge>{statusBadge(record.status)}<span className="text-xs text-muted-foreground">Revision {record.revision}</span></div><Input className="h-auto border-0 bg-transparent p-0 font-serif text-3xl font-semibold shadow-none focus-visible:ring-0" value={title} onChange={event => setTitle(event.target.value)} disabled={!canEdit} /></div>{canEdit && <div className="flex gap-2"><Button variant="outline" onClick={() => save()} disabled={update.isPending}><Save className="mr-2 h-4 w-4" />Save</Button><Button onClick={() => save("approved")} disabled={update.isPending}><Check className="mr-2 h-4 w-4" />Approve</Button></div>}</div>
      <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <aside>{asset ? <div className="sticky top-24 border border-border bg-slate-100 dark:bg-slate-900"><img src={asset.displayUrl ?? asset.originalUrl} alt="" className="max-h-[70vh] w-full object-contain" /></div> : <div className="flex aspect-[4/3] items-center justify-center border border-dashed border-border text-sm text-muted-foreground">No image attached</div>}</aside>
        <section className="space-y-5">
          {typeof suggestions.title === "string" && suggestions.title.trim() && (
            <div className="border-y border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Suggested catalog title</p><p className="mt-1 font-medium">{suggestions.title}</p></div>
                {canEdit && <Button size="sm" variant="outline" onClick={() => accept.mutate({ projectId, recordId: record.id, acceptedFields: ["title"] })}><Check className="mr-1 h-3.5 w-3.5" /> Accept title</Button>}
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
            return <div key={key} className="border-b border-border pb-5"><div className="mb-2 flex items-center justify-between"><Label htmlFor={key}>{label}</Label>{canEdit && suggestion !== undefined && formatFieldValue(suggestion) !== "" && <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => accept.mutate({ projectId, recordId: record.id, acceptedFields: [key] })}><Check className="mr-1 h-3 w-3" /> Accept suggestion</Button>}</div>{key === "description" ? <Textarea id={key} rows={4} value={fields[key] ?? ""} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} disabled={!canEdit} /> : <Input id={key} value={fields[key] ?? ""} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} placeholder={ARRAY_FIELDS.has(key) ? "Comma-separated values" : undefined} disabled={!canEdit} />}{suggestion !== undefined && formatFieldValue(suggestion) !== "" && <div className="mt-2 bg-primary/5 px-3 py-2 text-xs leading-relaxed"><span className="font-semibold text-primary">AI suggestion:</span> {formatFieldValue(suggestion)}</div>}</div>;
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
        <Route path="/search"><VisualSearchPage projectId={projectId} /></Route>
        <Route path="/ask"><VisualAskArchivePage projectId={projectId} /></Route>
        <Route path="/exports"><VisualExportsPage projectId={projectId} /></Route>
        <Route path="/records/:recordId"><RecordEditor projectId={projectId} canEdit={canEdit} /></Route>
        <Route path="/relationships"><RelationshipsPage projectId={projectId} canEdit={canEdit} /></Route>
        <Route><OverviewPage projectId={projectId} /></Route>
      </Switch>
    </VisualShell>
  );
}
