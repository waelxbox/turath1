/**
 * AI Onboarding Agent
 * ====================
 * Analyzes 3-5 sample document/transcription pairs to auto-generate:
 * - System prompt (expert persona + instructions)
 * - JSON schema (field definitions)
 * - Domain glossary (specialized terminology)
 * - Post-processing rules (date formats, illegible markers, etc.)
 * - Pipeline type recommendation (single_pass vs two_pass)
 * - Model recommendation
 */

import { invokeLLM } from "./_core/llm";

export interface SamplePair {
  imageBase64: string;
  mimeType: string;
  filename: string;
  manualTranscription: Record<string, unknown>;
}

export interface GeneratedConfig {
  pipelineType: "single_pass" | "two_pass";
  modelName: string;
  systemPrompt: string;
  pass2Prompt?: string;
  jsonSchema: Record<string, {
    type: "string" | "boolean" | "array" | "number";
    description: string;
    nullable: boolean;
    displayHint?: "short_text" | "long_text" | "tag_list";
  }>;
  glossary: Record<string, string>;
  postProcessing: Array<{ type: string; field: string; marker?: string; format?: string }>;
  outputFormats: string[];
  reasoning: string;
}

const META_PROMPT = `You are an expert AI system designer specializing in archival document processing pipelines for digital humanities researchers.

You will be given between 3 and 5 pairs of:
1. A scanned archival document image
2. A researcher's manual transcription of that document (provided as plain text or structured text)

Your task is to deeply analyze these pairs and generate a COMPLETE project configuration for an AI transcription pipeline.

CRITICAL REQUIREMENTS — you MUST always produce all of these, even if the manual transcriptions are plain text:

1. **jsonSchema**: ALWAYS generate a detailed JSON schema. Look at the manual transcriptions and identify every distinct piece of information the researcher recorded. If the transcription is plain text, infer logical fields from the content (e.g., date, sender, recipient, location, subject, body_text, language, document_type). Every field must have a type, description, nullable flag, and displayHint. NEVER leave jsonSchema empty or with fewer than 3 fields.

2. **glossary**: ALWAYS extract domain-specific vocabulary. Look for: specialized historical titles (e.g., "Mudir", "Nazir", "Bey"), place names, technical terms, abbreviations, non-standard spellings, and transliterations. If the documents are in a non-Latin script, include transliteration conventions. NEVER leave glossary empty.

3. **systemPrompt**: Write a complete, expert-level prompt that:
   - Establishes a clear expert persona matching the document type (e.g., "You are an expert Egyptologist and Arabic paleographer...")
   - Lists ALL terms from the glossary with their preferred forms
   - Defines the exact output schema with field descriptions
   - Specifies rules for handling uncertainty, illegible text, and special characters
   - Specifies the output language
   - Ends with: "Output ONLY valid JSON. No markdown fences, no prose."

You MUST output a single valid JSON object with this exact structure:
{
  "pipelineType": "single_pass" | "two_pass",
  "modelName": "gemini-2.5-flash",
  "systemPrompt": "<complete expert-level system prompt>",
  "pass2Prompt": "<only if two_pass, otherwise null>",
  "jsonSchema": {
    "<fieldName>": {
      "type": "string" | "boolean" | "array" | "number",
      "description": "<what this field captures>",
      "nullable": true | false,
      "displayHint": "short_text" | "long_text" | "tag_list"
    }
  },
  "glossary": {
    "<specialized_term>": "<preferred transcription or definition>"
  },
  "postProcessing": [
    { "type": "illegible_marker", "field": "<fieldName>", "marker": "[illegible]" },
    { "type": "date_normalize", "field": "<fieldName>", "format": "YYYY-MM-DD" }
  ],
  "outputFormats": ["json", "csv"],
  "reasoning": "<2-3 sentence explanation of your choices>"
}

Guidelines for pipelineType:
- Use "two_pass" if documents require BOTH transcription AND translation (e.g., Arabic/French → English)
- Use "single_pass" for documents that only need transcription/structuring in one language

Guidelines for jsonSchema field inference from plain text:
- Look at what information the researcher chose to record in their manual transcription
- Common archival fields: date, sender, recipient, location, subject, body_text, document_type, language, archive_reference, notes
- For multi-language documents: add separate fields for original_text and translation
- Use "long_text" displayHint for fields with substantial text content (>100 chars)
- Use "tag_list" displayHint for array fields (people, places, keywords)
- Use "short_text" for brief identifiers (dates, names, reference numbers)

Guidelines for glossary extraction:
- Extract ALL specialized terms that appear in the transcriptions
- Include historical titles, honorifics, administrative terms, place names
- Include any non-standard spellings or transliterations used consistently
- If documents are in Arabic/Ottoman Turkish/Persian, include common terms and their English equivalents
- Minimum 5 entries; aim for 10-20 for rich archival collections

Output ONLY the JSON object. No markdown fences, no explanation outside the JSON.`;

