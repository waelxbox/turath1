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
  activityLog, InsertActivityLog,
  documentAssignments, InsertDocumentAssignment,
  mergeSuggestions,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { FREE_DOCUMENT_LIMIT, isUnlimitedOwnerEmail } from "./billing/products";

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
        max: isPgBouncer ? 15 : 10,
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


/** Get total number of documents processed across the entire platform (all projects) */
export async function getPlatformDocumentCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ total: count() })
    .from(documents)
    .where(
      or(
        eq(documents.status, "reviewed"),
        eq(documents.status, "needs_review"),
      )
    );
  return Number(result[0]?.total ?? 0);
}

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

export type DocumentQuotaStatus = {
  allowed: boolean;
  quotaReserved: boolean;
  plan: "free" | "owner";
  documentLimit: number | null;
  documentsUsed: number;
  documentsRemaining: number | null;
};

/** Returns current free-tier status from the database, not a potentially stale session. */
export async function getDocumentQuotaStatus(userId: number): Promise<DocumentQuotaStatus> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while checking document usage");

  const [user] = await db
    .select({ id: users.id, email: users.email, documentQuotaUsed: users.documentQuotaUsed })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new Error("User not found while checking document usage");

  if (isUnlimitedOwnerEmail(user.email)) {
    return {
      allowed: true,
      quotaReserved: false,
      plan: "owner",
      documentLimit: null,
      documentsUsed: user.documentQuotaUsed,
      documentsRemaining: null,
    };
  }

  // documentQuotaUsed was introduced before enforcement. Reconcile it with
  // already-uploaded documents so a pre-existing free account cannot receive a
  // fresh allowance merely because its historical counter was never updated.
  const [existing] = await db
    .select({ total: count() })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .where(eq(projects.userId, userId));
  const historicalDocumentCount = Number(existing?.total ?? 0);
  const documentsUsed = Math.max(user.documentQuotaUsed, historicalDocumentCount);
  if (documentsUsed > user.documentQuotaUsed) {
    await db
      .update(users)
      .set({ documentQuotaUsed: documentsUsed, updatedAt: new Date() })
      .where(and(eq(users.id, userId), lt(users.documentQuotaUsed, documentsUsed)));
  }

  return {
    allowed: documentsUsed < FREE_DOCUMENT_LIMIT,
    quotaReserved: false,
    plan: "free",
    documentLimit: FREE_DOCUMENT_LIMIT,
    documentsUsed,
    documentsRemaining: Math.max(0, FREE_DOCUMENT_LIMIT - documentsUsed),
  };
}

/**
 * Atomically reserves one document before any object-storage work occurs. The
 * conditional update is the quota boundary, so concurrent uploads cannot
 * exceed the free allowance.
 */
export async function reserveDocumentQuotaSlot(userId: number): Promise<DocumentQuotaStatus> {
  const current = await getDocumentQuotaStatus(userId);
  if (current.plan === "owner") return current;

  const db = await getDb();
  if (!db) throw new Error("Database unavailable while reserving document usage");
  const [reserved] = await db
    .update(users)
    .set({ documentQuotaUsed: sql`${users.documentQuotaUsed} + 1`, updatedAt: new Date() })
    .where(and(eq(users.id, userId), lt(users.documentQuotaUsed, FREE_DOCUMENT_LIMIT)))
    .returning({ documentQuotaUsed: users.documentQuotaUsed });

  if (!reserved) return getDocumentQuotaStatus(userId);

  return {
    allowed: true,
    quotaReserved: true,
    plan: "free",
    documentLimit: FREE_DOCUMENT_LIMIT,
    documentsUsed: reserved.documentQuotaUsed,
    documentsRemaining: Math.max(0, FREE_DOCUMENT_LIMIT - reserved.documentQuotaUsed),
  };
}

