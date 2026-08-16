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
  assert.equal(opportunity.requirementsVerified, true);
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
    opportunity_type: "KEYWORD",
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

test("treats unambiguous active product-status aliases as equivalent", () => {
  const product = normalizeProduct({
    id: "product-active",
    title: "Organizador de cocina",
    status: "PRODUCT_STATUS_ACTIVATE",
    category: { id: "home", name: "Cocina" },
  });

  for (const allowedStatus of ["LIVE", "ONLINE", "PRODUCT_STATUS_PUBLISHED"]) {
    const opportunity = normalizeOpportunity({
      id: `opp-${allowedStatus}`,
      title: "Organizador de cocina",
      opportunity_type: "CATEGORY",
      status: "OPPORTUNITY_STATUS_OPEN",
      listing_criteria: {
        category_ids: ["home"],
        product_statuses: [allowedStatus],
      },
    });
    const result = scoreOpportunityMatch(product, opportunity);
    assert.equal(result.eligible, true, allowedStatus);
    assert.equal(
      result.blockers.some((blocker) => blocker.includes("商品状态不符合机会要求")),
      false,
      allowedStatus,
    );
  }

  const legacySnapshot = normalizeOpportunity({
    id: "opp-legacy",
    title: "Organizador de cocina",
    opportunity_type: "CATEGORY",
    status: "OPPORTUNITY_STATUS_OPEN",
    listing_criteria: { category_ids: ["home"], product_statuses: ["LIVE"] },
  });
  const legacyResult = scoreOpportunityMatch(product, { ...legacySnapshot, active: null });
  assert.equal(legacyResult.eligible, true);
  assert.equal(legacyResult.opportunity.active, true);
  assert.equal(
    legacyResult.blockers.includes("机会状态未知，无法确认仍可提报"),
    false,
  );

  const inactiveResult = scoreOpportunityMatch(
    { ...product, status: "OFFLINE" },
    normalizeOpportunity({
      id: "opp-offline",
      title: "Organizador de cocina",
      opportunity_type: "CATEGORY",
      status: "ACTIVE",
      listing_criteria: { category_ids: ["home"], product_statuses: ["OFFLINE"] },
    }),
  );
  assert.equal(inactiveResult.eligible, false);
  assert.ok(inactiveResult.blockers.includes("商品状态不可提报：OFFLINE"));

  const mismatchResult = scoreOpportunityMatch(
    product,
    normalizeOpportunity({
      id: "opp-draft-only",
      title: "Organizador de cocina",
      opportunity_type: "CATEGORY",
      status: "ACTIVE",
      listing_criteria: { category_ids: ["home"], product_statuses: ["DRAFT"] },
    }),
  );
  assert.ok(
    mismatchResult.blockers.includes(
      "商品状态不符合机会要求：PRODUCT_STATUS_ACTIVATE（允许：DRAFT）",
    ),
  );
});

test("recognizes explicit opportunity state and availability fields without guessing unknown codes", () => {
  const activePayloads = [
    { opportunityState: "OPPORTUNITY_STATUS_ACTIVE" },
    { availabilityStatus: "OPEN_FOR_SUBMISSION" },
    { isAvailable: true },
    { availability: { isAvailable: true } },
    { canSubmit: true },
  ];
  for (const payload of activePayloads) {
    assert.equal(normalizeOpportunity(payload).active, true, JSON.stringify(payload));
  }

  assert.equal(normalizeOpportunity({ isOpenForSubmission: false }).active, false);
  assert.equal(normalizeOpportunity({ opportunityState: "PENDING_VALIDATION" }).active, null);
  assert.equal(normalizeOpportunity({ opportunityStatus: 7 }).active, null);
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

test("fails closed when product or opportunity verification data is missing", () => {
  const completeProduct = normalizeProduct({
    id: "product-1",
    title: "Organizador de cocina",
    status: "LIVE",
    category: { id: "601234", name: "Organizadores de cocina" },
  });
  const unverifiedOpportunity = normalizeOpportunity({
    id: "opp-unverified",
    title: "Organización del hogar",
    opportunity_type: "CATEGORY",
    status: "ACTIVE",
    category: { id: "601234", name: "Organizadores de cocina" },
  });
  const unverified = scoreOpportunityMatch(completeProduct, unverifiedOpportunity);
  assert.equal(unverified.eligible, false);
  assert.ok(unverified.blockers.includes("机会完整提报要求未获取，禁止自动提报"));

  const verifiedOpportunity = normalizeOpportunity({
    id: "opp-verified",
    title: "Organización del hogar",
    opportunity_type: "CATEGORY",
    status: "ACTIVE",
    listing_criteria: { category_ids: ["601234"] },
  });
  const missingProductCategory = scoreOpportunityMatch(
    { ...completeProduct, categoryIds: [], categoryNames: [] },
    verifiedOpportunity,
  );
  assert.equal(missingProductCategory.eligible, false);
  assert.ok(missingProductCategory.blockers.includes("商品类目未获取，无法验证机会要求"));

  const missingOpportunityCategory = scoreOpportunityMatch(completeProduct, {
    ...verifiedOpportunity,
    categoryIds: [],
    categoryNames: [],
  });
  assert.equal(missingOpportunityCategory.eligible, false);
  assert.ok(missingOpportunityCategory.blockers.includes("机会适用类目未获取，无法验证提报要求"));

  const unknownProductStatus = scoreOpportunityMatch(
    { ...completeProduct, status: null },
    verifiedOpportunity,
  );
  assert.equal(unknownProductStatus.eligible, false);
  assert.ok(unknownProductStatus.blockers.includes("商品状态未知，无法确认可提报"));
});

test("hard-blocks price-range and keyword requirement mismatches", () => {
  const product = normalizeProduct({
    id: "product-1",
    title: "Playera de algodón",
    status: "ACTIVATE",
    category: { id: "fashion", name: "Moda" },
    price: { amount: 500, currency: "MXN" },
  });
  const opportunity = normalizeOpportunity({
    id: "opp-1",
    title: "Zapatos deportivos",
    opportunity_type: "KEYWORD",
    status: "ACTIVE",
    listing_criteria: {
      category_ids: ["fashion"],
      keywords: ["zapatos", "deportivos"],
      min_price: 100,
      max_price: 300,
    },
    currency: "MXN",
  });
  const result = scoreOpportunityMatch(product, opportunity);
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("商品价格不符合机会价格区间"));
  assert.ok(result.blockers.includes("商品标题/属性未命中机会关键词要求"));
});

test("does not expose low-score candidates as eligible", () => {
  const product = normalizeProduct({
    id: "product-1",
    title: "Producto alfa",
    status: "LIVE",
    category: { id: "shared-category" },
  });
  const opportunity = normalizeOpportunity({
    id: "opp-1",
    title: "Demanda omega",
    opportunity_type: "CATEGORY",
    status: "ACTIVE",
    listing_criteria: { category_ids: ["shared-category"] },
  });
  const result = scoreOpportunityMatch(product, opportunity);
  assert.equal(result.score < 75, true);
  assert.equal(result.eligible, false);
  assert.match(result.blockers.join(" "), /安全阈值/);
});
