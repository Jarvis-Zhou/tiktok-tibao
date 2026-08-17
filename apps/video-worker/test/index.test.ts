import assert from "node:assert/strict";
import test from "node:test";
import { assertStandaloneWorkerSupported } from "../src/index.js";

test("standalone worker rejects the SQLite deployment mode", () => {
  assert.throws(() => assertStandaloneWorkerSupported("sqlite"), /refuses SQLite/);
  assert.doesNotThrow(() => assertStandaloneWorkerSupported("postgresql"));
});
