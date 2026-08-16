import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { AppConfig } from "../src/config.js";
import { TibaoDatabase } from "../src/database.js";
import { captureRegionFromUrl, isAllowedCaptureSource, registerRoutes } from "../src/routes.js";
import { ApiRunner } from "../src/runner.js";
import { TokenVault } from "../src/token-vault.js";
import type { TikTokOAuthClient } from "../src/routes.js";

test("allows trusted Seller Center and fixture sources without accepting lookalike hosts", () => {
  assert.equal(
    isAllowedCaptureSource(
      "https://seller.tiktokshopglobalselling.com/product/manage?shop_region=MY",
    ),
    true,
  );
  assert.equal(isAllowedCaptureSource("https://seller-mx.tiktok.com/products"), true);
  assert.equal(
    isAllowedCaptureSource("http://127.0.0.1:3210/extension-product-fixture.html"),
    true,
  );
  assert.equal(
    isAllowedCaptureSource("https://seller.tiktokshopglobalselling.com.evil.example/products"),
    false,
  );
  assert.equal(
    isAllowedCaptureSource("http://seller.tiktokshopglobalselling.com/products"),
    false,
  );
  assert.equal(isAllowedCaptureSource("https://example.com/products"), false);
  assert.equal(
    captureRegionFromUrl(
      "https://seller.tiktokshopglobalselling.com/product/manage?shop_region=MY",
    ),
    "MY",
  );
  assert.equal(captureRegionFromUrl("https://seller.tiktokglobalshop.com/products?region=us"), "US");
  assert.equal(captureRegionFromUrl("https://seller-mx.tiktok.com/products"), "MX");
  assert.equal(captureRegionFromUrl("not-a-url"), "");
});