/** Releases a previously reserved slot when storage or document creation fails. */
export async function releaseDocumentQuotaSlot(userId: number): Promise<void> {
  const status = await getDocumentQuotaStatus(userId);
  if (status.plan === "owner" || status.documentsUsed <= 0) return;

  const db = await getDb();
  if (!db) throw new Error("Database unavailable while releasing document usage");
  await db
    .update(users)
    .set({ documentQuotaUsed: sql`GREATEST(${users.documentQuotaUsed} - 1, 0)`, updatedAt: new Date() })
    .where(and(eq(users.id, userId), gt(users.documentQuotaUsed, 0)));
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

export async function getOnboardingSampleById(id: number, projectId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(onboardingSamples)
    .where(and(eq(onboardingSamples.id, id), eq(onboardingSamples.projectId, projectId)))
    .limit(1);
  return result[0];
}

export async function updateSampleAiOutput(id: number, projectId: number, aiOutput: unknown, validationScore: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(onboardingSamples)
    .set({ aiOutput, validationScore })
    .where(and(eq(onboardingSamples.id, id), eq(onboardingSamples.projectId, projectId)));
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

export async function updateDocumentStatus(id: number, projectId: number, status: Document["status"], errorMessage?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const update: Partial<InsertDocument> = { status };
  if (["needs_review", "reviewed", "error"].includes(status)) update.processedAt = new Date();
  if (errorMessage !== undefined) update.errorMessage = errorMessage;
  await db.update(documents)
    .set(update)
    .where(and(eq(documents.id, id), eq(documents.projectId, projectId)));
}

/** Delete a document and all related records (transcriptions, embeddings, entity links) */
export async function deleteDocument(id: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const [ownedDocument] = await tx.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.id, id), eq(documents.projectId, projectId)))
      .limit(1);
    if (!ownedDocument) return;

    // Keep every dependent delete tenant-scoped even if a deployment is missing
    // one of the expected ON DELETE CASCADE constraints.
    await tx.delete(documentEmbeddings).where(and(
      eq(documentEmbeddings.documentId, id),
      eq(documentEmbeddings.projectId, projectId),
    ));
    await tx.delete(documentEntities).where(and(
      eq(documentEntities.documentId, id),
      eq(documentEntities.projectId, projectId),
    ));
    await tx.delete(transcriptions).where(and(
      eq(transcriptions.documentId, id),
      eq(transcriptions.projectId, projectId),
    ));
    await tx.delete(documents).where(and(eq(documents.id, id), eq(documents.projectId, projectId)));
  });
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

export async function getDocumentGroupById(groupId: number, projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const [group] = await db.select().from(documentGroups)
    .where(and(eq(documentGroups.id, groupId), eq(documentGroups.projectId, projectId)))
    .limit(1);
  return group || null;
}

export async function getDocumentGroupPages(groupId: number, projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents)
    .where(and(eq(documents.groupId, groupId), eq(documents.projectId, projectId)))
    .orderBy(asc(documents.pageNumber));
}

export async function addDocumentToGroup(documentId: number, groupId: number, projectId: number, pageNumber: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const [group] = await tx.select({ id: documentGroups.id }).from(documentGroups)
      .where(and(eq(documentGroups.id, groupId), eq(documentGroups.projectId, projectId)))
      .limit(1);
    if (!group) throw new Error("Document group not found");
    const updated = await tx.update(documents).set({ groupId, pageNumber })
      .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId)))
      .returning({ id: documents.id });
    if (updated.length !== 1) throw new Error("Document not found");
    const pages = await tx.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.groupId, groupId), eq(documents.projectId, projectId)));
    await tx.update(documentGroups).set({ pageCount: pages.length, updatedAt: new Date() })
      .where(and(eq(documentGroups.id, groupId), eq(documentGroups.projectId, projectId)));
  });
}

export async function removeDocumentFromGroup(documentId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const [doc] = await tx.select({ groupId: documents.groupId }).from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId)))
      .limit(1);
    if (!doc) throw new Error("Document not found");
    await tx.update(documents).set({ groupId: null, pageNumber: null })
      .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId)));
    if (doc.groupId) {
      const pages = await tx.select({ id: documents.id }).from(documents)
        .where(and(eq(documents.groupId, doc.groupId), eq(documents.projectId, projectId)));
      await tx.update(documentGroups).set({ pageCount: pages.length, updatedAt: new Date() })
        .where(and(eq(documentGroups.id, doc.groupId), eq(documentGroups.projectId, projectId)));
    }
  });
}

export async function updateDocumentGroupMetadata(groupId: number, projectId: number, sharedMetadata: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documentGroups).set({ sharedMetadata, updatedAt: new Date() })
    .where(and(eq(documentGroups.id, groupId), eq(documentGroups.projectId, projectId)));
}

