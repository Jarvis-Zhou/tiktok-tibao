import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { TibaoDatabase } from "../src/database.js";
import { TokenVault } from "../src/token-vault.js";

test("encrypts tokens and persists a deduplicated task queue", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  try {
    const vault = new TokenVault("a-test-key-that-is-long-enough");
    const encrypted = vault.encrypt("access-token");
    assert.notEqual(encrypted, "access-token");
    assert.equal(vault.decrypt(encrypted), "access-token");

    const createdShop = database.createShop({
      name: "MX test",
      shopCipher: "cipher-1",
      region: "mx",
      encryptedAccessToken: encrypted,
    });
    assert.equal(createdShop.region, "MX");
    const shop = database.createShop({
      name: "Renamed test shop",
      shopCipher: "cipher-1",
      encryptedAccessToken: encrypted,
    });
    assert.equal(shop.id, createdShop.id);
    assert.equal(shop.region, "MX");
    const input = {
      sourceRow: 2,
      shopId: shop.id,
      opportunityId: "opp-1",
      productId: "product-1",
      channel: "api" as const,
    };
    const first = database.createBatch({
      filename: "first.csv",
      source: "test",
      validRows: [{ input, key: "unused" }],
      invalidRows: [],
      totalRows: 1,
    });
    assert.equal(first.validRows, 1);
    assert.deepEqual(database.existingOpportunityIds(shop.id, "product-1"), ["opp-1"]);

    const duplicate = database.createBatch({
      filename: "duplicate.csv",
      source: "test",
      validRows: [{ input, key: "unused" }],
      invalidRows: [],
      totalRows: 1,
    });
    assert.equal(duplicate.validRows, 0);
    assert.equal(duplicate.duplicateRows, 1);

    const task = database.claimNextTask("api", 30, first.id);
    assert.equal(task?.status, "running");
    assert.equal(task?.attempts, 1);
    const completed = database.completeTask(task?.id ?? "", {
      status: "submitted",
      submissionId: "submission-1",
    });
    assert.equal(completed?.submissionId, "submission-1");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stores OAuth state as a single-use expiring value", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-oauth-state-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  try {
    const state = database.createOAuthState();
    assert.equal(database.consumeOAuthState(state), true);
    assert.equal(database.consumeOAuthState(state), false);

    const expired = database.createOAuthState(-1);
    assert.equal(database.consumeOAuthState(expired), false);
    const rows = database.raw.prepare("SELECT state_hash FROM oauth_states").all();
    assert.equal(rows.some((row) => String((row as { state_hash: unknown }).state_hash) === state), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("upserts extension-captured products by shop and product ID", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-products-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  try {
    const shop = database.createShop({ name: "MX extension shop" });
    assert.equal(shop.apiConfigured, false);
    const first = database.upsertCapturedProducts({
      shopId: shop.id,
      sourceUrl: "https://seller-mx.tiktok.com/products",
      capturedAt: "2026-08-16T08:00:00.000Z",
      products: [
        {
          id: "1729384756102938475",
          title: "Producto inicial",
          status: "LIVE",
          categoryIds: ["601234"],
          categoryNames: ["Hogar", "Organizadores"],
          brandName: "Casa MX",
          keywords: ["organizador", "hogar"],
          attributes: ["material: acero"],
          price: 329.9,
          currency: "MXN",
          stock: 48,
        },
      ],
    });
    assert.deepEqual(first, { total: 1, inserted: 1, updated: 0 });

    const second = database.upsertCapturedProducts({
      shopId: shop.id,
      sourceUrl: "https://seller-mx.tiktok.com/products?page=2",
      capturedAt: "2026-08-16T08:05:00.000Z",
      products: [
        {
          id: "1729384756102938475",
          title: "Producto actualizado",
          status: "LIVE",
          categoryIds: ["601234"],
          categoryNames: ["Hogar", "Organizadores"],
          brandName: "Casa MX",
          keywords: ["organizador", "cocina"],
          attributes: ["material: acero"],
          price: 299.9,
          currency: "MXN",
          stock: 42,
        },
      ],
    });
    assert.deepEqual(second, { total: 1, inserted: 0, updated: 1 });
    const products = database.listCapturedProducts(shop.id);
    assert.equal(products.length, 1);
    assert.equal(products[0]?.title, "Producto actualizado");
    assert.equal(products[0]?.stock, 42);
    assert.deepEqual(products[0]?.categoryIds, ["601234"]);
    assert.deepEqual(products[0]?.categoryNames, ["Hogar", "Organizadores"]);
    assert.deepEqual(products[0]?.keywords, ["organizador", "cocina"]);

    const opportunityResult = database.upsertCapturedOpportunities({
      shopId: shop.id,
      sourceUrl: "https://seller-mx.tiktok.com/opportunities",
      capturedAt: "2026-08-16T08:10:00.000Z",
      opportunities: [
        {
          id: "7345678901234567890",
          title: "Organización del hogar",
          type: "CATEGORY",
          status: "ACTIVE",
          active: true,
          expired: false,
          fulfilled: false,
          categoryIds: ["601234"],
          categoryNames: ["Organizadores"],
          brandNames: ["Casa MX"],
          keywords: ["organizador"],
          allowedProductStatuses: ["LIVE"],
          referencePrice: 300,
          minPrice: 200,
          maxPrice: 400,
          currency: "MXN",
        },
      ],
    });
    assert.deepEqual(opportunityResult, { total: 1, inserted: 1, updated: 0 });
    const opportunities = database.listCapturedOpportunities(shop.id);
    assert.equal(opportunities[0]?.id, "7345678901234567890");
    assert.deepEqual(opportunities[0]?.brandNames, ["Casa MX"]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("paginates more than fifty extension-captured products without dropping rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-products-pagination-test-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  try {
    const shop = database.createShop({ name: "MX paginated shop" });
    database.upsertCapturedProducts({
      shopId: shop.id,
      sourceUrl: "https://seller-mx.tiktok.com/products",
      capturedAt: "2026-08-16T08:00:00.000Z",
      products: Array.from({ length: 125 }, (_, index) => ({
        id: `product-${String(index).padStart(4, "0")}`,
        title: `Producto ${index}`,
        status: "LIVE",
        categoryIds: ["601234"],
        categoryNames: ["Hogar"],
        brandName: null,
        keywords: [],
        attributes: [],
        price: null,
        currency: null,
        stock: null,
      })),
    });
    assert.equal(database.listCapturedProducts(shop.id, 50, 0).length, 50);
    assert.equal(database.listCapturedProducts(shop.id, 50, 50).length, 50);
    assert.equal(database.listCapturedProducts(shop.id, 50, 100).length, 25);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrates previously captured product rows without losing their category name", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-products-migration-test-"));
  const path = join(directory, "queue.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE shops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      shop_cipher TEXT NOT NULL UNIQUE,
      access_token_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE captured_products (
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT,
      category_name TEXT,
      brand_name TEXT,
      price REAL,
      currency TEXT,
      stock INTEGER,
      source_url TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(shop_id, product_id)
    );
    INSERT INTO shops VALUES (
      'shop-legacy', 'Legacy', 'extension:legacy', '',
      '2026-08-16T08:00:00.000Z', '2026-08-16T08:00:00.000Z'
    );
    INSERT INTO captured_products VALUES (
      'shop-legacy', 'product-legacy', 'Producto legacy', 'LIVE', 'Hogar', NULL,
      NULL, NULL, NULL, 'https://seller-mx.tiktok.com/products',
      '2026-08-16T08:00:00.000Z', '2026-08-16T08:00:00.000Z'
    );
  `);
  legacy.close();

  const database = new TibaoDatabase(path);
  try {
    const products = database.listCapturedProducts("shop-legacy");
    assert.deepEqual(products[0]?.categoryNames, ["Hogar"]);
    assert.equal(database.getShop("shop-legacy")?.region, "");
    const shopColumns = database.raw.prepare("PRAGMA table_info(shops)").all() as Array<{
      name: string;
    }>;
    assert.ok(shopColumns.some((column) => column.name === "region"));
    const columns = database.raw.prepare("PRAGMA table_info(captured_products)").all() as Array<{
      name: string;
    }>;
    assert.ok(columns.some((column) => column.name === "category_ids_json"));
    assert.ok(columns.some((column) => column.name === "attributes_json"));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
