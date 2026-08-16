import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionTask,
  createTaskKey,
  normalizeReviewStatus,
  validateImportRows,
} from "../src/index.js";

test("normalizes Chinese headers and channel aliases", () => {
  const result = validateImportRows([
    { 店铺: "shop-1", 机会ID: "opp-1", 商品ID: "900000000000000001", 通道: "C" },
  ]);
  assert.equal(result.invalid.length, 0);
  assert.deepEqual(result.valid[0]?.input, {
    sourceRow: 2,
    shopId: "shop-1",
    opportunityId: "opp-1",
    productId: "900000000000000001",
    channel: "extension",
  });
});

test("applies defaults and rejects duplicate rows", () => {
  const result = validateImportRows(
    [
      { opportunity_id: "opp-1", product_id: "p-1" },
      { opportunity_id: "opp-1", product_id: "p-1" },
    ],
    { defaultShopId: "shop-1", defaultChannel: "api" },
  );
  assert.equal(result.valid.length, 1);
  assert.equal(result.invalid[0]?.issues[0]?.code, "duplicate");
});

test("task keys are stable and lifecycle guards unsafe transitions", () => {
  assert.equal(
    createTaskKey({ shopId: " SHOP ", opportunityId: "Opp", productId: "P1" }),
    createTaskKey({ shopId: "shop", opportunityId: "opp", productId: "p1" }),
  );
  assert.equal(canTransitionTask("ready", "running"), true);
  assert.equal(canTransitionTask("approved", "ready"), false);
  assert.equal(normalizeReviewStatus("PENDING_REVIEW"), "pending_review");
});
