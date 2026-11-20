import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalHash, canonicalStringify, decodeJson, encodeJson, sha256Hex } from "../src/serialize/canonical";

describe("canonical JSON and hashing", () => {
  it("SHA-256 matches the FIPS 180-2 test vectors", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  const valueArb = fc.oneof(fc.integer(), fc.double(), fc.string(), fc.boolean(), fc.constant(null));
  const keyArb = fc.string().filter((k) => k !== "$nonFinite" && k !== "__proto__");

  it("property: hash is independent of property insertion order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.dictionary(keyArb, fc.dictionary(keyArb, valueArb)), async (obj) => {
        const reversed = Object.fromEntries(
          Object.entries(obj)
            .reverse()
            .map(([k, v]) => [k, Object.fromEntries(Object.entries(v).reverse())]),
        );
        return canonicalStringify(obj) === canonicalStringify(reversed) && (await canonicalHash(obj)) === (await canonicalHash(reversed));
      }),
      { numRuns: 100 },
    );
  });

  it("property: encode/decode round-trips every number, including NaN and ±Infinity", () => {
    fc.assert(
      fc.property(fc.array(fc.double()), (xs) => {
        const back = decodeJson(JSON.parse(JSON.stringify(encodeJson({ xs })))) as { xs: number[] };
        return back.xs.every((x, i) => Object.is(x, Object.is(xs[i], -0) ? 0 : xs[i]));
      }),
    );
  });

  it("keeps 'no observations' (NaN) distinct from a numerical zero", () => {
    const text = JSON.stringify(encodeJson({ empty: Number.NaN, zero: 0, inf: Infinity, ninf: -Infinity }));
    expect(text).toBe('{"empty":{"$nonFinite":"NaN"},"zero":0,"inf":{"$nonFinite":"Infinity"},"ninf":{"$nonFinite":"-Infinity"}}');
    const back = decodeJson(JSON.parse(text)) as Record<string, number>;
    expect(Number.isNaN(back.empty)).toBe(true);
    expect(back.zero).toBe(0);
    expect(canonicalStringify({ v: NaN })).not.toBe(canonicalStringify({ v: 0 }));
    expect(canonicalStringify({ v: NaN })).not.toBe(canonicalStringify({ v: null }));
  });

  it("normalises -0 to 0 and rejects unserializable input", () => {
    expect(canonicalStringify({ a: -0 })).toBe('{"a":0}');
    expect(() => encodeJson({ a: undefined })).toThrow(TypeError);
    expect(() => encodeJson({ $nonFinite: "NaN" })).toThrow(TypeError);
    expect(() => encodeJson({ d: new Date(0) })).toThrow(TypeError);
    expect(() => decodeJson({ $nonFinite: "nan" })).toThrow(TypeError);
  });
});
