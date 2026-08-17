import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { AppConfig } from "../src/config.js";
import { loadVideoConfig } from "../src/config.js";
import { TibaoDatabase } from "../src/database.js";
import { SqliteVideoRepository } from "../src/video/repository/sqlite-video-repository.js";
import { registerVideoRoutes } from "../src/video/routes.js";

function configFor(directory: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 3210,
    databasePath: join(directory, "queue.sqlite"),
    publicDirectory: join(directory, "public"),
    tiktokAppKey: "",
    tiktokAppSecret: "",
    tiktokApiBaseUrl: "https://example.test",
    tiktokProductApiVersion: "202309",
    tokenEncryptionKey: "",
    extensionSharedKey: "",
    apiMinIntervalMs: 1,
    matchReadIntervalMs: 1,
    apiMaxAttempts: 1,
    taskLeaseMinutes: 30,
    video: {
      ...loadVideoConfig({}),
      storageRoot: join(directory, "assets"),
      tempRoot: join(directory, "tmp"),
      jobPollMs: 5,
      jobLeaseMs: 3_000,
      jobHeartbeatMs: 1_000,
      workerShutdownGraceMs: 100,
      maxSourceBytes: 8 * 1024 * 1024,
      dataEncryptionKey: "separate-video-test-key",
    },
  };
}

async function upload(
  app: ReturnType<typeof Fastify>,
  projectId: string,
  role: "source_video" | "product_image",
  contentType: string,
  payload: Buffer,
  key: string,
) {
  const created = await app.inject({
    method: "POST",
    url: `/api/video/v1/projects/${projectId}/uploads`,
    headers: { "idempotency-key": key, "content-type": "application/json" },
    payload: { role, content_type: contentType, bytes: payload.length },
  });
  assert.equal(created.statusCode, 201, created.body);
  const session = created.json();
  const written = await app.inject({
    method: "PUT",
    url: session.url,
    headers: { "content-type": contentType, "content-length": String(payload.length) },
    payload,
  });
  assert.equal(written.statusCode, 201, written.body);
  const completed = await app.inject({
    method: "POST",
    url: `/api/video/v1/uploads/${session.upload_id}/complete`,
  });
  assert.equal(completed.statusCode, 200, completed.body);
  return completed.json().asset;
}

