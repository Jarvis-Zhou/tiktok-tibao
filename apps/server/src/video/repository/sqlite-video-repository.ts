import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  VideoDomainError,
  assertPrototypeAnalysisResult,
  extractSchemaAssetReferences,
  sha256Fingerprint,
  type ArtifactSchemaVersion,
  type CatalogContext,
  type PrototypeAnalysisResult,
  type PrototypeScene,
  type VideoAsset,
  type VideoAssetRole,
  type VideoJob,
  type VideoJobCategory,
  type VideoJobStatus,
  type VideoProject,
  type VideoProjectStatus,
} from "@tibao/video-core";
import type {
  WorkerClaimedJob,
  WorkerFailure,
  WorkerRepository,
} from "@tibao/video-worker";
import type { TibaoDatabase } from "../../database.js";
import { VIDEO_MIGRATION_001 } from "../migrations/001-phase-a.js";

type SqlRow = Record<string, unknown>;

export interface IdempotencyInput {
  key: string;
  scope: string;
  requestHash: string;
}

export interface CreateVideoProjectInput {
  ownerId: string;
  name: string;
  catalogContext: CatalogContext | null;
  targetMarket: string;
  language: string;
  targetDurationSec: number | null;
  similarityScore: number;
  idempotency: IdempotencyInput;
}

export interface CreateUploadInput {
  ownerId: string;
  projectId: string;
  role: VideoAssetRole;
  mimeType: string;
  expectedBytes: number | null;
  expectedSha256: string | null;
  maxBytes: number;
  idempotency: IdempotencyInput;
}

export interface UploadSessionPrivate {
  id: string;
  ownerId: string;
  projectId: string;
  assetId: string;
  role: VideoAssetRole;
  status: string;
  expectedMime: string;
  expectedBytes: number | null;
  expectedSha256: string | null;
  receivedBytes: number | null;
  receivedSha256: string | null;
  tempKey: string;
  maxBytes: number;
  expiresAt: string;
}

export interface ProjectAggregate {
  project: VideoProject;
  assets: VideoAsset[];
  jobs: VideoJob[];
  scenes: PrototypeScene[];
}

export interface VideoProjectEvent {
  id: number;
  project_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function projectFromRow(row: SqlRow): VideoProject {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    name: String(row.name),
    status: String(row.status) as VideoProjectStatus,
    current_step: String(row.current_step),
    target_market: String(row.target_market),
    language: String(row.language),
    target_duration_sec: row.target_duration_sec === null ? null : Number(row.target_duration_sec),
    similarity_score: Number(row.similarity_score),
    revision: Number(row.revision),
    catalog_context: parseJson<CatalogContext | null>(row.catalog_snapshot_json, null),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function assetFromRow(row: SqlRow): VideoAsset {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    role: String(row.role) as VideoAssetRole,
    status: String(row.status) as VideoAsset["status"],
    mime_type: String(row.mime_type),
    bytes: row.bytes === null ? null : Number(row.bytes),
    sha256: nullableString(row.sha256),
    sort_order: Number(row.sort_order),
    is_primary: Boolean(row.is_primary),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function jobFromRow(row: SqlRow): VideoJob {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    type: String(row.type) as VideoJob["type"],
    category: String(row.category) as VideoJobCategory,
    status: String(row.status) as VideoJobStatus,
    attempt: Number(row.attempt),
    max_attempts: Number(row.max_attempts),
    progress_stage: nullableString(row.progress_stage),
    error_code: nullableString(row.error_code),
    error_message: nullableString(row.error_message),
    error_retryable: row.error_retryable === null ? null : Boolean(row.error_retryable),
    input_fingerprint: String(row.input_fingerprint),
    input_revision_map: parseJson<Record<string, unknown>>(row.input_revision_map_json, {}),
    target_generation: Number(row.target_generation),
    retry_of_job_id: nullableString(row.retry_of_job_id),
    lease_owner: nullableString(row.lease_owner),
    lease_expires_at: nullableString(row.lease_expires_at),
    created_at: String(row.created_at),
    started_at: nullableString(row.started_at),
    finished_at: nullableString(row.finished_at),
    updated_at: String(row.updated_at),
  };
}

function uploadFromRow(row: SqlRow): UploadSessionPrivate {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    projectId: String(row.project_id),
    assetId: String(row.asset_id),
    role: String(row.role) as VideoAssetRole,
    status: String(row.status),
    expectedMime: String(row.expected_mime),
    expectedBytes: row.expected_bytes === null ? null : Number(row.expected_bytes),
    expectedSha256: nullableString(row.expected_sha256),
    receivedBytes: row.received_bytes === null ? null : Number(row.received_bytes),
    receivedSha256: nullableString(row.received_sha256),
    tempKey: String(row.temp_key),
    maxBytes: Number(row.max_bytes),
    expiresAt: String(row.expires_at),
  };
}

export class SqliteVideoRepository implements WorkerRepository {
  private readonly raw: DatabaseSync;

