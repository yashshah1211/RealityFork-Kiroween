import { tQuantile } from "./tdist";

export interface Summary {
  readonly n: number;
  /** Values that were NaN/±Infinity. They are never silently dropped: if > 0, mean and CI are NaN. */
  readonly nonFinite: number;
  readonly mean: number;
  readonly sd: number;
  readonly se: number;
  readonly confidence: number;
  readonly tCritical: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly halfWidth: number;
}

/**
 * Mean, sample SD, SE and a two-sided Student-t CI across independent replications.
 * Requires n >= 2 for an interval.
 */
export function summarize(values: readonly number[], confidence = 0.95): Summary {
  if (!(confidence > 0 && confidence < 1)) throw new RangeError(`confidence must be in (0,1)`);
  const n = values.length;
  const nonFinite = values.filter((v) => !Number.isFinite(v)).length;
  if (n < 2 || nonFinite > 0) {
    const mean = n === 1 && nonFinite === 0 ? values[0]! : Number.NaN;
    return { n, nonFinite, mean, sd: NaN, se: NaN, confidence, tCritical: NaN, ciLow: NaN, ciHigh: NaN, halfWidth: NaN };
  }
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) * (v - mean);
  const sd = Math.sqrt(ss / (n - 1));
  const se = sd / Math.sqrt(n);
  const tCritical = tQuantile(1 - (1 - confidence) / 2, n - 1);
  const halfWidth = tCritical * se;
  return { n, nonFinite, mean, sd, se, confidence, tCritical, ciLow: mean - halfWidth, ciHigh: mean + halfWidth, halfWidth };
}
