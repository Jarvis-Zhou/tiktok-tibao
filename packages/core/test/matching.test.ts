import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNextPageToken,
  extractOpportunityRecords,
  extractProductRecords,
  normalizeOpportunity,
  normalizeProduct,
  scoreOpportunityMatch,
} from "../src/index.js";

test("normalizes nested product and opportunity payloads", () => {
  const productPayload = {
    data: {
      products: [
        {
          id: "product-1",
          title: "Audífonos Bluetooth inalámbricos",
          status: "ACTIVATE",
          category_chains: [
            { id: "10", local_name: "Electrónica" },
            { id: "11", local_name: "Audífonos" },
          ],
          brand: { name: "Acme" },
          skus: [{ price: { tax_exclusive_price: "399.00", currency: "MXN" } }],
        },
      ],
      next_page_token: "next-1",
    },
  };
  const records = extractProductRecords(productPayload);
  assert.equal(records.length, 1);
  const product = normalizeProduct(records[0]);
  assert.equal(product.id, "product-1");
  assert.deepEqual(product.categoryIds, ["10", "11"]);
  assert.equal(product.brandName, "Acme");
  assert.equal(product.price, 399);
  assert.equal(product.currency, "MXN");
  assert.equal(extractNextPageToken(productPayload), "next-1");

  const opportunityPayload = {
    data: {
      data: {
        opportunities: [
          {
            opportunity_id: "opp-1",
            title: "Audífonos Bluetooth",
            opportunity_type: "KEYWORD",
            status: "ACTIVE",
            listing_criteria: {
              category_ids: ["11"],
              brands: [{ name: "Acme" }],
              keywords: ["bluetooth", "inalámbricos"],
              product_statuses: ["ACTIVATE"],
            },
            reference_price: { amount: "420", currency: "MXN" },
          },
        ],
      },
    },
  };
  const opportunities = extractOpportunityRecords(opportunityPayload);
  assert.equal(opportunities.length, 1);
  const opportunity = normalizeOpportunity(opportunities[0]);
  assert.equal(opportunity.id, "opp-1");
  assert.deepEqual(opportunity.categoryIds, ["11"]);
  assert.deepEqual(opportunity.brandNames, ["Acme"]);
  assert.equal(opportunity.referencePrice, 420);
});

test("gives an exact category and brand match a high-confidence recommendation", () => {
  const product = normalizeProduct({
    id: "product-1",
    title: "Audífonos Bluetooth inalámbricos",
    status: "ACTIVATE",
    category: { id: "11", name: "Audífonos" },
    brand: { name: "Acme" },
    price: { amount: 399, currency: "MXN" },
    attributes: [{ name: "Conectividad", value: "Bluetooth" }],
  });
  const opportunity = normalizeOpportunity({
    id: "opp-1",
    title: "Audífonos Bluetooth",
    status: "ACTIVE",
    listing_criteria: {
      category_ids: ["11"],
      brand: { name: "Acme" },
      keywords: ["Bluetooth", "inalámbricos"],
      product_statuses: ["ACTIVATE"],
    },
    reference_price: { amount: 420, currency: "MXN" },
  });

  const result = scoreOpportunityMatch(product, opportunity);
  assert.equal(result.eligible, true);
  assert.equal(result.confidence, "high");
  assert.equal(result.recommended, true);
  assert.ok(result.score >= 75);
});

test("hard-filters category, brand, expiry and prior-submission conflicts", () => {
  const product = normalizeProduct({
    id: "product-1",
    title: "Playera algodón",
    status: "ACTIVATE",
    category: { id: "fashion", name: "Moda" },
    brand: { name: "Brand A" },
  });
  const opportunity = normalizeOpportunity({
    id: "opp-2",
    title: "Electrónica premium",
    status: "EXPIRED",
    category: { id: "electronics", name: "Electrónica" },
    brand: { name: "Brand B" },
  });

  const result = scoreOpportunityMatch(product, opportunity, { priorSubmitted: true });
  assert.equal(result.eligible, false);
  assert.equal(result.recommended, false);
  assert.equal(result.confidence, "low");
  assert.ok(result.blockers.includes("机会已过期"));
  assert.ok(result.blockers.includes("商品类目与机会类目不匹配"));
  assert.ok(result.blockers.includes("商品品牌与机会品牌要求不匹配"));
  assert.ok(result.blockers.includes("该商品已提报过此机会"));
});
