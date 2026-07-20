/**
 * Embedding Service
 * =================
 * Generates vector embeddings using Google's text-embedding-004 model
 * (768 dimensions) via the Gemini API. Embeddings are stored in the
 * document_embeddings table and used for semantic search (RAG).
 *
 * Embedding is triggered automatically when a transcription reaches
 * "reviewed" or "flagged" status.
 */

import { ENV } from "./_core/env";
import {
  createEmbedding,
  deleteEmbeddingsByDocumentId,
  searchEmbeddings,
} from "./db";

const EMBEDDING_MODEL = "gemini-embedding-2-preview";
const EMBEDDING_DIMENSIONS = 3072;

/**
 * Call Google AI Embedding API to get a vector for a text string.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = ENV.googleAiApiKey;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is not configured — cannot generate embeddings.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text }],
      },
      taskType: "RETRIEVAL_DOCUMENT",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} — ${errorText}`);
  }

  const data = await response.json() as {
    embedding: { values: number[] };
  };

  return data.embedding.values;
}

/**
 * Get an embedding for a query string (uses RETRIEVAL_QUERY task type).
 */
export async function getQueryEmbedding(text: string): Promise<number[]> {
  const apiKey = ENV.googleAiApiKey;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is not configured — cannot generate embeddings.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text }],
      },
      taskType: "RETRIEVAL_QUERY",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} — ${errorText}`);
  }

  const data = await response.json() as {
    embedding: { values: number[] };
  };

  return data.embedding.values;
}

/**
 * Build the text content to embed from a transcription's reviewed JSON.
 * Concatenates all string/array fields into a single searchable string.
 */
export function buildEmbeddingContent(
  reviewedJson: Record<string, unknown>,
  filename: string
): string {
  const parts: string[] = [`Document: ${filename}`];

  for (const [key, value] of Object.entries(reviewedJson)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim()) {
      parts.push(`${key}: ${value.trim()}`);
    } else if (Array.isArray(value) && value.length > 0) {
      parts.push(`${key}: ${value.join(", ")}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}: ${value}`);
    }
  }

  return parts.join("\n");
}

/**
 * Generate and store an embedding for a reviewed transcription.
 * Replaces any existing embedding for this document.
 *
 * Called after saveReview sets status to "reviewed" or "flagged".
 */
export async function embedTranscription(params: {
  projectId: number;
  documentId: number;
  transcriptionId: number;
  reviewedJson: Record<string, unknown>;
  filename: string;
}): Promise<void> {
  const { projectId, documentId, transcriptionId, reviewedJson, filename } = params;

  // Build the text to embed
  const content = buildEmbeddingContent(reviewedJson, filename);
  if (!content.trim()) return;

  // Generate the embedding vector
  const embedding = await getEmbedding(content);

  // Delete any existing embedding for this document (re-review scenario)
  await deleteEmbeddingsByDocumentId(documentId);

  // Store the new embedding
  await createEmbedding({
    projectId,
    documentId,
    transcriptionId,
    content,
    metadata: { filename },
    embedding,
  });
}

/**
 * Perform semantic search across a project's reviewed transcriptions.
 * Returns the top-k most similar documents with similarity scores.
 */
export async function semanticSearch(
  projectId: number,
  query: string,
  limit = 5
) {
  const queryEmbedding = await getQueryEmbedding(query);
  return searchEmbeddings(projectId, queryEmbedding, query, limit);
}