  constructor(
    private readonly database: TibaoDatabase,
    private readonly projectBudgetUnits: number,
    private readonly notifyEvents: () => void = () => undefined,
  ) {
    this.raw = database.raw;
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS video_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = this.raw
      .prepare("SELECT 1 FROM video_schema_migrations WHERE version = ?")
      .get(VIDEO_MIGRATION_001.version);
    if (applied) return;
    this.database.transaction(() => {
      this.raw.exec(VIDEO_MIGRATION_001.sql);
      this.raw
        .prepare("INSERT INTO video_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
        .run(VIDEO_MIGRATION_001.version, VIDEO_MIGRATION_001.name, nowIso());
    });
  }

  createProject(input: CreateVideoProjectInput): { project: VideoProject; reused: boolean } {
    const result = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ project: VideoProject }>(input.ownerId, input.idempotency);
      if (replay) return { project: replay.body.project, reused: true };
      const id = randomUUID();
      const timestamp = nowIso();
      this.raw
        .prepare(`
          INSERT INTO video_projects (
            id, owner_id, catalog_shop_id, catalog_product_id, catalog_snapshot_json,
            name, status, current_step, target_market, language, target_duration_sec,
            similarity_score, revision, generation, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 'input', ?, ?, ?, ?, 1, 0, ?, ?)
        `)
        .run(
          id,
          input.ownerId,
          input.catalogContext?.shop_id ?? null,
          input.catalogContext?.product_id ?? null,
          input.catalogContext ? JSON.stringify(input.catalogContext) : null,
          input.name,
          input.targetMarket,
          input.language,
          input.targetDurationSec,
          input.similarityScore,
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          INSERT INTO video_usage_budgets(owner_id, project_id, max_units, spent_units, reserved_units, updated_at)
          VALUES (?, ?, ?, 0, 0, ?)
        `)
        .run(input.ownerId, id, this.projectBudgetUnits, timestamp);
      this.writeEvent(id, "project.created", { revision: 1, status: "draft" }, timestamp);
      const project = projectFromRow(
        this.raw.prepare("SELECT * FROM video_projects WHERE id = ?").get(id) as SqlRow,
      );
      this.saveIdempotency(input.ownerId, input.idempotency, 201, { project });
      return { project, reused: false };
    });
    this.notifyEvents();
    return result;
  }

  listProjects(
    ownerId: string,
    input: { status?: VideoProjectStatus; cursorUpdatedAt?: string; cursorId?: string; limit: number },
  ): VideoProject[] {
    const conditions = ["owner_id = ?", "deleted_at IS NULL"];
    const params: Array<string | number> = [ownerId];
    if (input.status) {
      conditions.push("status = ?");
      params.push(input.status);
    }
    if (input.cursorUpdatedAt && input.cursorId) {
      conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      params.push(input.cursorUpdatedAt, input.cursorUpdatedAt, input.cursorId);
    }
    params.push(input.limit);
    return (
      this.raw
        .prepare(`
          SELECT * FROM video_projects
          WHERE ${conditions.join(" AND ")}
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `)
        .all(...params) as SqlRow[]
    ).map(projectFromRow);
  }

  getProject(ownerId: string, projectId: string): VideoProject | null {
    const row = this.raw
      .prepare("SELECT * FROM video_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
      .get(projectId, ownerId) as SqlRow | undefined;
    return row ? projectFromRow(row) : null;
  }

  getProjectAggregate(ownerId: string, projectId: string): ProjectAggregate | null {
    const project = this.getProject(ownerId, projectId);
    if (!project) return null;
    return {
      project,
      assets: this.listProjectAssets(ownerId, projectId),
      jobs: this.listProjectJobs(ownerId, projectId, 20),
      scenes: this.listScenes(ownerId, projectId),
    };
  }

  updateProject(
    ownerId: string,
    projectId: string,
    expectedRevision: number,
    patch: {
      name?: string;
      targetMarket?: string;
      language?: string;
      targetDurationSec?: number | null;
      similarityScore?: number;
    },
    idempotency: IdempotencyInput,
  ): VideoProject {
    const project = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ project: VideoProject }>(ownerId, idempotency);
      if (replay) return replay.body.project;
      const existing = this.raw
        .prepare("SELECT * FROM video_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
        .get(projectId, ownerId) as SqlRow | undefined;
      if (!existing) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
      if (Number(existing.revision) !== expectedRevision) {
        throw new VideoDomainError({
          code: "REVISION_CONFLICT",
          message: "The project was modified by another request",
          statusCode: 409,
          details: { current_revision: Number(existing.revision) },
        });
      }
      const next = {
        name: patch.name ?? String(existing.name),
        targetMarket: patch.targetMarket ?? String(existing.target_market),
        language: patch.language ?? String(existing.language),
        targetDurationSec:
          patch.targetDurationSec !== undefined
            ? patch.targetDurationSec
            : existing.target_duration_sec === null
              ? null
              : Number(existing.target_duration_sec),
        similarityScore: patch.similarityScore ?? Number(existing.similarity_score),
      };
      const timestamp = nowIso();
      this.raw
        .prepare(`
          UPDATE video_projects SET name = ?, target_market = ?, language = ?,
            target_duration_sec = ?, similarity_score = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND owner_id = ?
        `)
        .run(
          next.name,
          next.targetMarket,
          next.language,
          next.targetDurationSec,
          next.similarityScore,
          timestamp,
          projectId,
          ownerId,
        );
      this.writeEvent(projectId, "project.updated", { revision: expectedRevision + 1 }, timestamp);
      const updated = projectFromRow(
        this.raw.prepare("SELECT * FROM video_projects WHERE id = ?").get(projectId) as SqlRow,
      );
      this.saveIdempotency(ownerId, idempotency, 200, { project: updated });
      return updated;
    });
    this.notifyEvents();
    return project;
  }

  createUpload(input: CreateUploadInput): { upload: UploadSessionPrivate; asset: VideoAsset; reused: boolean } {
    const result = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ upload_id: string; asset_id: string }>(
        input.ownerId,
        input.idempotency,
      );
      if (replay) {
        const upload = this.requireUpload(input.ownerId, replay.body.upload_id);
        const asset = this.getProjectAsset(input.ownerId, upload.projectId, replay.body.asset_id);
        if (!asset) throw new Error("Idempotent upload asset is missing");
        return { upload, asset, reused: true };
      }
      const project = this.raw
        .prepare("SELECT id FROM video_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
        .get(input.projectId, input.ownerId);
      if (!project) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
      const timestamp = nowIso();
      const assetId = randomUUID();
      const uploadId = randomUUID();
      const roleCount = Number(
        (
          this.raw
            .prepare(`
              SELECT COUNT(*) AS count
              FROM video_project_assets pa JOIN video_assets a ON a.id = pa.asset_id
              WHERE pa.project_id = ? AND pa.role = ? AND a.status <> 'rejected'
            `)
            .get(input.projectId, input.role) as SqlRow
        ).count,
      );
      if (input.role === "source_video" && roleCount >= 1) {
        throw new VideoDomainError({
          code: "SOURCE_VIDEO_LIMIT_REACHED",
          message: "A project can have only one active source video",
          statusCode: 409,
        });
      }
      if (input.role === "product_image" && roleCount >= 6) {
        throw new VideoDomainError({
          code: "PRODUCT_IMAGE_LIMIT_REACHED",
          message: "A project can have at most six product images",
          statusCode: 409,
        });
      }
      const sortOrder = roleCount;
      this.raw
        .prepare(`
          INSERT INTO video_assets(id, owner_id, kind, mime_type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)
        `)
        .run(assetId, input.ownerId, input.role, input.mimeType, timestamp, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_project_assets(project_id, asset_id, role, sort_order, is_primary, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(input.projectId, assetId, input.role, sortOrder, Number(input.role === "product_image" && sortOrder === 0), timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_upload_sessions(
            id, owner_id, project_id, asset_id, role, status, expected_mime,
            expected_bytes, expected_sha256, temp_key, max_bytes, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          uploadId,
          input.ownerId,
          input.projectId,
          assetId,
          input.role,
          input.mimeType,
          input.expectedBytes,
          input.expectedSha256,
          `${uploadId}.part`,
          input.maxBytes,
          new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          timestamp,
          timestamp,
        );
      const upload = this.getUploadInCurrentConnection(input.ownerId, uploadId) as UploadSessionPrivate;
      const asset = this.getProjectAsset(input.ownerId, input.projectId, assetId) as VideoAsset;
      this.saveIdempotency(input.ownerId, input.idempotency, 201, {
        upload_id: upload.id,
        asset_id: asset.id,
      });
      this.writeEvent(input.projectId, "upload.created", { upload_id: uploadId, asset_id: assetId, role: input.role }, timestamp);
      return { upload, asset, reused: false };
    });
    this.notifyEvents();
    return result;
  }

  beginUpload(ownerId: string, uploadId: string, contentType: string, contentLength: number | null): UploadSessionPrivate {
    return this.database.transaction(() => {
      const upload = this.requireUpload(ownerId, uploadId);
      if (upload.status !== "pending") {
        throw new VideoDomainError({ code: "UPLOAD_ALREADY_USED", message: "Upload session is no longer writable", statusCode: 409 });
      }
      if (upload.expiresAt <= nowIso()) {
        throw new VideoDomainError({ code: "UPLOAD_EXPIRED", message: "Upload session expired", statusCode: 410 });
      }
      if (contentType !== upload.expectedMime && contentType !== "application/octet-stream") {
        throw new VideoDomainError({ code: "UPLOAD_MIME_MISMATCH", message: "Content-Type does not match the upload session", statusCode: 415 });
      }
      if (contentLength !== null && contentLength > upload.maxBytes) {
        throw new VideoDomainError({ code: "UPLOAD_TOO_LARGE", message: "Content-Length exceeds the upload limit", statusCode: 413 });
      }
      const timestamp = nowIso();
      this.raw
        .prepare("UPDATE video_upload_sessions SET status = 'uploading', updated_at = ? WHERE id = ?")
        .run(timestamp, uploadId);
      this.raw.prepare("UPDATE video_assets SET status = 'uploading', updated_at = ? WHERE id = ?").run(timestamp, upload.assetId);
      return { ...upload, status: "uploading" };
    });
  }

  resetUpload(ownerId: string, uploadId: string): void {
    this.database.transaction(() => {
      const upload = this.requireUpload(ownerId, uploadId);
      if (upload.status !== "uploading") return;
      const timestamp = nowIso();
      this.raw
        .prepare("UPDATE video_upload_sessions SET status = 'pending', updated_at = ? WHERE id = ?")
        .run(timestamp, uploadId);
      this.raw.prepare("UPDATE video_assets SET status = 'pending', updated_at = ? WHERE id = ?").run(timestamp, upload.assetId);
    });
  }

  finishUploadContent(ownerId: string, uploadId: string, received: { bytes: number; sha256: string; tempKey: string }): UploadSessionPrivate {
    return this.database.transaction(() => {
      const upload = this.requireUpload(ownerId, uploadId);
      if (upload.status !== "uploading") {
        throw new VideoDomainError({ code: "INVALID_UPLOAD_STATE", message: "Upload is not accepting content", statusCode: 409 });
      }
      const timestamp = nowIso();
      this.raw
        .prepare(`
          UPDATE video_upload_sessions SET status = 'uploaded', received_bytes = ?,
            received_sha256 = ?, temp_key = ?, updated_at = ? WHERE id = ?
        `)
        .run(received.bytes, received.sha256, received.tempKey, timestamp, uploadId);
      this.raw.prepare("UPDATE video_assets SET status = 'uploaded', updated_at = ? WHERE id = ?").run(timestamp, upload.assetId);
      return this.requireUpload(ownerId, uploadId);
    });
  }

  getUpload(ownerId: string, uploadId: string): UploadSessionPrivate | null {
    return this.getUploadInCurrentConnection(ownerId, uploadId);
  }

  completeUpload(ownerId: string, uploadId: string, input: { detectedMime: string; storageKey: string }): VideoAsset {
    const asset = this.database.transaction(() => {
      const upload = this.requireUpload(ownerId, uploadId);
      if (upload.status === "completed") {
        return this.getProjectAsset(ownerId, upload.projectId, upload.assetId) as VideoAsset;
      }
      if (upload.status !== "uploaded" || upload.receivedBytes === null || upload.receivedSha256 === null) {
        throw new VideoDomainError({ code: "INVALID_UPLOAD_STATE", message: "Upload content is incomplete", statusCode: 409 });
      }
      if (upload.expectedBytes !== null && upload.expectedBytes !== upload.receivedBytes) {
        throw new VideoDomainError({ code: "UPLOAD_SIZE_MISMATCH", message: "Uploaded byte count does not match the declared size" });
      }
      if (upload.expectedSha256 !== null && upload.expectedSha256.toLowerCase() !== upload.receivedSha256) {
        throw new VideoDomainError({ code: "UPLOAD_HASH_MISMATCH", message: "Uploaded checksum does not match" });
      }
      const allowed = upload.role === "source_video"
        ? ["video/mp4", "video/quicktime", "video/webm"]
        : ["image/png", "image/jpeg", "image/webp"];
      if (!allowed.includes(input.detectedMime)) {
        throw new VideoDomainError({ code: "UPLOAD_CONTENT_INVALID", message: "File magic bytes do not match an allowed media type", statusCode: 415 });
      }
      const timestamp = nowIso();
      this.raw
        .prepare(`
          UPDATE video_assets SET storage_key = ?, sha256 = ?, mime_type = ?, bytes = ?,
            status = 'ready', updated_at = ? WHERE id = ?
        `)
        .run(input.storageKey, upload.receivedSha256, input.detectedMime, upload.receivedBytes, timestamp, upload.assetId);
      this.raw
        .prepare("UPDATE video_upload_sessions SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(timestamp, uploadId);
      this.raw
        .prepare(`
          INSERT OR IGNORE INTO video_asset_references(asset_id, ref_type, ref_id, created_at)
          VALUES (?, 'project_input', ?, ?)
        `)
        .run(upload.assetId, `${upload.projectId}:${upload.role}`, timestamp);
      this.recomputeProjectProjection(upload.projectId, timestamp);
      this.writeEvent(upload.projectId, "upload.completed", {
        upload_id: uploadId,
        asset_id: upload.assetId,
        role: upload.role,
      }, timestamp);
      return this.getProjectAsset(ownerId, upload.projectId, upload.assetId) as VideoAsset;
    });
    this.notifyEvents();
    return asset;
  }

  listProjectAssets(ownerId: string, projectId: string): VideoAsset[] {
    return (
      this.raw
        .prepare(`
          SELECT a.*, pa.project_id, pa.role, pa.sort_order, pa.is_primary
          FROM video_project_assets pa JOIN video_assets a ON a.id = pa.asset_id
          WHERE pa.project_id = ? AND a.owner_id = ?
          ORDER BY pa.role, pa.sort_order
        `)
        .all(projectId, ownerId) as SqlRow[]
    ).map(assetFromRow);
  }

  enqueuePrototypeAnalysis(input: {
    ownerId: string;
    projectId: string;
    expectedProjectRevision: number;
    policyVersion: string;
    requestId: string;
    idempotency: IdempotencyInput;
    retryOfJobId?: string;
  }): { job: VideoJob; reused: boolean } {
    const result = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ job: VideoJob }>(input.ownerId, input.idempotency);
      if (replay) return { job: replay.body.job, reused: true };
      const projectRow = this.raw
        .prepare("SELECT * FROM video_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
        .get(input.projectId, input.ownerId) as SqlRow | undefined;
      if (!projectRow) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
      if (Number(projectRow.revision) !== input.expectedProjectRevision) {
        throw new VideoDomainError({ code: "REVISION_CONFLICT", message: "Project revision changed", statusCode: 409 });
      }
      const assets = this.listProjectAssets(input.ownerId, input.projectId).filter((asset) => asset.status === "ready");
      const source = assets.find((asset) => asset.role === "source_video");
      const images = assets.filter((asset) => asset.role === "product_image");
      if (!source || images.length === 0) {
        throw new VideoDomainError({
          code: "PROJECT_INPUT_INCOMPLETE",
          message: "A verified source video and at least one product image are required",
          nextAction: "upload_required_assets",
        });
      }
      const revisionMap = {
        project_revision: Number(projectRow.revision),
        source_asset: { id: source.id, sha256: source.sha256 },
        product_assets: images.map((asset) => ({ id: asset.id, sha256: asset.sha256 })),
      };
      const fingerprint = sha256Fingerprint({
        revisionMap,
        target_market: String(projectRow.target_market),
        language: String(projectRow.language),
        target_duration_sec: projectRow.target_duration_sec,
        similarity_score: Number(projectRow.similarity_score),
      });
      const existing = this.raw
        .prepare(`
          SELECT * FROM video_jobs
          WHERE project_id = ? AND type = 'prototype_analysis' AND input_fingerprint = ?
            AND status IN ('queued', 'running', 'retry_wait', 'succeeded')
          ORDER BY created_at DESC LIMIT 1
        `)
        .get(input.projectId, fingerprint) as SqlRow | undefined;
      if (existing) {
        const job = jobFromRow(existing);
        this.saveIdempotency(input.ownerId, input.idempotency, 202, { job });
        return { job, reused: true };
      }
      const timestamp = nowIso();
      const jobId = randomUUID();
      const generation = Number(projectRow.generation) + 1;
      this.reserveBudget(input.ownerId, input.projectId, jobId, 1, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_jobs(
            id, project_id, type, category, target_type, target_id, status, priority,
            input_revision_map_json, input_fingerprint, target_generation, retry_of_job_id,
            attempt, max_attempts, next_run_at, progress_stage, created_at, updated_at
          ) VALUES (?, ?, 'prototype_analysis', 'text', 'project', ?, 'queued', 0,
            ?, ?, ?, ?, 0, 3, ?, 'queued', ?, ?)
        `)
        .run(
          jobId,
          input.projectId,
          input.projectId,
          JSON.stringify(revisionMap),
          fingerprint,
          generation,
          input.retryOfJobId ?? null,
          timestamp,
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          INSERT INTO video_usage_reservations(
            id, owner_id, project_id, job_id, units, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, 'held', ?, ?)
        `)
        .run(randomUUID(), input.ownerId, input.projectId, jobId, timestamp, timestamp);
      for (const step of ["source_blueprint", "product_profile", "adapted_blueprint", "storyboard"]) {
        this.raw
          .prepare(`
            INSERT INTO video_job_steps(id, job_id, name, status, input_fingerprint, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', ?, ?, ?)
          `)
          .run(randomUUID(), jobId, step, sha256Fingerprint({ fingerprint, step }), timestamp, timestamp);
      }
      this.raw
        .prepare(`
          INSERT INTO video_rights_acceptances(id, owner_id, project_id, policy_version, request_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), input.ownerId, input.projectId, input.policyVersion, input.requestId, timestamp);
      this.raw
        .prepare(`
          UPDATE video_projects SET status = 'analyzing', current_step = 'analysis',
            generation = ?, updated_at = ? WHERE id = ?
        `)
        .run(generation, timestamp, input.projectId);
      const job = jobFromRow(this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(jobId) as SqlRow);
      const idempotencyRecordId = this.saveIdempotency(input.ownerId, input.idempotency, 202, { job });
      this.raw
        .prepare("UPDATE video_jobs SET idempotency_record_id = ? WHERE id = ?")
        .run(idempotencyRecordId, jobId);
      this.writeEvent(input.projectId, "job.queued", { job_id: jobId, type: job.type }, timestamp);
      return { job, reused: false };
    });
    this.notifyEvents();
    return result;
  }

