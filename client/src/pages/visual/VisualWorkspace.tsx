import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import {
  Archive, ArrowLeft, Check, ChevronRight, FileImage, FolderKanban, ImagePlus,
  Images, LayoutDashboard, LibraryBig, Link2, Loader2, Menu, Plus, Save,
  Sparkles, Upload, X,
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

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assets", label: "Visual assets", icon: Images },
  { href: "/catalog", label: "VRA catalog", icon: LibraryBig },
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
          <Link href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Projects
          </Link>
          <div className="h-5 w-px bg-border" />
          <div className="min-w-0">
            <div className="truncate font-serif font-semibold">{project.name}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-primary">Visual archive · VRA Core</div>
          </div>
          <Badge variant="outline" className="ml-auto hidden sm:inline-flex">Controlled MVP</Badge>
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
  const [uploading, setUploading] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const { data: assets, isLoading } = trpc.visualArchives.listAssets.useQuery({ projectId });
  const upload = trpc.visualArchives.uploadAsset.useMutation();
  const createRecord = trpc.visualArchives.createRecord.useMutation({
    onSuccess: () => {
      toast.success("Image record created");
      utils.visualArchives.listRecords.invalidate({ projectId });
      utils.visualArchives.stats.invalidate({ projectId });
    },
    onError: error => toast.error(error.message),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!["image/jpeg", "image/png"].includes(file.type)) {
        toast.error(`${file.name}: only JPEG and PNG are supported`);
        continue;
      }
      if (file.size > 15 * 1024 * 1024) {
        toast.error(`${file.name}: file must be 15 MB or smaller`);
        continue;
      }
      try {
        setUploading(file.name);
        await upload.mutateAsync({
          projectId,
          filename: file.name,
          mimeType: file.type as "image/jpeg" | "image/png",
          fileBase64: await fileToBase64(file),
        });
        toast.success(`${file.name} uploaded`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not upload ${file.name}`);
      }
    }
    setUploading(null);
    await Promise.all([
      utils.visualArchives.listAssets.invalidate({ projectId }),
      utils.visualArchives.stats.invalidate({ projectId }),
    ]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Ingestion</p><h1 className="font-serif text-3xl font-semibold">Visual assets</h1><p className="mt-2 text-sm text-muted-foreground">JPEG and PNG · 15 MB maximum · immutable original plus display derivatives</p></div>
        {canEdit && <><input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={event => handleFiles(event.target.files)} /><Button onClick={() => inputRef.current?.click()} disabled={!!uploading} className="gap-2">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{uploading ? `Uploading ${uploading}` : "Upload images"}</Button></>}
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {(assets ?? []).map(asset => (
            <article key={asset.id} className="group border border-border bg-card">
              <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-900">
                {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><ImagePlus className="h-8 w-8 text-muted-foreground" /></div>}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium" title={asset.filename}>{asset.filename}</div>
                <div className="mt-1 text-xs text-muted-foreground">{asset.width} × {asset.height} · {(asset.byteSize / 1024 / 1024).toFixed(1)} MB</div>
                <div className="mt-3 flex items-center justify-between">
                  <Badge variant={asset.status === "ready" ? "outline" : "secondary"}>{asset.status}</Badge>
                  {canEdit && asset.status === "ready" && <Button size="sm" variant="ghost" onClick={() => createRecord.mutate({ projectId, recordType: "image", title: asset.filename.replace(/\.[^.]+$/, ""), assetId: asset.id, reviewedJson: {} })}>Create record</Button>}
                </div>
              </div>
            </article>
          ))}
          {(assets ?? []).length === 0 && <div className="col-span-full border-y border-border py-20 text-center"><Images className="mx-auto mb-4 h-10 w-10 text-muted-foreground" /><p className="font-serif text-xl">No visual assets yet</p><p className="mt-1 text-sm text-muted-foreground">Upload a JPEG or PNG to begin the catalog.</p></div>}
        </div>
      )}
    </div>
  );
}

function CatalogPage({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const [recordType, setRecordType] = useState<"collection" | "work" | "image">("work");
  const [title, setTitle] = useState("");
  const [localIdentifier, setLocalIdentifier] = useState("");
  const [assetId, setAssetId] = useState("");
  const [filter, setFilter] = useState<"all" | "collection" | "work" | "image">("all");
  const utils = trpc.useUtils();
  const { data: records, isLoading } = trpc.visualArchives.listRecords.useQuery({ projectId, recordType: filter === "all" ? undefined : filter });
  const { data: assets } = trpc.visualArchives.listAssets.useQuery({ projectId });
  const create = trpc.visualArchives.createRecord.useMutation({
    onSuccess: async () => {
      toast.success("Catalog record created"); setShowCreate(false); setTitle(""); setLocalIdentifier(""); setAssetId("");
      await Promise.all([utils.visualArchives.listRecords.invalidate(), utils.visualArchives.stats.invalidate({ projectId })]);
    },
    onError: error => toast.error(error.message),
  });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">VRA Core 4</p><h1 className="font-serif text-3xl font-semibold">Catalog</h1><p className="mt-2 text-sm text-muted-foreground">Collections contain Works; Images document Works. Approved catalog data stays distinct from AI suggestions.</p></div>{canEdit && <Button className="gap-2" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New record</Button>}</div>
      <div className="flex gap-1 border-b border-border">
        {(["all", "collection", "work", "image"] as const).map(value => <button key={value} onClick={() => setFilter(value)} className={`px-3 py-2 text-sm capitalize ${filter === value ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}>{value}</button>)}
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <div className="divide-y divide-border border-y border-border">
        {(records ?? []).map(record => <Link key={record.id} href={`/records/${record.id}`} className="grid grid-cols-[1fr_auto] items-center gap-4 py-4 hover:text-primary"><div className="min-w-0"><div className="truncate font-medium">{record.title}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="capitalize">{record.recordType}</span>{record.localIdentifier && <><span>·</span><span>{record.localIdentifier}</span></>}<span>·</span><span>rev. {record.revision}</span></div></div><div className="flex items-center gap-3">{statusBadge(record.status)}<ChevronRight className="h-4 w-4" /></div></Link>)}
        {(records ?? []).length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No {filter === "all" ? "catalog" : filter} records yet.</div>}
      </div>}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent><DialogHeader><DialogTitle className="font-serif">Create VRA record</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="space-y-1.5"><Label>Record type</Label><select value={recordType} onChange={event => setRecordType(event.target.value as typeof recordType)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="collection">Collection</option><option value="work">Work</option><option value="image">Image</option></select></div><div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={event => setTitle(event.target.value)} placeholder="Untitled photograph, architectural work, collection..." /></div><div className="space-y-1.5"><Label>Local identifier</Label><Input value={localIdentifier} onChange={event => setLocalIdentifier(event.target.value)} placeholder="Optional accession or local ID" /></div>{recordType === "image" && <div className="space-y-1.5"><Label>Visual asset</Label><select value={assetId} onChange={event => setAssetId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">No asset attached</option>{(assets ?? []).filter(item => item.status === "ready").map(item => <option key={item.id} value={item.id}>{item.filename}</option>)}</select></div>}</div><DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={() => create.mutate({ projectId, recordType, title, localIdentifier: localIdentifier || undefined, assetId: assetId || undefined, reviewedJson: {} })} disabled={!title.trim() || create.isPending}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create record</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function RecordEditor({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const { recordId } = useParams<{ recordId: string }>();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: records, isLoading } = trpc.visualArchives.listRecords.useQuery({ projectId });
  const record = records?.find(item => item.id === recordId);
  const { data: assets } = trpc.visualArchives.listAssets.useQuery({ projectId });
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!record) return;
    setTitle(record.title);
    const reviewed = record.reviewedJson as Record<string, unknown>;
    setFields(Object.fromEntries(CATALOG_FIELDS.map(([key]) => [key, formatFieldValue(reviewed[key])])));
  }, [record?.id, record?.revision]);
  const update = trpc.visualArchives.updateRecord.useMutation({
    onSuccess: async () => { toast.success("Record saved"); await Promise.all([utils.visualArchives.listRecords.invalidate(), utils.visualArchives.stats.invalidate({ projectId })]); },
    onError: error => toast.error(error.message),
  });
  const suggest = trpc.visualArchives.generateSuggestions.useMutation({
    onSuccess: async () => { toast.success("Suggestions ready for review"); await utils.visualArchives.listRecords.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const accept = trpc.visualArchives.acceptSuggestionFields.useMutation({
    onSuccess: async () => { toast.success("Suggestion accepted into reviewed data"); await utils.visualArchives.listRecords.invalidate(); },
    onError: error => toast.error(error.message),
  });
  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
  if (!record) return <div className="text-sm text-muted-foreground">Record not found.</div>;
  const suggestions = record.aiSuggestedJson as Record<string, unknown>;
  const asset = record.assetId ? assets?.find(item => item.id === record.assetId) : undefined;
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
          {CATALOG_FIELDS.map(([key, label]) => {
            const suggestion = suggestions[key];
            return <div key={key} className="border-b border-border pb-5"><div className="mb-2 flex items-center justify-between"><Label htmlFor={key}>{label}</Label>{canEdit && suggestion !== undefined && formatFieldValue(suggestion) !== "" && <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => accept.mutate({ projectId, recordId: record.id, acceptedFields: [key] })}><Check className="mr-1 h-3 w-3" /> Accept suggestion</Button>}</div>{key === "description" ? <Textarea id={key} rows={4} value={fields[key] ?? ""} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} disabled={!canEdit} /> : <Input id={key} value={fields[key] ?? ""} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} placeholder={ARRAY_FIELDS.has(key) ? "Comma-separated values" : undefined} disabled={!canEdit} />}{suggestion !== undefined && formatFieldValue(suggestion) !== "" && <div className="mt-2 bg-primary/5 px-3 py-2 text-xs leading-relaxed"><span className="font-semibold text-primary">AI suggestion:</span> {formatFieldValue(suggestion)}</div>}</div>;
          })}
          {canEdit && asset && <div className="border-y border-border py-5"><div className="flex items-center justify-between gap-4"><div><div className="font-medium">Generate catalog suggestions</div><p className="text-xs text-muted-foreground">Gemini analyzes visible evidence only. Nothing enters reviewed data automatically.</p></div><Button variant="outline" onClick={() => suggest.mutate({ projectId, recordId: record.id })} disabled={suggest.isPending}>{suggest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Suggest fields</Button></div></div>}
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
        <Route path="/records/:recordId"><RecordEditor projectId={projectId} canEdit={canEdit} /></Route>
        <Route path="/relationships"><RelationshipsPage projectId={projectId} canEdit={canEdit} /></Route>
        <Route><OverviewPage projectId={projectId} /></Route>
      </Switch>
    </VisualShell>
  );
}
