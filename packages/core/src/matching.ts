export type MatchConfidence = "high" | "medium" | "low";

export interface ProductSnapshot {
  id: string;
  title: string;
  status: string | null;
  categoryIds: string[];
  categoryNames: string[];
  brandName: string | null;
  keywords: string[];
  attributes: string[];
  price: number | null;
  currency: string | null;
}

export interface OpportunitySnapshot {
  id: string;
  title: string;
  type: string;
  requirementsVerified: boolean;
  status: string | null;
  active: boolean | null;
  expired: boolean;
  fulfilled: boolean;
  categoryIds: string[];
  categoryNames: string[];
  brandNames: string[];
  keywords: string[];
  allowedProductStatuses: string[];
  referencePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string | null;
}

export interface ProductOpportunityMatch {
  product: ProductSnapshot;
  opportunity: OpportunitySnapshot;
  score: number;
  confidence: MatchConfidence;
  eligible: boolean;
  recommended: boolean;
  reasons: string[];
  blockers: string[];
}

export interface MatchScoreOptions {
  priorSubmitted?: boolean;
}

export const MIN_SAFE_MATCH_SCORE = 75;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function valueAt(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[segment];
  }
  return current;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(value: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const result = textValue(valueAt(value, path));
    if (result) return result;
  }
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(",", "").replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(value: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const result = numberValue(valueAt(value, path));
    if (result !== null) return result;
  }
  return null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return null;
}

function firstBoolean(value: unknown, paths: string[]): boolean | null {
  for (const path of paths) {
    const result = booleanValue(valueAt(value, path));
    if (result !== null) return result;
  }
  return null;
}

function unique(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function unwrap(value: unknown, keys: string[]): UnknownRecord {
  const record = asRecord(value) ?? {};
  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) return { ...record, ...nested };
  }
  const data = asRecord(record.data);
  return data ? unwrap(data, keys) : record;
}

function extractRecords(value: unknown, keys: string[], depth = 0): UnknownRecord[] {
  if (depth > 6) return [];
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    const candidate = record[key];
    if (!Array.isArray(candidate)) continue;
    const records = candidate.map(asRecord).filter((item): item is UnknownRecord => item !== null);
    if (records.length > 0 || candidate.length === 0) return records;
  }
  for (const key of ["data", "result", "response"]) {
    const nested = extractRecords(record[key], keys, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

function collectContextStrings(
  value: unknown,
  contextPattern: RegExp,
  valueKeyPattern: RegExp,
  depth = 0,
  inContext = false,
): string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      item !== null && typeof item === "object"
        ? collectContextStrings(item, contextPattern, valueKeyPattern, depth + 1, inContext)
        : [],
    );
  }
  const record = asRecord(value);
  if (!record) return [];
  const results: string[] = [];
  for (const [key, child] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    const nextContext = inContext || contextPattern.test(normalizedKey);
    if (nextContext && valueKeyPattern.test(normalizedKey)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const itemText = textValue(item);
          if (itemText) results.push(itemText);
        }
      } else {
        const childText = textValue(child);
        if (childText) results.push(childText);
      }
    }
    if (typeof child === "object" && child !== null) {
      results.push(...collectContextStrings(child, contextPattern, valueKeyPattern, depth + 1, nextContext));
    }
  }
  return results;
}

function collectCategoryData(value: unknown): { ids: string[]; names: string[] } {
  const ids = collectContextStrings(
    value,
    /categor/,
    /(^id$|_id$|category_?id|parent_?id|leaf_?category_?id)/,
  );
  const names = collectContextStrings(
    value,
    /categor/,
    /(^name$|_name$|category_?name|local_?name|display_?name)/,
  );
  return { ids: unique(ids), names: unique(names) };
}

function collectBrandNames(value: unknown): string[] {
  const direct = [
    firstText(value, [
      "brand_name",
      "brandName",
      "required_brand_name",
      "requiredBrandName",
      "brand.name",
    ]),
  ].filter((item): item is string => item !== null);
  return unique([
    ...direct,
    ...collectContextStrings(value, /brand/, /(^name$|_name$|brand_?name)/),
  ]);
}

