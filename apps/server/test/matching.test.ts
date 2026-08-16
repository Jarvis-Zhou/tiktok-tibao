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

function testConfig(directory: string): AppConfig {
  return {
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
}

test("loads a selected product and returns explainable eligible matches", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-match-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  const vault = new TokenVault("a-test-key-that-is-long-enough");
  const originalFetch = globalThis.fetch;
  const config = testConfig(directory);

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
                opportunity_type: "KEYWORD",
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
            opportunity_type: "KEYWORD",
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

test("excludes opportunities when the detail request fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-match-detail-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  const vault = new TokenVault("a-test-key-that-is-long-enough");
  const originalFetch = globalThis.fetch;
  const config = testConfig(directory);

  try {
    const shop = database.createShop({
      name: "MX test",
      shopCipher: "cipher-detail",
      encryptedAccessToken: vault.encrypt("access-token"),
    });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/products/product-1")) {
        return response({
          product: {
            id: "product-1",
            title: "Organizador de cocina",
            status: "LIVE",
            category: { id: "601234", name: "Organizadores" },
          },
        });
      }
      if (url.pathname.endsWith("/opportunities/query")) {
        return response({
          opportunities: [
            {
              opportunity_id: "opp-1",
              title: "Organizadores",
              opportunity_type: "CATEGORY",
              status: "ACTIVE",
              listing_criteria: { category_ids: ["601234"] },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/opportunities/opp-1")) {
        throw new Error("detail unavailable");
      }
      if (url.pathname.endsWith("/opportunities/submissions")) {
        return response({ submissions: [] });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };

    const result = await new ApiRunner(config, database, vault).matchProducts(shop.id, [
      "product-1",
    ]);
    assert.equal(result.opportunityCount, 1);
    assert.equal(result.candidatePairCount, 1);
    assert.equal(result.blockedPairCount, 1);
    assert.equal(result.matches.length, 0);
    assert.match(result.warnings.join(" "), /详情读取失败.*已排除/);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pauses an API task before submission when fresh details do not match", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-pre-submit-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  const vault = new TokenVault("a-test-key-that-is-long-enough");
  const originalFetch = globalThis.fetch;
  const config = testConfig(directory);
  let submitCalls = 0;

  try {
    const shop = database.createShop({
      name: "MX test",
      shopCipher: "cipher-submit",
      encryptedAccessToken: vault.encrypt("access-token"),
    });
    const batch = database.createBatch({
      filename: "unsafe.json",
      source: "test",
      validRows: [
        {
          input: {
            sourceRow: 2,
            shopId: shop.id,
            opportunityId: "opp-1",
            productId: "product-1",
            channel: "api",
          },
          key: "unsafe-pair",
        },
      ],
      invalidRows: [],
      totalRows: 1,
    });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/products/product-1")) {
        return response({
          product: {
            id: "product-1",
            title: "Playera de algodón",
            status: "ACTIVATE",
            category: { id: "fashion", name: "Moda" },
          },
        });
      }
      if (url.pathname.endsWith("/opportunities/opp-1/submit")) {
        submitCalls += 1;
        return response({ submission: { id: "submission-1", status: "PENDING_REVIEW" } });
      }
      if (url.pathname.endsWith("/opportunities/opp-1")) {
        return response({
          opportunity: {
            id: "opp-1",
            title: "Electrónica",
            opportunity_type: "CATEGORY",
            status: "ACTIVE",
            listing_criteria: { category_ids: ["electronics"] },
          },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };

    const runner = new ApiRunner(config, database, vault);
    assert.equal(runner.startBatch(batch.id), true);
    let task = database.listTasks({ batchId: batch.id })[0];
    for (let attempt = 0; attempt < 100 && ["ready", "running"].includes(task?.status ?? ""); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      task = database.listTasks({ batchId: batch.id })[0];
    }
    assert.equal(task?.status, "paused");
    assert.equal(task?.errorCode, "LOCAL_ELIGIBILITY_CHECK_FAILED");
    assert.match(task?.errorMessage ?? "", /类目.*不匹配/);
    assert.equal(submitCalls, 0);
    for (let attempt = 0; attempt < 100 && runner.isBatchRunning(batch.id); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(runner.isBatchRunning(batch.id), false);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
