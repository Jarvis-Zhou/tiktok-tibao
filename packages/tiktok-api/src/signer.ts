import { createHmac } from "node:crypto";

export type SignableValue = string | number | boolean | null | undefined;

export interface TikTokSignInput {
  appSecret: string;
  path: string;
  query: Record<string, SignableValue>;
  body?: string;
}

/**
 * TikTok Shop Open API signing algorithm.
 *
 * 1. Remove sign/access_token, sort query keys, concatenate key + value.
 * 2. Prefix the request path and append the exact JSON body string.
 * 3. Wrap with app_secret and HMAC-SHA256 the result using app_secret.
 */
export function createTikTokSignature(input: TikTokSignInput): string {
  const parameters = Object.entries(input.query)
    .filter(([key, value]) => key !== "sign" && key !== "access_token" && value !== undefined && value !== null)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}${String(value)}`)
    .join("");
  const payload = `${input.appSecret}${input.path}${parameters}${input.body ?? ""}${input.appSecret}`;
  return createHmac("sha256", input.appSecret).update(payload, "utf8").digest("hex");
}
