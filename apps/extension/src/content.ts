import type {
  CollectedProduct,
  CollectProductsMessage,
  CollectProductsResult,
  FillMessage,
  FillResult,
} from "./types.js";

const DEFAULT_PRODUCT_ROW_SELECTORS = [
  "[data-product-id]",
  "tbody tr",
  '[role="row"]',
  "[data-row-key]",
  '[class*="product"][class*="row"]',
];

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function elementText(element: Element | null): string {
  if (!element) return "";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return cleanText(element.value);
  }
  return cleanText(element.getAttribute("content") ?? element.textContent);
}

function selectedText(root: Element, selector: string, fallbacks: string[]): string {
  if (selector) return elementText(root.querySelector(selector));
  for (const fallback of fallbacks) {
    const value = elementText(root.querySelector(fallback));
    if (value) return value;
  }
  return "";
}

function normalizeProductId(value: string): string | null {
  const normalized = cleanText(value);
  const labeled = normalized.match(
    /(?:product\s*id|id\s+del\s+producto|商品\s*id|producto)\s*[:：#]?\s*([A-Za-z0-9_-]{6,64})/i,
  )?.[1];
  if (labeled) return labeled;
  if (/^[A-Za-z0-9_-]{6,64}$/.test(normalized)) return normalized;
  return normalized.match(/\b\d{10,30}\b/)?.[0] ?? null;
}

function productIdFromRow(row: Element, selector: string): string | null {
  if (selector) return normalizeProductId(elementText(row.querySelector(selector)));
  for (const name of ["data-product-id", "data-productid", "data-row-key", "data-id"]) {
    const direct = normalizeProductId(row.getAttribute(name) ?? "");
    if (direct) return direct;
    const nested = row.querySelector(`[${name}]`);
    const nestedValue = normalizeProductId(nested?.getAttribute(name) ?? "");
    if (nestedValue) return nestedValue;
  }
  for (const link of Array.from(row.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";
    const matched = href.match(/(?:product(?:_id)?[=/]|products?\/)([A-Za-z0-9_-]{6,64})/i)?.[1];
    if (matched) return matched;
  }
  return normalizeProductId(elementText(row));
}

function labeledValue(text: string, labels: string): string {
  const expression = new RegExp(`(?:${labels})\\s*[:：]?\\s*([^|·\\n]{1,120})`, "i");
  return cleanText(text.match(expression)?.[1]);
}

function fallbackTitle(row: Element, productId: string): string {
  const selected = selectedText(row, "", [
    "[data-product-title]",
    '[data-testid*="product-name" i]',
    '[data-testid*="product-title" i]',
    '[class*="product-name" i]',
    '[class*="product-title" i]',
    'a[href*="product" i]',
  ]);
  if (selected && selected !== productId) return selected;
  const imageAlt = cleanText(row.querySelector("img[alt]")?.getAttribute("alt"));
  if (imageAlt && imageAlt !== productId) return imageAlt;
  for (const cell of Array.from(row.querySelectorAll("td, [role='cell']"))) {
    const value = elementText(cell);
    if (
      value.length >= 3 &&
      value.length <= 300 &&
      !value.includes(productId) &&
      !/^(?:MXN|USD|\$)?\s*[\d.,-]+$/i.test(value)
    ) {
      return value;
    }
  }
  return productId;
}

function parseLocaleNumber(value: string): number | null {
  const match = value.match(/-?\d[\d.,\s]*/)?.[0];
  if (!match) return null;
  let normalized = match.replace(/\s+/g, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = normalized.replaceAll(thousands, "").replace(decimal, ".");
  } else {
    const separator = comma >= 0 ? "," : dot >= 0 ? "." : "";
    if (separator) {
      const parts = normalized.split(separator);
      const last = parts.at(-1) ?? "";
      normalized =
        parts.length === 2 && last.length <= 2
          ? `${parts[0]}.${last}`
          : parts.join("");
    }
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function currencyFromText(value: string): string | null {
  const explicit = value.match(/\b(MXN|USD|EUR|BRL|GBP|CAD)\b/i)?.[1];
  if (explicit) return explicit.toUpperCase();
  return /MX\s*\$/i.test(value) || value.includes("$") ? "MXN" : null;
}

function productFromRow(
  row: Element,
  profile: CollectProductsMessage["profile"],
): CollectedProduct | null {
  const id = productIdFromRow(row, profile.productIdSelector);
  if (!id) return null;
  const rowText = elementText(row);
  const configuredTitle = selectedText(row, profile.productTitleSelector, []);
  const status =
    selectedText(row, profile.productStatusSelector, [
      "[data-product-status]",
      '[data-testid*="status" i]',
      '[class*="status" i]',
    ]) || labeledValue(rowText, "status|estado|状态");
  const categoryName =
    selectedText(row, profile.productCategorySelector, [
      "[data-product-category]",
      '[data-testid*="category" i]',
      '[class*="category" i]',
    ]) || labeledValue(rowText, "category|categor[ií]a|类目|分类");
  const brandName =
    selectedText(row, profile.productBrandSelector, [
      "[data-product-brand]",
      '[data-testid*="brand" i]',
      '[class*="brand" i]',
    ]) || labeledValue(rowText, "brand|marca|品牌");
  const priceText =
    selectedText(row, profile.productPriceSelector, [
      "[data-product-price]",
      "[data-price]",
      '[data-testid*="price" i]',
      '[class*="price" i]',
    ]) || labeledValue(rowText, "price|precio|价格");
  const stockText =
    selectedText(row, profile.productStockSelector, [
      "[data-product-stock]",
      "[data-stock]",
      '[data-testid*="stock" i]',
      '[class*="stock" i]',
      '[class*="inventory" i]',
    ]) || labeledValue(rowText, "stock|inventory|existencias|库存");
  const stockValue = parseLocaleNumber(stockText);
  return {
    id,
    title: configuredTitle || fallbackTitle(row, id),
    status: status || null,
    categoryName: categoryName || null,
    brandName: brandName || null,
    price: parseLocaleNumber(priceText),
    currency: currencyFromText(priceText),
    stock: stockValue === null ? null : Math.floor(stockValue),
  };
}

function validateCaptureSelectors(profile: CollectProductsMessage["profile"]): string | null {
  const labels: Array<[keyof typeof profile, string]> = [
    ["productRowSelector", "商品行"],
    ["productIdSelector", "商品 ID"],
    ["productTitleSelector", "标题"],
    ["productStatusSelector", "状态"],
    ["productCategorySelector", "类目"],
    ["productBrandSelector", "品牌"],
    ["productPriceSelector", "价格"],
    ["productStockSelector", "库存"],
  ];
  for (const [key, label] of labels) {
    const selector = profile[key];
    if (!selector) continue;
    try {
      document.querySelector(selector);
    } catch {
      return `${label} CSS 选择器无效：${selector}`;
    }
  }
  return null;
}

function collectRows(
  rows: Element[],
  profile: CollectProductsMessage["profile"],
): CollectedProduct[] {
  const products = new Map<string, CollectedProduct>();
  for (const row of rows.slice(0, 500)) {
    const product = productFromRow(row, profile);
    if (product && !products.has(product.id)) products.set(product.id, product);
    if (products.size >= 200) break;
  }
  return [...products.values()];
}

function collectProducts(message: CollectProductsMessage): CollectProductsResult {
  const capturedAt = new Date().toISOString();
  const invalidSelector = validateCaptureSelectors(message.profile);
  if (invalidSelector) {
    return {
      ok: false,
      message: invalidSelector,
      products: [],
      sourceUrl: location.href,
      capturedAt,
      scannedRows: 0,
    };
  }

  const selectors = message.profile.productRowSelector
    ? [message.profile.productRowSelector]
    : DEFAULT_PRODUCT_ROW_SELECTORS;
  let best: { products: CollectedProduct[]; scannedRows: number } = {
    products: [],
    scannedRows: 0,
  };
  for (const selector of selectors) {
    const rows = Array.from(document.querySelectorAll(selector));
    const products = collectRows(rows, message.profile);
    if (products.length > best.products.length) best = { products, scannedRows: rows.length };
    if (message.profile.productRowSelector) break;
  }
  return {
    ok: best.products.length > 0,
    message: best.products.length
      ? `已从当前页识别 ${best.products.length} 个商品`
      : "当前页未识别到商品，请打开商品管理列表或配置采集选择器",
    products: best.products,
    sourceUrl: location.href,
    capturedAt,
    scannedRows: best.scannedRows,
  };
}

function findInput(selector: string): HTMLInputElement | HTMLTextAreaElement | null {
  if (selector) {
    const selected = document.querySelector(selector);
    if (selected instanceof HTMLInputElement || selected instanceof HTMLTextAreaElement) return selected;
  }
  for (const label of Array.from(document.querySelectorAll("label"))) {
    if (!/(product\s*id|商品\s*id|producto)/i.test(label.textContent ?? "")) continue;
    const nested = label.querySelector("input, textarea");
    if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement) return nested;
    if (label.htmlFor) {
      const linked = document.getElementById(label.htmlFor);
      if (linked instanceof HTMLInputElement || linked instanceof HTMLTextAreaElement) return linked;
    }
  }
  const fallback = document.querySelector(
    'input[name*="product" i], input[placeholder*="product" i], input[data-testid*="product" i]',
  );
  return fallback instanceof HTMLInputElement ? fallback : null;
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.focus();
}

async function waitForSelector(selector: string, timeoutMs = 15_000): Promise<Element | null> {
  if (!selector) return null;
  const existing = document.querySelector(selector);
  if (existing) return existing;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (!element) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(element);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function fill(message: FillMessage): Promise<FillResult> {
  const input = findInput(message.profile.productInputSelector);
  if (!input) {
    return {
      ok: false,
      stage: "error",
      message: "未找到商品 ID 输入框，请在插件设置页填写 CSS 选择器",
    };
  }
  setInputValue(input, message.task.productId);
  input.scrollIntoView({ behavior: "smooth", block: "center" });

  if (!message.autoSubmit) {
    return { ok: true, stage: "filled", message: "商品 ID 已填写，请人工核对后提交" };
  }
  if (!message.profile.submitButtonSelector || !message.profile.successSelector) {
    return {
      ok: false,
      stage: "error",
      message: "自动提交需要同时配置提交按钮和成功标识选择器",
    };
  }
  const button = document.querySelector(message.profile.submitButtonSelector);
  if (!(button instanceof HTMLElement)) {
    return { ok: false, stage: "error", message: "未找到提交按钮" };
  }
  button.click();
  const success = await waitForSelector(message.profile.successSelector);
  return success
    ? { ok: true, stage: "submitted", message: "页面已显示成功标识" }
    : { ok: false, stage: "error", message: "提交后未检测到成功标识，请人工检查页面" };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  const type = (message as { type?: string }).type;
  if (type === "TIBAO_FILL") {
    void fill(message as FillMessage).then(sendResponse);
    return true;
  }
  if (type === "TIBAO_COLLECT_PRODUCTS") {
    sendResponse(collectProducts(message as CollectProductsMessage));
    return false;
  }
  return;
});