export async function updateDocumentGroupTitle(groupId: number, projectId: number, title: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documentGroups).set({ title, updatedAt: new Date() })
    .where(and(eq(documentGroups.id, groupId), eq(documentGroups.projectId, projectId)));
}

export async function deleteDocumentGroup(groupId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const [group] = await tx.select({ id: documentGroups.id }).from(documentGroups)
      .where(and(eq(documentGroups.id, groupId), eq(documentGroups.projectId, projectId)))
      .limit(1);
    if (!group) return;
    await tx.update(documents).set({ groupId: null, pageNumber: null })
      .where(and(eq(documents.groupId, groupId), eq(documents.projectId, projectId)));
    await tx.delete(documentGroups)
      .where(and(eq(documentGroups.id, groupId), eq(documentGroups.projectId, projectId)));
  });
}

export async function reorderGroupPages(groupId: number, projectId: number, orderedDocIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: documents.id }).from(documents).where(and(
      eq(documents.groupId, groupId),
      eq(documents.projectId, projectId),
    ));
    const existingIds = existing.map((row) => row.id).sort((a, b) => a - b);
    const requestedIds = Array.from(new Set(orderedDocIds)).sort((a, b) => a - b);
    if (existingIds.length !== requestedIds.length || existingIds.some((id, i) => id !== requestedIds[i])) {
      throw new Error("Page order must contain every document in the project group exactly once");
    }
    for (let i = 0; i < orderedDocIds.length; i++) {
      await tx.update(documents).set({ pageNumber: i + 1 }).where(and(
        eq(documents.id, orderedDocIds[i]),
        eq(documents.groupId, groupId),
        eq(documents.projectId, projectId),
      ));
    }
  });
}

// ─── Transcriptions ───────────────────────────────────────────────────────────────

export async function createTranscription(data: InsertTranscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [document] = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.id, data.documentId),
    eq(documents.projectId, data.projectId),
  )).limit(1);
  if (!document) throw new Error("Transcription document does not belong to the project");
  const result = await db.insert(transcriptions).values(data).returning();
  return result[0];
}

export async function getTranscriptionByDocumentId(documentId: number, projectId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(transcriptions)
    .where(and(eq(transcriptions.documentId, documentId), eq(transcriptions.projectId, projectId)))
    .orderBy(desc(transcriptions.createdAt))
    .limit(1);
  return result[0];
}

export async function updateReviewedJson(id: number, documentId: number, projectId: number, reviewedJson: unknown) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(transcriptions)
    .set({ reviewedJson, reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(transcriptions.id, id),
      eq(transcriptions.documentId, documentId),
      eq(transcriptions.projectId, projectId),
    ));
}

export async function getReviewedTranscriptions(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  // Use subquery to get only the latest transcription per document
  const allRows = await db.select({
    transcription: transcriptions,
    document: documents,
  }).from(transcriptions)
    .innerJoin(documents, eq(transcriptions.documentId, documents.id))
    .where(and(
      eq(transcriptions.projectId, projectId),
      sql`${documents.status} IN ('reviewed', 'flagged')`
    ))
    .orderBy(desc(transcriptions.reviewedAt));
  // Deduplicate: keep only the first (most recent) transcription per document
  const seen = new Set<number>();
  return allRows.filter(row => {
    if (seen.has(row.document.id)) return false;
    seen.add(row.document.id);
    return true;
  });
}

export async function getAllTranscriptions(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  const allRows = await db.select({
    transcription: transcriptions,
    document: documents,
  }).from(transcriptions)
    .innerJoin(documents, eq(transcriptions.documentId, documents.id))
    .where(eq(transcriptions.projectId, projectId))
    .orderBy(desc(transcriptions.createdAt));
  // Deduplicate: keep only the most recent transcription per document
  const seen = new Set<number>();
  return allRows.filter(row => {
    if (seen.has(row.document.id)) return false;
    seen.add(row.document.id);
    return true;
  });
}

