import { and, count, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";
import {
  projects,
  visualAssets,
  visualProjectModes,
  vraRecordRelations,
  vraRecordRevisions,
  vraRecords,
  type InsertVisualAsset,
  type InsertVraRecord,
  type InsertVraRecordRelation,
} from "../../drizzle/schema";
import {
  acceptSuggestedFields,
  rejectSuggestedFields,
  type SuggestionField,
} from "./suggestionReview";
import { VraRevisionConflictError } from "./recordConcurrency";
import { getDb } from "../db";

export async function getVisualProjectMode(projectId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(visualProjectModes)
    .where(eq(visualProjectModes.projectId, projectId))
    .limit(1);
  return rows[0];
}

export async function getVisualProjectIds(projectIds: number[]): Promise<Set<number>> {
  if (projectIds.length === 0) return new Set();
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({ projectId: visualProjectModes.projectId })
    .from(visualProjectModes)
    .where(inArray(visualProjectModes.projectId, projectIds));
  return new Set(rows.map(row => row.projectId));
}

export async function createVisualProject(input: {
  userId: number;
  name: string;
  description?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [project] = await tx
      .insert(projects)
      .values({
        userId: input.userId,
        name: input.name,
        description: input.description ?? null,
        status: "active",
      })
      .returning();
    await tx.insert(visualProjectModes).values({
      projectId: project.id,
      archiveMode: "visual_vra",
    });
    return { ...project, archiveMode: "visual_vra" as const };
  });
}

export async function createVisualAsset(input: InsertVisualAsset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [asset] = await db.insert(visualAssets).values(input).returning();
  return asset;
}

export async function updateVisualAsset(
  projectId: number,
  assetId: string,
  data: Partial<Pick<InsertVisualAsset,
    "displayKey" | "thumbnailKey" | "technicalMetadata" | "status" | "errorMessage"
  >>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [asset] = await db
    .update(visualAssets)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(visualAssets.projectId, projectId), eq(visualAssets.id, assetId)))
    .returning();
  return asset;
}

export async function getVisualAsset(projectId: number, assetId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(visualAssets)
    .where(and(eq(visualAssets.projectId, projectId), eq(visualAssets.id, assetId)))
    .limit(1);
  return rows[0];
}

export async function getVisualAssetsByIds(projectId: number, assetIds: string[]) {
  if (assetIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(visualAssets).where(and(
    eq(visualAssets.projectId, projectId),
    inArray(visualAssets.id, assetIds),
  ));
}

export async function listVisualAssets(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(visualAssets)
    .where(eq(visualAssets.projectId, projectId))
    .orderBy(desc(visualAssets.createdAt));
}

type PageCursor = { createdAt: string; id: string };

export async function listVisualAssetsPage(input: {
  projectId: number;
  status?: "uploaded" | "ready" | "failed" | "deletion_pending";
  cursor?: PageCursor;
  limit: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], nextCursor: null, total: 0 };
  const conditions = [eq(visualAssets.projectId, input.projectId)];
  if (input.status) conditions.push(eq(visualAssets.status, input.status));
  if (input.cursor) {
    const cursorDate = new Date(input.cursor.createdAt);
    conditions.push(or(
      lt(visualAssets.createdAt, cursorDate),
      and(eq(visualAssets.createdAt, cursorDate), lt(visualAssets.id, input.cursor.id)),
    )!);
  }
  const [rows, totals] = await Promise.all([
    db.select().from(visualAssets).where(and(...conditions)).orderBy(desc(visualAssets.createdAt), desc(visualAssets.id)).limit(input.limit + 1),
    db.select({ value: count() }).from(visualAssets).where(eq(visualAssets.projectId, input.projectId)),
  ]);
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);
  return {
    items,
    total: Number(totals[0]?.value ?? 0),
    nextCursor: hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
  };
}

export async function findVisualAssetByHash(projectId: number, sha256: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(visualAssets)
    .where(and(eq(visualAssets.projectId, projectId), eq(visualAssets.sha256, sha256)))
    .limit(1);
  return rows[0];
}

