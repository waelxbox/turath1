import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./db", () => ({
  getDb: async () => testState.db,
}));

import {
  claimTranscriptionTask,
  completeTranscriptionTask,
  enqueueTranscriptionBatch,
  failTranscriptionTask,
  heartbeatTranscriptionTask,
  recoverExpiredTranscriptionTasks,
  releaseWorkerTranscriptionTasks,
} from "./transcriptionQueueDb";

let client: PGlite;

beforeEach(async () => {
  client = new PGlite();
  testState.db = drizzle(client);
  await client.exec(`
    CREATE TYPE project_status AS ENUM ('onboarding', 'validating', 'active', 'archived');
    CREATE TYPE pipeline_type AS ENUM ('single_pass', 'two_pass');
    CREATE TYPE document_status AS ENUM ('pending', 'processing', 'needs_review', 'reviewed', 'flagged', 'error');
    CREATE TYPE job_type AS ENUM ('transcribe', 'batch_transcribe', 'validate_config', 'entity_merge');
    CREATE TYPE job_status AS ENUM ('queued', 'running', 'completed', 'failed');

    CREATE TABLE projects (
      id serial PRIMARY KEY,
      "userId" integer NOT NULL,
      name varchar(255) NOT NULL,
      description text,
      status project_status DEFAULT 'active' NOT NULL,
      "modelProvider" varchar(64) DEFAULT 'gemini' NOT NULL,
      "modelName" varchar(128) DEFAULT 'gemini-test' NOT NULL,
      "pipelineType" pipeline_type DEFAULT 'single_pass' NOT NULL,
      temperature real DEFAULT 0.1 NOT NULL,
      "maxTokens" integer DEFAULT 4096 NOT NULL,
      "systemPrompt" text,
      "pass2Prompt" text,
      "jsonSchema" jsonb,
      glossary jsonb,
      "postProcessing" jsonb,
      "outputFormats" jsonb,
      "onboardingReasoning" text,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE documents (
      id serial PRIMARY KEY,
      "projectId" integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename varchar(255) NOT NULL,
      "storagePath" text NOT NULL,
      "storageUrl" text,
      "mimeType" varchar(64) DEFAULT 'image/jpeg',
      "fileSizeBytes" integer,
      status document_status DEFAULT 'pending' NOT NULL,
      "errorMessage" text,
      "groupId" integer,
      "pageNumber" integer,
      "uploadedAt" timestamp DEFAULT now() NOT NULL,
      "processedAt" timestamp
    );

    CREATE TABLE jobs (
      id serial PRIMARY KEY,
      "projectId" integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      "documentId" integer REFERENCES documents(id) ON DELETE CASCADE,
      type job_type NOT NULL,
      status job_status DEFAULT 'queued' NOT NULL,
      progress integer DEFAULT 0,
      "totalItems" integer DEFAULT 1,
      "completedItems" integer DEFAULT 0,
      "errorMessage" text,
      metadata jsonb,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE transcriptions (
      id serial PRIMARY KEY,
      "documentId" integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      "projectId" integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      "modelUsed" varchar(128) NOT NULL,
      "rawJson" jsonb NOT NULL,
      "reviewedJson" jsonb,
      "originalText" text,
      "confidenceNotes" text,
      "reviewedAt" timestamp,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );

    INSERT INTO projects (id, "userId", name) VALUES (1, 1, 'Queue test');
    INSERT INTO documents (id, "projectId", filename, "storagePath") VALUES
      (10, 1, '10.jpg', 'projects/1/10.jpg'),
      (11, 1, '11.jpg', 'projects/1/11.jpg');
  `);

  const migration = readFileSync(
    new URL("../drizzle/0011_durable_transcription_queue.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.exec(statement);
  }
});

afterEach(async () => {
  await client.close();
});

describe("Postgres-backed transcription queue", () => {
  it("makes repeated enqueue calls idempotent and returns the actual job ID", async () => {
    const first = await enqueueTranscriptionBatch({
      projectId: 1,
      documentIds: [10, 10],
    });
    const duplicate = await enqueueTranscriptionBatch({
      projectId: 1,
      documentIds: [10],
    });

    expect(first).toMatchObject({ queued: 1, alreadyQueued: 0 });
    expect(first.job?.id).toEqual(expect.any(Number));
    expect(duplicate).toMatchObject({ job: null, queued: 0, alreadyQueued: 1 });
    const rows = await client.query(
      `SELECT "jobId", "documentId" FROM transcription_queue_tasks`
    );
    expect(rows.rows).toEqual([{ jobId: first.job?.id, documentId: 10 }]);
  });

  it("claims each task once and enforces project concurrency", async () => {
    await enqueueTranscriptionBatch({ projectId: 1, documentIds: [10, 11] });

    const first = await claimTranscriptionTask({
      workerId: "worker-a",
      leaseMs: 60_000,
      perProjectConcurrency: 1,
    });
    const blocked = await claimTranscriptionTask({
      workerId: "worker-b",
      leaseMs: 60_000,
      perProjectConcurrency: 1,
    });

    expect(first?.task).toMatchObject({
      documentId: 10,
      attempts: 1,
      leaseOwner: "worker-a",
      status: "running",
    });
    expect(blocked).toBeNull();
    expect(
      await heartbeatTranscriptionTask({
        taskId: first!.task.id,
        workerId: "worker-b",
        leaseMs: 60_000,
      })
    ).toBe(false);
    expect(
      await heartbeatTranscriptionTask({
        taskId: first!.task.id,
        workerId: "worker-a",
        leaseMs: 60_000,
      })
    ).toBe(true);
  });

  it("requeues a transient failure and increments attempts on the next claim", async () => {
    await enqueueTranscriptionBatch({ projectId: 1, documentIds: [10] });
    const first = await claimTranscriptionTask({
      workerId: "worker-a",
      leaseMs: 60_000,
      perProjectConcurrency: 1,
    });
    const retried = await failTranscriptionTask({
      taskId: first!.task.id,
      workerId: "worker-a",
      error: "HTTP 503",
      retryable: true,
      retryAt: new Date(0),
    });
    const second = await claimTranscriptionTask({
      workerId: "worker-b",
      leaseMs: 60_000,
      perProjectConcurrency: 1,
    });

    expect(retried).toBe("retried");
    expect(second?.task).toMatchObject({
      id: first!.task.id,
      attempts: 2,
      leaseOwner: "worker-b",
    });
  });

  it("recovers an expired lease so a replacement worker can resume it", async () => {
    await enqueueTranscriptionBatch({ projectId: 1, documentIds: [10] });
    const first = await claimTranscriptionTask({
      workerId: "dead-worker",
      leaseMs: 10,
      perProjectConcurrency: 1,
    });
    const recovered = await recoverExpiredTranscriptionTasks(
      new Date(Date.now() + 20_000)
    );
    const replacement = await claimTranscriptionTask({
      workerId: "replacement",
      leaseMs: 60_000,
      perProjectConcurrency: 1,
    });

    expect(recovered).toBe(1);
    expect(replacement?.task).toMatchObject({
      id: first!.task.id,
      attempts: 2,
      leaseOwner: "replacement",
    });
  });

  it("rejects a stale worker result and commits exactly once for the live lease", async () => {
    const batch = await enqueueTranscriptionBatch({
      projectId: 1,
      documentIds: [10],
    });
    const stale = await claimTranscriptionTask({
      workerId: "stale",
      leaseMs: 10,
      perProjectConcurrency: 1,
    });
    await recoverExpiredTranscriptionTasks(new Date(Date.now() + 20_000));
    const live = await claimTranscriptionTask({
      workerId: "live",
      leaseMs: 60_000,
      perProjectConcurrency: 1,
    });

    const staleCommit = await completeTranscriptionTask({
      taskId: stale!.task.id,
      workerId: "stale",
      modelUsed: "test",
      rawJson: { transcription: "stale" },
    });
    const liveCommit = await completeTranscriptionTask({
      taskId: live!.task.id,
      workerId: "live",
      modelUsed: "test",
      rawJson: { transcription: "live" },
    });

    expect(staleCommit).toBe(false);
    expect(liveCommit).toBe(true);
    expect(
      (
        await client.query(
          `SELECT count(*)::integer AS count FROM transcriptions`
        )
      ).rows
    ).toEqual([{ count: 1 }]);
    expect(
      (await client.query(`SELECT status FROM documents WHERE id = 10`)).rows
    ).toEqual([{ status: "needs_review" }]);
    expect(
      (
        await client.query(`SELECT status, progress FROM jobs WHERE id = $1`, [
          batch.job!.id,
        ])
      ).rows
    ).toEqual([{ status: "completed", progress: 100 }]);
  });

  it("does not requeue an exhausted attempt during forced shutdown", async () => {
    const batch = await enqueueTranscriptionBatch({
      projectId: 1,
      documentIds: [10],
      maxAttempts: 1,
    });
    await claimTranscriptionTask({
      workerId: "terminating",
      leaseMs: 60_000,
      perProjectConcurrency: 1,
    });

    expect(await releaseWorkerTranscriptionTasks("terminating")).toBe(1);
    expect(
      await claimTranscriptionTask({
        workerId: "replacement",
        leaseMs: 60_000,
        perProjectConcurrency: 1,
      })
    ).toBeNull();
    expect(
      (
        await client.query(
          `SELECT status, attempts FROM transcription_queue_tasks`
        )
      ).rows
    ).toEqual([{ status: "failed", attempts: 1 }]);
    expect(
      (
        await client.query(`SELECT status FROM jobs WHERE id = $1`, [
          batch.job!.id,
        ])
      ).rows
    ).toEqual([{ status: "failed" }]);
  });
});
