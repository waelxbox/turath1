import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  MoreVertical, Trash2, Pencil, Search, Layers
} from "lucide-react";
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "status-pending" },
    processing: { label: "Processing", cls: "status-processing" },
    needs_review: { label: "Needs review", cls: "status-needs-review" },
    reviewed: { label: "Reviewed", cls: "status-reviewed" },
    flagged: { label: "Flagged", cls: "status-flagged" },
    error: { label: "Error", cls: "status-error" },
  };
  const info = map[status] ?? { label: status, cls: "" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${info.cls}`}>
      {info.label}
    </span>
  );
}

function RetryAllButton({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [isRunning, setIsRunning] = useState(false);
  const [totalQueued, setTotalQueued] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll stats while running
  const { data: stats } = trpc.projects.stats.useQuery(
    { id: projectId },
    { refetchInterval: isRunning ? 4000 : false }
  );

  // Detect completion: when running and no more pending/processing
  useEffect(() => {
    if (isRunning && stats && stats.pending === 0 && stats.processing === 0) {
      setIsRunning(false);
      setTotalQueued(0);
      toast.success("All documents transcribed!");
      utils.documents.listPaginated.invalidate();
    }
  }, [isRunning, stats, utils]);

  // Cleanup interval on unmount
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
        // Also invalidate list periodically
        intervalRef.current = setInterval(() => {
          utils.documents.listPaginated.invalidate();
        }, 6000);
        setTimeout(() => {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }, 300000); // 5 min max
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
      <div className="flex items-center gap-2 h-8 px-2 rounded border border-border bg-background text-xs">
        <Loader2 className="w-3 h-3 animate-spin text-primary" />
        <span className="text-muted-foreground whitespace-nowrap">
          {completed}/{totalQueued} done ({pct}%)
        </span>
        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  // Only show button if there are pending docs
  if (pendingCount === 0 && processingCount === 0) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs gap-1 whitespace-nowrap"
      title={`Transcribe ${pendingCount} pending document(s)`}
      onClick={() => retryAll.mutate({ projectId })}
      disabled={retryAll.isPending}
    >
      {retryAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
      Retry pending ({pendingCount})
    </Button>
  );
}

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

/**
 * Inner component that is fully re-mounted when docId changes.
 * This guarantees editedFields always starts fresh for each document.
 */
// Fields that are per-page (not shared across a multi-page document)
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

function ReviewDocPanel({
  projectId,
  project,
  currentDocId,
  documents,
  currentIndex,
  onNavigate,
}: {
  projectId: number;
  project: Project;
  currentDocId: number;
  documents: Array<{ id: number; filename: string; status: string; errorMessage?: string | null; groupId?: number | null; pageNumber?: number | null }>;
  currentIndex: number;
  onNavigate: (docId: number) => void;
}) {
  const [editedFields, setEditedFields] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isBatchTranscribing, setIsBatchTranscribing] = useState(false);
  const [activePageDocId, setActivePageDocId] = useState(currentDocId);
  const utils = trpc.useUtils();

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

  // Reset active page when switching documents
  useEffect(() => {
    setActivePageDocId(currentDocId);
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
      // Auto-advance to next document
      if (currentIndex < documents.length - 1) {
        onNavigate(documents[currentIndex + 1].id);
      }
    },
    onError: (err) => toast.error(err.message),
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Doc header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={currentIndex <= 0}
              onClick={() => documents[currentIndex - 1] && onNavigate(documents[currentIndex - 1].id)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">{currentIndex + 1} / {documents.length}</span>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={currentIndex >= documents.length - 1}
              onClick={() => documents[currentIndex + 1] && onNavigate(documents[currentIndex + 1].id)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <span className="text-sm font-medium">{currentDoc?.filename}</span>
          {currentDoc && <StatusBadge status={currentDoc.status} />}
          {isMultiPage && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
              <Layers className="w-3 h-3" />
              {groupData?.title || "Multi-page"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Retranscribe — always visible when a doc is loaded */}
          {currentDoc && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
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
          {transcription && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 bg-transparent border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                onClick={() => handleSave("flagged")}
                disabled={isSaving || isTranscribing}
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flag className="w-3.5 h-3.5" />}
                Flag for later
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => handleSave("reviewed")}
                disabled={isSaving || isTranscribing}
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Page flipper for multi-page documents */}
      {isMultiPage && groupPages.length > 0 && (
        <div className="flex items-center gap-1 px-6 py-2 border-b border-border bg-secondary/30 flex-shrink-0">
          <span className="text-xs text-muted-foreground mr-2">Pages:</span>
          {groupPages.map((page: any) => (
            <button
              key={page.id}
              onClick={() => setActivePageDocId(page.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                page.id === activePageDocId
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary hover:bg-secondary/80 text-muted-foreground"
              }`}
            >
              {page.pageNumber || groupPages.indexOf(page) + 1}
            </button>
          ))}
          {/* Batch transcribe button — shows when there are pending pages */}
          {groupPages.some((p: any) => p.status === "pending" || p.status === "error" || p.status === "processing") && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5 text-xs"
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
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Transcribing all…</>
                : <><Zap className="w-3.5 h-3.5" /> Transcribe all remaining</>}
            </Button>
          )}
        </div>
      )}

      {/* Split view */}
      <div className="flex-1 overflow-hidden flex">
        {/* Image panel */}
        <div className="w-1/2 border-r border-border overflow-auto p-4 bg-black/20 flex items-start justify-center">
          {imageLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">Loading image…</span>
            </div>
          ) : imageData?.url ? (
            <img
              src={imageData.url}
              alt={currentDoc?.filename}
              className="w-full rounded shadow-lg"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <ImageOff className="w-8 h-8" />
              <span className="text-xs">Image not available</span>
            </div>
          )}
        </div>

        {/* Form / transcription panel */}
        <div className="w-1/2 overflow-auto p-6">
          {/* Not yet transcribed */}
          {!transcriptionLoading && !transcription && currentDoc?.status !== "error" && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-medium mb-1">Not yet transcribed</p>
                <p className="text-sm text-muted-foreground">
                  Run the AI transcription engine on this document to extract its metadata.
                </p>
              </div>
              <Button onClick={handleTranscribe} disabled={isTranscribing} className="gap-2">
                {isTranscribing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Transcribing…</>
                  : <><Zap className="w-4 h-4" /> Transcribe now</>
                }
              </Button>
            </div>
          )}

          {/* Loading */}
          {transcriptionLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm">Loading transcription…</p>
            </div>
          )}

          {/* Error state */}
          {!transcriptionLoading && currentDoc?.status === "error" && !transcription && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <AlertCircle className="w-8 h-8 text-destructive" />
              <p className="text-sm text-destructive">Transcription failed</p>
              {currentDoc.errorMessage && (
                <p className="text-xs text-muted-foreground font-mono bg-secondary rounded p-2 max-w-xs">
                  {currentDoc.errorMessage}
                </p>
              )}
              <Button variant="outline" size="sm" onClick={handleTranscribe} disabled={isTranscribing} className="gap-2">
                {isTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Retry
              </Button>
            </div>
          )}

          {/* Transcription loaded */}
          {!transcriptionLoading && transcription && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground pb-3 border-b border-border flex-wrap">
                <span>Model: <span className="font-mono">{transcription.modelUsed}</span></span>
                {transcription.reviewedAt && (
                  <span>· Reviewed {new Date(transcription.reviewedAt).toLocaleDateString()}</span>
                )}
              </div>

              {transcription.originalText && (
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">
                    Original transcription (pass 1)
                  </Label>
                  <div className="bg-background rounded-lg p-3 text-sm font-mono text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {transcription.originalText}
                  </div>
                </div>
              )}

              {flatFields && flatFields.length > 0 ? (
                <>
                  {/* For multi-page docs, show shared metadata section header */}
                  {isMultiPage && (
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide pb-1 border-b border-border">
                      Shared Metadata (applies to all pages)
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
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide pb-1 pt-3 border-b border-border">
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
                </>
              ) : (
                rawData && Object.entries(rawData)
                  .filter(([k]) => !k.startsWith("_"))
                  .map(([key, val]) => (
                    <div key={key}>
                      <Label className="text-sm mb-1.5 block capitalize">{key.replace(/_/g, " ")}</Label>
                      {typeof val === "object" && val !== null ? (
                        <Textarea
                          value={JSON.stringify(val, null, 2)}
                          onChange={e => {
                            try {
                              setEditedFields(prev => ({ ...prev, [key]: JSON.parse(e.target.value) }));
                            } catch { /* ignore parse error while typing */ }
                          }}
                          className="bg-background text-xs font-mono resize-none"
                          rows={4}
                        />
                      ) : (
                        <Input
                          value={String(val ?? "")}
                          onChange={e => setEditedFields(prev => ({ ...prev, [key]: e.target.value }))}
                          className="bg-background text-sm"
                        />
                      )}
                    </div>
                  ))
              )}

              <div className="flex gap-2 pt-4 border-t border-border sticky bottom-0 bg-card/95 backdrop-blur-sm py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 bg-transparent border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                  onClick={() => handleSave("flagged")}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flag className="w-3.5 h-3.5" />}
                  Flag for review
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 flex-1"
                  onClick={() => handleSave("reviewed")}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Save & mark reviewed
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type DocEntity = { id: number; name: string; type: "person" | "location" | "organization"; contextSnippet: string | null };

function EntityTag({ entity, projectId }: { entity: DocEntity; projectId?: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const colors: Record<string, string> = {
    person: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    location: "bg-green-500/20 text-green-300 border-green-500/40",
    organization: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  };
  const typeLabels: Record<string, string> = { person: "Person", location: "Place", organization: "Organization" };
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Navigate to entity directory with this entity pre-selected
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
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-popover border border-border shadow-lg text-[11px] whitespace-nowrap z-50 pointer-events-none">
          <span className="font-medium text-foreground">{entity.name}</span>
          <span className="text-muted-foreground ml-1">({typeLabels[entity.type] || entity.type})</span>
        </div>
      )}
    </span>
  );
}

function FieldEntityAnnotations({ value, entities, projectId }: { value: unknown; entities?: DocEntity[]; projectId?: number }) {
  if (!entities || entities.length === 0 || typeof value !== "string" || !value.trim()) return null;
  
  // Find entities whose name appears in this field value (or vice versa)
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
      <div className="flex items-center justify-between py-1">
        <div>
          <Label className="text-sm capitalize">{label}</Label>
          {fieldDef.description && <p className="text-xs text-muted-foreground">{fieldDef.description}</p>}
        </div>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    );
  }

  if (fieldDef.type === "array" || fieldDef.displayHint === "tag_list") {
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    const [tagInput, setTagInput] = useState("");
    
    // Match each array item to an entity
    const getEntityForTag = (tag: unknown): DocEntity | undefined => {
      if (typeof tag !== "string" || !entities || entities.length === 0) return undefined;
      const normalizedTag = tag.toLowerCase().trim();
      return entities.find(e => {
        const normalizedName = e.name.toLowerCase().trim();
        return normalizedName === normalizedTag || normalizedName.includes(normalizedTag) || normalizedTag.includes(normalizedName);
      });
    };

    return (
      <div>
        <Label className="text-sm mb-1.5 block capitalize">{label}</Label>
        {fieldDef.description && <p className="text-xs text-muted-foreground mb-2">{fieldDef.description}</p>}
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
          {arr.map((tag, i) => {
            const matchedEntity = getEntityForTag(tag);
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs"
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
          {arr.length === 0 && <span className="text-xs text-muted-foreground italic">No items</span>}
        </div>
        <div className="flex gap-2">
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
            className="bg-background text-sm h-8"
          />
        </div>
      </div>
    );
  }

  const strVal = String(value ?? "");
  const isLong = fieldDef.displayHint === "long_text" || strVal.length > 120;

  if (isLong) {
    return (
      <div>
        <Label className="text-sm mb-1.5 block capitalize">{label}</Label>
        {fieldDef.description && <p className="text-xs text-muted-foreground mb-2">{fieldDef.description}</p>}
        <Textarea
          value={strVal}
          onChange={e => onChange(e.target.value)}
          className="bg-background text-sm resize-none"
          rows={4}
        />
        <FieldEntityAnnotations value={value} entities={entities} projectId={projectId} />
      </div>
    );
  }

  return (
    <div>
      <Label className="text-sm mb-1.5 block capitalize">{label}</Label>
      {fieldDef.description && <p className="text-xs text-muted-foreground mb-2">{fieldDef.description}</p>}
      <div className="flex items-center gap-2">
        <Input
          value={strVal}
          onChange={e => onChange(e.target.value)}
          className="bg-background text-sm flex-1"
        />
        <FieldEntityAnnotations value={value} entities={entities} projectId={projectId} />
      </div>
    </div>
  );
}

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
      {/* Document list sidebar */}
      <div className="w-64 border-r border-border flex flex-col flex-shrink-0">
        {/* Search + Filter header */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents..."
              className="h-8 text-xs pl-7 bg-background"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs bg-background">
              <Filter className="w-3 h-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All documents</SelectItem>
              <SelectItem value="needs_review">Needs review</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="error">Errors</SelectItem>
            </SelectContent>
          </Select>
          <RetryAllButton projectId={projectId} />
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto divide-y divide-border" onScroll={handleScroll}>
          {isLoadingFirst ? (
            <div className="p-4 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Loading documents...</p>
            </div>
          ) : !documents || documents.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-2">
                {debouncedSearch ? "No matching documents" : "No documents yet"}
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                {debouncedSearch ? "Try a different search term." : "Upload documents first, then they'll appear here for review."}
              </p>
            </div>
          ) : (
            <>
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className={`group flex items-center justify-between px-3 py-2.5 hover:bg-secondary/50 transition-colors cursor-pointer ${doc.id === currentDocId ? "bg-secondary" : ""}`}
                  onClick={() => handleNavigate(doc.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium truncate">{doc.filename}</span>
                      {(doc as any).groupId && (
                        <span className="flex-shrink-0" aria-label="Part of multi-page document">
                          <Layers className="w-3 h-3 text-primary/60" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <StatusBadge status={doc.status} />
                      {(doc as any).pageNumber && (
                        <span className="text-[10px] text-muted-foreground">p.{(doc as any).pageNumber}</span>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background/50 transition-opacity">
                        <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
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
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteDoc({ id: doc.id, filename: doc.filename })}>
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
              {isLoadingMore && (
                <div className="p-3 text-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-muted-foreground" />
                </div>
              )}
            </>
          )}
        </div>
        <div className="p-3 border-t border-border text-xs text-muted-foreground">
          {documents.length}{hasMore ? "+" : ""} of {totalCount} documents
        </div>
      </div>

      {/* Main review area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!currentDocId || !documents || documents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs">
              <Eye className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm font-medium mb-1">Select a document to review</p>
              <p className="text-xs text-muted-foreground">
                Approving a document makes it available in Search, Ask Archive, and Entities.
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim() && renameDoc) {
                  setIsRenaming(true);
                  renameMutation.mutate({ documentId: renameDoc.id, projectId, newFilename: renameValue.trim() });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDoc(null)}>Cancel</Button>
            <Button
              disabled={!renameValue.trim() || isRenaming}
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
