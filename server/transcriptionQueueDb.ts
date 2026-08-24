import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  documents,
  jobs,
  projects,
  transcriptions,
  transcriptionQueueTasks,
  type Document,
  type Job,
  type InsertTranscriptionQueueTask,
  type Project,
  type TranscriptionQueueTask,
} from "../drizzle/schema";
import { getDb } from "./db";

const DEFAULT_MAX_ATTEMPTS = 3;

export interface ClaimedTranscriptionTask {
  task: TranscriptionQueueTask;
  document: Document;
  project: Project;
}

export interface EnqueueTranscriptionResult {
  job: Job | null;
  queued: number;
  alreadyQueued: number;
}

type QueueTransaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

async function refreshParentJob(
  tx: QueueTransaction,
  jobId: number
): Promise<void> {
  await tx.execute(sql`
    UPDATE ${jobs} AS j
    SET
      "completedItems" = stats.terminal_count,
      "progress" = CASE
        WHEN stats.total_count = 0 THEN 0
        ELSE floor((stats.terminal_count::numeric / stats.total_count::numeric) * 100)::integer
      END,
      "status" = CASE
        WHEN stats.terminal_count < stats.total_count THEN 'running'::job_status
        WHEN stats.failed_count > 0 THEN 'failed'::job_status
        ELSE 'completed'::job_status
      END,
      "errorMessage" = CASE
        WHEN stats.terminal_count = stats.total_count AND stats.failed_count > 0
          THEN stats.failed_count::text || ' document(s) failed transcription'
        ELSE NULL
      END,
      "updatedAt" = now()
    FROM (
      SELECT
        count(*)::integer AS total_count,
        count(*) FILTER (WHERE status IN ('completed', 'failed'))::integer AS terminal_count,
        count(*) FILTER (WHERE status = 'failed')::integer AS failed_count
      FROM ${transcriptionQueueTasks}
      WHERE "jobId" = ${jobId}
    ) AS stats
    WHERE j.id = ${jobId}
  `);
}

/**
 * Atomically creates a user-visible batch job and durable per-document tasks.
 * The unique project/document key makes repeated API calls idempotent: an
 * already queued or leased task remains attached to its original job.
 */
export async function enqueueTranscriptionBatch(input: {
  projectId: number;
  documentIds: number[];
  maxAttempts?: number;
}): Promise<EnqueueTranscriptionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const uniqueDocumentIds = Array.from(new Set(input.documentIds));
  if (uniqueDocumentIds.length === 0) {
    return { job: null, queued: 0, alreadyQueued: 0 };
  }

  return db.transaction(async tx => {
    // Lock eligible documents so concurrent enqueue requests cannot both
    // decide they own the same work before the queue upsert.
    const eligibleDocuments = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.projectId, input.projectId),
          inArray(documents.id, uniqueDocumentIds),
          inArray(documents.status, ["pending", "error"])
        )
      )
      .orderBy(asc(documents.uploadedAt))
      .for("update");

    if (eligibleDocuments.length === 0) {
      return { job: null, queued: 0, alreadyQueued: 0 };
    }

    const [job] = await tx
      .insert(jobs)
      .values({
        projectId: input.projectId,
        type: "batch_transcribe",
        status: "queued",
        totalItems: 0,
        completedItems: 0,
        progress: 0,
        metadata: {
          documentIds: eligibleDocuments.map(document => document.id),
        },
      })
      .returning();

    const now = new Date();
    const taskValues: InsertTranscriptionQueueTask[] = eligibleDocuments.map(
      document => ({
        jobId: job.id,
        projectId: input.projectId,
        documentId: document.id,
        status: "queued" as const,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        startedAt: null,
        completedAt: null,
        lastError: null,
        updatedAt: now,
      })
    );
    // Keep each SQL statement comfortably below PostgreSQL's parameter limit
    // for projects with many thousands of pending documents.
    const queuedTasks: TranscriptionQueueTask[] = [];
    for (let offset = 0; offset < taskValues.length; offset += 500) {
      const returned = await tx
        .insert(transcriptionQueueTasks)
        .values(taskValues.slice(offset, offset + 500))
        .onConflictDoUpdate({
          target: [
            transcriptionQueueTasks.projectId,
            transcriptionQueueTasks.documentId,
          ],
          set: {
            jobId: job.id,
            status: "queued",
            attempts: 0,
            maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
            availableAt: sql`now()`,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            startedAt: null,
            completedAt: null,
            lastError: null,
            updatedAt: now,
          },
          setWhere: inArray(transcriptionQueueTasks.status, [
            "completed",
            "failed",
          ]),
        })
        .returning();
      queuedTasks.push(...returned);
    }

    if (queuedTasks.length === 0) {
      await tx.delete(jobs).where(eq(jobs.id, job.id));
      return {
        job: null,
        queued: 0,
        alreadyQueued: eligibleDocuments.length,
      };
    }

    const queuedIds = queuedTasks.map(task => task.documentId);
    await tx
      .update(documents)
      .set({
        status: "pending",
        errorMessage: null,
        processingStartedAt: null,
      })
      .where(
        and(
          eq(documents.projectId, input.projectId),
          inArray(documents.id, queuedIds)
        )
      );

    const [updatedJob] = await tx
      .update(jobs)
      .set({
        totalItems: queuedTasks.length,
        metadata: { documentIds: queuedIds },
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id))
      .returning();

    return {
      job: updatedJob,
      queued: queuedTasks.length,
      alreadyQueued: eligibleDocuments.length - queuedTasks.length,
    };
  });
}

