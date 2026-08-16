import assert from "node:assert/strict";
import test from "node:test";
import { createTikTokSignature } from "../src/index.js";

test("creates a deterministic TikTok Shop HMAC signature", () => {
  const signature = createTikTokSignature({
    appSecret: "secret",
    path: "/product/202604/opportunities/opp123/submit",
    query: {
      timestamp: 1710000000,
      sign: "ignored",
      shop_cipher: "cipher",
      app_key: "app123",
    },
    body: '{"product_id":"p1"}',
  });
  assert.equal(signature, "12b852593059b64d9519efaba3697a89104efe79940b252182865e402d1b1c85");
});

test("excludes access_token and sign from the signature", () => {
  const base = {
    appSecret: "secret",
    path: "/product/202604/opportunities/query",
    query: { app_key: "app123", timestamp: 1710000000 },
    body: "{}",
  };
  assert.equal(
    createTikTokSignature(base),
    createTikTokSignature({
      ...base,
      query: { ...base.query, sign: "different", access_token: "not-signed" },
    }),
  );
});
