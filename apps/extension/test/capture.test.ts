import assert from "node:assert/strict";
import test from "node:test";
import { extractPageSnapshots } from "../src/capture.js";

test("extracts real product IDs, leaf categories, stock and opportunities from page JSON", () => {
  const productSnapshots = extractPageSnapshots(
    {
      data: {
        productList: [
          {
            id: "row-wrapper-id",
            productId: "1729384756102938475",
            product: {
              productName: "Organizador de cocina",
              productStatus: "LIVE",
              leafCategory: {
                categoryId: "601234",
                categoryName: "Organizadores de cocina",
              },
              brandName: "Casa MX",
              salePrice: { amount: 299.9, currencyCode: "MXN" },
            },
            inventory: { availableStock: 37 },
          },
        ],
      },
    },
    "https://seller.tiktokshopglobalselling.com/api/product/list",
  );

  assert.equal(productSnapshots.products.length, 1);
  assert.equal(productSnapshots.products[0]?.id, "1729384756102938475");
  assert.equal(productSnapshots.products[0]?.title, "Organizador de cocina");
  assert.deepEqual(productSnapshots.products[0]?.categoryIds, ["601234"]);
  assert.deepEqual(productSnapshots.products[0]?.categoryNames, ["Organizadores de cocina"]);
  assert.equal(productSnapshots.products[0]?.stock, 37);
  assert.equal(productSnapshots.products[0]?.brandName, "Casa MX");
  assert.equal(productSnapshots.opportunities.length, 0);

  const opportunitySnapshots = extractPageSnapshots(
    {
      result: {
        opportunityList: [
          {
            id: "row-wrapper-id",
            opportunityId: "7345678901234567890",
            opportunityName: "Organización del hogar",
            opportunityType: "CATEGORY",
            opportunityStatus: "ACTIVE",
            isActive: true,
            listingCriteria: {
              categoryIds: ["601234"],
              categoryNames: ["Organizadores de cocina"],
              brandNames: ["Casa MX"],
              productStatuses: ["LIVE"],
            },
            keywords: ["organizador", "cocina"],
            referencePrice: { amount: 310, currencyCode: "MXN" },
          },
        ],
      },
    },
    "https://seller.tiktokshopglobalselling.com/api/opportunity/list",
  );

  assert.equal(opportunitySnapshots.opportunities.length, 1);
  assert.equal(opportunitySnapshots.products.length, 0);
  assert.equal(opportunitySnapshots.opportunities[0]?.id, "7345678901234567890");
  assert.equal(opportunitySnapshots.opportunities[0]?.active, true);
  assert.equal(opportunitySnapshots.opportunities[0]?.requirementsVerified, true);
  assert.deepEqual(opportunitySnapshots.opportunities[0]?.categoryIds, ["601234"]);
  assert.deepEqual(opportunitySnapshots.opportunities[0]?.brandNames, ["Casa MX"]);
  assert.deepEqual(opportunitySnapshots.opportunities[0]?.allowedProductStatuses, ["LIVE"]);
});

test("does not treat generic wrapper IDs as products outside a product response", () => {
  const snapshots = extractPageSnapshots(
    { data: { items: [{ id: "generic-wrapper-id", title: "Unrelated record" }] } },
    "https://seller.tiktokshopglobalselling.com/api/account/settings",
  );
  assert.deepEqual(snapshots, { products: [], opportunities: [] });
});

test("normalizes captured opportunity availability while preserving unknown states", () => {
  const snapshots = extractPageSnapshots(
    {
      data: {
        opportunityList: [
          {
            opportunityId: "opportunity-open-1",
            opportunityName: "Cocina abierta",
            opportunityType: "CATEGORY",
            availabilityStatus: "OPPORTUNITY_STATUS_OPEN",
            listingCriteria: { categoryIds: ["601234"] },
          },
          {
            opportunityId: "opportunity-unknown-1",
            opportunityName: "Cocina pendiente",
            opportunityType: "CATEGORY",
            opportunityState: "PENDING_VALIDATION",
            listingCriteria: { categoryIds: ["601234"] },
          },
        ],
      },
    },
    "https://seller.tiktokshopglobalselling.com/api/opportunity/list",
  );

  assert.equal(snapshots.opportunities.length, 2);
  assert.equal(
    snapshots.opportunities.find((item) => item.id === "opportunity-open-1")?.active,
    true,
  );
  assert.equal(
    snapshots.opportunities.find((item) => item.id === "opportunity-unknown-1")?.active,
    null,
  );
});