  getJob(ownerId: string, jobId: string): VideoJob | null {
    const row = this.raw
      .prepare(`
        SELECT j.* FROM video_jobs j JOIN video_projects p ON p.id = j.project_id
        WHERE j.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL
      `)
      .get(jobId, ownerId) as SqlRow | undefined;
    return row ? jobFromRow(row) : null;
  }

  prototypeAnalysisInput(job: WorkerClaimedJob): {
    projectId: string;
    projectName: string;
    targetMarket: string;
    language: string;
    targetDurationSec: number | null;
    similarityScore: number;
    sourceAssetId: string;
    productAssetIds: string[];
    catalogTitle?: string;
    catalogCategory?: string;
    catalogBrand?: string;
  } {
    const project = this.raw.prepare("SELECT * FROM video_projects WHERE id = ?").get(job.project_id) as SqlRow | undefined;
    if (!project) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
    const assets = this.listProjectAssets(String(project.owner_id), job.project_id).filter(
      (asset) => asset.status === "ready",
    );
    const source = assets.find((asset) => asset.role === "source_video");
    const productAssetIds = assets
      .filter((asset) => asset.role === "product_image")
      .map((asset) => asset.id);
    if (!source || productAssetIds.length === 0) {
      throw new VideoDomainError({ code: "PROJECT_INPUT_INCOMPLETE", message: "Verified media assets are missing" });
    }
    const catalog = parseJson<CatalogContext | null>(project.catalog_snapshot_json, null);
    const result: ReturnType<SqliteVideoRepository["prototypeAnalysisInput"]> = {
      projectId: job.project_id,
      projectName: String(project.name),
      targetMarket: String(project.target_market),
      language: String(project.language),
      targetDurationSec: project.target_duration_sec === null ? null : Number(project.target_duration_sec),
      similarityScore: Number(project.similarity_score),
      sourceAssetId: source.id,
      productAssetIds,
    };
    if (catalog?.title) result.catalogTitle = catalog.title;
    if (catalog?.category) result.catalogCategory = catalog.category;
    if (catalog?.brand) result.catalogBrand = catalog.brand;
    return result;
  }

