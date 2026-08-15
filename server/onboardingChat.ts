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
- ALWAYS recommend gemini-3.1-pro-preview regardless of language — it is our most capable model for all handwritten documents

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
 * 
 * CRITICAL ALIGNMENT WITH TRANSCRIPTION ENGINE:
 * - Pass 1 (systemPrompt): Receives the document IMAGE + glossary appended at runtime.
 *   Must produce PLAIN TEXT (verbatim line-by-line transcription). NOT JSON.
 *   The engine reads the raw string output directly.
 * 
 * - Pass 2 (pass2Prompt): Receives the PLAIN TEXT from Pass 1 (no image).
 *   Must produce structured JSON matching the jsonSchema field names exactly.
 *   The engine enforces the schema via response_format (json_schema).
 *   Array fields become {type: "array", items: {type: "string"}} — flat string arrays only.
 * 
 * - jsonSchema: Defines the structured output fields. Each field is either:
 *   string, number, boolean, or array (of strings). NO nested objects.
 * 
 * - glossary: Gets auto-appended to Pass 1 prompt at runtime. Should contain
 *   actual abbreviations/shorthand/terms the AI will encounter in the handwriting,
 *   NOT concept definitions.
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

  // Helper to parse LLM JSON response — handles common malformations
  function parseLLMJson(raw: string): any {
    // Remove markdown fences
    let cleaned = raw.replace(/^```(?:json)?\s*/gm, "").replace(/\s*```/gm, "").trim();
    
    // Try direct parse first
    try {
      return JSON.parse(cleaned);
    } catch {
      // Common issue: LLM puts extra content after the JSON object
      // Find the outermost balanced {} or []
      let braceCount = 0;
      let start = -1;
      let end = -1;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '{') {
          if (start === -1) start = i;
          braceCount++;
        } else if (cleaned[i] === '}') {
          braceCount--;
          if (braceCount === 0 && start !== -1) {
            end = i;
            break;
          }
        }
      }
      if (start !== -1 && end !== -1) {
        const jsonStr = cleaned.substring(start, end + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          // Check if there's a "reasoning" field after the object that we missed
          const remainder = cleaned.substring(end + 1).trim();
          const reasoningMatch = remainder.match(/"reasoning"\s*:\s*"([^"]*)"/);
          if (reasoningMatch && !parsed.reasoning) {
            parsed.reasoning = reasoningMatch[1];
          }
          return parsed;
        } catch {
          // Last resort: try to fix common issues
          throw new Error("Could not parse JSON from LLM response");
        }
      }
      throw new Error("No JSON object found in response");
    }
  }

  // --- STEP 1: Generate prompts (systemPrompt, pass2Prompt, pipelineType, modelName) ---
  const promptGenSystem = `You are an expert AI system designer for TURATH, an archival document transcription platform.
You specialize in building HIGH-ACCURACY transcription configs that achieve 80%+ accuracy on handwritten archival documents.

CRITICAL: You must understand how the transcription engine works:

PASS 1 (systemPrompt):
- The AI receives a DOCUMENT IMAGE + the system prompt (with glossary auto-appended at runtime)
- The AI must output PLAIN TEXT — a verbatim line-by-line transcription
- NOT JSON. Just raw text with line breaks preserved from the manuscript.
- DO NOT include "Output ONLY valid JSON" in the system prompt — Pass 1 outputs plain text
- DO NOT list field names or schema in the system prompt
- DO NOT list glossary terms in the system prompt (they are auto-appended at runtime)

PASS 2 (pass2Prompt):
- The AI receives the PLAIN TEXT from Pass 1 (no image) and must output structured JSON
- The pass2Prompt must instruct the AI to extract specific fields from the transcription
- List each field name with a dash and clear extraction instructions
- The output JSON schema is enforced separately by the engine — the pass2Prompt just guides the AI
- Array fields are FLAT arrays of strings (e.g., ["item1", "item2"]), NOT arrays of objects
- End with: "Output the extracted information as a JSON object."

═══════════════════════════════════════════════════════════════════════════
MANDATORY REQUIREMENTS FOR HIGH-ACCURACY systemPrompt (Pass 1):
═══════════════════════════════════════════════════════════════════════════

The systemPrompt MUST include ALL of the following sections to achieve high accuracy:

1. EXPERT PERSONA WITH COLLECTION CONTEXT:
   - Name the specific collection, time period, geographic origin, and document type
   - Example: "You are an expert Arabic paleographer specializing in early 20th-century Egyptian personal correspondence from the [Collection Name] (Cairo, circa 1919-1950)."
   - NEVER use generic personas like "You are an expert archivist" — always be specific

2. CLEAR TASK STATEMENT:
   - "Your task is to produce a faithful, verbatim transcription of the document image in its ORIGINAL language ([language])."

3. EXPLICIT TRANSCRIPTION RULES (minimum 8 rules):
   - Transcribe exactly what you see. Do NOT translate.
   - Preserve original spelling, punctuation, diacritics
   - Preserve ALL original line breaks exactly as they appear
   - For bilingual documents, transcribe in order of appearance
   - Structural markers: [LETTERHEAD]/[HEADER] and [BODY] for printed vs handwritten sections
   - [illegible] for unreadable words
   - [...] for torn or missing fragments
   - [STAMP: description] or [MARGIN: text] for annotations
   - Do NOT extract metadata, do NOT summarize, do NOT translate. Only transcribe.
   - Do NOT normalize or modernize spelling
   - Do NOT add diacritics/marks not visible in the original

4. SCRIPT/HANDWRITING-SPECIFIC GUIDANCE (critical for accuracy):
   For Arabic: dot disambiguation (ب/ت/ث/ن/ي, ج/ح/خ), common dot omissions, connected letter ambiguity, use context to disambiguate
   For French: accent marks, ligatures, abbreviation conventions
   For any handwriting: ink bleed-through awareness, crossed-out text handling, margin notes
   Include specific guidance about the handwriting STYLE in this collection (formal Naskh, informal cursive, etc.)

5. COLLECTION-SPECIFIC CONVENTIONS:
   - Common forms of address, salutations, closings
   - Gender conventions (feminine/masculine forms if relevant)
   - Number systems (Eastern Arabic numerals, Western, Roman)
   - Date format conventions in this collection

6. ANTI-HALLUCINATION RULES:
   - "Do NOT guess words you cannot read — use [illegible]"
   - "Do NOT add content that is not visible in the image"
   - "Ignore ink bleed-through from the reverse side"
   - Repeat the core constraint: "Only transcribe. Do NOT translate, summarize, or extract metadata."

═══════════════════════════════════════════════════════════════════════════
MANDATORY REQUIREMENTS FOR HIGH-ACCURACY pass2Prompt (Pass 2):
═══════════════════════════════════════════════════════════════════════════

The pass2Prompt MUST include:

1. EXPERT PERSONA matching the collection
2. CLEAR STATEMENT that it receives raw transcription text (not an image)
3. NUMBERED INSTRUCTIONS:
   - EXTRACT all structured metadata fields in ENGLISH
   - Transliterate names to Latin script with examples
   - Translate locations to English with examples
   - KEEP the transcription field exactly as provided — do not modify
   - PROVIDE faithful translation (if translation field exists)
   - WRITE concise summary with example format
4. RULES section:
   - All metadata in English for searchability
   - Consistent transliteration conventions
   - If field cannot be determined, leave null. Do not guess.
   - Specific guidance for identifying sender/recipient from context
5. End with: "Output the extracted information as a JSON object."

═══════════════════════════════════════════════════════════════════════════

Generate a JSON object with exactly these keys:
- pipelineType: "two_pass" (for documents needing transcription + metadata extraction) or "single_pass" (for simple transcription-only)
- modelName: "gemini-3.1-pro-preview" (always — our most capable model for all documents)
- systemPrompt: Pass 1 instructions following ALL mandatory requirements above
- pass2Prompt: Pass 2 instructions following ALL mandatory requirements above
- reasoning: 2-3 sentence explanation

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

  // Post-process: fix model name — Arabic/RTL handwriting should always use gemini-3.1-pro-preview
  if (promptConfig.modelName && !promptConfig.modelName.includes("gemini-3.1-pro") && !promptConfig.modelName.includes("gemini-2.5-flash")) {
    // If the model is not one of our supported ones, default based on conversation content
    const hasArabic = conversationSummary.toLowerCase().includes("arabic") || conversationSummary.toLowerCase().includes("عربي");
    promptConfig.modelName = "gemini-3.1-pro-preview";
  }
  // Also fix: if conversation mentions Arabic handwriting but model is flash, upgrade
  const mentionsArabicHandwriting = conversationSummary.toLowerCase().includes("arabic") && 
    (conversationSummary.toLowerCase().includes("handwrit") || conversationSummary.toLowerCase().includes("naskh") || conversationSummary.toLowerCase().includes("manuscript"));
  if (mentionsArabicHandwriting && promptConfig.modelName.includes("flash")) {
    promptConfig.modelName = "gemini-3.1-pro-preview";
  }

  // Post-process: ensure Pass 1 prompt does NOT contain JSON output instructions
  if (promptConfig.systemPrompt) {
    // Remove any "Output ONLY valid JSON" or similar instructions that don't belong in Pass 1
    promptConfig.systemPrompt = promptConfig.systemPrompt
      .replace(/output\s+only\s+valid\s+json[^.]*\.?/gi, "")
      .replace(/no\s+markdown\s+fences[^.]*\.?/gi, "")
      .replace(/return\s+(?:the\s+)?(?:result|output)\s+as\s+(?:a\s+)?json[^.]*\.?/gi, "")
      .trim();
  }

  // Post-process: ensure Pass 2 prompt references flat arrays, not nested objects
  if (promptConfig.pass2Prompt) {
    // Add a reminder about flat arrays if not already present
    if (!promptConfig.pass2Prompt.includes("flat array") && !promptConfig.pass2Prompt.includes("array of strings")) {
      promptConfig.pass2Prompt += "\n\nIMPORTANT: All array fields must be flat arrays of strings (e.g., [\"item1\", \"item2\"]). Do NOT use nested objects or arrays of objects.";
    }
    // Ensure it ends with JSON output instruction
    if (!promptConfig.pass2Prompt.toLowerCase().includes("output") || !promptConfig.pass2Prompt.toLowerCase().includes("json")) {
      promptConfig.pass2Prompt += "\n\nOutput the extracted information as a JSON object.";
    }
  }

  // --- STEP 2: Generate jsonSchema ---
  const schemaGenSystem = `You are an expert metadata schema designer for TURATH, an archival document transcription platform.
