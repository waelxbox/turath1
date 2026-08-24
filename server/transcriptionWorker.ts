import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  processDocument,
  type TranscriptionResult,
} from "./transcriptionEngine";
import { storageGet } from "./storage";
import {
  claimTranscriptionTask,
  completeTranscriptionTask,
  failTranscriptionTask,
  heartbeatTranscriptionTask,
  recoverExpiredTranscriptionTasks,
  releaseWorkerTranscriptionTasks,
  type ClaimedTranscriptionTask,
} from "./transcriptionQueueDb";

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_LEASE_MS = 2 * 60_000;
const DEFAULT_GLOBAL_CONCURRENCY = 4;
const DEFAULT_PROJECT_CONCURRENCY = 2;
const DEFAULT_RECOVERY_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 5_000;
const STORAGE_FETCH_TIMEOUT_MS = 60_000;

export interface TranscriptionQueueBackend {
  claim(input: {
    workerId: string;
    leaseMs: number;
    perProjectConcurrency: number;
  }): Promise<ClaimedTranscriptionTask | null>;
  heartbeat(input: {
    taskId: number;
    workerId: string;
    leaseMs: number;
  }): Promise<boolean>;
  complete(input: {
    taskId: number;
    workerId: string;
    modelUsed: string;
    rawJson: Record<string, unknown>;
    originalText?: string | null;
  }): Promise<boolean>;
  fail(input: {
    taskId: number;
    workerId: string;
    error: string;
    retryable: boolean;
    retryAt: Date;
  }): Promise<"retried" | "failed" | "lease_lost">;
  recover(now?: Date): Promise<number>;
  releaseWorker(workerId: string): Promise<number>;
}

const productionBackend: TranscriptionQueueBackend = {
  claim: claimTranscriptionTask,
  heartbeat: heartbeatTranscriptionTask,
  complete: completeTranscriptionTask,
  fail: failTranscriptionTask,
  recover: recoverExpiredTranscriptionTasks,
  releaseWorker: releaseWorkerTranscriptionTasks,
};

export interface TranscriptionWorkerOptions {
  workerId?: string;
  pollMs?: number;
  leaseMs?: number;
  concurrency?: number;
  perProjectConcurrency?: number;
  recoveryMs?: number;
  retryBaseMs?: number;
  backend?: TranscriptionQueueBackend;
  processor?: (claim: ClaimedTranscriptionTask) => Promise<TranscriptionResult>;
  now?: () => Date;
}