/** Get transcriptions for a specific set of document IDs */
export async function getTranscriptionsByDocumentIds(projectId: number, documentIds: number[]) {
  const db = await getDb();
  if (!db || documentIds.length === 0) return [];
  const allRows = await db.select({
    transcription: transcriptions,
    document: documents,
  }).from(transcriptions)
    .innerJoin(documents, eq(transcriptions.documentId, documents.id))
    .where(and(
      eq(transcriptions.projectId, projectId),
      inArray(documents.id, documentIds)
    ))
    .orderBy(desc(transcriptions.createdAt));
  // Deduplicate: keep only the most recent transcription per document
  const seen = new Set<number>();
  return allRows.filter(row => {
    if (seen.has(row.document.id)) return false;
    seen.add(row.document.id);
    return true;
  });
}

/** Get transcriptions filtered by document status */
export async function getTranscriptionsByStatus(projectId: number, status: string) {
  const db = await getDb();
  if (!db) return [];
  const allRows = await db.select({
    transcription: transcriptions,
    document: documents,
  }).from(transcriptions)
    .innerJoin(documents, eq(transcriptions.documentId, documents.id))
    .where(and(
      eq(transcriptions.projectId, projectId),
      eq(documents.status, status as any)
    ))
    .orderBy(desc(transcriptions.createdAt));
  // Deduplicate: keep only the most recent transcription per document
  const seen = new Set<number>();
  return allRows.filter(row => {
    if (seen.has(row.document.id)) return false;
    seen.add(row.document.id);
    return true;
  });
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
  const [document] = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.id, data.documentId),
    eq(documents.projectId, data.projectId),
  )).limit(1);
  if (!document) throw new Error("Embedding document does not belong to the project");
  if (data.transcriptionId !== null && data.transcriptionId !== undefined) {
    const [transcription] = await db.select({ id: transcriptions.id }).from(transcriptions).where(and(
      eq(transcriptions.id, data.transcriptionId),
      eq(transcriptions.documentId, data.documentId),
      eq(transcriptions.projectId, data.projectId),
    )).limit(1);
    if (!transcription) throw new Error("Embedding transcription does not belong to the project document");
  }
  const result = await db.insert(documentEmbeddings).values(data).returning();
  // Populate tsvector for full-text search
  if (result[0]?.id) {
    await db.execute(
      sql`UPDATE document_embeddings SET content_tsv = to_tsvector('simple', ${data.content}) WHERE id = ${result[0].id}`
    );
  }
  return result[0];
}

