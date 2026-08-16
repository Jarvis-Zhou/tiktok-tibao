import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
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
  };
}

export function isTikTokAppConfigured(config: AppConfig): boolean {
  return Boolean(config.tiktokAppKey && config.tiktokAppSecret);
}
