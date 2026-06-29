/**
 * Research Agent ("Codex")
 * ========================
 * A multi-step tool-use agent that can:
 * 1. Search the project's archive (full-text + semantic)
 * 2. Aggregate data across documents (trends, counts, grouping)
 * 3. Extract and analyze entities (people, places, organizations)
 * 4. Perform external web research for historical context
 * 5. Synthesize findings into structured reports with visualizations
 *
 * Uses invokeLLM with tool_choice: 'auto' for iterative reasoning.
 */

import { invokeLLM, type Message, type Tool, type ToolCall } from "./_core/llm";
import { callDataApi } from "./_core/dataApi";
import { semanticSearch } from "./embeddingService";
import { getReviewedTranscriptions, getEntitiesByProject, getGraphData, getEntityStats } from "./db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThinkingStep {
  type: "tool_call" | "tool_result" | "thinking" | "error";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  message?: string;
  timestamp: number;
}

export interface ResearchResult {
  answer: string;
  thinking: ThinkingStep[];
  visualizations: Visualization[];
  citations: Citation[];
}

export interface Visualization {
  type: "line_chart" | "bar_chart" | "pie_chart" | "network_graph" | "table";
  title: string;
  data: unknown;
  config?: Record<string, unknown>;
}

export interface Citation {
  type: "internal" | "external";
  documentId?: number;
  filename?: string;
  url?: string;
  title?: string;
  excerpt?: string;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const RESEARCH_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_archive",
      description: "Search the project's archive using semantic + full-text hybrid search. Returns relevant document excerpts with metadata. Use this to find specific documents, topics, or mentions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query (can be in Arabic or English)",
          },
          limit: {
            type: "number",
            description: "Number of results to return (1-20, default 10)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aggregate_data",
      description: "Analyze patterns across all reviewed documents in the project. Can count occurrences, group by field values, find trends over time, or compute statistics. Works on the structured JSON fields extracted from transcriptions.",
      parameters: {
        type: "object",
        properties: {
          analysis_type: {
            type: "string",
            enum: ["count_by_field", "trend_over_time", "unique_values", "co_occurrence", "field_statistics"],
            description: "Type of aggregation to perform",
          },
          field_name: {
            type: "string",
            description: "The JSON field name to analyze (e.g., 'date', 'sender', 'commodity', 'form_of_address', 'origin_location')",
          },
          filter_field: {
            type: "string",
            description: "Optional: filter documents by this field having a specific value",
          },
          filter_value: {
            type: "string",
            description: "Optional: the value to filter by",
          },
          group_by: {
            type: "string",
            description: "Optional: group results by this field (e.g., group commodities by decade)",
          },
        },
        required: ["analysis_type", "field_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_entities",
      description: "Get all extracted entities (people, places, organizations) from the project's documents. Can filter by type and get relationship/co-occurrence data for network analysis.",
      parameters: {
        type: "object",
        properties: {
          entity_type: {
            type: "string",
            enum: ["person", "location", "organization", "all"],
            description: "Type of entities to retrieve",
          },
          include_relationships: {
            type: "boolean",
            description: "If true, include co-occurrence relationships between entities (for network graphs)",
          },
          name_filter: {
            type: "string",
            description: "Optional: filter entities by name (partial match)",
          },
        },
        required: ["entity_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for external historical context, academic literature, commodity prices, or background information to augment archival findings. Use this when you need context beyond what's in the archive.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for external research (use English for best results)",
          },
          context: {
            type: "string",
            description: "Brief context about why you're searching (helps refine results)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_visualization",
      description: "Generate a visualization (chart, graph, or table) from data you've collected. Call this when you have enough data to create a meaningful visual representation.",
      parameters: {
        type: "object",
        properties: {
          viz_type: {
            type: "string",
            enum: ["line_chart", "bar_chart", "pie_chart", "network_graph", "table"],
            description: "Type of visualization to generate",
          },
          title: {
            type: "string",
            description: "Title for the visualization",
          },
          data: {
            type: "object",
            description: "The data to visualize. For charts: { labels: string[], datasets: [{ label: string, data: number[] }] }. For network_graph: { nodes: [{ id, label, type }], edges: [{ source, target, label? }] }. For table: { headers: string[], rows: string[][] }.",
          },
          config: {
            type: "object",
            description: "Optional chart configuration (axis labels, colors, etc.)",
          },
        },
        required: ["viz_type", "title", "data"],
      },
    },
  },
];

// ─── Tool Execution ──────────────────────────────────────────────────────────

async function executeSearchArchive(
  projectId: number,
  args: { query: string; limit?: number }
): Promise<unknown> {
  const results = await semanticSearch(projectId, args.query, args.limit || 10);
  return results.map((r) => ({
    documentId: r.documentId,
    filename: (r.metadata as Record<string, unknown>)?.filename ?? `Document ${r.documentId}`,
    content: r.content,
    similarity: Math.round(r.similarity * 1000) / 1000,
    matchType: r.matchType,
  }));
}

async function executeAggregateData(
  projectId: number,
  args: {
    analysis_type: string;
    field_name: string;
    filter_field?: string;
    filter_value?: string;
    group_by?: string;
  }
): Promise<unknown> {
  const transcriptions = await getReviewedTranscriptions(projectId);

  // Extract the target field from all reviewed documents
  const docs = transcriptions.map((t) => {
    const json = (t.transcription.reviewedJson || t.transcription.rawJson) as Record<string, unknown>;
    return {
      documentId: t.document.id,
      filename: t.document.filename,
      fields: json,
    };
  });

  // Apply filter if specified
  let filtered = docs;
  if (args.filter_field && args.filter_value) {
    filtered = docs.filter((d) => {
      const val = d.fields[args.filter_field!];
      if (typeof val === "string") return val.toLowerCase().includes(args.filter_value!.toLowerCase());
      if (Array.isArray(val)) return val.some((v) => String(v).toLowerCase().includes(args.filter_value!.toLowerCase()));
      return String(val) === args.filter_value;
    });
  }

  switch (args.analysis_type) {
    case "count_by_field": {
      const counts: Record<string, number> = {};
      for (const doc of filtered) {
        const val = doc.fields[args.field_name];
        if (val === null || val === undefined) continue;
        if (Array.isArray(val)) {
          for (const v of val) {
            const key = String(v).trim();
            if (key) counts[key] = (counts[key] || 0) + 1;
          }
        } else {
          const key = String(val).trim();
          if (key) counts[key] = (counts[key] || 0) + 1;
        }
      }
      // Sort by count descending
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50);
      return { field: args.field_name, totalDocs: filtered.length, counts: sorted.map(([value, count]) => ({ value, count })) };
    }

    case "trend_over_time": {
      // Group by date/year field
      const groupField = args.group_by || "date";
      const timeline: Record<string, { count: number; values: string[] }> = {};
      for (const doc of filtered) {
        const dateVal = doc.fields[groupField] || doc.fields["date"] || doc.fields["Date"];
        const targetVal = doc.fields[args.field_name];
        if (!dateVal) continue;
        // Extract year from date string
        const yearMatch = String(dateVal).match(/(\d{4})/);
        const year = yearMatch ? yearMatch[1] : String(dateVal).slice(0, 10);
        if (!timeline[year]) timeline[year] = { count: 0, values: [] };
        timeline[year].count++;
        if (targetVal) {
          const valStr = Array.isArray(targetVal) ? targetVal.join(", ") : String(targetVal);
          if (valStr.trim()) timeline[year].values.push(valStr.trim());
        }
      }
      const sorted = Object.entries(timeline).sort((a, b) => a[0].localeCompare(b[0]));
      return { field: args.field_name, groupedBy: groupField, totalDocs: filtered.length, timeline: sorted.map(([period, data]) => ({ period, ...data })) };
    }

    case "unique_values": {
      const values = new Set<string>();
      for (const doc of filtered) {
        const val = doc.fields[args.field_name];
        if (val === null || val === undefined) continue;
        if (Array.isArray(val)) {
          for (const v of val) {
            const s = String(v).trim();
            if (s) values.add(s);
          }
        } else {
          const s = String(val).trim();
          if (s) values.add(s);
        }
      }
      return { field: args.field_name, totalDocs: filtered.length, uniqueCount: values.size, values: Array.from(values).slice(0, 100) };
    }

    case "co_occurrence": {
      // Find which values of field_name co-occur with values of group_by field
      const coOccurrences: Record<string, Record<string, number>> = {};
      const secondField = args.group_by || args.field_name;
      for (const doc of filtered) {
        const val1 = doc.fields[args.field_name];
        const val2 = doc.fields[secondField];
        if (!val1 || !val2) continue;
        const keys1 = Array.isArray(val1) ? val1.map(String) : [String(val1)];
        const keys2 = Array.isArray(val2) ? val2.map(String) : [String(val2)];
        for (const k1 of keys1) {
          if (!coOccurrences[k1]) coOccurrences[k1] = {};
          for (const k2 of keys2) {
            coOccurrences[k1][k2] = (coOccurrences[k1][k2] || 0) + 1;
          }
        }
      }
      return { field1: args.field_name, field2: secondField, totalDocs: filtered.length, coOccurrences };
    }

    case "field_statistics": {
      const values: string[] = [];
      for (const doc of filtered) {
        const val = doc.fields[args.field_name];
        if (val === null || val === undefined) continue;
        if (Array.isArray(val)) values.push(...val.map(String));
        else values.push(String(val));
      }
      const nonEmpty = values.filter((v) => v.trim());
      return {
        field: args.field_name,
        totalDocs: filtered.length,
        docsWithField: nonEmpty.length,
        coveragePercent: filtered.length > 0 ? Math.round((nonEmpty.length / filtered.length) * 100) : 0,
        sampleValues: nonEmpty.slice(0, 20),
      };
    }

    default:
      return { error: `Unknown analysis type: ${args.analysis_type}` };
  }
}

async function executeGetEntities(
  projectId: number,
  args: { entity_type: string; include_relationships?: boolean; name_filter?: string }
): Promise<unknown> {
  if (args.include_relationships) {
    const graphData = await getGraphData(projectId);
    // Filter by type if specified
    if (args.entity_type !== "all") {
      const filteredNodes = graphData.nodes.filter(
        (n) => n.type === args.entity_type || n.type === "document"
      );
      const nodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = graphData.edges.filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
      );
      return { nodes: filteredNodes, edges: filteredEdges };
    }
    return graphData;
  }

  const type = args.entity_type === "all" ? undefined : args.entity_type as "person" | "location" | "organization";
  const allEntities = await getEntitiesByProject(projectId, type);

  let result = allEntities;
  if (args.name_filter) {
    const filter = args.name_filter.toLowerCase();
    result = allEntities.filter((e) => e.name.toLowerCase().includes(filter));
  }

  return result.slice(0, 100).map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
  }));
}