export async function deleteEmbeddingsByDocumentId(projectId: number, documentId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(documentEmbeddings).where(and(
    eq(documentEmbeddings.documentId, documentId),
    eq(documentEmbeddings.projectId, projectId),
  ));
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
      rawJson: transcriptions.rawJson,
      filename: documents.filename,
      status: documents.status,
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

/** Get ALL transcribed docs (any status) that have no embedding yet */
export async function getAllDocsWithoutEmbeddings(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  const allRows = await db
    .select({
      documentId: transcriptions.documentId,
      transcriptionId: transcriptions.id,
      reviewedJson: transcriptions.reviewedJson,
      rawJson: transcriptions.rawJson,
      filename: documents.filename,
      status: documents.status,
    })
    .from(transcriptions)
    .innerJoin(documents, eq(documents.id, transcriptions.documentId))
    .leftJoin(documentEmbeddings, eq(documentEmbeddings.documentId, transcriptions.documentId))
    .where(
      and(
        eq(transcriptions.projectId, projectId),
        // Any doc that has a transcription (not pending/error)
        or(
          eq(documents.status, "reviewed"),
          eq(documents.status, "flagged"),
          eq(documents.status, "needs_review")
        ),
        sql`${documentEmbeddings.id} IS NULL`
      )
    )
    .orderBy(desc(transcriptions.createdAt));

  // Deduplicate: keep only the most recent transcription per document
  const seen = new Set<number>();
  return allRows.filter(row => {
    if (seen.has(row.documentId)) return false;
    seen.add(row.documentId);
    return true;
  });
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
export async function getEntitiesByDocument(projectId: number, documentId: number) {
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
    .where(and(
      eq(documentEntities.documentId, documentId),
      eq(documentEntities.projectId, projectId),
      eq(entities.projectId, projectId),
    ))
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
export async function getEntityAliases(projectId: number, entityId: number) {
  const db = (await getDb())!;
  return db
    .select({
      id: entityAliases.id,
      entityId: entityAliases.entityId,
      alias: entityAliases.alias,
      normalizedAlias: entityAliases.normalizedAlias,
      language: entityAliases.language,
      createdAt: entityAliases.createdAt,
    })
    .from(entityAliases)
    .innerJoin(entities, eq(entities.id, entityAliases.entityId))
    .where(and(eq(entityAliases.entityId, entityId), eq(entities.projectId, projectId)))
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
  return db.select({
    id: projectInvites.id,
    projectId: projectInvites.projectId,
    invitedByUserId: projectInvites.invitedByUserId,
    email: projectInvites.email,
    role: projectInvites.role,
    status: projectInvites.status,
    createdAt: projectInvites.createdAt,
    expiresAt: projectInvites.expiresAt,
  }).from(projectInvites)
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
export async function acceptInvite(inviteId: number, userId: number, userEmail: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(projectInvites)
      .where(eq(projectInvites.id, inviteId))
      .for("update")
      .limit(1);
    if (!invite) throw new Error("Invite not found");
    if (invite.status !== "pending") throw new Error("Invite already used or expired");
    if (invite.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
      throw new Error("Invite was issued to a different email address");
    }
    if (new Date() > invite.expiresAt) {
      await tx.update(projectInvites).set({ status: "expired" }).where(and(
        eq(projectInvites.id, inviteId),
        eq(projectInvites.status, "pending"),
      ));
      throw new Error("Invite has expired");
    }

    const accepted = await tx.update(projectInvites).set({ status: "accepted" }).where(and(
      eq(projectInvites.id, inviteId),
      eq(projectInvites.status, "pending"),
    )).returning({ id: projectInvites.id });
    if (accepted.length !== 1) throw new Error("Invite already used or expired");

    const [existingMember] = await tx.select({ id: projectMembers.id }).from(projectMembers).where(and(
      eq(projectMembers.projectId, invite.projectId),
      eq(projectMembers.userId, userId),
    )).limit(1);
    if (!existingMember) {
      await tx.insert(projectMembers).values({
        projectId: invite.projectId,
        userId,
        role: invite.role,
      });
    }
    return invite;
  });
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

export async function updateUserOpenId(oldOpenId: string, newOpenId: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ openId: newOpenId }).where(eq(users.openId, oldOpenId));
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

function extractValidationLines(
  transcription: { reviewedJson: unknown; rawJson: unknown },
  arabicOnly: boolean,
): Array<{ index: number; text: string }> {
  const json = (transcription.reviewedJson || transcription.rawJson) as Record<string, unknown> | null;
  if (!json) return [];
  let rawText = "";
  for (const field of ["full_transcription_ar", "transcription", "Original_Transcription", "original_transcription"]) {
    const value = json[field];
    if (typeof value === "string" && value.length > 50) {
      rawText = value;
      break;
    }
  }
  if (!rawText) {
    const arabicTest = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    for (const value of Object.values(json)) {
      if (typeof value === "string" && value.length > rawText.length && arabicTest.test(value)) rawText = value;
    }
  }
  if (!rawText) {
    for (const value of Object.values(json)) {
      if (typeof value === "string" && value.length > rawText.length) rawText = value;
    }
  }
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean)
    .map((text, index) => ({ index, text }));
  if (!arabicOnly) return lines;
  const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const englishOnlyRegex = /^[a-zA-Z0-9\s\[\]\(\)\-_:;.,!?'\"]+$/;
  return lines.filter((line) => arabicRegex.test(line.text) && !englishOnlyRegex.test(line.text));
}

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
  const uniqueDocumentIds = Array.from(new Set(data.documentIds));
  const projectDocuments = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.projectId, data.projectId),
    inArray(documents.id, uniqueDocumentIds),
  ));
  if (projectDocuments.length !== uniqueDocumentIds.length) {
    throw new Error("One or more validation documents do not belong to this project");
  }
  const [row] = await db.insert(validationSessions).values({
    projectId: data.projectId,
    title: data.title,
    shareToken: data.shareToken,
    totalDocs: uniqueDocumentIds.length,
    reviewsPerDoc: data.reviewsPerDoc ?? 5,
    documentIds: uniqueDocumentIds,
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

export async function getValidationSessionById(sessionId: number, projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const [session] = await db.select().from(validationSessions).where(and(
    eq(validationSessions.id, sessionId),
    eq(validationSessions.projectId, projectId),
  )).limit(1);
  return session ?? null;
}

export async function closeValidationSession(sessionId: number, projectId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(validationSessions).set({ status: "closed", closedAt: new Date() })
    .where(and(eq(validationSessions.id, sessionId), eq(validationSessions.projectId, projectId)));
}

export async function deleteValidationSession(sessionId: number, projectId: number) {
  const db = await getDb();
  if (!db) return;
  // Cascade: delete reviews -> assignments -> session (FK cascade handles it)
  await db.delete(validationSessions)
    .where(and(eq(validationSessions.id, sessionId), eq(validationSessions.projectId, projectId)));
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
  shareToken: string;
  reviewerUsername: string;
  lineIndex: number;
  lineText: string;
  verdict: "correct" | "incorrect" | "skipped";
  incorrectWords?: Array<{ wordIndex: number; word: string }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    const [session] = await tx.select().from(validationSessions).where(and(
      eq(validationSessions.shareToken, data.shareToken),
      eq(validationSessions.status, "active"),
    )).limit(1);
    if (!session) throw new Error("Validation session not found or closed");

    const [assignment] = await tx.select().from(validationAssignments).where(and(
      eq(validationAssignments.id, data.assignmentId),
      eq(validationAssignments.sessionId, session.id),
      eq(validationAssignments.reviewerUsername, data.reviewerUsername),
      eq(validationAssignments.status, "in_progress"),
    )).limit(1);
    if (!assignment) throw new Error("Validation assignment not found");

    const sessionDocumentIds = session.documentIds as number[];
    if (!sessionDocumentIds.includes(assignment.documentId)) {
      throw new Error("Assignment document is outside the validation session");
    }
    const [projectDocument] = await tx.select({ id: documents.id }).from(documents).where(and(
      eq(documents.id, assignment.documentId),
      eq(documents.projectId, session.projectId),
    )).limit(1);
    if (!projectDocument) throw new Error("Validation document is outside the project");

    const [transcription] = await tx.select({
      reviewedJson: transcriptions.reviewedJson,
      rawJson: transcriptions.rawJson,
    }).from(transcriptions).where(and(
      eq(transcriptions.documentId, assignment.documentId),
      eq(transcriptions.projectId, session.projectId),
    )).orderBy(desc(transcriptions.createdAt)).limit(1);
    if (!transcription) throw new Error("Validation transcription not found");
    const canonicalLine = extractValidationLines(transcription, session.arabicOnly)
      .find((line) => line.index === data.lineIndex);
    if (!canonicalLine) throw new Error("Validation line not found");

    const [existingReview] = await tx.select({ id: validationReviews.id }).from(validationReviews).where(and(
      eq(validationReviews.assignmentId, assignment.id),
      eq(validationReviews.lineIndex, data.lineIndex),
    )).limit(1);
    if (existingReview) return;

    await tx.insert(validationReviews).values({
      assignmentId: assignment.id,
      sessionId: session.id,
      documentId: assignment.documentId,
      reviewerUsername: assignment.reviewerUsername,
      lineIndex: data.lineIndex,
      lineText: canonicalLine.text,
      verdict: data.verdict,
      incorrectWords: data.incorrectWords ?? null,
    });

    await tx.update(validationAssignments).set({
      linesReviewed: sql`${validationAssignments.linesReviewed} + 1`,
      correctCount: data.verdict === "correct"
        ? sql`${validationAssignments.correctCount} + 1`
        : validationAssignments.correctCount,
      incorrectCount: data.verdict === "incorrect"
        ? sql`${validationAssignments.incorrectCount} + 1`
        : validationAssignments.incorrectCount,
    }).where(and(
      eq(validationAssignments.id, assignment.id),
      eq(validationAssignments.sessionId, session.id),
    ));
  });
}

