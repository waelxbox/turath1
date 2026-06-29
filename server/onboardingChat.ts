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

  // Helper to parse LLM JSON response
  function parseLLMJson(raw: string): any {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    return JSON.parse(cleaned);
  }

  // --- STEP 1: Generate prompts (systemPrompt, pass2Prompt, pipelineType, modelName) ---
  const promptGenSystem = `You are an expert AI system designer for archival document transcription pipelines.
Generate ONLY the prompt configuration. Output a JSON object with exactly these keys:
- pipelineType: "single_pass" or "two_pass"
- modelName: "gemini-3.1-pro-preview" (for Arabic/RTL) or "gemini-2.5-flash" (for others)
- systemPrompt: The transcription rules (expert persona + instructions). For two_pass, this is Pass 1 (raw transcription only).
- pass2Prompt: For two_pass only — instructions for metadata extraction. For single_pass, set to null.
- reasoning: 2-3 sentence explanation.

Rules:
- systemPrompt must NEVER contain field definitions or glossary terms
- For Arabic: use gemini-3.1-pro-preview and two_pass
- For two_pass: Pass 1 focuses on faithful transcription, Pass 2 extracts structured metadata
- pass2Prompt should list the fields to extract with clear instructions

Output ONLY valid JSON. No markdown fences.`;

  const promptGenResponse = await invokeLLM({
    messages: [
      { role: "system", content: promptGenSystem },
      { role: "user", content: `Based on this conversation, generate the prompt config:\n\nCONVERSATION:\n${conversationSummary}` },
    ],
  });

  const promptRaw = typeof promptGenResponse.choices[0]?.message?.content === "string"
    ? promptGenResponse.choices[0].message.content : "{}";
  let promptConfig: { pipelineType: string; modelName: string; systemPrompt: string; pass2Prompt?: string | null; reasoning: string };
  try {
    promptConfig = parseLLMJson(promptRaw);
  } catch {
    promptConfig = { pipelineType: "two_pass", modelName: "gemini-3.1-pro-preview", systemPrompt: "", pass2Prompt: null, reasoning: "Parse error, using defaults." };
  }

  // --- STEP 2: Generate jsonSchema ---
  const schemaGenSystem = `You are an expert metadata schema designer for archival document collections.
Generate a JSON object where each key is a field name and each value is an object with:
- type: "string" | "number" | "boolean" | "array"
- description: what this field captures
- nullable: true or false
- displayHint: "short_text" | "long_text" | "tag_list"

Rules:
- MUST include these Dublin Core fields: title, creator, date, description, subject, type, source, transcription
- Add collection-specific fields based on the conversation
- Use "long_text" for transcription/translation fields, "tag_list" for arrays, "short_text" for identifiers
- Include at least 10 fields total
- The "transcription" field should always be type "string", nullable false, displayHint "long_text"

Output ONLY a flat JSON object (the schema). No wrapper key, no markdown fences. Example:
{"title":{"type":"string","description":"Document title","nullable":true,"displayHint":"short_text"},"transcription":{"type":"string","description":"Full Arabic transcription","nullable":false,"displayHint":"long_text"}}`;

  const schemaUserContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } }> = [
    { type: "text", text: `Based on this conversation about a document collection, generate the metadata schema:\n\nCONVERSATION:\n${conversationSummary}\n\nGenerate the complete field schema as a flat JSON object.` },
  ];
  for (const url of allImageUrls.slice(0, 3)) {
    schemaUserContent.push({ type: "image_url", image_url: { url, detail: "high" } });
  }

  const schemaResponse = await invokeLLM({
    messages: [
      { role: "system", content: schemaGenSystem },
      { role: "user", content: schemaUserContent as Parameters<typeof invokeLLM>[0]["messages"][0]["content"] },
    ],
  });

  const schemaRaw = typeof schemaResponse.choices[0]?.message?.content === "string"
    ? schemaResponse.choices[0].message.content : "{}";
  let jsonSchema: GeneratedConfig["jsonSchema"];
  try {
    jsonSchema = parseLLMJson(schemaRaw);
  } catch {
    // Fallback: basic Dublin Core schema
    jsonSchema = {
      title: { type: "string", description: "Document title", nullable: true, displayHint: "short_text" },
      creator: { type: "string", description: "Creator or author", nullable: true, displayHint: "short_text" },
      date: { type: "string", description: "Date of the document", nullable: true, displayHint: "short_text" },
      description: { type: "string", description: "Brief description", nullable: true, displayHint: "long_text" },
      subject: { type: "string", description: "Subject or topic", nullable: true, displayHint: "short_text" },
      type: { type: "string", description: "Document type", nullable: true, displayHint: "short_text" },
      source: { type: "string", description: "Source of the document", nullable: true, displayHint: "short_text" },
      transcription: { type: "string", description: "Full transcription", nullable: false, displayHint: "long_text" },
    };
  }

  // --- STEP 3: Generate glossary ---
  const glossaryGenSystem = `You are a domain expert helping build a glossary for an archival transcription project.
Generate a JSON object where each key is a term (in the original language or abbreviation) and each value is its definition/meaning in English.

Rules:
- Include at least 8 terms
- Focus on: abbreviations, historical terms, place names, measurement units, specialized vocabulary
- Terms should be specific to the document collection described
- Include common handwriting abbreviations if relevant

Output ONLY a flat JSON object. No wrapper key, no markdown fences. Example:
{"م.ك":"tablespoon (abbreviation)","م.ص":"teaspoon (abbreviation)"}`;

  const glossaryResponse = await invokeLLM({
    messages: [
      { role: "system", content: glossaryGenSystem },
      { role: "user", content: `Based on this conversation about a document collection, generate the domain glossary:\n\nCONVERSATION:\n${conversationSummary}\n\nGenerate the glossary as a flat JSON object.` },
    ],
  });

  const glossaryRaw = typeof glossaryResponse.choices[0]?.message?.content === "string"
    ? glossaryResponse.choices[0].message.content : "{}";
  let glossary: Record<string, string>;
  try {
    glossary = parseLLMJson(glossaryRaw);
  } catch {
    glossary = {};
  }

  // --- Assemble final config ---
  const config: GeneratedConfig = {
    pipelineType: (promptConfig.pipelineType as "single_pass" | "two_pass") || "two_pass",
    modelName: promptConfig.modelName || "gemini-3.1-pro-preview",
    systemPrompt: promptConfig.systemPrompt || "",
    pass2Prompt: promptConfig.pass2Prompt || undefined,
    jsonSchema: jsonSchema && Object.keys(jsonSchema).length > 0 ? jsonSchema : {
      title: { type: "string", description: "Document title", nullable: true, displayHint: "short_text" },
      transcription: { type: "string", description: "Full transcription", nullable: false, displayHint: "long_text" },
    },
    glossary: glossary && Object.keys(glossary).length > 0 ? glossary : {},
    postProcessing: [{ type: "illegible_marker", field: "transcription", marker: "[غير مقروء]" }],
    outputFormats: ["json", "csv"],
    reasoning: promptConfig.reasoning || "Generated from conversational onboarding.",
  };

  return config;
}