export async function createVraRecord(input: InsertVraRecord) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [record] = await tx.insert(vraRecords).values(input).returning();
    await tx.insert(vraRecordRevisions).values({
      projectId: record.projectId,
      recordId: record.id,
      revision: record.revision,
      snapshotJson: record.reviewedJson,
      changeSummary: "Record created",
      createdByUserId: record.createdByUserId,
    });
    return record;
  });
}

export async function getVraRecord(projectId: number, recordId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vraRecords)
    .where(and(eq(vraRecords.projectId, projectId), eq(vraRecords.id, recordId)))
    .limit(1);
  return rows[0];
}

export async function getImageRecordByAssetId(projectId: number, assetId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vraRecords)
    .where(and(
      eq(vraRecords.projectId, projectId),
      eq(vraRecords.assetId, assetId),
      eq(vraRecords.recordType, "image"),
    ))
    .orderBy(desc(vraRecords.updatedAt))
    .limit(1);
  return rows[0];
}

export async function listVraRecords(input: {
  projectId: number;
  recordType?: "collection" | "work" | "image";
  status?: "draft" | "needs_review" | "approved" | "archived";
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(vraRecords.projectId, input.projectId)];
  if (input.recordType) conditions.push(eq(vraRecords.recordType, input.recordType));
  if (input.status) conditions.push(eq(vraRecords.status, input.status));
  return db
    .select()
    .from(vraRecords)
    .where(and(...conditions))
    .orderBy(desc(vraRecords.updatedAt));
}

export async function listVraRecordsPage(input: {
  projectId: number;
  recordType?: "collection" | "work" | "image";
  status?: "draft" | "needs_review" | "approved" | "archived";
  search?: string;
  cursor?: PageCursor;
  limit: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], nextCursor: null, total: 0 };
  const baseConditions = [eq(vraRecords.projectId, input.projectId)];
  if (input.recordType) baseConditions.push(eq(vraRecords.recordType, input.recordType));
  if (input.status) baseConditions.push(eq(vraRecords.status, input.status));
  if (input.search?.trim()) baseConditions.push(ilike(vraRecords.title, `%${input.search.trim().replace(/[%_]/g, "")}%`));
  const pageConditions = [...baseConditions];
  if (input.cursor) {
    const cursorDate = new Date(input.cursor.createdAt);
    pageConditions.push(or(
      lt(vraRecords.updatedAt, cursorDate),
      and(eq(vraRecords.updatedAt, cursorDate), lt(vraRecords.id, input.cursor.id)),
    )!);
  }
  const [rows, totals] = await Promise.all([
    db.select().from(vraRecords).where(and(...pageConditions)).orderBy(desc(vraRecords.updatedAt), desc(vraRecords.id)).limit(input.limit + 1),
    db.select({ value: count() }).from(vraRecords).where(and(...baseConditions)),
  ]);
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);
  return {
    items,
    total: Number(totals[0]?.value ?? 0),
    nextCursor: hasMore && last ? { createdAt: last.updatedAt.toISOString(), id: last.id } : null,
  };
}

export async function listVraRecordIds(input: {
  projectId: number;
  recordType?: "collection" | "work" | "image";
  status?: "draft" | "needs_review" | "approved" | "archived";
  search?: string;
  limit: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(vraRecords.projectId, input.projectId)];
  if (input.recordType) conditions.push(eq(vraRecords.recordType, input.recordType));
  if (input.status) conditions.push(eq(vraRecords.status, input.status));
  if (input.search?.trim()) conditions.push(ilike(vraRecords.title, `%${input.search.trim().replace(/[%_]/g, "")}%`));
  return db
    .select({ id: vraRecords.id, recordType: vraRecords.recordType, status: vraRecords.status })
    .from(vraRecords)
    .where(and(...conditions))
    .orderBy(desc(vraRecords.updatedAt), desc(vraRecords.id))
    .limit(input.limit);
}

export async function getVraRecordsByIds(projectId: number, recordIds: string[]) {
  if (recordIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vraRecords).where(and(
    eq(vraRecords.projectId, projectId),
    inArray(vraRecords.id, recordIds),
  ));
}