You design schemas that maximize SEARCHABILITY and ACCURACY for archival research.

CRITICAL RULES FOR THE SCHEMA:
1. Each field maps to a JSON output field. The field NAME you choose here is the EXACT key the AI will output.
2. Supported types:
   - "string": any text value (short or long)
   - "number": numeric values
   - "boolean": true/false
   - "array": a FLAT array of strings. NOT an array of objects. Example: ["flour", "sugar", "eggs"]
3. NO nested objects. If you need "ingredients with measurements", make it a SINGLE array field where each string includes the measurement, e.g., ["2 cups flour", "1 tsp salt"].
4. displayHint guides the UI: "short_text" (one-liner), "long_text" (multi-line textarea), "tag_list" (array as tags)
5. MUST include a "transcription" field (type: "string", nullable: false, displayHint: "long_text") — the complete transcription in the ORIGINAL language, preserving line breaks
6. MUST include an "english_translation" field (type: "string", nullable: true, displayHint: "long_text") — faithful English translation
7. Field names should use snake_case (e.g., "document_type", "creation_date")

═══════════════════════════════════════════════════════════════════════════
FIELD DESCRIPTION QUALITY REQUIREMENTS:
═══════════════════════════════════════════════════════════════════════════

Every field description MUST be SPECIFIC and include:
- What format to use (e.g., "in YYYY-MM-DD format", "transliterated into Latin script")
- Examples of expected values (e.g., "e.g., 'Rachid Behna', 'Joseph Mizrahi'")
- Clear guidance for edge cases (e.g., "If only a year is available, use YYYY-01-01")

