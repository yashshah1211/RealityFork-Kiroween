/**
 * Lossless JSON encoding and canonical hashing.
 *
 * Plain JSON turns NaN and ±Infinity into null, which would erase the difference
 * between "no observations" (NaN) and a legitimate value. This module encodes
 * non-finite numbers explicitly as {"$nonFinite": "NaN" | "Infinity" | "-Infinity"}.
 *
 * Canonical form: object keys sorted by UTF-16 code unit order (independent of
 * insertion order), no whitespace, -0 normalised to 0, numbers formatted with
 * ECMAScript Number::toString (specified exactly, so identical on every conforming engine).
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const NON_FINITE_KEY = "$nonFinite";

export function encodeJson(value: unknown, path = "$"): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
      return { [NON_FINITE_KEY]: Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity" };
    case "object": {
      if (Array.isArray(value)) return value.map((v, i) => encodeJson(v, `${path}[${i}]`));
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new TypeError(`${path}: only plain objects can be serialized`);
      const out: { [key: string]: JsonValue } = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === NON_FINITE_KEY) throw new TypeError(`${path}: key "${NON_FINITE_KEY}" is reserved`);
        if (v === undefined) throw new TypeError(`${path}.${k}: undefined is not serializable; use null`);
        out[k] = encodeJson(v, `${path}.${k}`);
      }
      return out;
    }
    default:
      throw new TypeError(`${path}: ${typeof value} is not serializable`);
  }
}

export function decodeJson(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(decodeJson);
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === NON_FINITE_KEY) {
      const tag = value[NON_FINITE_KEY];
      if (tag === "NaN") return Number.NaN;
      if (tag === "Infinity") return Number.POSITIVE_INFINITY;
      if (tag === "-Infinity") return Number.NEGATIVE_INFINITY;
      throw new TypeError(`invalid ${NON_FINITE_KEY} tag: ${JSON.stringify(tag)}`);
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = decodeJson(value[k]!);
    return out;
  }
  return value;
}

function stringifySorted(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.map(stringifySorted).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifySorted(v[k]!)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Canonical JSON text of any serializable value. */
export function canonicalStringify(value: unknown): string {
  return stringifySorted(encodeJson(value));
}

interface WebCryptoLike {
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
}
interface TextEncoderLike {
  encode(text: string): Uint8Array;
}

/** SHA-256 (hex) via the Web Crypto API, available in browsers and Node >= 19. */
export async function sha256Hex(text: string): Promise<string> {
  const g = globalThis as unknown as { crypto?: WebCryptoLike; TextEncoder?: new () => TextEncoderLike };
  if (!g.crypto?.subtle || !g.TextEncoder) throw new Error("Web Crypto (crypto.subtle) and TextEncoder are required");
  const digest = await g.crypto.subtle.digest("SHA-256", new g.TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function canonicalHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalStringify(value));
}
