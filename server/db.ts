import { and, eq, desc, sql, count, or, inArray, isNull, ilike, gt, lt, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  users, InsertUser,
  projects, InsertProject, Project,
  onboardingSamples, InsertOnboardingSample,
  documentGroups, InsertDocumentGroup, DocumentGroup,
  documents, InsertDocument, Document,
  transcriptions, InsertTranscription,
  jobs, InsertJob,
  documentEmbeddings, InsertDocumentEmbedding,
  entities, Entity,
  entityAliases, EntityAlias,
  documentEntities, DocumentEntity,
  projectMembers, InsertProjectMember, ProjectMember,
  projectInvites, InsertProjectInvite, ProjectInvite,
  reviewSessions,
  validationSessions,
  validationAssignments,
  validationReviews,
  researchConversations, ResearchConversation, InsertResearchConversation,
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
        max: isPgBouncer ? 5 : 3,
        prepare: !isPgBouncer,
        connect_timeout: 10,
        idle_timeout: 20,
        max_lifetime: 60 * 5,
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
  // Get owned projects
  const owned = await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
  // Get shared projects (where user is a member)
  const memberships = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  const sharedIds = memberships.map(m => m.projectId);
  let shared: typeof owned = [];
  if (sharedIds.length > 0) {
    shared = await db.select().from(projects).where(inArray(projects.id, sharedIds)).orderBy(desc(projects.createdAt));
  }
  // Annotate with role info
  const ownedWithRole = owned.map(p => ({ ...p, _memberRole: "owner" as const }));
  const sharedWithRole = shared.map(p => {
    const m = memberships.find(m => m.projectId === p.id);
    return { ...p, _memberRole: (m?.role ?? "viewer") as "owner" | "editor" | "viewer" };
  });
  return [...ownedWithRole, ...sharedWithRole];
}

export async function getProjectById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  // Check if user is the owner
  const result = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  if (result[0]) return result[0];
  // Check if user is a member
  const membership = await db.select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))
    .limit(1);
  if (membership[0]) {
    const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return proj[0];
  }
  return undefined;
}

/**
 * Get the user's role for a project: 'owner' | 'editor' | 'viewer' | null (no access)
 */