export async function updateVraRecord(input: {
  projectId: number;
  recordId: string;
  userId: number;
  title?: string;
  localIdentifier?: string | null;
  reviewedJson?: Record<string, unknown>;
  status?: "draft" | "needs_review" | "approved" | "archived";
  changeSummary?: string;
  expectedRevision?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(vraRecords)
      .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
      .for("update")
      .limit(1);
    if (!current) return undefined;
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new VraRevisionConflictError(current.revision);
    }
    const nextRevision = current.revision + 1;
    const approved = input.status === "approved";
    const [updated] = await tx
      .update(vraRecords)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.localIdentifier !== undefined ? { localIdentifier: input.localIdentifier } : {}),
        ...(input.reviewedJson !== undefined ? { reviewedJson: input.reviewedJson } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        revision: nextRevision,
        updatedByUserId: input.userId,
        ...(approved ? { approvedByUserId: input.userId, approvedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
      .returning();
    await tx.insert(vraRecordRevisions).values({
      projectId: updated.projectId,
      recordId: updated.id,
      revision: updated.revision,
      snapshotJson: updated.reviewedJson,
      changeSummary: input.changeSummary ?? "Record updated",
      createdByUserId: input.userId,
    });
    return updated;
  });
}

export async function bulkSetVraRecordStatus(input: {
  projectId: number;
  recordIds: string[];
  userId: number;
  status: "draft" | "needs_review" | "approved" | "archived";
}) {
  const uniqueRecordIds = Array.from(new Set(input.recordIds));
  if (uniqueRecordIds.length !== input.recordIds.length) return undefined;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const currentRecords = await tx
      .select()
      .from(vraRecords)
      .where(and(
        eq(vraRecords.projectId, input.projectId),
        inArray(vraRecords.id, uniqueRecordIds),
      ))
      .for("update");
    if (currentRecords.length !== uniqueRecordIds.length) return undefined;

    const changedAt = new Date();
    for (const current of currentRecords) {
      const nextRevision = current.revision + 1;
      const [updated] = await tx
        .update(vraRecords)
        .set({
          status: input.status,
          revision: nextRevision,
          updatedByUserId: input.userId,
          ...(input.status === "approved" ? { approvedByUserId: input.userId, approvedAt: changedAt } : {}),
          updatedAt: changedAt,
        })
        .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, current.id)))
        .returning();
      await tx.insert(vraRecordRevisions).values({
        projectId: updated.projectId,
        recordId: updated.id,
        revision: updated.revision,
        snapshotJson: updated.reviewedJson,
        changeSummary: `Bulk status change to ${input.status}`,
        createdByUserId: input.userId,
      });
    }
    return { updated: currentRecords.length };
  });
}