/**
 * Claims one task using a project-row lock plus SKIP LOCKED. Locking the
 * project while counting active leases prevents concurrent worker instances
 * from exceeding the configured per-project concurrency.
 */
export async function claimTranscriptionTask(input: {
  workerId: string;
  leaseMs: number;
  perProjectConcurrency: number;
}): Promise<ClaimedTranscriptionTask | null> {
  const db = await getDb();
  if (!db) return null;

  return db.transaction(async tx => {
    const projectResult = await tx.execute(sql`
      SELECT p.id
      FROM ${projects} AS p
      WHERE EXISTS (
        SELECT 1
        FROM ${transcriptionQueueTasks} AS queued
        WHERE queued."projectId" = p.id
          AND queued.status = 'queued'
          AND queued."availableAt" <= now()
      )
      AND (
        SELECT count(*)
        FROM ${transcriptionQueueTasks} AS active
        WHERE active."projectId" = p.id
          AND active.status = 'running'
          AND active."leaseExpiresAt" > now()
      ) < ${Math.max(1, input.perProjectConcurrency)}
      ORDER BY (
        SELECT min(queued."availableAt")
        FROM ${transcriptionQueueTasks} AS queued
        WHERE queued."projectId" = p.id
          AND queued.status = 'queued'
      ), p.id
      FOR UPDATE OF p SKIP LOCKED
      LIMIT 1
    `);
    const projectId = rowsFromResult<{ id: number }>(projectResult)[0]?.id;
    if (!projectId) return null;

    const [candidate] = await tx
      .select()
      .from(transcriptionQueueTasks)
      .where(
        and(
          eq(transcriptionQueueTasks.projectId, projectId),
          eq(transcriptionQueueTasks.status, "queued"),
          sql`${transcriptionQueueTasks.availableAt} <= now()`
        )
      )
      .orderBy(
        asc(transcriptionQueueTasks.availableAt),
        asc(transcriptionQueueTasks.createdAt)
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const now = new Date();
    const [task] = await tx
      .update(transcriptionQueueTasks)
      .set({
        status: "running",
        attempts: sql`${transcriptionQueueTasks.attempts} + 1`,
        leaseOwner: input.workerId,
        leaseExpiresAt: sql`now() + (${input.leaseMs} * interval '1 millisecond')`,
        heartbeatAt: sql`now()`,
        startedAt: sql`now()`,
        completedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(transcriptionQueueTasks.id, candidate.id),
          eq(transcriptionQueueTasks.status, "queued")
        )
      )
      .returning();
    if (!task) return null;

    const [document] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, task.documentId),
          eq(documents.projectId, task.projectId)
        )
      )
      .limit(1);
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);

    if (!document || !project) {
      await tx
        .update(transcriptionQueueTasks)
        .set({
          status: "failed",
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: now,
          lastError:
            "Queue task references a missing or cross-project document",
          updatedAt: now,
        })
        .where(eq(transcriptionQueueTasks.id, task.id));
      await refreshParentJob(tx, task.jobId);
      return null;
    }

    await tx
      .update(documents)
      .set({
        status: "processing",
        processingStartedAt: task.startedAt,
        processedAt: null,
        errorMessage: null,
      })
      .where(
        and(eq(documents.id, document.id), eq(documents.projectId, project.id))
      );
    await tx
      .update(jobs)
      .set({ status: "running", updatedAt: now })
      .where(eq(jobs.id, task.jobId));

    return {
      task,
      document: {
        ...document,
        status: "processing",
        processingStartedAt: task.startedAt,
      },
      project,
    };
  });
}