function collectKeywords(value: unknown): string[] {
  return unique(
    collectContextStrings(value, /(keyword|search_term|recommendation)/, /(^value$|^name$|keyword|term|text)/),
  );
}

function collectAttributes(value: unknown): string[] {
  return unique(
    collectContextStrings(value, /(attribute|property)/, /(^value$|value_name|^name$|_name$)/),
  );
}

function hasRequirementEvidence(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasRequirementEvidence(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return false;
  for (const [key, child] of Object.entries(record)) {
    if (
      /(criteri|requirement|eligibility|restriction|listing_?rule|submission_?rule)/i.test(key) &&
      child !== null &&
      typeof child === "object"
    ) {
      return true;
    }
  }
  return Object.values(record).some(
    (child) => child !== null && typeof child === "object" && hasRequirementEvidence(child, depth + 1),
  );
}

function findNestedNumber(value: unknown, keyPattern: RegExp, depth = 0): number | null {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedNumber(item, keyPattern, depth + 1);
      if (nested !== null) return nested;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return numberValue(value);
  for (const [key, child] of Object.entries(record)) {
    if (!keyPattern.test(key.toLowerCase())) continue;
    const direct = numberValue(child);
    if (direct !== null) return direct;
    const nested = findNestedNumber(child, /^(amount|value|price|tax_exclusive_price|sale_price)$/, depth + 1);
    if (nested !== null) return nested;
  }
  for (const child of Object.values(record)) {
    if (typeof child !== "object" || child === null) continue;
    const nested = findNestedNumber(child, keyPattern, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function findCurrency(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findCurrency(item);
      if (result) return result;
    }
    return null;
  }
  const direct = firstText(value, ["currency", "currency_code", "currencyCode", "price.currency"]);
  if (direct) return direct;
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, child] of Object.entries(record)) {
    if (/currency/.test(key.toLowerCase())) {
      const result = textValue(child);
      if (result) return result;
    }
  }
  for (const child of Object.values(record)) {
    if (typeof child !== "object" || child === null) continue;
    const result = findCurrency(child);
    if (result) return result;
  }
  return null;
}

function isPastTimestamp(value: unknown, now: number): boolean {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed < now;
  }
  const numeric = numberValue(value);
  if (numeric === null) return false;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  return milliseconds < now;
}

function normalizedStatusCode(value: string, prefixes: readonly string[]): string {
  let normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }
  return normalized;
}

const opportunityStatusPrefixes = [
  "OPPORTUNITY_STATUS_",
  "OPPORTUNITY_STATE_",
  "AVAILABILITY_STATUS_",
  "OPPORTUNITY_",
  "STATUS_",
  "STATE_",
] as const;

const activeOpportunityStatuses = new Set([
  "ACTIVATE",
  "ACTIVATED",
  "ACTIVE",
  "AVAILABLE",
  "ENABLED",
  "IN_PROGRESS",
  "LIVE",
  "ONGOING",
  "ONLINE",
  "OPEN",
  "OPEN_FOR_SUBMISSION",
  "PUBLISHED",
  "SUBMITTABLE",
]);

const inactiveOpportunityStatuses = new Set([
  "ARCHIVED",
  "CANCELED",
  "CANCELLED",
  "CLOSED",
  "COMPLETED",
  "DEACTIVATE",
  "DEACTIVATED",
  "DISABLED",
  "ENDED",
  "EXPIRED",
  "FULFILLED",
  "INACTIVE",
  "OFFLINE",
  "PAUSED",
  "SUSPENDED",
  "UNAVAILABLE",
]);

function opportunityActiveFromStatus(status: string | null): boolean | null {
  if (!status) return null;
  const normalized = normalizedStatusCode(status, opportunityStatusPrefixes);
  if (activeOpportunityStatuses.has(normalized)) return true;
  if (inactiveOpportunityStatuses.has(normalized)) return false;
  return null;
}

export function extractProductRecords(value: unknown): UnknownRecord[] {
  return extractRecords(value, [
    "products",
    "product_list",
    "productList",
    "product_infos",
    "productInfos",
    "items",
  ]);
}

