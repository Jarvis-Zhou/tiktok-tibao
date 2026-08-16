import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { AppConfig } from "../src/config.js";
import { TibaoDatabase } from "../src/database.js";
import { registerRoutes } from "../src/routes.js";
import type { ApiRunner } from "../src/runner.js";
import { TokenVault } from "../src/token-vault.js";

test("requires explicit confirmation before creating a matched batch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-routes-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  const vault = new TokenVault("a-test-key-that-is-long-enough");
  const app = Fastify();
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
  const runner = {
    configured: true,
    startBatch: () => false,
  } as unknown as ApiRunner;

  try {
    const shop = database.createShop({
      name: "MX test",
      shopCipher: "cipher-1",
      encryptedAccessToken: vault.encrypt("access-token"),
    });
    await registerRoutes(app, { config, database, vault, runner });

    const unconfirmed = await app.inject({
      method: "POST",
      url: "/api/opportunity-matches/batch",
      payload: {
        shopId: shop.id,
        selections: [{ productId: "product-1", opportunityId: "opp-1", channel: "api" }],
      },
    });
    assert.equal(unconfirmed.statusCode, 400);

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/opportunity-matches/batch",
      payload: {
        shopId: shop.id,
        confirmed: true,
        selections: [{ productId: "product-1", opportunityId: "opp-1", channel: "extension" }],
      },
    });
    assert.equal(confirmed.statusCode, 201);
    const body = confirmed.json();
    assert.equal(body.batch.validRows, 1);
    assert.equal(database.listTasks({ batchId: body.batch.id })[0]?.channel, "extension");
  } finally {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("imports extension-captured products with shared-key authentication", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-extension-products-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  const vault = new TokenVault("");
  const app = Fastify();
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 3210,
    databasePath: join(directory, "queue.sqlite"),
    publicDirectory: directory,
    tiktokAppKey: "",
    tiktokAppSecret: "",
    tiktokApiBaseUrl: "https://example.test",
    tiktokProductApiVersion: "202309",
    tokenEncryptionKey: "",
    extensionSharedKey: "extension-key",
    apiMinIntervalMs: 1,
    matchReadIntervalMs: 1,
    apiMaxAttempts: 1,
    taskLeaseMinutes: 30,
  };
  const runner = { configured: false } as unknown as ApiRunner;

  try {
    const shop = database.createShop({ name: "MX extension shop" });
    await registerRoutes(app, { config, database, vault, runner });
    const payload = {
      shopId: shop.id,
      sourceUrl: "https://seller-mx.tiktok.com/products",
      capturedAt: "2026-08-16T08:00:00.000Z",
      products: [
        {
          id: "1729384756102938475",
          title: "Producto de prueba",
          status: "LIVE",
          categoryName: "Hogar",
          brandName: "Casa MX",
          price: 329.9,
          currency: "MXN",
          stock: 48,
        },
      ],
    };

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/extension/products/import",
      payload,
    });
    assert.equal(unauthorized.statusCode, 401);

    const imported = await app.inject({
      method: "POST",
      url: "/api/extension/products/import",
      headers: { "x-extension-key": "extension-key" },
      payload,
    });
    assert.equal(imported.statusCode, 201);
    assert.deepEqual(imported.json().result, { total: 1, inserted: 1, updated: 0 });

    const listed = await app.inject({
      method: "GET",
      url: `/api/shops/${shop.id}/products`,
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().source, "extension");
    assert.equal(listed.json().products[0].id, "1729384756102938475");
    assert.equal(listed.json().products[0].stock, 48);
  } finally {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