export async function heartbeatTranscriptionTask(input: {
  taskId: number;
  workerId: string;
  leaseMs: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const now = new Date();
  const rows = await db
    .update(transcriptionQueueTasks)
    .set({
      heartbeatAt: sql`now()`,
      leaseExpiresAt: sql`now() + (${input.leaseMs} * interval '1 millisecond')`,
      updatedAt: now,
    })
    .where(
      and(
        eq(transcriptionQueueTasks.id, input.taskId),
        eq(transcriptionQueueTasks.status, "running"),
        eq(transcriptionQueueTasks.leaseOwner, input.workerId)
      )
    )
    .returning({ id: transcriptionQueueTasks.id });
  return rows.length === 1;
}

/** Persists the transcription and completes the lease in one transaction. */
export async function completeTranscriptionTask(input: {
  taskId: number;
  workerId: string;
  modelUsed: string;
  rawJson: Record<string, unknown>;
  originalText?: string | null;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [task] = await tx
      .select()
      .from(transcriptionQueueTasks)
      .where(eq(transcriptionQueueTasks.id, input.taskId))
      .limit(1)
      .for("update");
    if (
      !task ||
      task.status !== "running" ||
      task.leaseOwner !== input.workerId
    )
      return false;

    const [document] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, task.documentId),
          eq(documents.projectId, task.projectId)
        )
      )
      .limit(1)
      .for("update");
    if (!document)
      throw new Error("Queue task document no longer exists in its project");

    await tx.insert(transcriptions).values({
      documentId: task.documentId,
      projectId: task.projectId,
      modelUsed: input.modelUsed,
      rawJson: input.rawJson,
      originalText: input.originalText ?? null,
    });

    const now = new Date();
    await tx
      .update(documents)
      .set({
        status: "needs_review",
        processingStartedAt: null,
        processedAt: now,
        errorMessage: null,
      })
      .where(
        and(
          eq(documents.id, task.documentId),
          eq(documents.projectId, task.projectId)
        )
      );
    await tx
      .update(transcriptionQueueTasks)
      .set({
        status: "completed",
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(transcriptionQueueTasks.id, task.id));
    await refreshParentJob(tx, task.jobId);
    return true;
  });
}

