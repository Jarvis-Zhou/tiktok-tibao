import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  VideoDomainError,
  assertPrototypeAnalysisResult,
  extractSchemaAssetReferences,
  sha256Fingerprint,
  type ArtifactSchemaVersion,
  type AdaptedBlueprint,
  type CatalogContext,
  type ExportKind,
  type ProductProfile,
  type PromptPackageManifest,
  type PrototypeAnalysisResult,
  type PrototypeScene,
  type SourceVideoAnalysis,
  type StoryboardQcStatus,
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
import { VIDEO_MIGRATION_002 } from "../migrations/002-phase-b.js";
import type { PromptPackageSnapshot, PromptPackageSnapshotScene } from "../export/prompt-package.js";

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
  analysis: ProjectAnalysisArtifacts;
}

export interface ActiveProjectArtifact<T> {
  id: string;
  version: number;
  revision: number;
  schema_version: string;
  status: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  data: T;
}

export interface ProjectProviderRun {
  provider: string;
  model: string;
  provider_request_id: string | null;
  status: string;
  usage: Record<string, number>;
  estimated_cost_micros: number | null;
  latency_ms: number | null;
  safety: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

export interface ProjectAnalysisArtifacts {
  source_blueprint: ActiveProjectArtifact<SourceVideoAnalysis> | null;
  product_profile: ActiveProjectArtifact<ProductProfile> | null;
  adapted_blueprint: ActiveProjectArtifact<AdaptedBlueprint> | null;
  provider_run: ProjectProviderRun | null;
}

export interface VideoProjectEvent {
  id: number;
  project_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface GeneratedAssetDescriptor {
  storageKey: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
}

export interface PrototypeAnalysisWorkerResult {
  kind: "prototype_analysis";
  result: PrototypeAnalysisResult;
  provider: string;
  model: string;
  providerRequestId: string | null;
  usage: Record<string, number>;
  estimatedCostMicros: number;
  latencyMs: number;
  safety: Record<string, unknown>;
}

export interface SceneGenerationWorkerResult {
  kind: "scene_storyboard";
  sceneId: string;
  revisionId: string;
  generation: number;
  asset: GeneratedAssetDescriptor;
  qc: {
    status: "passed" | "needs_review";
    productPresence: number;
    visualConsistency: number;
    textAnomaly: number;
  };
  provider: string;
  model: string;
}

export interface PromptPackageWorkerResult {
  kind: "prompt_package_export";
  exportId: string;
  asset: GeneratedAssetDescriptor;
  manifest: PromptPackageManifest;
}

export interface VideoExportRecord {
  id: string;
  project_id: string;
  kind: ExportKind;
  status: "queued" | "building" | "ready" | "failed";
  job_id: string | null;
  asset_id: string | null;
  manifest: PromptPackageManifest | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  ready_at: string | null;
  updated_at: string;
}

export interface SceneRevisionPatch {
  headline?: string;
  overlay?: string;
  caption?: string;
  script?: string;
  prompt?: string;
  duration_sec?: number;
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
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
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

function exportFromRow(row: SqlRow): VideoExportRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    kind: String(row.kind) as ExportKind,
    status: String(row.status) as VideoExportRecord["status"],
    job_id: nullableString(row.job_id),
    asset_id: nullableString(row.asset_id),
    manifest: parseJson<PromptPackageManifest | null>(row.manifest_json, null),
    error_code: nullableString(row.error_code),
    error_message: nullableString(row.error_message),
    created_at: String(row.created_at),
    ready_at: nullableString(row.ready_at),
    updated_at: String(row.updated_at),
  };
}

function sceneFromJoinedRow(row: SqlRow): PrototypeScene {
  const data = parseJson<PrototypeScene>(row.data_json, {} as PrototypeScene);
  return {
    ...data,
    id: String(row.id),
    position: Number(row.position),
    generation_status: String(row.generation_status) as PrototypeScene["generation_status"],
    revision: Number(row.revision),
    generation: Number(row.generation),
    locked_revision_id: nullableString(row.locked_revision_id),
    current_revision_id: nullableString(row.revision_id),
    stale_reason: nullableString(row.stale_reason),
    qc_status: String(row.qc_status) as StoryboardQcStatus,
    storyboard_asset_id: nullableString(data.storyboard_asset_id),
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
    for (const migration of [VIDEO_MIGRATION_001, VIDEO_MIGRATION_002]) {
      const applied = this.raw
        .prepare("SELECT 1 FROM video_schema_migrations WHERE version = ?")
        .get(migration.version);
      if (applied) continue;
      this.database.transaction(() => {
        this.raw.exec(migration.sql);
        this.raw
          .prepare("INSERT INTO video_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, nowIso());
      });
    }
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
      analysis: this.getProjectAnalysis(ownerId, projectId),
    };
  }

  getProjectAnalysis(ownerId: string, projectId: string): ProjectAnalysisArtifacts {
    const project = this.raw
      .prepare(`
        SELECT active_source_blueprint_id, active_product_profile_id, active_adapted_blueprint_id
        FROM video_projects
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
      `)
      .get(projectId, ownerId) as SqlRow | undefined;
    if (!project) {
      return {
        source_blueprint: null,
        product_profile: null,
        adapted_blueprint: null,
        provider_run: null,
      };
    }

    const source = project.active_source_blueprint_id
      ? this.raw.prepare("SELECT * FROM video_blueprints WHERE id = ? AND project_id = ? AND kind = 'source'")
          .get(String(project.active_source_blueprint_id), projectId) as SqlRow | undefined
      : undefined;
    const product = project.active_product_profile_id
      ? this.raw.prepare("SELECT * FROM video_product_profiles WHERE id = ? AND project_id = ?")
          .get(String(project.active_product_profile_id), projectId) as SqlRow | undefined
      : undefined;
    const adapted = project.active_adapted_blueprint_id
      ? this.raw.prepare("SELECT * FROM video_blueprints WHERE id = ? AND project_id = ? AND kind = 'adapted'")
          .get(String(project.active_adapted_blueprint_id), projectId) as SqlRow | undefined
      : undefined;
    const provider = this.raw
      .prepare(`
        SELECT r.* FROM video_provider_runs r
        JOIN video_jobs j ON j.id = r.job_id
        WHERE j.project_id = ? AND r.capability = 'prototype_analysis'
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      `)
      .get(projectId) as SqlRow | undefined;

    const artifact = <T>(row: SqlRow | undefined): ActiveProjectArtifact<T> | null => row ? {
      id: String(row.id),
      version: Number(row.version),
      revision: Number(row.revision),
      schema_version: String(row.schema_version),
      status: String(row.status),
      confirmed_at: nullableString(row.confirmed_at),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      data: parseJson<T>(row.data_json, {} as T),
    } : null;

    return {
      source_blueprint: artifact<SourceVideoAnalysis>(source),
      product_profile: artifact<ProductProfile>(product),
      adapted_blueprint: artifact<AdaptedBlueprint>(adapted),
      provider_run: provider ? {
        provider: String(provider.provider),
        model: String(provider.model),
        provider_request_id: nullableString(provider.provider_request_id),
        status: String(provider.status),
        usage: parseJson<Record<string, number>>(provider.usage_json, {}),
        estimated_cost_micros: provider.estimated_cost_micros === null || provider.estimated_cost_micros === undefined
          ? null
          : Number(provider.estimated_cost_micros),
        latency_ms: provider.latency_ms === null || provider.latency_ms === undefined
          ? null
          : Number(provider.latency_ms),
        safety: parseJson<Record<string, unknown>>(provider.safety_json, {}),
        created_at: String(provider.created_at),
        finished_at: nullableString(provider.finished_at),
      } : null,
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

  completeUpload(ownerId: string, uploadId: string, input: {
    detectedMime: string;
    storageKey: string;
    width: number;
    height: number;
    durationMs: number | null;
    metadata: Record<string, unknown>;
  }): VideoAsset {
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
            width = ?, height = ?, duration_ms = ?, metadata_json = ?,
            status = 'ready', updated_at = ? WHERE id = ?
        `)
        .run(
          input.storageKey,
          upload.receivedSha256,
          input.detectedMime,
          upload.receivedBytes,
          input.width,
          input.height,
          input.durationMs,
          JSON.stringify(input.metadata),
          timestamp,
          upload.assetId,
        );
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

  getJobTarget(ownerId: string, jobId: string): { type: VideoJob["type"]; targetId: string; projectId: string } | null {
    const row = this.raw
      .prepare(`
        SELECT j.type, j.target_id, j.project_id FROM video_jobs j
        JOIN video_projects p ON p.id = j.project_id
        WHERE j.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL
      `)
      .get(jobId, ownerId) as SqlRow | undefined;
    return row ? { type: String(row.type) as VideoJob["type"], targetId: String(row.target_id), projectId: String(row.project_id) } : null;
  }

  prototypeAnalysisInput(job: WorkerClaimedJob): {
    projectId: string;
    projectName: string;
    targetMarket: string;
    language: string;
    targetDurationSec: number | null;
    similarityScore: number;
    sourceAssetId: string;
    sourceStorageKey: string;
    sourceDurationSec: number;
    sourceWidth: number;
    sourceHeight: number;
    audioAvailable: boolean;
    productAssetIds: string[];
    productStorageKeys: string[];
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
    const sourceRow = this.raw.prepare("SELECT storage_key, metadata_json FROM video_assets WHERE id = ?").get(source.id) as SqlRow;
    const sourceMetadata = parseJson<Record<string, unknown>>(sourceRow.metadata_json, {});
    const sourceStorageKey = nullableString(sourceRow.storage_key);
    const productStorageKeys = productAssetIds.map((assetId) => {
      const row = this.raw.prepare("SELECT storage_key FROM video_assets WHERE id = ?").get(assetId) as SqlRow | undefined;
      return row ? nullableString(row.storage_key) : null;
    });
    if (
      !sourceStorageKey || !source.duration_ms || !source.width || !source.height ||
      productStorageKeys.some((storageKey) => storageKey === null)
    ) {
      throw new VideoDomainError({ code: "SOURCE_FILE_INVALID", message: "Verified video metadata is missing" });
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
      sourceStorageKey,
      sourceDurationSec: source.duration_ms / 1_000,
      sourceWidth: source.width,
      sourceHeight: source.height,
      audioAvailable: sourceMetadata.has_audio === true,
      productAssetIds,
      productStorageKeys: productStorageKeys as string[],
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
      if (String(row.type) === "scene_storyboard") {
        this.raw.prepare("UPDATE video_storyboard_scenes SET generation_status = 'failed', updated_at = ? WHERE id = ? AND generation = ?")
          .run(timestamp, String(row.target_id), Number(row.target_generation));
        this.recomputeStoryboardProjection(current.project_id, timestamp);
      } else if (String(row.type) === "prompt_package_export") {
        this.raw.prepare("UPDATE video_exports SET status = 'failed', error_code = 'CANCELLED', error_message = 'Export cancelled', updated_at = ? WHERE id = ?")
          .run(timestamp, String(row.target_id));
        this.recomputeStoryboardProjection(current.project_id, timestamp);
      } else {
        this.recomputeProjectProjection(current.project_id, timestamp);
      }
      this.writeEvent(current.project_id, "job.cancelled", { job_id: jobId }, timestamp);
      const cancelled = jobFromRow(this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(jobId) as SqlRow);
      this.saveIdempotency(ownerId, idempotency, 200, { job: cancelled });
      return cancelled;
    });
    this.notifyEvents();
    return job;
  }

  getScene(ownerId: string, sceneId: string, projectId?: string): PrototypeScene | null {
    const row = this.raw
      .prepare(`
        SELECT s.*, r.id AS revision_id, r.revision, r.data_json, r.qc_status
        FROM video_storyboard_scenes s
        JOIN video_projects p ON p.id = s.project_id
        JOIN video_scene_revisions r ON r.id = s.current_revision_id
        WHERE s.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL
          AND (? IS NULL OR s.project_id = ?)
      `)
      .get(sceneId, ownerId, projectId ?? null, projectId ?? null) as SqlRow | undefined;
    return row ? sceneFromJoinedRow(row) : null;
  }

  updateScene(
    ownerId: string,
    sceneId: string,
    expectedRevision: number,
    patch: SceneRevisionPatch,
    idempotency: IdempotencyInput,
  ): PrototypeScene {
    const updated = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ scene: PrototypeScene }>(ownerId, idempotency);
      if (replay) return replay.body.scene;
      const row = this.raw
        .prepare(`
          SELECT s.*, p.owner_id, r.id AS revision_id, r.revision, r.data_json
          FROM video_storyboard_scenes s
          JOIN video_projects p ON p.id = s.project_id
          JOIN video_scene_revisions r ON r.id = s.current_revision_id
          WHERE s.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL
        `)
        .get(sceneId, ownerId) as SqlRow | undefined;
      if (!row) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
      if (Number(row.revision) !== expectedRevision) {
        throw new VideoDomainError({
          code: "REVISION_CONFLICT",
          message: "The scene was modified by another request",
          statusCode: 409,
          details: { current_revision: Number(row.revision) },
        });
      }
      if (row.locked_revision_id !== null) {
        throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "Unlock the scene before editing it", statusCode: 409 });
      }
      const previous = parseJson<PrototypeScene>(row.data_json, {} as PrototypeScene);
      const revision = expectedRevision + 1;
      const revisionId = randomUUID();
      const timestamp = nowIso();
      const data: PrototypeScene = {
        ...previous,
        ...patch,
        id: sceneId,
        revision,
        current_revision_id: revisionId,
        locked_revision_id: null,
        generation_status: "stale",
        stale_reason: "scene_edited",
        qc_status: "pending",
        storyboard_asset_id: null,
      };
      this.raw
        .prepare(`
          INSERT INTO video_scene_revisions(
            id, scene_id, revision, schema_version, data_json, input_fingerprint,
            qc_status, source_job_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'storyboard-scene-v1', ?, ?, 'pending', NULL, ?, ?)
        `)
        .run(revisionId, sceneId, revision, JSON.stringify(data), sha256Fingerprint(data), timestamp, timestamp);
      this.raw
        .prepare(`
          UPDATE video_storyboard_scenes SET current_revision_id = ?, generation_status = 'stale',
            stale_reason = 'scene_edited', updated_at = ? WHERE id = ?
        `)
        .run(revisionId, timestamp, sceneId);
      this.writeEvent(String(row.project_id), "scene.updated", {
        scene_id: sceneId,
        revision,
        generation_status: "stale",
      }, timestamp);
      const result = this.getScene(ownerId, sceneId);
      if (!result) throw new Error("Updated scene could not be reloaded");
      this.saveIdempotency(ownerId, idempotency, 200, { scene: result });
      return result;
    });
    this.notifyEvents();
    return updated;
  }

  enqueueStoryboardBatch(input: {
    ownerId: string;
    projectId: string;
    expectedProjectRevision: number;
    idempotency: IdempotencyInput;
  }): { jobs: VideoJob[]; scenes: PrototypeScene[]; reused: boolean } {
    const result = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ jobs: VideoJob[]; scenes: PrototypeScene[] }>(input.ownerId, input.idempotency);
      if (replay) return { ...replay.body, reused: true };
      const project = this.raw
        .prepare("SELECT * FROM video_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
        .get(input.projectId, input.ownerId) as SqlRow | undefined;
      if (!project) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
      if (Number(project.revision) !== input.expectedProjectRevision) {
        throw new VideoDomainError({ code: "REVISION_CONFLICT", message: "Project revision changed", statusCode: 409, details: { current_revision: Number(project.revision) } });
      }
      if (!project.active_adapted_blueprint_id) {
        throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "A confirmed Adapted Blueprint is required", statusCode: 409 });
      }
      const candidates = this.raw
        .prepare(`
          SELECT s.*, r.id AS revision_id, r.revision, r.data_json
          FROM video_storyboard_scenes s JOIN video_scene_revisions r ON r.id = s.current_revision_id
          WHERE s.project_id = ? AND s.locked_revision_id IS NULL
            AND s.generation_status IN ('not_generated', 'stale', 'failed')
          ORDER BY s.position
        `)
        .all(input.projectId) as SqlRow[];
      if (candidates.length === 0) {
        throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "No unlocked scenes currently require storyboard generation", statusCode: 409 });
      }
      const active = this.raw
        .prepare(`
          SELECT 1 FROM video_jobs WHERE project_id = ? AND type = 'scene_storyboard'
            AND status IN ('queued', 'running', 'retry_wait') LIMIT 1
        `)
        .get(input.projectId);
      if (active) throw new VideoDomainError({ code: "JOB_ALREADY_RUNNING", message: "Storyboard generation is already running", statusCode: 409 });
      const timestamp = nowIso();
      this.reserveBudget(input.ownerId, input.projectId, `storyboard-batch:${randomUUID()}`, candidates.length, timestamp);
      const jobs: VideoJob[] = [];
      for (const row of candidates) {
        const jobId = randomUUID();
        const sceneId = String(row.id);
        const generation = Number(row.generation) + 1;
        const revisionMap = { scene_revision_id: String(row.revision_id), scene_revision: Number(row.revision) };
        const fingerprint = sha256Fingerprint({ revisionMap, generation, data: parseJson(row.data_json, {}) });
        this.raw
          .prepare(`
            INSERT INTO video_jobs(
              id, project_id, type, category, target_type, target_id, status, priority,
              input_revision_map_json, input_fingerprint, target_generation, attempt,
              max_attempts, next_run_at, progress_stage, created_at, updated_at
            ) VALUES (?, ?, 'scene_storyboard', 'image', 'scene', ?, 'queued', 10,
              ?, ?, ?, 0, 3, ?, 'queued', ?, ?)
          `)
          .run(jobId, input.projectId, sceneId, JSON.stringify(revisionMap), fingerprint, generation, timestamp, timestamp, timestamp);
        this.raw
          .prepare(`
            INSERT INTO video_usage_reservations(id, owner_id, project_id, job_id, units, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, 'held', ?, ?)
          `)
          .run(randomUUID(), input.ownerId, input.projectId, jobId, timestamp, timestamp);
        this.raw
          .prepare(`
            INSERT INTO video_job_steps(id, job_id, name, status, input_fingerprint, created_at, updated_at)
            VALUES (?, ?, 'storyboard_image', 'queued', ?, ?, ?)
          `)
          .run(randomUUID(), jobId, fingerprint, timestamp, timestamp);
        this.raw
          .prepare("UPDATE video_storyboard_scenes SET generation = ?, generation_status = 'queued', stale_reason = NULL, updated_at = ? WHERE id = ?")
          .run(generation, timestamp, sceneId);
        jobs.push(jobFromRow(this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(jobId) as SqlRow));
        this.writeEvent(input.projectId, "scene.generation.queued", { scene_id: sceneId, job_id: jobId, generation }, timestamp);
      }
      this.raw.prepare("UPDATE video_projects SET status = 'generating_storyboard', current_step = 'storyboard', updated_at = ? WHERE id = ?")
        .run(timestamp, input.projectId);
      const scenes = this.listScenes(input.ownerId, input.projectId);
      this.saveIdempotency(input.ownerId, input.idempotency, 202, { jobs, scenes });
      this.writeEvent(input.projectId, "storyboard.batch.queued", { job_ids: jobs.map((job) => job.id), scene_count: jobs.length }, timestamp);
      return { jobs, scenes, reused: false };
    });
    this.notifyEvents();
    return result;
  }

  enqueueSceneGeneration(input: {
    ownerId: string;
    sceneId: string;
    expectedRevision: number;
    idempotency: IdempotencyInput;
    retryOfJobId?: string;
    regenerationScope?: string;
  }): { job: VideoJob; scene: PrototypeScene; reused: boolean } {
    const result = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ job: VideoJob; scene: PrototypeScene }>(input.ownerId, input.idempotency);
      if (replay) return { ...replay.body, reused: true };
      const row = this.raw
        .prepare(`
          SELECT s.*, p.owner_id, r.id AS revision_id, r.revision, r.data_json
          FROM video_storyboard_scenes s
          JOIN video_projects p ON p.id = s.project_id
          JOIN video_scene_revisions r ON r.id = s.current_revision_id
          WHERE s.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL
        `)
        .get(input.sceneId, input.ownerId) as SqlRow | undefined;
      if (!row) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
      if (Number(row.revision) !== input.expectedRevision) {
        throw new VideoDomainError({ code: "REVISION_CONFLICT", message: "Scene revision changed", statusCode: 409, details: { current_revision: Number(row.revision) } });
      }
      if (row.locked_revision_id !== null) {
        throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "Unlock the scene before regenerating it", statusCode: 409 });
      }
      const existingJob = this.raw
        .prepare(`
          SELECT * FROM video_jobs WHERE type = 'scene_storyboard' AND target_id = ?
            AND status IN ('queued', 'running', 'retry_wait') ORDER BY created_at DESC LIMIT 1
        `)
        .get(input.sceneId) as SqlRow | undefined;
      if (existingJob) {
        const job = jobFromRow(existingJob);
        const scene = this.getScene(input.ownerId, input.sceneId)!;
        this.saveIdempotency(input.ownerId, input.idempotency, 202, { job, scene });
        return { job, scene, reused: true };
      }
      const timestamp = nowIso();
      const jobId = randomUUID();
      const generation = Number(row.generation) + 1;
      const revisionMap = {
        scene_revision_id: String(row.revision_id),
        scene_revision: Number(row.revision),
        regeneration_scope: input.regenerationScope ?? "rebuild_from_current_fields",
      };
      const fingerprint = sha256Fingerprint({ revisionMap, generation, data: parseJson(row.data_json, {}) });
      this.reserveBudget(input.ownerId, String(row.project_id), jobId, 1, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_jobs(
            id, project_id, type, category, target_type, target_id, status, priority,
            input_revision_map_json, input_fingerprint, target_generation, retry_of_job_id, attempt,
            max_attempts, next_run_at, progress_stage, created_at, updated_at
          ) VALUES (?, ?, 'scene_storyboard', 'image', 'scene', ?, 'queued', 10,
            ?, ?, ?, ?, 0, 3, ?, 'queued', ?, ?)
        `)
        .run(jobId, String(row.project_id), input.sceneId, JSON.stringify(revisionMap), fingerprint, generation, input.retryOfJobId ?? null, timestamp, timestamp, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_usage_reservations(id, owner_id, project_id, job_id, units, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, 'held', ?, ?)
        `)
        .run(randomUUID(), input.ownerId, String(row.project_id), jobId, timestamp, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_job_steps(id, job_id, name, status, input_fingerprint, created_at, updated_at)
          VALUES (?, ?, 'storyboard_image', 'queued', ?, ?, ?)
        `)
        .run(randomUUID(), jobId, fingerprint, timestamp, timestamp);
      this.raw
        .prepare(`
          UPDATE video_storyboard_scenes SET generation = ?, generation_status = 'queued',
            stale_reason = NULL, updated_at = ? WHERE id = ?
        `)
        .run(generation, timestamp, input.sceneId);
      this.raw
        .prepare("UPDATE video_projects SET status = 'generating_storyboard', current_step = 'storyboard', updated_at = ? WHERE id = ?")
        .run(timestamp, String(row.project_id));
      const job = jobFromRow(this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(jobId) as SqlRow);
      const scene = this.getScene(input.ownerId, input.sceneId)!;
      const recordId = this.saveIdempotency(input.ownerId, input.idempotency, 202, { job, scene });
      this.raw.prepare("UPDATE video_jobs SET idempotency_record_id = ? WHERE id = ?").run(recordId, jobId);
      this.writeEvent(String(row.project_id), "scene.generation.queued", { scene_id: input.sceneId, job_id: jobId, generation }, timestamp);
      return { job, scene, reused: false };
    });
    this.notifyEvents();
    return result;
  }

