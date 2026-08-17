import assert from "node:assert/strict";
import test from "node:test";
import { assertPrototypeAnalysisResult } from "@tibao/video-core";
import { FakeVideoProvider } from "../src/index.js";

test("fake provider emits a deterministic six-scene schema-valid storyboard", async () => {
  const provider = new FakeVideoProvider(0);
  const result = await provider.analyze(
    {
      projectId: "project-1",
      projectName: "Test",
      targetMarket: "MY",
      language: "ms-MY",
      targetDurationSec: null,
      similarityScore: 60,
      sourceAssetId: "source-1",
      productAssetIds: ["image-1"],
      catalogTitle: "Portable Blender",
    },
    new AbortController().signal,
  );
  assertPrototypeAnalysisResult(result);
  assert.equal(result.scenes.length, 6);
  assert.match(result.scenes[2]?.headline ?? "", /Portable Blender/);
});
