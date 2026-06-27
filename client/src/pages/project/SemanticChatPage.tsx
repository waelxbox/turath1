/**
 * SemanticChatPage — RAG-powered chat interface for a project workspace.
 *
 * Allows researchers to ask natural language questions about their reviewed
 * transcriptions. The backend retrieves the most semantically similar documents
 * using pgvector and feeds them as context to the LLM.
 *
 * Scoped strictly to the current project — no cross-project data leakage.
 */

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useSessionState } from "@/hooks/useSessionState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Send,
  Loader2,
  Bot,
  User,
  FileText,
  ChevronDown,
  ChevronUp,
  Info,
  ArrowRight,
} from "lucide-react";
import type { Project } from "../../../../drizzle/schema";
import { useLocation } from "wouter";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{
    index: number;
    documentId: number;
    filename: string;
    similarity: number;
    excerpt: string;
  }>;
  timestamp: Date;
}

interface Props {
  projectId: number;
  project: Project;
}

export default function SemanticChatPage({ projectId, project }: Props) {
  const [, navigate] = useLocation();
  const [messages, setMessages] = useSessionState<ChatMessage[]>(`turath-chat-messages-${projectId}`, []);
  const [input, setInput] = useSessionState(`turath-chat-input-${projectId}`, "");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chatMutation = trpc.rag.chat.useMutation({
    onSuccess: (data, variables) => {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: String(data.answer),
        sources: data.sources,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    },
    onError: (err) => {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Sorry, I encountered an error: ${err.message}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  const handleSend = () => {
    const question = input.trim();
    if (!question || chatMutation.isPending) return;

    // Add user message immediately
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");

    // Build history for context (last 6 messages)
    const history = messages.slice(-6).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    chatMutation.mutate({ projectId, question, history });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleSources = (msgId: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const suggestedQuestions = [
    "What are the most common themes across all documents?",
    "Summarize the key findings from the reviewed transcriptions.",
    "Are there any dates or names mentioned across multiple documents?",
    "What types of documents are in this archive?",
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-card/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Ask Archive</h1>
            <p className="text-xs text-muted-foreground">
              Ask questions about your documents and get answers with sources
            </p>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Bot className="w-8 h-8 text-primary/60" />
            </div>
            <div>
              <h2 className="text-base font-semibold mb-1">Ask about your archive</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                I can answer questions about the documents you have reviewed in{" "}
                <span className="font-medium text-foreground">{project.name}</span>.
                Answers are grounded in your actual transcriptions.
              </p>
            </div>

            {/* Info note */}
            <div className="flex items-start gap-2 bg-muted/40 rounded-lg p-3 max-w-sm text-left">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Only <strong>approved</strong> documents are used to answer questions.
                Approve documents in the Review page to include them here.
              </p>
            </div>

            {/* Suggested questions */}
            <div className="w-full max-w-md">
              <p className="text-xs text-muted-foreground mb-2">Try asking:</p>
              <div className="grid grid-cols-1 gap-2">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(q)}
                    className="text-left text-xs bg-card border border-border rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Message list */
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs
                    ${msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                    }`}
                >
                  {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>

                {/* Bubble */}
                <div className={`flex flex-col gap-1.5 max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                      ${msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-card border border-border rounded-tl-sm"
                      }`}
                  >
                    {msg.content}
                  </div>

                  {/* Sources toggle */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="w-full">
                      <button
                        onClick={() => toggleSources(msg.id)}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <FileText className="w-3 h-3" />
                        <span>{msg.sources.length} source{msg.sources.length !== 1 ? "s" : ""}</span>
                        {expandedSources.has(msg.id)
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />
                        }
                      </button>

                      {expandedSources.has(msg.id) && (
                        <div className="mt-1.5 space-y-1.5">
                          {msg.sources.map((src) => (
                            <div
                              key={src.index}
                              className="bg-muted/40 border border-border/50 rounded-lg p-2.5 text-xs"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-foreground truncate max-w-[200px]">
                                  [{src.index}] {src.filename}
                                </span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-2 flex-shrink-0">
                                  {Math.round(src.similarity * 100)}% match
                                </Badge>
                              </div>
                              <p className="text-muted-foreground leading-relaxed line-clamp-3">
                                {src.excerpt}
                              </p>
                              <button
                                onClick={() => navigate(`/review/${src.documentId}`)}
                                className="mt-1.5 text-[11px] text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
                              >
                                Open source
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <span className="text-[10px] text-muted-foreground/50">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {chatMutation.isPending && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="bg-card border border-border rounded-xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-border bg-card/30 p-4">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents… (Enter to send, Shift+Enter for new line)"
            className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm"
            rows={1}
            disabled={chatMutation.isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            size="icon"
            className="h-[44px] w-[44px] flex-shrink-0"
          >
            {chatMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
          Answers are generated from your approved transcriptions only. Always verify against source documents.
        </p>
      </div>
    </div>
  );
}