  sceneGenerationInput(job: WorkerClaimedJob): {
    projectId: string;
    sceneId: string;
    revisionId: string;
    generation: number;
    imagePrompt: string;
    negativePrompt: string;
    productStorageKeys: string[];
  } {
    const targetSceneId = this.raw.prepare("SELECT target_id FROM video_jobs WHERE id = ?").get(job.id) as SqlRow | undefined;
    const sceneId = targetSceneId ? String(targetSceneId.target_id) : "";
    const actual = this.raw
      .prepare(`
        SELECT s.current_revision_id, s.generation, r.data_json
        FROM video_storyboard_scenes s JOIN video_scene_revisions r ON r.id = s.current_revision_id
        WHERE s.id = ? AND s.project_id = ?
      `)
      .get(sceneId, job.project_id) as SqlRow | undefined;
    if (!actual) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
    const data = parseJson<Record<string, unknown>>(actual.data_json, {});
    const productStorageKeys = (
      this.raw
        .prepare(`
          SELECT a.storage_key FROM video_assets a
          JOIN video_project_assets pa ON pa.asset_id = a.id
          WHERE pa.project_id = ? AND pa.role = 'product_image' AND a.status = 'ready' AND a.storage_key IS NOT NULL
          ORDER BY pa.sort_order, a.created_at
        `)
        .all(job.project_id) as SqlRow[]
    ).map((row) => String(row.storage_key));
    return {
      projectId: job.project_id,
      sceneId,
      revisionId: String(actual.current_revision_id),
      generation: Number(actual.generation),
      imagePrompt: String(data.image_prompt ?? data.prompt ?? ""),
      negativePrompt: String(data.negative_prompt ?? "logos, watermarks, copied identity, unsupported claims"),
      productStorageKeys,
    };
  }

