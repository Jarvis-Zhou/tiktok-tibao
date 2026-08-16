import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../static/manifest.json", import.meta.url), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const globalSellingPattern = "https://seller.tiktokshopglobalselling.com/*";

test("injects the content script into TikTok Shop Global Selling", () => {
  assert.ok(manifest.host_permissions.includes(globalSellingPattern));
  assert.ok(manifest.content_scripts.some(
    (entry) =>
      entry.matches.includes(globalSellingPattern)
      && entry.js.includes("content.js")
      && entry.run_at === "document_start"
      && entry.world === "ISOLATED",
  ));
  assert.ok(manifest.content_scripts.some(
    (entry) =>
      entry.matches.includes(globalSellingPattern)
      && entry.js.includes("page-capture.js")
      && entry.run_at === "document_start"
      && entry.world === "MAIN",
  ));
});

test("keeps the package and manifest versions aligned", () => {
  assert.equal(manifest.version, packageJson.version);
});