export interface TranscriptionWorker {
  readonly workerId: string;
  start(): Promise<void>;
  poll(): Promise<void>;
  stop(gracePeriodMs?: number): Promise<void>;
  activeCount(): number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function defaultProcessor(
  claim: ClaimedTranscriptionTask
): Promise<TranscriptionResult> {
  const { document, project } = claim;
  const { url } = await storageGet(document.storagePath);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(STORAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(
      `Storage fetch failed with HTTP ${response.status}`
    );
    error.name =
      response.status >= 500 || response.status === 429
        ? "TransientTaskError"
        : "PermanentTaskError";
    throw error;
  }
  const buffer = await response.arrayBuffer();
  return processDocument(
    project,
    Buffer.from(buffer).toString("base64"),
    document.mimeType ?? "image/jpeg",
    document.filename
  );
}

export function isRetryableTranscriptionError(error: unknown): boolean {
  if (error instanceof Error && error.name === "PermanentTaskError")
    return false;
  if (error instanceof Error && error.name === "TransientTaskError")
    return true;
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  if (/\b(?:408|429|500|502|503|504)\b/.test(message)) return true;
  return [
    "resource_exhausted",
    "rate limit",
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "socket hang up",
  ].some(marker => message.includes(marker));
}

export function createTranscriptionWorker(
  options: TranscriptionWorkerOptions = {}
): TranscriptionWorker {
  const workerId =
    options.workerId ?? `${hostname()}:${process.pid}:${randomUUID()}`;
  const backend = options.backend ?? productionBackend;
  const processor = options.processor ?? defaultProcessor;
  const now = options.now ?? (() => new Date());
  const pollMs =
    options.pollMs ??
    positiveInteger(process.env.TRANSCRIPTION_WORKER_POLL_MS, DEFAULT_POLL_MS);
  const leaseMs =
    options.leaseMs ??
    positiveInteger(process.env.TRANSCRIPTION_TASK_LEASE_MS, DEFAULT_LEASE_MS);
  const concurrency =
    options.concurrency ??
    positiveInteger(
      process.env.TRANSCRIPTION_WORKER_CONCURRENCY,
      DEFAULT_GLOBAL_CONCURRENCY
    );
  const perProjectConcurrency =
    options.perProjectConcurrency ??
    positiveInteger(
      process.env.TRANSCRIPTION_PROJECT_CONCURRENCY,
      DEFAULT_PROJECT_CONCURRENCY
    );
  const recoveryMs =
    options.recoveryMs ??
    positiveInteger(
      process.env.TRANSCRIPTION_RECOVERY_POLL_MS,
      DEFAULT_RECOVERY_MS
    );
  const retryBaseMs =
    options.retryBaseMs ??
    positiveInteger(
      process.env.TRANSCRIPTION_RETRY_BASE_MS,
      DEFAULT_RETRY_BASE_MS
    );

  const inFlight = new Map<number, Promise<void>>();
  let pollTimer: NodeJS.Timeout | null = null;
  let recoveryTimer: NodeJS.Timeout | null = null;
  let polling = false;
  let stopping = false;

  const processClaim = async (
    claim: ClaimedTranscriptionTask
  ): Promise<void> => {
    const heartbeatMs = Math.max(250, Math.floor(leaseMs / 3));
    const heartbeat = setInterval(() => {
      backend
        .heartbeat({ taskId: claim.task.id, workerId, leaseMs })
        .catch(error => {
          console.error(
            `[TranscriptionWorker] heartbeat failed for task ${claim.task.id}`,
            error
          );
        });
    }, heartbeatMs);
    heartbeat.unref?.();

    try {
      const result = await processor(claim);
      if (result.error) {
        const error = new Error(result.error);
        error.name = isRetryableTranscriptionError(error)
          ? "TransientTaskError"
          : "PermanentTaskError";
        throw error;
      }
      const persisted = await backend.complete({
        taskId: claim.task.id,
        workerId,
        modelUsed: result.modelUsed,
        rawJson: result.rawJson,
        originalText: result.originalText ?? null,
      });
      if (!persisted) {
        console.warn(
          `[TranscriptionWorker] lease lost before completing task ${claim.task.id}; result discarded`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delay = retryBaseMs * 2 ** Math.max(0, claim.task.attempts - 1);
      await backend.fail({
        taskId: claim.task.id,
        workerId,
        error: message,
        retryable: isRetryableTranscriptionError(error),
        retryAt: new Date(now().getTime() + delay),
      });
    } finally {
      clearInterval(heartbeat);
    }
  };

  const poll = async (): Promise<void> => {
    if (stopping || polling) return;
    polling = true;
    try {
      while (!stopping && inFlight.size < concurrency) {
        const claim = await backend.claim({
          workerId,
          leaseMs,
          perProjectConcurrency,
        });
        if (!claim) break;
        const work = processClaim(claim)
          .catch(error =>
            console.error(
              `[TranscriptionWorker] task ${claim.task.id} crashed`,
              error
            )
          )
          .finally(() => {
            inFlight.delete(claim.task.id);
            if (!stopping) void poll();
          });
        inFlight.set(claim.task.id, work);
      }
    } catch (error) {
      console.error("[TranscriptionWorker] queue poll failed", error);
    } finally {
      polling = false;
    }
  };

  return {
    workerId,
    async start() {
      if (pollTimer || stopping) return;
      const recovered = await backend.recover().catch(error => {
        console.error("[TranscriptionWorker] startup recovery failed", error);
        return 0;
      });
      if (recovered > 0)
        console.info(
          `[TranscriptionWorker] recovered ${recovered} expired task lease(s)`
        );
      await poll();
      pollTimer = setInterval(() => void poll(), pollMs);
      recoveryTimer = setInterval(() => {
        backend
          .recover()
          .then(count => {
            if (count > 0)
              console.info(
                `[TranscriptionWorker] recovered ${count} expired task lease(s)`
              );
            return poll();
          })
          .catch(error =>
            console.error("[TranscriptionWorker] lease recovery failed", error)
          );
      }, recoveryMs);
      pollTimer.unref?.();
      recoveryTimer.unref?.();
    },
    poll,
    async stop(gracePeriodMs = 25_000) {
      stopping = true;
      if (pollTimer) clearInterval(pollTimer);
      if (recoveryTimer) clearInterval(recoveryTimer);
      pollTimer = null;
      recoveryTimer = null;

      if (inFlight.size > 0) {
        let timedOut = false;
        let timeout: NodeJS.Timeout | undefined;
        await Promise.race([
          Promise.allSettled(Array.from(inFlight.values())),
          new Promise<void>(resolve => {
            timeout = setTimeout(
              () => {
                timedOut = true;
                resolve();
              },
              Math.max(0, gracePeriodMs)
            );
          }),
        ]);
        if (timeout) clearTimeout(timeout);
        if (timedOut && inFlight.size > 0) {
          const released = await backend.releaseWorker(workerId);
          console.warn(
            `[TranscriptionWorker] shutdown grace expired; released ${released} task lease(s)`
          );
        }
      }
    },
    activeCount: () => inFlight.size,
  };
}

export function createProductionTranscriptionWorker(): TranscriptionWorker {
  return createTranscriptionWorker();
}