export async function getProjectRole(projectId: number, userId: number): Promise<"owner" | "editor" | "viewer" | null> {
  const db = await getDb();
  if (!db) return null;
  // Check ownership
  const proj = await db.select({ userId: projects.userId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj[0]) return null;
  if (proj[0].userId === userId) return "owner";
  // Check membership
  const membership = await db.select({ role: projectMembers.role }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (membership[0]) return membership[0].role;
  return null;
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

/** Paginated document list with optional search and status filter */
export async function getProjectLanguages(projectId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ rawJson: transcriptions.rawJson })
    .from(transcriptions)
    .where(eq(transcriptions.projectId, projectId));
  const langSet = new Set<string>();
  for (const row of rows) {
    const raw = row.rawJson as Record<string, unknown> | null;
    if (!raw) continue;
    const langs = raw.languages_present || raw.language || raw.primary_language;
    if (Array.isArray(langs)) langs.forEach((l: unknown) => { if (typeof l === "string") langSet.add(l); });
    else if (typeof langs === "string") langSet.add(langs);
  }
  return Array.from(langSet).sort();
}

export async function getDocumentsPaginated(opts: {
  projectId: number;
  status?: Document["status"];
  search?: string;
  language?: string;
  cursor?: number; // document ID to paginate after
  limit?: number;
  sortBy?: "filename" | "uploadedAt" | "status";
  sortDir?: "asc" | "desc";
}) {
  const db = await getDb();
  if (!db) return { documents: [], nextCursor: null, total: 0 };
  const { projectId, status, search, language, cursor, limit = 50, sortBy = "uploadedAt", sortDir = "desc" } = opts;

  const conditions = [eq(documents.projectId, projectId)];
  if (status) conditions.push(eq(documents.status, status));
  if (search && search.trim()) {
    conditions.push(ilike(documents.filename, `%${search.trim()}%`));
  }

  // Language filter: filter documents whose transcription contains the specified language
  let languageDocIds: number[] | null = null;
  if (language && language.trim()) {
    const langRows = await db
      .select({ documentId: transcriptions.documentId, rawJson: transcriptions.rawJson })
      .from(transcriptions)
      .where(eq(transcriptions.projectId, projectId));
    languageDocIds = langRows.filter(r => {
      const raw = r.rawJson as Record<string, unknown> | null;
      if (!raw) return false;
      const langs = raw.languages_present || raw.language || raw.primary_language;
      if (Array.isArray(langs)) return langs.some((l: unknown) => typeof l === "string" && l.toLowerCase() === language.toLowerCase());
      if (typeof langs === "string") return langs.toLowerCase() === language.toLowerCase();
      return false;
    }).map(r => r.documentId);
    if (languageDocIds.length === 0) return { documents: [], nextCursor: null, total: 0 };
    conditions.push(inArray(documents.id, languageDocIds));
  }

  // Get total count
  const [{ total }] = await db
    .select({ total: count(documents.id) })
    .from(documents)
    .where(and(...conditions));

  // Build sort order
  const orderCol = sortBy === "filename" ? documents.filename : sortBy === "status" ? documents.status : documents.uploadedAt;
  const orderFn = sortDir === "asc" ? asc : desc;

  // If cursor provided, add cursor condition
  if (cursor) {
    // Use id-based cursor for stable pagination
    conditions.push(sortDir === "desc" ? lt(documents.id, cursor) : gt(documents.id, cursor));
  }

  const rows = await db
    .select()
    .from(documents)
    .where(and(...conditions))
    .orderBy(orderFn(orderCol), desc(documents.id))
    .limit(limit + 1); // fetch one extra to determine if there's a next page

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1].id : null;

  return { documents: pageRows, nextCursor, total };
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

/** Delete a document and all related records (transcriptions, embeddings, entity links) */
export async function deleteDocument(id: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete related records first (in case ON DELETE CASCADE isn't set for all)
  await db.delete(documentEmbeddings).where(eq(documentEmbeddings.documentId, id));
  await db.delete(documentEntities).where(eq(documentEntities.documentId, id));
  await db.delete(transcriptions).where(eq(transcriptions.documentId, id));
  await db.delete(documents).where(and(eq(documents.id, id), eq(documents.projectId, projectId)));
}

/** Rename a document */
export async function renameDocument(id: number, projectId: number, newFilename: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documents).set({ filename: newFilename }).where(and(eq(documents.id, id), eq(documents.projectId, projectId)));
}
// ─── Document Groups (Multi-Page) ──────────────────────────────────────────

export async function createDocumentGroup(data: InsertDocumentGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [group] = await db.insert(documentGroups).values(data).returning();
  return group;
}

export async function getDocumentGroupsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documentGroups).where(eq(documentGroups.projectId, projectId)).orderBy(desc(documentGroups.createdAt));
}

export async function getDocumentGroupById(groupId: number) {
  const db = await getDb();
  if (!db) return null;
  const [group] = await db.select().from(documentGroups).where(eq(documentGroups.id, groupId)).limit(1);
  return group || null;
}

export async function getDocumentGroupPages(groupId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents).where(eq(documents.groupId, groupId)).orderBy(asc(documents.pageNumber));
}

export async function addDocumentToGroup(documentId: number, groupId: number, pageNumber: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documents).set({ groupId, pageNumber }).where(eq(documents.id, documentId));
  // Update page count
  const pages = await db.select({ id: documents.id }).from(documents).where(eq(documents.groupId, groupId));
  await db.update(documentGroups).set({ pageCount: pages.length, updatedAt: new Date() }).where(eq(documentGroups.id, groupId));
}

export async function removeDocumentFromGroup(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [doc] = await db.select({ groupId: documents.groupId }).from(documents).where(eq(documents.id, documentId));
  await db.update(documents).set({ groupId: null, pageNumber: null }).where(eq(documents.id, documentId));
  // Update page count if doc was in a group
  if (doc?.groupId) {
    const pages = await db.select({ id: documents.id }).from(documents).where(eq(documents.groupId, doc.groupId));
    await db.update(documentGroups).set({ pageCount: pages.length, updatedAt: new Date() }).where(eq(documentGroups.id, doc.groupId));
  }
}

export async function updateDocumentGroupMetadata(groupId: number, sharedMetadata: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documentGroups).set({ sharedMetadata, updatedAt: new Date() }).where(eq(documentGroups.id, groupId));
}

