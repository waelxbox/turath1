import { useState } from "react";
import type { Project } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, RefreshCw, Trash2, ChevronDown, ChevronRight, Settings2 } from "lucide-react";
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  const generateSchema = trpc.projects.generateSchema.useMutation({
    onSuccess: (data) => {
      const pretty = JSON.stringify(data.schema, null, 2);
      setJsonSchemaStr(pretty);
      setJsonSchemaValid(true);
      toast.success("Fields generated — review and save when ready");
    },
    onError: (err) => toast.error(`Generation failed: ${err.message}`),
  });

  const generateGlossary = trpc.projects.generateGlossary.useMutation({
    onSuccess: (data) => {
      const pretty = JSON.stringify(data.glossary, null, 2);
      setGlossaryStr(pretty);
      setGlossaryValid(true);
      toast.success("Glossary generated — review and save when ready");
    },
    onError: (err) => toast.error(`Generation failed: ${err.message}`),
  });

  const reindexAll = trpc.projects.reindexAll.useMutation({
    onSuccess: (data) => {
      if (data.indexed === 0) {
        toast.info("All approved documents are already indexed");
      } else {
        toast.success(`Indexed ${data.indexed} document${data.indexed !== 1 ? "s" : ""} for search`);
      }
    },
    onError: (err) => toast.error(`Indexing failed: ${err.message}`),
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
      toast.error("Invalid JSON in fields definition");
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
        <h2 className="text-2xl font-serif font-semibold mb-1">Settings</h2>
        <p className="text-muted-foreground text-sm">
          Configure how the AI reads and transcribes your documents.
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

        {/* Transcription method — simplified */}
        <section className="border-t border-border pt-8">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Transcription method</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>How the AI reads documents</Label>
              <Select value={pipelineType} onValueChange={(v) => setPipelineType(v as "single_pass" | "two_pass")}>
                <SelectTrigger className="bg-background mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_pass">Direct extraction — image to structured data</SelectItem>
                  <SelectItem value="two_pass">Two-step — read text first, then extract fields</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">Two-step is better for complex handwriting or multi-language documents.</p>
            </div>
            <div>
              <Label>AI model</Label>
              <Select value={modelName} onValueChange={setModelName}>
                <SelectTrigger className="bg-background mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recommended</div>
                  <SelectItem value="gemini-3.1-pro-preview">Gemini 3.1 Pro — Most accurate</SelectItem>
                  <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash — Fast and capable</SelectItem>
                  <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro — Stable</SelectItem>
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Other options</div>
                  <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash — Fast</SelectItem>
                  <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash — Budget</SelectItem>
                  <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o mini — Budget</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Fields to extract */}
        <section className="border-t border-border pt-8">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fields to extract</h3>
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
              Auto-generate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Define what information the AI should extract from each document (e.g., date, author, title, body text).
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
          {!jsonSchemaValid && <p className="text-xs text-destructive mt-1">Invalid JSON format</p>}
        </section>

        {/* AI instructions (system prompt) */}
        <section className="border-t border-border pt-8">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">AI instructions</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Tell the AI how to read your documents — what language they're in, what to look for, and how to handle unclear text.
          </p>
          <Textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            className="bg-background font-mono text-xs resize-none"
            rows={10}
            placeholder="You are an expert archival transcription assistant..."
          />
          {pipelineType === "two_pass" && (
            <div className="mt-4">
              <Label>Step 2 instructions (extraction from raw text)</Label>
              <Textarea
                value={pass2Prompt}
                onChange={e => setPass2Prompt(e.target.value)}
                className="bg-background font-mono text-xs resize-none mt-1.5"
                rows={5}
                placeholder="Given the following verbatim transcription, extract structured data..."
              />
            </div>
          )}
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
              Auto-generate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Specialized terms the AI should know — names, places, abbreviations, and their meanings.
          </p>
          <Textarea
            value={glossaryStr}
            onChange={e => {
              setGlossaryStr(e.target.value);
              try { JSON.parse(e.target.value); setGlossaryValid(true); } catch { setGlossaryValid(false); }
            }}
            className={`bg-background font-mono text-xs resize-none ${!glossaryValid ? "border-destructive" : ""}`}
            rows={6}
          />
          {!glossaryValid && <p className="text-xs text-destructive mt-1">Invalid JSON format</p>}
        </section>

        {/* Advanced settings — collapsed by default */}
        <section className="border-t border-border pt-8">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-left"
          >
            <Settings2 className="w-4 h-4" />
            <span className="font-medium">Advanced settings</span>
            {showAdvanced
              ? <ChevronDown className="w-4 h-4 ml-auto" />
              : <ChevronRight className="w-4 h-4 ml-auto" />
            }
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-6 pl-6 border-l border-border">
              {/* Temperature & tokens */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label>Creativity: {temperature}</Label>
                  <Slider
                    value={[temperature]}
                    onValueChange={([v]) => setTemperature(v)}
                    min={0} max={1} step={0.05}
                    className="mt-3"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Precise</span><span>Creative</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Lower = more consistent. Higher = more varied readings.</p>
                </div>
                <div>
                  <Label>Max output length: {maxTokens}</Label>
                  <Slider
                    value={[maxTokens]}
                    onValueChange={([v]) => setMaxTokens(v)}
                    min={256} max={32768} step={256}
                    className="mt-3"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Short</span><span>Long</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Increase for documents with lots of text.</p>
                </div>
              </div>

              {/* Re-index */}
              <div className="flex items-start justify-between gap-4 pt-4 border-t border-border/50">
                <div>
                  <h4 className="text-sm font-medium mb-1">Rebuild search index</h4>
                  <p className="text-xs text-muted-foreground max-w-md">
                    If Search or Ask Archive aren't finding your approved documents, rebuild the index.
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
                  {reindexAll.isPending ? "Indexing…" : "Rebuild index"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Save */}
        <div className="border-t border-border pt-6 flex justify-end">
          <Button onClick={handleSave} disabled={updateProject.isPending} className="gap-2">
            {updateProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save settings
          </Button>
        </div>

        {/* Danger Zone */}
        <div className="border-t border-red-500/30 pt-6 mt-8">
          <h3 className="text-sm font-semibold text-red-400 mb-2">Danger zone</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Permanently delete this project and all its documents, transcriptions, and data.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-2">
                <Trash2 className="w-3.5 h-3.5" />
                Delete project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the project and all of its data including
                  documents, transcriptions, and entities. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteProjectMutation.mutate({ id: projectId })}
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