/**
 * Generate a project configuration from sample document/transcription pairs.
 */
export async function generateProjectConfig(samples: SamplePair[]): Promise<GeneratedConfig> {
  const userContent: Array<{
    type: "text" | "image_url";
    text?: string;
    image_url?: { url: string; detail: "high" };
  }> = [];

  userContent.push({
    type: "text",
    text: `I am providing you with ${samples.length} sample document/transcription pairs from an archival research project. Please analyze them carefully and generate the complete project configuration.\n\nIMPORTANT: The manual transcriptions may be in plain text format. You MUST still generate a complete jsonSchema and glossary by inferring the structure from the content.\n\n`,
  });

  samples.forEach((sample, i) => {
    userContent.push({
      type: "text",
      text: `--- SAMPLE ${i + 1}: ${sample.filename} ---\n`,
    });
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${sample.mimeType};base64,${sample.imageBase64}`,
        detail: "high",
      },
    });

    // Format the manual transcription in a human-readable way
    const transcription = sample.manualTranscription;
    let transcriptionDisplay: string;
    if (transcription.transcription_text && typeof transcription.transcription_text === "string") {
      // Plain text transcription stored under the default key
      transcriptionDisplay = `Manual transcription (plain text):\n${transcription.transcription_text}`;
    } else {
      transcriptionDisplay = `Manual transcription:\n${JSON.stringify(transcription, null, 2)}`;
    }

    userContent.push({
      type: "text",
      text: `${transcriptionDisplay}\n\n`,
    });
  });

  userContent.push({
    type: "text",
    text: "Based on these samples, generate the complete project configuration JSON. Remember: you MUST produce a non-empty jsonSchema with at least 3 fields and a non-empty glossary with at least 5 terms.",
  });

  const response = await invokeLLM({
    messages: [
      { role: "system", content: META_PROMPT },
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

  // Safety net: if the model still returned empty schema/glossary, add defaults
  if (!config.jsonSchema || Object.keys(config.jsonSchema).length === 0) {
    config.jsonSchema = {
      document_type: { type: "string", description: "Type of archival document", nullable: true, displayHint: "short_text" },
      date: { type: "string", description: "Date of the document", nullable: true, displayHint: "short_text" },
      transcription: { type: "string", description: "Full transcription of the document text", nullable: false, displayHint: "long_text" },
      notes: { type: "string", description: "Researcher notes and observations", nullable: true, displayHint: "long_text" },
    };
  }
  if (!config.glossary || Object.keys(config.glossary).length === 0) {
    config.glossary = { "[illegible]": "Use this marker for text that cannot be read" };
  }

  return config;
}

/**
 * Normalize a value to a plain string for fuzzy comparison.
 * Handles strings, numbers, booleans, arrays, and objects.
 */
function normalizeForComparison(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val.toLowerCase().replace(/\s+/g, " ").trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val).toLowerCase().trim();
  if (Array.isArray(val)) return val.map(normalizeForComparison).sort().join("|");
  if (typeof val === "object") {
    // For nested objects, extract all leaf string values
    return Object.values(val as Record<string, unknown>)
      .map(normalizeForComparison)
      .filter(Boolean)
      .join(" ");
  }
  return String(val).toLowerCase().trim();
}

/**
 * Compute a simple character-level similarity ratio between two strings.
 * Returns a value between 0 (no match) and 1 (identical).
 */
function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  // Use longest common subsequence length as the similarity metric
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1;

  // Simple overlap: count matching characters in the shorter string
  let matches = 0;
  const usedIndices = new Set<number>();
  for (const ch of shorter) {
    const idx = longer.indexOf(ch);
    if (idx !== -1 && !usedIndices.has(idx)) {
      matches++;
      usedIndices.add(idx);
    }
  }

  return matches / longer.length;
}

/**
 * Validate a generated config against a held-out sample.
 * Returns a field-by-field comparison with a fuzzy similarity score.
 */
export async function validateConfig(
  config: GeneratedConfig,
  heldOutSample: SamplePair
): Promise<{
  aiOutput: Record<string, unknown>;
  score: number;
  fieldComparisons: Array<{
    field: string;
    expected: unknown;
    actual: unknown;
    match: boolean;
    similarity: number;
  }>;
}> {
  const { invokeLLM: llm } = await import("./_core/llm");

  const messages: Parameters<typeof invokeLLM>[0]["messages"] = [
    { role: "system", content: config.systemPrompt },
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:${heldOutSample.mimeType};base64,${heldOutSample.imageBase64}`,
            detail: "high",
          },
        },
        {
          type: "text",
          text: "Please transcribe this document and return the result as the JSON object described in your instructions.",
        },
      ],
    },
  ];

  const response = await llm({ messages });
  const rawContent = response.choices[0]?.message?.content ?? "{}";
  const raw = typeof rawContent === "string" ? rawContent : "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();

  let aiOutput: Record<string, unknown> = {};
  try {
    aiOutput = JSON.parse(cleaned);
  } catch {
    aiOutput = { error: "Failed to parse AI output", raw: cleaned };
  }

  // Compare field by field using fuzzy matching
  const expected = heldOutSample.manualTranscription;
  const fieldComparisons: Array<{
    field: string;
    expected: unknown;
    actual: unknown;
    match: boolean;
    similarity: number;
  }> = [];

  let totalSimilarity = 0;
  const allFields = Array.from(new Set([...Object.keys(expected), ...Object.keys(aiOutput)]));
  const comparableFields = allFields.filter(f => !f.startsWith("_"));

  for (const field of comparableFields) {
    const exp = expected[field];
    const act = aiOutput[field];

    const normExp = normalizeForComparison(exp);
    const normAct = normalizeForComparison(act);

    // A field "matches" if similarity >= 70%
    const similarity = similarityRatio(normExp, normAct);
    const match = similarity >= 0.7;

    totalSimilarity += similarity;
    fieldComparisons.push({ field, expected: exp, actual: act, match, similarity });
  }

  const score = comparableFields.length > 0
    ? Math.round((totalSimilarity / comparableFields.length) * 100)
    : 0;

  return { aiOutput, score, fieldComparisons };
}