test("completes OAuth callback once and imports every authorized shop with its region", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-oauth-routes-test-"));
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
  let exchangedCodes = 0;
  const oauthClient: TikTokOAuthClient = {
    createAuthorizationUrl: (state) => `https://auth.example.test/oauth?state=${state}`,
    exchangeCode: async (authCode) => {
      exchangedCodes += 1;
      assert.equal(authCode, "callback-code");
      return {
        data: {
          access_token: "oauth-access-token",
          seller_name: "Seller MX",
          seller_base_region: "MX",
        },
        requestId: "token-request",
      };
    },
    listAuthorizedShops: async (accessToken) => {
      if (accessToken === "manual-access-token") {
        return {
          data: {
            shops: [
              { cipher: "my-cipher", code: "MY001", name: "Malaysia Shop", region: "MY" },
            ],
          },
          requestId: "manual-shops-request",
        };
      }
      assert.equal(accessToken, "oauth-access-token");
      return {
        data: {
          shops: [
            { cipher: "mx-cipher", code: "MX001", name: "Mexico Shop", region: "MX" },
            { cipher: "us-cipher", code: "US001", name: "US Shop", region: "US" },
            { cipher: "fallback-cipher", code: "OTHER001", name: "Fallback Shop" },
          ],
        },
        requestId: "shops-request",
      };
    },
  };
  const runner = { configured: true } as unknown as ApiRunner;

  try {
    await registerRoutes(app, { config, database, vault, runner, oauthClient });
    const start = await app.inject({ method: "GET", url: "/api/oauth/tiktok/start" });
    assert.equal(start.statusCode, 302);
    const authorizationUrl = new URL(start.headers.location ?? "");
    const state = authorizationUrl.searchParams.get("state");
    assert.ok(state);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/oauth/tiktok/callback?code=callback-code&state=wrong-state",
    });
    assert.equal(invalid.statusCode, 302);
    assert.match(invalid.headers.location ?? "", /oauth=error/);
    assert.equal(exchangedCodes, 0);

    const callback = await app.inject({
      method: "GET",
      url: `/api/oauth/tiktok/callback?code=callback-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/?oauth=success&shops=3&regions=MX%2CUS");
    assert.equal(exchangedCodes, 1);
    const shops = database.listShops();
    assert.equal(shops.length, 3);
    const shopsByCipher = new Map(shops.map((shop) => [shop.shopCipher, shop]));
    assert.equal(shopsByCipher.get("mx-cipher")?.region, "MX");
    assert.equal(shopsByCipher.get("us-cipher")?.region, "US");
    assert.equal(shopsByCipher.get("fallback-cipher")?.region, "MX");
    for (const shop of shops) {
      const saved = database.getShop(shop.id);
      assert.equal(vault.decrypt(saved?.encryptedAccessToken ?? ""), "oauth-access-token");
    }

    const manual = await app.inject({
      method: "POST",
      url: "/api/shops",
      payload: {
        name: "Malaysia Shop",
        shopCipher: "my-cipher",
        accessToken: "manual-access-token",
      },
    });
    assert.equal(manual.statusCode, 201);
    assert.equal(manual.json().shop.region, "MY");

    const replay = await app.inject({
      method: "GET",
      url: `/api/oauth/tiktok/callback?code=callback-code&state=${encodeURIComponent(state)}`,
    });
    assert.match(replay.headers.location ?? "", /oauth=error/);
    assert.equal(exchangedCodes, 1);
  } finally {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    validateMatchSelections: async (
      _shopId: string,
      selections: Array<{ productId: string; opportunityId: string; channel: "api" | "extension" }>,
    ) => {
      const issues = selections
        .filter((selection) => selection.opportunityId === "opp-unsafe")
        .map((selection) => ({ ...selection, message: "安全复核未通过" }));
      return { safe: issues.length === 0, issues };
    },
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

    const unsafe = await app.inject({
      method: "POST",
      url: "/api/opportunity-matches/batch",
      payload: {
        shopId: shop.id,
        confirmed: true,
        selections: [
          { productId: "product-1", opportunityId: "opp-unsafe", channel: "extension" },
        ],
      },
    });
    assert.equal(unsafe.statusCode, 409);
    assert.equal(database.listBatches().length, 0);

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
    assert.equal(body.productProgress["product-1"].state, "in_submission");
    assert.deepEqual(body.productProgress["product-1"].statusCounts, { ready: 1 });
    const createdTask = database.listTasks({ batchId: body.batch.id })[0];
    assert.equal(createdTask?.channel, "extension");
    database.completeTask(createdTask?.id ?? "", { status: "rejected" });
    const rejectedRetry = await app.inject({
      method: "POST",
      url: `/api/tasks/${createdTask?.id}/retry`,
    });
    assert.equal(rejectedRetry.statusCode, 409);
    const rejectedSwitch = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${createdTask?.id}/channel`,
      payload: { channel: "api" },
    });
    assert.equal(rejectedSwitch.statusCode, 409);
    assert.equal(database.getTask(createdTask?.id ?? "")?.status, "rejected");
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
    const health = await app.inject({ method: "GET", url: "/api/health" });
    assert.deepEqual(health.json().oauthMissingSettings, [
      "TIKTOK_APP_KEY",
      "TIKTOK_APP_SECRET",
      "TOKEN_ENCRYPTION_KEY",
    ]);
    const oauthStart = await app.inject({ method: "GET", url: "/api/oauth/tiktok/start" });
    assert.equal(oauthStart.statusCode, 503);
    assert.match(oauthStart.json().error, /TOKEN_ENCRYPTION_KEY/);
    const payload = {
      shopId: shop.id,
      sourceUrl: "https://seller.tiktokshopglobalselling.com/product/manage?shop_region=MY",
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
    assert.equal(database.getShop(shop.id)?.region, "MY");

    const listed = await app.inject({
      method: "GET",
      url: `/api/shops/${shop.id}/products`,
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().source, "extension");
    assert.equal(listed.json().products[0].id, "1729384756102938475");
    assert.equal(listed.json().products[0].stock, 48);
    assert.deepEqual(listed.json().products[0].submissionProgress, {
      state: "pending",
      taskCount: 0,
      statusCounts: {},
      latestUpdatedAt: null,
    });

    database.createBatch({
      filename: "progress-test.csv",
      source: "test",
      validRows: [
        {
          input: {
            sourceRow: 2,
            shopId: shop.id,
            productId: "1729384756102938475",
            opportunityId: "opportunity-progress-test",
            channel: "extension",
          },
          key: "progress-test",
        },
      ],
      invalidRows: [],
      totalRows: 1,
    });
    const relisted = await app.inject({
      method: "GET",
      url: `/api/shops/${shop.id}/products`,
    });
    assert.equal(relisted.json().products[0].submissionProgress.state, "in_submission");
    assert.equal(relisted.json().products[0].submissionProgress.taskCount, 1);
    assert.deepEqual(relisted.json().products[0].submissionProgress.statusCounts, { ready: 1 });
  } finally {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("imports extension snapshots, paginates all products and matches without API credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-extension-matching-test-"));
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
  const runner = new ApiRunner(config, database, vault);

  try {
    const shop = database.createShop({ name: "MX extension-only shop" });
    await registerRoutes(app, { config, database, vault, runner });
    const emptyMatch = await app.inject({
      method: "POST",
      url: "/api/opportunity-matches",
      payload: { shopId: shop.id, productIds: ["missing-product"], source: "extension" },
    });
    assert.equal(emptyMatch.statusCode, 400);
    assert.match(emptyMatch.json().error, /尚未由 Chrome 插件采集/);

    const mainProduct = {
      id: "1729384756102938475",
      title: "Organizador de cocina",
      status: "LIVE",
      categoryIds: ["601234"],
      categoryNames: ["Organizadores de cocina"],
      brandName: "Casa MX",
      keywords: ["organizador", "cocina"],
      attributes: ["material: acero"],
      price: 299.9,
      currency: "MXN",
      stock: 37,
    };
    const extraProducts = Array.from({ length: 105 }, (_, index) => ({
      ...mainProduct,
      id: `product-${String(index).padStart(4, "0")}`,
      title: `Producto ${index}`,
    }));
    const imported = await app.inject({
      method: "POST",
      url: "/api/extension/snapshots/import",
      headers: { "x-extension-key": "extension-key" },
      payload: {
        shopId: shop.id,
        sourceUrl: "https://seller.tiktokshopglobalselling.com/product/manage?shop_region=MX",
        capturedAt: "2026-08-16T08:00:00.000Z",
        products: [mainProduct, ...extraProducts],
        opportunities: [
          {
            id: "7345678901234567890",
            title: "Organización del hogar",
            type: "CATEGORY",
            requirementsVerified: true,
            status: "ACTIVE",
            active: true,
            expired: false,
            fulfilled: false,
            categoryIds: ["601234"],
            categoryNames: ["Organizadores de cocina"],
            brandNames: ["Casa MX"],
            keywords: ["organizador", "cocina"],
            allowedProductStatuses: ["LIVE"],
            referencePrice: 310,
            minPrice: 200,
            maxPrice: 400,
            currency: "MXN",
          },
          {
            id: "7345678901234567891",
            title: "Resumen incompleto",
            type: "CATEGORY",
            status: "ACTIVE",
            active: true,
            expired: false,
            fulfilled: false,
            categoryIds: ["601234"],
            categoryNames: ["Organizadores de cocina"],
            brandNames: [],
            keywords: ["organizador", "cocina"],
            allowedProductStatuses: ["LIVE"],
            referencePrice: 310,
            minPrice: null,
            maxPrice: null,
            currency: "MXN",
          },
        ],
      },
    });
    assert.equal(imported.statusCode, 201);
    assert.deepEqual(imported.json().result, {
      products: { total: 106, inserted: 106, updated: 0 },
      opportunities: { total: 2, inserted: 2, updated: 0 },
    });

    const firstPage = await app.inject({
      method: "GET",
      url: `/api/shops/${shop.id}/products?pageSize=50&source=extension`,
    });
    assert.equal(firstPage.statusCode, 200);
    assert.equal(firstPage.json().products.length, 50);
    assert.equal(firstPage.json().nextPageToken, "50");
    const secondPage = await app.inject({
      method: "GET",
      url: `/api/shops/${shop.id}/products?pageSize=50&pageToken=50&source=extension`,
    });
    assert.equal(secondPage.json().products.length, 50);
    assert.equal(secondPage.json().nextPageToken, "100");
    const thirdPage = await app.inject({
      method: "GET",
      url: `/api/shops/${shop.id}/products?pageSize=50&pageToken=100&source=extension`,
    });
    assert.equal(thirdPage.json().products.length, 6);
    assert.equal(thirdPage.json().nextPageToken, null);

    const matched = await app.inject({
      method: "POST",
      url: "/api/opportunity-matches",
      payload: {
        shopId: shop.id,
        productIds: [mainProduct.id],
        source: "extension",
      },
    });
    assert.equal(matched.statusCode, 200);
    assert.equal(matched.json().source, "extension");
    assert.equal(matched.json().candidatePairCount, 2);
    assert.equal(matched.json().blockedPairCount, 1);
    assert.equal(matched.json().matches.length, 1);
    assert.equal(matched.json().matches[0].opportunity.id, "7345678901234567890");
    assert.equal(matched.json().matches[0].eligible, true);

    const unsafeBatch = await app.inject({
      method: "POST",
      url: "/api/opportunity-matches/batch",
      payload: {
        shopId: shop.id,
        confirmed: true,
        selections: [
          {
            productId: mainProduct.id,
            opportunityId: "7345678901234567891",
            channel: "extension",
          },
        ],
      },
    });
    assert.equal(unsafeBatch.statusCode, 409);

    const legacyBatch = database.createBatch({
      filename: "legacy-unsafe.json",
      source: "test",
      validRows: [
        {
          input: {
            sourceRow: 2,
            shopId: shop.id,
            productId: mainProduct.id,
            opportunityId: "7345678901234567891",
            channel: "extension",
          },
          key: "legacy-unsafe",
        },
      ],
      invalidRows: [],
      totalRows: 1,
    });
    const nextTask = await app.inject({
      method: "GET",
      url: `/api/extension/tasks/next?shopId=${encodeURIComponent(shop.id)}`,
      headers: { "x-extension-key": "extension-key" },
    });
    assert.equal(nextTask.statusCode, 204);
    const pausedTask = database.listTasks({ batchId: legacyBatch.id })[0];
    assert.equal(pausedTask?.status, "paused");
    assert.equal(pausedTask?.errorCode, "LOCAL_ELIGIBILITY_CHECK_FAILED");
  } finally {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