test("Phase A API persists uploads and completes a fake-provider storyboard job", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-video-routes-"));
  const config = configFor(directory);
  const database = new TibaoDatabase(config.databasePath);
  const app = Fastify({ bodyLimit: 6 * 1024 * 1024 });
  const module = await registerVideoRoutes(app, { config, database });
  assert.ok(module);

  try {
    await app.ready();
    const projectPayload = {
      name: "Portable blender MY",
      catalog_context: {
        product_id: "product-1",
        title: "Portable Blender",
        shop_region: "MY",
      },
      target_market: "MY",
      language: "ms-MY",
      target_duration_sec: null,
      similarity_score: 60,
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/video/v1/projects",
      headers: { "idempotency-key": "create-project", "content-type": "application/json" },
      payload: projectPayload,
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.headers.etag, '"1"');
    const projectId = created.json().project.id as string;

    const replay = await app.inject({
      method: "POST",
      url: "/api/video/v1/projects",
      headers: { "idempotency-key": "create-project", "content-type": "application/json" },
      payload: projectPayload,
    });
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().project.id, projectId);
    assert.equal(replay.json().reused, true);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/video/v1/projects",
      headers: { "idempotency-key": "create-project", "content-type": "application/json" },
      payload: { ...projectPayload, name: "Different" },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_KEY_REUSED");

    // A 7 MiB raw MP4 exceeds the server's global 6 MiB JSON/multipart limit,
    // proving the scoped media parser streams independently of bodyLimit.
    const video = Buffer.alloc(7 * 1024 * 1024);
    Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]).copy(video);
    await upload(app, projectId, "source_video", "video/mp4", video, "upload-video");
    await upload(
      app,
      projectId,
      "product_image",
      "image/png",
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      "upload-image",
    );

    const ready = await app.inject({ method: "GET", url: `/api/video/v1/projects/${projectId}` });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().project.status, "ready_for_analysis");
    assert.equal(ready.json().assets.length, 2);

    const run = await app.inject({
      method: "POST",
      url: `/api/video/v1/projects/${projectId}/analysis-runs`,
      headers: { "idempotency-key": "analysis-1", "content-type": "application/json" },
      payload: {
        expected_project_revision: 1,
        rights_acknowledgement: { accepted: true, policy_version: "2026-08-15" },
      },
    });
    assert.equal(run.statusCode, 202, run.body);
    const jobId = run.json().job.id as string;
    let jobStatus = "queued";
    for (let attempt = 0; attempt < 100 && jobStatus !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: "GET", url: `/api/video/v1/jobs/${jobId}` });
      assert.equal(response.statusCode, 200, response.body);
      jobStatus = response.json().job.status;
    }
    assert.equal(jobStatus, "succeeded");
    const scenes = await app.inject({ method: "GET", url: `/api/video/v1/projects/${projectId}/scenes` });
    assert.equal(scenes.statusCode, 200);
    assert.equal(scenes.json().scenes.length, 6);
    assert.match(scenes.json().scenes[2].headline, /Portable Blender/);

    const finished = await app.inject({ method: "GET", url: `/api/video/v1/projects/${projectId}` });
    assert.equal(finished.json().project.status, "storyboard_ready");
    assert.equal(finished.json().jobs[0].status, "succeeded");

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/video/v1/projects/${projectId}`,
      headers: {
        "if-match": '"1"',
        "idempotency-key": "update-project",
        "content-type": "application/json",
      },
      payload: { similarity_score: 70 },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().project.revision, 2);
    const updateReplay = await app.inject({
      method: "PATCH",
      url: `/api/video/v1/projects/${projectId}`,
      headers: {
        "if-match": '"1"',
        "idempotency-key": "update-project",
        "content-type": "application/json",
      },
      payload: { similarity_score: 70 },
    });
    assert.equal(updateReplay.statusCode, 200, updateReplay.body);
    assert.equal(updateReplay.json().project.revision, 2);

    const rerun = await app.inject({
      method: "POST",
      url: `/api/video/v1/projects/${projectId}/analysis-runs`,
      headers: { "idempotency-key": "analysis-2", "content-type": "application/json" },
      payload: {
        expected_project_revision: 2,
        rights_acknowledgement: { accepted: true, policy_version: "2026-08-15" },
      },
    });
    assert.equal(rerun.statusCode, 202, rerun.body);
    const rerunJobId = rerun.json().job.id as string;
    let rerunStatus = "queued";
    for (let attempt = 0; attempt < 100 && rerunStatus !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: "GET", url: `/api/video/v1/jobs/${rerunJobId}` });
      rerunStatus = response.json().job.status;
    }
    assert.equal(rerunStatus, "succeeded");
    const revisedScenes = await app.inject({ method: "GET", url: `/api/video/v1/projects/${projectId}/scenes` });
    assert.equal(revisedScenes.json().scenes[0].revision, 2);
    assert.equal(revisedScenes.json().scenes[0].generation, 2);
    const budget = database.raw
      .prepare("SELECT spent_units, reserved_units FROM video_usage_budgets WHERE project_id = ?")
      .get(projectId) as { spent_units: number; reserved_units: number };
    assert.equal(budget.spent_units, 2);
    assert.equal(budget.reserved_units, 0);
  } finally {
    await module.close();
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("worker drain releases an unsubmitted job reservation and permits immediate reclaim", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-video-drain-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  const repository = new SqliteVideoRepository(database, 10);
  try {
    const project = repository.createProject({
      ownerId: "local",
      name: "Drain test",
      catalogContext: null,
      targetMarket: "MY",
      language: "ms-MY",
      targetDurationSec: null,
      similarityScore: 60,
      idempotency: { key: "project", scope: "POST /projects", requestHash: "project-hash" },
    }).project;
    for (const [role, mime, hash] of [
      ["source_video", "video/mp4", "a".repeat(64)],
      ["product_image", "image/png", "b".repeat(64)],
    ] as const) {
      const created = repository.createUpload({
        ownerId: "local",
        projectId: project.id,
        role,
        mimeType: mime,
        expectedBytes: 12,
        expectedSha256: hash,
        maxBytes: 100,
        idempotency: { key: role, scope: "upload", requestHash: role },
      });
      repository.beginUpload("local", created.upload.id, mime, 12);
      repository.finishUploadContent("local", created.upload.id, {
        bytes: 12,
        sha256: hash,
        tempKey: created.upload.tempKey,
      });
      repository.completeUpload("local", created.upload.id, {
        detectedMime: mime,
        storageKey: `fixture/${hash}`,
      });
    }
    const job = repository.enqueuePrototypeAnalysis({
      ownerId: "local",
      projectId: project.id,
      expectedProjectRevision: 1,
      policyVersion: "test",
      requestId: "request",
      idempotency: { key: "analysis", scope: "analysis", requestHash: "analysis" },
    }).job;
    const claimed = repository.claim("worker-a", 180_000, { media: 0, text: 1, image: 0 });
    assert.equal(claimed[0]?.id, job.id);
    repository.releaseOwnedJobs("worker-a");
    assert.equal(repository.getJob("local", job.id)?.status, "queued");
    const releasedBudget = database.raw
      .prepare("SELECT reserved_units FROM video_usage_budgets WHERE project_id = ?")
      .get(project.id) as { reserved_units: number };
    assert.equal(releasedBudget.reserved_units, 0);
    const reclaimed = repository.claim("worker-b", 180_000, { media: 0, text: 1, image: 0 });
    assert.equal(reclaimed[0]?.id, job.id);
    const reheldBudget = database.raw
      .prepare("SELECT reserved_units FROM video_usage_budgets WHERE project_id = ?")
      .get(project.id) as { reserved_units: number };
    assert.equal(reheldBudget.reserved_units, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
