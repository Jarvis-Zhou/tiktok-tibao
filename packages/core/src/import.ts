import type {
  ImportIssue,
  ImportTaskInput,
  ImportValidationResult,
  TaskChannel,
} from "./types.js";

const aliases = {
  shopId: ["shop_id", "shopid", "shop", "store", "店铺id", "店铺"],
  opportunityId: [
    "opportunity_id",
    "opportunityid",
    "opportunity",
    "机会id",
    "机会编号",
    "商品机会id",
  ],
  productId: ["product_id", "productid", "product", "商品id", "商品编号"],
  channel: ["channel", "executor", "mode", "通道", "执行方式"],
} as const;

export interface ValidateImportOptions {
  defaultShopId?: string;
  defaultChannel?: TaskChannel;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function valueFor(
  row: Record<string, unknown>,
  field: keyof typeof aliases,
): string {
  const wanted = new Set(aliases[field].map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeHeader(key))) return cellToString(value);
  }
  return "";
}

export function normalizeChannel(
  value: unknown,
  fallback: TaskChannel = "api",
): TaskChannel | null {
  const normalized = cellToString(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return fallback;
  if (["api", "officialapi", "官方api", "a"].includes(normalized)) return "api";
  if (["extension", "chrome", "chromeextension", "插件", "c"].includes(normalized)) {
    return "extension";
  }
  return null;
}

export function createTaskKey(input: Pick<ImportTaskInput, "shopId" | "opportunityId" | "productId">): string {
  return [input.shopId, input.opportunityId, input.productId]
    .map((value) => value.trim().toLowerCase())
    .join("\u001f");
}

export function validateImportRows(
  rows: Record<string, unknown>[],
  options: ValidateImportOptions = {},
): ImportValidationResult {
  const valid: ImportValidationResult["valid"] = [];
  const invalid: ImportValidationResult["invalid"] = [];
  const seen = new Set<string>();
  const defaultChannel = options.defaultChannel ?? "api";

  rows.forEach((raw, index) => {
    const sourceRow = index + 2;
    const shopId = valueFor(raw, "shopId") || options.defaultShopId?.trim() || "";
    const opportunityId = valueFor(raw, "opportunityId");
    const productId = valueFor(raw, "productId");
    const channel = normalizeChannel(valueFor(raw, "channel"), defaultChannel);
    const issues: ImportIssue[] = [];

    if (!shopId) {
      issues.push({ row: sourceRow, field: "shop_id", code: "required", message: "缺少店铺 ID" });
    }
    if (!opportunityId) {
      issues.push({
        row: sourceRow,
        field: "opportunity_id",
        code: "required",
        message: "缺少 opportunity_id",
      });
    } else if (opportunityId.length > 128) {
      issues.push({
        row: sourceRow,
        field: "opportunity_id",
        code: "invalid",
        message: "opportunity_id 长度异常",
      });
    }
    if (!productId) {
      issues.push({ row: sourceRow, field: "product_id", code: "required", message: "缺少 product_id" });
    } else if (productId.length > 128) {
      issues.push({
        row: sourceRow,
        field: "product_id",
        code: "invalid",
        message: "product_id 长度异常",
      });
    }
    if (!channel) {
      issues.push({
        row: sourceRow,
        field: "channel",
        code: "invalid",
        message: "通道仅支持 api 或 extension",
      });
    }

    if (issues.length > 0 || !channel) {
      invalid.push({ sourceRow, raw, issues });
      return;
    }

    const input: ImportTaskInput = {
      sourceRow,
      shopId,
      opportunityId,
      productId,
      channel,
    };
    const key = createTaskKey(input);
    if (seen.has(key)) {
      invalid.push({
        sourceRow,
        raw,
        issues: [
          {
            row: sourceRow,
            field: "row",
            code: "duplicate",
            message: "文件内存在重复的店铺、机会和商品组合",
          },
        ],
      });
      return;
    }
    seen.add(key);
    valid.push({ input, key });
  });

  return { valid, invalid };
}
