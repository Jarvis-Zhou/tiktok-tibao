import type {
  OpportunitySnapshot,
  ProductOpportunityMatch,
  ProductSnapshot,
  TaskChannel,
  TaskRecord,
  TaskStatus,
} from "@tibao/core";
import {
  extractNextPageToken,
  extractOpportunityRecords,
  extractProductRecords,
  normalizeOpportunity,
  normalizeProduct,
  normalizeReviewStatus,
  scoreOpportunityMatch,
} from "@tibao/core";
import { TikTokApiError, TikTokShopClient } from "@tibao/tiktok-api";
import type { AppConfig } from "./config.js";
import { isTikTokAppConfigured } from "./config.js";
import type { TibaoDatabase, ShopPrivate } from "./database.js";
import type { TokenVault } from "./token-vault.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stringField(value: unknown, names: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const name of names) {
    const candidate = object[name];
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
  }
  return null;
}

function recordArrays(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of ["submissions", "submission_records", "records", "items", "list"]) {
    const candidate = object[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    }
  }
  if (object.data && typeof object.data === "object") return recordArrays(object.data);
  return [];
}

function mergeOpportunity(
  summary: OpportunitySnapshot,
  detail: OpportunitySnapshot,
): OpportunitySnapshot {
  return {
    id: detail.id || summary.id,
    title: detail.title && detail.title !== detail.id ? detail.title : summary.title,
    type: detail.type || summary.type,
    requirementsVerified: detail.requirementsVerified,
    status: detail.status ?? summary.status,
    active: detail.active ?? summary.active,
    expired: detail.expired || summary.expired,
    fulfilled: detail.fulfilled || summary.fulfilled,
    categoryIds: detail.categoryIds.length > 0 ? detail.categoryIds : summary.categoryIds,
    categoryNames: detail.categoryNames.length > 0 ? detail.categoryNames : summary.categoryNames,
    brandNames: detail.brandNames.length > 0 ? detail.brandNames : summary.brandNames,
    keywords: detail.keywords.length > 0 ? detail.keywords : summary.keywords,
    allowedProductStatuses:
      detail.allowedProductStatuses.length > 0
        ? detail.allowedProductStatuses
        : summary.allowedProductStatuses,
    referencePrice: detail.referencePrice ?? summary.referencePrice,
    minPrice: detail.minPrice ?? summary.minPrice,
    maxPrice: detail.maxPrice ?? summary.maxPrice,
    currency: detail.currency ?? summary.currency,
  };
}

export interface ProductPageResult {
  products: ProductSnapshot[];
  nextPageToken: string | null;
  requestId: string | null;
}

export interface ProductMatchResult {
  products: ProductSnapshot[];
  matches: ProductOpportunityMatch[];
  opportunityCount: number;
  candidatePairCount: number;
  blockedPairCount: number;
  warnings: string[];
}

export interface MatchSelectionInput {
  productId: string;
  opportunityId: string;
  channel: TaskChannel;
}

export interface MatchSelectionValidation {
  safe: boolean;
  issues: Array<MatchSelectionInput & { message: string }>;
}

export interface CapturedTaskValidation {
  safe: boolean;
  message: string;
}

function matchPairKey(productId: string, opportunityId: string): string {
  return `${productId.trim().toLowerCase()}\u001f${opportunityId.trim().toLowerCase()}`;
}

