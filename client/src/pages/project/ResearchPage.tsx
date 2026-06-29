/**
 * ResearchPage — "Codex" research agent interface.
 *
 * A powerful research tool that queries the archive, analyzes patterns,
 * builds knowledge graphs, and generates visualizations — all through
 * a conversational interface with a visible "thinking" panel.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Streamdown } from "streamdown";
import {
  Brain,
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Search,
  BarChart3,
  Network,
  Globe,
  Eye,
  FileText,
  Sparkles,
  PanelRightOpen,
  PanelRightClose,
  MessageSquare,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import ForceGraph2D from "react-force-graph-2d";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ThinkingStep {
  type: "tool_call" | "tool_result" | "thinking" | "error";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  message?: string;
  timestamp: number;
}

interface Visualization {
  type: "line_chart" | "bar_chart" | "pie_chart" | "network_graph" | "table";
  title: string;
  data: unknown;
  config?: Record<string, unknown>;
}

interface Citation {
  type: "internal" | "external";
  documentId?: number;
  filename?: string;
  url?: string;
  title?: string;
  excerpt?: string;
}

interface ResearchMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: ThinkingStep[];
  visualizations?: Visualization[];
  citations?: Citation[];
  timestamp: Date;
}

interface ConversationSummary {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Chart Colors ────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "hsl(var(--chart-1, 220 70% 50%))",
  "hsl(var(--chart-2, 160 60% 45%))",
  "hsl(var(--chart-3, 30 80% 55%))",
  "hsl(var(--chart-4, 280 65% 60%))",
  "hsl(var(--chart-5, 340 75% 55%))",
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
];

// ─── Visualization Renderer ──────────────────────────────────────────────────

function VisualizationRenderer({ viz }: { viz: Visualization }) {
  if (viz.type === "bar_chart") {
    const chartData = viz.data as { labels?: string[]; datasets?: Array<{ label: string; data: number[] }> };
    if (!chartData.labels || !chartData.datasets) return <p className="text-xs text-muted-foreground">Invalid chart data</p>;
    const data = chartData.labels.map((label, i) => {
      const point: Record<string, unknown> = { name: label };
      chartData.datasets!.forEach((ds) => {
        point[ds.label] = ds.data[i];
      });
      return point;
    });
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">{viz.title}</h4>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {chartData.datasets.map((ds, i) => (
                <Bar key={ds.label} dataKey={ds.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (viz.type === "line_chart") {
    const chartData = viz.data as { labels?: string[]; datasets?: Array<{ label: string; data: number[] }> };
    if (!chartData.labels || !chartData.datasets) return <p className="text-xs text-muted-foreground">Invalid chart data</p>;
    const data = chartData.labels.map((label, i) => {
      const point: Record<string, unknown> = { name: label };
      chartData.datasets!.forEach((ds) => {
        point[ds.label] = ds.data[i];
      });
      return point;
    });
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">{viz.title}</h4>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {chartData.datasets.map((ds, i) => (
                <Line key={ds.label} type="monotone" dataKey={ds.label} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (viz.type === "pie_chart") {
    const chartData = viz.data as { labels?: string[]; datasets?: Array<{ label: string; data: number[] }> };
    if (!chartData.labels || !chartData.datasets || !chartData.datasets[0]) return <p className="text-xs text-muted-foreground">Invalid chart data</p>;
    const data = chartData.labels.map((label, i) => ({
      name: label,
      value: chartData.datasets![0].data[i],
    }));
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">{viz.title}</h4>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (viz.type === "network_graph") {
    const graphData = viz.data as { nodes?: Array<{ id: string; label: string; type?: string }>; edges?: Array<{ source: string; target: string; label?: string }> };
    if (!graphData.nodes || !graphData.edges) return <p className="text-xs text-muted-foreground">Invalid graph data</p>;
    const nodeColorMap: Record<string, string> = { person: "#6366f1", location: "#10b981", organization: "#f59e0b", document: "#8b5cf6" };
    const fgData = {
      nodes: graphData.nodes.map((n) => ({ id: n.id, name: n.label, type: n.type || "default", color: nodeColorMap[n.type || "default"] || "#6366f1" })),
      links: graphData.edges.map((e) => ({ source: e.source, target: e.target, label: e.label })),
    };
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">{viz.title}</h4>
        <div className="h-[300px] w-full relative">
          <ForceGraph2D
            graphData={fgData}
            width={500}
            height={280}
            nodeLabel="name"
            nodeColor={(node: { color?: string }) => node.color || "#6366f1"}
            nodeRelSize={5}
            linkDirectionalArrowLength={3}
            linkLabel={(link: { label?: string }) => link.label || ""}
            backgroundColor="transparent"
          />
        </div>
      </div>
    );
  }

  if (viz.type === "table") {
    const tableData = viz.data as { headers?: string[]; rows?: string[][] };
    if (!tableData.headers || !tableData.rows) return <p className="text-xs text-muted-foreground">Invalid table data</p>;
    return (
      <div className="bg-card border border-border rounded-lg p-4 overflow-x-auto">
        <h4 className="text-sm font-semibold mb-3">{viz.title}</h4>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {tableData.headers.map((h, i) => (
                <th key={i} className="text-left py-2 px-2 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.rows.slice(0, 50).map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="py-1.5 px-2">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {tableData.rows.length > 50 && (
          <p className="text-xs text-muted-foreground mt-2">Showing 50 of {tableData.rows.length} rows</p>
        )}
      </div>
    );
  }

  return null;
}

// ─── Thinking Step Renderer ──────────────────────────────────────────────────

function ThinkingStepItem({ step }: { step: ThinkingStep }) {
  const [expanded, setExpanded] = useState(false);

  const getIcon = () => {
    switch (step.toolName) {
      case "search_archive": return <Search className="w-3 h-3" />;
      case "aggregate_data": return <BarChart3 className="w-3 h-3" />;
      case "get_entities": return <Network className="w-3 h-3" />;
      case "web_search": return <Globe className="w-3 h-3" />;
      case "generate_visualization": return <Eye className="w-3 h-3" />;
      default: return <Brain className="w-3 h-3" />;
    }
  };

  const getLabel = () => {
    if (step.type === "thinking") return step.message || "Thinking...";
    if (step.type === "error") return `Error: ${step.message}`;
    if (step.type === "tool_call") {
      switch (step.toolName) {
        case "search_archive": return `Searching archive: "${(step.toolArgs as { query?: string })?.query}"`;
        case "aggregate_data": return `Analyzing: ${(step.toolArgs as { analysis_type?: string })?.analysis_type} on "${(step.toolArgs as { field_name?: string })?.field_name}"`;
        case "get_entities": return `Getting entities: ${(step.toolArgs as { entity_type?: string })?.entity_type}`;
        case "web_search": return `Web search: "${(step.toolArgs as { query?: string })?.query}"`;
        case "generate_visualization": return `Creating ${(step.toolArgs as { viz_type?: string })?.viz_type}: "${(step.toolArgs as { title?: string })?.title}"`;
        default: return `Calling ${step.toolName}`;
      }
    }
    if (step.type === "tool_result") {
      const result = step.result;
      if (Array.isArray(result)) return `Got ${result.length} results from ${step.toolName}`;
      if (result && typeof result === "object" && "totalDocs" in (result as Record<string, unknown>)) {
        return `Analyzed ${(result as { totalDocs: number }).totalDocs} documents`;
      }
      return `Result from ${step.toolName}`;
    }
    return "Processing...";
  };

  return (
    <div className="flex items-start gap-2 text-xs">
      <div className={`mt-0.5 p-1 rounded ${step.type === "error" ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary"}`}>
        {getIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-left w-full hover:text-foreground transition-colors text-muted-foreground"
        >
          <span className="line-clamp-1">{getLabel()}</span>
        </button>
        {expanded && step.type === "tool_result" && step.result != null && (
          <pre className="mt-1 p-2 bg-muted/50 rounded text-[10px] overflow-x-auto max-h-[200px] overflow-y-auto">
            {String(JSON.stringify(step.result, null, 2)).slice(0, 3000)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface Props {
  projectId: number;
}

export default function ResearchPage({ projectId }: Props) {
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [input, setInput] = useState("");
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch conversations list
  const conversationsQuery = trpc.research.getConversations.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  // Create conversation mutation
  const createConversation = trpc.research.createConversation.useMutation({
    onSuccess: (data) => {
      setActiveConversationId(data.id);
      setMessages([]);
      conversationsQuery.refetch();
    },
  });

  // Delete conversation mutation
  const deleteConversation = trpc.research.deleteConversation.useMutation({
    onSuccess: () => {
      if (activeConversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
      conversationsQuery.refetch();
    },
  });

  // Load conversation
  const loadConversation = trpc.research.getConversation.useQuery(
    { id: activeConversationId! },
    { enabled: !!activeConversationId }
  );

  // When a conversation is loaded, populate messages
  useEffect(() => {
    if (loadConversation.data) {
      const msgs = (loadConversation.data.messages as unknown[]) || [];
      setMessages(
        msgs.map((m: unknown, i: number) => {
          const msg = m as { role: string; content: string; thinking?: ThinkingStep[]; visualizations?: Visualization[]; citations?: Citation[] };
          return {
            id: `loaded-${i}`,
            role: msg.role as "user" | "assistant",
            content: msg.content,
            thinking: msg.thinking,
            visualizations: msg.visualizations,
            citations: msg.citations,
            timestamp: new Date(),
          };
        })
      );
    }
  }, [loadConversation.data]);

  // Research mutation
  const askMutation = trpc.research.ask.useMutation({
    onSuccess: (data) => {
      const assistantMsg: ResearchMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        thinking: data.thinking as ThinkingStep[],
        visualizations: data.visualizations as Visualization[],
        citations: data.citations as Citation[],
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    },
    onError: (err) => {
      const errorMsg: ResearchMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${err.message}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    },
  });

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, askMutation.isPending]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || askMutation.isPending) return;

    // Create conversation if none active
    let convId = activeConversationId;
    if (!convId) {
      const conv = await createConversation.mutateAsync({
        projectId,
        title: question.slice(0, 100),
      });
      convId = conv.id;
      setActiveConversationId(conv.id);
    }

    // Add user message
    const userMsg: ResearchMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Build history (last 6 messages)
    const history = messages.slice(-6).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    askMutation.mutate({
      projectId,
      question,
      conversationId: convId,
      history,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleThinking = (msgId: string) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
  };

  const suggestedQuestions = [
    "What patterns emerge across all documents in this archive?",
    "Show me a timeline of document dates and key events",
    "Map the network of people mentioned across documents",
    "What are the most frequently mentioned locations?",
    "Analyze the commodities or topics discussed over time",
    "Create a knowledge graph of entities and their relationships",
  ];

  return (
    <div className="flex h-full">
      {/* Conversation Sidebar */}
      {showSidebar && (
        <div className="w-64 border-r border-border bg-card/30 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-border">
            <Button
              size="sm"
              className="w-full gap-2"
              onClick={handleNewConversation}
            >
              <Plus className="w-3.5 h-3.5" />
              New Research
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversationsQuery.data?.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-md text-xs cursor-pointer transition-colors ${
                  activeConversationId === conv.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/50 text-muted-foreground"
                }`}
                onClick={() => setActiveConversationId(conv.id)}
              >
                <MessageSquare className="w-3 h-3 flex-shrink-0" />
                <span className="flex-1 truncate">{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation.mutate({ id: conv.id });
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {(!conversationsQuery.data || conversationsQuery.data.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No research conversations yet
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border bg-card/30 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              {showSidebar ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </Button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Codex</h1>
              <p className="text-xs text-muted-foreground">
                Research agent — search, analyze, visualize
              </p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-indigo-400/70" />
              </div>
              <div>
                <h2 className="text-base font-semibold mb-1">Research your archive</h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  I can search documents, analyze patterns, build knowledge graphs,
                  and create visualizations from your transcribed archive.
                  Ask me anything.
                </p>
              </div>

              {/* Suggested questions */}
              <div className="w-full max-w-lg">
                <p className="text-xs text-muted-foreground mb-3">Try asking:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(q)}
                      className="text-left text-xs bg-card border border-border rounded-lg px-3 py-2.5 hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className="space-y-2">
                  <div className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    {/* Avatar */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      msg.role === "user" ? "bg-primary/15" : "bg-gradient-to-br from-indigo-500/20 to-purple-500/20"
                    }`}>
                      {msg.role === "user" ? <User className="w-3.5 h-3.5 text-primary" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
                    </div>

                    {/* Content */}
                    <div className={`flex-1 min-w-0 ${msg.role === "user" ? "text-right" : ""}`}>
                      <div className={`inline-block text-left max-w-full ${
                        msg.role === "user"
                          ? "bg-primary/10 rounded-2xl rounded-tr-sm px-4 py-2.5"
                          : ""
                      }`}>
                        {msg.role === "user" ? (
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                            <Streamdown>{msg.content}</Streamdown>
                          </div>
                        )}
                      </div>

                      {/* Thinking panel for assistant messages */}
                      {msg.role === "assistant" && msg.thinking && msg.thinking.length > 0 && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleThinking(msg.id)}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Brain className="w-3 h-3" />
                            <span>{msg.thinking.length} reasoning steps</span>
                            {expandedThinking.has(msg.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                          {expandedThinking.has(msg.id) && (
                            <div className="mt-2 pl-3 border-l-2 border-primary/20 space-y-1.5">
                              {msg.thinking.map((step, i) => (
                                <ThinkingStepItem key={i} step={step} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Citations */}
                      {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {msg.citations.slice(0, 8).map((cite, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="text-[10px] gap-1 cursor-pointer hover:bg-accent"
                            >
                              {cite.type === "internal" ? (
                                <>
                                  <FileText className="w-2.5 h-2.5" />
                                  {cite.filename || `Doc ${cite.documentId}`}
                                </>
                              ) : (
                                <>
                                  <Globe className="w-2.5 h-2.5" />
                                  {cite.title?.slice(0, 30) || "External source"}
                                </>
                              )}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visualizations (rendered below the message) */}
                  {msg.role === "assistant" && msg.visualizations && msg.visualizations.length > 0 && (
                    <div className="ml-10 space-y-3">
                      {msg.visualizations.map((viz, i) => (
                        <VisualizationRenderer key={i} viz={viz} />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Loading indicator */}
              {askMutation.isPending && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Researching...</span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input area */}
        <div className="flex-shrink-0 border-t border-border bg-card/30 p-4">
          <div className="flex gap-2 items-end max-w-3xl mx-auto">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a research question..."
              className="min-h-[44px] max-h-[160px] resize-none text-sm"
              rows={1}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || askMutation.isPending}
              className="h-[44px] w-[44px] flex-shrink-0"
            >
              {askMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            Codex searches your archive, analyzes patterns, and augments with external research. Press Enter to send.
          </p>
        </div>
      </div>
    </div>
  );
}
