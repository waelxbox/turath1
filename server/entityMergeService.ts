/**
 * Entity Merge Service
 * ====================
 * Handles fuzzy clustering of duplicate entities and LLM-powered merge suggestions.
 * 
 * Pipeline:
 * 1. Load all entities for a project
 * 2. Group by type (person/location/organization)
 * 3. Within each type, compute fuzzy similarity clusters using:
 *    - Normalized Levenshtein distance
 *    - Cross-script matching (Arabic ↔ Latin transliteration patterns)
 *    - Common prefix/suffix detection
 * 4. For each cluster with 2+ members, ask the LLM to confirm and suggest a canonical name
 * 5. Store as merge_suggestions for human review
 */

import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { entities, mergeSuggestions, documentEntities, entityAliases } from "../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Yield the event loop so other requests (like OAuth) can be processed */
function yieldEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface EntityRow {
  id: number;
  name: string;
  type: "person" | "location" | "organization";
  normalizedName: string | null;
  canonicalId: number | null;
}

interface MergeCluster {
  entityIds: number[];
  names: string[];
  type: string;
  suggestedCanonical: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

// ─── Fuzzy Matching Utilities ────────────────────────────────────────────────

/**
 * Compute normalized Levenshtein distance between two strings (0 = identical, 1 = completely different)
 */
function levenshteinDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const matrix: number[][] = Array(la + 1).fill(null).map(() => Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) matrix[i][0] = i;
  for (let j = 0; j <= lb; j++) matrix[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[la][lb] / Math.max(la, lb);
}

/**
 * Normalize a string for comparison: lowercase, strip diacritics, collapse whitespace,
 * remove common prefixes/suffixes, normalize Arabic.
 */
function normalizeForComparison(name: string): string {
  return name
    .trim()
    .toLowerCase()
    // Remove Arabic diacritics
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]/g, "")
    // Normalize Arabic letter variants
    .replace(/[\u0622\u0623\u0625]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    // Remove French diacritics
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // Remove common titles/prefixes
    .replace(/^(mr\.?|mrs\.?|dr\.?|prof\.?|bey|pasha|effendi|khawaja|el-?khawaja|الخواجه?)\s*/i, "")
    // Remove common suffixes
    .replace(/\s*(bey|pasha|effendi|باشا|بك|افندي)$/i, "")
    // Collapse whitespace and punctuation
    .replace(/[.\-_,;:'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a string is primarily Arabic script
 */
function isArabic(text: string): boolean {
  const arabicChars = text.match(/[\u0600-\u06FF]/g);
  return (arabicChars?.length || 0) > text.length * 0.3;
}

/**
 * Compute similarity between two entity names (0 = no match, 1 = identical)
 * Uses multiple signals: Levenshtein, prefix matching, and script detection.
 */
function computeSimilarity(a: string, b: string): number {
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  // Exact match after normalization
  if (normA === normB) return 1.0;

  // If one is empty after normalization, low similarity
  if (!normA || !normB) return 0.0;

  // Both same script — use Levenshtein
  const aIsArabic = isArabic(a);
  const bIsArabic = isArabic(b);

  if (aIsArabic === bIsArabic) {
    const dist = levenshteinDistance(normA, normB);
    return 1 - dist;
  }

  // Cross-script: can't directly compare, return 0 (LLM will handle these)
  return 0;
}

// ─── Clustering ──────────────────────────────────────────────────────────────

/**
 * Group entities into clusters based on fuzzy similarity.
 * Uses a simple greedy approach: for each entity, find all entities within threshold.
 */
async function clusterEntities(entityList: EntityRow[], threshold = 0.65): Promise<EntityRow[][]> {
  const clusters: EntityRow[][] = [];
  const assigned = new Set<number>();

  // Sort by name for deterministic results
  const sorted = [...entityList].sort((a, b) => a.name.localeCompare(b.name));

  for (let i = 0; i < sorted.length; i++) {
    const entity = sorted[i];
    if (assigned.has(entity.id)) continue;

    const cluster: EntityRow[] = [entity];
    assigned.add(entity.id);

    for (const other of sorted) {
      if (assigned.has(other.id)) continue;
      if (other.type !== entity.type) continue;

      const sim = computeSimilarity(entity.name, other.name);
      if (sim >= threshold) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }

    // Yield every 20 entities to let other requests through
    if (i % 20 === 0) await yieldEventLoop();
  }

  return clusters;
}

/**
 * Group entities that share the same type for cross-script matching via LLM.
 * Finds Arabic entities that might match Latin entities within the same type.
 */
function findCrossScriptCandidates(entityList: EntityRow[]): EntityRow[][] {
  const arabicEntities = entityList.filter(e => isArabic(e.name));
  const latinEntities = entityList.filter(e => !isArabic(e.name));

  // Group by type
  const byType = new Map<string, { arabic: EntityRow[]; latin: EntityRow[] }>();
  for (const e of arabicEntities) {
    const group = byType.get(e.type) || { arabic: [], latin: [] };
    group.arabic.push(e);
    byType.set(e.type, group);
  }
  for (const e of latinEntities) {
    const group = byType.get(e.type) || { arabic: [], latin: [] };
    group.latin.push(e);
    byType.set(e.type, group);
  }

  return Array.from(byType.values())
    .filter(g => g.arabic.length > 0 && g.latin.length > 0)
    .map(g => [...g.arabic, ...g.latin]);
}

// ─── LLM-powered merge suggestion ───────────────────────────────────────────

/**
 * Ask the LLM to confirm a cluster and suggest a canonical name.
 * Processes clusters in batches for efficiency.
 */
async function confirmClustersWithLLM(
  clusters: EntityRow[][],
  entityType: string,
): Promise<MergeCluster[]> {
  if (clusters.length === 0) return [];

  // Process in batches of up to 5 clusters per LLM call (smaller to avoid timeouts)
  const batchSize = 5;
  const results: MergeCluster[] = [];

  for (let i = 0; i < clusters.length; i += batchSize) {
    const batch = clusters.slice(i, i + batchSize);
    const clusterDescriptions = batch.map((cluster, idx) => {
      const names = cluster.map(e => `"${e.name}"`).join(", ");
      return `Cluster ${idx + 1}: [${names}]`;
    }).join("\n");

    // Retry up to 2 times on failure
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert in historical Middle Eastern archival documents, specifically Egyptian business correspondence from the early 20th century. You understand French, Arabic, and English naming conventions and transliteration systems.

Your task: For each cluster of entity names (type: ${entityType}), determine if they refer to the SAME real-world entity. If yes, suggest the best canonical English name.

Rules:
- Consider spelling variants, transliteration differences, OCR errors, and language translations
- "Bachir Labat" / "Béchir Labab" / "بشير لبّط" are likely the same person
- "ALEXANDRIE" / "Alexandria" / "الاسكندرية" are the same place
- "Fabrique de Tabacs Melassés" / "Melaxas Tobacco Factory" are the same organization
- Be CONSERVATIVE: if you're not sure, say "no_match"
- For the canonical name, use the most complete English form
- Abbreviations like "B.O." might match "Banque Ottomane" but only if contextually likely`,
          },
          {
            role: "user",
            content: `Analyze these clusters of ${entityType} names and determine which are duplicates:\n\n${clusterDescriptions}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "merge_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                clusters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      cluster_index: { type: "integer", description: "1-based index of the cluster" },
                      is_same_entity: { type: "boolean", description: "Whether all names refer to the same entity" },
                      canonical_name: { type: "string", description: "Suggested canonical English name (empty if not same entity)" },
                      confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level" },
                      reasoning: { type: "string", description: "Brief explanation" },
                    },
                    required: ["cluster_index", "is_same_entity", "canonical_name", "confidence", "reasoning"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["clusters"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) continue;

      const parsed = JSON.parse(content as string) as {
        clusters: Array<{
          cluster_index: number;
          is_same_entity: boolean;
          canonical_name: string;
          confidence: "high" | "medium" | "low";
          reasoning: string;
        }>;
      };

      for (const result of parsed.clusters) {
        if (!result.is_same_entity) continue;
        const clusterIdx = result.cluster_index - 1;
        if (clusterIdx < 0 || clusterIdx >= batch.length) continue;

        const cluster = batch[clusterIdx];
        results.push({
          entityIds: cluster.map(e => e.id),
          names: cluster.map(e => e.name),
          type: entityType,
          suggestedCanonical: result.canonical_name || cluster[0].name,
          confidence: result.confidence,
          reasoning: result.reasoning,
        });
      }
    } catch (err) {
      console.error(`[EntityMerge] LLM cluster confirmation failed (attempt ${attempt + 1}):`, err);
      if (attempt < 1) {
        // Wait 2 seconds before retry
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
    }
    break; // Success, exit retry loop
    }
  }

  return results;
}

/**
 * Ask the LLM to find cross-script matches between Arabic and Latin entity names.
 */
async function findCrossScriptMatches(
  arabicEntities: EntityRow[],
  latinEntities: EntityRow[],
  entityType: string,
): Promise<MergeCluster[]> {
  if (arabicEntities.length === 0 || latinEntities.length === 0) return [];

  // Limit to avoid huge prompts — take up to 30 of each to prevent timeouts
  const arabicSlice = arabicEntities.slice(0, 30);
  const latinSlice = latinEntities.slice(0, 30);

  const arabicList = arabicSlice.map(e => `[id:${e.id}] "${e.name}"`).join("\n");
  const latinList = latinSlice.map(e => `[id:${e.id}] "${e.name}"`).join("\n");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an expert in Arabic-French-English transliteration for Egyptian historical documents. Your task is to match Arabic entity names with their Latin-script equivalents.

Rules:
- Match based on phonetic equivalence (e.g., "رشيد بهنا" = "Rachid Behna")
- Consider French transliteration conventions used in Egypt (e.g., "ch" for "ش", "ou" for "و")
- Be CONSERVATIVE: only match if you are fairly confident they are the same entity
- Each Arabic name can match at most one Latin name (pick the best match)
- Not every name will have a match — that's fine`,
        },
        {
          role: "user",
          content: `Find matching pairs between these Arabic ${entityType} names and Latin-script ${entityType} names:\n\nArabic names:\n${arabicList}\n\nLatin names:\n${latinList}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cross_script_matches",
          strict: true,
          schema: {
            type: "object",
            properties: {
              matches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    arabic_id: { type: "integer", description: "ID of the Arabic entity" },
                    latin_id: { type: "integer", description: "ID of the Latin-script entity" },
                    canonical_name: { type: "string", description: "Suggested canonical English name" },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    reasoning: { type: "string", description: "Brief explanation of the match" },
                  },
                  required: ["arabic_id", "latin_id", "canonical_name", "confidence", "reasoning"],
                  additionalProperties: false,
                },
              },
            },
            required: ["matches"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content as string) as {
      matches: Array<{
        arabic_id: number;
        latin_id: number;
        canonical_name: string;
        confidence: "high" | "medium" | "low";
        reasoning: string;
      }>;
    };

    const results: MergeCluster[] = [];
    const arabicIds = new Set(arabicSlice.map(e => e.id));
    const latinIds = new Set(latinSlice.map(e => e.id));

    for (const match of parsed.matches) {
      // Validate IDs exist in our input
      if (!arabicIds.has(match.arabic_id) || !latinIds.has(match.latin_id)) continue;

      results.push({
        entityIds: [match.arabic_id, match.latin_id],
        names: [
          arabicSlice.find(e => e.id === match.arabic_id)!.name,
          latinSlice.find(e => e.id === match.latin_id)!.name,
        ],
        type: entityType,
        suggestedCanonical: match.canonical_name,
        confidence: match.confidence,
        reasoning: match.reasoning,
      });
    }

    return results;
  } catch (err) {
    console.error("[EntityMerge] Cross-script matching failed:", err);
    return [];
  }
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Progress callback type for real-time updates during merge generation.
 */
export type MergeProgressCallback = (update: {
  phase: string;
  completed: number;
  total: number;
  suggestionsCreated: number;
}) => Promise<void> | void;

/**
 * Helper to insert a single merge cluster as a suggestion immediately.
 */
async function insertSuggestion(
  db: any,
  projectId: number,
  cluster: MergeCluster,
  existingEntityIds: Set<number>,
): Promise<boolean> {
  if (cluster.entityIds.length < 2) return false;

  // Deduplicate: skip if all entities already covered
  const newIds = cluster.entityIds.filter(id => !existingEntityIds.has(id));
  if (newIds.length === 0) return false;

  // Mark all entity IDs as used
  for (const id of cluster.entityIds) {
    existingEntityIds.add(id);
  }

  await db.insert(mergeSuggestions).values({
    projectId,
    status: "pending",
    suggestedCanonical: cluster.suggestedCanonical,
    confidence: cluster.confidence,
    entityIds: cluster.entityIds,
    reasoning: cluster.reasoning,
  });
  return true;
}

/**
 * Generate merge suggestions for a project.
 * Inserts suggestions incrementally so the UI can show them as they arrive.
 * Accepts an optional progress callback for real-time job updates.
 */
export async function generateMergeSuggestions(
  projectId: number,
  onProgress?: MergeProgressCallback,
): Promise<{
  clustersFound: number;
  suggestionsCreated: number;
}> {
  const db = (await getDb())!;

  // Load all canonical entities (those without a canonicalId, i.e., not already merged)
  const allEntities = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      normalizedName: entities.normalizedName,
      canonicalId: entities.canonicalId,
    })
    .from(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        sql`${entities.canonicalId} IS NULL`,
      ),
    );

  if (allEntities.length < 2) {
    return { clustersFound: 0, suggestionsCreated: 0 };
  }

  // NOTE: We do NOT delete existing pending suggestions upfront.
  // New suggestions are additive. Only clear old ones after the job completes successfully.
  // This prevents data loss if the job times out mid-way.

  // Track which entity IDs have already been assigned to a suggestion
  const usedEntityIds = new Set<number>();
  let suggestionsCreated = 0;
  let clustersFound = 0;

  // Calculate total steps for progress
  const entityTypes = ["person", "location", "organization"] as const;
  const typeCounts = entityTypes.map(type => {
    const typeEntities = allEntities.filter(e => e.type === type);
    return { type, count: typeEntities.length };
  }).filter(t => t.count >= 2);
  const totalSteps = typeCounts.length * 2; // fuzzy + cross-script per type
  let completedSteps = 0;

  // Process each type and insert suggestions incrementally
  for (const type of entityTypes) {
    const typeEntities = allEntities.filter(e => e.type === type) as EntityRow[];
    if (typeEntities.length < 2) continue;

    // Same-script fuzzy clusters
    const fuzzyClusters = await clusterEntities(typeEntities, 0.65);
    if (fuzzyClusters.length > 0) {
      const confirmed = await confirmClustersWithLLM(fuzzyClusters, type);
      for (const cluster of confirmed) {
        const inserted = await insertSuggestion(db, projectId, cluster, usedEntityIds);
        if (inserted) suggestionsCreated++;
        clustersFound++;
      }
    }
    completedSteps++;
    if (onProgress) {
      await onProgress({ phase: `${type} (fuzzy)`, completed: completedSteps, total: totalSteps, suggestionsCreated });
    }

    // Cross-script matching
    const arabicEnts = typeEntities.filter(e => isArabic(e.name));
    const latinEnts = typeEntities.filter(e => !isArabic(e.name));
    if (arabicEnts.length > 0 && latinEnts.length > 0) {
      const crossMatches = await findCrossScriptMatches(arabicEnts, latinEnts, type);
      for (const cluster of crossMatches) {
        const inserted = await insertSuggestion(db, projectId, cluster, usedEntityIds);
        if (inserted) suggestionsCreated++;
        clustersFound++;
      }
    }
    completedSteps++;
    if (onProgress) {
      await onProgress({ phase: `${type} (cross-script)`, completed: completedSteps, total: totalSteps, suggestionsCreated });
    }
  }

  return { clustersFound, suggestionsCreated };
}

// ─── Chunked Step Processing ────────────────────────────────────────────────

/**
 * Process a single step of the merge pipeline.
 * Each step is small enough to complete within Cloud Run's 180s timeout.
 * Steps: "person_fuzzy", "person_cross", "location_fuzzy", "location_cross",
 *        "organization_fuzzy", "organization_cross"
 */
export async function processMergeStep(
  projectId: number,
  step: string,
): Promise<{ suggestionsCreated: number; clustersFound: number }> {
  const db = (await getDb())!;

  // Load all canonical entities
  const allEntities = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      normalizedName: entities.normalizedName,
      canonicalId: entities.canonicalId,
    })
    .from(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        sql`${entities.canonicalId} IS NULL`,
      ),
    );

  // Load existing suggestion entity IDs to avoid duplicates
  const existingSuggestions = await db
    .select({ entityIds: mergeSuggestions.entityIds })
    .from(mergeSuggestions)
    .where(
      and(
        eq(mergeSuggestions.projectId, projectId),
        eq(mergeSuggestions.status, "pending"),
      ),
    );
  const usedEntityIds = new Set<number>();
  for (const s of existingSuggestions) {
    for (const id of (s.entityIds as number[])) {
      usedEntityIds.add(id);
    }
  }

  const [entityType, method] = step.split("_") as ["person" | "location" | "organization", "fuzzy" | "cross"];
  const typeEntities = allEntities.filter(e => e.type === entityType) as EntityRow[];

  if (typeEntities.length < 2) {
    return { suggestionsCreated: 0, clustersFound: 0 };
  }

  let suggestionsCreated = 0;
  let clustersFound = 0;

  if (method === "fuzzy") {
    const fuzzyClusters = await clusterEntities(typeEntities, 0.65);
    if (fuzzyClusters.length > 0) {
      const confirmed = await confirmClustersWithLLM(fuzzyClusters, entityType);
      for (const cluster of confirmed) {
        const inserted = await insertSuggestion(db, projectId, cluster, usedEntityIds);
        if (inserted) suggestionsCreated++;
        clustersFound++;
      }
    }
  } else if (method === "cross") {
    const arabicEnts = typeEntities.filter(e => isArabic(e.name));
    const latinEnts = typeEntities.filter(e => !isArabic(e.name));
    if (arabicEnts.length > 0 && latinEnts.length > 0) {
      const crossMatches = await findCrossScriptMatches(arabicEnts, latinEnts, entityType);
      for (const cluster of crossMatches) {
        const inserted = await insertSuggestion(db, projectId, cluster, usedEntityIds);
        if (inserted) suggestionsCreated++;
        clustersFound++;
      }
    }
  }

  return { suggestionsCreated, clustersFound };
}

// ─── Merge Execution ─────────────────────────────────────────────────────────

/**
 * Execute a merge: pick one canonical entity, reassign all document links,
 * store others as aliases, set canonicalId.
 */
export async function executeMerge(
  suggestionId: number,
  canonicalName: string,
  entityIds: number[],
): Promise<void> {
  const db = (await getDb())!;

  if (entityIds.length < 2) return;

  // Pick the first entity as canonical (or create logic to pick best one)
  const canonicalEntityId = entityIds[0];
  const otherIds = entityIds.slice(1);

  // Update canonical entity name
  await db
    .update(entities)
    .set({ name: canonicalName })
    .where(eq(entities.id, canonicalEntityId));

  // For each non-canonical entity:
  for (const otherId of otherIds) {
    // Get the entity's current name for alias storage
    const [otherEntity] = await db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, otherId));

    if (otherEntity) {
      // Store as alias of the canonical entity
      await db.insert(entityAliases).values({
        entityId: canonicalEntityId,
        alias: otherEntity.name,
        normalizedAlias: normalizeForComparison(otherEntity.name),
        language: isArabic(otherEntity.name) ? "ar" : "other",
      });
    }

    // Reassign all document_entities links from other → canonical
    await db
      .update(documentEntities)
      .set({ entityId: canonicalEntityId })
      .where(eq(documentEntities.entityId, otherId));

    // Mark the other entity as merged (set canonicalId)
    await db
      .update(entities)
      .set({ canonicalId: canonicalEntityId })
      .where(eq(entities.id, otherId));
  }

  // Mark the suggestion as accepted
  await db
    .update(mergeSuggestions)
    .set({ status: "accepted", reviewedAt: new Date() })
    .where(eq(mergeSuggestions.id, suggestionId));
}

/**
 * Reject a merge suggestion (mark entities as definitely different).
 */
export async function rejectMerge(suggestionId: number): Promise<void> {
  const db = (await getDb())!;
  await db
    .update(mergeSuggestions)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(eq(mergeSuggestions.id, suggestionId));
}

/**
 * Skip a merge suggestion (come back later).
 */
export async function skipMerge(suggestionId: number): Promise<void> {
  const db = (await getDb())!;
  await db
    .update(mergeSuggestions)
    .set({ status: "skipped", reviewedAt: new Date() })
    .where(eq(mergeSuggestions.id, suggestionId));
}

/**
 * Manual merge — user-initiated merge without a pre-existing suggestion.
 * Creates a suggestion record for audit trail, then executes the merge.
 */
export async function manualMerge(
  projectId: number,
  canonicalName: string,
  entityIds: number[],
): Promise<void> {
  const db = (await getDb())!;

  if (entityIds.length < 2) return;

  // Create an audit-trail suggestion record
  const [suggestion] = await db.insert(mergeSuggestions).values({
    projectId,
    entityIds,
    suggestedCanonical: canonicalName,
    confidence: "high",
    reasoning: "Manual merge by user",
    status: "accepted",
    reviewedAt: new Date(),
  }).returning();

  // Pick the first entity as canonical
  const canonicalEntityId = entityIds[0];
  const otherIds = entityIds.slice(1);

  // Update canonical entity name
  await db
    .update(entities)
    .set({ name: canonicalName })
    .where(eq(entities.id, canonicalEntityId));

  // For each non-canonical entity:
  for (const otherId of otherIds) {
    const [otherEntity] = await db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, otherId));

    if (otherEntity) {
      // Store as alias of the canonical entity
      await db.insert(entityAliases).values({
        entityId: canonicalEntityId,
        alias: otherEntity.name,
        normalizedAlias: normalizeForComparison(otherEntity.name),
        language: isArabic(otherEntity.name) ? "ar" : "other",
      });
    }

    // Reassign all document_entities links from other → canonical
    await db
      .update(documentEntities)
      .set({ entityId: canonicalEntityId })
      .where(eq(documentEntities.entityId, otherId));

    // Mark the other entity as merged (set canonicalId)
    await db
      .update(entities)
      .set({ canonicalId: canonicalEntityId })
      .where(eq(entities.id, otherId));
  }
}