export async function updateDocumentGroupTitle(groupId: number, title: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documentGroups).set({ title, updatedAt: new Date() }).where(eq(documentGroups.id, groupId));
}

export async function deleteDocumentGroup(groupId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Unlink all documents from this group first
  await db.update(documents).set({ groupId: null, pageNumber: null }).where(eq(documents.groupId, groupId));
  await db.delete(documentGroups).where(eq(documentGroups.id, groupId));
}

export async function reorderGroupPages(groupId: number, orderedDocIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (let i = 0; i < orderedDocIds.length; i++) {
    await db.update(documents).set({ pageNumber: i + 1 }).where(and(eq(documents.id, orderedDocIds[i]), eq(documents.groupId, groupId)));
  }
}

// ─── Transcriptions ───────────────────────────────────────────────────────────────

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

export async function getAllTranscriptions(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    transcription: transcriptions,
    document: documents,
  }).from(transcriptions)
    .innerJoin(documents, eq(transcriptions.documentId, documents.id))
    .where(eq(transcriptions.projectId, projectId))
    .orderBy(desc(transcriptions.createdAt));
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
          ts_rank(de.content_tsv::tsvector, websearch_to_tsquery('simple', ${queryText})) AS fts_score,
          ROW_NUMBER() OVER (
            ORDER BY ts_rank(de.content_tsv::tsvector, websearch_to_tsquery('simple', ${queryText})) DESC
          ) AS fts_rank
        FROM document_embeddings de
        WHERE de."projectId" = ${projectId}
          AND de.content_tsv::tsvector @@ websearch_to_tsquery('simple', ${queryText})
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
  includeMerged = false,
) {
  const db = (await getDb())!;
  const conditions = [eq(entities.projectId, projectId)];
  if (type) conditions.push(eq(entities.type, type));
  if (!includeMerged) conditions.push(isNull(entities.canonicalId));

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

/** Get entity counts by type for a project (excludes merged entities) */
export async function getEntityStats(projectId: number) {
  const db = (await getDb())!;
  const results = await db
    .select({
      type: entities.type,
      count: count(entities.id),
    })
    .from(entities)
    .where(and(eq(entities.projectId, projectId), isNull(entities.canonicalId)))
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

  // Get all entities for this project (exclude merged/secondary entities)
  const allEntities = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
    })
    .from(entities)
    .where(and(eq(entities.projectId, projectId), isNull(entities.canonicalId)));

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
          isNull(entities.canonicalId),
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

/** Get all aliases for a given entity */
export async function getEntityAliases(entityId: number) {
  const db = (await getDb())!;
  return db
    .select()
    .from(entityAliases)
    .where(eq(entityAliases.entityId, entityId))
    .orderBy(entityAliases.alias);
}

/** Get all aliases for multiple entities (batch) */
export async function getEntityAliasesBatch(entityIds: number[]) {
  if (entityIds.length === 0) return [];
  const db = (await getDb())!;
  return db
    .select()
    .from(entityAliases)
    .where(inArray(entityAliases.entityId, entityIds))
    .orderBy(entityAliases.entityId, entityAliases.alias);
}

/** Search entities by name OR alias (for the entity directory search) */
export async function searchEntitiesByNameOrAlias(
  projectId: number,
  searchTerm: string,
  type?: "person" | "location" | "organization",
) {
  const db = (await getDb())!;
  const pattern = `%${searchTerm}%`;

  // Find entity IDs that match via alias
  const aliasMatches = await db
    .select({ entityId: entityAliases.entityId })
    .from(entityAliases)
    .innerJoin(entities, eq(entities.id, entityAliases.entityId))
    .where(
      and(
        eq(entities.projectId, projectId),
        isNull(entities.canonicalId),
        ilike(entityAliases.alias, pattern),
      ),
    );

  const aliasEntityIds = aliasMatches.map(a => a.entityId);

  // Build conditions for main query: name matches OR id in alias matches
  const conditions = [
    eq(entities.projectId, projectId),
    isNull(entities.canonicalId),
  ];
  if (type) conditions.push(eq(entities.type, type));

  const nameCondition = ilike(entities.name, pattern);
  const aliasCondition = aliasEntityIds.length > 0
    ? inArray(entities.id, aliasEntityIds)
    : undefined;

  const whereClause = aliasCondition
    ? and(...conditions, or(nameCondition, aliasCondition))
    : and(...conditions, nameCondition);

  return db
    .select()
    .from(entities)
    .where(whereClause!)
    .orderBy(entities.name);
}