export function extractOpportunityRecords(value: unknown): UnknownRecord[] {
  return extractRecords(value, [
    "opportunities",
    "opportunity_list",
    "opportunityList",
    "opportunity_infos",
    "opportunityInfos",
    "recommendations",
    "items",
  ]);
}

export function extractNextPageToken(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  const record = asRecord(value);
  if (!record) return null;
  const direct = textValue(record.next_page_token ?? record.nextPageToken);
  if (direct) return direct;
  for (const key of ["data", "result", "pagination"]) {
    const nested = extractNextPageToken(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function normalizeProduct(value: unknown, fallbackId = ""): ProductSnapshot {
  const product = unwrap(value, ["product"]);
  const categories = collectCategoryData(product);
  const brandName = collectBrandNames(product)[0] ?? null;
  const price =
    firstNumber(product, [
      "price.tax_exclusive_price",
      "price.taxExclusivePrice",
      "price.amount",
      "sale_price",
      "salePrice",
      "retail_price",
      "retailPrice",
      "skus.0.price.tax_exclusive_price",
      "skus.0.price.taxExclusivePrice",
    ]) ?? findNestedNumber(
      product,
      /(sale_?price|retail_?price|tax_?exclusive_?price|^price$)/,
    );
  return {
    id: firstText(product, ["product_id", "productId", "id"]) ?? fallbackId,
    title: firstText(product, ["title", "product_name", "productName", "name"]) ?? fallbackId,
    status: firstText(product, [
      "status",
      "product_status",
      "productStatus",
      "audit_status",
      "auditStatus",
    ]),
    categoryIds: categories.ids,
    categoryNames: categories.names,
    brandName,
    keywords: collectKeywords(product),
    attributes: collectAttributes(product),
    price,
    currency: findCurrency(product),
  };
}

export function normalizeOpportunity(
  value: unknown,
  fallbackId = "",
  now = Date.now(),
): OpportunitySnapshot {
  const opportunity = unwrap(value, ["opportunity"]);
  const categories = collectCategoryData(opportunity);
  const status = firstText(opportunity, [
    "status",
    "opportunity_status",
    "opportunityStatus",
    "opportunity_state",
    "opportunityState",
    "availability_status",
    "availabilityStatus",
    "availability.status",
    "state",
  ]);
  const normalizedStatus = status
    ? normalizedStatusCode(status, opportunityStatusPrefixes)
    : "";
  const explicitActive = firstBoolean(opportunity, [
    "is_active",
    "isActive",
    "active",
    "is_available",
    "isAvailable",
    "availability.is_available",
    "availability.isAvailable",
    "can_submit",
    "canSubmit",
    "is_submittable",
    "isSubmittable",
    "is_open_for_submission",
    "isOpenForSubmission",
  ]);
  const active = explicitActive ?? opportunityActiveFromStatus(status);
  const expiryValue =
    valueAt(opportunity, "expire_time") ??
    valueAt(opportunity, "expireTime") ??
    valueAt(opportunity, "expiration_time") ??
    valueAt(opportunity, "expirationTime") ??
    valueAt(opportunity, "expired_at") ??
    valueAt(opportunity, "expiredAt") ??
    valueAt(opportunity, "end_time") ??
    valueAt(opportunity, "endTime");
  const expired =
    firstBoolean(opportunity, ["is_expired", "isExpired", "expired"]) === true ||
    ["EXPIRED", "CLOSED", "ENDED"].includes(normalizedStatus) ||
    isPastTimestamp(expiryValue, now);
  const fulfilled =
    firstBoolean(opportunity, ["is_fulfilled", "isFulfilled", "fulfilled"]) === true ||
    ["FULFILLED", "COMPLETED"].includes(normalizedStatus);
  const referencePriceValue =
    valueAt(opportunity, "reference_price") ??
    valueAt(opportunity, "referencePrice") ??
    valueAt(opportunity, "listing_criteria.reference_price") ??
    valueAt(opportunity, "listingCriteria.referencePrice");
  const referencePrice =
    numberValue(referencePriceValue) ?? findNestedNumber(referencePriceValue, /(amount|value|price)/);
  const allowedProductStatuses = unique([
    ...collectContextStrings(opportunity, /product_?status/, /(^value$|^name$|status)/),
    ...collectContextStrings(valueAt(opportunity, "listing_criteria"), /status/, /(^value$|^name$|status)/),
    ...collectContextStrings(valueAt(opportunity, "listingCriteria"), /status/, /(^value$|^name$|status)/),
  ]);
  return {
    id:
      firstText(opportunity, [
        "opportunity_id",
        "opportunityId",
        "recommendation_id",
        "recommendationId",
        "id",
      ]) ?? fallbackId,
    title:
      firstText(opportunity, [
        "title",
        "opportunity_name",
        "opportunityName",
        "name",
        "keyword",
        "recommendation_name",
        "recommendationName",
      ]) ??
      fallbackId,
    type:
      firstText(opportunity, [
        "opportunity_type",
        "opportunityType",
        "type",
        "action_type",
        "actionType",
        "recommendation_type",
        "recommendationType",
      ]) ?? "",
    requirementsVerified: hasRequirementEvidence(opportunity),
    status,
    active,
    expired,
    fulfilled,
    categoryIds: categories.ids,
    categoryNames: categories.names,
    brandNames: collectBrandNames(
      valueAt(opportunity, "listing_criteria") ?? valueAt(opportunity, "listingCriteria") ?? opportunity,
    ),
    keywords: collectKeywords(opportunity),
    allowedProductStatuses,
    referencePrice,
    minPrice: firstNumber(opportunity, [
      "min_price",
      "minPrice",
      "price_min",
      "priceMin",
      "listing_criteria.min_price",
      "listingCriteria.minPrice",
    ]),
    maxPrice: firstNumber(opportunity, [
      "max_price",
      "maxPrice",
      "price_max",
      "priceMax",
      "listing_criteria.max_price",
      "listingCriteria.maxPrice",
    ]),
    currency: findCurrency(referencePriceValue ?? opportunity),
  };
}

function comparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const stopWords = new Set([
  "para",
  "con",
  "por",
  "the",
  "and",
  "from",
  "product",
  "producto",
  "opportunity",
  "oportunidad",
]);

function tokens(values: Array<string | null>): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const token of comparable(value).split(/\s+/)) {
      if (token.length >= 2 && !stopWords.has(token)) result.add(token);
    }
  }
  return result;
}