export class ApiRunner {
  private readonly runningBatches = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly database: TibaoDatabase,
    private readonly vault: TokenVault,
  ) {}

  get configured(): boolean {
    return isTikTokAppConfigured(this.config) && this.vault.available;
  }

  private async readRequest<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      await sleep(this.config.matchReadIntervalMs);
    }
  }

  async testShop(shopId: string): Promise<unknown> {
    const client = this.clientForShopId(shopId);
    return this.readRequest(() =>
      client.queryOpportunities({ opportunity_type: "PRODUCT" }, { page_size: 1 }),
    );
  }

  async listProducts(
    shopId: string,
    input: { pageSize?: number; pageToken?: string } = {},
  ): Promise<ProductPageResult> {
    const client = this.clientForShopId(shopId);
    const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
    const response = await this.readRequest(() =>
      client.searchProducts(
        {},
        {
          page_size: pageSize,
          ...(input.pageToken ? { page_token: input.pageToken } : {}),
        },
      ),
    );
    const products = extractProductRecords(response.data)
      .map((record) => normalizeProduct(record))
      .filter((product) => Boolean(product.id));
    return {
      products,
      nextPageToken: extractNextPageToken(response.data),
      requestId: response.requestId ?? null,
    };
  }

  async matchProducts(shopId: string, productIds: string[]): Promise<ProductMatchResult> {
    const uniqueProductIds = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueProductIds.length === 0) throw new Error("至少选择一个商品");
    if (uniqueProductIds.length > 20) throw new Error("MVP 单次最多匹配 20 个商品");

    const client = this.clientForShopId(shopId);
    const products: ProductSnapshot[] = [];
    const warnings: string[] = [];
    for (const productId of uniqueProductIds) {
      try {
        const response = await this.readRequest(() => client.getProduct(productId));
        const product = normalizeProduct(response.data, productId);
        if (product.id) products.push(product);
      } catch (error) {
        warnings.push(
          `商品 ${productId} 读取失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (products.length === 0) throw new Error("未能读取任何已选商品详情");

    const opportunityTypes = ["PRODUCT", "KEYWORD", "CATEGORY"] as const;
    const summariesByProduct = new Map<string, Map<string, OpportunitySnapshot>>();
    const queryCache = new Map<string, OpportunitySnapshot[]>();
    for (const product of products) {
      const summaries = new Map<string, OpportunitySnapshot>();
      const leafCategoryId = product.categoryIds.at(-1);
      for (const opportunityType of opportunityTypes) {
        const cacheKey = `${opportunityType}:${leafCategoryId ?? "all"}`;
        let queried = queryCache.get(cacheKey);
        if (!queried) {
          try {
            const response = await this.readRequest(() =>
              client.queryOpportunities(
                {
                  opportunity_type: opportunityType,
                  ...(leafCategoryId ? { category_ids: [leafCategoryId] } : {}),
                },
                { page_size: 20 },
              ),
            );
            queried = extractOpportunityRecords(response.data)
              .map((record) => normalizeOpportunity(record))
              .filter((opportunity) => Boolean(opportunity.id));
            queryCache.set(cacheKey, queried);
          } catch (error) {
            queried = [];
            queryCache.set(cacheKey, queried);
            warnings.push(
              `${product.id} 的 ${opportunityType} 机会读取失败：${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        let addedForType = 0;
        for (const opportunity of queried) {
          if (!summaries.has(opportunity.id)) {
            summaries.set(opportunity.id, opportunity);
            addedForType += 1;
          }
          if (addedForType >= 5) break;
        }
      }
      summariesByProduct.set(product.id, summaries);
    }

    const summaryByOpportunity = new Map<string, OpportunitySnapshot>();
    for (const summaries of summariesByProduct.values()) {
      for (const [id, summary] of summaries) {
        if (!summaryByOpportunity.has(id)) summaryByOpportunity.set(id, summary);
      }
    }
    const opportunityIds = [...summaryByOpportunity.keys()].slice(0, 60);
    const details = new Map<string, OpportunitySnapshot>();
    let detailFailures = 0;
    for (const opportunityId of opportunityIds) {
      const summary = summaryByOpportunity.get(opportunityId);
      if (!summary) continue;
      try {
        const response = await this.readRequest(() => client.getOpportunity(opportunityId));
        details.set(
          opportunityId,
          mergeOpportunity(summary, normalizeOpportunity(response.data, opportunityId)),
        );
      } catch {
        detailFailures += 1;
      }
    }
    if (detailFailures > 0) {
      warnings.push(`${detailFailures} 个机会详情读取失败，因无法验证完整提报要求已排除`);
    }

    const priorByProduct = new Map<string, Set<string>>();
    for (const product of products) {
      const prior = new Set(this.database.existingOpportunityIds(shopId, product.id));
      try {
        const response = await this.readRequest(() =>
          client.getSubmissionRecords({ product_id: product.id, page_size: 100 }),
        );
        for (const record of recordArrays(response.data)) {
          const opportunityId = stringField(record, ["opportunity_id", "opportunityId"]);
          if (opportunityId) prior.add(opportunityId);
        }
      } catch (error) {
        warnings.push(
          `${product.id} 的历史提报记录读取失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      priorByProduct.set(product.id, prior);
    }

    const matches: ProductOpportunityMatch[] = [];
    let candidatePairCount = 0;
    let blockedPairCount = 0;
    for (const product of products) {
      const productMatches: ProductOpportunityMatch[] = [];
      const summaries = summariesByProduct.get(product.id) ?? new Map();
      for (const opportunityId of summaries.keys()) {
        candidatePairCount += 1;
        const opportunity = details.get(opportunityId);
        if (!opportunity) {
          blockedPairCount += 1;
          continue;
        }
        const match = scoreOpportunityMatch(product, opportunity, {
          priorSubmitted: priorByProduct.get(product.id)?.has(opportunityId) ?? false,
        });
        if (match.eligible) productMatches.push(match);
        else blockedPairCount += 1;
      }
      productMatches.sort((left, right) => right.score - left.score);
      matches.push(...productMatches.slice(0, 8));
    }

    return {
      products,
      matches,
      opportunityCount: summaryByOpportunity.size,
      candidatePairCount,
      blockedPairCount,
      warnings,
    };
  }

  async validateMatchSelections(
    shopId: string,
    selections: MatchSelectionInput[],
  ): Promise<MatchSelectionValidation> {
    const issues: MatchSelectionValidation["issues"] = [];
    for (const channel of ["api", "extension"] as const) {
      const channelSelections = selections.filter((selection) => selection.channel === channel);
      if (channelSelections.length === 0) continue;
      const productIds = [...new Set(channelSelections.map((selection) => selection.productId))];
      if (productIds.length > 20) {
        issues.push(
          ...channelSelections.map((selection) => ({
            ...selection,
            message: "安全复核单次最多支持 20 个商品",
          })),
        );
        continue;
      }

      let result: ProductMatchResult;
      try {
        result = channel === "api"
          ? await this.matchProducts(shopId, productIds)
          : this.matchCapturedProducts(shopId, productIds);
      } catch (error) {
        const message = error instanceof Error ? error.message : "匹配结果安全复核失败";
        issues.push(...channelSelections.map((selection) => ({ ...selection, message })));
        continue;
      }

      const safePairs = new Set(
        result.matches
          .filter((match) => match.eligible && match.recommended && match.confidence === "high")
          .map((match) => matchPairKey(match.product.id, match.opportunity.id)),
      );
      for (const selection of channelSelections) {
        if (safePairs.has(matchPairKey(selection.productId, selection.opportunityId))) continue;
        issues.push({
          ...selection,
          message: "该商品—机会组合未通过最新完整规则、高置信度或重复提报检查",
        });
      }
    }
    return { safe: issues.length === 0, issues };
  }

  validateCapturedTask(
    task: Pick<TaskRecord, "shopId" | "productId" | "opportunityId">,
  ): CapturedTaskValidation {
    const product = this.database.getCapturedProducts(task.shopId, [task.productId])[0];
    const opportunity = this.database.getCapturedOpportunity(task.shopId, task.opportunityId);
    if (!product || !opportunity) {
      return {
        safe: false,
        message: "缺少该商品或机会的插件快照，请重新采集后再匹配",
      };
    }
    const oldestAllowed = Date.now() - 24 * 60 * 60 * 1_000;
    const productCapturedAt = Date.parse(product.capturedAt);
    const opportunityCapturedAt = Date.parse(opportunity.capturedAt);
    if (
      !Number.isFinite(productCapturedAt) ||
      !Number.isFinite(opportunityCapturedAt) ||
      productCapturedAt < oldestAllowed ||
      opportunityCapturedAt < oldestAllowed
    ) {
      return {
        safe: false,
        message: "商品或机会快照已超过 24 小时，请刷新 Seller Center 并重新采集匹配",
      };
    }
    const match = scoreOpportunityMatch(product, opportunity);
    if (!match.eligible || !match.recommended || match.confidence !== "high") {
      return {
        safe: false,
        message: `插件执行前安全复核未通过：${match.blockers.join("；") || `匹配分 ${match.score}`}`,
      };
    }
    return { safe: true, message: "安全复核通过" };
  }

  matchCapturedProducts(shopId: string, productIds: string[]): ProductMatchResult {
    const uniqueProductIds = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueProductIds.length === 0) throw new Error("至少选择一个商品");
    if (uniqueProductIds.length > 20) throw new Error("MVP 单次最多匹配 20 个商品");

    const products = this.database.getCapturedProducts(shopId, uniqueProductIds);
    const foundProductIds = new Set(products.map((product) => product.id));
    const missingProductIds = uniqueProductIds.filter((id) => !foundProductIds.has(id));
    if (products.length === 0) {
      throw new Error("已选商品尚未由 Chrome 插件采集，请先在商品管理页读取并导入快照");
    }

    const opportunities = this.database.listCapturedOpportunities(shopId);
    if (opportunities.length === 0) {
      throw new Error("尚未采集到机会，请先打开 Seller Center 商品机会页，用插件读取并导入快照");
    }

    const warnings = [
      "匹配基于 Chrome 插件采集到本地的 Seller Center 快照；刷新页面并重新导入可更新数据。",
      "仅包含可验证提报规则且达到高置信度的组合会进入候选；旧版或缺规则快照会被排除。",
      "未调用官方 API，因此平台侧历史提报记录无法查询；已使用本地任务台账排除重复组合。",
    ];
    if (missingProductIds.length > 0) {
      warnings.push(`以下商品没有本地快照，已跳过：${missingProductIds.join("、")}`);
    }

    const matches: ProductOpportunityMatch[] = [];
    let candidatePairCount = 0;
    let blockedPairCount = 0;
    for (const product of products) {
      const prior = new Set(this.database.existingOpportunityIds(shopId, product.id));
      const productMatches: ProductOpportunityMatch[] = [];
      for (const opportunity of opportunities) {
        candidatePairCount += 1;
        const match = scoreOpportunityMatch(product, opportunity, {
          priorSubmitted: prior.has(opportunity.id),
        });
        if (match.eligible) productMatches.push(match);
        else blockedPairCount += 1;
      }
      productMatches.sort((left, right) => right.score - left.score);
      matches.push(...productMatches.slice(0, 8));
    }

    return {
      products,
      matches,
      opportunityCount: opportunities.length,
      candidatePairCount,
      blockedPairCount,
      warnings,
    };
  }

  startBatch(batchId: string): boolean {
    // MVP deliberately runs one API queue globally to avoid accidental bursts
    // when an operator starts several batches at once.
    if (this.runningBatches.size > 0) return false;
    this.runningBatches.add(batchId);
    void this.runBatch(batchId)
      .catch((error) => {
        console.error("API batch runner stopped unexpectedly", error);
      })
      .finally(() => this.runningBatches.delete(batchId));
    return true;
  }

  isBatchRunning(batchId: string): boolean {
    return this.runningBatches.has(batchId);
  }

  private async runBatch(batchId: string): Promise<void> {
    while (true) {
      const task = this.database.claimNextTask("api", this.config.taskLeaseMinutes, batchId);
      if (!task) return;
      await this.executeTask(task);
      await sleep(this.config.apiMinIntervalMs);
    }
  }

  private async executeTask(task: TaskRecord): Promise<void> {
    let client: TikTokShopClient;
    try {
      client = this.clientForShopId(task.shopId);
      const productResponse = await this.readRequest(() => client.getProduct(task.productId));
      const opportunityResponse = await this.readRequest(() =>
        client.getOpportunity(task.opportunityId),
      );
      const product = normalizeProduct(productResponse.data, task.productId);
      const opportunity = normalizeOpportunity(opportunityResponse.data, task.opportunityId);
      const match = scoreOpportunityMatch(product, opportunity);
      if (!match.eligible || !match.recommended || match.confidence !== "high") {
        this.database.completeTask(task.id, {
          status: "paused",
          errorCode: "LOCAL_ELIGIBILITY_CHECK_FAILED",
          errorMessage: `提报前安全复核未通过：${match.blockers.join("；") || `匹配分 ${match.score}`}`,
        });
        return;
      }
    } catch (error) {
      this.database.completeTask(task.id, {
        status: "paused",
        errorCode: "LOCAL_ELIGIBILITY_CHECK_UNAVAILABLE",
        errorMessage: `提报前无法完成商品与机会要求复核，未调用提报接口：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    try {
      const response = await client.submitProduct(task.opportunityId, task.productId);
      const submissionId = stringField(response.data.submission, ["id"]);
      const responseStatus = normalizeReviewStatus(response.data.submission.status);
      this.database.completeTask(task.id, {
        status: responseStatus ?? "submitted",
        submissionId,
        requestId: response.requestId ?? null,
      });
    } catch (error) {
      const apiError = error instanceof TikTokApiError ? error : null;
      const code = apiError?.code ?? "UNEXPECTED_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      if (apiError?.retryable && task.attempts < this.config.apiMaxAttempts) {
        this.database.requeueTask(task.id, { errorCode: code, errorMessage: message });
        const backoff = Math.min(2 ** Math.max(task.attempts - 1, 0) * 1_000, 10_000);
        await sleep(backoff);
        return;
      }
      this.database.completeTask(task.id, {
        status: "failed",
        errorCode: code,
        errorMessage: message,
        requestId: apiError?.requestId ?? null,
      });
    }
  }

  async syncTask(taskId: string): Promise<TaskRecord> {
    const task = this.database.getTask(taskId);
    if (!task) throw new Error("任务不存在");
    const client = this.clientForShopId(task.shopId);
    const response = await client.getSubmissionRecords({
      opportunity_id: task.opportunityId,
      product_id: task.productId,
      page_size: 100,
    });
    const records = recordArrays(response.data);
    const record = records.find((item) => {
      const productId = stringField(item, ["product_id", "productId"]);
      const opportunityId = stringField(item, ["opportunity_id", "opportunityId"]);
      return productId === task.productId && (!opportunityId || opportunityId === task.opportunityId);
    });
    if (!record) return task;
    const reviewStatus = normalizeReviewStatus(record.status ?? record.submission_status);
    if (!reviewStatus) return task;
    const status: TaskStatus = reviewStatus;
    return (
      this.database.completeTask(task.id, {
        status,
        submissionId: stringField(record, ["submission_id", "id"]),
        requestId: response.requestId ?? null,
        errorCode: status === "rejected" ? stringField(record, ["reject_code", "reason_code"]) : null,
        errorMessage:
          status === "rejected"
            ? stringField(record, ["rejection_reason", "reject_reason", "reason"])
            : null,
      }) ?? task
    );
  }

  private clientForShopId(shopId: string): TikTokShopClient {
    if (!isTikTokAppConfigured(this.config)) {
      throw new Error("TIKTOK_APP_KEY / TIKTOK_APP_SECRET 未配置");
    }
    if (!this.vault.available) throw new Error("TOKEN_ENCRYPTION_KEY 未配置");
    const shop = this.database.getShop(shopId);
    if (!shop) throw new Error(`店铺不存在：${shopId}`);
    if (!shop.apiConfigured || !shop.encryptedAccessToken) {
      throw new Error(`店铺未配置 API 凭证：${shopId}`);
    }
    return this.clientForShop(shop);
  }

  private clientForShop(shop: ShopPrivate): TikTokShopClient {
    return new TikTokShopClient({
      appKey: this.config.tiktokAppKey,
      appSecret: this.config.tiktokAppSecret,
      accessToken: this.vault.decrypt(shop.encryptedAccessToken),
      shopCipher: shop.shopCipher,
      baseUrl: this.config.tiktokApiBaseUrl,
      productApiVersion: this.config.tiktokProductApiVersion,
    });
  }
}