/** Update an entity's name */
export async function updateEntityName(entityId: number, projectId: number, newName: string) {
  const db = (await getDb())!;
  await db
    .update(entities)
    .set({ name: newName, normalizedName: newName.toLowerCase().trim() })
    .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)));
}

/** Delete entities by IDs (cascades to aliases and document_entities) */
export async function deleteEntities(entityIds: number[], projectId: number) {
  const db = (await getDb())!;
  if (entityIds.length === 0) return;
  await db
    .delete(entities)
    .where(and(inArray(entities.id, entityIds), eq(entities.projectId, projectId)));
}

// ─── Project Members & Invites ──────────────────────────────────────────────

/** Get all members of a project (includes owner info from projects table) */
export async function getProjectMembers(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: projectMembers.id,
      userId: projectMembers.userId,
      role: projectMembers.role,
      addedAt: projectMembers.addedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.addedAt);
}

/** Add a member to a project */
export async function addProjectMember(data: { projectId: number; userId: number; role: "owner" | "editor" | "viewer" }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if already a member
  const existing = await db.select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, data.projectId), eq(projectMembers.userId, data.userId)))
    .limit(1);
  if (existing[0]) return existing[0];
  const result = await db.insert(projectMembers).values({
    projectId: data.projectId,
    userId: data.userId,
    role: data.role,
  }).returning();
  return result[0];
}

/** Remove a member from a project */
export async function removeProjectMember(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

/** Update a member's role */
export async function updateMemberRole(projectId: number, userId: number, role: "editor" | "viewer") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectMembers)
    .set({ role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

/** Create a project invite */
export async function createProjectInvite(data: InsertProjectInvite) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectInvites).values(data).returning();
  return result[0];
}

/** Get all pending invites for a project */
export async function getProjectInvites(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectInvites)
    .where(and(eq(projectInvites.projectId, projectId), eq(projectInvites.status, "pending")))
    .orderBy(desc(projectInvites.createdAt));
}

/** Get an invite by token */
export async function getInviteByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projectInvites)
    .where(eq(projectInvites.token, token))
    .limit(1);
  return result[0];
}

/** Get pending invites for an email address */
export async function getPendingInvitesByEmail(email: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectInvites)
    .where(and(
      eq(projectInvites.email, email.toLowerCase()),
      eq(projectInvites.status, "pending"),
    ));
}

/** Accept an invite: mark as accepted and add user as member */
export async function acceptInvite(inviteId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const invite = await db.select().from(projectInvites).where(eq(projectInvites.id, inviteId)).limit(1);
  if (!invite[0]) throw new Error("Invite not found");
  if (invite[0].status !== "pending") throw new Error("Invite already used or expired");
  if (new Date() > invite[0].expiresAt) {
    await db.update(projectInvites).set({ status: "expired" }).where(eq(projectInvites.id, inviteId));
    throw new Error("Invite has expired");
  }
  // Mark invite as accepted
  await db.update(projectInvites).set({ status: "accepted" }).where(eq(projectInvites.id, inviteId));
  // Add as member
  await addProjectMember({ projectId: invite[0].projectId, userId, role: invite[0].role });
  return invite[0];
}

/** Cancel/delete a pending invite */
export async function cancelInvite(inviteId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectInvites)
    .where(and(eq(projectInvites.id, inviteId), eq(projectInvites.projectId, projectId)));
}

/** Find a user by email */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return result[0];
}

/**
 * Reset documents stuck in 'processing' for >5 min, then return all pending + error docs for retry.
 */
export async function resetStuckAndGetRetryable(projectId: number): Promise<Document[]> {
  const db = await getDb();
  if (!db) return [];

  // Reset stuck 'processing' docs (>5 min old) to 'pending'
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  await db.update(documents)
    .set({ status: "pending" })
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.status, "processing"),
        lt(documents.uploadedAt, fiveMinAgo)
      )
    );

  // Get all pending + error docs
  return db.select().from(documents).where(
    and(
      eq(documents.projectId, projectId),
      inArray(documents.status, ["pending", "error"])
    )
  ).orderBy(asc(documents.uploadedAt));
}

// ─── Review Sessions ─────────────────────────────────────────────────────────