export async function failTranscriptionTask(input: {
  taskId: number;
  workerId: string;
  error: string;
  retryable: boolean;
  retryAt: Date;
}): Promise<"retried" | "failed" | "lease_lost"> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [task] = await tx
      .select()
      .from(transcriptionQueueTasks)
      .where(eq(transcriptionQueueTasks.id, input.taskId))
      .limit(1)
      .for("update");
    if (
      !task ||
      task.status !== "running" ||
      task.leaseOwner !== input.workerId
    )
      return "lease_lost" as const;

    const now = new Date();
    const shouldRetry = input.retryable && task.attempts < task.maxAttempts;
    await tx
      .update(transcriptionQueueTasks)
      .set({
        status: shouldRetry ? "queued" : "failed",
        availableAt: shouldRetry ? input.retryAt : task.availableAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: shouldRetry ? null : now,
        lastError: input.error.slice(0, 10_000),
        updatedAt: now,
      })
      .where(eq(transcriptionQueueTasks.id, task.id));
    await tx
      .update(documents)
      .set({
        status: shouldRetry ? "pending" : "error",
        processingStartedAt: null,
        processedAt: shouldRetry ? null : now,
        errorMessage: shouldRetry ? null : input.error.slice(0, 10_000),
      })
      .where(
        and(
          eq(documents.id, task.documentId),
          eq(documents.projectId, task.projectId)
        )
      );
    await refreshParentJob(tx, task.jobId);
    return shouldRetry ? ("retried" as const) : ("failed" as const);
  });
}

/** Requeues expired leases after a crash, or exhausts them at max attempts. */
export async function recoverExpiredTranscriptionTasks(
  now?: Date
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return db.transaction(async tx => {
    const expired = await tx
      .select()
      .from(transcriptionQueueTasks)
      .where(
        and(
          eq(transcriptionQueueTasks.status, "running"),
          now
            ? lte(transcriptionQueueTasks.leaseExpiresAt, now)
            : sql`${transcriptionQueueTasks.leaseExpiresAt} <= now()`
        )
      )
      .for("update", { skipLocked: true });

    const jobIds = new Set<number>();
    for (const task of expired) {
      const exhausted = task.attempts >= task.maxAttempts;
      const recoveryError =
        task.lastError ?? "Worker lease expired before completion";
      await tx
        .update(transcriptionQueueTasks)
        .set({
          status: exhausted ? "failed" : "queued",
          availableAt: sql`now()`,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: exhausted ? sql`now()` : null,
          lastError: recoveryError,
          updatedAt: sql`now()`,
        })
        .where(eq(transcriptionQueueTasks.id, task.id));
      await tx
        .update(documents)
        .set({
          status: exhausted ? "error" : "pending",
          processingStartedAt: null,
          processedAt: exhausted ? sql`now()` : null,
          errorMessage: exhausted ? recoveryError : null,
        })
        .where(
          and(
            eq(documents.id, task.documentId),
            eq(documents.projectId, task.projectId)
          )
        );
      jobIds.add(task.jobId);
    }
    for (const jobId of Array.from(jobIds)) await refreshParentJob(tx, jobId);
    return expired.length;
  });
}

/** Releases leases owned by this process if graceful shutdown times out. */
export async function releaseWorkerTranscriptionTasks(
  workerId: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return db.transaction(async tx => {
    const owned = await tx
      .select()
      .from(transcriptionQueueTasks)
      .where(
        and(
          eq(transcriptionQueueTasks.status, "running"),
          eq(transcriptionQueueTasks.leaseOwner, workerId)
        )
      )
      .for("update", { skipLocked: true });
    if (owned.length === 0) return 0;

    const now = new Date();
    const jobIds = new Set<number>();
    for (const task of owned) {
      const exhausted = task.attempts >= task.maxAttempts;
      const shutdownError = "Worker shut down before task completion";
      await tx
        .update(transcriptionQueueTasks)
        .set({
          status: exhausted ? "failed" : "queued",
          availableAt: sql`now()`,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: exhausted ? sql`now()` : null,
          lastError: shutdownError,
          updatedAt: now,
        })
        .where(eq(transcriptionQueueTasks.id, task.id));
      await tx
        .update(documents)
        .set({
          status: exhausted ? "error" : "pending",
          processingStartedAt: null,
          processedAt: exhausted ? sql`now()` : null,
          errorMessage: exhausted ? shutdownError : null,
        })
        .where(
          and(
            eq(documents.id, task.documentId),
            eq(documents.projectId, task.projectId)
          )
        );
      jobIds.add(task.jobId);
    }
    for (const jobId of Array.from(jobIds)) await refreshParentJob(tx, jobId);
    return owned.length;
  });
}
