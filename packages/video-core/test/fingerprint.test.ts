import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrototypeAnalysisResult,
  canonicalJson,
  extractSchemaAssetReferences,
  sha256Fingerprint,
} from "../src/index.js";

test("fingerprints objects independently of key insertion order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(sha256Fingerprint({ b: 2, a: 1 }), sha256Fingerprint({ a: 1, b: 2 }));
});

test("asset references are extracted only from versioned schema pointers", () => {
  assert.deepEqual(
    extractSchemaAssetReferences("product-profile-v1", {
      image_asset_ids: ["asset-1", "asset-2"],
      untrusted_nested_value: { asset_id: "must-not-be-extracted" },
    }),
    ["asset-1", "asset-2"],
  );
});

test("prototype schema rejects fewer than three scenes", () => {
  assert.throws(
    () => assertPrototypeAnalysisResult({ schema_version: "prototype-analysis-v1", scenes: [] }),
    /between 3 and 6 scenes/,
  );
});
