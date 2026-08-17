import assert from "node:assert/strict";
import test from "node:test";
import type { VideoJob } from "@tibao/video-core";
import {
  VideoWorkerRuntime,
  type WorkerClaimedJob,
  type WorkerFailure,
  type WorkerRepository,
} from "../src/index.js";

function job(): WorkerClaimedJob {
  const timestamp = new Date().toISOString();
  return {
    id: "job-1",
    project_id: "project-1",
    type: "prototype_analysis",
    category: "text",
    status: "running",
    attempt: 1,
    max_attempts: 3,
    progress_stage: null,
    error_code: null,
    error_message: null,
    error_retryable: null,
    input_fingerprint: "hash",
    input_revision_map: {},
    target_generation: 1,
    retry_of_job_id: null,
    lease_owner: "worker",
    lease_expires_at: timestamp,
    created_at: timestamp,
    started_at: timestamp,
    finished_at: null,
    updated_at: timestamp,
  } satisfies VideoJob;
}

test("drain aborts active work and releases the worker lease immediately", async () => {
  let claimed = false;
  let released = false;
  let started = false;
  const repository: WorkerRepository = {
    claim: () => {
      if (claimed) return [];
      claimed = true;
      return [job()];
    },
    heartbeat: () => undefined,
    updateStage: () => true,
    markProviderSubmitted: () => true,
    complete: () => true,
    fail: (_job, _worker, _failure: WorkerFailure) => true,
    releaseOwnedJobs: () => {
      released = true;
    },
  };
  const runtime = new VideoWorkerRuntime(
    repository,
    new Map([
      [
        "prototype_analysis",
        async (_job, context) => {
          started = true;
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          });
        },
      ],
    ]),
    {
      workerId: "worker",
      pollMs: 5,
      leaseMs: 60,
      heartbeatMs: 20,
      shutdownGraceMs: 100,
      concurrency: { media: 1, text: 1, image: 1 },
    },
  );
  runtime.start();
  while (!started) await new Promise((resolve) => setTimeout(resolve, 2));
  await runtime.stop();
  assert.equal(released, true);
  assert.equal(runtime.activeCount, 0);
  assert.equal(runtime.draining, true);
});
