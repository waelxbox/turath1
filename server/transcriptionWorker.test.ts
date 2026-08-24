import { describe, expect, it, vi } from "vitest";
import type {
  Document,
  Project,
  TranscriptionQueueTask,
} from "../drizzle/schema";
import type { ClaimedTranscriptionTask } from "./transcriptionQueueDb";
import {
  createTranscriptionWorker,
  type TranscriptionQueueBackend,
} from "./transcriptionWorker";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for queue state");
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

function project(id: number): Project {
  return {
    id,
    userId: 1,
    name: `Project ${id}`,
    description: null,
    status: "active",
    modelProvider: "gemini",
    modelName: "gemini-test",
    pipelineType: "single_pass",
    temperature: 0.1,
    maxTokens: 4096,
    systemPrompt: null,
    pass2Prompt: null,
    jsonSchema: null,
    glossary: null,
    postProcessing: null,
    outputFormats: null,
    onboardingReasoning: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function document(id: number, projectId: number): Document {
  return {
    id,
    projectId,
    filename: `${id}.jpg`,
    storagePath: `projects/${projectId}/${id}.jpg`,
    storageUrl: null,
    mimeType: "image/jpeg",
    fileSizeBytes: 1,
    status: "pending",
    errorMessage: null,
    groupId: null,
    pageNumber: null,
    uploadedAt: new Date(0),
    processingStartedAt: null,
    processedAt: null,
  };
}

class MemoryQueue implements TranscriptionQueueBackend {
  private nextId = 1;
  readonly tasks: TranscriptionQueueTask[] = [];
  readonly completions: number[] = [];
  readonly failures: Array<{ taskId: number; result: "retried" | "failed" }> =
    [];
  now = new Date(10_000);

  enqueue(projectId: number, documentIds: number[], maxAttempts = 3): number {
    let inserted = 0;
    for (const documentId of new Set(documentIds)) {
      const existing = this.tasks.find(
        task => task.projectId === projectId && task.documentId === documentId
      );
      if (
        existing &&
        (existing.status === "queued" || existing.status === "running")
      )
        continue;
      const task: TranscriptionQueueTask = existing ?? {
        id: this.nextId++,
        jobId: 1,
        projectId,
        documentId,
        status: "queued",
        attempts: 0,
        maxAttempts,
        availableAt: this.now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        startedAt: null,
        completedAt: null,
        lastError: null,
        createdAt: this.now,
        updatedAt: this.now,
      };
      Object.assign(task, {
        status: "queued",
        attempts: 0,
        maxAttempts,
        availableAt: this.now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: null,
        lastError: null,
      });
      if (!existing) this.tasks.push(task);
      inserted++;
    }
    return inserted;
  }

  async claim(input: {
    workerId: string;
    leaseMs: number;
    perProjectConcurrency: number;
  }) {
    const candidate = this.tasks.find(task => {
      if (task.status !== "queued" || task.availableAt > this.now) return false;
      const activeForProject = this.tasks.filter(
        other =>
          other.projectId === task.projectId &&
          other.status === "running" &&
          other.leaseExpiresAt !== null &&
          other.leaseExpiresAt > this.now
      ).length;
      return activeForProject < input.perProjectConcurrency;
    });
    if (!candidate) return null;
    candidate.status = "running";
    candidate.attempts++;
    candidate.leaseOwner = input.workerId;
    candidate.startedAt = this.now;
    candidate.heartbeatAt = this.now;
    candidate.leaseExpiresAt = new Date(this.now.getTime() + input.leaseMs);
    return {
      task: { ...candidate },
      project: project(candidate.projectId),
      document: {
        ...document(candidate.documentId, candidate.projectId),
        status: "processing" as const,
      },
    } satisfies ClaimedTranscriptionTask;
  }

  async heartbeat(input: {
    taskId: number;
    workerId: string;
    leaseMs: number;
  }) {
    const task = this.tasks.find(item => item.id === input.taskId);
    if (
      !task ||
      task.status !== "running" ||
      task.leaseOwner !== input.workerId
    )
      return false;
    task.heartbeatAt = this.now;
    task.leaseExpiresAt = new Date(this.now.getTime() + input.leaseMs);
    return true;
  }

  async complete(input: { taskId: number; workerId: string }) {
    const task = this.tasks.find(item => item.id === input.taskId);
    if (
      !task ||
      task.status !== "running" ||
      task.leaseOwner !== input.workerId
    )
      return false;
    task.status = "completed";
    task.leaseOwner = null;
    task.leaseExpiresAt = null;
    task.completedAt = this.now;
    this.completions.push(task.id);
    return true;
  }

  async fail(input: {
    taskId: number;
    workerId: string;
    error: string;
    retryable: boolean;
    retryAt: Date;
  }) {
    const task = this.tasks.find(item => item.id === input.taskId);
    if (
      !task ||
      task.status !== "running" ||
      task.leaseOwner !== input.workerId
    )
      return "lease_lost" as const;
    const retry = input.retryable && task.attempts < task.maxAttempts;
    task.status = retry ? "queued" : "failed";
    task.availableAt = retry ? input.retryAt : task.availableAt;
    task.leaseOwner = null;
    task.leaseExpiresAt = null;
    task.lastError = input.error;
    this.failures.push({
      taskId: task.id,
      result: retry ? "retried" : "failed",
    });
    return retry ? ("retried" as const) : ("failed" as const);
  }

  async recover(now = this.now) {
    let recovered = 0;
    for (const task of this.tasks) {
      if (
        task.status !== "running" ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt > now
      )
        continue;
      task.status = task.attempts >= task.maxAttempts ? "failed" : "queued";
      task.availableAt = now;
      task.leaseOwner = null;
      task.leaseExpiresAt = null;
      recovered++;
    }
    return recovered;
  }

  async releaseWorker(workerId: string) {
    let released = 0;
    for (const task of this.tasks) {
      if (task.status !== "running" || task.leaseOwner !== workerId) continue;
      task.status = "queued";
      task.availableAt = this.now;
      task.leaseOwner = null;
      task.leaseExpiresAt = null;
      released++;
    }
    return released;
  }
}

const success = {
  rawJson: { transcription: "done" },
  originalText: "done",
  modelUsed: "gemini-test",
};

describe("durable transcription worker", () => {
  it("claims a queue task only once across concurrent worker instances", async () => {
    const queue = new MemoryQueue();
    queue.enqueue(1, [10]);
    const processing = deferred<typeof success>();
    const processor = vi.fn(() => processing.promise);
    const workerA = createTranscriptionWorker({
      workerId: "a",
      backend: queue,
      processor,
      concurrency: 1,
    });
    const workerB = createTranscriptionWorker({
      workerId: "b",
      backend: queue,
      processor,
      concurrency: 1,
    });

    await Promise.all([workerA.poll(), workerB.poll()]);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(queue.tasks[0]).toMatchObject({ status: "running", attempts: 1 });
    processing.resolve(success);
    await waitFor(() => queue.completions.length === 1);
    expect(queue.completions).toEqual([queue.tasks[0].id]);
  });

  it("prevents duplicate active work when the same document is enqueued repeatedly", () => {
    const queue = new MemoryQueue();

    expect(queue.enqueue(1, [10, 10])).toBe(1);
    expect(queue.enqueue(1, [10])).toBe(0);
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0]).toMatchObject({
      projectId: 1,
      documentId: 10,
      status: "queued",
    });
  });

  it("retries a transient failure with backoff and completes without a duplicate write", async () => {
    const queue = new MemoryQueue();
    queue.enqueue(1, [10]);
    const processor = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce(success);
    const worker = createTranscriptionWorker({
      workerId: "retry-worker",
      backend: queue,
      processor,
      concurrency: 1,
      retryBaseMs: 100,
      now: () => queue.now,
    });

    await worker.poll();
    await waitFor(() => queue.failures.length === 1);
    expect(queue.tasks[0]).toMatchObject({ status: "queued", attempts: 1 });
    expect(queue.failures[0].result).toBe("retried");

    queue.now = new Date(queue.now.getTime() + 100);
    await worker.poll();
    await waitFor(() => queue.completions.length === 1);
    expect(processor).toHaveBeenCalledTimes(2);
    expect(queue.tasks[0]).toMatchObject({ status: "completed", attempts: 2 });
    expect(queue.completions).toHaveLength(1);
  });

  it("recovers an expired lease after a worker restart", async () => {
    const queue = new MemoryQueue();
    queue.enqueue(1, [10]);
    const claimedByDeadWorker = await queue.claim({
      workerId: "dead-worker",
      leaseMs: 10,
      perProjectConcurrency: 1,
    });
    expect(claimedByDeadWorker).not.toBeNull();
    queue.now = new Date(queue.now.getTime() + 11);

    const replacement = createTranscriptionWorker({
      workerId: "replacement-worker",
      backend: queue,
      processor: async () => success,
      concurrency: 1,
      pollMs: 10_000,
      recoveryMs: 10_000,
      now: () => queue.now,
    });
    await replacement.start();
    await waitFor(() => queue.completions.length === 1);
    await replacement.stop();

    expect(queue.tasks[0]).toMatchObject({
      status: "completed",
      attempts: 2,
      leaseOwner: null,
    });
  });
});