export async function completeAssignment(data: {
  assignmentId: number;
  shareToken: string;
  reviewerUsername: string;
  totalLines: number;
}) {
  const db = await getDb();
  if (!db) return;
  const [session] = await db.select().from(validationSessions).where(and(
    eq(validationSessions.shareToken, data.shareToken),
    eq(validationSessions.status, "active"),
  )).limit(1);
  if (!session) throw new Error("Validation session not found or closed");
  const [assignment] = await db.select().from(validationAssignments).where(and(
    eq(validationAssignments.id, data.assignmentId),
    eq(validationAssignments.sessionId, session.id),
    eq(validationAssignments.reviewerUsername, data.reviewerUsername),
    eq(validationAssignments.status, "in_progress"),
  )).limit(1);
  if (!assignment) throw new Error("Validation assignment not found");
  const [transcription] = await db.select({
    reviewedJson: transcriptions.reviewedJson,
    rawJson: transcriptions.rawJson,
  }).from(transcriptions).where(and(
    eq(transcriptions.documentId, assignment.documentId),
    eq(transcriptions.projectId, session.projectId),
  )).orderBy(desc(transcriptions.createdAt)).limit(1);
  if (!transcription) throw new Error("Validation transcription not found");
  const canonicalTotalLines = extractValidationLines(transcription, session.arabicOnly).length;
  if (assignment.linesReviewed < canonicalTotalLines) {
    throw new Error("Assignment still has unreviewed lines");
  }
  await db.update(validationAssignments).set({
    status: "completed",
    totalLines: canonicalTotalLines,
    completedAt: new Date(),
  }).where(and(
    eq(validationAssignments.id, data.assignmentId),
    eq(validationAssignments.sessionId, session.id),
    eq(validationAssignments.reviewerUsername, data.reviewerUsername),
    eq(validationAssignments.status, "in_progress"),
  ));
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

export async function getValidationStats(sessionId: number, projectId: number) {
  const db = await getDb();
  if (!db) return null;

  const [session] = await db.select().from(validationSessions)
    .where(and(eq(validationSessions.id, sessionId), eq(validationSessions.projectId, projectId)))
    .limit(1);
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

// ─── Activity Log ────────────────────────────────────────────────────────────

export async function logActivity(data: {
  projectId: number;
  userId: number | null;
  action: InsertActivityLog["action"];
  targetType?: string;
  targetId?: number;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(activityLog).values({
      projectId: data.projectId,
      userId: data.userId,
      action: data.action,
      targetType: data.targetType ?? null,
      targetId: data.targetId ?? null,
      metadata: data.metadata ?? null,
    });
  } catch (e) {
    // Activity logging should never break the main flow
    console.error("[ActivityLog] Failed to log:", e);
  }
}

export async function getActivityFeed(projectId: number, opts?: {
  limit?: number;
  offset?: number;
  userId?: number;
  action?: string;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [eq(activityLog.projectId, projectId)];
  if (opts?.userId) conditions.push(eq(activityLog.userId, opts.userId));
  if (opts?.action) conditions.push(sql`${activityLog.action} = ${opts.action}`);

  const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

  const [countResult] = await db.select({ total: count() }).from(activityLog).where(whereClause);
  const total = countResult?.total ?? 0;

  const items = await db
    .select({
      id: activityLog.id,
      userId: activityLog.userId,
      action: activityLog.action,
      targetType: activityLog.targetType,
      targetId: activityLog.targetId,
      metadata: activityLog.metadata,
      createdAt: activityLog.createdAt,
      userName: users.name,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.userId, users.id))
    .where(whereClause)
    .orderBy(desc(activityLog.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total };
}

// ─── Document Assignments (Review Queue) ─────────────────────────────────────

export async function assignDocuments(data: {
  projectId: number;
  documentIds: number[];
  assigneeId: number;
  assignedBy: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const uniqueDocumentIds = Array.from(new Set(data.documentIds));
  const ownedDocuments = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.projectId, data.projectId),
    inArray(documents.id, uniqueDocumentIds),
  ));
  if (ownedDocuments.length !== uniqueDocumentIds.length) {
    throw new Error("One or more documents do not belong to this project");
  }

  const [project] = await db.select({ ownerId: projects.userId }).from(projects)
    .where(eq(projects.id, data.projectId))
    .limit(1);
  const [membership] = await db.select({ id: projectMembers.id }).from(projectMembers).where(and(
    eq(projectMembers.projectId, data.projectId),
    eq(projectMembers.userId, data.assigneeId),
  )).limit(1);
  if (!project || (project.ownerId !== data.assigneeId && !membership)) {
    throw new Error("Assignee is not a project member");
  }

  const values = uniqueDocumentIds.map(docId => ({
    projectId: data.projectId,
    documentId: docId,
    assigneeId: data.assigneeId,
    assignedBy: data.assignedBy,
  }));

  await db.insert(documentAssignments).values(values);
  return { assigned: uniqueDocumentIds.length };
}

export async function getMyQueue(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: documentAssignments.id,
      documentId: documentAssignments.documentId,
      status: documentAssignments.status,
      createdAt: documentAssignments.createdAt,
      completedAt: documentAssignments.completedAt,
      filename: documents.filename,
      docStatus: documents.status,
    })
    .from(documentAssignments)
    .innerJoin(documents, eq(documentAssignments.documentId, documents.id))
    .where(and(
      eq(documentAssignments.projectId, projectId),
      eq(documentAssignments.assigneeId, userId),
    ))
    .orderBy(asc(documentAssignments.createdAt));
}

