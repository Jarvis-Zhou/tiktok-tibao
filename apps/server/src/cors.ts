import type { FastifyCorsOptionsDelegate } from "@fastify/cors";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[^/]+$/i;

class CorsOriginError extends Error {
  readonly code = "CORS_ORIGIN_FORBIDDEN";
  readonly statusCode = 403;

  constructor() {
    super("Origin not allowed");
    this.name = "CorsOriginError";
  }
}

function matchesRequestHost(originUrl: URL, requestHost: string | undefined): boolean {
  if (!requestHost) return false;

  try {
    const requestUrl = new URL(`${originUrl.protocol}//${requestHost}`);
    if (
      requestUrl.username ||
      requestUrl.password ||
      requestUrl.pathname !== "/" ||
      requestUrl.search ||
      requestUrl.hash
    ) {
      return false;
    }
    return requestUrl.host.toLowerCase() === originUrl.host.toLowerCase();
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(origin: string | undefined, requestHost: string | undefined): boolean {
  if (!origin) return true;
  if (CHROME_EXTENSION_ORIGIN.test(origin)) return true;

  try {
    const originUrl = new URL(origin);
    if ((originUrl.protocol !== "http:" && originUrl.protocol !== "https:") || originUrl.origin !== origin) {
      return false;
    }
    return LOCAL_HOSTNAMES.has(originUrl.hostname.toLowerCase()) || matchesRequestHost(originUrl, requestHost);
  } catch {
    return false;
  }
}

export const corsOptionsDelegate: FastifyCorsOptionsDelegate = (request, callback) => {
  const origin = request.headers.origin;
  if (!isAllowedCorsOrigin(origin, request.headers.host)) {
    callback(new CorsOriginError());
    return;
  }

  callback(null, { origin: origin ?? false });
};