/**
 * Refine a generated config based on natural language feedback.
 * Uses Gemini 3.1 Pro for maximum intelligence and includes a safety merge
 * to prevent accidental deletion of fields the model forgets to include.
 */
export async function refineConfig(
  currentConfig: GeneratedConfig,
  feedback: string,
  samples: SamplePair[]
): Promise<GeneratedConfig> {
  const { invokeGemini } = await import("./geminiClient");

  const sampleSummary = samples.length > 0
    ? samples.map((s, i) => {
        const t = s.manualTranscription;
        const display = t.transcription_text
          ? `Plain text: ${t.transcription_text}`
          : JSON.stringify(t, null, 2);
        return `Sample ${i + 1} (${s.filename}):\n${display}`;
      }).join("\n\n")
    : "(No samples available — use the current config as the sole reference.)";

  const REFINE_SYSTEM_PROMPT = `You are an expert AI configuration editor for archival document transcription pipelines.

Your job is to make TARGETED, SURGICAL edits to an existing project configuration based on the researcher's natural language instructions.

CRITICAL RULES:
1. PRESERVE EVERYTHING the user did NOT ask to change. Do NOT delete, empty, or simplify any field unless the user EXPLICITLY asks you to.
2. You have FULL editing access to ALL configuration fields:
   - systemPrompt: The AI's instructions for reading documents
   - pass2Prompt: Second-pass instructions (for two_pass pipeline only)
   - jsonSchema: The fields to extract from each document (each with type, description, nullable, displayHint)
   - glossary: Domain-specific terms and their definitions/translations
   - postProcessing: Rules for normalizing output (date formats, markers, etc.)
   - pipelineType: "single_pass" or "two_pass"
   - modelName: Which AI model to use
   - outputFormats: Export formats
3. When ADDING fields to jsonSchema, keep ALL existing fields and ADD the new ones.
4. When ADDING terms to glossary, keep ALL existing terms and ADD the new ones.
5. When EDITING the systemPrompt, preserve its overall structure and only modify the specific parts the user mentioned.
6. The "reasoning" field should be a 1-2 sentence summary of EXACTLY what you changed (e.g., "Added 'archive_reference' field to jsonSchema and updated systemPrompt to mention it.").
7. jsonSchema MUST have at least 3 fields. glossary MUST have at least 3 entries. NEVER return them empty.
8. Return the COMPLETE configuration — every field must be present in your output, even if unchanged.

Output ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.`;

  const refinePrompt = `Here is the CURRENT project configuration (preserve everything not explicitly changed):

${JSON.stringify(currentConfig, null, 2)}

---

Sample transcriptions for context:
${sampleSummary}

---

The researcher's instruction:
"${feedback}"

---

Apply the researcher's instruction to the configuration above. Make ONLY the changes they asked for. Return the complete updated configuration as a JSON object with these fields: pipelineType, modelName, systemPrompt, pass2Prompt (or null), jsonSchema, glossary, postProcessing, outputFormats, reasoning.`;

  const response = await invokeGemini({
    model: "gemini-3.1-pro-preview",
    messages: [
      { role: "system", content: REFINE_SYSTEM_PROMPT },
      { role: "user", content: refinePrompt },
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
    max_tokens: 32768,
  });

  const rawContent = response.choices[0]?.message?.content ?? "{}";
  const raw = typeof rawContent === "string" ? rawContent : "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  
  let refined: GeneratedConfig;
  try {
    refined = JSON.parse(cleaned) as GeneratedConfig;
  } catch {
    throw new Error("AI returned invalid JSON. Please try rephrasing your request.");
  }

  // Safety merge: if the model accidentally emptied critical fields, restore from current config
  if (!refined.jsonSchema || Object.keys(refined.jsonSchema).length === 0) {
    refined.jsonSchema = currentConfig.jsonSchema;
  }
  if (!refined.glossary || Object.keys(refined.glossary).length === 0) {
    refined.glossary = currentConfig.glossary;
  }
  if (!refined.systemPrompt || refined.systemPrompt.trim().length < 50) {
    refined.systemPrompt = currentConfig.systemPrompt;
  }
  if (!refined.postProcessing) {
    refined.postProcessing = currentConfig.postProcessing;
  }
  if (!refined.outputFormats || refined.outputFormats.length === 0) {
    refined.outputFormats = currentConfig.outputFormats;
  }
  if (!refined.pipelineType) {
    refined.pipelineType = currentConfig.pipelineType;
  }
  if (!refined.modelName) {
    refined.modelName = currentConfig.modelName;
  }

  return refined;
}