  listProjectJobs(ownerId: string, projectId: string, limit: number): VideoJob[] {
    return (
      this.raw
        .prepare(`
          SELECT j.* FROM video_jobs j JOIN video_projects p ON p.id = j.project_id
          WHERE j.project_id = ? AND p.owner_id = ?
          ORDER BY j.created_at DESC LIMIT ?
        `)
        .all(projectId, ownerId, limit) as SqlRow[]
    ).map(jobFromRow);
  }

  cancelJob(ownerId: string, jobId: string, idempotency: IdempotencyInput): VideoJob {
    const job = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ job: VideoJob }>(ownerId, idempotency);
      if (replay) return replay.body.job;
      const row = this.raw
        .prepare(`
          SELECT j.* FROM video_jobs j JOIN video_projects p ON p.id = j.project_id
          WHERE j.id = ? AND p.owner_id = ?
        `)
        .get(jobId, ownerId) as SqlRow | undefined;
      if (!row) throw new VideoDomainError({ code: "JOB_NOT_FOUND", message: "Video job not found", statusCode: 404 });
      const current = jobFromRow(row);
      if (["succeeded", "failed", "cancelled", "superseded"].includes(current.status)) {
        this.saveIdempotency(ownerId, idempotency, 200, { job: current });
        return current;
      }
      const timestamp = nowIso();
      this.raw
        .prepare(`
          UPDATE video_jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
            finished_at = ?, updated_at = ? WHERE id = ?
        `)
        .run(timestamp, timestamp, jobId);
      if (row.provider_request_id === null) {
        this.releaseReservation(jobId, "cancelled", timestamp);
      } else {
        this.raw
          .prepare("UPDATE video_usage_reservations SET status = 'reconciling', reason = ?, updated_at = ? WHERE job_id = ? AND status = 'held'")
          .run("cancelled_after_provider_submission", timestamp, jobId);
      }
      this.recomputeProjectProjection(current.project_id, timestamp);
      this.writeEvent(current.project_id, "job.cancelled", { job_id: jobId }, timestamp);
      const cancelled = jobFromRow(this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(jobId) as SqlRow);
      this.saveIdempotency(ownerId, idempotency, 200, { job: cancelled });
      return cancelled;
    });
    this.notifyEvents();
    return job;
  }

  listScenes(ownerId: string, projectId: string): PrototypeScene[] {
    const rows = this.raw
      .prepare(`
        SELECT s.*, r.revision, r.data_json
        FROM video_storyboard_scenes s
        JOIN video_projects p ON p.id = s.project_id
        JOIN video_scene_revisions r ON r.id = s.current_revision_id
        WHERE s.project_id = ? AND p.owner_id = ?
        ORDER BY s.position
      `)
      .all(projectId, ownerId) as SqlRow[];
    return rows.map((row) => {
      const data = parseJson<PrototypeScene>(row.data_json, {} as PrototypeScene);
      return {
        ...data,
        id: String(row.id),
        position: Number(row.position),
        generation_status: "ready",
        revision: Number(row.revision),
        generation: Number(row.generation),
        locked_revision_id: nullableString(row.locked_revision_id),
        stale_reason: nullableString(row.stale_reason),
      };
    });
  }

  listJobSteps(ownerId: string, jobId: string): Array<Record<string, unknown>> {
    const job = this.getJob(ownerId, jobId);
    if (!job) return [];
    return (this.raw
      .prepare(`
        SELECT id, name, status, attempt, input_fingerprint, output_json,
          error_code, error_message, created_at, updated_at
        FROM video_job_steps WHERE job_id = ? ORDER BY created_at, name
      `)
      .all(jobId) as SqlRow[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        status: String(row.status),
        attempt: Number(row.attempt),
        input_fingerprint: String(row.input_fingerprint),
        output: parseJson<unknown>(row.output_json, null),
        error_code: nullableString(row.error_code),
        error_message: nullableString(row.error_message),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      }));
  }

  listEvents(projectId: string, afterId: number, limit = 200): VideoProjectEvent[] {
    return (
      this.raw
        .prepare(`
          SELECT * FROM video_project_events
          WHERE project_id = ? AND event_id > ? ORDER BY event_id LIMIT ?
        `)
        .all(projectId, afterId, limit) as SqlRow[]
    ).map((row) => ({
      id: Number(row.event_id),
      project_id: String(row.project_id),
      type: String(row.event_type),
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
      created_at: String(row.created_at),
    }));
  }

  claim(
    workerId: string,
    leaseMs: number,
    capacity: Readonly<Record<VideoJobCategory, number>>,
  ): WorkerClaimedJob[] {
    const jobs = this.database.transaction(() => {
      const timestamp = nowIso();
      this.recoverExpiredJobs(timestamp);
      const claimed: WorkerClaimedJob[] = [];
      for (const category of ["media", "text", "image"] as const) {
        if (capacity[category] <= 0) continue;
        const candidates = this.raw
          .prepare(`
            SELECT * FROM video_jobs
            WHERE category = ? AND status IN ('queued', 'retry_wait') AND next_run_at <= ?
            ORDER BY priority DESC, created_at LIMIT ?
          `)
          .all(category, timestamp, capacity[category]) as SqlRow[];
        for (const row of candidates) {
          const jobId = String(row.id);
          if (!this.ensureReservationHeld(jobId, timestamp)) continue;
          const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
          this.raw
            .prepare(`
              UPDATE video_jobs SET status = 'running',
                attempt = CASE WHEN started_at IS NULL THEN attempt + 1 ELSE attempt END,
                started_at = COALESCE(started_at, ?), lease_owner = ?, lease_expires_at = ?,
                heartbeat_at = ?, progress_stage = 'starting', updated_at = ?
              WHERE id = ? AND status IN ('queued', 'retry_wait')
            `)
            .run(timestamp, workerId, leaseExpiresAt, timestamp, timestamp, jobId);
          this.raw
            .prepare("UPDATE video_job_steps SET status = 'running', attempt = attempt + 1, updated_at = ? WHERE job_id = ? AND status = 'queued'")
            .run(timestamp, jobId);
          const claimedRow = this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(jobId) as SqlRow;
          claimed.push(jobFromRow(claimedRow));
          this.writeEvent(String(row.project_id), "job.running", { job_id: jobId, worker_id: workerId }, timestamp);
        }
      }
      return claimed;
    });
    if (jobs.length > 0) this.notifyEvents();
    return jobs;
  }

  heartbeat(workerId: string, leaseMs: number): void {
    const timestamp = nowIso();
    const expiresAt = new Date(Date.now() + leaseMs).toISOString();
    this.database.transaction(() => {
      this.raw
        .prepare(`
          UPDATE video_jobs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
          WHERE status = 'running' AND lease_owner = ?
        `)
        .run(timestamp, expiresAt, timestamp, workerId);
    });
  }

  updateStage(jobId: string, workerId: string, stage: string): boolean {
    return this.database.transaction(() => {
      const result = this.raw
        .prepare(`
          UPDATE video_jobs SET progress_stage = ?, updated_at = ?
          WHERE id = ? AND status = 'running' AND lease_owner = ?
        `)
        .run(stage, nowIso(), jobId, workerId);
      return result.changes === 1;
    });
  }

  markProviderSubmitted(jobId: string, workerId: string, providerRequestId: string): boolean {
    return this.database.transaction(() => {
      const result = this.raw
        .prepare(`
          UPDATE video_jobs SET provider_request_id = ?, progress_stage = 'provider_submitted', updated_at = ?
          WHERE id = ? AND status = 'running' AND lease_owner = ?
        `)
        .run(providerRequestId, nowIso(), jobId, workerId);
      return result.changes === 1;
    });
  }

  complete(job: WorkerClaimedJob, workerId: string, value: unknown): boolean {
    assertPrototypeAnalysisResult(value);
    const result = value;
    const promoted = this.database.transaction(() => {
      const current = this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(job.id) as SqlRow | undefined;
      if (!current || String(current.status) !== "running" || String(current.lease_owner) !== workerId) return false;
      const project = this.raw.prepare("SELECT * FROM video_projects WHERE id = ?").get(job.project_id) as SqlRow;
      const revisionMap = parseJson<Record<string, unknown>>(current.input_revision_map_json, {});
      if (
        Number(project.revision) !== Number(revisionMap.project_revision) ||
        Number(project.generation) !== Number(current.target_generation)
      ) {
        const timestamp = nowIso();
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'superseded', lease_owner = NULL, lease_expires_at = NULL,
              finished_at = ?, updated_at = ? WHERE id = ?
          `)
          .run(timestamp, timestamp, job.id);
        this.releaseReservation(job.id, "superseded", timestamp);
        this.writeEvent(job.project_id, "job.superseded", { job_id: job.id }, timestamp);
        return false;
      }
      const timestamp = nowIso();
      const sourceBlueprintId = randomUUID();
      const profileId = randomUUID();
      const adaptedBlueprintId = randomUUID();
      const sourceVersion = Number((this.raw
        .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM video_blueprints WHERE project_id = ? AND kind = 'source'")
        .get(job.project_id) as SqlRow).version);
      const profileVersion = Number((this.raw
        .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM video_product_profiles WHERE project_id = ?")
        .get(job.project_id) as SqlRow).version);
      const adaptedVersion = Number((this.raw
        .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM video_blueprints WHERE project_id = ? AND kind = 'adapted'")
        .get(job.project_id) as SqlRow).version);
      this.raw
        .prepare(`
          INSERT INTO video_blueprints(
            id, project_id, kind, version, revision, schema_version, data_json, status,
            input_fingerprint, confirmed_at, created_at, updated_at
          ) VALUES (?, ?, 'source', ?, 1, 'source-video-analysis-v1', ?, 'confirmed', ?, ?, ?, ?)
        `)
        .run(
          sourceBlueprintId,
          job.project_id,
          sourceVersion,
          JSON.stringify(result.source_blueprint),
          job.input_fingerprint,
          timestamp,
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          INSERT INTO video_product_profiles(
            id, project_id, version, revision, schema_version, data_json, status,
            input_fingerprint, confirmed_at, created_at, updated_at
          ) VALUES (?, ?, ?, 1, 'product-profile-v1', ?, 'confirmed', ?, ?, ?, ?)
        `)
        .run(
          profileId,
          job.project_id,
          profileVersion,
          JSON.stringify(result.product_profile),
          job.input_fingerprint,
          timestamp,
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          INSERT INTO video_blueprints(
            id, project_id, kind, version, revision, schema_version, data_json, status,
            parent_blueprint_id, product_profile_id, input_fingerprint, confirmed_at, created_at, updated_at
          ) VALUES (?, ?, 'adapted', ?, 1, 'adapted-blueprint-v1', ?, 'confirmed', ?, ?, ?, ?, ?, ?)
        `)
        .run(
          adaptedBlueprintId,
          job.project_id,
          adaptedVersion,
          JSON.stringify(result.adapted_blueprint),
          sourceBlueprintId,
          profileId,
          job.input_fingerprint,
          timestamp,
          timestamp,
          timestamp,
        );
      this.persistArtifactAssetReferences(sourceBlueprintId, "source_blueprint", "source-video-analysis-v1", result.source_blueprint, timestamp);
      this.persistArtifactAssetReferences(profileId, "product_profile", "product-profile-v1", result.product_profile, timestamp);
      this.persistArtifactAssetReferences(adaptedBlueprintId, "adapted_blueprint", "adapted-blueprint-v1", result.adapted_blueprint, timestamp);
      for (const scene of result.scenes) {
        const existingScene = this.raw
          .prepare("SELECT * FROM video_storyboard_scenes WHERE project_id = ? AND position = ?")
          .get(job.project_id, scene.position) as SqlRow | undefined;
        if (existingScene?.locked_revision_id !== null && existingScene?.locked_revision_id !== undefined) continue;
        const sceneId = existingScene ? String(existingScene.id) : scene.id;
        const revision = existingScene
          ? Number((this.raw
              .prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM video_scene_revisions WHERE scene_id = ?")
              .get(sceneId) as SqlRow).revision)
          : 1;
        const generation = existingScene ? Number(existingScene.generation) + 1 : 1;
        const sceneData: PrototypeScene = {
          ...scene,
          id: sceneId,
          revision,
          generation,
          locked_revision_id: null,
          stale_reason: null,
        };
        const revisionId = randomUUID();
        if (existingScene) {
          this.raw
            .prepare(`
              UPDATE video_storyboard_scenes SET adapted_blueprint_id = ?, generation_status = 'ready',
                current_revision_id = ?, generation = ?, stale_reason = NULL, updated_at = ? WHERE id = ?
            `)
            .run(adaptedBlueprintId, revisionId, generation, timestamp, sceneId);
        } else {
          this.raw
            .prepare(`
              INSERT INTO video_storyboard_scenes(
                id, project_id, adapted_blueprint_id, position, generation_status,
                current_revision_id, generation, created_at, updated_at
              ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?)
            `)
            .run(sceneId, job.project_id, adaptedBlueprintId, scene.position, revisionId, generation, timestamp, timestamp);
        }
        this.raw
          .prepare(`
            INSERT INTO video_scene_revisions(
              id, scene_id, revision, schema_version, data_json, input_fingerprint,
              qc_status, source_job_id, created_at
            ) VALUES (?, ?, ?, 'prototype-scene-v1', ?, ?, 'passed', ?, ?)
          `)
          .run(
            revisionId,
            sceneId,
            revision,
            JSON.stringify(sceneData),
            sha256Fingerprint({ job: job.input_fingerprint, scene: sceneData }),
            job.id,
            timestamp,
          );
        this.persistArtifactAssetReferences(revisionId, "scene_revision", "prototype-scene-v1", sceneData, timestamp);
      }
      this.raw
        .prepare(`
          INSERT INTO video_provider_runs(
            id, job_id, capability, provider, model, provider_request_id,
            input_hash, output_hash, created_at, finished_at
          ) VALUES (?, ?, 'prototype_analysis', 'fake', 'deterministic-prototype-v1', ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          job.id,
          nullableString(current.provider_request_id),
          job.input_fingerprint,
          sha256Fingerprint(result),
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          UPDATE video_job_steps SET status = 'succeeded', output_json = ?, updated_at = ?
          WHERE job_id = ?
        `)
        .run(JSON.stringify(result.summary), timestamp, job.id);
      this.raw
        .prepare(`
          UPDATE video_jobs SET status = 'succeeded', progress_stage = 'completed',
            lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(timestamp, timestamp, job.id);
      this.settleReservation(job.id, 1, timestamp);
      this.raw
        .prepare(`
          UPDATE video_projects SET status = 'storyboard_ready', current_step = 'storyboard',
            active_source_blueprint_id = ?, active_product_profile_id = ?,
            active_adapted_blueprint_id = ?, updated_at = ? WHERE id = ?
        `)
        .run(sourceBlueprintId, profileId, adaptedBlueprintId, timestamp, job.project_id);
      this.writeEvent(job.project_id, "job.succeeded", {
        job_id: job.id,
        status: "succeeded",
        scene_count: result.scenes.length,
      }, timestamp);
      return true;
    });
    this.notifyEvents();
    return promoted;
  }

  fail(job: WorkerClaimedJob, workerId: string, failure: WorkerFailure): boolean {
    const changed = this.database.transaction(() => {
      const current = this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(job.id) as SqlRow | undefined;
      if (!current || String(current.status) !== "running" || String(current.lease_owner) !== workerId) return false;
      const timestamp = nowIso();
      if (failure.providerOutcomeUnknown) {
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'retry_wait', next_run_at = ?, lease_owner = NULL,
              lease_expires_at = NULL, error_code = 'PROVIDER_RECONCILIATION_PENDING',
              error_message = ?, error_retryable = 1, progress_stage = 'reconciling', updated_at = ?
            WHERE id = ?
          `)
          .run(new Date(Date.now() + 60_000).toISOString(), failure.message, timestamp, job.id);
        this.raw
          .prepare("UPDATE video_usage_reservations SET status = 'reconciling', reason = ?, updated_at = ? WHERE job_id = ? AND status = 'held'")
          .run(failure.code, timestamp, job.id);
        this.writeEvent(job.project_id, "job.reconciling", {
          job_id: job.id,
          error_code: failure.code,
        }, timestamp);
        return true;
      }
      const retry = failure.retryable && Number(current.attempt) < Number(current.max_attempts);
      if (retry) {
        const delay = Math.min(60_000, 1_000 * 2 ** Math.max(0, Number(current.attempt) - 1));
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'retry_wait', next_run_at = ?, lease_owner = NULL,
              lease_expires_at = NULL, error_code = ?, error_message = ?, error_retryable = 1,
              progress_stage = 'retry_wait', updated_at = ? WHERE id = ?
          `)
          .run(new Date(Date.now() + delay).toISOString(), failure.code, failure.message, timestamp, job.id);
      } else {
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
              error_code = ?, error_message = ?, error_retryable = ?, progress_stage = 'failed',
              finished_at = ?, updated_at = ? WHERE id = ?
          `)
          .run(failure.code, failure.message, Number(failure.retryable), timestamp, timestamp, job.id);
        this.raw
          .prepare("UPDATE video_job_steps SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE job_id = ? AND status = 'running'")
          .run(failure.code, failure.message, timestamp, job.id);
        this.releaseReservation(job.id, "failed", timestamp);
        this.raw
          .prepare("UPDATE video_projects SET status = 'analysis_failed', current_step = 'analysis', updated_at = ? WHERE id = ?")
          .run(timestamp, job.project_id);
      }
      this.writeEvent(job.project_id, retry ? "job.retry_wait" : "job.failed", {
        job_id: job.id,
        error_code: failure.code,
        retryable: retry,
      }, timestamp);
      return true;
    });
    this.notifyEvents();
    return changed;
  }

  releaseOwnedJobs(workerId: string): void {
    const changed = this.database.transaction(() => {
      const rows = this.raw
        .prepare("SELECT * FROM video_jobs WHERE status = 'running' AND lease_owner = ?")
        .all(workerId) as SqlRow[];
      const timestamp = nowIso();
      for (const row of rows) {
        const jobId = String(row.id);
        const projectId = String(row.project_id);
        if (row.provider_request_id === null) {
          this.raw
            .prepare(`
              UPDATE video_jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
                heartbeat_at = NULL, progress_stage = 'queued', updated_at = ? WHERE id = ?
            `)
            .run(timestamp, jobId);
          this.raw
            .prepare("UPDATE video_job_steps SET status = 'queued', updated_at = ? WHERE job_id = ? AND status = 'running'")
            .run(timestamp, jobId);
          this.releaseReservation(jobId, "worker_shutdown", timestamp);
          this.writeEvent(projectId, "job.requeued", { job_id: jobId, reason: "worker_shutdown" }, timestamp);
        } else {
          this.raw
            .prepare(`
              UPDATE video_jobs SET status = 'retry_wait', next_run_at = ?, lease_owner = NULL,
                lease_expires_at = NULL, error_code = 'PROVIDER_RECONCILIATION_PENDING',
                error_message = 'Provider result requires reconciliation after worker shutdown',
                error_retryable = 1, progress_stage = 'reconciling', updated_at = ? WHERE id = ?
            `)
            .run(new Date(Date.now() + 60_000).toISOString(), timestamp, jobId);
          this.raw
            .prepare("UPDATE video_usage_reservations SET status = 'reconciling', reason = ?, updated_at = ? WHERE job_id = ? AND status = 'held'")
            .run("worker_shutdown_after_provider_submission", timestamp, jobId);
          this.writeEvent(projectId, "job.reconciling", { job_id: jobId }, timestamp);
        }
      }
      return rows.length > 0;
    });
    if (changed) this.notifyEvents();
  }

  private recoverExpiredJobs(timestamp: string): void {
    const rows = this.raw
      .prepare("SELECT * FROM video_jobs WHERE status = 'running' AND lease_expires_at <= ?")
      .all(timestamp) as SqlRow[];
    for (const row of rows) {
      const jobId = String(row.id);
      if (row.provider_request_id === null) {
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, progress_stage = 'queued', updated_at = ? WHERE id = ?
          `)
          .run(timestamp, jobId);
        this.releaseReservation(jobId, "lease_expired", timestamp);
      } else {
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'retry_wait', next_run_at = ?, lease_owner = NULL,
              lease_expires_at = NULL, error_code = 'PROVIDER_RECONCILIATION_PENDING',
              error_message = 'Provider result requires reconciliation after lease expiry',
              error_retryable = 1, progress_stage = 'reconciling', updated_at = ? WHERE id = ?
          `)
          .run(new Date(Date.now() + 60_000).toISOString(), timestamp, jobId);
        this.raw
          .prepare("UPDATE video_usage_reservations SET status = 'reconciling', reason = ?, updated_at = ? WHERE job_id = ? AND status = 'held'")
          .run("lease_expired_after_provider_submission", timestamp, jobId);
      }
      this.writeEvent(String(row.project_id), "job.lease_expired", { job_id: jobId }, timestamp);
    }
  }

  private recomputeProjectProjection(projectId: string, timestamp: string): void {
    const counts = this.raw
      .prepare(`
        SELECT
          SUM(CASE WHEN pa.role = 'source_video' AND a.status = 'ready' THEN 1 ELSE 0 END) AS sources,
          SUM(CASE WHEN pa.role = 'product_image' AND a.status = 'ready' THEN 1 ELSE 0 END) AS images
        FROM video_project_assets pa JOIN video_assets a ON a.id = pa.asset_id
        WHERE pa.project_id = ?
      `)
      .get(projectId) as SqlRow;
    const current = this.raw.prepare("SELECT status FROM video_projects WHERE id = ?").get(projectId) as SqlRow;
    if (["analyzing", "storyboard_ready", "analysis_failed"].includes(String(current.status))) return;
    const status = Number(counts.sources ?? 0) > 0 && Number(counts.images ?? 0) > 0
      ? "ready_for_analysis"
      : "draft";
    const step = status === "ready_for_analysis" ? "analysis" : "input";
    this.raw
      .prepare("UPDATE video_projects SET status = ?, current_step = ?, updated_at = ? WHERE id = ?")
      .run(status, step, timestamp, projectId);
  }

  private reserveBudget(ownerId: string, projectId: string, jobId: string, units: number, timestamp: string): void {
    const budget = this.raw
      .prepare("SELECT * FROM video_usage_budgets WHERE owner_id = ? AND project_id = ?")
      .get(ownerId, projectId) as SqlRow;
    if (Number(budget.spent_units) + Number(budget.reserved_units) + units > Number(budget.max_units)) {
      throw new VideoDomainError({
        code: "USAGE_BUDGET_EXCEEDED",
        message: "Project generation budget has been exhausted",
        statusCode: 409,
        details: { job_id: jobId, max_units: Number(budget.max_units) },
      });
    }
    this.raw
      .prepare("UPDATE video_usage_budgets SET reserved_units = reserved_units + ?, updated_at = ? WHERE owner_id = ? AND project_id = ?")
      .run(units, timestamp, ownerId, projectId);
  }

  private ensureReservationHeld(jobId: string, timestamp: string): boolean {
    const reservation = this.raw
      .prepare("SELECT * FROM video_usage_reservations WHERE job_id = ?")
      .get(jobId) as SqlRow | undefined;
    if (!reservation) return false;
    if (String(reservation.status) === "held") return true;
    if (String(reservation.status) !== "released") return false;
    try {
      this.reserveBudget(
        String(reservation.owner_id),
        String(reservation.project_id),
        jobId,
        Number(reservation.units),
        timestamp,
      );
      this.raw
        .prepare("UPDATE video_usage_reservations SET status = 'held', reason = NULL, updated_at = ? WHERE job_id = ?")
        .run(timestamp, jobId);
      return true;
    } catch (error) {
      if (!(error instanceof VideoDomainError) || error.code !== "USAGE_BUDGET_EXCEEDED") throw error;
      this.raw
        .prepare(`
          UPDATE video_jobs SET status = 'failed', error_code = 'USAGE_BUDGET_EXCEEDED',
            error_message = 'Project generation budget has been exhausted', error_retryable = 0,
            finished_at = ?, updated_at = ? WHERE id = ?
        `)
        .run(timestamp, timestamp, jobId);
      return false;
    }
  }

  private releaseReservation(jobId: string, reason: string, timestamp: string): void {
    const reservation = this.raw
      .prepare("SELECT * FROM video_usage_reservations WHERE job_id = ? AND status = 'held'")
      .get(jobId) as SqlRow | undefined;
    if (!reservation) return;
    this.raw
      .prepare(`
        UPDATE video_usage_budgets SET reserved_units = MAX(0, reserved_units - ?), updated_at = ?
        WHERE owner_id = ? AND project_id = ?
      `)
      .run(
        Number(reservation.units),
        timestamp,
        String(reservation.owner_id),
        String(reservation.project_id),
      );
    this.raw
      .prepare("UPDATE video_usage_reservations SET status = 'released', reason = ?, updated_at = ? WHERE job_id = ?")
      .run(reason, timestamp, jobId);
  }

  private settleReservation(jobId: string, actualUnits: number, timestamp: string): void {
    const reservation = this.raw
      .prepare("SELECT * FROM video_usage_reservations WHERE job_id = ? AND status = 'held'")
      .get(jobId) as SqlRow | undefined;
    if (!reservation) throw new Error(`Held reservation missing for ${jobId}`);
    this.raw
      .prepare(`
        UPDATE video_usage_budgets SET reserved_units = MAX(0, reserved_units - ?),
          spent_units = spent_units + ?, updated_at = ? WHERE owner_id = ? AND project_id = ?
      `)
      .run(
        Number(reservation.units),
        actualUnits,
        timestamp,
        String(reservation.owner_id),
        String(reservation.project_id),
      );
    this.raw
      .prepare(`
        UPDATE video_usage_reservations SET status = 'settled', actual_units = ?, reason = NULL,
          updated_at = ? WHERE job_id = ?
      `)
      .run(actualUnits, timestamp, jobId);
  }

  private persistArtifactAssetReferences(
    artifactId: string,
    refType: string,
    schemaVersion: ArtifactSchemaVersion,
    value: unknown,
    timestamp: string,
  ): void {
    for (const assetId of extractSchemaAssetReferences(schemaVersion, value)) {
      const exists = this.raw.prepare("SELECT 1 FROM video_assets WHERE id = ?").get(assetId);
      if (!exists) {
        throw new VideoDomainError({
          code: "ASSET_REFERENCE_INVALID",
          message: `Artifact references unknown asset ${assetId}`,
        });
      }
      this.raw
        .prepare(`
          INSERT OR IGNORE INTO video_asset_references(asset_id, ref_type, ref_id, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(assetId, refType, artifactId, timestamp);
    }
  }

  private idempotencyReplay<T>(ownerId: string, input: IdempotencyInput): { status: number; body: T } | null {
    this.raw.prepare("DELETE FROM video_idempotency_records WHERE expires_at <= ?").run(nowIso());
    const row = this.raw
      .prepare("SELECT * FROM video_idempotency_records WHERE owner_id = ? AND scope = ? AND key = ?")
      .get(ownerId, input.scope, input.key) as SqlRow | undefined;
    if (!row) return null;
    if (String(row.request_hash) !== input.requestHash) {
      throw new VideoDomainError({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "Idempotency-Key was already used with a different request body",
        statusCode: 409,
      });
    }
    return { status: Number(row.response_status), body: parseJson<T>(row.response_json, {} as T) };
  }

  private saveIdempotency(ownerId: string, input: IdempotencyInput, status: number, body: unknown): string {
    const id = randomUUID();
    const timestamp = nowIso();
    this.raw
      .prepare(`
        INSERT INTO video_idempotency_records(
          id, owner_id, scope, key, request_hash, response_status, response_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        ownerId,
        input.scope,
        input.key,
        input.requestHash,
        status,
        JSON.stringify(body),
        timestamp,
        new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      );
    return id;
  }

  private writeEvent(projectId: string, type: string, payload: Record<string, unknown>, timestamp: string): number {
    this.raw.prepare("UPDATE video_event_cursor SET last_event_id = last_event_id + 1 WHERE singleton = 1").run();
    const cursor = this.raw.prepare("SELECT last_event_id FROM video_event_cursor WHERE singleton = 1").get() as SqlRow;
    const eventId = Number(cursor.last_event_id);
    this.raw
      .prepare(`
        INSERT INTO video_project_events(event_id, project_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(eventId, projectId, type, JSON.stringify(payload), timestamp);
    return eventId;
  }

  private getProjectAsset(ownerId: string, projectId: string, assetId: string): VideoAsset | null {
    const row = this.raw
      .prepare(`
        SELECT a.*, pa.project_id, pa.role, pa.sort_order, pa.is_primary
        FROM video_project_assets pa JOIN video_assets a ON a.id = pa.asset_id
        WHERE pa.project_id = ? AND pa.asset_id = ? AND a.owner_id = ?
      `)
      .get(projectId, assetId, ownerId) as SqlRow | undefined;
    return row ? assetFromRow(row) : null;
  }

  private getUploadInCurrentConnection(ownerId: string, uploadId: string): UploadSessionPrivate | null {
    const row = this.raw
      .prepare("SELECT * FROM video_upload_sessions WHERE id = ? AND owner_id = ?")
      .get(uploadId, ownerId) as SqlRow | undefined;
    return row ? uploadFromRow(row) : null;
  }

  private requireUpload(ownerId: string, uploadId: string): UploadSessionPrivate {
    const upload = this.getUploadInCurrentConnection(ownerId, uploadId);
    if (!upload) throw new VideoDomainError({ code: "UPLOAD_NOT_FOUND", message: "Upload session not found", statusCode: 404 });
    return upload;
  }
}
