import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createStream, deriveStreamSeed, fnv1a32, xoshiro128ssFromState } from "../src/rng";

const take = (n: number, f: () => number) => Array.from({ length: n }, f);

describe("rng: seeded streams (R1)", () => {
  it("R1.1 same seed, name and replication give an identical sequence", () => {
    const a = createStream(42, "arrivals", 0);
    const b = createStream(42, "arrivals", 0);
    expect(take(1000, () => a.uniform())).toEqual(take(1000, () => b.uniform()));
  });

  it("R1.1 property: determinism holds for arbitrary seeds", () => {
    fc.assert(
      fc.property(fc.nat({ max: 0xffffffff }), fc.string(), fc.nat({ max: 1000 }), (seed, name, rep) => {
        const a = createStream(seed, name, rep);
        const b = createStream(seed, name, rep);
        const xs = take(20, () => a.uniform());
        const ys = take(20, () => b.uniform());
        return xs.every((x, i) => x === ys[i]);
      }),
      { numRuns: 100 },
    );
  });

  it("R1.2 different stream names or replications give different sequences", () => {
    const base = take(16, () => createStream(7, "arrivals", 0).uniform());
    const first = (name: string, rep: number) => {
      const s = createStream(7, name, rep);
      return take(16, () => s.uniform());
    };
    expect(first("service", 0)).not.toEqual(first("arrivals", 0));
    expect(first("arrivals", 1)).not.toEqual(first("arrivals", 0));
    expect(base.length).toBe(16);
  });

  it("R1.2 derived seeds are distinct across 10,000 (name, replication) pairs", () => {
    const seen = new Set<number>();
    for (let r = 0; r < 5000; r++) {
      seen.add(deriveStreamSeed(123, "arrivals", r));
      seen.add(deriveStreamSeed(123, "service", r));
    }
    // 10,000 draws from 2^32: expected collisions ≈ 0.012, so allow at most 1.
    expect(seen.size).toBeGreaterThanOrEqual(9999);
  });

  it("R1.3 property: uniform draws lie in [0, 1)", () => {
    fc.assert(
      fc.property(fc.nat({ max: 0xffffffff }), (seed) => {
        const s = createStream(seed, "u", 0);
        for (let i = 0; i < 200; i++) {
          const u = s.uniform();
          if (!(u >= 0 && u < 1)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("R1.3 uniform mean and variance match U(0,1) over 10^5 draws", () => {
    const s = createStream(2026, "uniform-check", 0);
    const n = 100_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const u = s.uniform();
      sum += u;
      sumSq += u * u;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    // SE(mean) = sqrt(1/12/n) ≈ 9.1e-4; 5 SE bound.
    expect(Math.abs(mean - 0.5)).toBeLessThan(5 * Math.sqrt(1 / 12 / n));
    expect(Math.abs(variance - 1 / 12)).toBeLessThan(0.002);
  });

  it("R1.4 exponential sample mean within 1% of 1/rate over 10^5 draws", () => {
    const rate = 1.6;
    const s = createStream(99, "exp-check", 0);
    const n = 100_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s.exponential(rate);
    const mean = sum / n;
    // SE = (1/rate)/sqrt(n) ≈ 0.32% of the mean; the 1% bound is ≈ 3.2 SE.
    expect(Math.abs(mean * rate - 1)).toBeLessThan(0.01);
  });

  it("exponential rejects invalid rates", () => {
    const s = createStream(1, "x", 0);
    expect(() => s.exponential(0)).toThrow(RangeError);
    expect(() => s.exponential(-1)).toThrow(RangeError);
    expect(() => s.exponential(Number.NaN)).toThrow(RangeError);
  });

  it("xoshiro128** matches reference outputs for state [1, 2, 3, 4]", () => {
    // Reference values from the Blackman–Vigna C implementation seeded {1,2,3,4}.
    const g = xoshiro128ssFromState([1, 2, 3, 4]);
    expect([g.nextUint32(), g.nextUint32(), g.nextUint32(), g.nextUint32(), g.nextUint32(), g.nextUint32()]).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492,
    ]);
  });

  it("fnv1a32 matches published test vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("draw counter tracks consumption", () => {
    const s = createStream(5, "c", 0);
    s.uniform();
    s.exponential(2);
    expect(s.draws).toBe(2);
  });
});
