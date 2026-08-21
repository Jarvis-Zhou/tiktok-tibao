import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, loadRootEnvironment, validateVideoConfig } from "../src/config.js";

test("loads the environment from an explicit path instead of the working directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tibao-config-"));
  const environmentPath = join(directory, ".env");
  const previous = process.env.EXTENSION_SHARED_KEY;

  try {
    await writeFile(environmentPath, "EXTENSION_SHARED_KEY=fixture-shared-key\n", "utf8");
    delete process.env.EXTENSION_SHARED_KEY;

    loadRootEnvironment(environmentPath);

    assert.equal(process.env.EXTENSION_SHARED_KEY, "fixture-shared-key");
  } finally {
    if (previous === undefined) delete process.env.EXTENSION_SHARED_KEY;
    else process.env.EXTENSION_SHARED_KEY = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects unsafe local video deployment settings before startup", () => {
  assert.throws(
    () => validateVideoConfig(loadConfig({ HOST: "0.0.0.0" })),
    /HOST must remain on loopback/,
  );
  assert.throws(
    () => validateVideoConfig(loadConfig({ VIDEO_WORKER_MODE: "standalone" })),
    /require VIDEO_WORKER_MODE=embedded/,
  );
  assert.throws(
    () =>
      validateVideoConfig(
        loadConfig({
          VIDEO_JOB_LEASE_SECONDS: "60",
          VIDEO_JOB_HEARTBEAT_SECONDS: "30",
        }),
      ),
    /at least 3 ×/,
  );
});

test("allows an explicit non-loopback bind for a loopback-published container", () => {
  assert.doesNotThrow(() =>
    validateVideoConfig(
      loadConfig({
        HOST: "0.0.0.0",
        VIDEO_ALLOW_NON_LOOPBACK_HOST: "true",
      }),
    ),
  );
});

test("uses GPT-5.6 Responses defaults and requires credentials for the real video provider", () => {
  assert.throws(
    () => validateVideoConfig(loadConfig({ VIDEO_AI_PROVIDER: "openai" })),
    /VIDEO_AI_API_KEY or VIDEO_AI_API_KEY_FILE/,
  );

  const config = loadConfig({
    VIDEO_AI_PROVIDER: "openai",
    VIDEO_AI_BASE_URL: "https://provider.example.test/v1/",
    VIDEO_AI_API_KEY: "test-key",
    VIDEO_AI_ANALYSIS_MODEL: "vision-model",
    VIDEO_AI_IMAGE_MODEL: "image-model",
    VIDEO_AI_TRANSCRIPTION_MODEL: "speech-model",
  });
  assert.doesNotThrow(() => validateVideoConfig(config));
  assert.equal(config.video?.provider, "openai");
  assert.equal(config.video?.providerBaseUrl, "https://provider.example.test/v1");
  assert.equal(config.video?.fakeProvider, false);
  assert.equal(config.video?.storyboardProvider, "openai");
  assert.equal(config.video?.analysisApi, "responses");
  assert.equal(config.video?.analysisReasoningEffort, "medium");
  assert.equal(config.video?.providerRequestTimeoutMs, 300_000);
  assert.equal(config.video?.providerMaxFrames, 6);
  assert.equal(config.video?.transcriptionProvider, "openai");
  assert.equal(config.video?.transcriptionBaseUrl, "https://provider.example.test/v1");
  assert.equal(config.video?.transcriptionApiKey, "test-key");
  assert.equal(config.video?.transcriptionModel, "speech-model");
});

test("loads a model gateway token from a mounted Claude settings file without changing the model role", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tibao-model-credentials-"));
  const settingsPath = join(directory, "settings.json");
  try {
    await writeFile(settingsPath, JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "gateway-test-token",
        ANTHROPIC_MODEL: "unrelated-editor-model",
      },
    }), "utf8");
    const config = loadConfig({
      VIDEO_AI_PROVIDER: "openai",
      VIDEO_AI_STORYBOARD_PROVIDER: "fake",
      VIDEO_AI_API_KEY_FILE: settingsPath,
    });
    assert.doesNotThrow(() => validateVideoConfig(config));
    assert.equal(config.video?.providerApiKey, "gateway-test-token");
    assert.equal(config.video?.analysisModel, "gpt-5.6-sol");
    assert.equal(config.video?.storyboardProvider, "fake");
    assert.equal(config.video?.storyboardModel, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("configures a separate local ASR endpoint with safe CPU defaults", () => {
  const config = loadConfig({
    VIDEO_AI_PROVIDER: "openai",
    VIDEO_AI_API_KEY: "cloud-test-key",
    VIDEO_AI_ANALYSIS_MODEL: "vision-model",
    VIDEO_AI_IMAGE_MODEL: "image-model",
    VIDEO_ASR_PROVIDER: "local",
    VIDEO_LOCAL_ASR_BASE_URL: "http://127.0.0.1:8001/v1/",
    VIDEO_LOCAL_ASR_API_KEY: "local-test-key",
  });

  assert.doesNotThrow(() => validateVideoConfig(config));
  assert.equal(config.video?.transcriptionProvider, "local");
  assert.equal(config.video?.transcriptionBaseUrl, "http://127.0.0.1:8001/v1");
  assert.equal(config.video?.transcriptionApiKey, "local-test-key");
  assert.equal(config.video?.transcriptionModel, "small");
  assert.equal(config.video?.transcriptionRequestTimeoutMs, 600_000);
});

test("rejects invalid ASR selectors and endpoint URLs", () => {
  assert.throws(
    () => loadConfig({ VIDEO_ASR_PROVIDER: "whisperish" }),
    /VIDEO_ASR_PROVIDER must be disabled, openai, or local/,
  );
  assert.throws(
    () => validateVideoConfig(loadConfig({
      VIDEO_AI_PROVIDER: "openai",
      VIDEO_AI_API_KEY: "cloud-test-key",
      VIDEO_AI_ANALYSIS_MODEL: "vision-model",
      VIDEO_AI_IMAGE_MODEL: "image-model",
      VIDEO_ASR_PROVIDER: "local",
      VIDEO_LOCAL_ASR_BASE_URL: "ftp://asr.example.test/v1",
    })),
    /transcription base URL must use HTTP or HTTPS/,
  );
  assert.throws(
    () => validateVideoConfig(loadConfig({ VIDEO_ASR_PROVIDER: "local" })),
    /only used when VIDEO_AI_PROVIDER=openai/,
  );
});

test("rejects invalid analysis API, reasoning, and storyboard selectors", () => {
  assert.throws(
    () => loadConfig({ VIDEO_AI_ANALYSIS_API: "legacy-magic" }),
    /VIDEO_AI_ANALYSIS_API must be responses or chat-completions/,
  );
  assert.throws(
    () => loadConfig({ VIDEO_AI_REASONING_EFFORT: "extreme" }),
    /VIDEO_AI_REASONING_EFFORT must be/,
  );
  assert.throws(
    () => loadConfig({ VIDEO_AI_STORYBOARD_PROVIDER: "maybe" }),
    /VIDEO_AI_STORYBOARD_PROVIDER must be fake or openai/,
  );
});

test("keeps VIDEO_FAKE_PROVIDER as a backward-compatible provider selector", () => {
  assert.equal(loadConfig({ VIDEO_FAKE_PROVIDER: "true" }).video?.provider, "fake");
  assert.equal(loadConfig({ VIDEO_FAKE_PROVIDER: "false" }).video?.provider, "openai");
});