export async function acceptVraSuggestionFields(input: {
  projectId: number;
  recordId: string;
  userId: number;
  acceptedFields: SuggestionField[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(vraRecords)
      .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
      .for("update")
      .limit(1);
    if (!current) return undefined;

    const review = acceptSuggestedFields({
      title: current.title,
      reviewedJson: current.reviewedJson,
      suggestions: current.aiSuggestedJson,
      provenance: current.suggestionProvenance,
      acceptedFields: input.acceptedFields,
      userId: input.userId,
      reviewedAt: new Date().toISOString(),
    });
    if (review.appliedFields.length === 0) return current;

    const nextRevision = current.revision + 1;
    const [updated] = await tx
      .update(vraRecords)
      .set({
        title: review.title,
        reviewedJson: review.reviewedJson,
        suggestionProvenance: review.suggestionProvenance,
        status: current.status === "archived" ? "archived" : "needs_review",
        revision: nextRevision,
        updatedByUserId: input.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
      .returning();
    await tx.insert(vraRecordRevisions).values({
      projectId: updated.projectId,
      recordId: updated.id,
      revision: updated.revision,
      snapshotJson: updated.reviewedJson,
      changeSummary: `Accepted AI suggestions: ${review.appliedFields.join(", ")}`,
      createdByUserId: input.userId,
    });
    return updated;
  });
}

export async function rejectVraSuggestionFields(input: {
  projectId: number;
  recordId: string;
  userId: number;
  rejectedFields: SuggestionField[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(vraRecords)
      .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
      .for("update")
      .limit(1);
    if (!current) return undefined;

    const review = rejectSuggestedFields({
      provenance: current.suggestionProvenance,
      rejectedFields: input.rejectedFields,
      userId: input.userId,
      reviewedAt: new Date().toISOString(),
    });
    if (review.appliedFields.length === 0) return current;
    const nextRevision = current.revision + 1;
    const [updated] = await tx
      .update(vraRecords)
      .set({
        suggestionProvenance: review.suggestionProvenance,
        revision: nextRevision,
        updatedByUserId: input.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
      .returning();
    await tx.insert(vraRecordRevisions).values({
      projectId: updated.projectId,
      recordId: updated.id,
      revision: updated.revision,
      snapshotJson: updated.reviewedJson,
      changeSummary: `Rejected AI suggestions: ${review.appliedFields.join(", ")}`,
      createdByUserId: input.userId,
    });
    return updated;
  });
}

export async function updateVraSuggestions(input: {
  projectId: number;
  recordId: string;
  aiSuggestedJson: Record<string, unknown>;
  suggestionProvenance: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [record] = await db
    .update(vraRecords)
    .set({
      aiSuggestedJson: input.aiSuggestedJson,
      suggestionProvenance: input.suggestionProvenance,
      status: "needs_review",
      updatedAt: new Date(),
    })
    .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
    .returning();
  return record;
}

export async function createVraRelation(input: InsertVraRecordRelation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [relation] = await db.insert(vraRecordRelations).values(input).returning();
  return relation;
}

export async function listVraRelations(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(vraRecordRelations)
    .where(eq(vraRecordRelations.projectId, projectId))
    .orderBy(desc(vraRecordRelations.createdAt));
}

export async function linkImageRecordsToWork(input: {
  projectId: number;
  workRecordId: string;
  imageRecordIds: string[];
  userId: number;
  evidenceJson?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.imageRecordIds.length === 0) return { linked: 0 };
  const images = await getVraRecordsByIds(input.projectId, input.imageRecordIds);
  if (images.length !== input.imageRecordIds.length || images.some(record => record.recordType !== "image")) {
    throw new Error("Every selected record must be an Image record in this project");
  }
  await db.transaction(async tx => {
    for (const image of images) {
      await tx.insert(vraRecordRelations).values({
        projectId: input.projectId,
        sourceRecordId: input.workRecordId,
        targetRecordId: image.id,
        relationType: "has visual representation",
        status: "approved",
        evidenceJson: input.evidenceJson ?? {},
        createdByUserId: input.userId,
        approvedByUserId: input.userId,
      }).onConflictDoNothing();
    }
  });
  return { linked: images.length };
}

export async function unlinkImageRecordsFromWork(input: {
  projectId: number;
  workRecordId: string;
  imageRecordIds: string[];
}) {
  if (input.imageRecordIds.length === 0) return { unlinked: 0 };
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const deleted = await db.delete(vraRecordRelations).where(and(
    eq(vraRecordRelations.projectId, input.projectId),
    eq(vraRecordRelations.sourceRecordId, input.workRecordId),
    eq(vraRecordRelations.relationType, "has visual representation"),
    inArray(vraRecordRelations.targetRecordId, input.imageRecordIds),
  )).returning({ id: vraRecordRelations.id });
  return { unlinked: deleted.length };
}

export async function getVisualArchiveStats(projectId: number) {
  const db = await getDb();
  if (!db) return { assets: 0, collections: 0, works: 0, images: 0, needsReview: 0 };
  const [assetCount] = await db
    .select({ value: count() })
    .from(visualAssets)
    .where(eq(visualAssets.projectId, projectId));
  const recordCounts = await db
    .select({ type: vraRecords.recordType, status: vraRecords.status, value: count() })
    .from(vraRecords)
    .where(eq(vraRecords.projectId, projectId))
    .groupBy(vraRecords.recordType, vraRecords.status);
  const totalByType = (type: "collection" | "work" | "image") =>
    recordCounts.filter(row => row.type === type).reduce((sum, row) => sum + Number(row.value), 0);
  return {
    assets: Number(assetCount?.value ?? 0),
    collections: totalByType("collection"),
    works: totalByType("work"),
    images: totalByType("image"),
    needsReview: recordCounts
      .filter(row => row.status === "needs_review")
      .reduce((sum, row) => sum + Number(row.value), 0),
  };
}
