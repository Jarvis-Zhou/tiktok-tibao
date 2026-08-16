import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as XLSX from "xlsx";
import {
  TASK_CHANNELS,
  TASK_STATUSES,
  normalizeChannel,
  validateImportRows,
  type ImportIssue,
  type TaskChannel,
  type TaskStatus,
} from "@tibao/core";
import type {
  TikTokAuthorizedShopsData,
  TikTokOAuthTokenData,
  TikTokResponse,
} from "@tibao/tiktok-api";
import type { AppConfig } from "./config.js";
import { isTikTokAppConfigured } from "./config.js";
import type {
  CapturedOpportunityInput,
  CapturedProductInput,
  ProductSubmissionProgress,
  TibaoDatabase,
} from "./database.js";
import type { ApiRunner } from "./runner.js";
import type { TokenVault } from "./token-vault.js";

export interface RouteDependencies {
  config: AppConfig;
  database: TibaoDatabase;
  vault: TokenVault;
  runner: ApiRunner;
  oauthClient?: TikTokOAuthClient;
}

export interface TikTokOAuthClient {
  createAuthorizationUrl(state: string): string;
  exchangeCode(authCode: string): Promise<TikTokResponse<TikTokOAuthTokenData>>;
  listAuthorizedShops(accessToken: string): Promise<TikTokResponse<TikTokAuthorizedShopsData>>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRegion(value: unknown): string {
  const region = text(value).toUpperCase();
  return /^[A-Z0-9_-]{2,16}$/.test(region) ? region : "";
}

export function captureRegionFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const fromQuery = normalizeRegion(
      url.searchParams.get("shop_region") || url.searchParams.get("region"),
    );
    if (fromQuery) return fromQuery;
    return url.hostname === "seller-mx.tiktok.com" ? "MX" : "";
  } catch {
    return "";
  }
}

type UnknownRecord = Record<string, unknown>;

class SnapshotValidationError extends Error {}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SnapshotValidationError("快照条目格式无效");
  }
  return value as UnknownRecord;
}

function stringList(
  value: unknown,
  label: string,
  maximumItems = 100,
  maximumLength = 300,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new SnapshotValidationError(`${label} 格式无效`);
  }
  const result: string[] = [];
  for (const item of value) {
    const normalized = text(item);
    if (!normalized) continue;
    if (normalized.length > maximumLength) {
      throw new SnapshotValidationError(`${label} 包含过长文本`);
    }
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SnapshotValidationError(`${label} 无效`);
  }
  return value;
}

function parseCapturedProduct(value: unknown, index: number): CapturedProductInput {
  const raw = asRecord(value);
  const prefix = `第 ${index + 1} 个商品`;
  const id = text(raw.id);
  const title = text(raw.title) || id;
  const status = text(raw.status);
  const categoryName = text(raw.categoryName);
  const categoryIds = stringList(raw.categoryIds, `${prefix}类目 ID`, 30, 128);
  const parsedCategoryNames = stringList(raw.categoryNames, `${prefix}类目名称`, 30, 300);
  const categoryNames = parsedCategoryNames.length > 0
    ? parsedCategoryNames
    : categoryName
      ? [categoryName]
      : [];
  const brandName = text(raw.brandName);
  const keywords = stringList(raw.keywords, `${prefix}关键词`, 100, 300);
  const attributes = stringList(raw.attributes, `${prefix}属性`, 200, 500);
  const currency = text(raw.currency).toUpperCase();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new SnapshotValidationError(`${prefix} ID 无效`);
  }
  if (
    title.length > 500 ||
    status.length > 100 ||
    categoryName.length > 300 ||
    brandName.length > 200
  ) {
    throw new SnapshotValidationError(`${prefix}文本字段过长`);
  }
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new SnapshotValidationError(`${prefix}币种无效`);
  }
  const stockValue = raw.stock;
  if (
    stockValue !== null &&
    stockValue !== undefined &&
    (typeof stockValue !== "number" || !Number.isSafeInteger(stockValue) || stockValue < 0)
  ) {
    throw new SnapshotValidationError(`${prefix}库存无效`);
  }
  return {
    id,
    title,
    status: status || null,
    categoryIds,
    categoryNames,
    brandName: brandName || null,
    keywords,
    attributes,
    price: nullableNumber(raw.price, `${prefix}价格`),
    currency: currency || null,
    stock: typeof stockValue === "number" ? stockValue : null,
  };
}

