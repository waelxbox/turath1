import { and, count, desc, eq, inArray } from "drizzle-orm";
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

export async function listVisualAssets(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(visualAssets)
    .where(eq(visualAssets.projectId, projectId))
    .orderBy(desc(visualAssets.createdAt));
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

export async function updateVraRecord(input: {
  projectId: number;
  recordId: string;
  userId: number;
  title?: string;
  localIdentifier?: string | null;
  reviewedJson?: Record<string, unknown>;
  status?: "draft" | "needs_review" | "approved" | "archived";
  changeSummary?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(vraRecords)
      .where(and(eq(vraRecords.projectId, input.projectId), eq(vraRecords.id, input.recordId)))
      .limit(1);
    if (!current) return undefined;
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
