import { summarize } from "./summary";
import { tQuantile } from "./tdist";

export interface DifferenceSummary {
  readonly method: "paired-t" | "welch-t";
  readonly n: number;
  readonly nonFinite: number;
  /** Mean of (variant − baseline). */
  readonly mean: number;
  readonly se: number;
  readonly df: number;
  readonly confidence: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  /** Every paired difference is exactly 0 (paired-t only). */
  readonly allZero: boolean;
}

const nan = (method: DifferenceSummary["method"], n: number, nonFinite: number, confidence: number): DifferenceSummary => ({
  method, n, nonFinite, mean: NaN, se: NaN, df: NaN, confidence, ciLow: NaN, ciHigh: NaN, allZero: false,
});

/** CI for E[variant − baseline] from matched replications (same seeds). */
export function pairedDifference(baseline: readonly number[], variant: readonly number[], confidence: number): DifferenceSummary {
  if (baseline.length !== variant.length) throw new RangeError("paired difference needs equal-length samples");
  const d = variant.map((v, i) => v - baseline[i]!);
  const s = summarize(d, confidence);
  if (s.nonFinite > 0 || !Number.isFinite(s.mean)) return nan("paired-t", d.length, s.nonFinite, confidence);
  return { method: "paired-t", n: s.n, nonFinite: 0, mean: s.mean, se: s.se, df: s.n - 1, confidence, ciLow: s.ciLow, ciHigh: s.ciHigh, allZero: d.every((x) => x === 0) };
}

/** Welch two-sample CI for unmatched replications (different seeds or counts). */
export function welchDifference(baseline: readonly number[], variant: readonly number[], confidence: number): DifferenceSummary {
  const a = summarize(baseline, confidence);
  const b = summarize(variant, confidence);
  const nonFinite = a.nonFinite + b.nonFinite;
  if (nonFinite > 0 || a.n < 2 || b.n < 2) return nan("welch-t", a.n + b.n, nonFinite, confidence);
  const va = (a.sd * a.sd) / a.n;
  const vb = (b.sd * b.sd) / b.n;
  const se = Math.sqrt(va + vb);
  const mean = b.mean - a.mean;
  if (se === 0) return { method: "welch-t", n: a.n + b.n, nonFinite: 0, mean, se: 0, df: a.n + b.n - 2, confidence, ciLow: mean, ciHigh: mean, allZero: false };
  const df = (va + vb) ** 2 / ((va * va) / (a.n - 1) + (vb * vb) / (b.n - 1));
  const t = tQuantile(1 - (1 - confidence) / 2, df);
  return { method: "welch-t", n: a.n + b.n, nonFinite: 0, mean, se, df, confidence, ciLow: mean - t * se, ciHigh: mean + t * se, allZero: false };
}

/**
 * Observed effect of pairing on this comparison:
 * ratio = Var(D) / (Var(A) + Var(B)) estimates Var(paired mean diff) / Var(independent mean diff)
 * for samples with these marginal variances. ratio < 1 means pairing helped here; > 1 means it hurt.
 */
export interface PairingEffect {
  readonly varianceBaseline: number;
  readonly varianceVariant: number;
  readonly variancePairedDifference: number;
  readonly ratio: number;
  /** 1 − ratio, as a fraction. Negative values mean pairing increased variance. */
  readonly varianceReduction: number;
  readonly correlation: number;
}

export function pairingEffect(baseline: readonly number[], variant: readonly number[]): PairingEffect | null {
  const a = summarize(baseline);
  const b = summarize(variant);
  const d = summarize(variant.map((v, i) => v - baseline[i]!));
  const va = a.sd * a.sd;
  const vb = b.sd * b.sd;
  const vd = d.sd * d.sd;
  if (![va, vb, vd].every(Number.isFinite) || va + vb === 0) return null;
  const ratio = vd / (va + vb);
  const correlation = va > 0 && vb > 0 ? (va + vb - vd) / (2 * Math.sqrt(va * vb)) : NaN;
  return { varianceBaseline: va, varianceVariant: vb, variancePairedDifference: vd, ratio, varianceReduction: 1 - ratio, correlation };
}
