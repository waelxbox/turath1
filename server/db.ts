import { and, eq, desc, sql, count, or, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  users, InsertUser,
  projects, InsertProject, Project,
  onboardingSamples, InsertOnboardingSample,
  documents, InsertDocument, Document,
  transcriptions, InsertTranscription,
  jobs, InsertJob,
  documentEmbeddings, InsertDocumentEmbedding,
  entities, Entity,
  documentEntities, DocumentEntity,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ─── Database Connection ──────────────────────────────────────────────────────

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export async function getDb() {
  if (!_db) {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      console.warn("[Database] SUPABASE_DATABASE_URL not set");
      return null;
    }
    try {
      const isPgBouncer = url.includes("pgbouncer=true");
      _client = postgres(url, {
        max: isPgBouncer ? 10 : 5,
        prepare: !isPgBouncer,
        connect_timeout: 15,
      });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const v = user[field];
    if (v !== undefined) { values[field] = v ?? null; updateSet[field] = v ?? null; }
  }
  if (user.lastSignedIn) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onConflictDoUpdate({
    target: users.openId,
    set: updateSet,
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function getProjectsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
}

export async function getProjectById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return result[0];
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projects).values(data).returning();
  return result[0];
}

export async function updateProject(id: number, userId: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function deleteProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function getProjectStats(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return { total: 0, reviewed: 0, flagged: 0, needsReview: 0, processing: 0, pending: 0, errors: 0 };
  const project = await getProjectById(projectId, userId);
  if (!project) throw new Error("Project not found");
  const statusCounts = await db
    .select({ status: documents.status, count: count() })
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .groupBy(documents.status);
  const total = statusCounts.reduce((sum, r) => sum + Number(r.count), 0);
  const get = (s: string) => Number(statusCounts.find(r => r.status === s)?.count ?? 0);
  return {
    total,
    reviewed: get("reviewed"),
    flagged: get("flagged"),
    needsReview: get("needs_review"),
    processing: get("processing"),
    pending: get("pending"),
    errors: get("error"),
  };
}

// ─── Onboarding Samples ───────────────────────────────────────────────────────

export async function createOnboardingSample(data: InsertOnboardingSample) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(onboardingSamples).values(data).returning();
  return result[0];
}

export async function getSamplesByProjectId(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(onboardingSamples)
    .where(eq(onboardingSamples.projectId, projectId))
    .orderBy(onboardingSamples.createdAt);
}

export async function updateSampleAiOutput(id: number, aiOutput: unknown, validationScore: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(onboardingSamples).set({ aiOutput, validationScore }).where(eq(onboardingSamples.id, id));
}

// ─── Documents ────────────────────────────────────────────────────────────────

export async function createDocument(data: InsertDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(documents).values(data).returning();
  return result[0];
}

export async function getDocumentsByProjectId(projectId: number, status?: Document["status"]) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(documents.projectId, projectId)];
  if (status) conditions.push(eq(documents.status, status));
  return db.select().from(documents).where(and(...conditions)).orderBy(desc(documents.uploadedAt));
}

export async function getDocumentById(id: number, projectId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documents)
    .where(and(eq(documents.id, id), eq(documents.projectId, projectId)))
    .limit(1);
  return result[0];
}

export async function updateDocumentStatus(id: number, status: Document["status"], errorMessage?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const update: Partial<InsertDocument> = { status };
  if (["needs_review", "reviewed", "error"].includes(status)) update.processedAt = new Date();
  if (errorMessage !== undefined) update.errorMessage = errorMessage;
  await db.update(documents).set(update).where(eq(documents.id, id));
}

// ─── Transcriptions ───────────────────────────────────────────────────────────

export async function createTranscription(data: InsertTranscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(transcriptions).values(data).returning();
  return result[0];
}

export async function getTranscriptionByDocumentId(documentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(transcriptions)
    .where(eq(transcriptions.documentId, documentId))
    .orderBy(desc(transcriptions.createdAt))
    .limit(1);
  return result[0];
}

export async function updateReviewedJson(id: number, reviewedJson: unknown) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(transcriptions)
    .set({ reviewedJson, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(transcriptions.id, id));
}

export async function getReviewedTranscriptions(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    transcription: transcriptions,
    document: documents,
  }).from(transcriptions)
    .innerJoin(documents, eq(transcriptions.documentId, documents.id))
    .where(and(
      eq(transcriptions.projectId, projectId),
      sql`${documents.status} IN ('reviewed', 'flagged')`
    ))
    .orderBy(desc(transcriptions.reviewedAt));
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export async function createJob(data: InsertJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(jobs).values(data).returning();
  return result[0];
}

export async function getJobsByProjectId(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(jobs)
    .where(eq(jobs.projectId, projectId))
    .orderBy(desc(jobs.createdAt))
    .limit(20);
}

export async function updateJob(id: number, data: Partial<InsertJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(jobs).set(data).where(eq(jobs.id, id));
}

// ─── Document Embeddings (pgvector) ──────────────────────────────────────────

