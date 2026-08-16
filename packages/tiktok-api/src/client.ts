import { TikTokApiError } from "./errors.js";
import { createTikTokSignature, type SignableValue } from "./signer.js";

export interface TikTokEnvelope<T> {
  code: number | string;
  message?: string;
  data?: T;
  request_id?: string;
}

export interface TikTokResponse<T> {
  data: T;
  requestId: string | undefined;
}

export interface TikTokClientOptions {
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopCipher: string;
  baseUrl?: string;
  productApiVersion?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, SignableValue>;
  body?: unknown;
}

type JsonObject = Record<string, unknown>;

export interface OpportunityQueryBody extends JsonObject {
  opportunity_type: "PRODUCT" | "KEYWORD" | "CATEGORY";
  category_ids?: string[];
  create_time_ge?: number;
  create_time_lt?: number;
}

export interface OpportunityQueryParameters extends Record<string, SignableValue> {
  page_size: number;
  page_token?: string;
  locale?: string;
}

export interface ProductSearchBody extends JsonObject {
  status?: string;
  product_ids?: string[];
  seller_skus?: string[];
}

export interface ProductSearchParameters extends Record<string, SignableValue> {
  page_size: number;
  page_token?: string;
}

export interface SubmissionRecord extends JsonObject {
  id: string;
  opportunity_id: string;
  product_id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | string;
  rejection_reason?: string | null;
}

export interface SubmitProductData extends JsonObject {
  submission: SubmissionRecord;
}

export interface SubmissionRecordsData extends JsonObject {
  data: {
    submissions: SubmissionRecord[];
    next_page_token?: string;
    total_count?: number;
  };
}

export class TikTokShopClient {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly accessToken: string;
  private readonly shopCipher: string;
  private readonly baseUrl: string;
  private readonly productApiVersion: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(options: TikTokClientOptions) {
    this.appKey = options.appKey;
    this.appSecret = options.appSecret;
    this.accessToken = options.accessToken;
    this.shopCipher = options.shopCipher;
    this.baseUrl = options.baseUrl ?? "https://open-api.tiktokglobalshop.com";
    this.productApiVersion = /^\d{6}$/.test(options.productApiVersion ?? "")
      ? (options.productApiVersion as string)
      : "202309";
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async request<T>(options: RequestOptions): Promise<TikTokResponse<T>> {
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const query: Record<string, SignableValue> = {
      app_key: this.appKey,
      shop_cipher: this.shopCipher,
      timestamp: Math.floor(this.now() / 1000),
      ...options.query,
    };
    query.sign = createTikTokSignature({
      appSecret: this.appSecret,
      path: options.path,
      query,
      body,
    });

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) search.set(key, String(value));
    }
    const url = `${this.baseUrl}${options.path}?${search.toString()}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: options.method,
        headers: {
          "content-type": "application/json",
          "x-tts-access-token": this.accessToken,
        },
        ...(body ? { body } : {}),
      });
    } catch (error) {
      throw new TikTokApiError("TikTok API 网络请求失败", {
        code: "NETWORK_ERROR",
        httpStatus: 0,
        retryable: true,
        cause: error,
      });
    }

    const headerRequestId = response.headers.get("x-tts-request-id") ?? undefined;
    let envelope: TikTokEnvelope<T>;
    try {
      envelope = (await response.json()) as TikTokEnvelope<T>;
    } catch (error) {
      throw new TikTokApiError(`TikTok API 返回了非 JSON 响应（HTTP ${response.status}）`, {
        code: "INVALID_RESPONSE",
        httpStatus: response.status,
        requestId: headerRequestId,
        cause: error,
      });
    }

    const requestId = envelope.request_id ?? headerRequestId;
    if (!response.ok || String(envelope.code) !== "0") {
      throw new TikTokApiError(envelope.message || `TikTok API 请求失败（HTTP ${response.status}）`, {
        code: String(envelope.code ?? response.status),
        httpStatus: response.status,
        requestId,
      });
    }

    return { data: (envelope.data ?? {}) as T, requestId };
  }

  searchProducts(
    body: ProductSearchBody = {},
    query: ProductSearchParameters = { page_size: 50 },
  ): Promise<TikTokResponse<JsonObject>> {
    return this.request({
      method: "POST",
      path: `/product/${this.productApiVersion}/products/search`,
      query,
      body,
    });
  }

  getProduct(productId: string): Promise<TikTokResponse<JsonObject>> {
    return this.request({
      method: "GET",
      path: `/product/${this.productApiVersion}/products/${encodeURIComponent(productId)}`,
    });
  }

  queryOpportunities(
    body: OpportunityQueryBody = { opportunity_type: "PRODUCT" },
    query: OpportunityQueryParameters = { page_size: 20 },
  ): Promise<TikTokResponse<JsonObject>> {
    return this.request({
      method: "POST",
      path: "/product/202604/opportunities/query",
      query,
      body,
    });
  }

  getOpportunity(opportunityId: string): Promise<TikTokResponse<JsonObject>> {
    return this.request({
      method: "GET",
      path: `/product/202604/opportunities/${encodeURIComponent(opportunityId)}`,
    });
  }

  submitProduct(opportunityId: string, productId: string): Promise<TikTokResponse<SubmitProductData>> {
    return this.request({
      method: "POST",
      path: `/product/202604/opportunities/${encodeURIComponent(opportunityId)}/submit`,
      body: { product_id: productId },
    });
  }

  getSubmissionRecords(
    query: Record<string, SignableValue> = { page_size: 100 },
  ): Promise<TikTokResponse<SubmissionRecordsData>> {
    return this.request({
      method: "GET",
      path: "/product/202604/opportunities/submissions",
      query,
    });
  }
}
