import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Upload, Loader2, CheckCircle2, XCircle,
  Wand2, AlertTriangle, ChevronRight, Trash2, Eye
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

type Step = "samples" | "generating" | "validation" | "refine" | "launch";

interface SampleEntry {
  id: string;
  filename: string;
  imageBase64: string;
  mimeType: string;
  previewUrl: string;
  transcriptionText: string; // plain text — converted to JSON internally
  isHeldOut: boolean;
  uploaded: boolean;
}

interface ValidationResult {
  aiOutput: Record<string, unknown>;
  score: number;
  fieldComparisons: Array<{ field: string; expected: unknown; actual: unknown; match: boolean; similarity?: number }>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToPreview(file: File): string {
  return URL.createObjectURL(file);
}

function StepIndicator({ current, steps }: { current: Step; steps: { id: Step; label: string }[] }) {
  const idx = steps.findIndex(s => s.id === current);
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 ${i <= idx ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-medium transition-all
              ${i < idx ? "bg-primary border-primary text-primary-foreground" :
                i === idx ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
              {i < idx ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className="text-xs hidden sm:block">{step.label}</span>
          </div>
          {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-border" />}
        </div>
      ))}
    </div>
  );
}

export default function Onboarding() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id ?? "0");
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [step, setStep] = useState<Step>("samples");
  const [samples, setSamples] = useState<SampleEntry[]>([]);
  const [generatedConfig, setGeneratedConfig] = useState<Record<string, unknown> | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [refineCount, setRefineCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId });

  const uploadSample = trpc.onboarding.uploadSample.useMutation();
  const generateConfig = trpc.onboarding.generateConfig.useMutation();
  const validate = trpc.onboarding.validate.useMutation();
  const refine = trpc.onboarding.refine.useMutation();
  const activate = trpc.onboarding.activate.useMutation();
  const updateProject = trpc.projects.update.useMutation();
  const [isSkipping, setIsSkipping] = useState(false);

  const handleSkip = async () => {
    if (!projectId) return;
    setIsSkipping(true);
    try {
      await updateProject.mutateAsync({ id: projectId, status: "active" });
      toast.success("Project activated — configure your settings manually");
      navigate(`/projects/${projectId}/settings`);
    } catch {
      toast.error("Failed to activate project");
      setIsSkipping(false);
    }
  };

  const handleFileAdd = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const newEntries: SampleEntry[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) { toast.error(`${file.name} is not an image`); continue; }
      const base64 = await fileToBase64(file);
      const preview = fileToPreview(file);
      newEntries.push({
        id: crypto.randomUUID(),
        filename: file.name,
        imageBase64: base64,
        mimeType: file.type,
        previewUrl: preview,
        transcriptionText: "",
        isHeldOut: false,
        uploaded: false,
      });
    }
    setSamples(prev => [...prev, ...newEntries].slice(0, 5));
  }, []);

  const updateTranscription = (id: string, value: string) => {
    setSamples(prev => prev.map(s => s.id !== id ? s : { ...s, transcriptionText: value }));
  };

  /** Convert plain text to a JSON object the server accepts */
  const textToJson = (text: string): Record<string, unknown> => {
    // Try to parse as JSON first (power users can still paste JSON)
    try { return JSON.parse(text); } catch { /* not JSON, wrap as plain text */ }
    return { transcription_text: text };
  };

  const toggleHeldOut = (id: string) => {
    setSamples(prev => {
      const target = prev.find(s => s.id === id);
      if (!target) return prev;
      // Only one can be held out
      return prev.map(s => ({ ...s, isHeldOut: s.id === id ? !target.isHeldOut : false }));
    });
  };

  const removeSample = (id: string) => {
    setSamples(prev => prev.filter(s => s.id !== id));
  };

  const handleGenerate = async () => {
    const valid = samples.filter(s => s.transcriptionText.trim().length > 0);
    if (valid.length < 1) {
      toast.error("Add at least 1 sample with a transcription");
      return;
    }

    setStep("generating");

    try {
      // Upload all samples first
      for (const sample of samples) {
        if (sample.uploaded) continue;
        if (!sample.transcriptionText.trim()) continue;
        await uploadSample.mutateAsync({
          projectId,
          filename: sample.filename,
          imageBase64: sample.imageBase64,
          mimeType: sample.mimeType,
          manualTranscription: textToJson(sample.transcriptionText),
          isHeldOut: sample.isHeldOut,
        });
        setSamples(prev => prev.map(s => s.id === sample.id ? { ...s, uploaded: true } : s));
      }

      // Generate config
      const config = await generateConfig.mutateAsync({ projectId });
      setGeneratedConfig(config as unknown as Record<string, unknown>);

      // Auto-validate
      const result = await validate.mutateAsync({ projectId });
      setValidationResult(result as ValidationResult);
      setStep("validation");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
      setStep("samples");
    }
  };

  const handleRefine = async () => {
    if (!feedback.trim()) return;
    try {
      const refined = await refine.mutateAsync({ projectId, feedback });
      setGeneratedConfig(refined as unknown as Record<string, unknown>);
      const result = await validate.mutateAsync({ projectId });
      setValidationResult(result as ValidationResult);
      setRefineCount(c => c + 1);
      setFeedback("");
      toast.success("Config refined and re-validated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refinement failed");
    }
  };

  const handleActivate = async () => {
    try {
      await activate.mutateAsync({ projectId });
      toast.success("Project activated!");
      navigate(`/projects/${projectId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Activation failed");
    }
  };

  if (authLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { window.location.href = getLoginUrl(); return null; }

  const STEPS = [
    { id: "samples" as Step, label: "Teach the AI" },
    { id: "generating" as Step, label: "Building config" },
    { id: "validation" as Step, label: "Check accuracy" },
    { id: "launch" as Step, label: "Start project" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="text-sm font-medium">{project?.name ?? "New project"}</div>
              <div className="text-xs text-muted-foreground">Project setup</div>
            </div>
          </div>
          <StepIndicator current={step} steps={STEPS} />
        </div>
      </header>

      <main className="container py-10 max-w-4xl">

        {/* ── STEP: SAMPLES ── */}
        {step === "samples" && (
          <div>
            <div className="mb-8">
              <h1 className="text-2xl font-serif font-semibold mb-2">Teach the AI how to read your documents</h1>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">
                Upload 3–5 example documents with your ideal transcriptions. The AI learns from these
                examples to read the rest of your archive. Optionally mark one as a "test" — the AI will
                check its own accuracy against it.
              </p>
            </div>

            {/* Drop zone */}
            <div
              className="border-2 border-dashed border-border rounded-xl p-8 text-center mb-6 hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFileAdd(e.dataTransfer.files); }}
            >
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">Drop images here or click to browse</p>
              <p className="text-xs text-muted-foreground">JPEG, PNG, TIFF — up to 5 samples</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => handleFileAdd(e.target.files)}
              />
            </div>

            {/* Sample list */}
            {samples.length > 0 && (
              <div className="space-y-4 mb-8">
                {samples.map((sample, i) => (
                  <div key={sample.id} className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-mono">#{i + 1}</span>
                        <span className="text-sm font-medium">{sample.filename}</span>
                        {sample.isHeldOut && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            held out
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`text-xs h-7 ${sample.isHeldOut ? "text-amber-400" : "text-muted-foreground"}`}
                          onClick={() => toggleHeldOut(sample.id)}
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          {sample.isHeldOut ? "Test sample" : "Use as test"}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeSample(sample.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-0">
                      {/* Image preview */}
                      <div className="border-r border-border p-4">
                        <img
                          src={sample.previewUrl}
                          alt={sample.filename}
                          className="w-full max-h-48 object-contain rounded bg-black/20"
                        />
                      </div>
                      {/* Transcription input */}
                      <div className="p-4">
                        <Label className="text-xs text-muted-foreground mb-2 block">
                          Your ideal transcription
                        </Label>
                        <Textarea
                          value={sample.transcriptionText}
                          onChange={e => updateTranscription(sample.id, e.target.value)}
                          placeholder="Type or paste the ideal transcription of this document exactly as you want it to appear — any language, any format. The AI will learn your style from this."
                          className="text-xs bg-background resize-none h-36 leading-relaxed"
                        />
                        {sample.transcriptionText.trim().length > 0 && (
                          <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Ready
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  {samples.filter(s => s.transcriptionText.trim().length > 0).length} / {samples.length} samples ready
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  disabled={isSkipping}
                  className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
                >
                  {isSkipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Skip — configure manually
                </Button>
              </div>
              <Button
                onClick={handleGenerate}
                disabled={samples.filter(s => s.transcriptionText.trim().length > 0).length < 1}
                className="gap-2"
              >
                <Wand2 className="w-4 h-4" />
                Build my AI reader
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP: GENERATING ── */}
        {step === "generating" && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-6">
              <Wand2 className="w-8 h-8 text-primary animate-pulse" />
            </div>
            <h2 className="text-2xl font-serif font-semibold mb-3">Building your custom AI reader</h2>
            <p className="text-muted-foreground text-sm max-w-md mb-8 leading-relaxed">
              The AI is studying your examples to learn how to read your documents.
              This usually takes 30–60 seconds.
            </p>
            <div className="space-y-2 text-sm text-muted-foreground">
              {[
                "Uploading your examples...",
                "Analyzing document structure...",
                "Learning domain-specific terms...",
                "Building reading instructions...",
                "Testing accuracy against your example...",
              ].map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  <span>{msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP: VALIDATION ── */}
        {step === "validation" && validationResult && (
          <div>
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-serif font-semibold">Validation results</h1>
                <div className={`px-3 py-1 rounded-full text-sm font-semibold border ${
                  validationResult.score >= 80 ? "bg-green-500/15 text-green-400 border-green-500/30" :
                  validationResult.score >= 50 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" :
                  "bg-red-500/15 text-red-400 border-red-500/30"
                }`}>
                  {validationResult.score}% match
                </div>
                {refineCount > 0 && (
                  <span className="text-xs text-muted-foreground">Refined {refineCount}×</span>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                The AI tested itself against your example. See how closely its output matches yours below.
              </p>
            </div>

            {/* Generated config summary */}
            {generatedConfig && (
              <div className="bg-card border border-border rounded-xl p-5 mb-6">
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Generated configuration</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Pipeline</div>
                    <div className="font-medium capitalize">{String(generatedConfig.pipelineType ?? "").replace("_", " ")}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Model</div>
                    <div className="font-medium font-mono text-xs">{String(generatedConfig.modelName ?? "")}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Schema fields</div>
                    <div className="font-medium">{Object.keys((generatedConfig.jsonSchema as Record<string, unknown>) ?? {}).length}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Glossary terms</div>
                    <div className="font-medium">{Object.keys((generatedConfig.glossary as Record<string, unknown>) ?? {}).length}</div>
                  </div>
                </div>
                {!!generatedConfig["reasoning"] && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-xs text-muted-foreground mb-1">AI reasoning</div>
                    <p className="text-sm text-foreground/80 italic">{String(generatedConfig["reasoning"] ?? "")}</p>
                  </div>
                )}
              </div>
            )}

            {/* Field comparison — human-readable side-by-side diff */}
            <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold">Field-by-field comparison</h3>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-400" /> Match (≥70%)</span>
                  <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" /> Mismatch</span>
                </div>
              </div>
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-3 px-5 py-2 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <div className="col-span-2">Field</div>
                <div className="col-span-1 text-center">Match</div>
                <div className="col-span-4">Your manual transcription</div>
                <div className="col-span-4">AI output</div>
                <div className="col-span-1 text-right">Score</div>
              </div>
              <div className="divide-y divide-border">
                {validationResult.fieldComparisons.map(fc => {
                  // Format value as readable text (not raw JSON)
                  const formatVal = (v: unknown): string => {
                    if (v === null || v === undefined) return "—";
                    if (typeof v === "string") return v || "(empty)";
                    if (typeof v === "boolean") return v ? "Yes" : "No";
                    if (Array.isArray(v)) return v.join(", ") || "(empty)";
                    if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, val]) => `${k}: ${val}`).join("\n");
                    return String(v);
                  };
                  const pct = fc.similarity !== undefined ? Math.round(fc.similarity * 100) : (fc.match ? 100 : 0);
                  const isLong = (formatVal(fc.expected).length > 80 || formatVal(fc.actual).length > 80);
                  return (
                    <div key={fc.field} className={`px-5 py-4 grid grid-cols-12 gap-3 items-start text-sm ${fc.match ? "" : "bg-red-500/5"}`}>
                      <div className="col-span-2">
                        <div className="font-mono text-xs text-muted-foreground break-all">{fc.field}</div>
                      </div>
                      <div className="col-span-1 flex justify-center pt-0.5">
                        {fc.match
                          ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                          : <XCircle className="w-4 h-4 text-red-400" />
                        }
                      </div>
                      {/* Expected */}
                      <div className="col-span-4">
                        <div className={`text-sm rounded-lg p-3 bg-background border border-border leading-relaxed whitespace-pre-wrap break-words ${isLong ? "max-h-40 overflow-y-auto" : ""}`}>
                          {formatVal(fc.expected)}
                        </div>
                      </div>
                      {/* AI output */}
                      <div className="col-span-4">
                        <div className={`text-sm rounded-lg p-3 border leading-relaxed whitespace-pre-wrap break-words ${
                          fc.match
                            ? "bg-green-500/10 border-green-500/20"
                            : "bg-red-500/10 border-red-500/20"
                        } ${isLong ? "max-h-40 overflow-y-auto" : ""}`}>
                          {formatVal(fc.actual)}
                        </div>
                      </div>
                      {/* Similarity score */}
                      <div className="col-span-1 flex justify-end pt-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          pct >= 80 ? "bg-green-500/15 text-green-400" :
                          pct >= 50 ? "bg-yellow-500/15 text-yellow-400" :
                          "bg-red-500/15 text-red-400"
                        }`}>{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Refinement */}
            {validationResult.score < 100 && (
              <div className="bg-card border border-amber-500/30 rounded-xl p-5 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-amber-400">Refine the configuration</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Describe what the AI got wrong in plain language. It will update the system prompt and re-validate.
                </p>
                <Textarea
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  placeholder='e.g. "The date field should always be in YYYY-MM-DD format. The title field is missing the document number prefix. Illegible text should use [illegible] not ..."'
                  className="bg-background resize-none text-sm mb-3"
                  rows={3}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefine}
                  disabled={!feedback.trim() || refine.isPending || validate.isPending}
                  className="gap-2 bg-transparent"
                >
                  {(refine.isPending || validate.isPending) && <Loader2 className="w-3 h-3 animate-spin" />}
                  <Wand2 className="w-3 h-3" />
                  Refine & re-validate
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep("samples")} className="gap-2 bg-transparent">
                <ArrowLeft className="w-4 h-4" /> Back to samples
              </Button>
              <Button onClick={handleActivate} disabled={activate.isPending} className="gap-2">
                {activate.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {validationResult.score >= 60 ? (
                  <><CheckCircle2 className="w-4 h-4" /> Launch project</>
                ) : (
                  <>Launch anyway <ArrowRight className="w-4 h-4" /></>
                )}
              </Button>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