  lockScene(
    ownerId: string,
    sceneId: string,
    expectedRevision: number,
    idempotency: IdempotencyInput,
  ): PrototypeScene {
    const scene = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ scene: PrototypeScene }>(ownerId, idempotency);
      if (replay) return replay.body.scene;
      const current = this.getScene(ownerId, sceneId);
      if (!current) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
      if (current.revision !== expectedRevision) throw new VideoDomainError({ code: "REVISION_CONFLICT", message: "Scene revision changed", statusCode: 409 });
      if (current.generation_status !== "ready" || current.stale_reason || !current.storyboard_asset_id) {
        throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "Only a current ready storyboard can be locked", statusCode: 409 });
      }
      if (!(current.qc_status === "passed" || current.qc_status === "accepted")) {
        throw new VideoDomainError({ code: "QC_ACCEPTANCE_REQUIRED", message: "Resolve or accept scene QC before locking", statusCode: 409 });
      }
      const timestamp = nowIso();
      this.raw.prepare("UPDATE video_storyboard_scenes SET locked_revision_id = current_revision_id, updated_at = ? WHERE id = ?").run(timestamp, sceneId);
      const locked = this.getScene(ownerId, sceneId)!;
      this.writeEvent(this.projectIdForScene(sceneId), "scene.locked", { scene_id: sceneId, revision: locked.revision }, timestamp);
      this.saveIdempotency(ownerId, idempotency, 200, { scene: locked });
      return locked;
    });
    this.notifyEvents();
    return scene;
  }

  unlockScene(ownerId: string, sceneId: string, idempotency: IdempotencyInput): PrototypeScene {
    const scene = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ scene: PrototypeScene }>(ownerId, idempotency);
      if (replay) return replay.body.scene;
      const current = this.getScene(ownerId, sceneId);
      if (!current) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
      const timestamp = nowIso();
      this.raw.prepare("UPDATE video_storyboard_scenes SET locked_revision_id = NULL, updated_at = ? WHERE id = ?").run(timestamp, sceneId);
      const unlocked = this.getScene(ownerId, sceneId)!;
      this.writeEvent(this.projectIdForScene(sceneId), "scene.unlocked", { scene_id: sceneId }, timestamp);
      this.saveIdempotency(ownerId, idempotency, 200, { scene: unlocked });
      return unlocked;
    });
    this.notifyEvents();
    return scene;
  }

  acceptSceneQc(input: {
    ownerId: string;
    sceneId: string;
    expectedRevision: number;
    reason: string;
    requestId: string;
    idempotency: IdempotencyInput;
  }): PrototypeScene {
    const scene = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ scene: PrototypeScene }>(input.ownerId, input.idempotency);
      if (replay) return replay.body.scene;
      const current = this.getScene(input.ownerId, input.sceneId);
      if (!current) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
      if (current.revision !== input.expectedRevision) throw new VideoDomainError({ code: "REVISION_CONFLICT", message: "Scene revision changed", statusCode: 409 });
      if (current.qc_status !== "needs_review" || !current.current_revision_id) {
        throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "Scene QC does not require acceptance", statusCode: 409 });
      }
      const timestamp = nowIso();
      this.raw
        .prepare(`
          INSERT INTO video_qc_acceptances(id, owner_id, project_id, scene_id, scene_revision_id, reason, request_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), input.ownerId, this.projectIdForScene(input.sceneId), input.sceneId, current.current_revision_id, input.reason, input.requestId, timestamp);
      this.raw.prepare("UPDATE video_scene_revisions SET qc_status = 'accepted', updated_at = ? WHERE id = ?").run(timestamp, current.current_revision_id);
      this.raw.prepare("UPDATE video_storyboard_scenes SET generation_status = 'ready', updated_at = ? WHERE id = ?").run(timestamp, input.sceneId);
      const accepted = this.getScene(input.ownerId, input.sceneId)!;
      this.writeEvent(this.projectIdForScene(input.sceneId), "scene.qc.accepted", { scene_id: input.sceneId, revision: accepted.revision }, timestamp);
      this.saveIdempotency(input.ownerId, input.idempotency, 200, { scene: accepted });
      return accepted;
    });
    this.notifyEvents();
    return scene;
  }

  listScenes(ownerId: string, projectId: string): PrototypeScene[] {
    const rows = this.raw
      .prepare(`
        SELECT s.*, r.id AS revision_id, r.revision, r.data_json, r.qc_status
        FROM video_storyboard_scenes s
        JOIN video_projects p ON p.id = s.project_id
        JOIN video_scene_revisions r ON r.id = s.current_revision_id
        WHERE s.project_id = ? AND p.owner_id = ?
        ORDER BY s.position
      `)
      .all(projectId, ownerId) as SqlRow[];
    return rows.map(sceneFromJoinedRow);
  }

  enqueuePromptPackageExport(input: {
    ownerId: string;
    projectId: string;
    kind: ExportKind;
    idempotency: IdempotencyInput;
    retryOfJobId?: string;
  }): { export: VideoExportRecord; job: VideoJob; reused: boolean } {
    const result = this.database.transaction(() => {
      const replay = this.idempotencyReplay<{ export: VideoExportRecord; job: VideoJob }>(input.ownerId, input.idempotency);
      if (replay) return { ...replay.body, reused: true };
      const exportId = randomUUID();
      const timestamp = nowIso();
      const snapshot = this.buildPromptPackageSnapshot(input.ownerId, input.projectId, exportId, input.kind, timestamp);
      const jobId = randomUUID();
      const fingerprint = sha256Fingerprint(snapshot);
      this.reserveBudget(input.ownerId, input.projectId, jobId, 0, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_exports(
            id, owner_id, project_id, kind, status, snapshot_json, job_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)
        `)
        .run(exportId, input.ownerId, input.projectId, input.kind, JSON.stringify(snapshot), jobId, timestamp, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_jobs(
            id, project_id, type, category, target_type, target_id, status, priority,
            input_revision_map_json, input_fingerprint, target_generation, retry_of_job_id, attempt,
            max_attempts, next_run_at, progress_stage, created_at, updated_at
          ) VALUES (?, ?, 'prompt_package_export', 'media', 'export', ?, 'queued', 5,
            ?, ?, 1, ?, 0, 2, ?, 'queued', ?, ?)
        `)
        .run(
          jobId,
          input.projectId,
          exportId,
          JSON.stringify({
            source_blueprint_id: snapshot.source.id,
            product_profile_id: snapshot.product.id,
            adapted_blueprint_id: snapshot.adapted.id,
            scene_revision_ids: snapshot.scenes.map((scene) => scene.revision_id),
          }),
          fingerprint,
          input.retryOfJobId ?? null,
          timestamp,
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          INSERT INTO video_usage_reservations(id, owner_id, project_id, job_id, units, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, 'held', ?, ?)
        `)
        .run(randomUUID(), input.ownerId, input.projectId, jobId, timestamp, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_job_steps(id, job_id, name, status, input_fingerprint, created_at, updated_at)
          VALUES (?, ?, 'prompt_package', 'queued', ?, ?, ?)
        `)
        .run(randomUUID(), jobId, fingerprint, timestamp, timestamp);
      this.raw.prepare("UPDATE video_projects SET status = 'exporting', current_step = 'export', updated_at = ? WHERE id = ?")
        .run(timestamp, input.projectId);
      const job = jobFromRow(this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(jobId) as SqlRow);
      const exported = exportFromRow(this.raw.prepare("SELECT * FROM video_exports WHERE id = ?").get(exportId) as SqlRow);
      const recordId = this.saveIdempotency(input.ownerId, input.idempotency, 202, { export: exported, job });
      this.raw.prepare("UPDATE video_jobs SET idempotency_record_id = ? WHERE id = ?").run(recordId, jobId);
      this.writeEvent(input.projectId, "export.queued", { export_id: exportId, job_id: jobId, kind: input.kind }, timestamp);
      return { export: exported, job, reused: false };
    });
    this.notifyEvents();
    return result;
  }

  getExport(ownerId: string, exportId: string): VideoExportRecord | null {
    const row = this.raw
      .prepare("SELECT * FROM video_exports WHERE id = ? AND owner_id = ?")
      .get(exportId, ownerId) as SqlRow | undefined;
    return row ? exportFromRow(row) : null;
  }

  listExports(ownerId: string, projectId: string): VideoExportRecord[] {
    return (this.raw
      .prepare("SELECT * FROM video_exports WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC")
      .all(projectId, ownerId) as SqlRow[]).map(exportFromRow);
  }

  promptPackageInput(job: WorkerClaimedJob): PromptPackageSnapshot {
    const row = this.raw
      .prepare(`
        SELECT e.snapshot_json FROM video_exports e JOIN video_jobs j ON j.target_id = e.id
        WHERE j.id = ? AND e.project_id = ?
      `)
      .get(job.id, job.project_id) as SqlRow | undefined;
    if (!row) throw new VideoDomainError({ code: "EXPORT_NOT_FOUND", message: "Prompt package export not found", statusCode: 404 });
    return parseJson<PromptPackageSnapshot>(row.snapshot_json, {} as PromptPackageSnapshot);
  }

  getExportDownload(ownerId: string, exportId: string): {
    storageKey: string;
    bytes: number;
    filename: string;
  } | null {
    const row = this.raw
      .prepare(`
        SELECT e.id, e.project_id, e.kind, a.storage_key, a.bytes
        FROM video_exports e JOIN video_assets a ON a.id = e.asset_id
        WHERE e.id = ? AND e.owner_id = ? AND e.status = 'ready'
      `)
      .get(exportId, ownerId) as SqlRow | undefined;
    if (!row || row.storage_key === null) return null;
    return {
      storageKey: String(row.storage_key),
      bytes: Number(row.bytes),
      filename: `prompt-package-${String(row.project_id)}-${String(row.kind)}.zip`,
    };
  }

  getAssetDownload(ownerId: string, assetId: string): {
    storageKey: string;
    mimeType: string;
    bytes: number;
  } | null {
    const row = this.raw
      .prepare("SELECT storage_key, mime_type, bytes FROM video_assets WHERE id = ? AND owner_id = ? AND status = 'ready'")
      .get(assetId, ownerId) as SqlRow | undefined;
    if (!row || row.storage_key === null || row.bytes === null) return null;
    return { storageKey: String(row.storage_key), mimeType: String(row.mime_type), bytes: Number(row.bytes) };
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
                attempt = attempt + 1,
                started_at = COALESCE(started_at, ?), lease_owner = ?, lease_expires_at = ?,
                heartbeat_at = ?, provider_request_id = NULL,
                progress_stage = 'starting', error_code = NULL, error_message = NULL,
                error_retryable = NULL, updated_at = ?
              WHERE id = ? AND status IN ('queued', 'retry_wait')
            `)
            .run(timestamp, workerId, leaseExpiresAt, timestamp, timestamp, jobId);
          this.raw
            .prepare(`
              UPDATE video_job_steps SET status = 'running', attempt = attempt + 1,
                error_code = NULL, error_message = NULL, updated_at = ?
              WHERE job_id = ? AND status IN ('queued', 'running')
            `)
            .run(timestamp, jobId);
          if (String(row.type) === "scene_storyboard") {
            this.raw
              .prepare("UPDATE video_storyboard_scenes SET generation_status = 'generating', updated_at = ? WHERE id = ? AND generation = ?")
              .run(timestamp, String(row.target_id), Number(row.target_generation));
          } else if (String(row.type) === "prompt_package_export") {
            this.raw.prepare("UPDATE video_exports SET status = 'building', updated_at = ? WHERE id = ?")
              .run(timestamp, String(row.target_id));
          }
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
    if (job.type === "scene_storyboard") return this.completeSceneGeneration(job, workerId, value);
    if (job.type === "prompt_package_export") return this.completePromptPackageExport(job, workerId, value);
    const wrapped = value && typeof value === "object" && (value as { kind?: unknown }).kind === "prototype_analysis"
      ? value as PrototypeAnalysisWorkerResult
      : null;
    const result = wrapped?.result ?? value;
    assertPrototypeAnalysisResult(result);
    const providerMetadata = wrapped ?? {
      provider: "fake",
      model: "deterministic-prototype-v2",
      providerRequestId: null,
      usage: {},
      estimatedCostMicros: 0,
      latencyMs: 0,
      safety: { mode: "legacy" },
    };
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
        const generation = existingScene ? Number(existingScene.generation) + 1 : scene.generation;
        const revisionId = randomUUID();
        const sceneData: PrototypeScene = {
          ...scene,
          id: sceneId,
          revision,
          generation,
          locked_revision_id: null,
          current_revision_id: revisionId,
          stale_reason: null,
        };
        if (existingScene) {
          this.raw
            .prepare(`
              UPDATE video_storyboard_scenes SET adapted_blueprint_id = ?, generation_status = ?,
                current_revision_id = ?, generation = ?, stale_reason = NULL, updated_at = ? WHERE id = ?
            `)
            .run(adaptedBlueprintId, scene.generation_status, revisionId, generation, timestamp, sceneId);
        } else {
          this.raw
            .prepare(`
              INSERT INTO video_storyboard_scenes(
                id, project_id, adapted_blueprint_id, position, generation_status,
                current_revision_id, generation, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(sceneId, job.project_id, adaptedBlueprintId, scene.position, scene.generation_status, revisionId, generation, timestamp, timestamp);
        }
        this.raw
          .prepare(`
            INSERT INTO video_scene_revisions(
              id, scene_id, revision, schema_version, data_json, input_fingerprint,
              qc_status, source_job_id, created_at, updated_at
            ) VALUES (?, ?, ?, 'storyboard-scene-v1', ?, ?, ?, ?, ?, ?)
          `)
          .run(
            revisionId,
            sceneId,
            revision,
            JSON.stringify(sceneData),
            sha256Fingerprint({ job: job.input_fingerprint, scene: sceneData }),
            scene.qc_status,
            job.id,
            timestamp,
            timestamp,
          );
        this.persistArtifactAssetReferences(revisionId, "scene_revision", "storyboard-scene-v1", sceneData, timestamp);
      }
      this.raw
        .prepare(`
          INSERT INTO video_provider_runs(
            id, job_id, capability, provider, model, provider_request_id, duration_ms,
            input_hash, output_hash, status, usage_json, estimated_cost_micros,
            latency_ms, safety_json, created_at, finished_at
          ) VALUES (?, ?, 'prototype_analysis', ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          job.id,
          providerMetadata.provider,
          providerMetadata.model,
          providerMetadata.providerRequestId ?? nullableString(current.provider_request_id),
          providerMetadata.latencyMs,
          job.input_fingerprint,
          sha256Fingerprint(result),
          JSON.stringify(providerMetadata.usage),
          providerMetadata.estimatedCostMicros,
          providerMetadata.latencyMs,
          JSON.stringify(providerMetadata.safety),
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          UPDATE video_job_steps SET status = 'succeeded', output_json = ?,
            error_code = NULL, error_message = NULL, updated_at = ?
          WHERE job_id = ?
        `)
        .run(JSON.stringify(result.summary), timestamp, job.id);
      this.raw
        .prepare(`
          UPDATE video_jobs SET status = 'succeeded', progress_stage = 'completed',
            lease_owner = NULL, lease_expires_at = NULL, error_code = NULL,
            error_message = NULL, error_retryable = NULL, finished_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(timestamp, timestamp, job.id);
      this.settleReservation(job.id, 1, timestamp);
      this.raw
        .prepare(`
          UPDATE video_projects SET status = 'adaptation_ready', current_step = 'storyboard',
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

  private completeSceneGeneration(job: WorkerClaimedJob, workerId: string, value: unknown): boolean {
    if (!value || typeof value !== "object" || (value as { kind?: unknown }).kind !== "scene_storyboard") {
      throw new VideoDomainError({ code: "STORYBOARD_SCHEMA_INVALID", message: "Storyboard provider result is invalid" });
    }
    const result = value as SceneGenerationWorkerResult;
    const promoted = this.database.transaction(() => {
      const currentJob = this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(job.id) as SqlRow | undefined;
      if (!currentJob || String(currentJob.status) !== "running" || String(currentJob.lease_owner) !== workerId) return false;
      const scene = this.raw
        .prepare(`
          SELECT s.*, r.id AS revision_id, r.data_json, r.revision, p.owner_id
          FROM video_storyboard_scenes s
          JOIN video_scene_revisions r ON r.id = s.current_revision_id
          JOIN video_projects p ON p.id = s.project_id
          WHERE s.id = ? AND s.project_id = ?
        `)
        .get(result.sceneId, job.project_id) as SqlRow | undefined;
      const timestamp = nowIso();
      if (
        !scene ||
        String(scene.revision_id) !== result.revisionId ||
        Number(scene.generation) !== result.generation ||
        Number(currentJob.target_generation) !== result.generation
      ) {
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'superseded', lease_owner = NULL, lease_expires_at = NULL,
              finished_at = ?, updated_at = ? WHERE id = ?
          `)
          .run(timestamp, timestamp, job.id);
        this.settleReservation(job.id, 1, timestamp);
        this.writeEvent(job.project_id, "job.superseded", { job_id: job.id, scene_id: result.sceneId }, timestamp);
        return false;
      }
      const assetId = randomUUID();
      this.raw
        .prepare(`
          INSERT INTO video_assets(
            id, owner_id, kind, storage_key, sha256, mime_type, bytes, width, height,
            status, metadata_json, created_at, updated_at
          ) VALUES (?, ?, 'storyboard_image', ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)
        `)
        .run(
          assetId,
          String(scene.owner_id),
          result.asset.storageKey,
          result.asset.sha256,
          result.asset.mimeType,
          result.asset.bytes,
          result.asset.width,
          result.asset.height,
          JSON.stringify({ ...result.asset.metadata, qc: result.qc }),
          timestamp,
          timestamp,
        );
      const data = parseJson<Record<string, unknown>>(scene.data_json, {});
      data.storyboard_asset_id = assetId;
      data.generation_status = result.qc.status === "passed" ? "ready" : "needs_review";
      data.qc_status = result.qc.status;
      data.generation = result.generation;
      this.raw
        .prepare("UPDATE video_scene_revisions SET data_json = ?, qc_status = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(data), result.qc.status, timestamp, result.revisionId);
      this.raw
        .prepare(`
          UPDATE video_storyboard_scenes SET generation_status = ?, stale_reason = NULL, updated_at = ?
          WHERE id = ? AND generation = ? AND current_revision_id = ?
        `)
        .run(result.qc.status === "passed" ? "ready" : "needs_review", timestamp, result.sceneId, result.generation, result.revisionId);
      this.raw
        .prepare(`
          INSERT OR IGNORE INTO video_asset_references(asset_id, ref_type, ref_id, created_at)
          VALUES (?, 'scene_revision', ?, ?)
        `)
        .run(assetId, result.revisionId, timestamp);
      this.raw
        .prepare(`
          INSERT INTO video_provider_runs(
            id, job_id, capability, provider, model, provider_request_id, input_hash,
            output_hash, status, usage_json, latency_ms, safety_json, created_at, finished_at
          ) VALUES (?, ?, 'storyboard_image', ?, ?, ?, ?, ?, 'succeeded', '{}', 0, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          job.id,
          result.provider,
          result.model,
          nullableString(currentJob.provider_request_id),
          job.input_fingerprint,
          result.asset.sha256,
          JSON.stringify({ qc_status: result.qc.status }),
          timestamp,
          timestamp,
        );
      this.raw.prepare(`
        UPDATE video_job_steps SET status = 'succeeded', output_json = ?,
          error_code = NULL, error_message = NULL, updated_at = ? WHERE job_id = ?
      `)
        .run(JSON.stringify({ asset_id: assetId, qc: result.qc }), timestamp, job.id);
      this.raw
        .prepare(`
          UPDATE video_jobs SET status = 'succeeded', progress_stage = 'completed', lease_owner = NULL,
            lease_expires_at = NULL, error_code = NULL, error_message = NULL,
            error_retryable = NULL, finished_at = ?, updated_at = ? WHERE id = ?
        `)
        .run(timestamp, timestamp, job.id);
      this.settleReservation(job.id, 1, timestamp);
      this.recomputeStoryboardProjection(job.project_id, timestamp);
      this.writeEvent(job.project_id, "scene.updated", {
        scene_id: result.sceneId,
        generation: result.generation,
        generation_status: result.qc.status === "passed" ? "ready" : "needs_review",
        qc_status: result.qc.status,
      }, timestamp);
      this.writeEvent(job.project_id, "job.succeeded", { job_id: job.id, scene_id: result.sceneId }, timestamp);
      return true;
    });
    this.notifyEvents();
    return promoted;
  }

  private completePromptPackageExport(job: WorkerClaimedJob, workerId: string, value: unknown): boolean {
    if (!value || typeof value !== "object" || (value as { kind?: unknown }).kind !== "prompt_package_export") {
      throw new VideoDomainError({ code: "EXPORT_FAILED", message: "Prompt package result is invalid" });
    }
    const result = value as PromptPackageWorkerResult;
    const promoted = this.database.transaction(() => {
      const currentJob = this.raw.prepare("SELECT * FROM video_jobs WHERE id = ?").get(job.id) as SqlRow | undefined;
      if (!currentJob || String(currentJob.status) !== "running" || String(currentJob.lease_owner) !== workerId) return false;
      const exported = this.raw
        .prepare("SELECT * FROM video_exports WHERE id = ? AND project_id = ?")
        .get(result.exportId, job.project_id) as SqlRow | undefined;
      if (!exported || String(currentJob.target_id) !== result.exportId) return false;
      const timestamp = nowIso();
      const assetId = randomUUID();
      this.raw
        .prepare(`
          INSERT INTO video_assets(
            id, owner_id, kind, storage_key, sha256, mime_type, bytes, status,
            metadata_json, created_at, updated_at
          ) VALUES (?, ?, 'prompt_package', ?, ?, 'application/zip', ?, 'ready', ?, ?, ?)
        `)
        .run(
          assetId,
          String(exported.owner_id),
          result.asset.storageKey,
          result.asset.sha256,
          result.asset.bytes,
          JSON.stringify({ kind: String(exported.kind), export_id: result.exportId }),
          timestamp,
          timestamp,
        );
      this.raw
        .prepare(`
          INSERT OR IGNORE INTO video_asset_references(asset_id, ref_type, ref_id, created_at)
          VALUES (?, 'prompt_package_export', ?, ?)
        `)
        .run(assetId, result.exportId, timestamp);
      this.raw
        .prepare(`
          UPDATE video_exports SET status = 'ready', manifest_json = ?, asset_id = ?,
            ready_at = ?, updated_at = ? WHERE id = ?
        `)
        .run(JSON.stringify(result.manifest), assetId, timestamp, timestamp, result.exportId);
      this.raw.prepare(`
        UPDATE video_job_steps SET status = 'succeeded', output_json = ?,
          error_code = NULL, error_message = NULL, updated_at = ? WHERE job_id = ?
      `)
        .run(JSON.stringify({ export_id: result.exportId, asset_id: assetId }), timestamp, job.id);
      this.raw
        .prepare(`
          UPDATE video_jobs SET status = 'succeeded', progress_stage = 'completed', lease_owner = NULL,
            lease_expires_at = NULL, error_code = NULL, error_message = NULL,
            error_retryable = NULL, finished_at = ?, updated_at = ? WHERE id = ?
        `)
        .run(timestamp, timestamp, job.id);
      this.settleReservation(job.id, 0, timestamp);
      this.raw.prepare("UPDATE video_projects SET status = 'exported', current_step = 'export', updated_at = ? WHERE id = ?")
        .run(timestamp, job.project_id);
      this.writeEvent(job.project_id, "export.ready", { export_id: result.exportId, asset_id: assetId, kind: String(exported.kind) }, timestamp);
      this.writeEvent(job.project_id, "job.succeeded", { job_id: job.id, export_id: result.exportId }, timestamp);
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
      const canRetry = Number(current.attempt) < Number(current.max_attempts);
      if (failure.providerOutcomeUnknown && canRetry) {
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'retry_wait', next_run_at = ?, lease_owner = NULL,
              lease_expires_at = NULL, error_code = 'PROVIDER_RECONCILIATION_PENDING',
              error_message = ?, error_retryable = 1, progress_stage = 'reconciling', updated_at = ?
            WHERE id = ?
          `)
          .run(new Date(Date.now() + 60_000).toISOString(), failure.message, timestamp, job.id);
        this.raw
          .prepare(`
            UPDATE video_job_steps SET status = 'queued', error_code = ?, error_message = ?, updated_at = ?
            WHERE job_id = ? AND status = 'running'
          `)
          .run(failure.code, failure.message, timestamp, job.id);
        this.raw
          .prepare("UPDATE video_usage_reservations SET status = 'reconciling', reason = ?, updated_at = ? WHERE job_id = ? AND status = 'held'")
          .run(failure.code, timestamp, job.id);
        this.writeEvent(job.project_id, "job.reconciling", {
          job_id: job.id,
          error_code: failure.code,
        }, timestamp);
        return true;
      }
      const retry = failure.retryable && canRetry;
      if (retry) {
        const delay = Math.min(60_000, 1_000 * 2 ** Math.max(0, Number(current.attempt) - 1));
        this.raw
          .prepare(`
            UPDATE video_jobs SET status = 'retry_wait', next_run_at = ?, lease_owner = NULL,
              lease_expires_at = NULL, error_code = ?, error_message = ?, error_retryable = 1,
              progress_stage = 'retry_wait', updated_at = ? WHERE id = ?
          `)
          .run(new Date(Date.now() + delay).toISOString(), failure.code, failure.message, timestamp, job.id);
        this.raw
          .prepare(`
            UPDATE video_job_steps SET status = 'queued', error_code = ?, error_message = ?, updated_at = ?
            WHERE job_id = ? AND status = 'running'
          `)
          .run(failure.code, failure.message, timestamp, job.id);
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
        if (String(current.type) === "scene_storyboard") {
          this.raw
            .prepare(`
              UPDATE video_storyboard_scenes SET generation_status = 'failed', updated_at = ?
              WHERE id = ? AND generation = ?
            `)
            .run(timestamp, String(current.target_id), Number(current.target_generation));
          this.recomputeStoryboardProjection(job.project_id, timestamp);
        } else if (String(current.type) === "prompt_package_export") {
          this.raw
            .prepare(`
              UPDATE video_exports SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
              WHERE id = ?
            `)
            .run(failure.code, failure.message, timestamp, String(current.target_id));
          this.recomputeStoryboardProjection(job.project_id, timestamp);
        } else {
          this.raw
            .prepare("UPDATE video_projects SET status = 'analysis_failed', current_step = 'analysis', updated_at = ? WHERE id = ?")
            .run(timestamp, job.project_id);
        }
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
          if (String(row.type) === "scene_storyboard") {
            this.raw.prepare("UPDATE video_storyboard_scenes SET generation_status = 'queued', updated_at = ? WHERE id = ? AND generation = ?")
              .run(timestamp, String(row.target_id), Number(row.target_generation));
          } else if (String(row.type) === "prompt_package_export") {
            this.raw.prepare("UPDATE video_exports SET status = 'queued', updated_at = ? WHERE id = ?")
              .run(timestamp, String(row.target_id));
          }
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
        if (String(row.type) === "scene_storyboard") {
          this.raw.prepare("UPDATE video_storyboard_scenes SET generation_status = 'queued', updated_at = ? WHERE id = ? AND generation = ?")
            .run(timestamp, String(row.target_id), Number(row.target_generation));
        } else if (String(row.type) === "prompt_package_export") {
          this.raw.prepare("UPDATE video_exports SET status = 'queued', updated_at = ? WHERE id = ?")
            .run(timestamp, String(row.target_id));
        }
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

  private buildPromptPackageSnapshot(
    ownerId: string,
    projectId: string,
    exportId: string,
    kind: ExportKind,
    timestamp: string,
  ): PromptPackageSnapshot {
    const project = this.raw
      .prepare("SELECT * FROM video_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
      .get(projectId, ownerId) as SqlRow | undefined;
    if (!project) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
    const sourceId = nullableString(project.active_source_blueprint_id);
    const productId = nullableString(project.active_product_profile_id);
    const adaptedId = nullableString(project.active_adapted_blueprint_id);
    if (!sourceId || !productId || !adaptedId) {
      throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "Confirmed Source, Product, and Adapted artifacts are required before export", statusCode: 409 });
    }
    const source = this.raw.prepare("SELECT * FROM video_blueprints WHERE id = ? AND project_id = ? AND kind = 'source'").get(sourceId, projectId) as SqlRow | undefined;
    const product = this.raw.prepare("SELECT * FROM video_product_profiles WHERE id = ? AND project_id = ?").get(productId, projectId) as SqlRow | undefined;
    const adapted = this.raw.prepare("SELECT * FROM video_blueprints WHERE id = ? AND project_id = ? AND kind = 'adapted'").get(adaptedId, projectId) as SqlRow | undefined;
    if (!source || !product || !adapted) throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "Active export artifacts are missing", statusCode: 409 });
    if (kind === "final" && (
      String(source.status) !== "confirmed" ||
      String(product.status) !== "confirmed" ||
      String(adapted.status) !== "confirmed" ||
      nullableString(adapted.parent_blueprint_id) !== sourceId ||
      nullableString(adapted.product_profile_id) !== productId
    )) {
      throw new VideoDomainError({ code: "EXPORT_FINAL_BLOCKED", message: "The active Blueprint chain is not fully confirmed", statusCode: 409, details: { blocking_scenes: [], reason: "artifact_chain_stale", draft_available: true } });
    }
    const rows = this.raw
      .prepare(`
        SELECT s.*, r.id AS revision_id, r.revision, r.data_json, r.qc_status
        FROM video_storyboard_scenes s JOIN video_scene_revisions r ON r.id = s.current_revision_id
        WHERE s.project_id = ? ORDER BY s.position
      `)
      .all(projectId) as SqlRow[];
    if (rows.length === 0) throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "At least one storyboard scene is required for export", statusCode: 409 });
    const scenes: PromptPackageSnapshotScene[] = [];
    const blockingScenes: Array<{ scene_id: string; position: number; reason: string }> = [];
    for (const row of rows) {
      const data = parseJson<Record<string, unknown>>(row.data_json, {});
      const sceneId = String(row.id);
      const revisionId = String(row.revision_id);
      const qcAccepted = Boolean(this.raw
        .prepare("SELECT 1 FROM video_qc_acceptances WHERE owner_id = ? AND scene_revision_id = ?")
        .get(ownerId, revisionId)) || String(row.qc_status) === "accepted";
      const assetId = nullableString(data.storyboard_asset_id);
      const asset = assetId
        ? this.raw.prepare("SELECT storage_key, mime_type FROM video_assets WHERE id = ? AND owner_id = ? AND status = 'ready'").get(assetId, ownerId) as SqlRow | undefined
        : undefined;
      const scene: PromptPackageSnapshotScene = {
        scene_id: sceneId,
        position: Number(row.position),
        revision_id: revisionId,
        revision: Number(row.revision),
        generation: Number(row.generation),
        generation_status: String(row.generation_status) as PrototypeScene["generation_status"],
        stale_reason: nullableString(row.stale_reason),
        qc_status: String(row.qc_status) as StoryboardQcStatus,
        qc_accepted: qcAccepted,
        locked_revision_id: nullableString(row.locked_revision_id),
        storyboard_asset_id: assetId,
        data,
        storyboard_storage_key: asset && asset.storage_key !== null ? String(asset.storage_key) : null,
        storyboard_mime_type: asset && asset.mime_type !== null ? String(asset.mime_type) : null,
      };
      scenes.push(scene);
      if (scene.generation_status === "needs_review") blockingScenes.push({ scene_id: sceneId, position: scene.position, reason: "needs_review" });
      else if (scene.generation_status !== "ready" || !scene.storyboard_storage_key) blockingScenes.push({ scene_id: sceneId, position: scene.position, reason: "not_ready" });
      if (scene.stale_reason) blockingScenes.push({ scene_id: sceneId, position: scene.position, reason: "stale" });
      if (scene.locked_revision_id !== scene.revision_id) blockingScenes.push({ scene_id: sceneId, position: scene.position, reason: "current_revision_unlocked" });
      if (!(scene.qc_status === "passed" || qcAccepted)) blockingScenes.push({ scene_id: sceneId, position: scene.position, reason: "qc_unaccepted" });
    }
    if (kind === "final" && blockingScenes.length > 0) {
      throw new VideoDomainError({
        code: "EXPORT_FINAL_BLOCKED",
        message: "Final export is blocked by unfinished storyboard scenes",
        statusCode: 409,
        nextAction: "resolve_blocking_scenes_or_export_draft",
        details: { blocking_scenes: blockingScenes, draft_available: true },
      });
    }
    return {
      export_id: exportId,
      project_id: projectId,
      project_name: String(project.name),
      target_market: String(project.target_market),
      language: String(project.language),
      kind,
      created_at: timestamp,
      source: { id: sourceId, data: parseJson<unknown>(source.data_json, {}) },
      product: { id: productId, data: parseJson<unknown>(product.data_json, {}) },
      adapted: { id: adaptedId, data: parseJson<unknown>(adapted.data_json, {}) },
      scenes,
    };
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

  private recomputeStoryboardProjection(projectId: string, timestamp: string): void {
    const counts = this.raw
      .prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN generation_status = 'ready' AND stale_reason IS NULL THEN 1 ELSE 0 END) AS ready,
          SUM(CASE WHEN generation_status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM video_storyboard_scenes WHERE project_id = ?
      `)
      .get(projectId) as SqlRow;
    const total = Number(counts.total ?? 0);
    const ready = Number(counts.ready ?? 0);
    const failed = Number(counts.failed ?? 0);
    const status = total > 0 && ready === total
      ? "storyboard_ready"
      : ready > 0
        ? "partially_generated"
        : failed > 0
          ? "storyboard_failed"
          : "generating_storyboard";
    this.raw
      .prepare("UPDATE video_projects SET status = ?, current_step = 'storyboard', updated_at = ? WHERE id = ?")
      .run(status, timestamp, projectId);
  }

  private reserveBudget(ownerId: string, projectId: string, jobId: string, units: number, timestamp: string): void {
    const result = this.raw
      .prepare(`
        UPDATE video_usage_budgets SET reserved_units = reserved_units + ?, updated_at = ?
        WHERE owner_id = ? AND project_id = ?
          AND spent_units + reserved_units + ? <= max_units
      `)
      .run(units, timestamp, ownerId, projectId, units);
    if (result.changes !== 1) {
      const budget = this.raw
        .prepare("SELECT max_units FROM video_usage_budgets WHERE owner_id = ? AND project_id = ?")
        .get(ownerId, projectId) as SqlRow | undefined;
      throw new VideoDomainError({
        code: "USAGE_BUDGET_EXCEEDED",
        message: "Project generation budget has been exhausted",
        statusCode: 409,
        details: { job_id: jobId, max_units: Number(budget?.max_units ?? 0) },
      });
    }
  }

  private ensureReservationHeld(jobId: string, timestamp: string): boolean {
    const reservation = this.raw
      .prepare("SELECT * FROM video_usage_reservations WHERE job_id = ?")
      .get(jobId) as SqlRow | undefined;
    if (!reservation) return false;
    if (String(reservation.status) === "held") return true;
    if (String(reservation.status) === "reconciling") {
      const result = this.raw
        .prepare(`
          UPDATE video_usage_reservations SET status = 'held', reason = NULL, updated_at = ?
          WHERE job_id = ? AND status = 'reconciling'
        `)
        .run(timestamp, jobId);
      return result.changes === 1;
    }
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

  private projectIdForScene(sceneId: string): string {
    const row = this.raw.prepare("SELECT project_id FROM video_storyboard_scenes WHERE id = ?").get(sceneId) as SqlRow | undefined;
    if (!row) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
    return String(row.project_id);
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
