import { useState, useEffect } from "react";
import type { Project } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Loader2, Save, AlertTriangle, Sparkles, RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  projectId: number;
  project: Project;
}

export default function ProjectSettings({ projectId, project }: Props) {
  const utils = trpc.useUtils();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt ?? "");
  const [pass2Prompt, setPass2Prompt] = useState(project.pass2Prompt ?? "");
  const [modelName, setModelName] = useState(project.modelName);
  const [pipelineType, setPipelineType] = useState(project.pipelineType);
  const [temperature, setTemperature] = useState(project.temperature);
  const [maxTokens, setMaxTokens] = useState(project.maxTokens);
  const [jsonSchemaStr, setJsonSchemaStr] = useState(
    project.jsonSchema ? JSON.stringify(project.jsonSchema, null, 2) : "{}"
  );
  const [glossaryStr, setGlossaryStr] = useState(
    project.glossary ? JSON.stringify(project.glossary, null, 2) : "{}"
  );
  const [jsonSchemaValid, setJsonSchemaValid] = useState(true);
  const [glossaryValid, setGlossaryValid] = useState(true);

  const generateSchema = trpc.projects.generateSchema.useMutation({
    onSuccess: (data) => {
      const pretty = JSON.stringify(data.schema, null, 2);
      setJsonSchemaStr(pretty);
      setJsonSchemaValid(true);
      toast.success("Schema generated — review and save when ready");
    },
    onError: (err) => toast.error(`Schema generation failed: ${err.message}`),
  });

  const generateGlossary = trpc.projects.generateGlossary.useMutation({
    onSuccess: (data) => {
      const pretty = JSON.stringify(data.glossary, null, 2);
      setGlossaryStr(pretty);
      setGlossaryValid(true);
      toast.success("Glossary generated — review and save when ready");
    },
    onError: (err) => toast.error(`Glossary generation failed: ${err.message}`),
  });

  const reindexAll = trpc.projects.reindexAll.useMutation({
    onSuccess: (data) => {
      if (data.indexed === 0) {
        toast.info("All reviewed documents are already indexed");
      } else {
        toast.success(`Successfully indexed ${data.indexed} document${data.indexed !== 1 ? "s" : ""}`);
      }
    },
    onError: (err) => toast.error(`Re-indexing failed: ${err.message}`),
  });

  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => {
      toast.success("Settings saved");
      utils.projects.get.invalidate({ id: projectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteProjectMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("Project deleted");
      window.location.href = "/dashboard";
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSave = () => {
    let jsonSchema: Record<string, unknown> | undefined;
    let glossary: Record<string, string> | undefined;

    try {
      jsonSchema = JSON.parse(jsonSchemaStr);
      setJsonSchemaValid(true);
    } catch {
      setJsonSchemaValid(false);
      toast.error("Invalid JSON in schema");
      return;
    }

    try {
      glossary = JSON.parse(glossaryStr);
      setGlossaryValid(true);
    } catch {
      setGlossaryValid(false);
      toast.error("Invalid JSON in glossary");
      return;
    }

    updateProject.mutate({
      id: projectId,
      name,
      description: description || undefined,
      systemPrompt,
      pass2Prompt: pass2Prompt || undefined,
      modelName,
      pipelineType,
      temperature,
      maxTokens,
      jsonSchema,
      glossary,
    });
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h2 className="text-2xl font-serif font-semibold mb-1">Project settings</h2>
        <p className="text-muted-foreground text-sm">
          Manually edit your AI configuration. Changes take effect on the next transcription run.
        </p>
      </div>

      <div className="space-y-8">
        {/* General */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">General</h3>
          <div className="space-y-4">
            <div>
              <Label>Project name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="bg-background mt-1.5" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} className="bg-background mt-1.5 resize-none" rows={2} />
            </div>
          </div>
        </section>

        {/* Pipeline */}
        <section className="border-t border-border pt-8">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Pipeline configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Pipeline type</Label>
              <Select value={pipelineType} onValueChange={(v) => setPipelineType(v as "single_pass" | "two_pass")}>
                <SelectTrigger className="bg-background mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_pass">Single pass — image → JSON</SelectItem>
                  <SelectItem value="two_pass">Two pass — image → text → JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Model</Label>
              <Select value={modelName} onValueChange={setModelName}>
                <SelectTrigger className="bg-background mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Gemini 3 — latest generation */}
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gemini 3 (Latest)</div>
                  <SelectItem value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview ✔ — Most advanced</SelectItem>
                  <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash Preview — Fast &amp; capable</SelectItem>
                  {/* Gemini 2.5 */}
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gemini 2.5</div>
                  <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro — Stable</SelectItem>
                  <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash — Fast &amp; stable</SelectItem>
                  {/* Gemini 2.0 */}
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gemini 2.0</div>
                  <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash — Efficient</SelectItem>
                  {/* Gemini 1.5 */}
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gemini 1.5</div>
                  <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                  {/* OpenAI */}
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">OpenAI</div>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o mini — Budget</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-6">
            <div>
              <Label>Temperature: {temperature}</Label>
              <Slider
                value={[temperature]}
                onValueChange={([v]) => setTemperature(v)}
                min={0} max={1} step={0.05}
                className="mt-3"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>Precise</span><span>Creative</span>
              </div>
            </div>
            <div>
              <Label>Max tokens: {maxTokens}</Label>
              <Slider
                value={[maxTokens]}
                onValueChange={([v]) => setMaxTokens(v)}
                min={256} max={32768} step={256}
                className="mt-3"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>256</span><span>32768</span>
              </div>
            </div>
          </div>
        </section>

        {/* System prompt */}
        <section className="border-t border-border pt-8">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">System prompt</h3>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-400/90">
              This is the core instruction set for your transcription AI. Edit carefully — changes affect all future transcriptions.
            </p>
          </div>
          <Textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            className="bg-background font-mono text-xs resize-none"
            rows={12}
            placeholder="You are an expert archival transcription assistant..."
          />
          {pipelineType === "two_pass" && (
            <div className="mt-4">
              <Label>Pass 2 prompt (translation/extraction)</Label>
              <Textarea
                value={pass2Prompt}
                onChange={e => setPass2Prompt(e.target.value)}
                className="bg-background font-mono text-xs resize-none mt-1.5"
                rows={6}
                placeholder="Given the following verbatim transcription, extract structured data..."
              />
            </div>
          )}
        </section>

        {/* JSON Schema */}
        <section className="border-t border-border pt-8">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Output JSON schema</h3>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-7"
              disabled={generateSchema.isPending || !systemPrompt.trim()}
              onClick={() => generateSchema.mutate({ id: projectId, systemPrompt })}
            >
              {generateSchema.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Sparkles className="w-3 h-3" />}
              Generate for me
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Defines the fields the AI should extract. Each key maps to a field definition with <code className="bg-secondary px-1 rounded">type</code> and optional <code className="bg-secondary px-1 rounded">description</code>.
          </p>
          <Textarea
            value={jsonSchemaStr}
            onChange={e => {
              setJsonSchemaStr(e.target.value);
              try { JSON.parse(e.target.value); setJsonSchemaValid(true); } catch { setJsonSchemaValid(false); }
            }}
            className={`bg-background font-mono text-xs resize-none ${!jsonSchemaValid ? "border-destructive" : ""}`}
            rows={10}
          />
          {!jsonSchemaValid && <p className="text-xs text-destructive mt-1">Invalid JSON</p>}
        </section>

        {/* Glossary */}
        <section className="border-t border-border pt-8">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Domain glossary</h3>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-7"
              disabled={generateGlossary.isPending || !systemPrompt.trim()}
              onClick={() => generateGlossary.mutate({ id: projectId, systemPrompt })}
            >
              {generateGlossary.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Sparkles className="w-3 h-3" />}
              Generate for me
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Key-value pairs of domain-specific terms injected into the system prompt. Format: <code className="bg-secondary px-1 rounded">"term": "definition or translation"</code>.
          </p>
          <Textarea
            value={glossaryStr}
            onChange={e => {
              setGlossaryStr(e.target.value);
              try { JSON.parse(e.target.value); setGlossaryValid(true); } catch { setGlossaryValid(false); }
            }}
            className={`bg-background font-mono text-xs resize-none ${!glossaryValid ? "border-destructive" : ""}`}
            rows={8}
          />
          {!glossaryValid && <p className="text-xs text-destructive mt-1">Invalid JSON</p>}
        </section>

        {/* Semantic Index */}
        <section className="border-t border-border pt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Semantic index</h3>
              <p className="text-xs text-muted-foreground max-w-md">
                Generates embeddings for all reviewed documents that are not yet indexed.
                Run this after the initial review batch, or whenever Ask Archive and Search return no results.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 flex-shrink-0"
              disabled={reindexAll.isPending}
              onClick={() => reindexAll.mutate({ id: projectId })}
            >
              {reindexAll.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              {reindexAll.isPending ? "Indexing…" : "Re-index all"}
            </Button>
          </div>
        </section>

        {/* Save */}
        <div className="border-t border-border pt-6 flex justify-end">
          <Button onClick={handleSave} disabled={updateProject.isPending} className="gap-2">
            {updateProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save settings
          </Button>
        </div>

        {/* ─── Danger Zone ─────────────────────────────────────────────── */}
        <div className="border-t border-red-500/30 pt-6 mt-8">
          <h3 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Deleting this project will permanently remove all documents, transcriptions,
            embeddings, entities, and associated data. This action cannot be undone.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2">
                <Trash2 className="w-4 h-4" />
                Delete project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the project and all of its data including
                  documents, transcriptions, embeddings, entities, and export history.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    deleteProjectMutation.mutate({ id: projectId });
                  }}
                  disabled={deleteProjectMutation.isPending}
                >
                  {deleteProjectMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Deleting...</>
                  ) : (
                    "Yes, delete permanently"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