function hasIntersection(left: string[], right: string[]): boolean {
  const wanted = new Set(left.map(comparable));
  return right.some((value) => wanted.has(comparable(value)));
}

function isExplicitlyInactive(status: string | null): boolean {
  return status ? canonicalProductStatus(status) === "inactive" : false;
}

function isKnownActiveProductStatus(status: string): boolean {
  return canonicalProductStatus(status) === "active";
}

const productStatusPrefixes = [
  "PRODUCT_STATUS_",
  "PRODUCT_STATE_",
  "LISTING_STATUS_",
  "ITEM_STATUS_",
  "STATUS_",
  "STATE_",
] as const;

const activeProductStatuses = new Set([
  "ACTIVATE",
  "ACTIVATED",
  "ACTIVE",
  "ACTIVO",
  "AVAILABLE_FOR_SALE",
  "EN_VIVO",
  "FOR_SALE",
  "LIVE",
  "ONLINE",
  "ON_SALE",
  "PUBLISHED",
  "SELLING",
  "已上架",
]);

const inactiveProductStatuses = new Set([
  "DEACTIVATE",
  "DEACTIVATED",
  "DELETED",
  "DRAFT",
  "FAILED",
  "FREEZE",
  "FROZEN",
  "INACTIVE",
  "NOT_FOR_SALE",
  "OFFLINE",
  "REJECTED",
  "SUSPEND",
  "SUSPENDED",
]);

function canonicalProductStatus(status: string): string {
  const normalized = normalizedStatusCode(status, productStatusPrefixes);
  if (activeProductStatuses.has(normalized)) return "active";
  if (inactiveProductStatuses.has(normalized)) return "inactive";
  return comparable(normalized);
}

