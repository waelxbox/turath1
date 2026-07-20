import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import type { Project } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  CheckCircle2, Flag, ChevronLeft, ChevronRight, Loader2,
  Eye, Filter, Zap, AlertCircle, ImageOff, RotateCcw,
  MoreVertical, Trash2, Pencil, Search, Layers,
  Minus, Plus, Maximize2, X, RotateCw, PanelLeftClose, PanelLeftOpen, Info,
  FileText, Sparkles, CheckSquare, Square, FolderPlus, Unlink, ShieldCheck
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";

interface Props {
  projectId: number;
  project: Project;
  docId?: string;
}

type SchemaField = {
  type: "string" | "boolean" | "array" | "number" | "object";
  description?: string;
  nullable?: boolean;
  displayHint?: "short_text" | "long_text" | "tag_list";
  properties?: Record<string, SchemaField>;
  items?: { type: string };
};

/* ─── Status indicator ─────────────────────────────────────────────────── */
function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-zinc-400",
    processing: "bg-amber-400 animate-pulse",
    needs_review: "bg-yellow-400",
    reviewed: "bg-emerald-400",
    flagged: "bg-orange-400",
    error: "bg-red-400",
  };
  const labels: Record<string, string> = {
    pending: "Pending",
    processing: "Processing",
    needs_review: "Needs review",
    reviewed: "Approved",
    flagged: "Flagged",
    error: "Error",
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[status] || "bg-zinc-400"}`} />
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {labels[status] || status}
      </TooltipContent>
    </Tooltip>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "status-pending" },
    processing: { label: "Processing", cls: "status-processing" },
    needs_review: { label: "Needs review", cls: "status-needs-review" },
    reviewed: { label: "Approved", cls: "status-reviewed" },
    flagged: { label: "Flagged", cls: "status-flagged" },
    error: { label: "Error", cls: "status-error" },
  };
  const info = map[status] ?? { label: status, cls: "" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${info.cls}`}>
      {info.label}
    </span>
  );
}

