/**
 * Conversational Onboarding Chat Agent
 * =====================================
 * Powers a natural-language chat flow where users describe their collection,
 * upload sample images, and iteratively build their transcription config
 * (system prompt, JSON schema, domain glossary) through conversation.
 */

import { invokeLLM } from "./_core/llm";
import type { GeneratedConfig } from "./onboardingAgent";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imageUrls?: string[]; // S3 URLs of uploaded images
}

export interface ConfigDraft {
  pipelineType?: "single_pass" | "two_pass";
  modelName?: string;
  systemPrompt?: string;
  pass2Prompt?: string;
  jsonSchema?: Record<string, {
    type: "string" | "boolean" | "array" | "number";
    description: string;
    nullable: boolean;
    displayHint?: "short_text" | "long_text" | "tag_list";
  }>;
  glossary?: Record<string, string>;
  postProcessing?: Array<{ type: string; field: string; marker?: string; format?: string }>;
  outputFormats?: string[];
}

const CHAT_SYSTEM_PROMPT = `You are an expert archival AI assistant helping a researcher set up their document transcription pipeline in TURATH. You are having a natural conversation to understand their collection and build the perfect configuration.

YOUR ROLE:
- Help the user describe their document collection (type, language, era, content)
- Analyze any sample images they upload to understand the documents
- Suggest relevant metadata fields based on what you see and what they describe
- Iteratively refine the configuration based on their feedback
- When you have enough information, generate the final config

CONVERSATION GUIDELINES:
- Be warm, knowledgeable, and concise
- Ask clarifying questions when needed (but don't overwhelm — 1-2 questions at a time)
- When the user uploads images, analyze them and describe what you see
- Proactively suggest useful metadata fields with brief explanations of WHY
- If the user mentions specific fields they want, incorporate them
- Adapt to the user's expertise level (some are archivists, some are hobbyists)

WHEN SUGGESTING FIELDS, format them as a clear list like:
**Suggested fields:**
- field_name: description of what it captures

WHEN YOU HAVE ENOUGH INFORMATION to generate a config (typically after: knowing the document type, language, seeing at least one sample, and knowing desired fields), include this exact marker at the END of your message:

[CONFIG_READY]

This signals the frontend to show a "Generate Config" button. Only include this when you genuinely have enough context.

IMPORTANT RULES:
- Never generate the actual JSON config in chat — that happens in a separate step
- Focus on understanding the collection and agreeing on the right fields/approach
- If the user provides their own system prompt text, respect it and incorporate it
- Remember: TURATH supports single_pass (transcription only) and two_pass (transcription + metadata extraction)
- For Arabic/RTL documents, always recommend gemini-3.1-pro-preview as the model
- For other languages, recommend gemini-2.5-flash

DO NOT use markdown code blocks for the field suggestions. Keep it conversational.`;

/**
 * Process a chat message in the onboarding conversation.
 * Returns the AI's response.
 */
export async function processOnboardingChat(
  messages: ChatMessage[],
  projectName?: string,
): Promise<string> {
  // Build the LLM message array
  const llmMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }>;
  }> = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
  ];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      llmMessages.push({ role: "assistant", content: msg.content });
    } else {
      // User message — may include images
      if (msg.imageUrls && msg.imageUrls.length > 0) {
        const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } }> = [];
        content.push({ type: "text", text: msg.content });
        for (const url of msg.imageUrls) {
          content.push({
            type: "image_url",
            image_url: { url, detail: "high" },
          });
        }
        llmMessages.push({ role: "user", content });
      } else {
        llmMessages.push({ role: "user", content: msg.content });
      }
    }
  }

  const response = await invokeLLM({ messages: llmMessages });
  const content = response.choices[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => c.text ?? "").join("") : "";
  return text || "I'm sorry, I couldn't process that. Could you try again?";
}

/**
 * Generate the final config from the conversation history.
 * This takes the full chat context and produces a structured GeneratedConfig.
 */