function parseCapturedOpportunity(value: unknown, index: number): CapturedOpportunityInput {
  const raw = asRecord(value);
  const prefix = `第 ${index + 1} 个机会`;
  const id = text(raw.id);
  const title = text(raw.title) || id;
  const type = text(raw.type);
  const status = text(raw.status);
  const currency = text(raw.currency).toUpperCase();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new SnapshotValidationError(`${prefix} ID 无效`);
  }
  if (title.length > 500 || type.length > 100 || status.length > 100) {
    throw new SnapshotValidationError(`${prefix}文本字段过长`);
  }
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new SnapshotValidationError(`${prefix}币种无效`);
  }
  if (raw.active !== null && raw.active !== undefined && typeof raw.active !== "boolean") {
    throw new SnapshotValidationError(`${prefix} active 无效`);
  }
  if (
    raw.requirementsVerified !== null &&
    raw.requirementsVerified !== undefined &&
    typeof raw.requirementsVerified !== "boolean"
  ) {
    throw new SnapshotValidationError(`${prefix} requirementsVerified 无效`);
  }
  for (const key of ["expired", "fulfilled"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
      throw new SnapshotValidationError(`${prefix} ${key} 无效`);
    }
  }
  return {
    id,
    title,
    type,
    requirementsVerified: raw.requirementsVerified === true,
    status: status || null,
    active: typeof raw.active === "boolean" ? raw.active : null,
    expired: raw.expired === true,
    fulfilled: raw.fulfilled === true,
    categoryIds: stringList(raw.categoryIds, `${prefix}类目 ID`, 30, 128),
    categoryNames: stringList(raw.categoryNames, `${prefix}类目名称`, 30, 300),
    brandNames: stringList(raw.brandNames, `${prefix}品牌`, 100, 200),
    keywords: stringList(raw.keywords, `${prefix}关键词`, 200, 300),
    allowedProductStatuses: stringList(raw.allowedProductStatuses, `${prefix}商品状态`, 50, 100),
    referencePrice: nullableNumber(raw.referencePrice, `${prefix}参考价格`),
    minPrice: nullableNumber(raw.minPrice, `${prefix}最低价格`),
    maxPrice: nullableNumber(raw.maxPrice, `${prefix}最高价格`),
    currency: currency || null,
  };
}

function parseSnapshotArray<T>(
  value: unknown,
  label: string,
  parser: (item: unknown, index: number) => T,
): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SnapshotValidationError(`${label}必须是数组`);
  if (value.length > 2_000) throw new SnapshotValidationError(`单次最多导入 2000 个${label}`);
  return value.map(parser);
}

function csvCell(value: unknown): string {
  const string = String(value ?? "");
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function withSubmissionProgress<T extends { id: string }>(
  database: TibaoDatabase,
  shopId: string,
  products: T[],
): Array<T & { submissionProgress: ProductSubmissionProgress }> {
  const progress = database.productSubmissionProgress(
    shopId,
    products.map((product) => product.id),
  );
  return products.map((product) => ({
    ...product,
    submissionProgress: progress.get(product.id) ?? {
      state: "pending",
      taskCount: 0,
      statusCounts: {},
      latestUpdatedAt: null,
    },
  }));
}

export function isAllowedCaptureSource(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.port === "3210"
    ) {
      return true;
    }
    if (url.protocol !== "https:") return false;
    return (
      url.hostname === "seller-mx.tiktok.com" ||
      url.hostname === "seller.tiktokglobalshop.com" ||
      url.hostname === "seller.tiktokshopglobalselling.com" ||
      url.hostname.endsWith(".tiktokshop.com") ||
      url.hostname.endsWith(".tiktokglobalshop.com")
    );
  } catch {
    return false;
  }
}

function verifyExtension(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
): boolean {
  if (!config.extensionSharedKey) {
    void reply.code(503).send({ error: "EXTENSION_SHARED_KEY 未配置" });
    return false;
  }
  const provided = request.headers["x-extension-key"];
  if (provided !== config.extensionSharedKey) {
    void reply.code(401).send({ error: "Chrome 插件密钥无效" });
    return false;
  }
  return true;
}

