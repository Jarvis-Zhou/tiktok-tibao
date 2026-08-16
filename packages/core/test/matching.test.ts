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

test("prefers explicit Seller Center IDs and supports camelCase list payloads", () => {
  const productRecords = extractProductRecords({
    data: {
      productList: [
        {
          id: "row-wrapper-id",
          productId: "1729384756102938475",
          productName: "Organizador de cocina",
          productStatus: "ACTIVATE",
          leafCategory: { id: "601234", display_name: "Organizadores de cocina" },
        },
      ],
    },
  });
  const product = normalizeProduct(productRecords[0]);
  assert.equal(product.id, "1729384756102938475");
  assert.equal(product.title, "Organizador de cocina");
  assert.deepEqual(product.categoryIds, ["601234"]);
  assert.deepEqual(product.categoryNames, ["Organizadores de cocina"]);

  const opportunityRecords = extractOpportunityRecords({
    result: {
      opportunityList: [
        {
          id: "row-wrapper-id",
          opportunityId: "7345678901234567890",
          opportunityName: "Organización del hogar",
          opportunityType: "CATEGORY",
          status: "ACTIVE",
          category: { id: "601234", name: "Organizadores de cocina" },
        },
      ],
    },
  });
  const opportunity = normalizeOpportunity(opportunityRecords[0]);
  assert.equal(opportunity.id, "7345678901234567890");
  assert.equal(opportunity.title, "Organización del hogar");
  assert.equal(opportunity.type, "CATEGORY");
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
