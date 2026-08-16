import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRootEnvironment } from "../src/config.js";

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
