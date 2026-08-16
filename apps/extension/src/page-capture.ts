import { extractPageSnapshots } from "./capture.js";

const MESSAGE_SOURCE = "tibao-page-capture-v1";

function emitSnapshots(payload: unknown, requestUrl: string): void {
  try {
    const snapshots = extractPageSnapshots(payload, requestUrl);
    if (snapshots.products.length === 0 && snapshots.opportunities.length === 0) return;
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        pageUrl: window.location.href,
        products: snapshots.products,
        opportunities: snapshots.opportunities,
      },
      window.location.origin,
    );
  } catch {
    // Seller Center responses vary by rollout. A single unknown response must not break the page.
  }
}

async function inspectFetchResponse(response: Response, requestUrl: string): Promise<void> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/json/i.test(contentType)) return;
  try {
    emitSnapshots(await response.json(), requestUrl);
  } catch {
    // Ignore non-JSON or already-consumed clones.
  }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
  const response = await nativeFetch(...args);
  const requestUrl = response.url || String(args[0]);
  void inspectFetchResponse(response.clone(), requestUrl);
  return response;
};

type XhrOpen = (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
) => void;
type XhrSend = (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;

const xhrUrls = new WeakMap<XMLHttpRequest, string>();
const xhrPrototype = XMLHttpRequest.prototype as unknown as { open: XhrOpen; send: XhrSend };
const nativeOpen = xhrPrototype.open;
const nativeSend = xhrPrototype.send;

xhrPrototype.open = function open(method, url, async = true, username = null, password = null): void {
  xhrUrls.set(this, String(url));
  nativeOpen.call(this, method, url, async, username, password);
};

xhrPrototype.send = function send(body = null): void {
  this.addEventListener(
    "load",
    () => {
      const contentType = this.getResponseHeader("content-type") ?? "";
      if (!/json/i.test(contentType)) return;
      try {
        const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
        emitSnapshots(payload, xhrUrls.get(this) ?? this.responseURL);
      } catch {
        // Ignore non-JSON responses.
      }
    },
    { once: true },
  );
  nativeSend.call(this, body);
};

function inspectEmbeddedJson(): void {
  for (const script of Array.from(document.querySelectorAll('script[type="application/json"]'))) {
    const text = script.textContent?.trim();
    if (!text || text.length > 8_000_000) continue;
    try {
      emitSnapshots(JSON.parse(text), window.location.href);
    } catch {
      // Not every application/json script is guaranteed to be valid JSON.
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", inspectEmbeddedJson, { once: true });
} else {
  inspectEmbeddedJson();
}
