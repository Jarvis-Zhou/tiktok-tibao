import assert from "node:assert/strict";
import test from "node:test";
import { VideoDomainError } from "@tibao/video-core";
import { validateStructuredOutput } from "../src/index.js";

function assertReady(value: unknown): asserts value is { ready: true } {
  if (!value || typeof value !== "object" || (value as { ready?: unknown }).ready !== true) {
    throw new VideoDomainError({ code: "BLUEPRINT_SCHEMA_INVALID", message: "ready must be true" });
  }
}

test("structured output is repaired at most twice and returns only a validated value", async () => {
  const attempts: number[] = [];
  const result = await validateStructuredOutput({
    value: { ready: false },
    validate: assertReady,
    signal: new AbortController().signal,
    repair: async (_value, context) => {
      attempts.push(context.attempt);
      return context.attempt === 2 ? { ready: true } : { ready: false };
    },
  });
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(result.value, { ready: true });
  assert.equal(result.repairAttempts, 2);
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
});
