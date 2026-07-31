import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import type { Project } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Loader2, ImageOff, RotateCw, Maximize2, X, Minus, Plus,
  Flag, CheckCircle2, SkipForward, Sparkles, ShieldCheck,
  HelpCircle, MoreVertical, RotateCcw, AlertCircle
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

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

/* ─── Helpers ─────────────────────────────────────────────────────────── */
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

// Fields that contain the main transcription text
const TRANSCRIPTION_FIELDS = new Set([
  "transcription", "full_arabic_transcription", "original_transcription",
  "english_translation", "full_english_translation", "translation",
  "text", "content", "original_text"
]);

// Fields that make good "tags" (short metadata shown as chips)
const TAG_FIELDS = new Set([
  "estimated_date", "era", "period", "century", "date",
  "regional_origin", "region", "location", "country", "origin",
  "language", "script", "dialect",
  "document_type", "type", "category", "genre",
  "collection", "archive", "source"
]);

// Fields that are metadata (shown in collapsible section)
const METADATA_FIELDS = new Set([
  ...Array.from(TAG_FIELDS),
  "section_header", "folio_number", "page_number",
  "author", "scribe", "recipient", "addressee",
  "condition", "material", "dimensions",
  "provenance", "acquisition_date"
]);

function isTranscriptionField(key: string): boolean {
  const base = key.split(".")[0].toLowerCase();
  return TRANSCRIPTION_FIELDS.has(base) || base.includes("transcription") || base.includes("translation");
}

function isTagField(key: string): boolean {
  const base = key.split(".")[0].toLowerCase();
  return TAG_FIELDS.has(base);
}

function isMetadataField(key: string): boolean {
  const base = key.split(".")[0].toLowerCase();
  return METADATA_FIELDS.has(base);
}

/* ─── Entity highlighting in text ─────────────────────────────────────── */
type DocEntity = { id: number; name: string; type: "person" | "location" | "organization"; contextSnippet: string | null };

function HighlightedText({ text, entities }: { text: string; entities?: DocEntity[] }) {
  if (!entities || entities.length === 0 || !text) {
    return <span>{text}</span>;
  }

  // Build a list of ranges to highlight
  type Range = { start: number; end: number; entity: DocEntity };
  const ranges: Range[] = [];
  
  for (const entity of entities) {
    if (!entity.name || entity.name.length < 2) continue;
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const idx = text.indexOf(entity.name, searchFrom);
      if (idx === -1) break;
      // Check no overlap with existing ranges
      const overlaps = ranges.some(r => !(idx + entity.name.length <= r.start || idx >= r.end));
      if (!overlaps) {
        ranges.push({ start: idx, end: idx + entity.name.length, entity });
      }
      searchFrom = idx + 1;
    }
  }

  if (ranges.length === 0) return <span>{text}</span>;

  // Sort by start position
  ranges.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start > lastEnd) {
      parts.push(<span key={`t-${i}`}>{text.slice(lastEnd, r.start)}</span>);
    }
    const colorClass = r.entity.type === "person" 
      ? "decoration-orange-400/60" 
      : r.entity.type === "location" 
        ? "decoration-emerald-400/60" 
        : "decoration-indigo-400/60";
    parts.push(
      <span key={`e-${i}`} className={`underline underline-offset-4 decoration-2 ${colorClass} cursor-help`} title={`${r.entity.name} (${r.entity.type})`}>
        {text.slice(r.start, r.end)}
      </span>
    );
    lastEnd = r.end;
  }
  if (lastEnd < text.length) {
    parts.push(<span key="tail">{text.slice(lastEnd)}</span>);
  }
  return <>{parts}</>;
}

