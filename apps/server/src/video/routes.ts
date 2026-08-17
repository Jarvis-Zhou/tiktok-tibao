import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  VIDEO_PROJECT_STATUSES,
  VideoDomainError,
  normalizeLanguage,
  normalizeMarket,
  requestFingerprint,
  type CatalogContext,
  type VideoAssetRole,
  type VideoProjectStatus,
} from "@tibao/video-core";
import type { AppConfig } from "../config.js";
import { resolveVideoConfig } from "../config.js";
import type { TibaoDatabase } from "../database.js";
import { VideoModule } from "./module.js";
import type { MediaToolchain } from "./media/ffmpeg-media-toolchain.js";

const OWNER_ID = "local";
const RAW_MEDIA_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/octet-stream",
];

type UnknownRecord = Record<string, unknown>;

export interface VideoRouteDependencies {
  config: AppConfig;
  database: TibaoDatabase;
  mediaToolchain?: MediaToolchain;
}

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VideoDomainError({ code: "INVALID_REQUEST", message: "JSON request body must be an object", statusCode: 400 });
  }
  return value as UnknownRecord;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, maximum: number): string | undefined {
  const result = text(value);
  if (!result) return undefined;
  if (result.length > maximum) {
    throw new VideoDomainError({ code: "INVALID_REQUEST", message: `Text value exceeds ${maximum} characters`, statusCode: 400 });
  }
  return result;
}

