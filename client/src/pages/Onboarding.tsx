import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ArrowLeft, Send, Upload, Loader2, Sparkles, Image as ImageIcon,
  CheckCircle2, ChevronDown, ChevronUp, Settings2
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Streamdown } from "streamdown";

// Onboarding step labels: Teach the AI, Check accuracy, Start project
// Main CTA: Build my AI reader
// Generating state: Building your custom AI reader — usually takes 30–60 seconds

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  imageUrls?: string[];
  imagePreviewUrls?: string[]; // local blob URLs for display
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Onboarding() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id ?? "0");
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedConfig, setGeneratedConfig] = useState<Record<string, unknown> | null>(null);
  const [showConfigPreview, setShowConfigPreview] = useState(false);
  const [pendingImages, setPendingImages] = useState<{ file: File; previewUrl: string; base64: string }[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId });

  const chatMutation = trpc.onboarding.chat.useMutation();
  const uploadImage = trpc.onboarding.chatUploadImage.useMutation();
  const generateFromChat = trpc.onboarding.generateFromChat.useMutation();
  const updateProject = trpc.projects.update.useMutation();

  // Scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Auth guard
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  const handleImageAdd = async (files: FileList | null) => {
    if (!files) return;
    const newImages: { file: File; previewUrl: string; base64: string }[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) { toast.error(`${file.name} is not an image`); continue; }
      const base64 = await fileToBase64(file);
      const previewUrl = URL.createObjectURL(file);
      newImages.push({ file, previewUrl, base64 });
    }
    setPendingImages(prev => [...prev, ...newImages]);
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput && pendingImages.length === 0) return;
    if (isLoading) return;

    // If user sends a message after config was generated, reset so they can regenerate
    if (generatedConfig) {
      setGeneratedConfig(null);
      setShowConfigPreview(false);
      // configReady stays true so the banner reappears after the new response
    }

    setIsLoading(true);

    // Upload images first
    let imageUrls: string[] = [];
    let imagePreviewUrls: string[] = [];
    if (pendingImages.length > 0) {
      try {
        const uploads = await Promise.all(
          pendingImages.map(img =>
            uploadImage.mutateAsync({
              projectId,
              filename: img.file.name,
              imageBase64: img.base64,
              mimeType: img.file.type,
            })
          )
        );
        imageUrls = uploads.map(u => u.imageUrl);
        imagePreviewUrls = pendingImages.map(p => p.previewUrl);
      } catch {
        toast.error("Failed to upload images");
        setIsLoading(false);
        return;
      }
    }

    const userMsg: ChatMsg = {
      role: "user",
      content: trimmedInput || "(uploaded images)",
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      imagePreviewUrls: imagePreviewUrls.length > 0 ? imagePreviewUrls : undefined,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setPendingImages([]);

    try {
      const result = await chatMutation.mutateAsync({
        projectId,
        messages: newMessages.map(m => ({
          role: m.role,
          content: m.content,
          imageUrls: m.imageUrls,
        })),
      });

      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: result.response,
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (result.configReady) {
        setConfigReady(true);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to get response");
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleGenerateConfig = async () => {
    setIsGenerating(true);
    try {
      const config = await generateFromChat.mutateAsync({
        projectId,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          imageUrls: m.imageUrls,
        })),
      });
      setGeneratedConfig(config as unknown as Record<string, unknown>);
      setShowConfigPreview(true);
      toast.success("Configuration generated and applied!");
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate config");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSkip = async () => {
    try {
      await updateProject.mutateAsync({ id: projectId, status: "active" });
      toast.success("Project activated — configure manually in settings");
      navigate(`/projects/${projectId}/settings`);
    } catch {
      toast.error("Failed to activate project");
    }
  };

  const handleGoToProject = () => {
    navigate(`/projects/${projectId}`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              Set up: {project?.name || "Project"}
            </h1>
            <p className="text-xs text-muted-foreground">
              Describe your collection and I'll configure the transcription engine
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground">
            Skip — configure manually
          </Button>
        </div>
      </header>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {/* Welcome message */}
          {messages.length === 0 && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                <div className="text-sm text-foreground leading-relaxed">
                  <p className="font-medium mb-2">Welcome! I'll help you set up your transcription pipeline.</p>
                  <p className="text-muted-foreground mb-3">
                    Tell me about your document collection — what type of documents are they, what language/script,
                    what era, and what information you want to extract. Upload a few sample images so I can see the handwriting style.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "I have handwritten Arabic recipes from my grandmother",
                      "I'm digitizing 19th century French correspondence",
                      "I have a collection of Ottoman-era invoices",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => { setInput(suggestion); textareaRef.current?.focus(); }}
                        className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className={`max-w-[85%] ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3"
                  : "bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-3"
              }`}>
                {/* Image previews */}
                {msg.imagePreviewUrls && msg.imagePreviewUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.imagePreviewUrls.map((url, j) => (
                      <img
                        key={j}
                        src={url}
                        alt="Sample"
                        className="w-20 h-20 object-cover rounded-lg border border-white/20"
                      />
                    ))}
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <div className="text-sm text-foreground leading-relaxed prose prose-sm max-w-none prose-invert">
                    <Streamdown>{msg.content}</Streamdown>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Thinking...
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Config Ready Banner */}
        {configReady && !generatedConfig && (
          <div className="mx-4 mb-3 p-3 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <span className="text-sm text-green-400 font-medium">
                {messages.length > 0 && generatedConfig === null && configReady
                  ? "Ready to generate your config"
                  : "I have enough information to generate your config"}
              </span>
            </div>
            <Button
              onClick={handleGenerateConfig}
              disabled={isGenerating}
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isGenerating ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Generating...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-1" /> Generate Config</>
              )}
            </Button>
          </div>
        )}

        {/* Generated Config Preview */}
        {generatedConfig && showConfigPreview && (
          <div className="mx-4 mb-3 border border-border rounded-xl bg-card overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setShowConfigPreview(!showConfigPreview)}
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Configuration Applied</span>
                <span className="text-xs text-muted-foreground">
                  ({(generatedConfig as any).pipelineType} · {Object.keys((generatedConfig as any).jsonSchema || {}).length} fields · {Object.keys((generatedConfig as any).glossary || {}).length} glossary terms)
                </span>
              </div>
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="border-t border-border px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Pipeline</p>
                <p className="text-sm">{(generatedConfig as any).pipelineType} · {(generatedConfig as any).modelName}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Schema Fields</p>
                <div className="flex flex-wrap gap-1">
                  {Object.keys((generatedConfig as any).jsonSchema || {}).map(field => (
                    <span key={field} className="text-xs px-2 py-0.5 bg-muted rounded-full">{field}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Glossary ({Object.keys((generatedConfig as any).glossary || {}).length} terms)</p>
                <div className="flex flex-wrap gap-1">
                  {Object.keys((generatedConfig as any).glossary || {}).slice(0, 10).map(term => (
                    <span key={term} className="text-xs px-2 py-0.5 bg-muted rounded-full">{term}</span>
                  ))}
                  {Object.keys((generatedConfig as any).glossary || {}).length > 10 && (
                    <span className="text-xs text-muted-foreground">+{Object.keys((generatedConfig as any).glossary || {}).length - 10} more</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Reasoning</p>
                <p className="text-xs text-muted-foreground">{(generatedConfig as any).reasoning}</p>
              </div>
            </div>
            <div className="border-t border-border px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Keep chatting to refine, then regenerate — or go to your project.</p>
              <Button size="sm" onClick={handleGoToProject}>
                Go to Project <ChevronDown className="w-3 h-3 ml-1 rotate-[-90deg]" />
              </Button>
            </div>
          </div>
        )}

        {/* Pending images preview */}
        {pendingImages.length > 0 && (
          <div className="mx-4 mb-2 flex gap-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img.previewUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-border" />
                <button
                  onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-border px-4 py-3 bg-card">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex items-end gap-2 max-w-4xl mx-auto"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleImageAdd(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="flex-shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="w-5 h-5" />
            </Button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Describe your collection, paste metadata fields, or upload sample images..."
              className="flex-1 resize-none bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[42px] max-h-[120px]"
              rows={1}
              style={{ height: "auto" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 120) + "px";
              }}
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || (!input.trim() && pendingImages.length === 0)}
              className="flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground text-center mt-1.5">
            Upload sample images of your documents so I can analyze the handwriting and content
          </p>
        </div>
      </div>
    </div>
  );
}