/* ─── Image Viewer ────────────────────────────────────────────────────── */
function ImageViewer({ src, alt, isLoading }: { src?: string | null; alt?: string; isLoading: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const lastTap = useRef(0);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 6));
  const handleZoomOut = () => {
    const nz = Math.max(zoom - 0.5, 1);
    setZoom(nz);
    if (nz === 1) setPan({ x: 0, y: 0 });
  };
  const handleReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  const handleFitWidth = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleDoubleTap = (clientX: number, clientY: number) => {
    if (zoom > 1.5) {
      setZoom(1); setPan({ x: 0, y: 0 });
    } else {
      const container = containerRef.current;
      if (!container) { setZoom(2.5); return; }
      const rect = container.getBoundingClientRect();
      const tapX = clientX - rect.left - rect.width / 2;
      const tapY = clientY - rect.top - rect.height / 2;
      setZoom(2.5);
      setPan({ x: -tapX * 1.5, y: -tapY * 1.5 });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  };
  const handleMouseUp = () => { dragging.current = false; };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        handleDoubleTap(e.touches[0].clientX, e.touches[0].clientY);
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      if (zoom > 1) {
        dragging.current = true;
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    } else if (e.touches.length === 2) {
      dragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && dragging.current) {
      const dx = e.touches[0].clientX - lastPos.current.x;
      const dy = e.touches[0].clientY - lastPos.current.y;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist.current > 0) {
        const scale = dist / lastPinchDist.current;
        setZoom(prev => Math.max(1, Math.min(6, prev * scale)));
      }
      lastPinchDist.current = dist;
    }
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    dragging.current = false;
    if (e.touches.length < 2) lastPinchDist.current = 0;
    if (zoom < 1.1) { setZoom(1); setPan({ x: 0, y: 0 }); }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    const nz = Math.max(1, Math.min(6, zoom + delta));
    setZoom(nz);
    if (nz === 1) setPan({ x: 0, y: 0 });
  };

  const viewer = (
    <div className={`relative flex flex-col ${fullscreen ? "fixed inset-0 z-[100]" : "h-full"} bg-[#0a0a08]`}>
      {/* Floating toolbar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 shadow-lg">
        <button onClick={handleZoomOut} disabled={zoom <= 1} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:text-white/20 transition-colors">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] text-white/60 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={handleZoomIn} disabled={zoom >= 6} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:text-white/20 transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-white/15 mx-0.5" />
        <button onClick={handleFitWidth} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Fit to width">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleRotate} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Rotate 90°">
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-white/15 mx-0.5" />
        {/* Brightness/contrast slider */}
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[10px] text-white/40">◐</span>
          <input
            type="range"
            min={50}
            max={200}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            className="w-16 h-1 appearance-none bg-white/20 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f0bd8b]"
          />
        </div>
      </div>

      {/* Fullscreen close button */}
      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-black/70 text-white/70 hover:text-white hover:bg-black/90 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      )}

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center"
        style={{ cursor: zoom > 1 ? "grab" : "default", touchAction: "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 text-white/40">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-xs">Loading image…</span>
          </div>
        ) : src ? (
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-full object-contain select-none pointer-events-none"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px) rotate(${rotation}deg)`,
              transition: dragging.current ? "none" : "transform 0.15s ease-out",
              filter: `brightness(${brightness}%)`,
            }}
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-white/30">
            <ImageOff className="w-8 h-8" />
            <span className="text-xs">Image not available</span>
          </div>
        )}
      </div>

      {/* Zoom hint */}
      {zoom <= 1 && src && !fullscreen && (
        <div className="absolute bottom-4 right-4 text-[10px] text-white/25 pointer-events-none">
          Double-click to zoom · Scroll to adjust
        </div>
      )}
    </div>
  );

  if (fullscreen) return <>{viewer}</>;
  return viewer;
}

