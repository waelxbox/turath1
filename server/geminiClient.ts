/**
 * Direct Google AI (Gemini) client
 * ==================================
 * Calls the Google AI Gemini API directly using the user's GOOGLE_AI_API_KEY.
 * This bypasses the Manus Forge proxy so that any Gemini model can be selected
 * (gemini-2.5-pro, gemini-3.1-pro-preview-03-25, etc.)
 *
 * Uses the OpenAI-compatible endpoint that Google provides:
 *   https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 */

import { ENV } from "./_core/env";
import type { InvokeParams, InvokeResult } from "./_core/llm";

// Known Gemini model IDs — kept in sync with the frontend dropdown
// Uses the OpenAI-compatible endpoint: https://generativelanguage.googleapis.com/v1beta/openai/
// Model IDs verified against the working Selim Hassan and Brovarski apps.
export const GEMINI_MODELS = new Set([
  // Gemini 3 family
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  // Gemini 2.5 family
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  // Gemini 2.0 family
  "gemini-2.0-flash",
  // Gemini 1.5 family
  "gemini-1.5-pro",
]);

export function isGeminiModel(modelName: string): boolean {
  return modelName.startsWith("gemini-");
}

/**
 * Call the Gemini API directly via its OpenAI-compatible endpoint.
 * Falls back to the Forge proxy if no GOOGLE_AI_API_KEY is set.
 */
export async function invokeGemini(
  params: InvokeParams & { model: string }
): Promise<InvokeResult> {
  const apiKey = ENV.googleAiApiKey;

  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY is not configured. Please add your Google AI API key in project settings."
    );
  }

  const { messages, model, response_format, responseFormat, max_tokens, maxTokens } = params;

  // Normalize messages to OpenAI format
  const normalizedMessages = messages.map((msg) => {
    if (typeof msg.content === "string") return msg;
    if (Array.isArray(msg.content)) {
      // Keep multipart content as-is (image_url etc.)
      return msg;
    }
    return msg;
  });

  const payload: Record<string, unknown> = {
    model,
    messages: normalizedMessages,
    max_tokens: max_tokens ?? maxTokens ?? 32768,
  };

  const fmt = responseFormat ?? response_format;
  if (fmt) {
    payload.response_format = fmt;
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API error: ${response.status} ${response.statusText} — ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}
