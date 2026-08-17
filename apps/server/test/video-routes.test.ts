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
import type { MediaToolchain } from "../src/video/media/ffmpeg-media-toolchain.js";

const fakeMediaToolchain: MediaToolchain = {
  async probeVideo() {
    return { durationSec: 15, width: 1080, height: 1920, fps: 30, videoCodec: "h264", hasAudio: false, audioCodec: null };
  },
  async probeImage() {
    return { width: 800, height: 800, codec: "png" };
  },
  async prepareSource(_path, _workspaceId, probe) {
    return { probe, framePaths: [], contactSheetPath: null, audioPath: null, cleanup: async () => undefined };
  },
};

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
  const module = await registerVideoRoutes(app, { config, database, mediaToolchain: fakeMediaToolchain });
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
    assert.equal(finished.json().project.status, "adaptation_ready");
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

    const blockedFinal = await app.inject({
      method: "POST",
      url: `/api/video/v1/projects/${projectId}/exports`,
      headers: { "idempotency-key": "final-blocked", "content-type": "application/json" },
      payload: { kind: "final" },
    });
    assert.equal(blockedFinal.statusCode, 409, blockedFinal.body);
    assert.equal(blockedFinal.json().error.code, "EXPORT_FINAL_BLOCKED");
    assert.ok(blockedFinal.json().error.details.blocking_scenes.length >= 6);

    const draft = await app.inject({
      method: "POST",
      url: `/api/video/v1/projects/${projectId}/exports`,
      headers: { "idempotency-key": "draft-export", "content-type": "application/json" },
      payload: { kind: "draft" },
    });
    assert.equal(draft.statusCode, 202, draft.body);
    const draftJobId = draft.json().job.id as string;
    let draftJobStatus = "queued";
    for (let attempt = 0; attempt < 100 && draftJobStatus !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: "GET", url: `/api/video/v1/jobs/${draftJobId}` });
      draftJobStatus = response.json().job.status;
    }
    assert.equal(draftJobStatus, "succeeded");
    const draftDownload = await app.inject({
      method: "GET",
      url: `/api/video/v1/exports/${draft.json().export.id}/download`,
    });
    assert.equal(draftDownload.statusCode, 200, draftDownload.body);
    assert.equal(draftDownload.rawPayload.subarray(0, 2).toString("ascii"), "PK");

    const batchRun = await app.inject({
      method: "POST",
      url: `/api/video/v1/projects/${projectId}/storyboard-runs`,
      headers: { "idempotency-key": "storyboard-batch", "content-type": "application/json" },
      payload: { expected_project_revision: 2 },
    });
    assert.equal(batchRun.statusCode, 202, batchRun.body);
    assert.equal(batchRun.json().jobs.length, 6);
    for (const batchJob of batchRun.json().jobs as Array<{ id: string }>) {
      let sceneJobStatus = "queued";
      for (let attempt = 0; attempt < 100 && sceneJobStatus !== "succeeded"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const response = await app.inject({ method: "GET", url: `/api/video/v1/jobs/${batchJob.id}` });
        sceneJobStatus = response.json().job.status;
      }
      assert.equal(sceneJobStatus, "succeeded");
    }
    const generatedScenes = await app.inject({ method: "GET", url: `/api/video/v1/projects/${projectId}/scenes` });
    for (const scene of generatedScenes.json().scenes as Array<{ id: string; revision: number }>) {
      const current = await app.inject({
        method: "GET",
        url: `/api/video/v1/projects/${projectId}/scenes/${scene.id}`,
      });
      assert.equal(current.statusCode, 200, current.body);
      assert.equal(current.json().scene.generation_status, "ready");
      assert.equal(current.json().scene.qc_status, "passed");
      assert.ok(current.json().scene.storyboard_asset_id);
      const image = await app.inject({
        method: "GET",
        url: `/api/video/v1/assets/${current.json().scene.storyboard_asset_id}/content`,
      });
      assert.equal(image.statusCode, 200, image.body);
      assert.equal(image.headers["content-type"], "image/png");
      const locked = await app.inject({
        method: "POST",
        url: `/api/video/v1/projects/${projectId}/scenes/${scene.id}/locks`,
        headers: {
          "if-match": `"${scene.revision}"`,
          "idempotency-key": `lock-${scene.id}`,
          "content-type": "application/json",
        },
        payload: {},
      });
      assert.equal(locked.statusCode, 200, locked.body);
      assert.equal(locked.json().scene.locked_revision_id, locked.json().scene.current_revision_id);
    }

    const finalExport = await app.inject({
      method: "POST",
      url: `/api/video/v1/projects/${projectId}/exports`,
      headers: { "idempotency-key": "final-export", "content-type": "application/json" },
      payload: { kind: "final" },
    });
    assert.equal(finalExport.statusCode, 202, finalExport.body);
    const finalJobId = finalExport.json().job.id as string;
    let finalJobStatus = "queued";
    for (let attempt = 0; attempt < 100 && finalJobStatus !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: "GET", url: `/api/video/v1/jobs/${finalJobId}` });
      finalJobStatus = response.json().job.status;
    }
    assert.equal(finalJobStatus, "succeeded");
    const finalState = await app.inject({ method: "GET", url: `/api/video/v1/exports/${finalExport.json().export.id}` });
    assert.equal(finalState.statusCode, 200, finalState.body);
    assert.equal(finalState.json().export.status, "ready");
    assert.equal(finalState.json().export.manifest.kind, "final");
    assert.equal(finalState.json().export.manifest.scenes.length, 6);
    assert.equal(finalState.json().export.manifest.files.filter((file: { path: string }) => file.path.startsWith("storyboards/")).length, 6);
    const finishedBudget = database.raw
      .prepare("SELECT spent_units, reserved_units FROM video_usage_budgets WHERE project_id = ?")
      .get(projectId) as { spent_units: number; reserved_units: number };
    assert.equal(finishedBudget.spent_units, 8);
    assert.equal(finishedBudget.reserved_units, 0);

    const baselineScenes = generatedScenes.json().scenes as Array<{
      id: string;
      revision: number;
      storyboard_asset_id: string;
    }>;
    const ctaScene = baselineScenes.at(-1)!;
    const unlocked = await app.inject({
      method: "DELETE",
      url: `/api/video/v1/projects/${projectId}/scenes/${ctaScene.id}/locks/current`,
      headers: { "idempotency-key": "unlock-cta", "content-type": "application/json" },
      payload: {},
    });
    assert.equal(unlocked.statusCode, 200, unlocked.body);
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/video/v1/projects/${projectId}/scenes/${ctaScene.id}`,
      headers: {
        "if-match": `"${ctaScene.revision}"`,
        "idempotency-key": "edit-cta",
        "content-type": "application/json",
      },
      payload: { headline: "新的低压力 CTA", prompt: "A revised safe CTA scene for the current product" },
    });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().scene.revision, ctaScene.revision + 1);
    assert.equal(edited.json().scene.generation_status, "stale");
    assert.equal(edited.json().scene.storyboard_asset_id, null);
    const redo = await app.inject({
      method: "POST",
      url: `/api/video/v1/projects/${projectId}/scenes/${ctaScene.id}/image-runs`,
      headers: {
        "if-match": `"${ctaScene.revision + 1}"`,
        "idempotency-key": "redo-cta",
        "content-type": "application/json",
      },
      payload: { regeneration_scope: "rebuild_from_current_fields" },
    });
    assert.equal(redo.statusCode, 202, redo.body);
    let redoStatus = "queued";
    for (let attempt = 0; attempt < 100 && redoStatus !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: "GET", url: `/api/video/v1/jobs/${redo.json().job.id}` });
      redoStatus = response.json().job.status;
    }
    assert.equal(redoStatus, "succeeded");
    const afterRedo = await app.inject({ method: "GET", url: `/api/video/v1/projects/${projectId}/scenes` });
    const afterScenes = afterRedo.json().scenes as typeof baselineScenes;
    assert.deepEqual(
      afterScenes.slice(0, 5).map((scene) => [scene.id, scene.revision, scene.storyboard_asset_id]),
      baselineScenes.slice(0, 5).map((scene) => [scene.id, scene.revision, scene.storyboard_asset_id]),
    );
    assert.equal(afterScenes.at(-1)?.revision, ctaScene.revision + 1);
    assert.notEqual(afterScenes.at(-1)?.storyboard_asset_id, ctaScene.storyboard_asset_id);
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
        width: role === "source_video" ? 1080 : 800,
        height: role === "source_video" ? 1920 : 800,
        durationMs: role === "source_video" ? 15_000 : null,
        metadata: role === "source_video" ? { has_audio: false } : {},
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