export async function createEmbedding(data: InsertDocumentEmbedding) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(documentEmbeddings).values(data).returning();
  // Populate tsvector for full-text search
  if (result[0]?.id) {
    await db.execute(
      sql`UPDATE document_embeddings SET content_tsv = to_tsvector('simple', ${data.content}) WHERE id = ${result[0].id}`
    );
  }
  return result[0];
}

export async function deleteEmbeddingsByDocumentId(documentId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(documentEmbeddings).where(eq(documentEmbeddings.documentId, documentId));
}

/**
 * Hybrid search: combines pgvector cosine similarity (semantic) with
 * Postgres Full-Text Search (keyword) using Reciprocal Rank Fusion (RRF).
 * Strictly scoped to projectId for tenant isolation.
 *
 * RRF formula: score = 1/(k + rank_vector) + 1/(k + rank_fts)
 * where k=60 is the standard constant that dampens the impact of high ranks.
 */
export async function searchEmbeddings(
  projectId: number,
  queryEmbedding: number[],
  queryText: string,
  limit = 5
): Promise<Array<{
  id: string;
  documentId: number;
  transcriptionId: number | null;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
  matchType: string;
}>> {
  const db = await getDb();
  if (!db) return [];
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  // Convert query to tsquery (simple config handles multilingual/non-English text better)
  // Use websearch_to_tsquery for natural language queries
  const results = await db.execute(
    sql`
      WITH
      -- Vector search: rank by cosine distance
      vector_search AS (
        SELECT
          de.id::text,
          de."documentId",
          de."transcriptionId",
          de.content,
          de.metadata,
          1 - (de.embedding <=> ${vectorStr}::vector) AS vector_score,
          ROW_NUMBER() OVER (ORDER BY de.embedding <=> ${vectorStr}::vector) AS vector_rank
        FROM document_embeddings de
        WHERE de."projectId" = ${projectId}
          AND de.embedding IS NOT NULL
        LIMIT 20
      ),
      -- Full-text search: rank by ts_rank
      fts_search AS (
        SELECT
          de.id::text,
          de."documentId",
          de."transcriptionId",
          de.content,
          de.metadata,
          ts_rank(de.content_tsv, websearch_to_tsquery('simple', ${queryText})) AS fts_score,
          ROW_NUMBER() OVER (
            ORDER BY ts_rank(de.content_tsv, websearch_to_tsquery('simple', ${queryText})) DESC
          ) AS fts_rank
        FROM document_embeddings de
        WHERE de."projectId" = ${projectId}
          AND de.content_tsv @@ websearch_to_tsquery('simple', ${queryText})
        LIMIT 20
      ),
      -- Merge both result sets
      all_ids AS (
        SELECT id FROM vector_search
        UNION
        SELECT id FROM fts_search
      ),
      -- RRF fusion: k=60 is the standard constant
      rrf AS (
        SELECT
          a.id,
          COALESCE(v."documentId", f."documentId") AS "documentId",
          COALESCE(v."transcriptionId", f."transcriptionId") AS "transcriptionId",
          COALESCE(v.content, f.content) AS content,
          COALESCE(v.metadata, f.metadata) AS metadata,
          COALESCE(1.0 / (60 + v.vector_rank), 0) +
          COALESCE(1.0 / (60 + f.fts_rank), 0) AS rrf_score,
          COALESCE(v.vector_score, 0) AS vector_score,
          CASE
            WHEN v.id IS NOT NULL AND f.id IS NOT NULL THEN 'hybrid'
            WHEN v.id IS NOT NULL THEN 'semantic'
            ELSE 'keyword'
          END AS match_type
        FROM all_ids a
        LEFT JOIN vector_search v ON v.id = a.id
        LEFT JOIN fts_search f ON f.id = a.id
      )
      SELECT
        id,
        "documentId",
        "transcriptionId",
        content,
        metadata,
        rrf_score AS similarity,
        match_type AS "matchType"
      FROM rrf
      ORDER BY rrf_score DESC
      LIMIT ${limit}
    `
  );
  return (results as unknown) as Array<{
    id: string;
    documentId: number;
    transcriptionId: number | null;
    content: string;
    metadata: Record<string, unknown> | null;
    similarity: number;
    matchType: string;
  }>;
}

/**
 * Get all reviewed/flagged documents that don't have embeddings yet.
 * Used by the re-index operation.
 */
export async function getReviewedDocsWithoutEmbeddings(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  // Find all reviewed/flagged docs that have no embedding
  const results = await db
    .select({
      documentId: transcriptions.documentId,
      transcriptionId: transcriptions.id,
      reviewedJson: transcriptions.reviewedJson,
      filename: documents.filename,
    })
    .from(transcriptions)
    .innerJoin(documents, eq(documents.id, transcriptions.documentId))
    .leftJoin(documentEmbeddings, eq(documentEmbeddings.documentId, transcriptions.documentId))
    .where(
      and(
        eq(transcriptions.projectId, projectId),
        or(
          eq(documents.status, "reviewed"),
          eq(documents.status, "flagged")
        ),
        // Only include docs with no embedding
        sql`${documentEmbeddings.id} IS NULL`
      )
    );

  return results;
}