function missingOAuthSettings(config: AppConfig, vault: TokenVault): string[] {
  const missing: string[] = [];
  if (!config.tiktokAppKey) missing.push("TIKTOK_APP_KEY");
  if (!config.tiktokAppSecret) missing.push("TIKTOK_APP_SECRET");
  if (!vault.available) missing.push("TOKEN_ENCRYPTION_KEY");
  return missing;
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDependencies): Promise<void> {
  const { config, database, vault, runner, oauthClient } = deps;
  const oauthMissingSettings = missingOAuthSettings(config, vault);
  const oauthConfigurationIssues = [
    ...oauthMissingSettings,
    ...(!oauthClient ? ["OAuth 客户端未初始化"] : []),
  ];
  const oauthConfigured = oauthConfigurationIssues.length === 0;
  const oauthConfigurationMessage = `服务端 OAuth 配置不完整：${
    oauthConfigurationIssues.length > 0
      ? `缺少 ${oauthConfigurationIssues.join("、")}`
      : "未知配置错误"
  }。请修改仓库根目录 .env 后重启服务`;

  app.get("/api/health", async () => ({
    ok: true,
    apiConfigured: isTikTokAppConfigured(config) && vault.available,
    oauthConfigured,
    oauthMissingSettings,
    oauthClientConfigured: Boolean(oauthClient),
    oauthCallbackPath: "/api/oauth/tiktok/callback",
    appCredentialsConfigured: isTikTokAppConfigured(config),
    tokenEncryptionConfigured: vault.available,
    extensionConfigured: Boolean(config.extensionSharedKey),
    expiredLeasesRecovered: database.resetExpiredLeases(),
  }));

  app.get("/api/oauth/tiktok/start", async (_request, reply) => {
    if (!oauthConfigured || !oauthClient) {
      return reply.code(503).send({ error: oauthConfigurationMessage });
    }
    const state = database.createOAuthState();
    return reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
      .redirect(oauthClient.createAuthorizationUrl(state));
  });

  app.get<{
    Querystring: {
      code?: string;
      auth_code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
  }>(
    "/api/oauth/tiktok/callback",
    { logLevel: "silent" },
    async (request, reply) => {
      const redirect = (status: "success" | "error", values: Record<string, string> = {}) => {
        const search = new URLSearchParams({ oauth: status, ...values });
        return reply
          .header("cache-control", "no-store")
          .header("referrer-policy", "no-referrer")
          .redirect(`/?${search.toString()}`);
      };

      if (!oauthConfigured || !oauthClient) {
        return redirect("error", { message: oauthConfigurationMessage });
      }
      const state = text(request.query.state);
      if (!state || !database.consumeOAuthState(state)) {
        return redirect("error", { message: "OAuth state 无效、已使用或已过期，请重新授权" });
      }
      const providerError = text(request.query.error_description) || text(request.query.error);
      if (providerError) {
        return redirect("error", { message: providerError.slice(0, 300) });
      }
      const authCode = text(request.query.code) || text(request.query.auth_code);
      if (!authCode) {
        return redirect("error", { message: "TikTok 回调缺少 auth_code" });
      }

      try {
        const token = await oauthClient.exchangeCode(authCode);
        const authorized = await oauthClient.listAuthorizedShops(token.data.access_token);
        const sellerRegion = normalizeRegion(token.data.seller_base_region);
        const shops = authorized.data.shops ?? [];
        const importableShops = [
          ...new Map(
            shops
              .filter((shop) => Boolean(text(shop.cipher)))
              .map((shop) => [text(shop.cipher), shop]),
          ).values(),
        ];
        if (importableShops.length === 0) {
          throw new Error("本次授权没有返回带 Shop Cipher 的店铺");
        }

        const encryptedAccessToken = vault.encrypt(token.data.access_token);
        const importedRegions = new Set<string>();
        for (const shop of importableShops) {
          const region = normalizeRegion(shop.region) || sellerRegion;
          if (region) importedRegions.add(region);
          database.createShop({
            name:
              text(shop.name) ||
              text(token.data.seller_name) ||
              `TikTok ${region || "Shop"} ${
                text(shop.code) || text(shop.id) || text(shop.cipher).slice(-6)
              }`,
            shopCipher: text(shop.cipher),
            region,
            encryptedAccessToken,
          });
        }
        return redirect("success", {
          shops: String(importableShops.length),
          ...(importedRegions.size > 0 ? { regions: [...importedRegions].sort().join(",") } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "TikTok OAuth 处理失败";
        return redirect("error", { message: message.slice(0, 300) });
      }
    },
  );

  app.get("/api/shops", async () => ({ shops: database.listShops() }));

  app.post<{
    Body: { name?: string; shopCipher?: string; accessToken?: string };
  }>("/api/shops", async (request, reply) => {
    const name = text(request.body?.name);
    const shopCipher = text(request.body?.shopCipher);
    const accessToken = text(request.body?.accessToken);
    if (!name) return reply.code(400).send({ error: "name 为必填项" });
    if (Boolean(shopCipher) !== Boolean(accessToken)) {
      return reply.code(400).send({ error: "API 店铺必须同时填写 shopCipher 和 accessToken" });
    }
    if (accessToken && !vault.available) {
      return reply.code(400).send({ error: "保存 API Token 前请先配置 TOKEN_ENCRYPTION_KEY" });
    }
    let region = "";
    if (accessToken && oauthClient && isTikTokAppConfigured(config)) {
      try {
        const authorized = await oauthClient.listAuthorizedShops(accessToken);
        const matchingShop = authorized.data.shops?.find(
          (shop) => text(shop.cipher) === shopCipher,
        );
        region = normalizeRegion(matchingShop?.region);
      } catch {
        // Manual entry remains a fallback when the authorization lookup is unavailable.
      }
    }
    const shop = accessToken
      ? database.createShop({
          name,
          shopCipher,
          region,
          encryptedAccessToken: vault.encrypt(accessToken),
        })
      : database.createShop({ name });
    return reply.code(201).send({ shop });
  });

  app.post<{ Params: { id: string } }>("/api/shops/:id/test", async (request, reply) => {
    if (!runner.configured) return reply.code(400).send({ error: "TikTok API 或 Token 加密配置不完整" });
    const result = await runner.testShop(request.params.id);
    return { ok: true, result };
  });

  app.get<{
    Params: { id: string };
    Querystring: { pageSize?: string; pageToken?: string; source?: string };
  }>("/api/shops/:id/products", async (request, reply) => {
    const shop = database.getShop(request.params.id);
    if (!shop) return reply.code(404).send({ error: "店铺不存在" });
    const source = text(request.query.source) || "auto";
    if (!["auto", "api", "extension"].includes(source)) {
      return reply.code(400).send({ error: "source 仅支持 auto、api 或 extension" });
    }
    const pageSize = Number.parseInt(request.query.pageSize ?? "100", 10);
    const normalizedPageSize = Math.min(Math.max(Number.isFinite(pageSize) ? pageSize : 100, 1), 100);
    const useCaptured =
      source === "extension" ||
      (source === "auto" && (!runner.configured || !shop.apiConfigured));
    if (useCaptured) {
      const rawOffset = text(request.query.pageToken) || "0";
      if (!/^\d+$/.test(rawOffset)) {
        return reply.code(400).send({ error: "插件商品分页标记无效" });
      }
      const offset = Number(rawOffset);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return reply.code(400).send({ error: "插件商品分页标记无效" });
      }
      const page = database.listCapturedProducts(
        request.params.id,
        normalizedPageSize + 1,
        offset,
      );
      const hasMore = page.length > normalizedPageSize;
      const products = page.slice(0, normalizedPageSize);
      return {
        products: withSubmissionProgress(database, request.params.id, products),
        nextPageToken: hasMore ? String(offset + products.length) : null,
        requestId: null,
        source: "extension" as const,
      };
    }
    if (!runner.configured || !shop.apiConfigured) {
      return reply.code(400).send({ error: "该店铺未配置 TikTok API 凭证" });
    }
    const result = await runner.listProducts(request.params.id, {
      pageSize: normalizedPageSize,
      ...(text(request.query.pageToken) ? { pageToken: text(request.query.pageToken) } : {}),
    });
    return {
      ...result,
      products: withSubmissionProgress(database, request.params.id, result.products),
      source: "api" as const,
    };
  });

  app.post<{
    Body: { shopId?: string; productIds?: unknown; source?: string };
  }>("/api/opportunity-matches", async (request, reply) => {
    const shopId = text(request.body?.shopId);
    const productIds = Array.isArray(request.body?.productIds)
      ? request.body.productIds.map(text).filter(Boolean)
      : [];
    const shop = shopId ? database.getShop(shopId) : null;
    if (!shopId || !shop) {
      return reply.code(400).send({ error: "请选择有效店铺" });
    }
    if (productIds.length === 0) {
      return reply.code(400).send({ error: "至少选择一个商品" });
    }
    if (productIds.length > 20) {
      return reply.code(400).send({ error: "MVP 单次最多匹配 20 个商品" });
    }
    const requestedSource = text(request.body?.source) || "auto";
    if (!["auto", "api", "extension"].includes(requestedSource)) {
      return reply.code(400).send({ error: "source 仅支持 auto、api 或 extension" });
    }
    const source = requestedSource === "auto"
      ? runner.configured && shop.apiConfigured
        ? "api"
        : "extension"
      : requestedSource;
    if (source === "api") {
      if (!runner.configured || !shop.apiConfigured) {
        return reply.code(400).send({ error: "该店铺未配置可用的 TikTok API 凭证" });
      }
      return { ...(await runner.matchProducts(shopId, productIds)), source };
    }
    try {
      return { ...runner.matchCapturedProducts(shopId, productIds), source };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "插件快照匹配失败",
      });
    }
  });

  app.post<{
    Body: {
      shopId?: string;
      confirmed?: boolean;
      runApi?: boolean;
      selections?: Array<{ productId?: string; opportunityId?: string; channel?: string }>;
    };
  }>("/api/opportunity-matches/batch", async (request, reply) => {
    if (request.body?.confirmed !== true) {
      return reply.code(400).send({ error: "创建提报批次前必须明确确认匹配结果" });
    }
    const shopId = text(request.body.shopId);
    if (!shopId || !database.getShop(shopId)) {
      return reply.code(400).send({ error: "请选择有效店铺" });
    }
    const selections = request.body.selections ?? [];
    if (selections.length === 0) {
      return reply.code(400).send({ error: "至少勾选一个商品—机会组合" });
    }
    if (selections.length > 200) {
      return reply.code(400).send({ error: "MVP 单次最多创建 200 条提报任务" });
    }
    const rows = selections.map((selection) => ({
      shop_id: shopId,
      product_id: text(selection.productId),
      opportunity_id: text(selection.opportunityId),
      channel: text(selection.channel) || "api",
    }));
    const validation = validateImportRows(rows, { defaultShopId: shopId, defaultChannel: "api" });
    if (validation.invalid.length > 0) {
      return reply.code(400).send({
        error: "部分匹配结果无效，请刷新后重新选择",
        invalid: validation.invalid.map((row) => ({ sourceRow: row.sourceRow, issues: row.issues })),
      });
    }
    const safetyValidation = await runner.validateMatchSelections(
      shopId,
      validation.valid.map((row) => ({
        productId: row.input.productId,
        opportunityId: row.input.opportunityId,
        channel: row.input.channel,
      })),
    );
    if (!safetyValidation.safe) {
      return reply.code(409).send({
        error: "所选组合未通过最新安全复核，未创建批次；请重新读取商品和机会后匹配",
        invalid: safetyValidation.issues,
      });
    }
    const timestamp = new Date().toISOString();
    const batch = database.createBatch({
      filename: `opportunity-matches-${timestamp.slice(0, 19).replaceAll(":", "-")}.json`,
      source: "matching",
      validRows: validation.valid,
      invalidRows: [],
      totalRows: rows.length,
    });
    const started =
      request.body.runApi === true &&
      batch.validRows > 0 &&
      rows.some((row) => normalizeChannel(row.channel) === "api")
        ? runner.startBatch(batch.id)
        : false;
    const productIds = [...new Set(validation.valid.map((row) => row.input.productId))];
    const productProgress = Object.fromEntries(
      database.productSubmissionProgress(shopId, productIds),
    );
    return reply.code(201).send({ batch, started, productProgress });
  });

  app.get("/api/batches", async () => ({ batches: database.listBatches() }));

  app.get<{
    Querystring: { batchId?: string; status?: string; channel?: string; limit?: string };
  }>("/api/tasks", async (request, reply) => {
    const status = request.query.status as TaskStatus | undefined;
    const channel = request.query.channel as TaskChannel | undefined;
    if (status && !(TASK_STATUSES as readonly string[]).includes(status)) {
      return reply.code(400).send({ error: "无效的任务状态" });
    }
    if (channel && !(TASK_CHANNELS as readonly string[]).includes(channel)) {
      return reply.code(400).send({ error: "无效的执行通道" });
    }
    const limit = Number.parseInt(request.query.limit ?? "200", 10);
    return {
      tasks: database.listTasks({
        ...(request.query.batchId ? { batchId: request.query.batchId } : {}),
        ...(status ? { status } : {}),
        ...(channel ? { channel } : {}),
        limit: Number.isFinite(limit) ? limit : 200,
      }),
    };
  });

  app.post("/api/batches/import", async (request, reply) => {
    let file: Buffer | null = null;
    let filename = "import.xlsx";
    let defaultShopId = "";
    let defaultChannel: TaskChannel = "api";

    for await (const part of request.parts()) {
      if (part.type === "file") {
        filename = part.filename || filename;
        file = await part.toBuffer();
      } else if (part.fieldname === "shopId") {
        defaultShopId = text(part.value);
      } else if (part.fieldname === "channel") {
        const normalized = normalizeChannel(part.value);
        if (!normalized) return reply.code(400).send({ error: "channel 仅支持 api 或 extension" });
        defaultChannel = normalized;
      }
    }

    if (!file) return reply.code(400).send({ error: "请选择 Excel 或 CSV 文件" });
    const workbook = XLSX.read(file, { type: "buffer", cellText: true });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return reply.code(400).send({ error: "工作簿没有可读取的工作表" });
    const sheet = workbook.Sheets[firstSheet];
    if (!sheet) return reply.code(400).send({ error: "无法读取第一个工作表" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    if (rows.length === 0) return reply.code(400).send({ error: "文件没有数据行" });
    if (rows.length > 5_000) return reply.code(400).send({ error: "MVP 单批最多导入 5000 行" });

    const validation = validateImportRows(rows, {
      ...(defaultShopId ? { defaultShopId } : {}),
      defaultChannel,
    });
    const shopIds = new Set(database.listShops().map((shop) => shop.id));
    const validRows = [] as typeof validation.valid;
    const invalidRows: Array<{ sourceRow: number; issues: ImportIssue[] }> = validation.invalid.map(
      (row) => ({ sourceRow: row.sourceRow, issues: row.issues }),
    );
    for (const row of validation.valid) {
      if (shopIds.has(row.input.shopId)) {
        validRows.push(row);
      } else {
        invalidRows.push({
          sourceRow: row.input.sourceRow,
          issues: [
            {
              row: row.input.sourceRow,
              field: "shop_id",
              code: "invalid",
              message: `店铺不存在：${row.input.shopId}`,
            },
          ],
        });
      }
    }
    const batch = database.createBatch({
      filename,
      source: "excel",
      validRows,
      invalidRows,
      totalRows: rows.length,
    });
    return reply.code(201).send({ batch });
  });

  app.post<{ Params: { id: string } }>("/api/batches/:id/run", async (request, reply) => {
    if (!runner.configured) return reply.code(400).send({ error: "TikTok API 或 Token 加密配置不完整" });
    const started = runner.startBatch(request.params.id);
    return reply.code(started ? 202 : 200).send({ started, running: true });
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/retry", async (request, reply) => {
    const current = database.getTask(request.params.id);
    if (current?.status === "rejected") {
      return reply.code(409).send({
        error: "审核拒绝任务禁止直接重试；请先刷新商品与机会规则并重新匹配，避免重复拒绝",
      });
    }
    const task = database.requeueTask(request.params.id);
    if (!task) return reply.code(404).send({ error: "任务不存在" });
    return { task };
  });

  app.patch<{
    Params: { id: string };
    Body: { channel?: string };
  }>("/api/tasks/:id/channel", async (request, reply) => {
    const channel = request.body?.channel as TaskChannel | undefined;
    if (!channel || !(TASK_CHANNELS as readonly string[]).includes(channel)) {
      return reply.code(400).send({ error: "channel 仅支持 api 或 extension" });
    }
    const current = database.getTask(request.params.id);
    if (current?.status === "rejected") {
      return reply.code(409).send({
        error: "审核拒绝任务禁止直接切换通道重试；请先重新采集并匹配",
      });
    }
    const task = database.setTaskChannel(request.params.id, channel);
    if (!task) return reply.code(404).send({ error: "任务不存在或当前状态不允许切换通道" });
    return { task };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/sync", async (request, reply) => {
    if (!runner.configured) return reply.code(400).send({ error: "TikTok API 或 Token 加密配置不完整" });
    const task = await runner.syncTask(request.params.id);
    return { task };
  });

  app.get<{ Querystring: { batchId?: string } }>("/api/tasks/export.csv", async (request, reply) => {
    const tasks = database.listTasks({
      ...(request.query.batchId ? { batchId: request.query.batchId } : {}),
      limit: 5_000,
    });
    const header = [
      "task_id",
      "batch_id",
      "shop_id",
      "opportunity_id",
      "product_id",
      "channel",
      "status",
      "attempts",
      "submission_id",
      "request_id",
      "error_code",
      "error_message",
      "updated_at",
    ];
    const lines = [
      header.join(","),
      ...tasks.map((task) =>
        [
          task.id,
          task.batchId,
          task.shopId,
          task.opportunityId,
          task.productId,
          task.channel,
          task.status,
          task.attempts,
          task.submissionId,
          task.requestId,
          task.errorCode,
          task.errorMessage,
          task.updatedAt,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="tibao-results.csv"')
      .send(`\uFEFF${lines.join("\r\n")}`);
  });

  app.get("/api/import-template.csv", async (_request, reply) =>
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="tibao-import-template.csv"')
      .send("\uFEFFshop_id,opportunity_id,product_id,channel\r\n,OPPORTUNITY_ID,PRODUCT_ID,api\r\n"),
  );

  app.post<{
    Body: {
      shopId?: unknown;
      sourceUrl?: unknown;
      capturedAt?: unknown;
      products?: unknown;
    };
  }>("/api/extension/products/import", async (request, reply) => {
    if (!verifyExtension(request, reply, config)) return;
    const shopId = text(request.body?.shopId);
    if (!shopId || !database.getShop(shopId)) {
      return reply.code(400).send({ error: "请在插件设置中填写有效的本地店铺 ID" });
    }
    const sourceUrl = text(request.body?.sourceUrl);
    if (!isAllowedCaptureSource(sourceUrl)) {
      return reply.code(400).send({ error: "仅允许导入 Seller Center 或本地测试页采集的数据" });
    }
    const capturedRegion = captureRegionFromUrl(sourceUrl);
    if (capturedRegion) database.updateShopRegion(shopId, capturedRegion);
    const capturedAtText = text(request.body?.capturedAt);
    const capturedAt = capturedAtText || new Date().toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) {
      return reply.code(400).send({ error: "capturedAt 不是有效时间" });
    }

    let parsedProducts: CapturedProductInput[];
    try {
      parsedProducts = parseSnapshotArray(
        request.body?.products,
        "商品",
        parseCapturedProduct,
      );
    } catch (error) {
      if (error instanceof SnapshotValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
    if (parsedProducts.length === 0) {
      return reply.code(400).send({ error: "没有可导入的商品" });
    }
    const products = [...new Map(parsedProducts.map((product) => [product.id, product])).values()];
    const result = database.upsertCapturedProducts({
      shopId,
      sourceUrl,
      capturedAt,
      products,
    });
    return reply.code(201).send({ result });
  });

  app.post<{
    Body: {
      shopId?: unknown;
      sourceUrl?: unknown;
      capturedAt?: unknown;
      products?: unknown;
      opportunities?: unknown;
    };
  }>("/api/extension/snapshots/import", async (request, reply) => {
    if (!verifyExtension(request, reply, config)) return;
    const shopId = text(request.body?.shopId);
    if (!shopId || !database.getShop(shopId)) {
      return reply.code(400).send({ error: "请在插件设置中填写有效的本地店铺 ID" });
    }
    const sourceUrl = text(request.body?.sourceUrl);
    if (!isAllowedCaptureSource(sourceUrl)) {
      return reply.code(400).send({ error: "仅允许导入 Seller Center 或本地测试页采集的数据" });
    }
    const capturedRegion = captureRegionFromUrl(sourceUrl);
    if (capturedRegion) database.updateShopRegion(shopId, capturedRegion);
    const capturedAtText = text(request.body?.capturedAt);
    const capturedAt = capturedAtText || new Date().toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) {
      return reply.code(400).send({ error: "capturedAt 不是有效时间" });
    }
    let products: CapturedProductInput[];
    let opportunities: CapturedOpportunityInput[];
    try {
      products = parseSnapshotArray(request.body?.products, "商品", parseCapturedProduct);
      opportunities = parseSnapshotArray(
        request.body?.opportunities,
        "机会",
        parseCapturedOpportunity,
      );
    } catch (error) {
      if (error instanceof SnapshotValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
    if (products.length === 0 && opportunities.length === 0) {
      return reply.code(400).send({ error: "当前页没有可导入的商品或机会快照" });
    }
    const uniqueProducts = [
      ...new Map(products.map((product) => [product.id, product])).values(),
    ];
    const uniqueOpportunities = [
      ...new Map(opportunities.map((opportunity) => [opportunity.id, opportunity])).values(),
    ];
    const productResult = database.upsertCapturedProducts({
      shopId,
      sourceUrl,
      capturedAt,
      products: uniqueProducts,
    });
    const opportunityResult = database.upsertCapturedOpportunities({
      shopId,
      sourceUrl,
      capturedAt,
      opportunities: uniqueOpportunities,
    });
    return reply.code(201).send({
      result: { products: productResult, opportunities: opportunityResult },
    });
  });

  app.get<{
    Querystring: { shopId?: string; limit?: string };
  }>("/api/extension/products", async (request, reply) => {
    if (!verifyExtension(request, reply, config)) return;
    const shopId = text(request.query.shopId);
    if (!shopId || !database.getShop(shopId)) {
      return reply.code(400).send({ error: "shopId 无效" });
    }
    const limit = Number.parseInt(request.query.limit ?? "200", 10);
    return {
      products: database.listCapturedProducts(shopId, Number.isFinite(limit) ? limit : 200),
    };
  });

  app.get<{
    Querystring: { shopId?: string };
  }>("/api/extension/tasks/next", async (request, reply) => {
    if (!verifyExtension(request, reply, config)) return;
    for (let checked = 0; checked < 100; checked += 1) {
      const task = database.claimNextTask(
        "extension",
        config.taskLeaseMinutes,
        undefined,
        request.query.shopId,
      );
      if (!task) return reply.code(204).send();
      const validation = runner.validateCapturedTask(task);
      if (validation.safe) return { task };
      database.completeTask(task.id, {
        status: "paused",
        errorCode: "LOCAL_ELIGIBILITY_CHECK_FAILED",
        errorMessage: validation.message,
      });
    }
    return reply.code(409).send({
      error: "连续 100 条插件任务未通过安全复核，已暂停；请重新采集并匹配后再领取",
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      status?: "submitted" | "failed" | "ready";
      submissionId?: string;
      errorCode?: string;
      errorMessage?: string;
    };
  }>("/api/extension/tasks/:id/result", async (request, reply) => {
    if (!verifyExtension(request, reply, config)) return;
    const current = database.getTask(request.params.id);
    if (!current || current.channel !== "extension") {
      return reply.code(404).send({ error: "插件任务不存在" });
    }
    const status = request.body?.status;
    if (status === "ready") {
      if (current.status === "rejected") {
        return reply.code(409).send({
          error: "审核拒绝任务禁止直接放回队列；请重新采集并匹配",
        });
      }
      return { task: database.requeueTask(current.id, request.body) };
    }
    if (status !== "submitted" && status !== "failed") {
      return reply.code(400).send({ error: "status 仅支持 submitted、failed 或 ready" });
    }
    const task = database.completeTask(current.id, {
      status,
      submissionId: text(request.body.submissionId) || null,
      errorCode: text(request.body.errorCode) || null,
      errorMessage: text(request.body.errorMessage) || null,
    });
    return { task };
  });
}
