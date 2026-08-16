import { TikTokApiError } from "./errors.js";
import { createTikTokSignature, type SignableValue } from "./signer.js";
import type { TikTokEnvelope, TikTokResponse } from "./client.js";

export interface TikTokOAuthTokenData {
  access_token: string;
  access_token_expire_in?: number;
  refresh_token?: string;
  refresh_token_expire_in?: number;
  open_id?: string;
  seller_name?: string;
  seller_base_region?: string;
  user_type?: number;
  granted_permissions?: string[];
  granted_scopes?: string[];
}

export interface TikTokAuthorizedShop {
  cipher: string;
  code?: string;
  id?: string;
  name?: string;
  region?: string;
  seller_type?: string;
}

export interface TikTokAuthorizedShopsData {
  shops: TikTokAuthorizedShop[];
}

export interface TikTokShopAuthClientOptions {
  appKey: string;
  appSecret: string;
  authBaseUrl?: string;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export class TikTokShopAuthClient {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly authBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(options: TikTokShopAuthClientOptions) {
    this.appKey = options.appKey;
    this.appSecret = options.appSecret;
    this.authBaseUrl = trimTrailingSlash(
      options.authBaseUrl ?? "https://auth.tiktok-shops.com",
    );
    this.apiBaseUrl = trimTrailingSlash(
      options.apiBaseUrl ?? "https://open-api.tiktokglobalshop.com",
    );
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  createAuthorizationUrl(state: string): string {
    const normalizedState = state.trim();
    if (!normalizedState) throw new Error("OAuth state 不能为空");
    const url = new URL(`${this.authBaseUrl}/oauth/authorize`);
    url.searchParams.set("app_key", this.appKey);
    url.searchParams.set("state", normalizedState);
    return url.toString();
  }

  async exchangeCode(authCode: string): Promise<TikTokResponse<TikTokOAuthTokenData>> {
    const normalizedCode = authCode.trim();
    if (!normalizedCode) throw new Error("OAuth auth_code 不能为空");
    const url = new URL(`${this.authBaseUrl}/api/v2/token/get`);
    url.searchParams.set("app_key", this.appKey);
    url.searchParams.set("app_secret", this.appSecret);
    url.searchParams.set("auth_code", normalizedCode);
    url.searchParams.set("grant_type", "authorized_code");
    const result = await this.get<TikTokOAuthTokenData>(url);
    if (!result.data.access_token) {
      throw new TikTokApiError("TikTok OAuth 响应缺少 access_token", {
        code: "INVALID_RESPONSE",
        httpStatus: 200,
        requestId: result.requestId,
      });
    }
    return result;
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<TikTokResponse<TikTokOAuthTokenData>> {
    const normalizedToken = refreshToken.trim();
    if (!normalizedToken) throw new Error("OAuth refresh_token 不能为空");
    const url = new URL(`${this.authBaseUrl}/api/v2/token/refresh`);
    url.searchParams.set("app_key", this.appKey);
    url.searchParams.set("app_secret", this.appSecret);
    url.searchParams.set("refresh_token", normalizedToken);
    url.searchParams.set("grant_type", "refresh_token");
    const result = await this.get<TikTokOAuthTokenData>(url);
    if (!result.data.access_token) {
      throw new TikTokApiError("TikTok OAuth 刷新响应缺少 access_token", {
        code: "INVALID_RESPONSE",
        httpStatus: 200,
        requestId: result.requestId,
      });
    }
    return result;
  }

  listAuthorizedShops(
    accessToken: string,
  ): Promise<TikTokResponse<TikTokAuthorizedShopsData>> {
    const path = "/authorization/202309/shops";
    const query: Record<string, SignableValue> = {
      app_key: this.appKey,
      timestamp: Math.floor(this.now() / 1000),
    };
    query.sign = createTikTokSignature({
      appSecret: this.appSecret,
      path,
      query,
    });
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return this.get<TikTokAuthorizedShopsData>(url, {
      "x-tts-access-token": accessToken,
    });
  }

  private async get<T>(url: URL, headers: Record<string, string> = {}): Promise<TikTokResponse<T>> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { method: "GET", headers });
    } catch (error) {
      throw new TikTokApiError("TikTok OAuth 网络请求失败", {
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
      throw new TikTokApiError(`TikTok OAuth 返回了非 JSON 响应（HTTP ${response.status}）`, {
        code: "INVALID_RESPONSE",
        httpStatus: response.status,
        requestId: headerRequestId,
        cause: error,
      });
    }

    const requestId = envelope.request_id ?? headerRequestId;
    if (!response.ok || String(envelope.code) !== "0") {
      throw new TikTokApiError(envelope.message || `TikTok OAuth 请求失败（HTTP ${response.status}）`, {
        code: String(envelope.code ?? response.status),
        httpStatus: response.status,
        requestId,
      });
    }
    return { data: (envelope.data ?? {}) as T, requestId };
  }
}
