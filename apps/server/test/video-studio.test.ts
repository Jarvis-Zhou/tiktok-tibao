import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

test("serves the integrated video studio and Tibao handoff hooks", async (t) => {
  const app = Fastify();
  t.after(async () => app.close());
  await app.register(staticPlugin, {
    root: publicDirectory,
    prefix: "/",
    index: ["index.html"],
  });

  const studio = await app.inject({ method: "GET", url: "/video-studio/" });
  assert.equal(studio.statusCode, 200);
  assert.match(studio.body, /Tibao · AI 视频工作台/);
  assert.match(studio.body, /src="app\.jsx"/);

  const studioApp = await app.inject({ method: "GET", url: "/video-studio/app.jsx" });
  assert.equal(studioApp.statusCode, 200);
  assert.match(studioApp.body, /tibao:video-product/);
  assert.match(studioApp.body, /accept="video\/mp4,\.mp4"/);
  assert.match(studioApp.body, /Phase A 已连接本地服务/);
  assert.match(studioApp.body, /\/api\/video\/v1/);
  assert.match(studioApp.body, /分析爆款结构/);
  assert.match(studioApp.body, /导出 Prompt 包/);

  const consolePage = await app.inject({ method: "GET", url: "/" });
  assert.equal(consolePage.statusCode, 200);
  assert.match(consolePage.body, /id="create-video-from-product"/);

  const consoleApp = await app.inject({ method: "GET", url: "/app.js" });
  assert.equal(consoleApp.statusCode, 200);
  assert.match(consoleApp.body, /openVideoStudioForSelectedProduct/);
  assert.match(consoleApp.body, /sessionStorage\.setItem\("tibao:video-product"/);
  assert.match(consoleApp.body, /shopRegion/);
});