function idempotency(request: FastifyRequest, scope: string, body: unknown) {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0]?.trim() : header?.trim();
  if (!key) {
    throw new VideoDomainError({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required for this operation",
      statusCode: 400,
    });
  }
  if (key.length > 200) {
    throw new VideoDomainError({ code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key is too long", statusCode: 400 });
  }
  return { key, scope, requestHash: requestFingerprint(body) };
}

function etag(revision: number): string {
  return `"${revision}"`;
}

function ifMatchRevision(request: FastifyRequest): number {
  const value = request.headers["if-match"];
  const normalized = Array.isArray(value) ? value[0] : value;
  const match = normalized?.match(/^(?:W\/)?"?(\d+)"?$/);
  if (!match) {
    throw new VideoDomainError({
      code: "IF_MATCH_REQUIRED",
      message: "If-Match with the current revision is required",
      statusCode: 428,
    });
  }
  return Number(match[1]);
}

function parseCatalogContext(value: unknown): CatalogContext | null {
  if (value === undefined || value === null) return null;
  const input = record(value);
  const result: CatalogContext = {};
  const shopId = optionalText(input.shop_id, 128);
  const productId = optionalText(input.product_id, 128);
  const title = optionalText(input.title, 500);
  const category = optionalText(input.category, 300);
  const brand = optionalText(input.brand, 200);
  const shopRegion = optionalText(input.shop_region, 16)?.toUpperCase();
  if (shopId) result.shop_id = shopId;
  if (productId) result.product_id = productId;
  if (title) result.title = title;
  if (category) result.category = category;
  if (brand) result.brand = brand;
  if (shopRegion) result.shop_region = shopRegion;
  return Object.keys(result).length > 0 ? result : null;
}

function defaultLanguage(targetMarket: string, allowed: string[]): string {
  return allowed.find((language) => language.endsWith(`-${targetMarket}`)) ?? allowed[0] ?? "en-MY";
}

function parseCreateProject(body: unknown, config: ReturnType<typeof resolveVideoConfig>) {
  const input = record(body);
  const catalogContext = parseCatalogContext(input.catalog_context);
  const name = optionalText(input.name, 120) ?? catalogContext?.title ?? "Untitled video project";
  const targetMarket = normalizeMarket(
    text(input.target_market) || catalogContext?.shop_region || config.allowedMarkets[0] || "MY",
  );
  const language = normalizeLanguage(
    text(input.language) || defaultLanguage(targetMarket, config.allowedLanguages),
  );
  if (!config.allowedMarkets.includes(targetMarket)) {
    throw new VideoDomainError({
      code: "MARKET_NOT_ENABLED",
      message: `${targetMarket} is not enabled for the current Video Alpha configuration`,
      statusCode: 422,
      details: { allowed_markets: config.allowedMarkets },
    });
  }
  if (!config.allowedLanguages.includes(language)) {
    throw new VideoDomainError({
      code: "LANGUAGE_NOT_ENABLED",
      message: `${language} is not enabled for the current Video Alpha configuration`,
      statusCode: 422,
      details: { allowed_languages: config.allowedLanguages },
    });
  }
  let targetDurationSec: number | null = null;
  if (input.target_duration_sec !== undefined && input.target_duration_sec !== null) {
    targetDurationSec = Number(input.target_duration_sec);
    if (!Number.isSafeInteger(targetDurationSec) || targetDurationSec < 5 || targetDurationSec > 180) {
      throw new VideoDomainError({ code: "INVALID_DURATION", message: "target_duration_sec must be between 5 and 180", statusCode: 400 });
    }
  }
  const similarityScore = input.similarity_score === undefined ? 60 : Number(input.similarity_score);
  if (!Number.isSafeInteger(similarityScore) || similarityScore < 0 || similarityScore > 100) {
    throw new VideoDomainError({ code: "INVALID_SIMILARITY", message: "similarity_score must be an integer from 0 to 100", statusCode: 400 });
  }
  return { name, catalogContext, targetMarket, language, targetDurationSec, similarityScore };
}

function parseUpload(body: unknown, module: VideoModule) {
  const input = record(body);
  const role = text(input.role) as VideoAssetRole;
  if (!(["source_video", "product_image", "custom_storyboard"] as const).includes(role)) {
    throw new VideoDomainError({ code: "INVALID_ASSET_ROLE", message: "Unsupported video asset role", statusCode: 400 });
  }
  const mimeType = text(input.content_type).toLowerCase();
  const allowed = role === "source_video"
    ? ["video/mp4", "video/quicktime", "video/webm"]
    : ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(mimeType)) {
    throw new VideoDomainError({ code: "UPLOAD_MIME_NOT_ALLOWED", message: "The requested media type is not allowed for this role", statusCode: 415 });
  }
  const expectedBytes = input.bytes === undefined || input.bytes === null ? null : Number(input.bytes);
  if (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0)) {
    throw new VideoDomainError({ code: "INVALID_UPLOAD_SIZE", message: "bytes must be a positive integer", statusCode: 400 });
  }
  const maxBytes = role === "source_video"
    ? module.config.maxSourceBytes
    : module.config.maxProductImageBytes;
  if (expectedBytes !== null && expectedBytes > maxBytes) {
    throw new VideoDomainError({ code: "UPLOAD_TOO_LARGE", message: "Declared upload size exceeds the role limit", statusCode: 413 });
  }
  const expectedSha256 = text(input.sha256).toLowerCase() || null;
  if (expectedSha256 !== null && !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new VideoDomainError({ code: "INVALID_UPLOAD_HASH", message: "sha256 must contain 64 hexadecimal characters", statusCode: 400 });
  }
  return { role, mimeType, expectedBytes, expectedSha256, maxBytes };
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([updatedAt, id]), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): { updatedAt: string; id: string } | null {
  const cursor = text(value);
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((item) => typeof item !== "string")) throw new Error();
    return { updatedAt: parsed[0] as string, id: parsed[1] as string };
  } catch {
    throw new VideoDomainError({ code: "INVALID_CURSOR", message: "Project cursor is invalid", statusCode: 400 });
  }
}

