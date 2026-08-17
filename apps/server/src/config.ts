import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadRootEnvironment(
  environmentPath = resolve(repositoryRoot, ".env"),
): void {
  loadDotEnv({ path: environmentPath });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function commaList(value: string | undefined, fallback: string[]): string[] {
  const result = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return result.length > 0 ? [...new Set(result)] : fallback;
}

function resolveFromRoot(value: string | undefined, fallback: string): string {
  const chosen = value?.trim() || fallback;
  return isAbsolute(chosen) ? chosen : resolve(repositoryRoot, chosen);
}

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  publicDirectory: string;
  tiktokAppKey: string;
  tiktokAppSecret: string;
  tiktokApiBaseUrl: string;
  tiktokProductApiVersion: string;
  tokenEncryptionKey: string;
  extensionSharedKey: string;
  apiMinIntervalMs: number;
  matchReadIntervalMs: number;
  apiMaxAttempts: number;
  taskLeaseMinutes: number;
  video?: VideoConfig;
}

export interface VideoConfig {
  enabled: boolean;
  storageDriver: "local";
  storageRoot: string;
  tempRoot: string;
  maxSourceBytes: number;
  maxProductImageBytes: number;
  workerMode: "embedded" | "standalone";
  jobPollMs: number;
  jobLeaseMs: number;
  jobHeartbeatMs: number;
  workerShutdownGraceMs: number;
  mediaConcurrency: number;
  textConcurrency: number;
  imageConcurrency: number;
  eventPollActiveMs: number;
  eventPollIdleMs: number;
  allowedMarkets: string[];
  allowedLanguages: string[];
  assetRetentionDays: number;
  dataEncryptionKey: string;
  projectBudgetUnits: number;
  fakeProvider: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  mediaProcessTimeoutMs: number;
  maxDecodedPixels: number;
  maxExtractedFrames: number;
}

export function loadVideoConfig(env: NodeJS.ProcessEnv = process.env): VideoConfig {
  const storageDriver = env.VIDEO_STORAGE_DRIVER?.trim().toLowerCase() || "local";
  if (storageDriver !== "local") throw new Error("Phase A only supports VIDEO_STORAGE_DRIVER=local");
  const rawWorkerMode = env.VIDEO_WORKER_MODE?.trim().toLowerCase() || "embedded";
  if (rawWorkerMode !== "embedded" && rawWorkerMode !== "standalone") {
    throw new Error("VIDEO_WORKER_MODE must be embedded or standalone");
  }
  const workerMode = rawWorkerMode;
  return {
    enabled: booleanValue(env.VIDEO_FEATURE_ENABLED, true),
    storageDriver: "local",
    storageRoot: resolveFromRoot(env.VIDEO_STORAGE_ROOT, "data/video-assets"),
    tempRoot: resolveFromRoot(env.VIDEO_TEMP_ROOT, "data/video-tmp"),
    maxSourceBytes: positiveInteger(env.VIDEO_MAX_SOURCE_BYTES, 150 * 1024 * 1024),
    maxProductImageBytes: positiveInteger(env.VIDEO_MAX_PRODUCT_IMAGE_BYTES, 10 * 1024 * 1024),
    workerMode,
    jobPollMs: positiveInteger(env.VIDEO_JOB_POLL_MS, 1_000),
    jobLeaseMs: positiveInteger(env.VIDEO_JOB_LEASE_SECONDS, 180) * 1_000,
    jobHeartbeatMs: positiveInteger(env.VIDEO_JOB_HEARTBEAT_SECONDS, 45) * 1_000,
    workerShutdownGraceMs: positiveInteger(env.VIDEO_WORKER_SHUTDOWN_GRACE_MS, 10_000),
    mediaConcurrency: positiveInteger(env.VIDEO_MEDIA_CONCURRENCY, 1),
    textConcurrency: positiveInteger(env.VIDEO_TEXT_AI_CONCURRENCY, 2),
    imageConcurrency: positiveInteger(env.VIDEO_IMAGE_AI_CONCURRENCY, 3),
    eventPollActiveMs: positiveInteger(env.VIDEO_EVENT_POLL_ACTIVE_MS, 500),
    eventPollIdleMs: positiveInteger(env.VIDEO_EVENT_POLL_IDLE_MS, 2_000),
    allowedMarkets: commaList(env.VIDEO_ALLOWED_MARKETS, ["MY"]).map((value) => value.toUpperCase()),
    allowedLanguages: commaList(env.VIDEO_ALLOWED_LANGUAGES, ["ms-MY", "en-MY"]),
    assetRetentionDays: positiveInteger(env.VIDEO_ASSET_RETENTION_DAYS, 30),
    dataEncryptionKey: env.VIDEO_DATA_ENCRYPTION_KEY?.trim() || "",
    projectBudgetUnits: positiveInteger(env.VIDEO_PROJECT_BUDGET_UNITS, 100),
    fakeProvider: booleanValue(env.VIDEO_FAKE_PROVIDER, true),
    ffmpegPath: env.VIDEO_FFMPEG_PATH?.trim() || "ffmpeg",
    ffprobePath: env.VIDEO_FFPROBE_PATH?.trim() || "ffprobe",
    mediaProcessTimeoutMs: positiveInteger(env.VIDEO_MEDIA_PROCESS_TIMEOUT_MS, 60_000),
    maxDecodedPixels: positiveInteger(env.VIDEO_MAX_DECODED_PIXELS, 40_000_000),
    maxExtractedFrames: positiveInteger(env.VIDEO_MAX_EXTRACTED_FRAMES, 24),
  };
}

