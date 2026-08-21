import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
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
  assert.match(studioApp.body, /真实多模态 Provider/);
  assert.match(studioApp.body, /artifactData\(analysis, "source_blueprint"\)/);
  assert.match(studioApp.body, /sceneStatusLabel/);
  assert.match(studioApp.body, /storyboardUrl/);
  assert.doesNotMatch(studioApp.body, /const SCENES =/);
  assert.doesNotMatch(studioApp.body, /TOTAL_DURATION/);
  assert.doesNotMatch(studioApp.body, /14 CUTS/);
  assert.doesNotMatch(studioApp.body, /结构置信度 92%/);
  assert.match(studioApp.body, /\/api\/video\/v1/);
  assert.match(studioApp.body, /分析爆款结构/);
  assert.match(studioApp.body, /模型响应超时，等待自动重试/);
  assert.match(studioApp.body, /stage === "reconciling" \|\| stage === "retry_wait"/);
  assert.match(studioApp.body, /window\.setTimeout\(poll, 1_500\)/);
  assert.match(studioApp.body, /导出 Prompt 包/);
  assert.match(studioApp.body, /"idempotency-key": createIdempotencyKey\(\)/);

  const helperStart = studioApp.body.indexOf("function createIdempotencyKey()");
  const helperEnd = studioApp.body.indexOf("\n\nfunction writeHeaders()", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = studioApp.body.slice(helperStart, helperEnd);

  const insecureContext = { window: { crypto: {} }, idempotencyKey: "" };
  vm.runInNewContext(`${helperSource}\nidempotencyKey = createIdempotencyKey();`, insecureContext);
  assert.match(insecureContext.idempotencyKey, /^tibao-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);

  const webCryptoContext = {
    window: { crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) } },
    idempotencyKey: "",
  };
  vm.runInNewContext(`${helperSource}\nidempotencyKey = createIdempotencyKey();`, webCryptoContext);
  assert.equal(webCryptoContext.idempotencyKey, "abababab-abab-4bab-abab-abababababab");

  const consolePage = await app.inject({ method: "GET", url: "/" });
  assert.equal(consolePage.statusCode, 200);
  assert.match(consolePage.body, /id="create-video-from-product"/);
  assert.match(consolePage.body, /id="auto-submit"/);
  assert.match(consolePage.body, /一键自动提报全店商品/);

  const consoleApp = await app.inject({ method: "GET", url: "/app.js" });
  assert.equal(consoleApp.statusCode, 200);
  assert.match(consoleApp.body, /openVideoStudioForSelectedProduct/);
  assert.match(consoleApp.body, /sessionStorage\.setItem\("tibao:video-product"/);
  assert.match(consoleApp.body, /shopRegion/);
  assert.match(consoleApp.body, /startAutomaticSubmission/);
  assert.match(consoleApp.body, /\/api\/automatic-submissions/);
});
