import { useState, useRef, useCallback, useMemo } from "react";
import type { Project } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Loader2, CheckCircle2, XCircle, FileImage, FileText, ArrowRight, Layers } from "lucide-react";
import { useLocation } from "wouter";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { splitPdfToImages } from "@/lib/pdfSplitter";

interface Props {
  projectId: number;
  project: Project;
}

interface QueuedFile {
  id: string;
  file: File;
  status: "queued" | "splitting" | "uploading" | "transcribing" | "done" | "error";
  error?: string;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

export default function UploadPage({ projectId, project }: Props) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isMultiPage, setIsMultiPage] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [pdfSplitting, setPdfSplitting] = useState(false);
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, percent: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();

  const uploadDoc = trpc.documents.upload.useMutation();
  const transcribeDoc = trpc.documents.transcribe.useMutation();
  const createGroup = trpc.groups.create.useMutation();
  const transcribeWithContext = trpc.groups.transcribeWithContext.useMutation();

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const validFiles = Array.from(files).filter(
      f => f.type.startsWith("image/") || f.type === "application/pdf"
    );
    const pdfFiles = validFiles.filter(f => f.type === "application/pdf");
    const imageFiles = validFiles.filter(f => f.type.startsWith("image/"));

    // Add image files directly
    const imageEntries: QueuedFile[] = imageFiles.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      status: "queued" as const,
    }));
    if (imageEntries.length > 0) {
      setQueue(prev => [...prev, ...imageEntries]);
    }

    // Split PDFs into page images
    if (pdfFiles.length > 0) {
      setPdfSplitting(true);
      setPdfProgress({ current: 0, total: 0, percent: 0 });
      (async () => {
        const pdfEntries: QueuedFile[] = [];
        for (const pdf of pdfFiles) {
          try {
            const pages = await splitPdfToImages(pdf, (percent, current, total) => {
              setPdfProgress({ current, total, percent });
            });
            for (const page of pages) {
              const file = new File([page.blob], page.filename, { type: "image/png" });
              pdfEntries.push({ id: crypto.randomUUID(), file, status: "queued" as const });
            }
            toast.success(`Split "${pdf.name}" into ${pages.length} page images`);
          } catch (err) {
            toast.error(`Failed to split "${pdf.name}": ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        setQueue(prev => [...prev, ...pdfEntries]);
        setPdfSplitting(false);
        if (pdfEntries.length > 1) {
          setIsMultiPage(true);
          if (!groupTitle.trim()) {
            setGroupTitle(pdfFiles[0].name.replace(/\.pdf$/i, ""));
          }
        }
      })();
    }
    setShowSuccess(false);
  }, []);

  const updateStatus = useCallback((id: string, status: QueuedFile["status"], error?: string) => {
    setQueue(prev => prev.map(q => q.id === id ? { ...q, status, error } : q));
  }, []);

  const processQueue = async () => {
    const pending = queue.filter(q => q.status === "queued");
    if (pending.length === 0) return;
    setIsProcessing(true);

    if (isMultiPage && pending.length > 1) {
      // Multi-page mode: upload all pages first, then create group, then transcribe with context
      const uploadedDocIds: number[] = [];
      
      // Upload all pages sequentially to maintain order
      for (const item of pending) {
        try {
          updateStatus(item.id, "uploading");
          const base64 = await readFileAsBase64(item.file);
          const doc = await uploadDoc.mutateAsync({
            projectId,
            filename: item.file.name,
            fileBase64: base64,
            mimeType: item.file.type,
            fileSizeBytes: item.file.size,
          });
          if (doc) uploadedDocIds.push(doc.id);
          updateStatus(item.id, "done");
        } catch (err) {
          updateStatus(item.id, "error", err instanceof Error ? err.message : String(err));
        }
      }

      // Create the group
      if (uploadedDocIds.length > 0) {
        const title = groupTitle.trim() || `Multi-page document (${uploadedDocIds.length} pages)`;
        try {
          const group = await createGroup.mutateAsync({
            projectId,
            title,
            documentIds: uploadedDocIds,
          });

          // Transcribe each page with context from previous pages
          for (let i = 0; i < uploadedDocIds.length; i++) {
            const item = pending[i];
            if (item) updateStatus(item.id, "transcribing");
            try {
              await transcribeWithContext.mutateAsync({
                groupId: group.id,
                projectId,
                documentId: uploadedDocIds[i],
              });
              if (item) updateStatus(item.id, "done");
            } catch (err) {
              if (item) updateStatus(item.id, "error", err instanceof Error ? err.message : String(err));
            }
          }

          toast.success(`Multi-page document "${title}" created with ${uploadedDocIds.length} pages`);
        } catch (err) {
          toast.error(`Failed to create group: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      setIsProcessing(false);
      setShowSuccess(true);
      utils.projects.stats.invalidate({ id: projectId });
      utils.documents.list.invalidate({ projectId });
      utils.documents.listPaginated.invalidate();
      return;
    }

    // Standard single-page mode
    const tasks = pending.map(item => async () => {
      updateStatus(item.id, "uploading");
      const base64 = await readFileAsBase64(item.file);

      const doc = await uploadDoc.mutateAsync({
        projectId,
        filename: item.file.name,
        fileBase64: base64,
        mimeType: item.file.type,
        fileSizeBytes: item.file.size,
      });

      updateStatus(item.id, "transcribing");

      if (doc) {
        await transcribeDoc.mutateAsync({ documentId: doc.id, projectId });
      }

      updateStatus(item.id, "done");
    });

    const results = await runWithConcurrency(tasks, 10);

    results.forEach((result, i) => {
      if (result.status === "rejected") {
        const err = result.reason;
        updateStatus(pending[i].id, "error", err instanceof Error ? err.message : String(err));
      }
    });

    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    setIsProcessing(false);
    utils.projects.stats.invalidate({ id: projectId });
    utils.documents.list.invalidate({ projectId });

    if (failed === 0) {
      setShowSuccess(true);
      toast.success(`${succeeded} document${succeeded !== 1 ? "s" : ""} uploaded and transcribed`);
    } else {
      toast.warning(`${succeeded} succeeded, ${failed} failed`);
    }
  };

  const statusIcon = (status: QueuedFile["status"]) => {
    switch (status) {
      case "queued": return <div className="w-4 h-4 rounded-full border border-border" />;
      case "splitting": return <Loader2 className="w-4 h-4 animate-spin text-blue-600" />;
      case "uploading": return <Loader2 className="w-4 h-4 animate-spin text-amber-700 dark:text-amber-400" />;
      case "transcribing": return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case "done": return <CheckCircle2 className="w-4 h-4 text-green-700 dark:text-green-400" />;
      case "error": return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />;
    }
  };

  const statusLabel = (status: QueuedFile["status"]) => {
    switch (status) {
      case "queued": return "Ready";
      case "splitting": return "Splitting PDF…";
      case "uploading": return "Uploading…";
      case "transcribing": return "AI reading…";
      case "done": return "Complete";
      case "error": return "Failed";
    }
  };

  const queuedCount = queue.filter(q => q.status === "queued").length;
  const doneCount = queue.filter(q => q.status === "done").length;
  const processingCount = queue.filter(q => q.status === "uploading" || q.status === "transcribing").length;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-serif font-semibold mb-1">Upload documents</h2>
        <p className="text-muted-foreground text-sm">
          Add scanned document images. The AI will read and transcribe each one automatically.
        </p>
      </div>

      {/* Multi-page toggle */}
      <div className="flex items-center gap-3 mb-6 p-4 bg-card border border-border rounded-xl">
        <Layers className="w-5 h-5 text-muted-foreground" />
        <div className="flex-1">
          <Label htmlFor="multipage-toggle" className="text-sm font-medium cursor-pointer">
            Upload as multi-page document
          </Label>
          <p className="text-xs text-muted-foreground">
            Group multiple page images into one logical document. Pages share metadata (sender, date) but have separate transcriptions.
          </p>
        </div>
        <Switch id="multipage-toggle" checked={isMultiPage} onCheckedChange={setIsMultiPage} />
      </div>

      {/* Group title input (only in multi-page mode) */}
      {isMultiPage && queue.length > 0 && (
        <div className="mb-4">
          <Label className="text-sm mb-1.5 block">Document title</Label>
          <Input
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
            placeholder="e.g., Letter from Behna to Mizrahi, June 1936 (3 pages)"
            className="bg-background"
          />
        </div>
      )}

      {/* Drop zone */}
      <div
        className="border-2 border-dashed border-border rounded-xl p-12 text-center mb-6 hover:border-primary/50 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      >
        <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-medium mb-1">Drop images here or click to browse</p>
        <p className="text-sm text-muted-foreground">JPEG, PNG, TIFF, or PDF — PDFs are automatically split into page images</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {/* PDF splitting progress */}
      {pdfSplitting && (
        <div className="flex items-center gap-3 mb-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <div className="flex-1">
            <p className="text-sm font-medium">Splitting PDF into pages…</p>
            <p className="text-xs text-muted-foreground">
              Page {pdfProgress.current} of {pdfProgress.total} ({pdfProgress.percent}%)
            </p>
          </div>
        </div>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h3 className="text-sm font-medium">
              {isProcessing
                ? `Processing… (${processingCount} active)`
                : showSuccess
                  ? `${doneCount} document${doneCount !== 1 ? "s" : ""} transcribed`
                  : `${queue.length} file${queue.length !== 1 ? "s" : ""} selected`
              }
            </h3>
            {showSuccess && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => { setQueue([]); setShowSuccess(false); }}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {queue.map(item => (
              <div key={item.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <FileImage className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 truncate">{item.file.name}</span>
                <div className="flex items-center gap-1.5">
                  {statusIcon(item.status)}
                  <span className={`text-xs ${item.status === "done" ? "text-green-700 dark:text-green-400" : item.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Primary action */}
      {queuedCount > 0 && !isProcessing && (
        <Button onClick={processQueue} size="lg" className="gap-2 w-full sm:w-auto">
          <Upload className="w-4 h-4" />
          Upload and transcribe {queuedCount} file{queuedCount !== 1 ? "s" : ""}
        </Button>
      )}

      {/* Success state — guide to next step */}
      {showSuccess && doneCount > 0 && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5 mt-6">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 dark:text-green-400" />
            <span className="text-sm font-medium text-green-700 dark:text-green-400">Upload complete</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Your documents have been transcribed by the AI. Review them to check accuracy, then they'll be available in Search and Ask Archive.
          </p>
          <Button onClick={() => navigate("/review")} className="gap-2">
            Review transcriptions
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