function contentLength(request: FastifyRequest): number | null {
  const value = request.headers["content-length"];
  if (value === undefined) return null;
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sendProject(reply: FastifyReply, project: { revision: number }, body: unknown) {
  return reply.header("etag", etag(project.revision)).send(body);
}

export async function registerVideoRoutes(
  app: FastifyInstance,
  dependencies: VideoRouteDependencies,
): Promise<VideoModule | null> {
  const config = resolveVideoConfig(dependencies.config);
  if (!config.enabled) return null;
  const module = await VideoModule.create(
    dependencies.config,
    dependencies.database,
    app.log,
    dependencies.mediaToolchain,
  );
  app.addHook("onClose", async () => module.close());

  await app.register(
    async (videoApp) => {
      videoApp.addContentTypeParser(RAW_MEDIA_TYPES, (request, payload, done) => {
        done(null, payload);
      });

      videoApp.setErrorHandler((error, request, reply) => {
        if (error instanceof VideoDomainError) {
          void reply.code(error.statusCode).send(error.toBody(request.id));
          return;
        }
        request.log.error({ err: error }, "video request failed");
        void reply.code(500).send({
          error: { code: "INTERNAL_ERROR", message: "Video service failed", retryable: false },
          request_id: request.id,
        });
      });

      videoApp.get("/health", async () => ({
        ok: true,
        mode: "alpha",
        worker_mode: module.config.workerMode,
        provider: module.config.fakeProvider ? "fake" : "unconfigured",
        allowed_markets: module.config.allowedMarkets,
        allowed_languages: module.config.allowedLanguages,
      }));

      videoApp.post("/projects", async (request, reply) => {
        const parsed = parseCreateProject(request.body, module.config);
        const result = module.repository.createProject({
          ownerId: OWNER_ID,
          ...parsed,
          idempotency: idempotency(request, "POST /projects", request.body),
        });
        return reply.code(201).header("etag", etag(result.project.revision)).send(result);
      });

      videoApp.get("/projects", async (request) => {
        const query = (request.query ?? {}) as UnknownRecord;
        const rawStatus = text(query.status);
        const status = rawStatus
          ? (rawStatus as VideoProjectStatus)
          : undefined;
        if (status && !VIDEO_PROJECT_STATUSES.includes(status)) {
          throw new VideoDomainError({ code: "INVALID_PROJECT_STATUS", message: "Unknown project status", statusCode: 400 });
        }
        const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 20)));
        const cursor = decodeCursor(query.cursor);
        const projects = module.repository.listProjects(OWNER_ID, {
          ...(status ? { status } : {}),
          ...(cursor ? { cursorUpdatedAt: cursor.updatedAt, cursorId: cursor.id } : {}),
          limit: limit + 1,
        });
        const hasMore = projects.length > limit;
        const items = projects.slice(0, limit);
        const last = hasMore ? items.at(-1) : undefined;
        return {
          projects: items,
          next_cursor: last ? encodeCursor(last.updated_at, last.id) : null,
        };
      });

      videoApp.get<{ Params: { projectId: string } }>("/projects/:projectId", async (request, reply) => {
        const aggregate = module.repository.getProjectAggregate(OWNER_ID, request.params.projectId);
        if (!aggregate) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
        return sendProject(reply, aggregate.project, aggregate);
      });

      videoApp.patch<{ Params: { projectId: string } }>("/projects/:projectId", async (request, reply) => {
        const body = record(request.body);
        const patch: {
          name?: string;
          targetMarket?: string;
          language?: string;
          targetDurationSec?: number | null;
          similarityScore?: number;
        } = {};
        if (body.name !== undefined) patch.name = optionalText(body.name, 120) ?? "Untitled video project";
        if (body.target_market !== undefined) {
          const market = normalizeMarket(body.target_market);
          if (!module.config.allowedMarkets.includes(market)) throw new VideoDomainError({ code: "MARKET_NOT_ENABLED", message: `${market} is not enabled`, statusCode: 422 });
          patch.targetMarket = market;
        }
        if (body.language !== undefined) {
          const language = normalizeLanguage(body.language);
          if (!module.config.allowedLanguages.includes(language)) throw new VideoDomainError({ code: "LANGUAGE_NOT_ENABLED", message: `${language} is not enabled`, statusCode: 422 });
          patch.language = language;
        }
        if (body.target_duration_sec !== undefined) {
          if (body.target_duration_sec === null) patch.targetDurationSec = null;
          else {
            const duration = Number(body.target_duration_sec);
            if (!Number.isSafeInteger(duration) || duration < 5 || duration > 180) throw new VideoDomainError({ code: "INVALID_DURATION", message: "target_duration_sec must be between 5 and 180", statusCode: 400 });
            patch.targetDurationSec = duration;
          }
        }
        if (body.similarity_score !== undefined) {
          const similarity = Number(body.similarity_score);
          if (!Number.isSafeInteger(similarity) || similarity < 0 || similarity > 100) throw new VideoDomainError({ code: "INVALID_SIMILARITY", message: "similarity_score must be 0–100", statusCode: 400 });
          patch.similarityScore = similarity;
        }
        const project = module.repository.updateProject(
          OWNER_ID,
          request.params.projectId,
          ifMatchRevision(request),
          patch,
          idempotency(request, "PATCH /projects/:projectId", request.body),
        );
        return sendProject(reply, project, { project });
      });

      videoApp.post<{ Params: { projectId: string } }>("/projects/:projectId/source-url/resolve", async (request) => {
        const body = record(request.body);
        const raw = text(body.url);
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          throw new VideoDomainError({ code: "SOURCE_URL_INVALID", message: "Source URL is invalid", statusCode: 400 });
        }
        if (url.protocol !== "https:" || !(url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com"))) {
          throw new VideoDomainError({ code: "SOURCE_URL_NOT_ALLOWED", message: "Only public TikTok HTTPS links are accepted", statusCode: 422 });
        }
        if (!module.repository.getProject(OWNER_ID, request.params.projectId)) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
        return {
          status: "needs_video_upload",
          embed_metadata: { provider: "tiktok", canonical_url: url.toString() },
          reason: "SOURCE_MEDIA_UNAVAILABLE",
        };
      });

      videoApp.post<{ Params: { projectId: string } }>("/projects/:projectId/uploads", async (request, reply) => {
        const parsed = parseUpload(request.body, module);
        const result = module.repository.createUpload({
          ownerId: OWNER_ID,
          projectId: request.params.projectId,
          ...parsed,
          idempotency: idempotency(request, "POST /projects/:projectId/uploads", request.body),
        });
        return reply.code(201).send({
          upload_id: result.upload.id,
          asset_id: result.asset.id,
          mode: "proxy",
          method: "PUT",
          url: `/api/video/v1/uploads/${result.upload.id}/content`,
          required_headers: { "Content-Type": result.upload.expectedMime },
          max_bytes: result.upload.maxBytes,
          expires_at: result.upload.expiresAt,
          reused: result.reused,
        });
      });

      videoApp.put<{ Params: { uploadId: string } }>("/uploads/:uploadId/content", async (request, reply) => {
        const rawContentType = Array.isArray(request.headers["content-type"])
          ? request.headers["content-type"][0]
          : request.headers["content-type"];
        const contentType = (rawContentType ?? "application/octet-stream").split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
        const upload = module.repository.beginUpload(
          OWNER_ID,
          request.params.uploadId,
          contentType,
          contentLength(request),
        );
        const body = request.body;
        const stream = body instanceof Readable
          ? body
          : Readable.from(Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
        try {
          const received = await module.storage.writeUpload(upload.id, stream, upload.maxBytes);
          const completed = module.repository.finishUploadContent(OWNER_ID, upload.id, received);
          return reply.code(201).send({
            upload_id: upload.id,
            status: completed.status,
            bytes: completed.receivedBytes,
            sha256: completed.receivedSha256,
          });
        } catch (error) {
          module.repository.resetUpload(OWNER_ID, upload.id);
          throw error;
        }
      });

      videoApp.post<{ Params: { uploadId: string } }>("/uploads/:uploadId/complete", async (request) => {
        const upload = module.repository.getUpload(OWNER_ID, request.params.uploadId);
        if (!upload) throw new VideoDomainError({ code: "UPLOAD_NOT_FOUND", message: "Upload session not found", statusCode: 404 });
        if (upload.status === "completed") {
          const aggregate = module.repository.getProjectAggregate(OWNER_ID, upload.projectId);
          const asset = aggregate?.assets.find((candidate) => candidate.id === upload.assetId);
          return { upload_id: upload.id, status: "completed", asset };
        }
        if (upload.status !== "uploaded" || upload.receivedSha256 === null || upload.receivedBytes === null) {
          throw new VideoDomainError({ code: "INVALID_UPLOAD_STATE", message: "Upload content has not finished", statusCode: 409 });
        }
        if (upload.expectedBytes !== null && upload.expectedBytes !== upload.receivedBytes) throw new VideoDomainError({ code: "UPLOAD_SIZE_MISMATCH", message: "Uploaded byte count does not match" });
        if (upload.expectedSha256 !== null && upload.expectedSha256 !== upload.receivedSha256) throw new VideoDomainError({ code: "UPLOAD_HASH_MISMATCH", message: "Uploaded checksum does not match" });
        const detectedMime = await module.storage.detectMime(upload.tempKey);
        if (!detectedMime) throw new VideoDomainError({ code: "UPLOAD_CONTENT_INVALID", message: "Media signature is not recognized", statusCode: 415 });
        const allowedDetectedTypes = upload.role === "source_video"
          ? ["video/mp4", "video/quicktime", "video/webm"]
          : ["image/png", "image/jpeg", "image/webp"];
        if (!allowedDetectedTypes.includes(detectedMime)) {
          throw new VideoDomainError({ code: "UPLOAD_CONTENT_INVALID", message: "Media signature does not match the upload role", statusCode: 415 });
        }
        const tempPath = module.storage.tempPath(upload.tempKey);
        const metadata = upload.role === "source_video"
          ? await module.media.probeVideo(tempPath)
          : await module.media.probeImage(tempPath);
        const storageKey = await module.storage.commit(OWNER_ID, upload.tempKey, upload.receivedSha256);
        const asset = module.repository.completeUpload(OWNER_ID, upload.id, {
          detectedMime,
          storageKey,
          width: metadata.width,
          height: metadata.height,
          durationMs: "durationSec" in metadata ? Math.round(metadata.durationSec * 1_000) : null,
          metadata: "durationSec" in metadata
            ? {
                fps: metadata.fps,
                video_codec: metadata.videoCodec,
                has_audio: metadata.hasAudio,
                audio_codec: metadata.audioCodec,
              }
            : { image_codec: metadata.codec },
        });
        return { upload_id: upload.id, status: "completed", asset };
      });

      videoApp.post<{ Params: { projectId: string } }>("/projects/:projectId/analysis-runs", async (request, reply) => {
        const body = record(request.body);
        const rights = record(body.rights_acknowledgement);
        if (rights.accepted !== true || !text(rights.policy_version)) {
          throw new VideoDomainError({ code: "RIGHTS_ACKNOWLEDGEMENT_REQUIRED", message: "Current rights acknowledgement is required", statusCode: 422 });
        }
        const expectedProjectRevision = Number(body.expected_project_revision);
        if (!Number.isSafeInteger(expectedProjectRevision) || expectedProjectRevision < 1) {
          throw new VideoDomainError({ code: "INVALID_PROJECT_REVISION", message: "expected_project_revision is required", statusCode: 400 });
        }
        const result = module.repository.enqueuePrototypeAnalysis({
          ownerId: OWNER_ID,
          projectId: request.params.projectId,
          expectedProjectRevision,
          policyVersion: text(rights.policy_version),
          requestId: request.id,
          idempotency: idempotency(request, "POST /projects/:projectId/analysis-runs", request.body),
        });
        return reply.code(202).send(result);
      });

      videoApp.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (request) => {
        const job = module.repository.getJob(OWNER_ID, request.params.jobId);
        if (!job) throw new VideoDomainError({ code: "JOB_NOT_FOUND", message: "Video job not found", statusCode: 404 });
        return { job, steps: module.repository.listJobSteps(OWNER_ID, job.id) };
      });

      videoApp.post<{ Params: { jobId: string } }>("/jobs/:jobId/cancellations", async (request) => {
        return {
          job: module.repository.cancelJob(
            OWNER_ID,
            request.params.jobId,
            idempotency(request, "POST /jobs/:jobId/cancellations", request.body ?? {}),
          ),
        };
      });

      videoApp.post<{ Params: { jobId: string } }>("/jobs/:jobId/retries", async (request, reply) => {
        const previous = module.repository.getJob(OWNER_ID, request.params.jobId);
        if (!previous) throw new VideoDomainError({ code: "JOB_NOT_FOUND", message: "Video job not found", statusCode: 404 });
        if (previous.status !== "failed" && previous.status !== "cancelled" && previous.status !== "superseded") {
          throw new VideoDomainError({ code: "INVALID_STATE_TRANSITION", message: "Only terminal unsuccessful jobs can be retried", statusCode: 409 });
        }
        const target = module.repository.getJobTarget(OWNER_ID, previous.id);
        if (!target) throw new VideoDomainError({ code: "JOB_NOT_FOUND", message: "Video job target not found", statusCode: 404 });
        const project = module.repository.getProject(OWNER_ID, target.projectId);
        if (!project) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
        const retryIdempotency = idempotency(request, "POST /jobs/:jobId/retries", request.body ?? {});
        let result: unknown;
        if (target.type === "scene_storyboard") {
          const scene = module.repository.getScene(OWNER_ID, target.targetId, target.projectId);
          if (!scene) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene no longer exists", statusCode: 404 });
          result = module.repository.enqueueSceneGeneration({
            ownerId: OWNER_ID,
            sceneId: scene.id,
            expectedRevision: scene.revision,
            idempotency: retryIdempotency,
            retryOfJobId: previous.id,
          });
        } else if (target.type === "prompt_package_export") {
          const previousExport = module.repository.getExport(OWNER_ID, target.targetId);
          if (!previousExport) throw new VideoDomainError({ code: "EXPORT_NOT_FOUND", message: "Prompt package export no longer exists", statusCode: 404 });
          result = module.repository.enqueuePromptPackageExport({
            ownerId: OWNER_ID,
            projectId: project.id,
            kind: previousExport.kind,
            idempotency: retryIdempotency,
            retryOfJobId: previous.id,
          });
        } else {
          result = module.repository.enqueuePrototypeAnalysis({
            ownerId: OWNER_ID,
            projectId: project.id,
            expectedProjectRevision: project.revision,
            policyVersion: "retry-existing-acceptance",
            requestId: request.id,
            idempotency: retryIdempotency,
            retryOfJobId: previous.id,
          });
        }
        return reply.code(202).send(result);
      });

      videoApp.get<{ Params: { projectId: string } }>("/projects/:projectId/scenes", async (request) => {
        if (!module.repository.getProject(OWNER_ID, request.params.projectId)) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
        return { scenes: module.repository.listScenes(OWNER_ID, request.params.projectId) };
      });

      videoApp.post<{ Params: { projectId: string } }>("/projects/:projectId/storyboard-runs", async (request, reply) => {
        const body = record(request.body);
        const expectedProjectRevision = Number(body.expected_project_revision);
        if (!Number.isSafeInteger(expectedProjectRevision) || expectedProjectRevision < 1) {
          throw new VideoDomainError({ code: "INVALID_PROJECT_REVISION", message: "expected_project_revision is required", statusCode: 400 });
        }
        const result = module.repository.enqueueStoryboardBatch({
          ownerId: OWNER_ID,
          projectId: request.params.projectId,
          expectedProjectRevision,
          idempotency: idempotency(request, "POST /projects/:projectId/storyboard-runs", request.body),
        });
        return reply.code(202).send(result);
      });

      videoApp.get<{ Params: { projectId: string; sceneId: string } }>("/projects/:projectId/scenes/:sceneId", async (request, reply) => {
        const scene = module.repository.getScene(OWNER_ID, request.params.sceneId, request.params.projectId);
        if (!scene) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
        return reply.header("etag", etag(scene.revision)).send({ scene });
      });

      videoApp.patch<{ Params: { projectId: string; sceneId: string } }>("/projects/:projectId/scenes/:sceneId", async (request, reply) => {
        if (!module.repository.getScene(OWNER_ID, request.params.sceneId, request.params.projectId)) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
        const body = record(request.body);
        const patch: {
          headline?: string;
          overlay?: string;
          caption?: string;
          script?: string;
          prompt?: string;
          duration_sec?: number;
        } = {};
        for (const key of ["headline", "overlay", "caption", "script", "prompt"] as const) {
          if (body[key] !== undefined) patch[key] = optionalText(body[key], key === "prompt" ? 8_000 : 2_000) ?? "";
        }
        if (body.duration_sec !== undefined) {
          const duration = Number(body.duration_sec);
          if (!Number.isFinite(duration) || duration <= 0 || duration > 30 || Math.abs(duration * 100 - Math.round(duration * 100)) > 1e-7) {
            throw new VideoDomainError({ code: "INVALID_DURATION", message: "duration_sec must be 0–30 seconds with at most two decimals", statusCode: 400 });
          }
          patch.duration_sec = duration;
        }
        if (Object.keys(patch).length === 0) throw new VideoDomainError({ code: "INVALID_REQUEST", message: "No editable scene fields were provided", statusCode: 400 });
        const scene = module.repository.updateScene(
          OWNER_ID,
          request.params.sceneId,
          ifMatchRevision(request),
          patch,
          idempotency(request, "PATCH /projects/:projectId/scenes/:sceneId", request.body),
        );
        return reply.header("etag", etag(scene.revision)).send({ scene });
      });

      videoApp.post<{ Params: { projectId: string; sceneId: string } }>("/projects/:projectId/scenes/:sceneId/image-runs", async (request, reply) => {
        if (!module.repository.getScene(OWNER_ID, request.params.sceneId, request.params.projectId)) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
        const body = record(request.body ?? {});
        const regenerationScope = text(body.regeneration_scope) || "rebuild_from_current_fields";
        const allowedScopes = [
          "keep_composition_change_action",
          "keep_product_change_environment",
          "keep_all_change_seed",
          "rebuild_from_current_fields",
        ];
        if (!allowedScopes.includes(regenerationScope)) {
          throw new VideoDomainError({ code: "INVALID_REQUEST", message: "Unsupported regeneration_scope", statusCode: 400, details: { allowed_scopes: allowedScopes } });
        }
        const result = module.repository.enqueueSceneGeneration({
          ownerId: OWNER_ID,
          sceneId: request.params.sceneId,
          expectedRevision: ifMatchRevision(request),
          regenerationScope,
          idempotency: idempotency(request, "POST /projects/:projectId/scenes/:sceneId/image-runs", request.body ?? {}),
        });
        return reply.code(202).send(result);
      });

      videoApp.post<{ Params: { projectId: string; sceneId: string } }>("/projects/:projectId/scenes/:sceneId/locks", async (request, reply) => {
        if (!module.repository.getScene(OWNER_ID, request.params.sceneId, request.params.projectId)) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
        const scene = module.repository.lockScene(
          OWNER_ID,
          request.params.sceneId,
          ifMatchRevision(request),
          idempotency(request, "POST /projects/:projectId/scenes/:sceneId/locks", request.body ?? {}),
        );
        return reply.header("etag", etag(scene.revision)).send({ scene });
      });

      videoApp.delete<{ Params: { projectId: string; sceneId: string } }>("/projects/:projectId/scenes/:sceneId/locks/current", async (request, reply) => {
        if (!module.repository.getScene(OWNER_ID, request.params.sceneId, request.params.projectId)) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
        const scene = module.repository.unlockScene(
          OWNER_ID,
          request.params.sceneId,
          idempotency(request, "DELETE /projects/:projectId/scenes/:sceneId/locks/current", request.body ?? {}),
        );
        return reply.header("etag", etag(scene.revision)).send({ scene });
      });

      videoApp.post<{ Params: { projectId: string; sceneId: string } }>("/projects/:projectId/scenes/:sceneId/qc-acceptances", async (request, reply) => {
        if (!module.repository.getScene(OWNER_ID, request.params.sceneId, request.params.projectId)) throw new VideoDomainError({ code: "SCENE_NOT_FOUND", message: "Storyboard scene not found", statusCode: 404 });
        const body = record(request.body);
        const reason = optionalText(body.reason, 500);
        if (!reason) throw new VideoDomainError({ code: "INVALID_REQUEST", message: "QC acceptance reason is required", statusCode: 400 });
        const scene = module.repository.acceptSceneQc({
          ownerId: OWNER_ID,
          sceneId: request.params.sceneId,
          expectedRevision: ifMatchRevision(request),
          reason,
          requestId: request.id,
          idempotency: idempotency(request, "POST /projects/:projectId/scenes/:sceneId/qc-acceptances", request.body),
        });
        return reply.header("etag", etag(scene.revision)).send({ scene });
      });

      videoApp.post<{ Params: { projectId: string } }>("/projects/:projectId/exports", async (request, reply) => {
        const body = record(request.body);
        const kind = text(body.kind) || "draft";
        if (kind !== "draft" && kind !== "final") {
          throw new VideoDomainError({ code: "INVALID_REQUEST", message: "Export kind must be draft or final", statusCode: 400 });
        }
        const result = module.repository.enqueuePromptPackageExport({
          ownerId: OWNER_ID,
          projectId: request.params.projectId,
          kind,
          idempotency: idempotency(request, "POST /projects/:projectId/exports", request.body),
        });
        return reply.code(202).send(result);
      });

      videoApp.get<{ Params: { projectId: string } }>("/projects/:projectId/exports", async (request) => {
        if (!module.repository.getProject(OWNER_ID, request.params.projectId)) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
        return { exports: module.repository.listExports(OWNER_ID, request.params.projectId) };
      });

      videoApp.get<{ Params: { exportId: string } }>("/exports/:exportId", async (request) => {
        const exported = module.repository.getExport(OWNER_ID, request.params.exportId);
        if (!exported) throw new VideoDomainError({ code: "EXPORT_NOT_FOUND", message: "Prompt package export not found", statusCode: 404 });
        return {
          export: exported,
          download_url: exported.status === "ready" ? `/api/video/v1/exports/${exported.id}/download` : null,
        };
      });

      videoApp.get<{ Params: { exportId: string } }>("/exports/:exportId/download", async (request, reply) => {
        const download = module.repository.getExportDownload(OWNER_ID, request.params.exportId);
        if (!download) throw new VideoDomainError({ code: "EXPORT_NOT_READY", message: "Prompt package is not ready", statusCode: 409 });
        return reply
          .header("content-type", "application/zip")
          .header("content-length", String(download.bytes))
          .header("content-disposition", `attachment; filename="${download.filename}"`)
          .send(module.storage.createReadStream(download.storageKey));
      });

      videoApp.get<{ Params: { assetId: string } }>("/assets/:assetId/content", async (request, reply) => {
        const asset = module.repository.getAssetDownload(OWNER_ID, request.params.assetId);
        if (!asset) throw new VideoDomainError({ code: "ASSET_NOT_FOUND", message: "Video asset not found", statusCode: 404 });
        return reply
          .header("content-type", asset.mimeType)
          .header("content-length", String(asset.bytes))
          .header("cache-control", "private, max-age=60")
          .send(module.storage.createReadStream(asset.storageKey));
      });

      videoApp.get<{ Params: { projectId: string } }>("/projects/:projectId/events", async (request, reply) => {
        if (!module.repository.getProject(OWNER_ID, request.params.projectId)) throw new VideoDomainError({ code: "PROJECT_NOT_FOUND", message: "Video project not found", statusCode: 404 });
        const header = request.headers["last-event-id"];
        const parsed = Number(Array.isArray(header) ? header[0] : header);
        const afterId = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
        reply.hijack();
        reply.raw.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        reply.raw.write(": connected\n\n");
        const unsubscribe = module.events.subscribe(request.params.projectId, afterId, (event) => {
          reply.raw.write(`id: ${event.id}\n`);
          reply.raw.write(`event: ${event.type}\n`);
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        const keepAlive = setInterval(() => reply.raw.write(": keepalive\n\n"), 15_000);
        request.raw.once("close", () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
      });

      videoApp.post("/renders", async () => {
        throw new VideoDomainError({
          code: "FEATURE_NOT_ENABLED",
          message: "V1 generates storyboards and Prompt packages, not rendered MP4 files",
          statusCode: 404,
          nextAction: "export_prompt_package",
        });
      });
    },
    { prefix: "/api/video/v1" },
  );

  return module;
}
