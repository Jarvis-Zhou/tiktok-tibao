import assert from "node:assert/strict";
import test from "node:test";
import { TikTokShopClient } from "../src/index.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", "x-tts-request-id": "header-request" },
  });
}

test("places opportunity pagination in query and required type in body", async () => {
  let capturedUrl = "";
  let capturedBody = "";
  const client = new TikTokShopClient({
    appKey: "app",
    appSecret: "secret",
    accessToken: "token",
    shopCipher: "cipher",
    now: () => 1_710_000_000_000,
    fetchFn: async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? "");
      return jsonResponse({ code: 0, data: { data: { opportunities: [] } }, request_id: "req-1" });
    },
  });

  await client.queryOpportunities({ opportunity_type: "PRODUCT" }, { page_size: 1, locale: "es-MX" });

  const url = new URL(capturedUrl);
  assert.equal(url.searchParams.get("page_size"), "1");
  assert.equal(url.searchParams.get("locale"), "es-MX");
  assert.equal(url.searchParams.get("shop_cipher"), "cipher");
  assert.ok(url.searchParams.get("sign"));
  assert.deepEqual(JSON.parse(capturedBody), { opportunity_type: "PRODUCT" });
});

test("returns the documented nested submission response", async () => {
  const client = new TikTokShopClient({
    appKey: "app",
    appSecret: "secret",
    accessToken: "token",
    shopCipher: "cipher",
    fetchFn: async () =>
      jsonResponse({
        code: 0,
        data: {
          submission: {
            id: "submission-1",
            opportunity_id: "opp-1",
            product_id: "product-1",
            status: "PENDING_REVIEW",
          },
        },
        request_id: "req-2",
      }),
  });

  const response = await client.submitProduct("opp-1", "product-1");
  assert.equal(response.data.submission.id, "submission-1");
  assert.equal(response.data.submission.status, "PENDING_REVIEW");
});

test("searches and reads products through the configurable product API version", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const client = new TikTokShopClient({
    appKey: "app",
    appSecret: "secret",
    accessToken: "token",
    shopCipher: "cipher",
    productApiVersion: "202309",
    fetchFn: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method),
        body: String(init?.body ?? ""),
      });
      return jsonResponse({ code: 0, data: { products: [] } });
    },
  });

  await client.searchProducts({}, { page_size: 25, page_token: "next" });
  await client.getProduct("product/with space");

  const searchUrl = new URL(requests[0]?.url ?? "");
  assert.equal(searchUrl.pathname, "/product/202309/products/search");
  assert.equal(searchUrl.searchParams.get("page_size"), "25");
  assert.equal(searchUrl.searchParams.get("page_token"), "next");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.body, "{}");

  const detailUrl = new URL(requests[1]?.url ?? "");
  assert.equal(detailUrl.pathname, "/product/202309/products/product%2Fwith%20space");
  assert.equal(requests[1]?.method, "GET");
});