/* ─── Main SimpleReviewPage ───────────────────────────────────────────── */
export default function SimpleReviewPage({ projectId, project, docId: docIdProp }: Props) {
  const [, navigate] = useLocation();
  const [editedFields, setEditedFields] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const [isCheckingAi, setIsCheckingAi] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();

  // Fetch document list for navigation
  const { data: docsData } = trpc.documents.listPaginated.useQuery(
    { projectId, limit: 100, status: "needs_review" },
    { staleTime: 30000 }
  );
  const documents = docsData?.documents ?? [];

  const currentDocId = docIdProp ? parseInt(docIdProp) : documents[0]?.id;
  const currentIndex = documents.findIndex(d => d.id === currentDocId);
  const currentDoc = documents.find(d => d.id === currentDocId);

  // Fetch transcription
  const { data: transcription, refetch: refetchTranscription, isLoading: transcriptionLoading } =
    trpc.transcriptions.getByDocument.useQuery(
      { documentId: currentDocId!, projectId },
      { enabled: !!currentDocId }
    );

  // Fetch image
  const { data: imageData, isLoading: imageLoading } = trpc.documents.getImageUrl.useQuery(
    { documentId: currentDocId!, projectId },
    { enabled: !!currentDocId, staleTime: 4 * 60 * 1000 }
  );

  // Fetch entities
  const { data: docEntities } = trpc.entities.byDocument.useQuery(
    { documentId: currentDocId!, projectId },
    { enabled: !!currentDocId && !!transcription }
  );

  // Project stats for the header
  const { data: stats } = trpc.projects.stats.useQuery({ id: projectId });

  // Mutations
  const saveReview = trpc.transcriptions.saveReview.useMutation({
    onSuccess: (_, variables) => {
      if (variables.status === "reviewed") {
        toast.success("Approved ✓");
      } else {
        toast.success("Flagged for later review");
      }
      utils.documents.listPaginated.invalidate();
      utils.projects.stats.invalidate({ id: projectId });
      // Auto-advance
      if (currentIndex < documents.length - 1) {
        navigate(`/review/${documents[currentIndex + 1].id}`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const transcribeDoc = trpc.documents.transcribe.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success("Transcription complete");
        await refetchTranscription();
        utils.documents.listPaginated.invalidate();
        utils.projects.stats.invalidate({ id: projectId });
      } else {
        toast.error(`Transcription failed: ${result.error}`);
      }
      setIsTranscribing(false);
    },
    onError: (err) => { toast.error(err.message); setIsTranscribing(false); },
  });

  const checkAi = trpc.documents.crossCheck.useMutation({
    onMutate: () => setIsCheckingAi(true),
    onSuccess: (data: any) => {
      setIsCheckingAi(false);
      if (data.success && data.result) {
        const assessment = data.result.overallAssessment;
        if (assessment === "accurate") {
          toast.success(`AI verified: Accurate (${data.result.confidenceScore}% confidence)`);
        } else if (assessment === "minor_issues") {
          toast.warning(`AI found minor issues (${data.result.corrections?.length || 0} corrections suggested)`);
        } else {
          toast.error(`AI found significant issues — review carefully`);
        }
      } else {
        toast.error(data.error || "Cross-check failed");
      }
    },
    onError: (err: any) => { setIsCheckingAi(false); toast.error(err.message); },
  });

  // Populate edited fields when transcription loads
  const rawData = (transcription?.reviewedJson ?? transcription?.rawJson) as Record<string, unknown> | null;
  useEffect(() => {
    if (rawData) {
      setEditedFields({ ...rawData });
      setAutoSaved(false);
    }
  }, [currentDocId, transcription?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save debounce
  useEffect(() => {
    if (!transcription || Object.keys(editedFields).length === 0) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      setAutoSaved(true);
    }, 1500);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [editedFields, transcription]);

  // Parse schema
  const schema = project.jsonSchema as Record<string, SchemaField> | null;
  const flatFields = useMemo(() => schema ? flattenSchema(schema) : null, [schema]);

  // Derive tags, metadata, and transcription content from the data
  const tags = useMemo(() => {
    if (!flatFields || !editedFields) return [];
    return flatFields
      .filter(f => isTagField(f.key))
      .map(f => {
        const val = getNestedValue(editedFields, f.key);
        if (!val || (typeof val === "string" && !val.trim())) return null;
        return { key: f.key, label: f.label, value: String(val) };
      })
      .filter(Boolean) as Array<{ key: string; label: string; value: string }>;
  }, [flatFields, editedFields]);

  const metadataItems = useMemo(() => {
    if (!flatFields || !editedFields) return [];
    return flatFields
      .filter(f => isMetadataField(f.key) && !isTagField(f.key))
      .map(f => {
        const val = getNestedValue(editedFields, f.key);
        return { key: f.key, label: f.label, value: val != null ? String(val) : "" };
      })
      .filter(item => item.value.trim());
  }, [flatFields, editedFields]);

  const transcriptionFields = useMemo(() => {
    if (!flatFields || !editedFields) return [];
    return flatFields
      .filter(f => isTranscriptionField(f.key))
      .map(f => ({
        key: f.key,
        label: f.label,
        value: String(getNestedValue(editedFields, f.key) ?? ""),
      }));
  }, [flatFields, editedFields]);

  // Other fields (not tags, not metadata, not transcription)
  const otherFields = useMemo(() => {
    if (!flatFields || !editedFields) return [];
    return flatFields.filter(f => !isTranscriptionField(f.key) && !isMetadataField(f.key) && !isTagField(f.key));
  }, [flatFields, editedFields]);

  // Actions
  const handleSave = useCallback(async (status: "reviewed" | "flagged") => {
    if (!transcription || !currentDocId) return;
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

  const handleSkip = useCallback(() => {
    if (currentIndex < documents.length - 1) {
      navigate(`/review/${documents[currentIndex + 1].id}`);
    }
  }, [currentIndex, documents, navigate]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      navigate(`/review/${documents[currentIndex - 1].id}`);
    }
  }, [currentIndex, documents, navigate]);

  const handleNext = useCallback(() => {
    if (currentIndex < documents.length - 1) {
      navigate(`/review/${documents[currentIndex + 1].id}`);
    }
  }, [currentIndex, documents, navigate]);

  const handleTranscribe = useCallback(async () => {
    if (!currentDocId) return;
    setIsTranscribing(true);
    await transcribeDoc.mutateAsync({ documentId: currentDocId, projectId });
  }, [currentDocId, projectId, transcribeDoc]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (transcription && !isSaving) handleSave("reviewed");
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (transcription && !isSaving) handleSave("flagged");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [transcription, isSaving, handleSave, handlePrev, handleNext]);

  // Stats for header
  const remaining = stats ? stats.needsReview : 0;
  const approved = stats ? stats.reviewed : 0;
  const flagged = stats ? stats.flagged : 0;
  const total = documents.length;
  const progressPct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0e0a] text-[#e6e2db]">
      {/* ─── Top Header Bar ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 md:px-6 h-12 flex-shrink-0 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/review")}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors"
            title="Back to project"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="hidden md:flex items-center gap-3">
            <span className="text-xs font-semibold tracking-wider uppercase text-white/70">Document Review</span>
            <span className="text-xs text-white/40 tabular-nums">{currentIndex + 1} of {total}</span>
          </div>
          <div className="md:hidden text-xs text-white/40 tabular-nums">{currentIndex + 1} of {total}</div>
        </div>

        {/* Stats */}
        <div className="hidden md:flex items-center gap-4 text-[11px] text-white/40">
          <span>{remaining} remaining</span>
          <span>· {approved} approved</span>
          <span>· {flagged} flagged</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[#f0bd8b] hover:text-[#f0bd8b] hover:bg-[#f0bd8b]/10 rounded-lg text-xs border border-[#f0bd8b]/20"
            onClick={() => currentDocId && checkAi.mutate({ documentId: currentDocId, projectId })}
            disabled={isCheckingAi || !transcription}
          >
            {isCheckingAi
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">Check AI</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors">
                <MoreVertical className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#1c1c17] border-white/10 text-[#e6e2db]">
              <DropdownMenuItem onClick={handleTranscribe} disabled={isTranscribing}>
                <RotateCcw className="w-3.5 h-3.5 mr-2" />
                Re-transcribe
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { window.location.href = "/dashboard"; }}>
                <ArrowLeft className="w-3.5 h-3.5 mr-2" />
                Back to dashboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-0.5 bg-white/5 flex-shrink-0">
        <div
          className="h-full bg-gradient-to-r from-[#f0bd8b] to-[#d4a373] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* ─── Main Content: Image + Transcription ─────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Image Panel (left on desktop, top on mobile) */}
        <div className="md:w-1/2 h-[40vh] md:h-auto flex-shrink-0 md:flex-shrink md:border-r border-white/5">
          <ImageViewer
            src={imageData?.url}
            alt={currentDoc?.filename}
            isLoading={imageLoading}
          />
        </div>

        {/* Transcription Panel (right on desktop, bottom on mobile) */}
        <div className="flex-1 overflow-y-auto md:w-1/2 relative">
          <div className="p-5 md:p-8 pb-32">
            {/* Tags row */}
            {tags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mb-4 justify-center md:justify-start">
                {tags.map(tag => (
                  <span
                    key={tag.key}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#2b2a26] text-[#e6e2db] border border-white/10"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {tag.value}
                  </span>
                ))}
              </div>
            )}

            {/* Metadata toggle */}
            {metadataItems.length > 0 && (
              <div className="mb-5">
                <button
                  onClick={() => setMetadataExpanded(!metadataExpanded)}
                  className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/40 hover:text-white/60 transition-colors"
                >
                  {metadataExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Metadata
                </button>
                {metadataExpanded && (
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
                    {metadataItems.map(item => (
                      <div key={item.key}>
                        <div className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">{item.label}</div>
                        <div className="text-sm text-[#e6e2db]">{item.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Auto-saved indicator */}
            {autoSaved && (
              <div className="flex items-center justify-end gap-1.5 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f0bd8b]" />
                <span className="text-[11px] text-white/40">Auto-saved</span>
              </div>
            )}

            {/* Loading state */}
            {transcriptionLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-[#f0bd8b]/50" />
                <p className="text-sm text-white/40">Loading transcription…</p>
              </div>
            )}

            {/* Not yet transcribed */}
            {!transcriptionLoading && !transcription && currentDoc?.status !== "error" && (
              <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
                <div className="w-14 h-14 rounded-2xl bg-[#f0bd8b]/10 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-[#f0bd8b]/70" />
                </div>
                <div>
                  <p className="font-medium text-white/90 mb-1.5">Not yet transcribed</p>
                  <p className="text-sm text-white/50 max-w-[260px]">
                    Run the AI transcription to extract text from this document.
                  </p>
                </div>
                <Button
                  onClick={handleTranscribe}
                  disabled={isTranscribing}
                  className="gap-2 rounded-lg bg-[#f0bd8b] text-[#0f0e0a] hover:bg-[#d4a373]"
                >
                  {isTranscribing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Transcribing…</>
                    : <><Sparkles className="w-4 h-4" /> Transcribe now</>
                  }
                </Button>
              </div>
            )}

            {/* Error state */}
            {!transcriptionLoading && currentDoc?.status === "error" && !transcription && (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-red-400/70" />
                </div>
                <div>
                  <p className="text-sm font-medium text-red-400/90 mb-1">Transcription failed</p>
                  {currentDoc.errorMessage && (
                    <p className="text-xs text-white/40 max-w-xs">{currentDoc.errorMessage}</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTranscribe}
                  disabled={isTranscribing}
                  className="gap-2 rounded-lg border-white/10 text-white/70 hover:text-white"
                >
                  {isTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Retry
                </Button>
              </div>
            )}

            {/* ─── Transcription Content ─────────────────────────────────── */}
            {!transcriptionLoading && transcription && (
              <div className="space-y-6">
                {/* Main transcription text(s) */}
                {transcriptionFields.map(field => (
                  <div key={field.key} className="group">
                    {transcriptionFields.length > 1 && (
                      <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2 font-medium">
                        {field.label}
                      </div>
                    )}
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      dir="auto"
                      className="text-lg md:text-xl leading-[1.8] md:leading-[2] text-[#e6e2db] focus:outline-none focus:ring-1 focus:ring-[#f0bd8b]/30 rounded-lg p-2 -m-2 transition-all min-h-[100px]"
                      style={{ fontFamily: "'Noto Naskh Arabic', 'Amiri', serif" }}
                      onBlur={(e) => {
                        const newValue = e.currentTarget.textContent || "";
                        setEditedFields(prev => setNestedValue(prev, field.key, newValue));
                      }}
                      dangerouslySetInnerHTML={{ __html: field.value }}
                    />
                  </div>
                ))}

                {/* Fallback: if no schema-defined transcription fields, show raw text */}
                {transcriptionFields.length === 0 && rawData && (
                  <div>
                    {Object.entries(rawData)
                      .filter(([k]) => !k.startsWith("_") && typeof rawData[k] === "string" && (rawData[k] as string).length > 100)
                      .map(([key, val]) => (
                        <div key={key} className="mb-6">
                          <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2 font-medium">
                            {key.replace(/_/g, " ")}
                          </div>
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            dir="auto"
                            className="text-lg leading-[1.8] text-[#e6e2db] focus:outline-none focus:ring-1 focus:ring-[#f0bd8b]/30 rounded-lg p-2 -m-2 transition-all"
                            style={{ fontFamily: "'Noto Naskh Arabic', 'Amiri', serif" }}
                            onBlur={(e) => {
                              const newValue = e.currentTarget.textContent || "";
                              setEditedFields(prev => ({ ...prev, [key]: newValue }));
                            }}
                            dangerouslySetInnerHTML={{ __html: String(val) }}
                          />
                        </div>
                      ))}
                  </div>
                )}

                {/* "Click to add more" placeholder */}
                <button
                  className="text-sm text-white/20 hover:text-white/40 italic transition-colors"
                  onClick={() => {
                    // Focus the last contentEditable
                    const editables = document.querySelectorAll("[contenteditable]");
                    if (editables.length > 0) {
                      (editables[editables.length - 1] as HTMLElement).focus();
                    }
                  }}
                >
                  …Click to add more
                </button>

                {/* Researcher Notes (collapsible) */}
                <details className="mt-8 group/notes">
                  <summary className="flex items-center gap-2 cursor-pointer text-sm text-white/50 hover:text-white/70 transition-colors py-2 px-3 rounded-lg border border-white/5 hover:border-white/10">
                    <span className="text-white/30">≡</span>
                    Researcher Notes
                    <ChevronDown className="w-3.5 h-3.5 ml-auto group-open/notes:rotate-180 transition-transform" />
                  </summary>
                  <div className="mt-2">
                    <textarea
                      className="w-full min-h-[80px] bg-transparent border border-white/5 rounded-lg p-3 text-sm text-white/70 placeholder:text-white/20 focus:outline-none focus:border-[#f0bd8b]/30 resize-y"
                      placeholder="Add notes about this document…"
                      value={String(getNestedValue(editedFields, "notes") ?? getNestedValue(editedFields, "researcher_notes") ?? "")}
                      onChange={(e) => {
                        const key = flatFields?.find(f => f.key === "notes" || f.key === "researcher_notes")?.key || "notes";
                        setEditedFields(prev => setNestedValue(prev, key, e.target.value));
                      }}
                    />
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Sticky Bottom Action Bar ───────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-white/5 bg-[#141310]/95 backdrop-blur-sm px-4 md:px-6 py-3">
        <div className="flex items-center justify-center gap-2 md:gap-3 max-w-2xl mx-auto">
          {/* Prev */}
          <button
            onClick={handlePrev}
            disabled={currentIndex <= 0}
            className="flex flex-col items-center gap-0.5 px-3 md:px-4 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-[10px] hidden md:block">← Prev</span>
          </button>

          {/* Next */}
          <button
            onClick={handleNext}
            disabled={currentIndex >= documents.length - 1}
            className="flex flex-col items-center gap-0.5 px-3 md:px-4 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
            <span className="text-[10px] hidden md:block">→ Next</span>
          </button>

          {/* Skip */}
          <button
            onClick={handleSkip}
            disabled={currentIndex >= documents.length - 1}
            className="px-4 md:px-5 py-2.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Skip
          </button>

          {/* Flag */}
          <button
            onClick={() => handleSave("flagged")}
            disabled={isSaving || !transcription}
            className="flex items-center gap-1.5 px-4 md:px-5 py-2.5 rounded-lg border border-white/10 text-white/60 hover:text-orange-300 hover:border-orange-500/30 hover:bg-orange-500/5 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Flag className="w-3.5 h-3.5" />
            <span>Flag</span>
            <kbd className="hidden md:inline text-[10px] text-white/30 ml-1">F</kbd>
          </button>

          {/* Approve (primary) */}
          <button
            onClick={() => handleSave("reviewed")}
            disabled={isSaving || !transcription}
            className="flex items-center gap-1.5 px-5 md:px-7 py-2.5 rounded-lg bg-[#f0bd8b] text-[#1a1400] hover:bg-[#d4a373] text-sm font-semibold shadow-lg shadow-[#f0bd8b]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>Approve</span>
            <kbd className="hidden md:inline text-[10px] text-[#1a1400]/50 ml-1">⌘ + Enter</kbd>
          </button>
        </div>
      </div>

      {/* Help FAB */}
      <button
        className="fixed bottom-20 right-4 md:bottom-20 md:right-6 w-9 h-9 rounded-full bg-[#2b2a26] border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-[#363530] transition-colors shadow-lg z-10"
        title="Keyboard shortcuts: ⌘+Enter = Approve, F = Flag, ← → = Navigate"
        onClick={() => toast.info("Shortcuts: ⌘+Enter = Approve, F = Flag, ← → = Navigate, Skip = jump to next")}
      >
        <HelpCircle className="w-4 h-4" />
      </button>
    </div>
  );
}
