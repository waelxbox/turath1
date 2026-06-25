/**
 * Universal Transcription Engine
 * ================================
 * Parameterized transcription engine that replaces the hardcoded Python scripts.
 * Supports both single-pass (Brovarski-style) and two-pass (Selim Hassan-style) pipelines.
 * Configuration is loaded dynamically from the project's database record.
 */

import { invokeLLM } from "./_core/llm";
import { invokeGemini, isGeminiModel } from "./geminiClient";
import type { Project } from "../drizzle/schema";
import { ENV } from "./_core/env";

/**
 * Route LLM call: use direct Gemini API when GOOGLE_AI_API_KEY is set and model is Gemini,
 * otherwise fall back to the Manus Forge proxy.
 */
async function callLLM(
  params: Parameters<typeof invokeLLM>[0],
  modelName: string
): Promise<ReturnType<typeof invokeLLM>> {
  if (ENV.googleAiApiKey && isGeminiModel(modelName)) {
    return invokeGemini({ ...params, model: modelName });
  }
  return invokeLLM(params);
}

export interface TranscriptionResult {
  rawJson: Record<string, unknown>;
  originalText?: string;
  modelUsed: string;
  error?: string;
}

type SchemaField = {
  type: string;
  description?: string;
  nullable?: boolean;
  displayHint?: string;
};

/**
 * Build a JSON schema object for the LLM response_format from the project's stored schema.
 */
function buildJsonSchema(projectSchema: Record<string, SchemaField>) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [fieldName, fieldDef] of Object.entries(projectSchema)) {
    if (fieldDef.type === "array") {
      properties[fieldName] = {
        type: "array",
        items: { type: "string" },
        description: fieldDef.description ?? "",
      };
    } else if (fieldDef.type === "boolean") {
      properties[fieldName] = { type: "boolean", description: fieldDef.description ?? "" };
    } else if (fieldDef.type === "number") {
      properties[fieldName] = { type: "number", description: fieldDef.description ?? "" };
    } else {
      // string (short or long)
      properties[fieldName] = { type: "string", description: fieldDef.description ?? "" };
    }
    if (!fieldDef.nullable) required.push(fieldName);
  }

  return {
    type: "json_schema" as const,
    json_schema: {
      name: "transcription_output",
      strict: false,
      schema: {
        type: "object",
        properties,
        required,
        additionalProperties: true,
      },
    },
  };
}

/**
 * Build a runtime system prompt by appending glossary and schema description
 * to the user-authored instructions. This keeps the three fields separate in the UI
 * but assembles them at transcription time for optimal LLM performance.
 */
function buildRuntimePrompt(project: Project): string {
  let prompt = project.systemPrompt ?? "You are an expert document transcriber. Output valid JSON only.";

  // Append glossary if available and not already embedded in the prompt
  const glossary = project.glossary as Record<string, string> | null;
  if (glossary && Object.keys(glossary).length > 0) {
    const alreadyHasGlossary = prompt.toLowerCase().includes("glossary");
    if (!alreadyHasGlossary) {
      prompt += "\n\nGlossary of terms and preferred transcriptions:\n";
      for (const [term, definition] of Object.entries(glossary)) {
        prompt += `– ${term}: ${definition}\n`;
      }
    }
  }

  // Append schema field descriptions if not already embedded
  const schema = project.jsonSchema as Record<string, SchemaField> | null;
  if (schema && Object.keys(schema).length > 0) {
    const alreadyHasSchema = prompt.toLowerCase().includes("output only valid json");
    if (!alreadyHasSchema) {
      prompt += "\nOutput ONLY valid JSON. No markdown fences, no prose.";
    }
  }

  return prompt;
}

/**
 * Single-pass pipeline: image → structured JSON directly.
 * Used for projects like Brovarski (index cards, no translation needed).
 */