GOOD descriptions:
- "The name of the person sending the letter, transliterated into Latin script (e.g., 'Rachid Behna', 'Joseph Mizrahi')."
- "The date the document was created, in YYYY-MM-DD format. Prioritize handwritten dates over stamped dates if conflicting. If only a year is available, use YYYY-01-01."
- "Categorize the document in English (e.g., 'Business Letter', 'Invoice', 'Ledger', 'Receipt', 'Telegram')."
- "Significant physical items, products, or thematic keywords mentioned, in English (e.g., 'cotton bales', 'children\'s vests', 'tobacco')."

BAD descriptions:
- "The sender" (too vague — no format guidance)
- "Date" (no format specified)
- "Type of document" (no examples)

═══════════════════════════════════════════════════════════════════════════
METADATA LANGUAGE RULE:
═══════════════════════════════════════════════════════════════════════════

ALL metadata fields (sender, recipient, summary, keywords, document_type, location, etc.) MUST be described as requiring ENGLISH output for searchability.
Names MUST be transliterated into Latin script.
The ONLY field that stays in the original language is the "transcription" field.

═══════════════════════════════════════════════════════════════════════════

Generate a JSON object where each key is a field name and each value is an object with:
- type: "string" | "number" | "boolean" | "array"
- description: DETAILED description with format, examples, and edge case guidance
- nullable: true or false
- displayHint: "short_text" | "long_text" | "tag_list"