export async function getProjectAssignments(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: documentAssignments.id,
      documentId: documentAssignments.documentId,
      assigneeId: documentAssignments.assigneeId,
      assignedBy: documentAssignments.assignedBy,
      status: documentAssignments.status,
      createdAt: documentAssignments.createdAt,
      completedAt: documentAssignments.completedAt,
      filename: documents.filename,
      assigneeName: users.name,
    })
    .from(documentAssignments)
    .innerJoin(documents, eq(documentAssignments.documentId, documents.id))
    .innerJoin(users, eq(documentAssignments.assigneeId, users.id))
    .where(eq(documentAssignments.projectId, projectId))
    .orderBy(desc(documentAssignments.createdAt));
}

export async function getDocumentAssignmentById(assignmentId: number, projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const [assignment] = await db.select().from(documentAssignments).where(and(
    eq(documentAssignments.id, assignmentId),
    eq(documentAssignments.projectId, projectId),
  )).limit(1);
  return assignment ?? null;
}

export async function getMergeSuggestionById(suggestionId: number, projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const [suggestion] = await db.select().from(mergeSuggestions).where(and(
    eq(mergeSuggestions.id, suggestionId),
    eq(mergeSuggestions.projectId, projectId),
  )).limit(1);
  return suggestion ?? null;
}

