import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    const shop = database.createShop({
      name: "MX test",
      shopCipher: "cipher-1",
      encryptedAccessToken: encrypted,
    });
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
          categoryName: "Hogar",
          brandName: "Casa MX",
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
          categoryName: "Hogar",
          brandName: "Casa MX",
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
    assert.deepEqual(products[0]?.categoryNames, ["Hogar"]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
