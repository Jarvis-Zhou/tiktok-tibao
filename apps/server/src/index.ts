import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { TikTokShopAuthClient } from "@tibao/tiktok-api";
import { loadConfig, loadRootEnvironment, validateVideoConfig } from "./config.js";
import { corsOptionsDelegate } from "./cors.js";
import { TibaoDatabase } from "./database.js";
import { registerRoutes } from "./routes.js";
import { ApiRunner } from "./runner.js";
import { TokenVault } from "./token-vault.js";
import { registerVideoRoutes } from "./video/routes.js";

loadRootEnvironment();
const config = loadConfig();
validateVideoConfig(config);
const database = new TibaoDatabase(config.databasePath);
const vault = new TokenVault(config.tokenEncryptionKey);
const runner = new ApiRunner(config, database, vault);
const oauthClient = new TikTokShopAuthClient({
  appKey: config.tiktokAppKey,
  appSecret: config.tiktokAppSecret,
  apiBaseUrl: config.tiktokApiBaseUrl,
});
const app = Fastify({ logger: true, bodyLimit: 6 * 1024 * 1024 });

await app.register(cors, {
  delegator: corsOptionsDelegate,
});
await app.register(multipart, {
  limits: { files: 1, fileSize: 5 * 1024 * 1024, fields: 10 },
});
await registerRoutes(app, { config, database, vault, runner, oauthClient });
const videoModule = await registerVideoRoutes(app, { config, database });
await app.register(staticPlugin, {
  root: config.publicDirectory,
  prefix: "/",
  index: ["index.html"],
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error({ err: error }, "request failed");
  const statusCandidate =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 500;
  const statusCode = Number.isFinite(statusCandidate) && statusCandidate >= 400 ? statusCandidate : 500;
  const message = error instanceof Error ? error.message : "未知错误";
  void reply.code(statusCode).send({ error: statusCode >= 500 ? "服务端处理失败" : message });
});

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  videoModule?.beginDrain();
  await app.close();
  await videoModule?.close();
  database.close();
};
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

await app.listen({ host: config.host, port: config.port });
