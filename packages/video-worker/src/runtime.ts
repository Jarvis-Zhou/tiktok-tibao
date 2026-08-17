import { randomUUID } from "node:crypto";
import type { VideoJob, VideoJobCategory, VideoJobType } from "@tibao/video-core";

type Awaitable<T> = T | Promise<T>;

export interface WorkerClaimedJob extends VideoJob {}

export interface WorkerFailure {
  code: string;
  message: string;
  retryable: boolean;
  providerOutcomeUnknown?: boolean;
}

export interface WorkerRepository {
  claim(
    workerId: string,
    leaseMs: number,
    capacity: Readonly<Record<VideoJobCategory, number>>,
  ): Awaitable<WorkerClaimedJob[]>;
  heartbeat(workerId: string, leaseMs: number): Awaitable<void>;
  updateStage(jobId: string, workerId: string, stage: string): Awaitable<boolean>;
  markProviderSubmitted(jobId: string, workerId: string, providerRequestId: string): Awaitable<boolean>;
  complete(job: WorkerClaimedJob, workerId: string, result: unknown): Awaitable<boolean>;
  fail(job: WorkerClaimedJob, workerId: string, failure: WorkerFailure): Awaitable<boolean>;
  releaseOwnedJobs(workerId: string): Awaitable<void>;
}

export interface WorkerHandlerContext {
  signal: AbortSignal;
  progress(stage: string): Promise<boolean>;
  markProviderSubmitted(providerRequestId: string): Promise<boolean>;
}

export type WorkerHandler = (
  job: WorkerClaimedJob,
  context: WorkerHandlerContext,
) => Promise<unknown>;

export interface VideoWorkerRuntimeOptions {
  workerId?: string;
  pollMs: number;
  leaseMs: number;
  heartbeatMs: number;
  shutdownGraceMs: number;
  concurrency: Readonly<Record<VideoJobCategory, number>>;
  onError?: (error: unknown) => void;
}

function defaultFailure(error: unknown): WorkerFailure {
  if (error && typeof error === "object" && "code" in error) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      retryable?: unknown;
      providerOutcomeUnknown?: unknown;
    };
    const failure: WorkerFailure = {
      code: typeof candidate.code === "string" ? candidate.code : "WORKER_FAILED",
      message: typeof candidate.message === "string" ? candidate.message : "Worker job failed",
      retryable: candidate.retryable === true,
    };
    if (candidate.providerOutcomeUnknown === true) failure.providerOutcomeUnknown = true;
    return failure;
  }
  return {
    code: "WORKER_FAILED",
    message: error instanceof Error ? error.message : "Worker job failed",
    retryable: false,
  };
}

export class VideoWorkerRuntime {
  readonly workerId: string;
  private state: "idle" | "running" | "draining" | "stopped" = "idle";
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly active = new Map<string, { category: VideoJobCategory; controller: AbortController; done: Promise<void> }>();

  constructor(
    private readonly repository: WorkerRepository,
    private readonly handlers: ReadonlyMap<VideoJobType, WorkerHandler>,
    private readonly options: VideoWorkerRuntimeOptions,
  ) {
    this.workerId = options.workerId ?? `video-worker-${randomUUID()}`;
    if (options.leaseMs < options.heartbeatMs * 3) {
      throw new Error("Video worker lease must be at least three times the heartbeat interval");
    }
  }

  start(): void {
    if (this.state === "running") return;
    if (this.state !== "idle") throw new Error("A drained video worker runtime cannot be restarted");
    this.state = "running";
    this.heartbeatTimer = setInterval(() => {
      void Promise.resolve(this.repository.heartbeat(this.workerId, this.options.leaseMs)).catch(
        (error) => this.options.onError?.(error),
      );
    }, this.options.heartbeatMs);
    this.schedulePoll(0);
  }

  beginDrain(): void {
    if (this.state === "draining" || this.state === "stopped") return;
    this.state = "draining";
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const entry of this.active.values()) entry.controller.abort();
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    this.beginDrain();
    const running = [...this.active.values()].map((entry) => entry.done);
    if (running.length > 0) {
      await Promise.race([
        Promise.allSettled(running),
        new Promise<void>((resolve) => setTimeout(resolve, this.options.shutdownGraceMs)),
      ]);
    }
    await this.repository.releaseOwnedJobs(this.workerId);
    this.state = "stopped";
  }

  get activeCount(): number {
    return this.active.size;
  }

  get draining(): boolean {
    return this.state === "draining" || this.state === "stopped";
  }

  private schedulePoll(delay: number): void {
    if (this.state !== "running") return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, delay);
  }

  private availableCapacity(): Record<VideoJobCategory, number> {
    const used: Record<VideoJobCategory, number> = { media: 0, text: 0, image: 0 };
    for (const entry of this.active.values()) used[entry.category] += 1;
    return {
      media: Math.max(0, this.options.concurrency.media - used.media),
      text: Math.max(0, this.options.concurrency.text - used.text),
      image: Math.max(0, this.options.concurrency.image - used.image),
    };
  }

  private async poll(): Promise<void> {
    if (this.state !== "running" || this.polling) return;
    this.polling = true;
    try {
      const jobs = await this.repository.claim(
        this.workerId,
        this.options.leaseMs,
        this.availableCapacity(),
      );
      for (const job of jobs) this.run(job);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.polling = false;
      this.schedulePoll(this.options.pollMs);
    }
  }

  private run(job: WorkerClaimedJob): void {
    if (this.state !== "running") return;
    const controller = new AbortController();
    const done = this.execute(job, controller).finally(() => {
      this.active.delete(job.id);
      this.schedulePoll(0);
    });
    this.active.set(job.id, { category: job.category, controller, done });
  }

  private async execute(job: WorkerClaimedJob, controller: AbortController): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.repository.fail(job, this.workerId, {
        code: "WORKER_HANDLER_MISSING",
        message: `No handler registered for ${job.type}`,
        retryable: false,
      });
      return;
    }
    try {
      const result = await handler(job, {
        signal: controller.signal,
        progress: async (stage) => this.repository.updateStage(job.id, this.workerId, stage),
        markProviderSubmitted: async (requestId) =>
          this.repository.markProviderSubmitted(job.id, this.workerId, requestId),
      });
      if (this.state === "running") await this.repository.complete(job, this.workerId, result);
    } catch (error) {
      if (this.state !== "running" && (controller.signal.aborted || (error instanceof Error && error.name === "AbortError"))) {
        return;
      }
      await this.repository.fail(job, this.workerId, defaultFailure(error));
    }
  }
}