function pricePoints(product: ProductSnapshot, opportunity: OpportunitySnapshot): number {
  if (product.price === null) {
    return opportunity.referencePrice === null && opportunity.minPrice === null && opportunity.maxPrice === null
      ? 5
      : 0;
  }
  if (opportunity.minPrice !== null || opportunity.maxPrice !== null) {
    const aboveMin = opportunity.minPrice === null || product.price >= opportunity.minPrice;
    const belowMax = opportunity.maxPrice === null || product.price <= opportunity.maxPrice;
    return aboveMin && belowMax ? 10 : 0;
  }
  if (opportunity.referencePrice === null || opportunity.referencePrice <= 0) return 5;
  const difference = Math.abs(product.price - opportunity.referencePrice) / opportunity.referencePrice;
  if (difference <= 0.15) return 10;
  if (difference <= 0.35) return 7;
  if (difference <= 0.6) return 4;
  return 1;
}

export function scoreOpportunityMatch(
  product: ProductSnapshot,
  opportunity: OpportunitySnapshot,
  options: MatchScoreOptions = {},
): ProductOpportunityMatch {
  const blockers: string[] = [];
  const inferredOpportunityActive = opportunity.active ?? opportunityActiveFromStatus(opportunity.status);
  if (!opportunity.requirementsVerified) {
    blockers.push("机会完整提报要求未获取，禁止自动提报");
  }
  if (!opportunity.type.trim()) blockers.push("机会类型未知，无法验证提报要求");
  if (opportunity.expired) blockers.push("机会已过期");
  if (inferredOpportunityActive === false) blockers.push("机会未激活");
  if (inferredOpportunityActive === null) blockers.push("机会状态未知，无法确认仍可提报");
  if (opportunity.fulfilled) blockers.push("机会已完成");
  if (isExplicitlyInactive(product.status)) blockers.push(`商品状态不可提报：${product.status}`);
  if (options.priorSubmitted) blockers.push("该商品已提报过此机会");

  const productStatus = product.status ? canonicalProductStatus(product.status) : "";
  const allowedStatuses = opportunity.allowedProductStatuses.map(canonicalProductStatus);
  if (!productStatus) {
    blockers.push("商品状态未知，无法确认可提报");
  } else if (!isKnownActiveProductStatus(product.status ?? "") && !allowedStatuses.includes(productStatus)) {
    blockers.push(`商品状态无法确认可提报：${product.status}`);
  }
  if (opportunity.allowedProductStatuses.length > 0) {
    if (!productStatus || !allowedStatuses.includes(productStatus)) {
      blockers.push(
        productStatus
          ? `商品状态不符合机会要求：${product.status}（允许：${opportunity.allowedProductStatuses.join("、")}）`
          : "商品状态未知，无法验证机会要求",
      );
    }
  }

  const categoryIdMatch = hasIntersection(product.categoryIds, opportunity.categoryIds);
  const categoryNameMatch = hasIntersection(product.categoryNames, opportunity.categoryNames);
  const productHasCategory = product.categoryIds.length > 0 || product.categoryNames.length > 0;
  const opportunityHasCategory =
    opportunity.categoryIds.length > 0 || opportunity.categoryNames.length > 0;
  if (!productHasCategory) {
    blockers.push("商品类目未获取，无法验证机会要求");
  }
  if (!opportunityHasCategory) {
    blockers.push("机会适用类目未获取，无法验证提报要求");
  }
  if (productHasCategory && opportunityHasCategory) {
    if (product.categoryIds.length > 0 && opportunity.categoryIds.length > 0) {
      if (!categoryIdMatch) blockers.push("商品类目与机会类目不匹配");
    } else if (product.categoryNames.length > 0 && opportunity.categoryNames.length > 0) {
      if (!categoryNameMatch) blockers.push("商品类目与机会类目不匹配");
    } else {
      blockers.push("商品与机会类目格式不同，无法可靠交叉验证");
    }
  }

  const productBrand = product.brandName ? comparable(product.brandName) : "";
  const brandMatch =
    opportunity.brandNames.length === 0 ||
    opportunity.brandNames.some((brand) => comparable(brand) === productBrand);
  if (opportunity.brandNames.length > 0 && !brandMatch) {
    blockers.push(productBrand ? "商品品牌与机会品牌要求不匹配" : "商品缺少机会要求的品牌信息");
  }

  const hasPriceRange = opportunity.minPrice !== null || opportunity.maxPrice !== null;
  if (
    opportunity.minPrice !== null &&
    opportunity.maxPrice !== null &&
    opportunity.minPrice > opportunity.maxPrice
  ) {
    blockers.push("机会价格要求异常，最低价高于最高价");
  }
  if (hasPriceRange) {
    if (product.price === null) {
      blockers.push("商品价格未获取，无法验证机会价格要求");
    } else if (
      (opportunity.minPrice !== null && product.price < opportunity.minPrice) ||
      (opportunity.maxPrice !== null && product.price > opportunity.maxPrice)
    ) {
      blockers.push("商品价格不符合机会价格区间");
    }
    if (opportunity.currency && !product.currency) {
      blockers.push("商品币种未获取，无法验证机会价格要求");
    } else if (
      opportunity.currency &&
      product.currency &&
      comparable(opportunity.currency) !== comparable(product.currency)
    ) {
      blockers.push("商品币种与机会价格要求不匹配");
    }
  }

  const productTokens = tokens([
    product.title,
    ...product.keywords,
    ...product.attributes,
    ...product.categoryNames,
  ]);
  const opportunityTokens = tokens([
    opportunity.title,
    ...opportunity.keywords,
    ...opportunity.categoryNames,
  ]);
  const matchingTokens = [...opportunityTokens].filter((token) => productTokens.has(token));
  if (/\b(keyword|search)\b/.test(comparable(opportunity.type))) {
    const requiredKeywordTokens = tokens(opportunity.keywords);
    if (requiredKeywordTokens.size === 0) {
      blockers.push("关键词机会的关键词要求未获取");
    } else if (![...requiredKeywordTokens].some((token) => productTokens.has(token))) {
      blockers.push("商品标题/属性未命中机会关键词要求");
    }
  }

  const reasons: string[] = [];
  let score = 0;
  if (categoryIdMatch) {
    score += 40;
    reasons.push("类目 ID 精确匹配 +40");
  } else if (categoryNameMatch) {
    score += 32;
    reasons.push("类目名称匹配 +32");
  }

  if (opportunity.brandNames.length > 0 && brandMatch) {
    score += 20;
    reasons.push("品牌要求匹配 +20");
  } else if (opportunity.brandNames.length === 0 && opportunity.requirementsVerified) {
    score += 10;
    reasons.push("完整要求未声明品牌限制 +10");
  }
  const textScore =
    opportunityTokens.size === 0
      ? 10
      : Math.round(25 * Math.min(1, matchingTokens.length / Math.min(opportunityTokens.size, 5)));
  score += textScore;
  reasons.push(
    matchingTokens.length > 0
      ? `关键词/属性匹配 ${matchingTokens.slice(0, 4).join("、")} +${textScore}`
      : `关键词匹配较弱 +${textScore}`,
  );

  const priceScore = pricePoints(product, opportunity);
  score += priceScore;
  reasons.push(`价格带匹配 +${priceScore}`);

  if (!opportunity.expired && inferredOpportunityActive === true && !opportunity.fulfilled) {
    score += 5;
    reasons.push("机会当前有效 +5");
  }

  score = Math.max(0, Math.min(100, score));
  if (blockers.length === 0 && score < MIN_SAFE_MATCH_SCORE) {
    blockers.push(`综合匹配分低于安全阈值：${score}/${MIN_SAFE_MATCH_SCORE}`);
  }
  const eligible = blockers.length === 0;
  const confidence: MatchConfidence =
    eligible && score >= MIN_SAFE_MATCH_SCORE ? "high" : eligible && score >= 60 ? "medium" : "low";
  return {
    product,
    opportunity:
      inferredOpportunityActive === opportunity.active
        ? opportunity
        : { ...opportunity, active: inferredOpportunityActive },
    score,
    confidence,
    eligible,
    recommended: eligible && score >= MIN_SAFE_MATCH_SCORE,
    reasons,
    blockers: unique(blockers),
  };
}