async function executeWebSearch(
  args: { query: string; context?: string }
): Promise<unknown> {
  try {
    const results = await callDataApi("Google/customsearch", {
      query: { q: args.query, num: 5 },
    });
    return results;
  } catch (error) {
    // Fallback: try a different search API
    try {
      const results = await callDataApi("DuckDuckGo/search", {
        query: { q: args.query },
      });
      return results;
    } catch {
      return { error: "Web search unavailable", query: args.query, suggestion: "Please use your existing archival data for this analysis." };
    }
  }
}

function executeGenerateVisualization(
  args: { viz_type: string; title: string; data: unknown; config?: Record<string, unknown> }
): Visualization {
  return {
    type: args.viz_type as Visualization["type"],
    title: args.title,
    data: args.data,
    config: args.config,
  };
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 8;

export async function runResearchAgent(params: {
  projectId: number;
  projectName: string;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  onThinkingStep?: (step: ThinkingStep) => void;
}): Promise<ResearchResult> {
  const { projectId, projectName, question, history = [], onThinkingStep } = params;

  const thinking: ThinkingStep[] = [];
  const visualizations: Visualization[] = [];
  const citations: Citation[] = [];

  const addStep = (step: ThinkingStep) => {
    thinking.push(step);
    onThinkingStep?.(step);
  };

  // Build the system prompt
  const systemPrompt = `You are Codex, an advanced research agent for the archival project "${projectName}".
You have access to tools that let you search the archive, analyze data patterns, examine entity networks, and research external sources.

Your capabilities:
1. **search_archive**: Find specific documents, topics, or mentions in the transcribed archive
2. **aggregate_data**: Analyze trends over time, count occurrences, find patterns across all documents
3. **get_entities**: Examine people, places, and organizations extracted from documents, including their relationships
4. **web_search**: Find external historical context, academic literature, or background information
5. **generate_visualization**: Create charts, graphs, or tables to visualize your findings

IMPORTANT GUIDELINES:
- Always start by searching or aggregating the archive to ground your analysis in actual data
- Use multiple tool calls to build a comprehensive answer — don't try to answer from a single search
- When analyzing trends, first check what fields are available, then aggregate appropriately
- For network analysis, use get_entities with include_relationships=true
- Augment internal findings with external research when relevant
- Generate visualizations when the data supports it (trends → line/bar chart, distributions → pie chart, relationships → network graph)
- Cite your sources: reference document IDs for internal data, URLs for external sources
- Write your final answer in clear, scholarly prose with embedded citations
- If the archive doesn't contain relevant data, say so clearly and suggest what data would be needed

The archive contains transcribed historical documents with structured metadata fields extracted by AI.
Common fields include: transcription, date, sender, recipient, subject, keywords, persons_mentioned, locations, organizations, commodities, form_of_address, etc.
The exact fields depend on the project's configuration.`;

  // Build message history
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: question },
  ];

  addStep({ type: "thinking", message: `Analyzing question: "${question}"`, timestamp: Date.now() });

  // Agent loop
  let iterations = 0;
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await invokeLLM({
      messages,
      tools: RESEARCH_TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;

    // If no tool calls, we have the final answer
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const content = typeof assistantMessage.content === "string"
        ? assistantMessage.content
        : Array.isArray(assistantMessage.content)
          ? assistantMessage.content.map((c) => "text" in c ? c.text : "").join("")
          : "";

      // Extract citations from the answer
      // Internal citations: [Document N] or [Doc ID: N]
      const internalCiteRegex = /\[Document\s+(\d+)\]/g;
      let match;
      while ((match = internalCiteRegex.exec(content)) !== null) {
        const docId = parseInt(match[1]);
        if (!citations.find((c) => c.documentId === docId)) {
          citations.push({ type: "internal", documentId: docId });
        }
      }

      return { answer: content, thinking, visualizations, citations };
    }

    // Process tool calls
    messages.push({
      role: "assistant",
      content: assistantMessage.content || "",
      // We need to pass tool_calls through — store them in the message for context
    });

    // Add tool_calls to the assistant message (for the LLM to track)
    const toolCallMessages: Message[] = [];

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: argsStr } = toolCall.function;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsStr);
      } catch {
        args = {};
      }

      addStep({ type: "tool_call", toolName: name, toolArgs: args, timestamp: Date.now() });

      let result: unknown;
      try {
        switch (name) {
          case "search_archive":
            result = await executeSearchArchive(projectId, args as { query: string; limit?: number });
            // Track internal citations
            if (Array.isArray(result)) {
              for (const r of result as Array<{ documentId: number; filename: string }>) {
                if (!citations.find((c) => c.documentId === r.documentId)) {
                  citations.push({ type: "internal", documentId: r.documentId, filename: r.filename });
                }
              }
            }
            break;

          case "aggregate_data":
            result = await executeAggregateData(projectId, args as {
              analysis_type: string;
              field_name: string;
              filter_field?: string;
              filter_value?: string;
              group_by?: string;
            });
            break;

          case "get_entities":
            result = await executeGetEntities(projectId, args as {
              entity_type: string;
              include_relationships?: boolean;
              name_filter?: string;
            });
            break;

          case "web_search":
            result = await executeWebSearch(args as { query: string; context?: string });
            // Track external citations
            if (result && typeof result === "object" && "items" in (result as Record<string, unknown>)) {
              const items = (result as { items?: Array<{ title?: string; link?: string; snippet?: string }> }).items;
              if (items) {
                for (const item of items.slice(0, 3)) {
                  citations.push({ type: "external", url: item.link, title: item.title, excerpt: item.snippet });
                }
              }
            }
            break;

          case "generate_visualization":
            const viz = executeGenerateVisualization(args as {
              viz_type: string;
              title: string;
              data: unknown;
              config?: Record<string, unknown>;
            });
            visualizations.push(viz);
            result = { success: true, message: `Visualization "${viz.title}" created successfully.` };
            break;

          default:
            result = { error: `Unknown tool: ${name}` };
        }
      } catch (error) {
        result = { error: `Tool execution failed: ${(error as Error).message}` };
        addStep({ type: "error", toolName: name, message: (error as Error).message, timestamp: Date.now() });
      }

      addStep({ type: "tool_result", toolName: name, result, timestamp: Date.now() });

      // Add tool result message
      toolCallMessages.push({
        role: "tool",
        content: JSON.stringify(result, null, 2).slice(0, 15000), // Truncate very large results
        tool_call_id: toolCall.id,
        name: name,
      });
    }

    // Re-add the assistant message with tool_calls, then add tool results
    // The LLM API expects: assistant (with tool_calls) → tool (results)
    messages[messages.length - 1] = {
      role: "assistant",
      content: assistantMessage.content || "",
      // Note: tool_calls are tracked by the API via the response
    } as Message;

    // Hack: we need to include tool_calls in the message for the API
    // The invokeLLM helper should handle this, but we'll add a workaround
    (messages[messages.length - 1] as unknown as { tool_calls: ToolCall[] }).tool_calls = assistantMessage.tool_calls;

    messages.push(...toolCallMessages);
  }

  // If we hit max iterations, synthesize what we have
  return {
    answer: "I've gathered significant data but reached my analysis limit. Here's what I found based on the tools I used. Please refine your question if you need more specific analysis.",
    thinking,
    visualizations,
    citations,
  };
}