export async function getReviewSession(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(reviewSessions).where(
    and(eq(reviewSessions.userId, userId), eq(reviewSessions.projectId, projectId))
  ).limit(1);
  return rows[0] || null;
}

export async function saveReviewSession(userId: number, projectId: number, data: {
  mode: string;
  currentDocumentId: number | null;
  currentLineIndex: number;
  reviewedLines: Record<string, unknown>;
  selectedLanguage: string;
}) {
  const db = await getDb();
  if (!db) return null;
  // Upsert: try update first, insert if not exists
  const existing = await db.select({ id: reviewSessions.id }).from(reviewSessions).where(
    and(eq(reviewSessions.userId, userId), eq(reviewSessions.projectId, projectId))
  ).limit(1);

  if (existing.length > 0) {
    await db.update(reviewSessions).set({
      mode: data.mode,
      currentDocumentId: data.currentDocumentId,
      currentLineIndex: data.currentLineIndex,
      reviewedLines: data.reviewedLines,
      selectedLanguage: data.selectedLanguage,
      updatedAt: new Date(),
    }).where(eq(reviewSessions.id, existing[0].id));
    return existing[0].id;
  } else {
    const [row] = await db.insert(reviewSessions).values({
      userId,
      projectId,
      mode: data.mode,
      currentDocumentId: data.currentDocumentId,
      currentLineIndex: data.currentLineIndex,
      reviewedLines: data.reviewedLines,
      selectedLanguage: data.selectedLanguage,
    }).returning({ id: reviewSessions.id });
    return row.id;
  }
}

// ─── Validation Portal Helpers ──────────────────────────────────────────────

export async function createValidationSession(data: {
  projectId: number;
  title: string;
  shareToken: string;
  documentIds: number[];
  reviewsPerDoc?: number;
  arabicOnly?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(validationSessions).values({
    projectId: data.projectId,
    title: data.title,
    shareToken: data.shareToken,
    totalDocs: data.documentIds.length,
    reviewsPerDoc: data.reviewsPerDoc ?? 5,
    documentIds: data.documentIds,
    arabicOnly: data.arabicOnly ?? true,
  }).returning();
  return row;
}

export async function getValidationSessionByToken(shareToken: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(validationSessions).where(eq(validationSessions.shareToken, shareToken)).limit(1);
  return rows[0] ?? null;
}

export async function getValidationSessionsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(validationSessions).where(eq(validationSessions.projectId, projectId)).orderBy(validationSessions.createdAt);
}

export async function closeValidationSession(sessionId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(validationSessions).set({ status: "closed", closedAt: new Date() }).where(eq(validationSessions.id, sessionId));
}

export async function deleteValidationSession(sessionId: number) {
  const db = await getDb();
  if (!db) return;
  // Cascade: delete reviews -> assignments -> session (FK cascade handles it)
  await db.delete(validationSessions).where(eq(validationSessions.id, sessionId));
}

export async function getNextAssignment(sessionId: number, reviewerUsername: string) {
  const db = await getDb();
  if (!db) return null;

  // Get the session to know which docs are in it
  const [session] = await db.select().from(validationSessions).where(eq(validationSessions.id, sessionId)).limit(1);
  if (!session || session.status === "closed") return null;

  const docIds = session.documentIds as number[];
  const reviewsPerDoc = session.reviewsPerDoc;

  // Check if this reviewer already has an in-progress assignment
  const existing = await db.select().from(validationAssignments).where(
    and(
      eq(validationAssignments.sessionId, sessionId),
      eq(validationAssignments.reviewerUsername, reviewerUsername),
      eq(validationAssignments.status, "in_progress")
    )
  ).limit(1);
  if (existing.length > 0) return existing[0];

  // Get all assignments for this session to find which docs need more reviewers
  const allAssignments = await db.select().from(validationAssignments).where(
    eq(validationAssignments.sessionId, sessionId)
  );

  // Count unique reviewers per doc
  const reviewerCountByDoc: Record<number, Set<string>> = {};
  for (const docId of docIds) {
    reviewerCountByDoc[docId] = new Set();
  }
  for (const a of allAssignments) {
    if (reviewerCountByDoc[a.documentId]) {
      reviewerCountByDoc[a.documentId].add(a.reviewerUsername);
    }
  }

  // Find docs this reviewer hasn't been assigned yet AND that still need more reviewers
  // Round-robin: pick the doc with fewest reviewers first
  let bestDocId: number | null = null;
  let bestCount = Infinity;
  for (const docId of docIds) {
    const reviewers = reviewerCountByDoc[docId];
    if (reviewers.has(reviewerUsername)) continue; // already assigned
    if (reviewers.size >= reviewsPerDoc) continue; // already has enough
    if (reviewers.size < bestCount) {
      bestCount = reviewers.size;
      bestDocId = docId;
    }
  }

  if (bestDocId === null) return null; // all docs fully assigned or this reviewer has done them all

  // Create new assignment
  const [assignment] = await db.insert(validationAssignments).values({
    sessionId,
    documentId: bestDocId,
    reviewerUsername,
  }).returning();
  return assignment;
}