export async function getEntitiesByIds(projectId: number, entityIds: number[]) {
  if (entityIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(entities).where(and(
    eq(entities.projectId, projectId),
    inArray(entities.id, Array.from(new Set(entityIds))),
  ));
}

export async function updateAssignmentStatus(
  assignmentId: number,
  projectId: number,
  status: "pending" | "in_progress" | "completed",
  assigneeId?: number,
) {
  const db = await getDb();
  if (!db) return;
  const updates: Record<string, unknown> = { status };
  if (status === "completed") updates.completedAt = new Date();
  const conditions = [eq(documentAssignments.id, assignmentId), eq(documentAssignments.projectId, projectId)];
  if (assigneeId !== undefined) conditions.push(eq(documentAssignments.assigneeId, assigneeId));
  await db.update(documentAssignments).set(updates).where(and(...conditions));
}

export async function deleteAssignment(assignmentId: number, projectId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(documentAssignments)
    .where(and(eq(documentAssignments.id, assignmentId), eq(documentAssignments.projectId, projectId)));
}

export async function getAssignmentStats(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      assigneeId: documentAssignments.assigneeId,
      assigneeName: users.name,
      status: documentAssignments.status,
    })
    .from(documentAssignments)
    .innerJoin(users, eq(documentAssignments.assigneeId, users.id))
    .where(eq(documentAssignments.projectId, projectId));

  // Aggregate per user
  const stats: Record<number, { assigneeId: number; name: string; pending: number; inProgress: number; completed: number }> = {};
  for (const r of rows) {
    if (!stats[r.assigneeId]) {
      stats[r.assigneeId] = { assigneeId: r.assigneeId, name: r.assigneeName ?? "Unknown", pending: 0, inProgress: 0, completed: 0 };
    }
    if (r.status === "pending") stats[r.assigneeId].pending++;
    else if (r.status === "in_progress") stats[r.assigneeId].inProgress++;
    else if (r.status === "completed") stats[r.assigneeId].completed++;
  }

  return Object.values(stats);
}
