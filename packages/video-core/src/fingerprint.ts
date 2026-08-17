import { createHash } from "node:crypto";

type JsonScalar = string | number | boolean | null;
type CanonicalValue = JsonScalar | CanonicalValue[] | { [key: string]: CanonicalValue };

function canonicalize(value: unknown, path: string): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const result: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalize(child, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`Unsupported fingerprint value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, "$"));
}

export function sha256Fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function requestFingerprint(value: unknown): string {
  return sha256Fingerprint(value);
}