export async function getAssignmentById(assignmentId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(validationAssignments).where(eq(validationAssignments.id, assignmentId)).limit(1);
  return rows[0] ?? null;
}

export async function submitLineVerdict(data: {
  assignmentId: number;
  sessionId: number;
  documentId: number;
  reviewerUsername: string;
  lineIndex: number;
  lineText: string;
  verdict: "correct" | "incorrect" | "skipped";
  incorrectWords?: Array<{ wordIndex: number; word: string }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Insert the review
  await db.insert(validationReviews).values({
    assignmentId: data.assignmentId,
    sessionId: data.sessionId,
    documentId: data.documentId,
    reviewerUsername: data.reviewerUsername,
    lineIndex: data.lineIndex,
    lineText: data.lineText,
    verdict: data.verdict,
    incorrectWords: data.incorrectWords ?? null,
  });

  // Update assignment counters
  const [assignment] = await db.select().from(validationAssignments).where(eq(validationAssignments.id, data.assignmentId)).limit(1);
  if (assignment) {
    const updates: Record<string, unknown> = {
      linesReviewed: (assignment.linesReviewed ?? 0) + 1,
    };
    if (data.verdict === "correct") {
      updates.correctCount = (assignment.correctCount ?? 0) + 1;
    } else if (data.verdict === "incorrect") {
      updates.incorrectCount = (assignment.incorrectCount ?? 0) + 1;
    }
    // 'skipped' does not increment correct or incorrect counts
    await db.update(validationAssignments).set(updates).where(eq(validationAssignments.id, data.assignmentId));
  }
}

export async function completeAssignment(assignmentId: number, totalLines: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(validationAssignments).set({
    status: "completed",
    totalLines,
    completedAt: new Date(),
  }).where(eq(validationAssignments.id, assignmentId));
}

export async function getReviewerProgress(sessionId: number, reviewerUsername: string) {
  const db = await getDb();
  if (!db) return { completed: 0, inProgress: null, totalAvailable: 0 };

  const assignments = await db.select().from(validationAssignments).where(
    and(
      eq(validationAssignments.sessionId, sessionId),
      eq(validationAssignments.reviewerUsername, reviewerUsername)
    )
  );

  const completed = assignments.filter(a => a.status === "completed").length;
  const inProgress = assignments.find(a => a.status === "in_progress") ?? null;

  // Total available = docs not yet fully assigned + docs already assigned to this reviewer
  const [session] = await db.select().from(validationSessions).where(eq(validationSessions.id, sessionId)).limit(1);
  const totalAvailable = session ? (session.documentIds as number[]).length : 0;

  return { completed, inProgress, totalAvailable };
}

export async function getValidationStats(sessionId: number) {
  const db = await getDb();
  if (!db) return null;

  const [session] = await db.select().from(validationSessions).where(eq(validationSessions.id, sessionId)).limit(1);
  if (!session) return null;

  const assignments = await db.select().from(validationAssignments).where(eq(validationAssignments.sessionId, sessionId));
  const reviews = await db.select().from(validationReviews).where(eq(validationReviews.sessionId, sessionId));

  // Per-doc stats
  const docStats: Record<number, { correct: number; incorrect: number; reviewers: Set<string> }> = {};
  for (const r of reviews) {
    if (!docStats[r.documentId]) {
      docStats[r.documentId] = { correct: 0, incorrect: 0, reviewers: new Set() };
    }
    docStats[r.documentId].reviewers.add(r.reviewerUsername);
    if (r.verdict === "correct") docStats[r.documentId].correct++;
    else docStats[r.documentId].incorrect++;
  }

  // Per-reviewer stats
  const reviewerStats: Record<string, { docsCompleted: number; linesReviewed: number; correctCount: number; incorrectCount: number }> = {};
  for (const a of assignments) {
    if (!reviewerStats[a.reviewerUsername]) {
      reviewerStats[a.reviewerUsername] = { docsCompleted: 0, linesReviewed: 0, correctCount: 0, incorrectCount: 0 };
    }
    if (a.status === "completed") reviewerStats[a.reviewerUsername].docsCompleted++;
    reviewerStats[a.reviewerUsername].linesReviewed += a.linesReviewed ?? 0;
    reviewerStats[a.reviewerUsername].correctCount += a.correctCount ?? 0;
    reviewerStats[a.reviewerUsername].incorrectCount += a.incorrectCount ?? 0;
  }

  // Inter-rater agreement: for each line that has multiple reviews, check if they agree
  const lineVerdicts: Record<string, string[]> = {}; // key = `${docId}-${lineIndex}`
  for (const r of reviews) {
    const key = `${r.documentId}-${r.lineIndex}`;
    if (!lineVerdicts[key]) lineVerdicts[key] = [];
    lineVerdicts[key].push(r.verdict);
  }
  let agreementCount = 0;
  let multiReviewedLines = 0;
  for (const verdicts of Object.values(lineVerdicts)) {
    if (verdicts.length >= 2) {
      multiReviewedLines++;
      const allSame = verdicts.every(v => v === verdicts[0]);
      if (allSame) agreementCount++;
    }
  }
  const interRaterAgreement = multiReviewedLines > 0 ? agreementCount / multiReviewedLines : null;

  // Overall accuracy
  const totalCorrect = reviews.filter(r => r.verdict === "correct").length;
  const totalIncorrect = reviews.filter(r => r.verdict === "incorrect").length;
  const totalReviews = reviews.length;
  const overallAccuracy = totalReviews > 0 ? totalCorrect / totalReviews : null;

  return {
    session,
    totalReviews,
    totalCorrect,
    totalIncorrect,
    overallAccuracy,
    interRaterAgreement,
    multiReviewedLines,
    docsCompleted: Object.values(docStats).filter(d => d.reviewers.size >= session.reviewsPerDoc).length,
    totalDocs: session.totalDocs,
    uniqueReviewers: new Set(assignments.map(a => a.reviewerUsername)).size,
    docStats: Object.entries(docStats).map(([docId, s]) => ({
      documentId: Number(docId),
      correct: s.correct,
      incorrect: s.incorrect,
      reviewerCount: s.reviewers.size,
      accuracy: (s.correct + s.incorrect) > 0 ? s.correct / (s.correct + s.incorrect) : null,
    })),
    reviewerStats: Object.entries(reviewerStats).map(([username, s]) => ({
      username,
      ...s,
    })),
  };
}

export async function getReviewsForAssignment(assignmentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(validationReviews).where(eq(validationReviews.assignmentId, assignmentId)).orderBy(validationReviews.lineIndex);
}

// ─── Research Conversations (Codex Agent) ──────────────────────────────────

export async function getResearchConversations(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: researchConversations.id,
    title: researchConversations.title,
    createdAt: researchConversations.createdAt,
    updatedAt: researchConversations.updatedAt,
  }).from(researchConversations)
    .where(and(eq(researchConversations.projectId, projectId), eq(researchConversations.userId, userId)))
    .orderBy(desc(researchConversations.updatedAt));
}

export async function getResearchConversation(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(researchConversations)
    .where(and(eq(researchConversations.id, id), eq(researchConversations.userId, userId)))
    .limit(1);
  return rows[0] || null;
}

export async function createResearchConversation(data: { projectId: number; userId: number; title: string; messages: unknown[] }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(researchConversations).values({
    projectId: data.projectId,
    userId: data.userId,
    title: data.title,
    messages: data.messages,
  }).returning();
  return row;
}

export async function updateResearchConversation(id: number, data: { title?: string; messages?: unknown[] }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.messages !== undefined) updates.messages = data.messages;
  await db.update(researchConversations).set(updates).where(eq(researchConversations.id, id));
}

export async function deleteResearchConversation(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(researchConversations).where(
    and(eq(researchConversations.id, id), eq(researchConversations.userId, userId))
  );
}