export function resolveVideoConfig(config: AppConfig): VideoConfig {
  return config.video ?? loadVideoConfig({});
}

function pathIsInside(parent: string, child: string): boolean {
  const candidate = relative(resolve(parent), resolve(child));
  return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
}

export function validateVideoConfig(config: AppConfig): void {
  const video = resolveVideoConfig(config);
  if (!video.enabled) return;
  if (video.workerMode !== "embedded") {
    throw new Error("SQLite deployments require VIDEO_WORKER_MODE=embedded");
  }
  if (video.jobLeaseMs < video.jobHeartbeatMs * 3) {
    throw new Error("VIDEO_JOB_LEASE_SECONDS must be at least 3 × VIDEO_JOB_HEARTBEAT_SECONDS");
  }
  if (pathIsInside(config.publicDirectory, video.storageRoot) || pathIsInside(config.publicDirectory, video.tempRoot)) {
    throw new Error("Video storage and temporary directories must not be inside apps/server/public");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("Video Alpha has no public authentication yet; HOST must remain on loopback");
  }
  if (video.allowedMarkets.length === 0 || video.allowedLanguages.length === 0) {
    throw new Error("At least one video market and language must be configured");
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: positiveInteger(env.PORT, 3210),
    databasePath: resolveFromRoot(env.DATABASE_PATH, "data/tibao.sqlite"),
    publicDirectory: resolve(repositoryRoot, "apps/server/public"),
    tiktokAppKey: env.TIKTOK_APP_KEY?.trim() || "",
    tiktokAppSecret: env.TIKTOK_APP_SECRET?.trim() || "",
    tiktokApiBaseUrl:
      env.TIKTOK_API_BASE_URL?.trim() || "https://open-api.tiktokglobalshop.com",
    tiktokProductApiVersion: /^\d{6}$/.test(env.TIKTOK_PRODUCT_API_VERSION?.trim() ?? "")
      ? (env.TIKTOK_PRODUCT_API_VERSION?.trim() as string)
      : "202309",
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY || "",
    extensionSharedKey: env.EXTENSION_SHARED_KEY || "",
    apiMinIntervalMs: positiveInteger(env.API_MIN_INTERVAL_MS, 750),
    matchReadIntervalMs: positiveInteger(env.MATCH_READ_INTERVAL_MS, 250),
    apiMaxAttempts: positiveInteger(env.API_MAX_ATTEMPTS, 3),
    taskLeaseMinutes: positiveInteger(env.TASK_LEASE_MINUTES, 30),
    video: loadVideoConfig(env),
  };
}

export function isTikTokAppConfigured(config: AppConfig): boolean {
  return Boolean(config.tiktokAppKey && config.tiktokAppSecret);
}