// ─── Entity Helpers ──────────────────────────────────────────────────────────

/** Get all entities for a project, optionally filtered by type */
export async function getEntitiesByProject(
  projectId: number,
  type?: "person" | "location" | "organization",
) {
  const db = (await getDb())!;
  const conditions = [eq(entities.projectId, projectId)];
  if (type) conditions.push(eq(entities.type, type));

  return db
    .select()
    .from(entities)
    .where(and(...conditions))
    .orderBy(entities.name);
}

/** Get entities linked to a specific document */
export async function getEntitiesByDocument(documentId: number) {
  const db = (await getDb())!;
  return db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      contextSnippet: documentEntities.contextSnippet,
    })
    .from(documentEntities)
    .innerJoin(entities, eq(entities.id, documentEntities.entityId))
    .where(eq(documentEntities.documentId, documentId))
    .orderBy(entities.type, entities.name);
}

/** Get entity counts by type for a project */
export async function getEntityStats(projectId: number) {
  const db = (await getDb())!;
  const results = await db
    .select({
      type: entities.type,
      count: count(entities.id),
    })
    .from(entities)
    .where(eq(entities.projectId, projectId))
    .groupBy(entities.type);

  return {
    persons: results.find((r) => r.type === "person")?.count ?? 0,
    locations: results.find((r) => r.type === "location")?.count ?? 0,
    organizations: results.find((r) => r.type === "organization")?.count ?? 0,
    total: results.reduce((sum, r) => sum + r.count, 0),
  };
}

/** Get knowledge graph data: nodes (entities + documents) and edges (links) */
export async function getGraphData(projectId: number) {
  const db = (await getDb())!;

  // Get all entities for this project
  const allEntities = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
    })
    .from(entities)
    .where(eq(entities.projectId, projectId));

  // Get all document-entity links for this project
  const links = await db
    .select({
      documentId: documentEntities.documentId,
      entityId: documentEntities.entityId,
      contextSnippet: documentEntities.contextSnippet,
    })
    .from(documentEntities)
    .where(eq(documentEntities.projectId, projectId));

  // Get document names for linked documents
  const linkedDocIds = Array.from(new Set(links.map((l) => l.documentId)));
  let docNodes: { id: number; filename: string }[] = [];
  if (linkedDocIds.length > 0) {
    docNodes = await db
      .select({ id: documents.id, filename: documents.filename })
      .from(documents)
      .where(
        and(
          eq(documents.projectId, projectId),
          sql`${documents.id} IN ${linkedDocIds}`,
        ),
      );
  }

  // Build graph structure
  const nodes = [
    ...docNodes.map((d) => ({
      id: `doc-${d.id}`,
      label: d.filename,
      type: "document" as const,
    })),
    ...allEntities.map((e) => ({
      id: `ent-${e.id}`,
      label: e.name,
      type: e.type,
    })),
  ];

  const edges = links.map((l) => ({
    source: `doc-${l.documentId}`,
    target: `ent-${l.entityId}`,
    context: l.contextSnippet,
  }));

  return { nodes, edges };
}

// ─── Entity Details (for Entity Directory) ──────────────────────────────────

export async function getEntityDetails(projectId: number, entityId: number) {
  const db = await getDb();
  if (!db) return null;

  // 1. Get the entity itself
  const [entity] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
    .limit(1);

  if (!entity) return null;

  // 2. Get document mentions with filenames
  const mentions = await db
    .select({
      documentId: documentEntities.documentId,
      contextSnippet: documentEntities.contextSnippet,
      filename: documents.filename,
    })
    .from(documentEntities)
    .innerJoin(documents, eq(documentEntities.documentId, documents.id))
    .where(
      and(
        eq(documentEntities.entityId, entityId),
        eq(documentEntities.projectId, projectId),
      ),
    )
    .orderBy(documents.filename);

  // 3. Co-occurring entities: other entities that appear in the same documents
  // Get all document IDs this entity appears in
  const docIds = mentions.map((m) => m.documentId);

  let coOccurring: { id: number; name: string; type: string; frequency: number }[] = [];

  if (docIds.length > 0) {
    // Find other entities that share at least one document, count frequency
    const coRows = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        frequency: sql<number>`count(*)::int`,
      })
      .from(documentEntities)
      .innerJoin(entities, eq(documentEntities.entityId, entities.id))
      .where(
        and(
          eq(documentEntities.projectId, projectId),
          inArray(documentEntities.documentId, docIds),
          sql`${documentEntities.entityId} != ${entityId}`,
        ),
      )
      .groupBy(entities.id, entities.name, entities.type)
      .orderBy(sql`count(*) desc`)
      .limit(50);

    coOccurring = coRows;
  }

  return {
    entity,
    mentions,
    coOccurring,
  };
}
