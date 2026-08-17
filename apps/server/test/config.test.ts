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
