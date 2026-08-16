import {
  extractOpportunityRecords,
  extractProductRecords,
  normalizeOpportunity,
  normalizeProduct,
} from "@tibao/core";
import type { CollectedOpportunity, CollectedProduct } from "./types.js";

type UnknownRecord = Record<string, unknown>;

export interface PageSnapshots {
  products: CollectedProduct[];
  opportunities: CollectedOpportunity[];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[segment];
  }
  return current;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll(",", "").replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function findStock(value: unknown, depth = 0): number | null {
  if (depth > 7) return null;
  const preferredPaths = [
    "stock",
    "available_stock",
    "availableStock",
    "stock_info.available_stock",
    "stockInfo.availableStock",
    "inventory.available_stock",
    "inventory.availableStock",
    "inventory.quantity",
  ];
  for (const path of preferredPaths) {
    const found = numberValue(valueAt(value, path));
    if (found !== null) return Math.floor(found);
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findStock(child, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, child] of Object.entries(record)) {
    if (/^(available_?stock|stock_?count|inventory_?count|quantity)$/i.test(key)) {
      const found = numberValue(child);
      if (found !== null) return Math.floor(found);
    }
  }
  for (const child of Object.values(record)) {
    if (child === null || typeof child !== "object") continue;
    const found = findStock(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function collectStrongRecords(
  value: unknown,
  identityKeys: ReadonlySet<string>,
  result: UnknownRecord[],
  depth = 0,
): void {
  if (depth > 8 || result.length >= 1_000 || value === null) return;
  if (Array.isArray(value)) {
    for (const child of value) collectStrongRecords(child, identityKeys, result, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (Object.keys(record).some((key) => identityKeys.has(key))) result.push(record);
  for (const child of Object.values(record)) {
    if (child !== null && typeof child === "object") {
      collectStrongRecords(child, identityKeys, result, depth + 1);
    }
  }
}

function uniqueRecords(records: UnknownRecord[]): UnknownRecord[] {
  return [...new Set(records)];
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,128}$/.test(value);
}

function productQuality(product: CollectedProduct): number {
  return [
    product.title && product.title !== product.id,
    product.status,
    product.categoryIds.length,
    product.categoryNames.length,
    product.brandName,
    product.keywords.length,
    product.attributes.length,
    product.price !== null,
    product.currency,
    product.stock !== null,
  ].filter(Boolean).length;
}

function opportunityQuality(opportunity: CollectedOpportunity): number {
  return [
    opportunity.title && opportunity.title !== opportunity.id,
    opportunity.type,
    opportunity.requirementsVerified,
    opportunity.status,
    opportunity.active !== null,
    opportunity.categoryIds.length,
    opportunity.categoryNames.length,
    opportunity.brandNames.length,
    opportunity.keywords.length,
    opportunity.referencePrice !== null,
  ].filter(Boolean).length;
}

export function extractPageSnapshots(payload: unknown, requestUrl: string): PageSnapshots {
  const lowerUrl = requestUrl.toLowerCase();
  const opportunityContext = /(?:opportunit|recommendation|growth)/.test(lowerUrl);
  const productContext = !opportunityContext
    && /(?:\/products?(?:[/?]|$)|product[_-]?list|listing|inventory)/.test(lowerUrl);

  const strongProducts: UnknownRecord[] = [];
  collectStrongRecords(payload, new Set(["product_id", "productId"]), strongProducts);
  const strongOpportunities: UnknownRecord[] = [];
  collectStrongRecords(
    payload,
    new Set(["opportunity_id", "opportunityId", "recommendation_id", "recommendationId"]),
    strongOpportunities,
  );

  const productRecords = uniqueRecords([
    ...strongProducts,
    ...(productContext ? extractProductRecords(payload) : []),
  ]);
  const productsById = new Map<string, CollectedProduct>();
  for (const record of productRecords) {
    const product = normalizeProduct(record);
    if (!validId(product.id)) continue;
    const captured: CollectedProduct = { ...product, stock: findStock(record) };
    const existing = productsById.get(captured.id);
    if (!existing || productQuality(captured) > productQuality(existing)) {
      productsById.set(captured.id, captured);
    }
  }

  const opportunityRecords = uniqueRecords([
    ...strongOpportunities,
    ...(opportunityContext ? extractOpportunityRecords(payload) : []),
  ]);
  const opportunitiesById = new Map<string, CollectedOpportunity>();
  for (const record of opportunityRecords) {
    const opportunity = normalizeOpportunity(record);
    if (!validId(opportunity.id)) continue;
    const existing = opportunitiesById.get(opportunity.id);
    if (!existing || opportunityQuality(opportunity) > opportunityQuality(existing)) {
      opportunitiesById.set(opportunity.id, opportunity);
    }
  }

  return {
    products: [...productsById.values()],
    opportunities: [...opportunitiesById.values()],
  };
}
