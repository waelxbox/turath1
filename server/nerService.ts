/**
 * NER Service — Named Entity Recognition via Gemini
 *
 * Extracts People, Locations, and Organizations from reviewed transcription text.
 * Uses structured JSON output from Gemini with a strict schema.
 * Entities are deduplicated per project by normalizedName + type.
 */

import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { entities, documentEntities, entityAliases, documents } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExtractedEntity {
  name: string;
  type: "person" | "location" | "organization";
  context: string; // sentence or phrase where entity was found
}

interface NERResult {
  entities: ExtractedEntity[];
}

// ─── Normalize entity name for dedup ────────────────────────────────────────

function normalizeEntityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    // Remove Arabic diacritics (tashkeel)
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]/g, "")
    // Normalize common Arabic letter variants
    .replace(/[\u0622\u0623\u0625]/g, "\u0627") // alef variants → alef
    .replace(/\u0629/g, "\u0647") // taa marbuta → haa
    .replace(/\u0649/g, "\u064A") // alef maqsura → yaa
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Extract entities from text via Gemini ──────────────────────────────────

export async function extractEntities(text: string): Promise<ExtractedEntity[]> {
  if (!text || text.trim().length < 10) return [];

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a Named Entity Recognition (NER) specialist for Arabic historical and archival documents. Extract all named entities from the provided text.

Rules:
- Extract PEOPLE (individuals mentioned by name), LOCATIONS (places, cities, regions, countries), and ORGANIZATIONS (institutions, companies, government bodies, departments).
- For each entity, provide the exact name as it appears in the text, the type, and a short context snippet (the sentence or phrase where it appears).
- Include entities in any language (Arabic, English, French, Ottoman Turkish, etc.).
- Do NOT extract generic terms (e.g., "the government" without a specific name).
- Do NOT extract dates, numbers, or abstract concepts.
- If no entities are found, return an empty array.
- Deduplicate: if the same entity appears multiple times, include it only once with the most informative context.`,
        },
        {
          role: "user",
          content: `Extract all named entities from this archival document text:\n\n${text}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ner_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "The entity name as it appears in the text" },
                    type: { type: "string", enum: ["person", "location", "organization"], description: "Entity type" },
                    context: { type: "string", description: "Short snippet of text where the entity appears" },
                  },
                  required: ["name", "type", "context"],
                  additionalProperties: false,
                },
              },
            },
            required: ["entities"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed: NERResult = JSON.parse(content as string);
    return parsed.entities || [];
  } catch (err) {
    console.error("[NER] Entity extraction failed:", err);
    return [];
  }
}

// ─── Upsert entity (dedup by project + normalizedName + type + alias matching) ─

async function upsertEntity(
  projectId: number,
  name: string,
  type: "person" | "location" | "organization",
): Promise<number> {
  const db = (await getDb())!;
  const normalized = normalizeEntityName(name);

  // 1. Check exact normalizedName match (existing behavior)
  const existing = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        eq(entities.normalizedName, normalized),
        eq(entities.type, type),
        sql`${entities.canonicalId} IS NULL`,  // only match canonical entities
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // 2. Check if this matches any existing alias
  const aliasMatch = await db
    .select({ entityId: entityAliases.entityId })
    .from(entityAliases)
    .innerJoin(entities, eq(entities.id, entityAliases.entityId))
    .where(
      and(
        eq(entities.projectId, projectId),
        eq(entities.type, type),
        eq(entityAliases.normalizedAlias, normalized),
      ),
    )
    .limit(1);

  if (aliasMatch.length > 0) {
    return aliasMatch[0].entityId;
  }

  // 3. Check merged entities (those with canonicalId set) — if the new name matches
  //    a merged entity's normalizedName, redirect to its canonical
  const mergedMatch = await db
    .select({ canonicalId: entities.canonicalId })
    .from(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        eq(entities.normalizedName, normalized),
        eq(entities.type, type),
        sql`${entities.canonicalId} IS NOT NULL`,
      ),
    )
    .limit(1);

  if (mergedMatch.length > 0 && mergedMatch[0].canonicalId) {
    return mergedMatch[0].canonicalId;
  }

  // 4. No match found — insert new entity
  const [inserted] = await db
    .insert(entities)
    .values({
      projectId,
      name,
      type,
      normalizedName: normalized,
    })
    .returning({ id: entities.id });

  return inserted.id;
}

// ─── Link entity to document ────────────────────────────────────────────────

