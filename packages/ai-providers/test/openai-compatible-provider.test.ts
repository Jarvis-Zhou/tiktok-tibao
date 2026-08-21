import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { assertPrototypeAnalysisResult } from "@tibao/video-core";
import {
  FakeVideoProvider,
  OpenAiCompatibleAnalysisProvider,
  OpenAiCompatibleStoryboardProvider,
} from "../src/index.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v1`;
}

test("Responses analysis sends actual media pixels and returns provider metadata", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tibao-openai-analysis-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const framePath = join(directory, "frame.jpg");
  const contactPath = join(directory, "contact.jpg");
  const productPath = join(directory, "product.png");
  await Promise.all([
    writeFile(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    writeFile(contactPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    writeFile(productPath, ONE_PIXEL_PNG),
  ]);
  const fixture = (await new FakeVideoProvider(0).analyze({
    projectId: "project-1",
    projectName: "Portable Blender",
    targetMarket: "MY",
    language: "ms-MY",
    targetDurationSec: 15,
    similarityScore: 60,
    sourceAssetId: "source-1",
    sourceDurationSec: 15,
    sourceWidth: 1080,
    sourceHeight: 1920,
    audioAvailable: false,
    productAssetIds: ["product-1"],
    catalogTitle: "Portable Blender",
  }, new AbortController().signal)).value;
  let capturedAuthorization = "";
  let capturedPath = "";
  let capturedBody: Record<string, unknown> = {};
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      capturedAuthorization = String(request.headers.authorization ?? "");
      capturedPath = request.url ?? "";
      capturedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "request-analysis-1" });
      response.end(JSON.stringify({
        id: "response-1",
        model: "vision-test-model",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(fixture) }] }],
        usage: { input_tokens: 123, output_tokens: 45, total_tokens: 168 },
      }));
    });
  });
  t.after(() => server.close());
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatibleAnalysisProvider({
    baseUrl,
    apiKey: "secret-test-key",
    analysisModel: "vision-test-model",
    imageModel: "image-test-model",
    analysisApi: "responses",
    reasoningEffort: "high",
    maxFrames: 4,
  });
  const result = await provider.analyze({
    projectId: "project-1",
    projectName: "Portable Blender",
    targetMarket: "MY",
    language: "ms-MY",
    targetDurationSec: 15,
    similarityScore: 60,
    sourceAssetId: "source-1",
    sourceDurationSec: 15,
    sourceWidth: 1080,
    sourceHeight: 1920,
    audioAvailable: false,
    productAssetIds: ["product-1"],
    sourceFramePaths: [framePath],
    sourceContactSheetPath: contactPath,
    productImagePaths: [productPath],
    catalogTitle: "Portable Blender",
  }, new AbortController().signal);

  assert.equal(capturedAuthorization, "Bearer secret-test-key");
  assert.equal(capturedPath, "/v1/responses");
  assert.equal(capturedBody.model, "vision-test-model");
  assert.deepEqual(capturedBody.reasoning, { effort: "high" });
  assert.deepEqual(capturedBody.text, { format: { type: "json_object" } });
  assert.equal(typeof capturedBody.instructions, "string");
  const serialized = JSON.stringify(capturedBody);
  assert.match(serialized, /data:image\/jpeg;base64/);
  assert.match(serialized, /data:image\/png;base64/);
  assert.match(serialized, /input_image/);
  assert.match(serialized, /input_text/);
  assert.doesNotMatch(serialized, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assertPrototypeAnalysisResult(result.value);
  assert.equal(result.providerRequestId, "request-analysis-1");
  assert.equal(result.usage.total_tokens, 168);
  assert.equal(result.safety.media_inputs && (result.safety.media_inputs as Record<string, unknown>).sampled_frames, 1);
});

test("Responses analysis repairs a schema-invalid model result before returning it", async (t) => {
  const input = {
    projectId: "project-repair",
    projectName: "Repair fixture",
    targetMarket: "MX",
    language: "es-MX",
    targetDurationSec: 15,
    similarityScore: 60,
    sourceAssetId: "source-repair",
    sourceDurationSec: 15,
    sourceWidth: 1080,
    sourceHeight: 1920,
    audioAvailable: false,
    productAssetIds: ["product-repair"],
    catalogTitle: "Repair fixture",
  };
  const fixture = (await new FakeVideoProvider(0).analyze(input, new AbortController().signal)).value;
  const invalid = structuredClone(fixture);
  invalid.adapted_blueprint.scenes[0]!.source_shot_ids = ["unknown-shot"];
  let requestCount = 0;
  let repairBody = "";
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestCount += 1;
      if (requestCount === 2) repairBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": `request-repair-${requestCount}`,
      });
      response.end(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(requestCount === 1 ? invalid : fixture) }],
        }],
        usage: { total_tokens: 10 },
      }));
    });
  });
  t.after(() => server.close());
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatibleAnalysisProvider({
    baseUrl,
    apiKey: "secret-test-key",
    analysisModel: "vision-test-model",
    analysisApi: "responses",
  });

  const result = await provider.analyze(input, new AbortController().signal);

  assertPrototypeAnalysisResult(result.value);
  assert.equal(requestCount, 2);
  assert.equal(result.safety.structured_repair_attempts, 1);
  assert.equal(result.providerRequestId, "request-repair-1,request-repair-2");
  assert.equal(result.usage.total_tokens, 20);
  assert.match(repairBody, /references an unknown source shot/);
  assert.match(repairBody, /unknown-shot/);
});