Include at least 10 fields total. Include Dublin Core concepts (title/sender, date, type, source) plus collection-specific fields relevant to the documents discussed.

Output ONLY a flat JSON object (the schema). No wrapper key, no markdown fences.`;

  const schemaUserContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } }> = [
    { type: "text", text: `Based on this conversation about a document collection, generate the metadata schema.\n\nCONVERSATION:\n${conversationSummary}\n\nGenerate the complete field schema as a flat JSON object. Remember: array fields are FLAT arrays of strings only, include a 'transcription' field (original language) and an 'english_translation' field. All metadata fields must specify English output with transliteration for names.` },
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
    // Validate: ensure no nested objects in array fields
    for (const [key, field] of Object.entries(jsonSchema)) {
      if ((field as any).type === "array") {
        // Force displayHint to tag_list for arrays
        (field as any).displayHint = "tag_list";
      }
    }
    // Ensure required fields exist (accept either naming convention)
    const hasTranscription = jsonSchema.transcription || jsonSchema.full_arabic_transcription || jsonSchema.full_transcription;
    if (!hasTranscription) {
      jsonSchema.transcription = { type: "string", description: "The complete and accurate transcription of the main body of the document in its ORIGINAL language (French or Arabic), preserving original spelling and line breaks.", nullable: false, displayHint: "long_text" };
    }
    const hasTranslation = jsonSchema.english_translation || jsonSchema.full_english_translation;
    if (!hasTranslation) {
      jsonSchema.english_translation = { type: "string", description: "A direct, faithful English translation of the full document body. Translate literally — do not paraphrase or summarize. Use [illegible] where the original has [illegible].", nullable: true, displayHint: "long_text" };
    }
  } catch {
    // Fallback: basic schema with high-quality descriptions
    jsonSchema = {
      transcription: { type: "string", description: "The complete and accurate transcription of the main body of the document in its ORIGINAL language, preserving original spelling and line breaks.", nullable: false, displayHint: "long_text" },
      english_translation: { type: "string", description: "A direct, faithful English translation of the full document body. Translate literally — do not paraphrase or summarize.", nullable: true, displayHint: "long_text" },
      sender: { type: "string", description: "The name of the person or entity who sent/created the document, transliterated into Latin script (e.g., 'Rachid Behna', 'Huda Sha'rawi').", nullable: true, displayHint: "short_text" },
      recipient: { type: "string", description: "The name of the person or entity the document is addressed to, transliterated into Latin script.", nullable: true, displayHint: "short_text" },
      creation_date: { type: "string", description: "The date the document was created, in YYYY-MM-DD format. If only a year is available, use YYYY-01-01.", nullable: true, displayHint: "short_text" },
      document_type: { type: "string", description: "Categorize the document in English (e.g., 'Letter', 'Invoice', 'Telegram', 'Receipt', 'Memorandum').", nullable: true, displayHint: "short_text" },
      summary: { type: "string", description: "A 1-2 sentence English summary of the document's main purpose or content.", nullable: true, displayHint: "long_text" },
      keywords_items: { type: "array", description: "Significant items, topics, or thematic keywords mentioned, in English (e.g., 'cotton bales', 'committee meeting', 'xenophobia').", nullable: true, displayHint: "tag_list" },
      languages_present: { type: "array", description: "All languages present in the document (e.g., ['French', 'Arabic'] or ['Arabic']).", nullable: true, displayHint: "tag_list" },
      notes: { type: "string", description: "Researcher notes and observations in English regarding physical condition, marginalia, or anomalies.", nullable: true, displayHint: "long_text" },
    };
  }

  // --- STEP 3: Generate glossary ---
  // The glossary gets auto-appended to the Pass 1 system prompt at runtime.
  // It should contain ACTUAL terms the AI will encounter in the handwriting.
  const glossaryGenSystem = `You are a domain expert helping build a HIGH-ACCURACY transcription glossary for an archival project.