async function linkDocumentEntity(
  documentId: number,
  entityId: number,
  projectId: number,
  contextSnippet: string | null,
): Promise<void> {
  const db = (await getDb())!;
  const [document] = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.projectId, projectId),
  )).limit(1);
  const [entity] = await db.select({ id: entities.id }).from(entities).where(and(
    eq(entities.id, entityId),
    eq(entities.projectId, projectId),
  )).limit(1);
  if (!document || !entity) throw new Error("Document and entity must belong to the same project");
  // Check if link already exists
  const existing = await db
    .select({ id: documentEntities.id })
    .from(documentEntities)
    .where(
      and(
        eq(documentEntities.documentId, documentId),
        eq(documentEntities.entityId, entityId),
        eq(documentEntities.projectId, projectId),
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(documentEntities).values({
    documentId,
    entityId,
    projectId,
    contextSnippet,
  });
}

// ─── Reconcile: validate existing entities against updated text, remove stale ones ─

export async function reconcileDocumentEntities(
  projectId: number,
  documentId: number,
  text: string,
): Promise<{ removed: number; added: number }> {
  const db = (await getDb())!;
  const [projectDocument] = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.projectId, projectId),
  )).limit(1);
  if (!projectDocument) throw new Error("Document not found in project");

  // Get current linked entities for this document
  const currentLinks = await db
    .select({
      linkId: documentEntities.id,
      entityId: documentEntities.entityId,
      entityName: entities.name,
      entityType: entities.type,
    })
    .from(documentEntities)
    .innerJoin(entities, eq(entities.id, documentEntities.entityId))
    .where(and(
      eq(documentEntities.documentId, documentId),
      eq(documentEntities.projectId, projectId),
      eq(entities.projectId, projectId),
    ));

  if (currentLinks.length === 0) {
    // No existing entities — just do a fresh extraction
    const result = await extractAndStoreEntities(projectId, documentId, text);
    return { removed: 0, added: result.entityCount };
  }

  // Check which entities are still mentioned in the text
  const normalizedText = text.toLowerCase();
  const staleLinks: number[] = [];

  for (const link of currentLinks) {
    const entityNameLower = link.entityName.toLowerCase();
    // Entity is stale if its name doesn't appear anywhere in the text
    if (!normalizedText.includes(entityNameLower)) {
      // Also check normalized version (without diacritics etc)
      const normalizedEntityName = normalizeEntityName(link.entityName);
      if (!normalizedText.includes(normalizedEntityName)) {
        staleLinks.push(link.linkId);
      }
    }
  }

  // Remove stale links
  let removed = 0;
  for (const linkId of staleLinks) {
    await db.delete(documentEntities).where(and(
      eq(documentEntities.id, linkId),
      eq(documentEntities.projectId, projectId),
    ));
    removed++;
  }

  if (removed > 0) {
    console.log(`[NER-Reconcile] Removed ${removed} stale entity links for document ${documentId}`);
  }

  // Re-extract to find any new entities in the updated text
  const freshExtracted = await extractEntities(text);
  let added = 0;
  for (const entity of freshExtracted) {
    try {
      const entityId = await upsertEntity(projectId, entity.name, entity.type);
      // linkDocumentEntity already skips duplicates
      const existing = await db
        .select({ id: documentEntities.id })
        .from(documentEntities)
        .where(
          and(
            eq(documentEntities.documentId, documentId),
            eq(documentEntities.entityId, entityId),
            eq(documentEntities.projectId, projectId),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(documentEntities).values({
          documentId,
          entityId,
          projectId,
          contextSnippet: entity.context || null,
        });
        added++;
      }
    } catch (err) {
      console.error(`[NER-Reconcile] Failed to store entity "${entity.name}":`, err);
    }
  }

  if (added > 0) {
    console.log(`[NER-Reconcile] Added ${added} new entity links for document ${documentId}`);
  }

  return { removed, added };
}

// ─── Main: extract and store entities for a reviewed document ───────────────

export async function extractAndStoreEntities(
  projectId: number,
  documentId: number,
  text: string,
): Promise<{ entityCount: number }> {
  const db = (await getDb())!;
  const [projectDocument] = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.projectId, projectId),
  )).limit(1);
  if (!projectDocument) throw new Error("Document not found in project");

  const extracted = await extractEntities(text);

  if (extracted.length === 0) {
    console.log(`[NER] No entities found for document ${documentId}`);
    return { entityCount: 0 };
  }

  let stored = 0;
  for (const entity of extracted) {
    try {
      const entityId = await upsertEntity(projectId, entity.name, entity.type);
      await linkDocumentEntity(documentId, entityId, projectId, entity.context || null);
      stored++;
    } catch (err) {
      console.error(`[NER] Failed to store entity "${entity.name}":`, err);
    }
  }

  console.log(`[NER] Stored ${stored} entities for document ${documentId}`);
  return { entityCount: stored };
}
