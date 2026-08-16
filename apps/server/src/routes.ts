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
import type { AppConfig } from "./config.js";
import { isTikTokAppConfigured } from "./config.js";
import type { CapturedProductInput, TibaoDatabase } from "./database.js";
import type { ApiRunner } from "./runner.js";
import type { TokenVault } from "./token-vault.js";

export interface RouteDependencies {
  config: AppConfig;
  database: TibaoDatabase;
  vault: TokenVault;
  runner: ApiRunner;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function csvCell(value: unknown): string {
  const string = String(value ?? "");
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
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

export async function registerRoutes(app: FastifyInstance, deps: RouteDependencies): Promise<void> {
  const { config, database, vault, runner } = deps;

  app.get("/api/health", async () => ({
    ok: true,
    apiConfigured: isTikTokAppConfigured(config) && vault.available,
    appCredentialsConfigured: isTikTokAppConfigured(config),
    tokenEncryptionConfigured: vault.available,
    extensionConfigured: Boolean(config.extensionSharedKey),
    expiredLeasesRecovered: database.resetExpiredLeases(),
  }));

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
    const shop = accessToken
      ? database.createShop({
          name,
          shopCipher,
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
    const pageSize = Number.parseInt(request.query.pageSize ?? "50", 10);
    const normalizedPageSize = Number.isFinite(pageSize) ? pageSize : 50;
    const useCaptured =
      source === "extension" ||
      (source === "auto" && (!runner.configured || !shop.apiConfigured));
    if (useCaptured) {
      const products = database
        .listCapturedProducts(request.params.id, normalizedPageSize)
        .map((product) => ({
          ...product,
          categoryIds: [],
          keywords: [],
          attributes: [],
        }));
      return {
        products,
        nextPageToken: null,
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
    return { ...result, source: "api" as const };
  });

  app.post<{
    Body: { shopId?: string; productIds?: unknown };
  }>("/api/opportunity-matches", async (request, reply) => {
    if (!runner.configured) {
      return reply.code(400).send({ error: "TikTok API 或 Token 加密配置不完整" });
    }
    const shopId = text(request.body?.shopId);
    const productIds = Array.isArray(request.body?.productIds)
      ? request.body.productIds.map(text).filter(Boolean)
      : [];
    if (!shopId || !database.getShop(shopId)) {
      return reply.code(400).send({ error: "请选择有效店铺" });
    }
    if (productIds.length === 0) {
      return reply.code(400).send({ error: "至少选择一个商品" });
    }
    if (productIds.length > 20) {
      return reply.code(400).send({ error: "MVP 单次最多匹配 20 个商品" });
    }
    return runner.matchProducts(shopId, productIds);
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
    return reply.code(201).send({ batch, started });
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
      products?: Array<{
        id?: unknown;
        title?: unknown;
        status?: unknown;
        categoryName?: unknown;
        brandName?: unknown;
        price?: unknown;
        currency?: unknown;
        stock?: unknown;
      }>;
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
    const rawProducts = request.body?.products;
    if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
      return reply.code(400).send({ error: "没有可导入的商品" });
    }
    if (rawProducts.length > 200) {
      return reply.code(400).send({ error: "当前页单次最多导入 200 个商品" });
    }
    const capturedAtText = text(request.body?.capturedAt);
    const capturedAt = capturedAtText || new Date().toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) {
      return reply.code(400).send({ error: "capturedAt 不是有效时间" });
    }

    const products = new Map<string, CapturedProductInput>();
    for (const [index, raw] of rawProducts.entries()) {
      const id = text(raw?.id);
      const title = text(raw?.title) || id;
      const status = text(raw?.status);
      const categoryName = text(raw?.categoryName);
      const brandName = text(raw?.brandName);
      const currency = text(raw?.currency).toUpperCase();
      if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) {
        return reply.code(400).send({ error: `第 ${index + 1} 个商品 ID 无效` });
      }
      if (title.length > 500 || status.length > 100 || categoryName.length > 300 || brandName.length > 200) {
        return reply.code(400).send({ error: `第 ${index + 1} 个商品文本字段过长` });
      }
      if (currency && !/^[A-Z]{3}$/.test(currency)) {
        return reply.code(400).send({ error: `第 ${index + 1} 个商品币种无效` });
      }
      const price = raw.price === null || raw.price === undefined ? null : raw.price;
      const stock = raw.stock === null || raw.stock === undefined ? null : raw.stock;
      if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) {
        return reply.code(400).send({ error: `第 ${index + 1} 个商品价格无效` });
      }
      if (
        stock !== null &&
        (typeof stock !== "number" || !Number.isSafeInteger(stock) || stock < 0)
      ) {
        return reply.code(400).send({ error: `第 ${index + 1} 个商品库存无效` });
      }
      products.set(id, {
        id,
        title,
        status: status || null,
        categoryName: categoryName || null,
        brandName: brandName || null,
        price,
        currency: currency || null,
        stock,
      });
    }
    const result = database.upsertCapturedProducts({
      shopId,
      sourceUrl,
      capturedAt,
      products: [...products.values()],
    });
    return reply.code(201).send({ result });
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
    const task = database.claimNextTask(
      "extension",
      config.taskLeaseMinutes,
      undefined,
      request.query.shopId,
    );
    if (!task) return reply.code(204).send();
    return { task };
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