export async function generateConfigFromChat(
  messages: ChatMessage[],
): Promise<GeneratedConfig> {
  // Build context from conversation
  const conversationSummary = messages.map(m => {
    const prefix = m.role === "user" ? "User" : "Assistant";
    const imgNote = m.imageUrls?.length ? ` [attached ${m.imageUrls.length} image(s)]` : "";
    return `${prefix}: ${m.content}${imgNote}`;
  }).join("\n\n");

  // Include images from the conversation
  const allImageUrls = messages
    .filter(m => m.imageUrls && m.imageUrls.length > 0)
    .flatMap(m => m.imageUrls!);

  const userContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } }> = [];

  userContent.push({
    type: "text",
    text: `Based on the following conversation with a researcher about their document collection, generate the complete TURATH project configuration.

CONVERSATION:
${conversationSummary}

Now generate the final configuration as a JSON object. Remember:
1. systemPrompt = transcription rules ONLY (persona + instructions, no schema, no glossary)
2. jsonSchema = structured field definitions with Dublin Core core fields + collection-specific fields
3. glossary = domain-specific terms (minimum 5 entries)
4. Respect any specific requests the user made about fields, pipeline type, etc.
5. If the user provided their own prompt text, use it as the basis for systemPrompt

Output ONLY valid JSON matching the required schema.`,
  });

  // Add images for context
  for (const url of allImageUrls.slice(0, 5)) { // max 5 images
    userContent.push({
      type: "image_url",
      image_url: { url, detail: "high" },
    });
  }

  const CONFIG_GENERATION_PROMPT = `You are an expert AI system designer. Generate a complete TURATH project configuration as a JSON object.

The configuration has these components:
1. pipelineType: "single_pass" or "two_pass"
2. modelName: "gemini-3.1-pro-preview" (for Arabic/RTL) or "gemini-2.5-flash" (for other languages)
3. systemPrompt: Transcription rules ONLY — expert persona + instructions. NO schema definitions, NO glossary terms.
4. pass2Prompt: Only if two_pass — instructions for metadata extraction pass. null otherwise.
5. jsonSchema: Field definitions. MUST include Dublin Core fields (title, creator, date, description, subject, type, source, transcription) plus collection-specific fields.
   Each field: { type: "string"|"number"|"boolean"|"array", description: string, nullable: boolean, displayHint: "short_text"|"long_text"|"tag_list" }
6. glossary: Domain-specific terms { "term": "definition" }. Minimum 5 entries.
7. postProcessing: Rules like [{ type: "illegible_marker", field: "transcription", marker: "[illegible]" }]
8. outputFormats: ["json", "csv"]
9. reasoning: 2-3 sentence explanation of choices

Guidelines:
- For Arabic documents: ALWAYS use "gemini-3.1-pro-preview" and typically "two_pass"
- For two_pass: Pass 1 (systemPrompt) focuses on raw transcription, Pass 2 (pass2Prompt) extracts structured metadata
- The glossary should contain domain-specific terms from the collection (historical terms, abbreviations, place names, etc.)
- Use "long_text" displayHint for substantial text fields, "tag_list" for arrays, "short_text" for brief identifiers

Output ONLY the JSON object. No markdown fences.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: CONFIG_GENERATION_PROMPT },
      { role: "user", content: userContent as Parameters<typeof invokeLLM>[0]["messages"][0]["content"] },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "project_config",
        strict: false,
        schema: {
          type: "object",
          properties: {
            pipelineType: { type: "string" },
            modelName: { type: "string" },
            systemPrompt: { type: "string" },
            pass2Prompt: { type: "string" },
            jsonSchema: { type: "object" },
            glossary: { type: "object" },
            postProcessing: { type: "array" },
            outputFormats: { type: "array" },
            reasoning: { type: "string" },
          },
          required: ["pipelineType", "modelName", "systemPrompt", "jsonSchema", "glossary", "postProcessing", "outputFormats", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  });

  const rawContent = response.choices[0]?.message?.content ?? "{}";
  const raw = typeof rawContent === "string" ? rawContent : "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  const config = JSON.parse(cleaned) as GeneratedConfig;

  // Safety: ensure required fields
  if (!config.outputFormats) config.outputFormats = ["json", "csv"];
  if (!config.postProcessing) config.postProcessing = [];
  if (!config.glossary) config.glossary = {};
  if (!config.jsonSchema) config.jsonSchema = {};
  if (!config.reasoning) config.reasoning = "Generated from conversational onboarding.";

  return config;
}
