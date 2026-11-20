/**
 * Regularized incomplete gamma, chi-square distribution and the exact (Garwood)
 * Poisson rate interval. Series / continued-fraction evaluation (Numerical Recipes §6.2).
 */
import { lnGamma } from "./tdist";

export function regularizedGammaP(a: number, x: number): number {
  if (!(a > 0)) throw new RangeError(`a must be > 0, got ${a}`);
  if (x <= 0) return 0;
  const lnPrefix = -x + a * Math.log(x) - lnGamma(a);
  if (x < a + 1) {
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < 100_000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) return sum * Math.exp(lnPrefix);
    }
    throw new Error("incomplete gamma series did not converge");
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 100_000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) return 1 - Math.exp(lnPrefix) * h;
  }
  throw new Error("incomplete gamma continued fraction did not converge");
}

export function chiSquareCdf(x: number, df: number): number {
  return regularizedGammaP(df / 2, x / 2);
}

export function chiSquareQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`p must be in (0, 1), got ${p}`);
  let lo = 0;
  let hi = Math.max(1, df);
  while (chiSquareCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 300; i++) {
    const mid = 0.5 * (lo + hi);
    if (chiSquareCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-13 * Math.max(1, hi)) break;
  }
  return 0.5 * (lo + hi);
}

/** Exact (Garwood) two-sided CI for a Poisson rate given n events over exposure t. */
export function poissonRateInterval(n: number, exposure: number, confidence: number): { low: number; high: number } {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("n must be a non-negative integer");
  if (!(exposure > 0)) throw new RangeError("exposure must be > 0");
  const alpha = 1 - confidence;
  const low = n === 0 ? 0 : chiSquareQuantile(alpha / 2, 2 * n) / 2 / exposure;
  const high = chiSquareQuantile(1 - alpha / 2, 2 * n + 2) / 2 / exposure;
  return { low, high };
}