CRITICAL: This glossary gets appended to the AI's transcription prompt at runtime to help it correctly read handwritten documents. The glossary is the #1 tool for improving transcription accuracy — it tells the AI what specific words/names/terms to expect.

Each entry should be:
- KEY: The actual term, abbreviation, name, or shorthand as it appears in the handwriting (in the ORIGINAL script/language)
- VALUE: What it means, how it should be transcribed, or its English translation/context

═══════════════════════════════════════════════════════════════════════════
CATEGORIES TO INCLUDE (aim for ALL of these):
═══════════════════════════════════════════════════════════════════════════

1. PROPER NAMES (people who appear in the documents):
   - Key correspondents, recipients, family members
   - Include both Arabic/original script AND transliterated form
   - Example: "هدى شعراوي" → "Huda Sha'rawi (Egyptian feminist leader, common recipient)"

2. PLACE NAMES (locations mentioned):
   - Cities, districts, streets, institutions
   - Example: "المنيرة" → "Al-Munira (Cairo district)"
   - Example: "Le Caire" → "Cairo (city in Egypt), French name"

3. HONORIFICS AND TITLES:
   - Period-appropriate titles of address
   - Example: "هانم" → "Hanem (honorific for women, equivalent to 'Madame')"
   - Example: "Bey" → "Ottoman title of respect, equivalent to 'Sir' or 'Lord'"

4. ABBREVIATIONS AND SHORTHAND:
   - Common abbreviations in the handwriting
   - Example: "Fr" → "French Franc (currency abbreviation)"
   - Example: "Cie" → "Compagnie (Company)"

5. DOMAIN-SPECIFIC TERMS:
   - Terms specific to the subject matter (business, political, medical, etc.)
   - Example: "الوفد" → "Al-Wafd (political party)"
   - Example: "connaissement" → "Bill of lading (shipping document)"

6. COMMON PHRASES AND FORMULAE:
   - Salutations, closings, religious phrases common in the collection
   - Example: "المخلص" → "The devoted/sincere (closing signature)"

7. ILLEGIBILITY AND STRUCTURAL MARKERS:
   - Always include: "[illegible]" → "Use this marker for text that cannot be read"
   - Always include: "[...]" → "Use this marker for torn or missing fragments"

═══════════════════════════════════════════════════════════════════════════
BAD glossary entries (DO NOT include these):
═══════════════════════════════════════════════════════════════════════════
- "Arabic" → "Language of the original documents" (useless — the AI knows this)
- "Egyptian" → "Cuisine origin" (useless — this is a metadata category, not a term)
- "Measurements" → "Quantities or units" (useless — too vague)
- Generic English words that don't help transcription
- Definitions of concepts rather than actual terms in the documents

═══════════════════════════════════════════════════════════════════════════

