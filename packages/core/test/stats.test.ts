import { describe, expect, it } from "vitest";
import { lnGamma, regularizedIncompleteBeta, tCdf, tQuantile } from "../src/stats/tdist";
import { summarize } from "../src/stats/summary";
import { welchCurve } from "../src/stats/welch";
import { erlangB, mmcAnalytic } from "../src/analytic/erlang";

describe("t distribution (R3.2)", () => {
  it("lnGamma matches exact factorials", () => {
    expect(lnGamma(1)).toBeCloseTo(0, 12);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 12);
  });

  it("incomplete beta matches closed forms", () => {
    // I_x(1, 1) = x; I_x(a, 1) = x^a.
    expect(regularizedIncompleteBeta(1, 1, 0.3)).toBeCloseTo(0.3, 12);
    expect(regularizedIncompleteBeta(2.5, 1, 0.4)).toBeCloseTo(0.4 ** 2.5, 12);
  });

  it("t CDF with df = 1 is the Cauchy CDF", () => {
    for (const t of [-3, -0.5, 0.7, 4]) expect(tCdf(t, 1)).toBeCloseTo(0.5 + Math.atan(t) / Math.PI, 12);
  });

  it("t quantiles match published values", () => {
    // Standard published two-sided critical values.
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.7062047362, 8);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.2281388520, 8);
    expect(tQuantile(0.975, 29)).toBeCloseTo(2.0452296421, 8);
    expect(tQuantile(0.995, 29)).toBeCloseTo(2.7563859036, 8);
    expect(tQuantile(0.95, 120)).toBeCloseTo(1.6576508993, 8);
    expect(tQuantile(0.025, 29)).toBeCloseTo(-2.0452296421, 8);
  });
});

describe("summaries", () => {
  it("computes mean, sample SD and t interval", () => {
    const s = summarize([1, 2, 3, 4, 5], 0.95);
    expect(s.mean).toBe(3);
    expect(s.sd).toBeCloseTo(Math.sqrt(2.5), 12);
    expect(s.se).toBeCloseTo(Math.sqrt(2.5 / 5), 12);
    expect(s.tCritical).toBeCloseTo(2.7764451052, 8);
    expect(s.ciLow).toBeCloseTo(3 - s.halfWidth, 12);
  });

  it("never drops non-finite values silently", () => {
    const s = summarize([1, Number.NaN, 3]);
    expect(s.nonFinite).toBe(1);
    expect(Number.isNaN(s.mean)).toBe(true);
  });
});

describe("Welch curve", () => {
  it("averages across replications and smooths with a shrinking window", () => {
    const c = welchCurve(
      [
        [0, 2, 4, 6, 8],
        [2, 4, 6, 8, 10],
      ],
      1,
    );
    expect(c.ensembleMean).toEqual([1, 3, 5, 7, 9]);
    expect(c.movingAverage).toEqual([1, 3, 5, 7]);
  });
});

describe("Erlang C (R3.3 analytic side)", () => {
  it("M/M/1 reduces to Wq = rho / (mu - lambda)", () => {
    const a = mmcAnalytic(0.5, 1, 1);
    expect(a.erlangC).toBeCloseTo(0.5, 14);
    expect(a.wq).toBeCloseTo(1, 14);
  });

  it("M/M/2, lambda = 1.6, mu = 1: C = 32/45 and Wq = 16/9 (hand-computed)", () => {
    const a = mmcAnalytic(1.6, 1, 2);
    expect(a.erlangC).toBeCloseTo(32 / 45, 14);
    expect(a.wq).toBeCloseTo(16 / 9, 13);
    expect(a.lq).toBeCloseTo(1.6 * (16 / 9), 13);
  });

  it("M/M/3, lambda = 2.4, mu = 1: C = 11.52 / 17.8 (hand-computed)", () => {
    const a = mmcAnalytic(2.4, 1, 3);
    expect(a.erlangC).toBeCloseTo(11.52 / 17.8, 13);
    expect(a.wq).toBeCloseTo(11.52 / 17.8 / 0.6, 13);
  });

  it("Erlang B recursion matches the direct formula", () => {
    // B(2, 1.6) = (1.6^2 / 2) / (1 + 1.6 + 1.6^2 / 2)
    expect(erlangB(2, 1.6)).toBeCloseTo(1.28 / 3.88, 14);
  });

  it("rejects unstable systems", () => {
    expect(() => mmcAnalytic(2, 1, 2)).toThrow(RangeError);
  });
});