async function runSinglePass(
  project: Project,
  imageBase64: string,
  mimeType: string,
  pageContext?: string
): Promise<Record<string, unknown>> {
  const systemPrompt = buildRuntimePrompt(project);
  const schema = project.jsonSchema as Record<string, SchemaField> | null;

  let userText = "Please transcribe this document and return the result as the JSON object described in your instructions.";
  if (pageContext) {
    userText = `This is a continuation page of a multi-page document. Here are the transcriptions from the previous page(s) for context:\n\n${pageContext}\n\n---\nNow please transcribe THIS page (the image provided) and return the result as the JSON object described in your instructions. Note: shared metadata (sender, recipient, date, etc.) may be the same as previous pages.`;
  }

  const messages: Parameters<typeof invokeLLM>[0]["messages"] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${imageBase64}`,
            detail: "high",
          },
        },
        {
          type: "text",
          text: userText,
        },
      ],
    },
  ];

  const response = await callLLM(
    {
      messages,
      ...(schema ? { response_format: buildJsonSchema(schema) } : {}),
    },
    project.modelName
  );

  const rawContent = response.choices[0]?.message?.content ?? "{}";
  const raw = typeof rawContent === "string" ? rawContent : "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Two-pass pipeline: image → verbatim text (pass 1) → translation + JSON (pass 2).
 * Used for projects like Selim Hassan (French/Arabic documents requiring translation).
 */
async function runTwoPass(
  project: Project,
  imageBase64: string,
  mimeType: string,
  pageContext?: string
): Promise<{ result: Record<string, unknown>; originalText: string }> {
  // Pass 1 gets glossary appended for accurate transcription of specialized terms
  const pass1Prompt = buildRuntimePrompt(project);

  const pass2Prompt = project.pass2Prompt ?? `You are an expert archival historian and translator.
Translate the provided transcription into English and extract structured metadata.
Output ONLY valid JSON.`;

  const schema = project.jsonSchema as Record<string, SchemaField> | null;

  let pass1UserText = "Verbatim transcription of all text, please.";
  if (pageContext) {
    pass1UserText = `This is a continuation page of a multi-page document. Previous page(s) transcription for context:\n\n${pageContext}\n\n---\nNow provide a verbatim transcription of all text on THIS page (the image provided).`;
  }

  // Pass 1: Vision → verbatim text
  const pass1Response = await callLLM({
    messages: [
      { role: "system", content: pass1Prompt },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "high" },
          },
          { type: "text", text: pass1UserText },
        ],
      },
    ],
  }, project.modelName);

  const pass1Content = pass1Response.choices[0]?.message?.content ?? "";
  const originalText = typeof pass1Content === "string" ? pass1Content : "";

  // Pass 2: Text → translation + JSON
  const pass2Response = await callLLM({
    messages: [
      { role: "system", content: pass2Prompt },
      { role: "user", content: `Transcription to process:\n\n${originalText}` },
    ],
    ...(schema ? { response_format: buildJsonSchema(schema) } : {}),
  }, project.modelName);

  const pass2Content = pass2Response.choices[0]?.message?.content ?? "{}";
  const raw2 = typeof pass2Content === "string" ? pass2Content : "{}";
  const cleaned = raw2.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  const result = JSON.parse(cleaned);
  result.Original_Transcription = originalText;

  return { result, originalText };
}

/**
 * Apply post-processing rules to the transcription result.
 * Rules are stored in the project's postProcessing JSON field.
 */
function applyPostProcessing(
  result: Record<string, unknown>,
  rules: Array<{ type: string; field: string; marker?: string; format?: string }> | null
): Record<string, unknown> {
  if (!rules || rules.length === 0) return result;
  const processed = { ...result };
  for (const rule of rules) {
    if (rule.type === "illegible_marker" && rule.field && rule.marker) {
      const val = processed[rule.field];
      if (typeof val === "string") {
        processed[rule.field] = val.replace(/\[illegible\]|\.\.\./g, rule.marker);
      }
    }
    // Additional rule types can be added here (date normalization, etc.)
  }
  return processed;
}

/**
 * Main entry point: process a single document image using the project's configuration.
 */
export async function processDocument(
  project: Project,
  imageBase64: string,
  mimeType: string,
  filename: string,
  options?: { pageContext?: string }  // Previous pages' transcriptions for multi-page documents
): Promise<TranscriptionResult> {
  try {
    let rawJson: Record<string, unknown>;
    let originalText: string | undefined;

    if (project.pipelineType === "two_pass") {
      const { result, originalText: ot } = await runTwoPass(project, imageBase64, mimeType, options?.pageContext);
      rawJson = result;
      originalText = ot;
    } else {
      rawJson = await runSinglePass(project, imageBase64, mimeType, options?.pageContext);
    }

    // Apply post-processing rules
    const postProcessingRules = project.postProcessing as Array<{ type: string; field: string; marker?: string }> | null;
    rawJson = applyPostProcessing(rawJson, postProcessingRules);

    // Attach metadata
    rawJson._source_image = filename;
    rawJson._model = project.modelName;
    rawJson._review_status = "pending";

    return {
      rawJson,
      originalText,
      modelUsed: project.modelName,
    };
  } catch (error) {
    return {
      rawJson: {
        error: error instanceof Error ? error.message : String(error),
        _source_image: filename,
        _model: project.modelName,
        _review_status: "error",
      },
      modelUsed: project.modelName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
