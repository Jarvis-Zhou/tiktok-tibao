import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { TibaoDatabase } from "../src/database.js";
import { ApiRunner } from "../src/runner.js";
import { TokenVault } from "../src/token-vault.js";

function response(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data, request_id: "request-1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("loads a selected product and returns explainable eligible matches", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-match-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  const vault = new TokenVault("a-test-key-that-is-long-enough");
  const originalFetch = globalThis.fetch;
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 3210,
    databasePath: join(directory, "queue.sqlite"),
    publicDirectory: directory,
    tiktokAppKey: "app",
    tiktokAppSecret: "secret",
    tiktokApiBaseUrl: "https://example.test",
    tiktokProductApiVersion: "202309",
    tokenEncryptionKey: "a-test-key-that-is-long-enough",
    extensionSharedKey: "extension-key",
    apiMinIntervalMs: 1,
    matchReadIntervalMs: 1,
    apiMaxAttempts: 1,
    taskLeaseMinutes: 30,
  };

  try {
    const shop = database.createShop({
      name: "MX test",
      shopCipher: "cipher-1",
      encryptedAccessToken: vault.encrypt("access-token"),
    });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/products/product-1")) {
        return response({
          product: {
            id: "product-1",
            title: "Audífonos Bluetooth inalámbricos",
            status: "ACTIVATE",
            category: { id: "11", name: "Audífonos" },
            brand: { name: "Acme" },
            price: { amount: 399, currency: "MXN" },
          },
        });
      }
      if (url.pathname.endsWith("/opportunities/query")) {
        return response({
          data: {
            opportunities: [
              {
                opportunity_id: "opp-1",
                title: "Audífonos Bluetooth",
                status: "ACTIVE",
                listing_criteria: { category_ids: ["11"], brand: { name: "Acme" } },
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/opportunities/submissions")) {
        return response({ data: { submissions: [] } });
      }
      if (url.pathname.endsWith("/opportunities/opp-1")) {
        return response({
          opportunity: {
            id: "opp-1",
            title: "Audífonos Bluetooth",
            status: "ACTIVE",
            listing_criteria: {
              category_ids: ["11"],
              brand: { name: "Acme" },
              keywords: ["bluetooth", "inalámbricos"],
              product_statuses: ["ACTIVATE"],
            },
            reference_price: { amount: 420, currency: "MXN" },
          },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };

    const runner = new ApiRunner(config, database, vault);
    const result = await runner.matchProducts(shop.id, ["product-1"]);

    assert.equal(result.products.length, 1);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.opportunity.id, "opp-1");
    assert.equal(result.matches[0]?.eligible, true);
    assert.equal(result.matches[0]?.recommended, true);
    assert.ok((result.matches[0]?.reasons.length ?? 0) >= 3);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