/* ─── Retry All Button ─────────────────────────────────────────────────── */
function RetryAllButton({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [isRunning, setIsRunning] = useState(false);
  const [totalQueued, setTotalQueued] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: stats } = trpc.projects.stats.useQuery(
    { id: projectId },
    { refetchInterval: isRunning ? 4000 : false }
  );

  useEffect(() => {
    if (isRunning && stats && stats.pending === 0 && stats.processing === 0) {
      setIsRunning(false);
      setTotalQueued(0);
      toast.success("All documents transcribed!");
      utils.documents.listPaginated.invalidate();
    }
  }, [isRunning, stats, utils]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const retryAll = trpc.documents.retryAllPending.useMutation({
    onSuccess: (data) => {
      if (data.queued === 0) {
        toast.info("No pending documents to retry.");
      } else {
        setTotalQueued(data.queued);
        setIsRunning(true);
        toast.success(`Started transcribing ${data.queued} document(s)`);
        intervalRef.current = setInterval(() => {
          utils.documents.listPaginated.invalidate();
        }, 6000);
        setTimeout(() => {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }, 300000);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const pendingCount = stats?.pending ?? 0;
  const processingCount = stats?.processing ?? 0;
  const remainingCount = pendingCount + processingCount;

  if (isRunning) {
    const completed = totalQueued - remainingCount;
    const pct = totalQueued > 0 ? Math.round((completed / totalQueued) * 100) : 0;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-xs">
        <Loader2 className="w-3 h-3 animate-spin text-primary" />
        <span className="text-muted-foreground whitespace-nowrap">
          {completed}/{totalQueued} done
        </span>
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (pendingCount === 0 && processingCount === 0) return null;

  return (
    <button
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-primary/5 hover:bg-primary/10 border border-primary/10 text-xs text-primary transition-colors"
      title={`Transcribe ${pendingCount} pending document(s)`}
      onClick={() => retryAll.mutate({ projectId })}
      disabled={retryAll.isPending}
    >
      {retryAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      <span>Transcribe {pendingCount} pending</span>
    </button>
  );
}

/* ─── Schema helpers ───────────────────────────────────────────────────── */
function flattenSchema(
  schema: Record<string, SchemaField>,
  prefix = ""
): Array<{ key: string; label: string; def: SchemaField }> {
  const result: Array<{ key: string; label: string; def: SchemaField }> = [];
  for (const [k, def] of Object.entries(schema)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const label = key.replace(/_/g, " ").replace(/\./g, " › ");
    if (def.type === "object" && def.properties) {
      result.push(...flattenSchema(def.properties, key));
    } else {
      result.push({ key, label, def });
    }
  }
  return result;
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  if (parts.length === 1) return { ...obj, [key]: value };
  const [head, ...rest] = parts;
  const nested = (obj[head] ?? {}) as Record<string, unknown>;
  return { ...obj, [head]: setNestedValue(nested, rest.join("."), value) };
}

/* ─── Per-page field detection ─────────────────────────────────────────── */
const PER_PAGE_FIELDS = new Set([
  "transcription", "full_arabic_transcription", "original_transcription",
  "english_translation", "full_english_translation", "translation",
  "summary", "notes", "description", "marginalia",
  "page_number", "section_of_act",
  "persons_mentioned", "keywords", "legal_references",
  "financial_amounts", "property_boundaries",
  "locations_mentioned", "institutions_mentioned",
  "mentioned_entities", "stamp_markings", "keywords_items",
  "registry_stamps", "registry_reference",
]);

function isPerPageField(key: string): boolean {
  const base = key.split(".")[0].toLowerCase();
  return PER_PAGE_FIELDS.has(base) || base.includes("transcription") || base.includes("translation");
}

/* ─── Entity helpers ───────────────────────────────────────────────────── */
type DocEntity = { id: number; name: string; type: "person" | "location" | "organization"; contextSnippet: string | null };

function EntityTag({ entity, projectId }: { entity: DocEntity; projectId?: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const colors: Record<string, string> = {
    person: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    location: "bg-green-500/15 text-green-300 border-green-500/30",
    organization: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  };
  const typeLabels: Record<string, string> = { person: "Person", location: "Place", organization: "Organization" };
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (projectId) {
      window.location.href = `/projects/${projectId}/entities#entity=${entity.id}`;
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className={`inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-mono border cursor-pointer hover:scale-105 transition-transform ${colors[entity.type] || "bg-muted text-muted-foreground border-border"}`}
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        #{entity.id}
      </button>
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg bg-popover border border-border shadow-lg text-[11px] whitespace-nowrap z-50 pointer-events-none">
          <span className="font-medium text-foreground">{entity.name}</span>
          <span className="text-muted-foreground ml-1">({typeLabels[entity.type] || entity.type})</span>
        </div>
      )}
    </span>
  );
}

function FieldEntityAnnotations({ value, entities, projectId }: { value: unknown; entities?: DocEntity[]; projectId?: number }) {
  if (!entities || entities.length === 0 || typeof value !== "string" || !value.trim()) return null;
  
  const normalizedVal = value.toLowerCase().trim();
  const matches = entities.filter(e => {
    const normalizedName = e.name.toLowerCase().trim();
    if (normalizedVal.length < 3 || normalizedName.length < 3) return false;
    return normalizedVal.includes(normalizedName) || normalizedName.includes(normalizedVal);
  });

  if (matches.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-0.5 flex-wrap">
      {matches.slice(0, 5).map(e => <EntityTag key={e.id} entity={e} projectId={projectId} />)}
    </span>
  );
}

/* ─── Field components ─────────────────────────────────────────────────── */
function FieldLabel({ label, description }: { label: string; description?: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">{label}</span>
      {description && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="w-3 h-3 text-muted-foreground/40 cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[250px] text-xs">
            {description}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function DynamicField({
  fieldKey,
  label,
  fieldDef,
  value,
  onChange,
  entities,
  projectId,
}: {
  fieldKey: string;
  label: string;
  fieldDef: SchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
  entities?: DocEntity[];
  projectId?: number;
}) {
  if (fieldDef.type === "boolean") {
    return (
      <div className="flex items-center justify-between py-2 px-1">
        <FieldLabel label={label} description={fieldDef.description} />
        <Switch checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    );
  }

  if (fieldDef.type === "array" || fieldDef.displayHint === "tag_list") {
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    const [tagInput, setTagInput] = useState("");
    
    const getEntityForTag = (tag: unknown): DocEntity | undefined => {
      if (typeof tag !== "string" || !entities || entities.length === 0) return undefined;
      const normalizedTag = tag.toLowerCase().trim();
      return entities.find(e => {
        const normalizedName = e.name.toLowerCase().trim();
        return normalizedName === normalizedTag || normalizedName.includes(normalizedTag) || normalizedTag.includes(normalizedName);
      });
    };

    return (
      <div className="py-2 px-1">
        <FieldLabel label={label} description={fieldDef.description} />
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
          {arr.map((tag, i) => {
            const matchedEntity = getEntityForTag(tag);
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs"
              >
                {String(tag)}{matchedEntity && <EntityTag entity={matchedEntity} projectId={projectId} />}
                <button
                  type="button"
                  className="ml-0.5 hover:text-destructive transition-colors"
                  onClick={() => onChange(arr.filter((_, j) => j !== i))}
                >×</button>
              </span>
            );
          })}
          {arr.length === 0 && <span className="text-xs text-muted-foreground/50 italic">No items</span>}
        </div>
        <Input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && tagInput.trim()) {
              e.preventDefault();
              onChange([...arr, tagInput.trim()]);
              setTagInput("");
            }
          }}
          placeholder="Type and press Enter to add"
          className="bg-transparent border-transparent hover:border-border/50 focus:border-primary/30 focus:bg-card/50 text-sm h-9 transition-all rounded-lg"
        />
      </div>
    );
  }

  const strVal = String(value ?? "");
  const isLong = fieldDef.displayHint === "long_text" || strVal.length > 120;

  if (isLong) {
    return (
      <div className="py-2 px-1">
        <FieldLabel label={label} description={fieldDef.description} />
        <Textarea
          value={strVal}
          onChange={e => onChange(e.target.value)}
          className="bg-transparent border-transparent hover:border-border/50 focus:border-primary/30 focus:bg-card/50 text-sm text-foreground font-normal resize-none transition-all rounded-lg leading-relaxed"
          rows={4}
        />
        <FieldEntityAnnotations value={value} entities={entities} projectId={projectId} />
      </div>
    );
  }

  return (
    <div className="py-2 px-1">
      <FieldLabel label={label} description={fieldDef.description} />
      <div className="flex items-center gap-2">
        <Input
          value={strVal}
          onChange={e => onChange(e.target.value)}
          className="bg-transparent border-transparent hover:border-border/50 focus:border-primary/30 focus:bg-card/50 text-sm text-foreground font-normal flex-1 transition-all rounded-lg h-9"
        />
        <FieldEntityAnnotations value={value} entities={entities} projectId={projectId} />
      </div>
    </div>
  );
}

/* ─── ReviewDocPanel ───────────────────────────────────────────────────── */
function ReviewDocPanel({
  projectId,
  project,
  currentDocId,
  documents,
  currentIndex,
  onNavigate,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  projectId: number;
  project: Project;
  currentDocId: number;
  documents: Array<{ id: number; filename: string; status: string; errorMessage?: string | null; groupId?: number | null; pageNumber?: number | null }>;
  currentIndex: number;
  onNavigate: (docId: number) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [editedFields, setEditedFields] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isBatchTranscribing, setIsBatchTranscribing] = useState(false);
  const [activePageDocId, setActivePageDocId] = useState(currentDocId);
  // Image viewer state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const utils = trpc.useUtils();

  // Image viewer handlers
  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 6));
  const handleZoomOut = () => {
    const nz = Math.max(zoom - 0.5, 1);
    setZoom(nz);
    if (nz === 1) setPan({ x: 0, y: 0 });
  };
  const handleResetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  const handleImgMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleImgMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  };
  const handleImgMouseUp = () => { dragging.current = false; };
  const handleImgWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    const nz = Math.max(1, Math.min(6, zoom + delta));
    setZoom(nz);
    if (nz === 1) setPan({ x: 0, y: 0 });
  };

  // Reset image viewer when doc changes
  useEffect(() => {
    setZoom(1); setPan({ x: 0, y: 0 }); setRotation(0);
  }, [currentDocId]);

  // Detect if this document belongs to a group
  const currentDoc = documents.find(d => d.id === currentDocId);
  const groupId = (currentDoc as any)?.groupId as number | null | undefined;

  // Fetch group pages if this doc is part of a group
  const { data: groupData } = trpc.groups.getById.useQuery(
    { groupId: groupId!, projectId },
    { enabled: !!groupId }
  );

  const groupPages = groupData?.pages ?? [];
  const isMultiPage = !!groupId && groupPages.length > 1;
  const activePageDoc = isMultiPage ? groupPages.find((p: any) => p.id === activePageDocId) : null;
  const effectiveDocId = isMultiPage ? activePageDocId : currentDocId;

  // Reset active page and clear check AI results when switching documents
  useEffect(() => {
    setActivePageDocId(currentDocId);
    setCheckAiResult(null);
  }, [currentDocId]);

  const { data: transcription, refetch: refetchTranscription, isLoading: transcriptionLoading } =
    trpc.transcriptions.getByDocument.useQuery(
      { documentId: effectiveDocId, projectId },
      { enabled: true }
    );

  const { data: imageData, isLoading: imageLoading } = trpc.documents.getImageUrl.useQuery(
    { documentId: effectiveDocId, projectId },
    { staleTime: 4 * 60 * 1000 }
  );

  // Fetch entities linked to this document for inline annotations
  const { data: docEntities } = trpc.entities.byDocument.useQuery(
    { documentId: effectiveDocId, projectId },
    { enabled: !!transcription }
  );

  const batchTranscribe = trpc.groups.batchTranscribeAll.useMutation();

  const transcribeDoc = trpc.documents.transcribe.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success("Transcription complete");
        await refetchTranscription();
        utils.documents.list.invalidate({ projectId });
        utils.projects.stats.invalidate({ id: projectId });
      } else {
        toast.error(`Transcription failed: ${result.error}`);
      }
      setIsTranscribing(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setIsTranscribing(false);
    },
  });

  const saveReview = trpc.transcriptions.saveReview.useMutation({
    onSuccess: (_, variables) => {
      if (variables.status === "reviewed") {
        toast.success("Approved — now available in Search, Ask Archive, and Entities");
      } else {
        toast.success("Flagged for later review");
      }
      utils.documents.list.invalidate({ projectId });
      utils.projects.stats.invalidate({ id: projectId });
      utils.documents.listPaginated.invalidate();
      // Auto-advance to next document
      if (currentIndex < documents.length - 1) {
        onNavigate(documents[currentIndex + 1].id);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Cross-model verification ("Check AI")
  type CrossCheckResult = {
    overallAssessment: "accurate" | "minor_issues" | "significant_issues";
    confidenceScore: number;
    corrections: Array<{ field: string; original: string; suggested: string; severity: "low" | "medium" | "high"; reason: string }>;
    summary: string;
    modelUsed: string;
  };
  const [checkAiResult, setCheckAiResult] = useState<CrossCheckResult | null>(null);
  const [isCheckingAi, setIsCheckingAi] = useState(false);
  const checkAi = trpc.documents.crossCheck.useMutation({
    onMutate: () => setIsCheckingAi(true),
    onSuccess: (data: { success: boolean; result?: CrossCheckResult; error?: string }) => {
      setIsCheckingAi(false);
      if (data.success && data.result) {
        setCheckAiResult(data.result);
      } else {
        toast.error(data.error || "Cross-check failed");
      }
    },
    onError: (err: { message: string }) => {
      setIsCheckingAi(false);
      toast.error(err.message || "Cross-check failed");
    },
  });

  const schema = project.jsonSchema as Record<string, SchemaField> | null;
  const flatFields = schema ? flattenSchema(schema) : null;
  const rawData = (transcription?.reviewedJson ?? transcription?.rawJson) as Record<string, unknown> | null;

  // Populate editedFields once transcription loads — only once per mount (docId change re-mounts)
  useEffect(() => {
    if (rawData && Object.keys(editedFields).length === 0) {
      setEditedFields({ ...rawData });
    }
  }, [rawData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async (status: "reviewed" | "flagged") => {
    if (!transcription) return;
    setIsSaving(true);
    try {
      await saveReview.mutateAsync({
        transcriptionId: transcription.id,
        documentId: currentDocId,
        projectId,
        reviewedJson: editedFields,
        status,
      });
    } finally {
      setIsSaving(false);
    }
  }, [transcription, currentDocId, projectId, editedFields, saveReview]);

  const handleTranscribe = useCallback(async () => {
    setIsTranscribing(true);
    await transcribeDoc.mutateAsync({ documentId: currentDocId, projectId });
  }, [currentDocId, projectId, transcribeDoc]);

  // Keyboard shortcut: Cmd/Ctrl+Enter to save & approve
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && transcription && !isSaving) {
        e.preventDefault();
        handleSave('reviewed');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [transcription, isSaving, handleSave]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Minimal top bar — navigation + filename */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/50 flex-shrink-0 bg-card/20">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg hover:bg-secondary/80 text-muted-foreground/70 hover:text-foreground transition-colors"
            title={sidebarCollapsed ? "Show document list" : "Hide document list"}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-lg"
              disabled={currentIndex <= 0}
              onClick={() => documents[currentIndex - 1] && onNavigate(documents[currentIndex - 1].id)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground/70 tabular-nums">{currentIndex + 1} / {documents.length}</span>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-lg"
              disabled={currentIndex >= documents.length - 1}
              onClick={() => documents[currentIndex + 1] && onNavigate(documents[currentIndex + 1].id)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="h-4 w-px bg-border/40" />
          
          <span className="text-sm font-medium truncate max-w-[240px] text-foreground/90">{currentDoc?.filename}</span>
          {currentDoc && <StatusBadge status={currentDoc.status} />}
          {isMultiPage && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/8 text-primary text-[10px] font-medium">
              <Layers className="w-3 h-3" />
              {groupData?.title || "Multi-page"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentDoc && transcription && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground/70 hover:text-foreground rounded-lg text-xs"
              onClick={() => checkAi.mutate({ documentId: effectiveDocId, projectId })}
              disabled={isCheckingAi || isSaving || isTranscribing}
              title="Verify transcription with a different AI model"
            >
              {isCheckingAi
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ShieldCheck className="w-3.5 h-3.5" />}
              {isCheckingAi ? "Checking…" : "Check AI"}
            </Button>
          )}
          {currentDoc && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground/70 hover:text-foreground rounded-lg text-xs"
              onClick={handleTranscribe}
              disabled={isTranscribing || isSaving}
              title="Ask the AI to re-read this document from scratch"
            >
              {isTranscribing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RotateCcw className="w-3.5 h-3.5" />}
              {isTranscribing ? "Reading…" : "Re-read"}
            </Button>
          )}
        </div>
      </div>

      {/* Page flipper for multi-page documents */}
      {isMultiPage && groupPages.length > 0 && (
        <div className="flex items-center gap-1.5 px-5 py-2 border-b border-border/40 bg-card/10 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground/60 mr-2">Pages</span>
          {groupPages.map((page: any) => (
            <button
              key={page.id}
              onClick={() => setActivePageDocId(page.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                page.id === activePageDocId
                  ? "bg-primary/15 text-primary shadow-sm"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {page.pageNumber || groupPages.indexOf(page) + 1}
            </button>
          ))}
          {groupPages.some((p: any) => p.status === "pending" || p.status === "error" || p.status === "processing") && (
            <button
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-primary bg-primary/8 hover:bg-primary/15 transition-colors"
              disabled={isBatchTranscribing}
              onClick={async () => {
                setIsBatchTranscribing(true);
                try {
                  const result = await batchTranscribe.mutateAsync({ groupId: groupId!, projectId });
                  toast.success(result.message);
                  if (result.errors?.length) {
                    result.errors.forEach((e: string) => toast.error(e));
                  }
                  utils.groups.getById.invalidate({ groupId: groupId!, projectId });
                  utils.documents.list.invalidate({ projectId });
                  utils.projects.stats.invalidate({ id: projectId });
                  await refetchTranscription();
                } catch (err: any) {
                  toast.error(err.message || "Batch transcription failed");
                } finally {
                  setIsBatchTranscribing(false);
                }
              }}
            >
              {isBatchTranscribing
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Transcribing…</>
                : <><Zap className="w-3 h-3" /> Transcribe remaining</>}
            </button>
          )}
        </div>
      )}

      {/* Split view — image + form */}
      <div className="flex-1 overflow-hidden flex">
        {/* Image panel */}
        <div className={`relative flex flex-col ${fullscreen ? 'fixed inset-0 z-[100] bg-black' : 'w-1/2 border-r border-border/30'}`}>
          {/* Image area with floating controls */}
          <div
            ref={imgContainerRef}
            className="flex-1 overflow-hidden flex items-center justify-center bg-gradient-to-b from-black/30 to-black/50"
            style={{ cursor: zoom > 1 ? 'grab' : 'default', touchAction: 'none' }}
            onMouseDown={handleImgMouseDown}
            onMouseMove={handleImgMouseMove}
            onMouseUp={handleImgMouseUp}
            onMouseLeave={handleImgMouseUp}
            onWheel={handleImgWheel}
            onDoubleClick={(e) => {
              if (zoom > 1.5) { setZoom(1); setPan({ x: 0, y: 0 }); }
              else {
                const rect = imgContainerRef.current?.getBoundingClientRect();
                if (rect) {
                  const tapX = e.clientX - rect.left - rect.width / 2;
                  const tapY = e.clientY - rect.top - rect.height / 2;
                  setZoom(2.5);
                  setPan({ x: -tapX * 1.5, y: -tapY * 1.5 });
                } else setZoom(2.5);
              }
            }}
          >
            {imageLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/60">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs">Loading image…</span>
              </div>
            ) : imageData?.url ? (
              <img
                src={imageData.url}
                alt={currentDoc?.filename}
                className="max-w-full max-h-full object-contain select-none pointer-events-none"
                style={{
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px) rotate(${rotation}deg)`,
                  transition: dragging.current ? 'none' : 'transform 0.15s ease-out',
                }}
                draggable={false}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/40">
                <ImageOff className="w-8 h-8" />
                <span className="text-xs">Image not available</span>
              </div>
            )}
          </div>

          {/* Floating controls — bottom of image panel */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 shadow-lg">
            <button onClick={handleZoomOut} disabled={zoom <= 1} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:text-white/20 transition-colors">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-white/60 font-mono w-9 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={handleZoomIn} disabled={zoom >= 6} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:text-white/20 transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-white/15 mx-0.5" />
            <button onClick={handleRotate} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Rotate 90°">
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-white/15 mx-0.5" />
            {!fullscreen ? (
              <button onClick={() => setFullscreen(true)} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Fullscreen">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button onClick={() => setFullscreen(false)} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Exit fullscreen">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {zoom > 1 && (
              <>
                <div className="w-px h-4 bg-white/15 mx-0.5" />
                <button onClick={handleResetView} className="px-2 py-1 rounded-lg text-[10px] text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                  Reset
                </button>
              </>
            )}
          </div>

          {/* Hint text when not zoomed */}
          {zoom <= 1 && imageData?.url && !fullscreen && (
            <div className="absolute bottom-4 right-4 text-[10px] text-white/30 pointer-events-none">
              Double-click to zoom · Scroll to adjust
            </div>
          )}
        </div>

        {/* Form / transcription panel */}
        <div className={`overflow-auto ${fullscreen ? 'hidden' : 'w-1/2'}`}>
          <div className="p-6 pb-32">
            {/* Not yet transcribed */}
            {!transcriptionLoading && !transcription && currentDoc?.status !== "error" && (
              <div className="flex flex-col items-center justify-center h-full gap-5 text-center py-20">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-primary/70" />
                </div>
                <div>
                  <p className="font-medium text-foreground/90 mb-1.5">Not yet transcribed</p>
                  <p className="text-sm text-muted-foreground/70 max-w-[260px]">
                    Run the AI transcription to extract text and metadata from this document.
                  </p>
                </div>
                <Button onClick={handleTranscribe} disabled={isTranscribing} className="gap-2 rounded-lg">
                  {isTranscribing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Transcribing…</>
                    : <><Sparkles className="w-4 h-4" /> Transcribe now</>
                  }
                </Button>
              </div>
            )}

            {/* Loading */}
            {transcriptionLoading && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/60 py-20">
                <Loader2 className="w-5 h-5 animate-spin text-primary/50" />
                <p className="text-sm">Loading transcription…</p>
              </div>
            )}

            {/* Error state */}
            {!transcriptionLoading && currentDoc?.status === "error" && !transcription && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-20">
                <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-destructive/70" />
                </div>
                <div>
                  <p className="text-sm font-medium text-destructive/90 mb-1">Transcription failed</p>
                  {currentDoc.errorMessage && (
                    <p className="text-xs text-muted-foreground/60 max-w-xs">
                      {currentDoc.errorMessage}
                    </p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={handleTranscribe} disabled={isTranscribing} className="gap-2 rounded-lg">
                  {isTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Retry
                </Button>
              </div>
            )}

            {/* Transcription loaded — the form */}
            {!transcriptionLoading && transcription && (
              <div className="space-y-1">
                {/* Subtle metadata line */}
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground/40 pb-4 flex-wrap">
                  <span>Model: {transcription.modelUsed}</span>
                  {transcription.reviewedAt && (
                    <span>· Reviewed {new Date(transcription.reviewedAt).toLocaleDateString()}</span>
                  )}
                </div>

                {/* Cross-check AI results */}
                {checkAiResult && (
                  <div className="mb-4 rounded-xl border border-border/40 bg-card/40 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-card/60">
                      <div className="flex items-center gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-muted-foreground/70" />
                        <span className="text-xs font-medium text-foreground/80">Cross-Model Verification</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          checkAiResult.overallAssessment === "accurate"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            : checkAiResult.overallAssessment === "minor_issues"
                            ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                            : "bg-red-500/15 text-red-400 border border-red-500/20"
                        }`}>
                          {checkAiResult.overallAssessment === "accurate" ? "Accurate" : checkAiResult.overallAssessment === "minor_issues" ? "Minor Issues" : "Significant Issues"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">
                          {checkAiResult.confidenceScore}% confidence · {checkAiResult.modelUsed}
                        </span>
                      </div>
                      <button
                        onClick={() => setCheckAiResult(null)}
                        className="p-1 rounded-md hover:bg-secondary/80 text-muted-foreground/50 hover:text-foreground transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      <p className="text-xs text-muted-foreground/70 leading-relaxed">{checkAiResult.summary}</p>
                      {checkAiResult.corrections.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Corrections ({checkAiResult.corrections.length})</span>
                          {checkAiResult.corrections.map((c, i) => (
                            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-background/50 border border-border/20">
                              <span className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                c.severity === "high" ? "bg-red-400" : c.severity === "medium" ? "bg-amber-400" : "bg-blue-400"
                              }`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-[10px] font-medium text-foreground/70">{c.field.replace(/_/g, " ")}</span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                                    c.severity === "high" ? "bg-red-500/10 text-red-400" : c.severity === "medium" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"
                                  }`}>{c.severity}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground/60">
                                  <span className="line-through opacity-60">{c.original.slice(0, 80)}{c.original.length > 80 ? "…" : ""}</span>
                                  <span className="mx-1.5 text-muted-foreground/30">→</span>
                                  <span className="text-foreground/80">{c.suggested.slice(0, 80)}{c.suggested.length > 80 ? "…" : ""}</span>
                                </div>
                                {c.reason && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{c.reason}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {checkAiResult.corrections.length === 0 && checkAiResult.overallAssessment === "accurate" && (
                        <p className="text-xs text-emerald-400/80 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          No corrections needed — transcription verified by second model.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Original text (collapsible) */}
                {transcription.originalText && (
                  <details className="group mb-4">
                    <summary className="text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium cursor-pointer hover:text-muted-foreground/70 transition-colors flex items-center gap-1.5 py-1">
                      <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                      Original transcription (pass 1)
                    </summary>
                    <div className="mt-2 bg-card/30 rounded-xl p-4 text-sm text-muted-foreground/70 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-border/30">
                      {transcription.originalText}
                    </div>
                  </details>
                )}

                {/* Dynamic fields */}
                {flatFields && flatFields.length > 0 ? (
                  <div className="space-y-0.5">
                    {/* For multi-page docs, show shared metadata section header */}
                    {isMultiPage && (
                      <div className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider pb-2 pt-2 border-b border-border/30 mb-2">
                        Shared Metadata
                      </div>
                    )}
                    {flatFields.filter(f => !isMultiPage || !isPerPageField(f.key)).map(({ key, label, def }) => (
                      <DynamicField
                        key={key}
                        fieldKey={key}
                        label={label}
                        fieldDef={def}
                        value={getNestedValue(editedFields, key)}
                        onChange={v => setEditedFields(prev => setNestedValue(prev, key, v))}
                        entities={docEntities}
                        projectId={projectId}
                      />
                    ))}
                    {/* Per-page fields section */}
                    {isMultiPage && (
                      <div className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider pb-2 pt-4 border-b border-border/30 mb-2">
                        Page {groupPages.findIndex((p: any) => p.id === activePageDocId) + 1} Content
                      </div>
                    )}
                    {flatFields.filter(f => !isMultiPage || isPerPageField(f.key)).map(({ key, label, def }) => (
                      <DynamicField
                        key={`${effectiveDocId}-${key}`}
                        fieldKey={key}
                        label={label}
                        fieldDef={def}
                        value={getNestedValue(editedFields, key)}
                        onChange={v => setEditedFields(prev => setNestedValue(prev, key, v))}
                        entities={docEntities}
                        projectId={projectId}
                      />
                    ))}
                  </div>
                ) : (
                  rawData && (
                    <div className="space-y-3">
                      {Object.entries(rawData)
                        .filter(([k]) => !k.startsWith("_"))
                        .map(([key, val]) => (
                          <div key={key} className="py-2 px-1">
                            <FieldLabel label={key.replace(/_/g, " ")} />
                            {typeof val === "object" && val !== null ? (
                              <Textarea
                                value={JSON.stringify(val, null, 2)}
                                onChange={e => {
                                  try {
                                    setEditedFields(prev => ({ ...prev, [key]: JSON.parse(e.target.value) }));
                                  } catch { /* ignore parse error while typing */ }
                                }}
                                className="bg-transparent border-transparent hover:border-border/50 focus:border-primary/30 focus:bg-card/50 text-xs font-mono resize-none transition-all rounded-lg"
                                rows={4}
                              />
                            ) : (
                              <Input
                                value={String(val ?? "")}
                                onChange={e => setEditedFields(prev => ({ ...prev, [key]: e.target.value }))}
                                className="bg-transparent border-transparent hover:border-border/50 focus:border-primary/30 focus:bg-card/50 text-sm transition-all rounded-lg h-9"
                              />
                            )}
                          </div>
                        ))}
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Sticky action bar */}
          {!transcriptionLoading && transcription && (
            <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background to-transparent pt-6 pb-4 px-6 pointer-events-none">
              <div className="flex gap-2.5 pointer-events-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-lg bg-transparent border-orange-500/20 text-orange-400/80 hover:text-orange-300 hover:bg-orange-500/10 hover:border-orange-500/30"
                  onClick={() => handleSave("flagged")}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flag className="w-3.5 h-3.5" />}
                  Flag for later
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 flex-1 rounded-lg shadow-md shadow-primary/10"
                  onClick={() => handleSave("reviewed")}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approve
                  <kbd className="ml-1.5 text-[10px] opacity-50 font-mono bg-primary-foreground/10 px-1 py-0.5 rounded">⌘⏎</kbd>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main ReviewPage ──────────────────────────────────────────────────── */
export default function ReviewPage({ projectId, project, docId: docIdProp }: Props) {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [renameDoc, setRenameDoc] = useState<{ id: number; filename: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteDoc, setDeleteDoc] = useState<{ id: number; filename: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set());
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [isGrouping, setIsGrouping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Use paginated query with infinite loading
  const paginatedInput = useMemo(() => ({
    projectId,
    status: statusFilter === "all"
      ? undefined
      : statusFilter as "needs_review" | "reviewed" | "flagged" | "pending" | "processing" | "error",
    search: debouncedSearch || undefined,
    limit: 50,
  }), [projectId, statusFilter, debouncedSearch]);

  const { data: firstPage, isLoading: isLoadingFirst } = trpc.documents.listPaginated.useQuery(paginatedInput);

  // Track loaded pages for infinite scroll
  const [pages, setPages] = useState<Array<{ documents: any[]; nextCursor: number | null }>>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Reset pages when filter/search changes
  useEffect(() => {
    if (firstPage) {
      setPages([firstPage]);
    }
  }, [firstPage]);

  // Flatten all loaded documents
  const documents = useMemo(() => {
    return pages.flatMap(p => p.documents);
  }, [pages]);

  const totalCount = firstPage?.total ?? 0;
  const hasMore = pages.length > 0 && pages[pages.length - 1].nextCursor !== null;

  // Load more documents
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    const lastPage = pages[pages.length - 1];
    if (!lastPage?.nextCursor) return;
    setIsLoadingMore(true);
    try {
      const nextPage = await utils.documents.listPaginated.fetch({
        ...paginatedInput,
        cursor: lastPage.nextCursor,
      });
      setPages(prev => [...prev, nextPage]);
    } catch (err) {
      console.error("Failed to load more documents", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, pages, paginatedInput, utils]);

  // Infinite scroll handler
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      loadMore();
    }
  }, [loadMore]);

  const deleteMutation = trpc.documents.delete.useMutation({
    onSuccess: () => {
      toast.success("Document deleted");
      utils.documents.listPaginated.invalidate();
      utils.documents.list.invalidate({ projectId });
      utils.projects.stats.invalidate({ id: projectId });
      setDeleteDoc(null);
      setIsDeleting(false);
      navigate("/review");
    },
    onError: (err) => {
      toast.error(err.message);
      setIsDeleting(false);
    },
  });

  const renameMutation = trpc.documents.rename.useMutation({
    onSuccess: () => {
      toast.success("Document renamed");
      utils.documents.listPaginated.invalidate();
      utils.documents.list.invalidate({ projectId });
      setRenameDoc(null);
      setIsRenaming(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setIsRenaming(false);
    },
  });

  const changeStatusMutation = trpc.documents.changeStatus.useMutation({
    onSuccess: (result) => {
      toast.success(`Status changed to ${result.status.replace("_", " ")}`);
      utils.documents.listPaginated.invalidate();
      utils.documents.list.invalidate({ projectId });
      utils.projects.stats.invalidate({ id: projectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const createGroupMutation = trpc.groups.create.useMutation({
    onSuccess: (group) => {
      toast.success(`Grouped ${selectedDocIds.size} pages into "${group.title}"`);
      utils.documents.listPaginated.invalidate();
      utils.documents.list.invalidate({ projectId });
      setSelectedDocIds(new Set());
      setSelectMode(false);
      setShowGroupDialog(false);
      setGroupTitle("");
      setIsGrouping(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setIsGrouping(false);
    },
  });

  const ungroupMutation = trpc.groups.removePage.useMutation({
    onSuccess: () => {
      toast.success("Removed from group");
      utils.documents.listPaginated.invalidate();
      utils.documents.list.invalidate({ projectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleDocSelection = (docId: number) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const selectAll = () => {
    if (!documents) return;
    setSelectedDocIds(new Set(documents.map(d => d.id)));
  };

  const clearSelection = () => setSelectedDocIds(new Set());

  // Determine active document
  const currentDocId = docIdProp
    ? parseInt(docIdProp)
    : documents?.[0]?.id;

  const currentIndex = documents?.findIndex(d => d.id === currentDocId) ?? 0;

  const handleNavigate = (docId: number) => {
    navigate(`/review/${docId}`);
  };

  return (
    <div className="flex h-full">
      {/* Document list sidebar — softer, more spacious */}
      <div className={`flex flex-col flex-shrink-0 transition-all duration-200 bg-card/20 ${sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-72 border-r border-border/30'}`}>
        {/* Search + Filter header */}
        <div className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents…"
              className="h-9 text-xs pl-8 bg-secondary/30 border-transparent hover:border-border/40 focus:border-primary/30 focus:bg-secondary/50 rounded-lg transition-all"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs bg-transparent border-transparent hover:bg-secondary/30 rounded-lg">
              <Filter className="w-3 h-3 mr-1.5 text-muted-foreground/50" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All documents</SelectItem>
              <SelectItem value="needs_review">Needs review</SelectItem>
              <SelectItem value="reviewed">Approved</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="error">Errors</SelectItem>
            </SelectContent>
          </Select>
          <RetryAllButton projectId={projectId} />
          {/* Select mode toggle */}
          <div className="flex items-center gap-1.5">
            <Button
              variant={selectMode ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-[11px] gap-1 rounded-lg"
              onClick={() => { setSelectMode(!selectMode); if (selectMode) clearSelection(); }}
            >
              {selectMode ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
              {selectMode ? "Cancel" : "Select"}
            </Button>
            {selectMode && selectedDocIds.size > 0 && (
              <Button
                variant="default"
                size="sm"
                className="h-7 text-[11px] gap-1 rounded-lg"
                onClick={() => setShowGroupDialog(true)}
              >
                <FolderPlus className="w-3 h-3" />
                Group ({selectedDocIds.size})
              </Button>
            )}
            {selectMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] rounded-lg"
                onClick={selectedDocIds.size === documents.length ? clearSelection : selectAll}
              >
                {selectedDocIds.size === documents.length ? "None" : "All"}
              </Button>
            )}
          </div>
        </div>

        {/* Document list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-2" onScroll={handleScroll}>
          {isLoadingFirst ? (
            <div className="p-6 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground/40">Loading…</p>
            </div>
          ) : !documents || documents.length === 0 ? (
            <div className="p-6 text-center">
              <FileText className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground/50 mb-1">
                {debouncedSearch ? "No matching documents" : "No documents yet"}
              </p>
              <p className="text-[10px] text-muted-foreground/30">
                {debouncedSearch ? "Try a different search." : "Upload documents first."}
              </p>
              {/* Approving a document makes it available in Search, Ask Archive, and Entities */}
            </div>
          ) : (
            <div className="space-y-0.5 pb-2">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                    selectMode && selectedDocIds.has(doc.id)
                      ? "bg-primary/10 border border-primary/20"
                      : doc.id === currentDocId
                        ? "bg-primary/8 border border-primary/15"
                        : "hover:bg-secondary/40 border border-transparent"
                  }`}
                  onClick={() => selectMode ? toggleDocSelection(doc.id) : handleNavigate(doc.id)}
                >
                  {selectMode && (
                    <Checkbox
                      checked={selectedDocIds.has(doc.id)}
                      onCheckedChange={() => toggleDocSelection(doc.id)}
                      className="w-3.5 h-3.5"
                    />
                  )}
                  <StatusDot status={doc.status} />
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] truncate block ${doc.id === currentDocId ? "text-foreground font-medium" : "text-foreground/80"}`}>
                      {doc.filename}
                    </span>
                    {(doc as any).pageNumber && (
                      <span className="text-[10px] text-muted-foreground/40">Page {(doc as any).pageNumber}</span>
                    )}
                  </div>
                  {(doc as any).groupId && (
                    <Layers className="w-3 h-3 text-primary/40 flex-shrink-0" />
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-secondary/80 transition-all">
                        <MoreVertical className="w-3.5 h-3.5 text-muted-foreground/50" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => { setRenameDoc({ id: doc.id, filename: doc.filename }); setRenameValue(doc.filename); }}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Filter className="w-3.5 h-3.5 mr-2" /> Change status
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {(["pending", "processing", "needs_review", "reviewed", "flagged", "error"] as const).map((s) => (
                            <DropdownMenuItem
                              key={s}
                              disabled={doc.status === s}
                              onClick={() => changeStatusMutation.mutate({ documentId: doc.id, projectId, status: s })}
                            >
                              <StatusBadge status={s} />
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      {(doc as any).groupId && (
                        <DropdownMenuItem onClick={() => ungroupMutation.mutate({ documentId: doc.id, projectId })}>
                          <Unlink className="w-3.5 h-3.5 mr-2" /> Remove from group
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteDoc({ id: doc.id, filename: doc.filename })}>
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
              {isLoadingMore && (
                <div className="p-3 text-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-muted-foreground/40" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer count */}
        <div className="px-4 py-2.5 text-[11px] text-muted-foreground/40 border-t border-border/20">
          {documents.length}{hasMore ? "+" : ""} of {totalCount} documents
        </div>
      </div>

      {/* Main review area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!currentDocId || !documents || documents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mx-auto mb-4">
                <Eye className="w-7 h-7 text-primary/50" />
              </div>
              <p className="text-foreground/80 text-sm font-medium mb-1.5">Select a document</p>
              <p className="text-xs text-muted-foreground/50 leading-relaxed">
                Choose a document from the list to review its transcription and approve it for search and analysis.
              </p>
            </div>
          </div>
        ) : (
          <ReviewDocPanel
            key={currentDocId}
            projectId={projectId}
            project={project}
            currentDocId={currentDocId}
            documents={documents}
            currentIndex={currentIndex}
            onNavigate={handleNavigate}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
          />
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameDoc} onOpenChange={(open) => { if (!open) setRenameDoc(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Document filename"
              className="rounded-lg"
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim() && renameDoc) {
                  setIsRenaming(true);
                  renameMutation.mutate({ documentId: renameDoc.id, projectId, newFilename: renameValue.trim() });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDoc(null)} className="rounded-lg">Cancel</Button>
            <Button
              disabled={!renameValue.trim() || isRenaming}
              className="rounded-lg"
              onClick={() => {
                if (renameDoc && renameValue.trim()) {
                  setIsRenaming(true);
                  renameMutation.mutate({ documentId: renameDoc.id, projectId, newFilename: renameValue.trim() });
                }
              }}
            >
              {isRenaming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group dialog */}
      <Dialog open={showGroupDialog} onOpenChange={(open) => { if (!open) { setShowGroupDialog(false); setGroupTitle(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Group {selectedDocIds.size} pages</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">Give this multi-page document a name. Pages will be ordered by their current position in the list.</p>
            <Input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="e.g. Expenditure Register, Feb 1936"
              className="rounded-lg"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && groupTitle.trim()) {
                  setIsGrouping(true);
                  createGroupMutation.mutate({
                    projectId,
                    title: groupTitle.trim(),
                    documentIds: Array.from(selectedDocIds),
                  });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowGroupDialog(false); setGroupTitle(""); }} className="rounded-lg">Cancel</Button>
            <Button
              disabled={!groupTitle.trim() || isGrouping}
              className="rounded-lg gap-1.5"
              onClick={() => {
                if (groupTitle.trim()) {
                  setIsGrouping(true);
                  createGroupMutation.mutate({
                    projectId,
                    title: groupTitle.trim(),
                    documentIds: Array.from(selectedDocIds),
                  });
                }
              }}
            >
              {isGrouping ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
              Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteDoc} onOpenChange={(open) => { if (!open) setDeleteDoc(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{deleteDoc?.filename}</span> and all its transcriptions, embeddings, and entity links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg"
              disabled={isDeleting}
              onClick={() => {
                if (deleteDoc) {
                  setIsDeleting(true);
                  deleteMutation.mutate({ documentId: deleteDoc.id, projectId });
                }
              }}
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
