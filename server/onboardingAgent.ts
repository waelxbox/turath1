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

/**
 * Dublin Core core fields that should always be present in generated schemas.
 * The exact field names may vary (e.g., "sender" instead of "creator") but
 * the concepts must be covered.
 */
const DUBLIN_CORE_CONCEPTS = [
  "title",        // formal name of the resource
  "creator",      // who created the document (sender, author, etc.)
  "date",         // when it was created
  "description",  // summary or account of content
  "subject",      // topic keywords
  "type",         // nature or genre (letter, invoice, etc.)
  "source",       // archive reference or provenance
];

const META_PROMPT = `You are an expert AI system designer specializing in archival document processing pipelines for digital humanities researchers.

You will be given between 1 and 5 pairs of:
1. A scanned archival document image
2. A researcher's manual transcription of that document (provided as plain text or structured text)

Your task is to deeply analyze these pairs and generate a COMPLETE project configuration for an AI transcription pipeline.

CRITICAL: The output has THREE SEPARATE components that must NOT overlap:
- "systemPrompt": ONLY transcription instructions and rules (persona, how to handle the document, output rules)
- "jsonSchema": ONLY the structured field definitions (what to extract)
- "glossary": ONLY domain-specific terminology (term → definition pairs)

DO NOT embed the JSON schema definition inside the systemPrompt.
DO NOT embed glossary terms inside the systemPrompt.
The system will automatically inject the glossary and schema into the prompt at runtime.

═══════════════════════════════════════════════════════════════════════════
REQUIREMENTS FOR EACH COMPONENT:
═══════════════════════════════════════════════════════════════════════════

1. **systemPrompt** — Transcription instructions ONLY:
   - Establish a clear expert persona matching the document type (e.g., "You are an expert Egyptologist and Arabic paleographer...")
   - Define rules for handling the document (language, script, illegible text, special characters)
   - Specify transcription approach (verbatim vs. normalized, how to handle abbreviations)
   - Specify rules for dates, names, uncertain readings
   - End with: "Output ONLY valid JSON. No markdown fences, no prose."
   - DO NOT list schema fields in the prompt — the schema is enforced separately
   - DO NOT list glossary terms in the prompt — the glossary is injected separately at runtime

2. **jsonSchema** — Field definitions (MUST include Dublin Core core concepts):
   The schema MUST ALWAYS include at minimum these conceptual fields (exact names can vary):
   - A "title" or "headline" field (formal name/title of the document)
   - A "creator" or "sender" or "author" field (who created/sent it)
   - A "date" or "creation_date" field (when it was created, in YYYY-MM-DD format)
   - A "description" or "summary" field (1-2 sentence summary of content)
   - A "subject" or "keywords" field (topic keywords, as array type)
   - A "type" or "document_type" field (genre/nature: letter, invoice, receipt, etc.)
   - A "source" or "archive_reference" field (provenance/reference number)
   - A "transcription" field (the full text content, ALWAYS required, displayHint: "long_text")
   
   Plus any additional fields specific to the collection (recipient, location, financial values, etc.)
   
   Each field must have: type ("string"|"number"|"boolean"|"array"), description, nullable (true/false), displayHint ("short_text"|"long_text"|"tag_list")

3. **glossary** — Domain-specific vocabulary ONLY:
   - Extract ALL specialized terms from the documents
   - Include historical titles, honorifics, administrative terms, place names
   - Include transliterations and non-standard spellings
   - Format: { "term": "English definition or preferred form" }
   - Minimum 5 entries; aim for 10-20 for rich collections

═══════════════════════════════════════════════════════════════════════════

You MUST output a single valid JSON object with this exact structure:
{
  "pipelineType": "single_pass" | "two_pass",
  "modelName": "gemini-2.5-flash" | "gemini-3.1-pro-preview",
  "systemPrompt": "<transcription rules ONLY — no schema, no glossary>",
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

Guidelines for modelName:
- Use "gemini-3.1-pro-preview" if ANY Arabic text is present in the documents (handwritten or printed Arabic, Ottoman Turkish, or any right-to-left script). This is the ONLY model capable of processing Arabic manuscripts.
- Use "gemini-2.5-flash" for all other languages (French, English, German, Latin, etc.)

Guidelines for pipelineType:
- Use "two_pass" if documents require BOTH transcription AND translation (e.g., Arabic/French → English metadata)
- Use "single_pass" for documents that only need transcription/structuring in one language

Guidelines for jsonSchema field inference from plain text:
- Look at what information the researcher chose to record in their manual transcription
- ALWAYS include the Dublin Core core fields listed above, even if the researcher didn't explicitly record them
- For multi-language documents: add separate fields for original_text/transcription and english_translation
- Use "long_text" displayHint for fields with substantial text content (>100 chars)
- Use "tag_list" displayHint for array fields (people, places, keywords)
- Use "short_text" for brief identifiers (dates, names, reference numbers)

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
    text: `I am providing you with ${samples.length} sample document/transcription pairs from an archival research project. Please analyze them carefully and generate the complete project configuration.\n\nIMPORTANT:\n- The systemPrompt must contain ONLY transcription rules (persona + instructions). Do NOT embed schema definitions or glossary terms in it.\n- The jsonSchema must be a separate structured object with Dublin Core core fields + collection-specific fields.\n- The glossary must be a separate object of domain terms.\n\n`,
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
    text: "Based on these samples, generate the complete project configuration JSON. Remember:\n1. systemPrompt = transcription rules ONLY (no schema, no glossary embedded)\n2. jsonSchema MUST include Dublin Core core fields (title, creator, date, description, subject, type, source) + transcription + any collection-specific fields\n3. glossary = separate domain terms object (minimum 5 entries)",
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

  // Post-process: force gemini-3.1-pro-preview if Arabic content is detected
  const hasArabic = detectArabicContent(samples, config);
  if (hasArabic && config.modelName !== "gemini-3.1-pro-preview") {
    config.modelName = "gemini-3.1-pro-preview";
  }

  // Post-process: ensure Dublin Core core fields are present in the schema
  config.jsonSchema = ensureDublinCoreFields(config.jsonSchema);

  // Safety net: if the model still returned empty schema/glossary, add defaults
  if (!config.jsonSchema || Object.keys(config.jsonSchema).length === 0) {
    config.jsonSchema = {
      title: { type: "string", description: "Title or formal name of the document", nullable: true, displayHint: "short_text" },
      creator: { type: "string", description: "Creator, sender, or author of the document", nullable: true, displayHint: "short_text" },
      date: { type: "string", description: "Date of the document in YYYY-MM-DD format", nullable: true, displayHint: "short_text" },
      description: { type: "string", description: "Brief 1-2 sentence summary of the document content", nullable: true, displayHint: "short_text" },
      subject: { type: "array", description: "Topic keywords or themes", nullable: true, displayHint: "tag_list" },
      document_type: { type: "string", description: "Type or genre of the document (e.g., letter, invoice, receipt)", nullable: true, displayHint: "short_text" },
      source: { type: "string", description: "Archive reference or provenance information", nullable: true, displayHint: "short_text" },
      transcription: { type: "string", description: "Full transcription of the document text", nullable: false, displayHint: "long_text" },
      notes: { type: "string", description: "Researcher notes and observations", nullable: true, displayHint: "long_text" },
    };
  }
  if (!config.glossary || Object.keys(config.glossary).length === 0) {
    config.glossary = { "[illegible]": "Use this marker for text that cannot be read" };
  }

  // Clean up the systemPrompt: remove any embedded schema/glossary sections the LLM might have added
  config.systemPrompt = cleanSystemPrompt(config.systemPrompt, config.jsonSchema, config.glossary);

  return config;
}

/**
 * Detect if Arabic content is present in samples or generated config.
 * Checks manual transcriptions for Arabic Unicode characters and config for Arabic-related keywords.
 */
function detectArabicContent(samples: SamplePair[], config: GeneratedConfig): boolean {
  // Check manual transcriptions for Arabic Unicode range (\u0600-\u06FF, \u0750-\u077F, \uFB50-\uFDFF, \uFE70-\uFEFF)
  const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  for (const sample of samples) {
    const text = JSON.stringify(sample.manualTranscription);
    if (arabicRegex.test(text)) return true;
  }
  // Check if the generated config mentions Arabic in system prompt, glossary, or reasoning
  const configText = [
    config.systemPrompt,
    config.reasoning,
    JSON.stringify(config.glossary),
  ].join(" ").toLowerCase();
  if (configText.includes("arabic") || configText.includes("ottoman") || configText.includes("\u0639\u0631\u0628")) return true;
  return false;
}

/**
 * Ensure the generated schema includes Dublin Core core conceptual fields.
 * Checks for conceptual equivalents (e.g., "sender" covers "creator").
 */
function ensureDublinCoreFields(
  schema: Record<string, { type: "string" | "boolean" | "array" | "number"; description: string; nullable: boolean; displayHint?: "short_text" | "long_text" | "tag_list" }>
): typeof schema {
  if (!schema) return schema;

  const fieldNames = Object.keys(schema).map(k => k.toLowerCase());
  const fieldDescs = Object.values(schema).map(v => v.description.toLowerCase());
  const allText = [...fieldNames, ...fieldDescs].join(" ");

  // Check for each Dublin Core concept and add if missing
  const hasTitle = allText.includes("title") || allText.includes("headline") || allText.includes("subject line");
  if (!hasTitle) {
    schema.title = { type: "string", description: "Title or formal name of the document", nullable: true, displayHint: "short_text" };
  }

  const hasCreator = allText.includes("creator") || allText.includes("sender") || allText.includes("author") || allText.includes("writer");
  if (!hasCreator) {
    schema.creator = { type: "string", description: "Creator, sender, or author of the document", nullable: true, displayHint: "short_text" };
  }

  const hasDate = allText.includes("date") || allText.includes("created") || allText.includes("written");
  if (!hasDate) {
    schema.creation_date = { type: "string", description: "Date the document was created, in YYYY-MM-DD format", nullable: true, displayHint: "short_text" };
  }

  const hasDescription = allText.includes("description") || allText.includes("summary") || allText.includes("abstract");
  if (!hasDescription) {
    schema.summary = { type: "string", description: "A 1-2 sentence English summary of the document's main purpose or content", nullable: true, displayHint: "short_text" };
  }

  const hasSubject = allText.includes("subject") || allText.includes("keyword") || allText.includes("topic") || allText.includes("theme");
  if (!hasSubject) {
    schema.keywords = { type: "array", description: "Topic keywords or themes of the document", nullable: true, displayHint: "tag_list" };
  }

  const hasType = allText.includes("type") || allText.includes("genre") || allText.includes("category") || allText.includes("document_type");
  if (!hasType) {
    schema.document_type = { type: "string", description: "Type or genre of the document (e.g., letter, invoice, receipt, memo)", nullable: true, displayHint: "short_text" };
  }

  const hasSource = allText.includes("source") || allText.includes("reference") || allText.includes("provenance") || allText.includes("archive");
  if (!hasSource) {
    schema.source = { type: "string", description: "Archive reference, collection identifier, or provenance information", nullable: true, displayHint: "short_text" };
  }

  // Always ensure transcription field exists
  const hasTranscription = allText.includes("transcription") || allText.includes("body_text") || allText.includes("full_text") || allText.includes("main_text");
  if (!hasTranscription) {
    schema.transcription = { type: "string", description: "The complete and accurate transcription of the document text in its original language", nullable: false, displayHint: "long_text" };
  }

  return schema;
}

/**
 * Remove any embedded schema definitions or glossary sections from the system prompt.
 * The wizard might still embed them despite instructions; this is a safety cleanup.
 */
function cleanSystemPrompt(
  prompt: string,
  _schema: Record<string, unknown>,
  _glossary: Record<string, string>
): string {
  if (!prompt) return prompt;

  // Remove JSON schema blocks that might be embedded
  // Pattern: lines that look like JSON field definitions
  let cleaned = prompt;

  // Remove sections that define JSON output fields inline (common megaprompt pattern)
  // e.g., "The output must be a JSON object with the following fields:\n- field1: ..."
  cleaned = cleaned.replace(
    /(?:The output (?:must|should) be a JSON object.*?(?:\n(?:[-–•*]\s+\w+.*)+))/gi,
    ""
  );

  // Remove embedded glossary sections (e.g., "Glossary:\n- term: definition\n...")
  // But only if there's a separate glossary object — don't remove if user manually wrote it
  if (_glossary && Object.keys(_glossary).length > 0) {
    // Only remove auto-generated looking glossary sections (not user-authored ones)
    // Heuristic: if the glossary section contains 80%+ of the same terms as the glossary object, it's duplicated
    const glossaryTerms = Object.keys(_glossary).map(t => t.toLowerCase());
    const glossarySectionMatch = cleaned.match(/(?:glossary|terminology|terms)[\s:]*\n((?:[-–•*]\s+.+\n?)+)/i);
    if (glossarySectionMatch) {
      const sectionText = glossarySectionMatch[1].toLowerCase();
      const matchCount = glossaryTerms.filter(t => sectionText.includes(t)).length;
      if (matchCount >= glossaryTerms.length * 0.5) {
        // This is a duplicated glossary section — remove it
        cleaned = cleaned.replace(glossarySectionMatch[0], "");
      }
    }
  }

  // Clean up excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
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

  // Build a runtime prompt that includes the glossary (as the transcription engine would)
  let runtimePrompt = config.systemPrompt;
  if (config.glossary && Object.keys(config.glossary).length > 0) {
    const alreadyHasGlossary = runtimePrompt.toLowerCase().includes("glossary");
    if (!alreadyHasGlossary) {
      runtimePrompt += "\n\nGlossary of terms and preferred transcriptions:\n";
      for (const [term, definition] of Object.entries(config.glossary)) {
        runtimePrompt += `– ${term}: ${definition}\n`;
      }
    }
  }

  const messages: Parameters<typeof invokeLLM>[0]["messages"] = [
    { role: "system", content: runtimePrompt },
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
2. The THREE components must remain SEPARATE:
   - systemPrompt: ONLY transcription rules and instructions (persona, handling rules, output format)
   - jsonSchema: ONLY structured field definitions (what to extract)
   - glossary: ONLY domain-specific terms and definitions
   DO NOT embed schema definitions or glossary terms inside the systemPrompt.
3. You have FULL editing access to ALL configuration fields:
   - systemPrompt: The AI's instructions for reading documents (rules only, no schema/glossary)
   - pass2Prompt: Second-pass instructions (for two_pass pipeline only)
   - jsonSchema: The fields to extract from each document (each with type, description, nullable, displayHint)
   - glossary: Domain-specific terms and their definitions/translations
   - postProcessing: Rules for normalizing output (date formats, markers, etc.)
   - pipelineType: "single_pass" or "two_pass"
   - modelName: Which AI model to use
   - outputFormats: Export formats
4. When ADDING fields to jsonSchema, keep ALL existing fields and ADD the new ones.
5. When ADDING terms to glossary, keep ALL existing terms and ADD the new ones.
6. When EDITING the systemPrompt, preserve its overall structure and only modify the specific parts the user mentioned.
7. The "reasoning" field should be a 1-2 sentence summary of EXACTLY what you changed.
8. jsonSchema MUST have at least 3 fields. glossary MUST have at least 3 entries. NEVER return them empty.
9. Return the COMPLETE configuration — every field must be present in your output, even if unchanged.
10. jsonSchema must always include Dublin Core core concepts: title, creator, date, description, subject, type, source, and transcription.

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

Apply the researcher's instruction to the configuration above. Make ONLY the changes they asked for. Return the complete updated configuration as a JSON object with these fields: pipelineType, modelName, systemPrompt, pass2Prompt (or null), jsonSchema, glossary, postProcessing, outputFormats, reasoning.

REMINDER: systemPrompt must contain ONLY transcription rules — do NOT embed schema or glossary in it.`;

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

  // Ensure Dublin Core fields are still present after refinement
  refined.jsonSchema = ensureDublinCoreFields(refined.jsonSchema);

  // Clean up systemPrompt in case the model still embedded schema/glossary
  refined.systemPrompt = cleanSystemPrompt(refined.systemPrompt, refined.jsonSchema, refined.glossary);

  return refined;
}