Generate a JSON object where each key is a term (in the original script when applicable) and each value is its expansion/meaning.
Include at LEAST 15-25 entries covering ALL categories above. More is better for accuracy.
Output ONLY a flat JSON object. No wrapper key, no markdown fences.`;

  const glossaryResponse = await invokeLLM({
    messages: [
      { role: "system", content: glossaryGenSystem },
      { role: "user", content: `Based on this conversation about a document collection, generate a COMPREHENSIVE domain glossary. Focus on ACTUAL terms, abbreviations, proper nouns, honorifics, place names, and common phrases that would appear in the handwriting — not concept definitions.\n\nCONVERSATION:\n${conversationSummary}\n\nGenerate the glossary as a flat JSON object with at least 15-25 entries. Include entries from ALL categories: proper names, places, honorifics, abbreviations, domain terms, common phrases, and structural markers ([illegible], [...]).` },
    ],
  });

  const glossaryRaw = typeof glossaryResponse.choices[0]?.message?.content === "string"
    ? glossaryResponse.choices[0].message.content : "{}";
  let glossary: Record<string, string>;
  try {
    glossary = parseLLMJson(glossaryRaw);
    // Filter out bad entries that are just concept definitions
    const badKeys = ["Arabic", "Egyptian", "Measurements", "Ingredients list", "Newspaper Clipping", "Transcription notes"];
    for (const bad of badKeys) {
      delete glossary[bad];
    }
  } catch {
    glossary = {};
  }

  // --- STEP 4: Cross-validate pass2Prompt against schema field names ---
  // Ensure the pass2Prompt references the actual field names from the schema
  const schemaFieldNames = Object.keys(jsonSchema);
  if (promptConfig.pass2Prompt && schemaFieldNames.length > 0) {
    // Check if the pass2Prompt already lists the fields
    const mentionsFields = schemaFieldNames.filter(f => promptConfig.pass2Prompt!.includes(f));
    if (mentionsFields.length < schemaFieldNames.length * 0.5) {
      // The pass2Prompt doesn't reference enough schema fields — regenerate the field list section
      const fieldInstructions = schemaFieldNames.map(name => {
        const field = jsonSchema[name];
        const typeNote = field.type === "array" ? " (flat array of strings)" : ` (${field.type})`;
        const nullNote = field.nullable ? " If not found, set to null." : "";
        return `– '${name}'${typeNote}: ${field.description}.${nullNote}`;
      }).join("\n");

      // Replace or append the field list in pass2Prompt
      const basePrompt = promptConfig.pass2Prompt.split(/\n\n(?:Extract|Fields|Output)/i)[0] || promptConfig.pass2Prompt;
      promptConfig.pass2Prompt = `${basePrompt.trim()}\n\nExtract the following fields from the transcription:\n${fieldInstructions}\n\nIMPORTANT: All array fields must be flat arrays of strings (e.g., ["2 cups flour", "1 tsp salt"]). Do NOT use nested objects.\n\nOutput the extracted information as a JSON object.`;
    }
  }

  // --- Assemble final config ---
  const config: GeneratedConfig = {
    pipelineType: (promptConfig.pipelineType as "single_pass" | "two_pass") || "two_pass",
    modelName: promptConfig.modelName || "gemini-3.1-pro-preview",
    systemPrompt: promptConfig.systemPrompt || "",
    pass2Prompt: promptConfig.pass2Prompt || undefined,
    jsonSchema: jsonSchema && Object.keys(jsonSchema).length > 0 ? jsonSchema : {
      full_arabic_transcription: { type: "string", description: "Complete Arabic transcription", nullable: false, displayHint: "long_text" },
      full_english_translation: { type: "string", description: "English translation", nullable: true, displayHint: "long_text" },
      title: { type: "string", description: "Document title", nullable: true, displayHint: "short_text" },
    },
    glossary: glossary && Object.keys(glossary).length > 0 ? glossary : {},
    postProcessing: [{ type: "illegible_marker", field: "full_arabic_transcription", marker: "[غير مقروء]" }],
    outputFormats: ["json", "csv"],
    reasoning: promptConfig.reasoning || "Generated from conversational onboarding.",
  };

  return config;
}