test("OpenAI-compatible analysis can use local ASR without leaking cloud credentials or forcing target language", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tibao-local-asr-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const framePath = join(directory, "frame.jpg");
  const productPath = join(directory, "product.png");
  const audioPath = join(directory, "audio.wav");
  await Promise.all([
    writeFile(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    writeFile(productPath, ONE_PIXEL_PNG),
    writeFile(audioPath, Buffer.from("RIFF-local-asr-test", "utf8")),
  ]);

  const fixture = (await new FakeVideoProvider(0).analyze({
    projectId: "project-asr",
    projectName: "Portable Blender",
    targetMarket: "MX",
    language: "es-MX",
    targetDurationSec: 15,
    similarityScore: 60,
    sourceAssetId: "source-asr",
    sourceDurationSec: 15,
    sourceWidth: 1080,
    sourceHeight: 1920,
    audioAvailable: true,
    productAssetIds: ["product-asr"],
    catalogTitle: "Portable Blender",
  }, new AbortController().signal)).value;

  let asrAuthorization = "not-captured";
  let asrContentType = "";
  let asrMultipart = "";
  const asrServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      asrAuthorization = String(request.headers.authorization ?? "");
      asrContentType = String(request.headers["content-type"] ?? "");
      asrMultipart = Buffer.concat(chunks).toString("latin1");
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "request-asr-1" });
      response.end(JSON.stringify({
        text: "这是参考视频中的原声口播",
        language: "zh",
        duration: 14.8,
        segments: [{ id: 0, start: 0, end: 3.2, text: "这是参考视频中的原声口播" }],
      }));
    });
  });
  t.after(() => asrServer.close());
  const transcriptionBaseUrl = await listen(asrServer);

  let analysisAuthorization = "";
  let analysisPath = "";
  let analysisBody: Record<string, unknown> = {};
  const analysisServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      analysisAuthorization = String(request.headers.authorization ?? "");
      analysisPath = request.url ?? "";
      analysisBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "request-analysis-asr-test" });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(fixture) } }],
        usage: { total_tokens: 42 },
      }));
    });
  });
  t.after(() => analysisServer.close());
  const baseUrl = await listen(analysisServer);

  const provider = new OpenAiCompatibleAnalysisProvider({
    baseUrl,
    apiKey: "cloud-secret-key",
    analysisModel: "vision-test-model",
    imageModel: "image-test-model",
    analysisApi: "chat_completions",
    transcriptionProvider: "local",
    transcriptionBaseUrl,
    transcriptionApiKey: "",
    transcriptionModel: "small",
  });
  const result = await provider.analyze({
    projectId: "project-asr",
    projectName: "Portable Blender",
    targetMarket: "MX",
    language: "es-MX",
    targetDurationSec: 15,
    similarityScore: 60,
    sourceAssetId: "source-asr",
    sourceDurationSec: 15,
    sourceWidth: 1080,
    sourceHeight: 1920,
    audioAvailable: true,
    productAssetIds: ["product-asr"],
    sourceFramePaths: [framePath],
    sourceAudioPath: audioPath,
    productImagePaths: [productPath],
    catalogTitle: "Portable Blender",
  }, new AbortController().signal);

  assert.equal(asrAuthorization, "");
  assert.match(asrContentType, /^multipart\/form-data; boundary=/);
  assert.match(asrMultipart, /name="model"\r\n\r\nsmall/);
  assert.match(asrMultipart, /name="response_format"\r\n\r\nverbose_json/);
  assert.doesNotMatch(asrMultipart, /name="language"/);
  assert.equal(analysisAuthorization, "Bearer cloud-secret-key");
  assert.equal(analysisPath, "/v1/chat/completions");
  const serializedAnalysis = JSON.stringify(analysisBody);
  assert.match(serializedAnalysis, /detected source audio language: zh/);
  assert.match(serializedAnalysis, /这是参考视频中的原声口播/);
  assert.equal(result.value.source_blueprint.audio_style.transcript_status, "available");
  assert.equal(result.providerRequestId, "request-analysis-asr-test,request-asr-1");
  const transcription = result.safety.transcription as Record<string, unknown>;
  assert.deepEqual(transcription, {
    provider: "local",
    model: "small",
    detected_language: "zh",
    duration_sec: 14.8,
    segment_count: 1,
  });
});

test("OpenAI-compatible storyboard uses product image edit and requires manual QC", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tibao-openai-storyboard-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const productPath = join(directory, "product.png");
  await writeFile(productPath, ONE_PIXEL_PNG);
  let contentType = "";
  let multipart = "";
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      contentType = String(request.headers["content-type"] ?? "");
      multipart = Buffer.concat(chunks).toString("latin1");
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "request-image-1" });
      response.end(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }] }));
    });
  });
  t.after(() => server.close());
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatibleStoryboardProvider({
    baseUrl,
    apiKey: "secret-test-key",
    analysisModel: "vision-test-model",
    imageModel: "image-test-model",
  });
  const result = await provider.generate({
    projectId: "project-1",
    sceneId: "scene-1",
    generation: 1,
    imagePrompt: "Vertical product demo",
    negativePrompt: "watermark",
    productImagePaths: [productPath],
  }, new AbortController().signal);

  assert.match(contentType, /^multipart\/form-data; boundary=/);
  assert.match(multipart, /image-test-model/);
  assert.match(multipart, /Vertical product demo/);
  assert.match(multipart, /filename="product.png"/);
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.equal(result.qc.status, "needs_review");
  assert.equal(result.bytes.toString("base64"), ONE_PIXEL_PNG.toString("base64"));
});
