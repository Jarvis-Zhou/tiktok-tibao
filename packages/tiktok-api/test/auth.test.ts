import assert from "node:assert/strict";
import test from "node:test";
import { createTikTokSignature, TikTokShopAuthClient } from "../src/index.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", "x-tts-request-id": "header-request" },
  });
}

test("builds a state-protected TikTok Shop authorization URL", () => {
  const client = new TikTokShopAuthClient({
    appKey: "app-key",
    appSecret: "app-secret",
  });
  const url = new URL(client.createAuthorizationUrl("oauth-state"));
  assert.equal(url.origin, "https://auth.tiktok-shops.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("app_key"), "app-key");
  assert.equal(url.searchParams.get("state"), "oauth-state");
});

test("exchanges the callback code and lists shops without requiring shop_cipher", async () => {
  const requests: Array<{ url: URL; headers: Headers }> = [];
  const now = 1_710_000_000_000;
  const client = new TikTokShopAuthClient({
    appKey: "app-key",
    appSecret: "app-secret",
    authBaseUrl: "https://auth.example.test/",
    apiBaseUrl: "https://api.example.test/",
    now: () => now,
    fetchFn: async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
      if (requests.length === 1) {
        return jsonResponse({
          code: 0,
          data: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            seller_base_region: "MX",
          },
          request_id: "token-request",
        });
      }
      return jsonResponse({
        code: 0,
        data: {
          shops: [{ cipher: "mx-cipher", name: "MX Shop", region: "MX" }],
        },
        request_id: "shops-request",
      });
    },
  });

  const token = await client.exchangeCode("callback-code");
  const shops = await client.listAuthorizedShops(token.data.access_token);

  const tokenUrl = requests[0]?.url;
  assert.equal(tokenUrl?.pathname, "/api/v2/token/get");
  assert.equal(tokenUrl?.searchParams.get("app_key"), "app-key");
  assert.equal(tokenUrl?.searchParams.get("app_secret"), "app-secret");
  assert.equal(tokenUrl?.searchParams.get("auth_code"), "callback-code");
  assert.equal(tokenUrl?.searchParams.get("grant_type"), "authorized_code");

  const shopsUrl = requests[1]?.url;
  assert.equal(shopsUrl?.pathname, "/authorization/202309/shops");
  assert.equal(shopsUrl?.searchParams.get("shop_cipher"), null);
  assert.equal(shopsUrl?.searchParams.get("timestamp"), "1710000000");
  assert.equal(requests[1]?.headers.get("x-tts-access-token"), "access-token");
  const expectedSign = createTikTokSignature({
    appSecret: "app-secret",
    path: "/authorization/202309/shops",
    query: { app_key: "app-key", timestamp: 1_710_000_000 },
  });
  assert.equal(shopsUrl?.searchParams.get("sign"), expectedSign);
  assert.equal(shops.data.shops[0]?.cipher, "mx-cipher");
});
