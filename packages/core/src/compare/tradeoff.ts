/**
 * Staffing-versus-waiting trade-off, computed from simulated results.
 *
 *   ΔS  = staffing expenditure (variant − baseline), $ per time unit
 *   ΔWh = customer-hours waiting (variant − baseline), per time unit
 *   modelled net cost change = ΔS + (v_variant·Wh_variant − v_baseline·Wh_baseline), where v = assumed value of waiting
 *   break-even value w* = −ΔS / ΔWh. At this waiting value both options have equal modelled cost.
 *
 * The waiting value is a hypothetical assumption, not cash. The break-even value is the most
 * decision-relevant number because it does not depend on that assumption.
 */
import type { ModelDefinition } from "../model";
import type { Scenario } from "../scenario/types";
import { pairedDifference, welchDifference, type DifferenceSummary } from "../stats/difference";
import { summarize } from "../stats/summary";
import { tQuantile } from "../stats/tdist";

export type BreakEvenStatus =
  | "finite"
  | "variant-dominates"
  | "baseline-dominates"
  | "waiting-change-inconclusive"
  | "no-waiting-change"
  | "no-staffing-change"
  | "not-computable";

export interface BreakEven {
  readonly status: BreakEvenStatus;
  /** $ per customer-hour; null unless status is "finite". */
  readonly value: number | null;
  readonly ciLow: number | null;
  readonly ciHigh: number | null;
  /** "exact-transform" when staffing change is identical in every replication; otherwise "delta-method". */
  readonly intervalMethod: "exact-transform" | "delta-method" | null;
  /** Which option has lower modelled cost when waiting is valued ABOVE the break-even value. */
  readonly preferredAbove: "variant" | "baseline" | null;
}

export interface CostTradeoff {
  readonly timeUnit: string;
  readonly baselineStaffing: number;
  readonly variantStaffing: number;
  readonly staffingChange: DifferenceSummary;
  readonly baselineWaitingHours: number;
  readonly variantWaitingHours: number;
  readonly waitingHoursChange: DifferenceSummary;
  readonly waitingValue: { readonly baseline: number; readonly variant: number; readonly same: boolean };
  readonly waitingPenaltyChange: DifferenceSummary;
  readonly netCostChange: DifferenceSummary;
  readonly breakEven: BreakEven;
}

const per = (s: Scenario, model: ModelDefinition, f: (p: Record<string, number>, m: Record<string, number>) => number) =>
  s.result!.perReplication.map((m) => f(s.spec.params as Record<string, number>, m as Record<string, number>));

export function computeTradeoff(baseline: Scenario, variant: Scenario, model: ModelDefinition, paired: boolean, confidence: number): CostTradeoff | null {
  const d = model.decision;
  if (!d || !baseline.result || !variant.result) return null;
  const diff = (a: number[], b: number[]) => (paired ? pairedDifference(a, b, confidence) : welchDifference(a, b, confidence));
  const sA = per(baseline, model, d.staffingCost);
  const sB = per(variant, model, d.staffingCost);
  const wA = per(baseline, model, d.waitingHours);
  const wB = per(variant, model, d.waitingHours);
  const vA = d.waitingValue(baseline.spec.params as Record<string, number>);
  const vB = d.waitingValue(variant.spec.params as Record<string, number>);
  const pA = wA.map((w) => vA * w);
  const pB = wB.map((w) => vB * w);
  const staffingChange = diff(sA, sB);
  const waitingHoursChange = diff(wA, wB);
  const waitingPenaltyChange = diff(pA, pB);
  const netCostChange = diff(
    sA.map((s, i) => s + pA[i]!),
    sB.map((s, i) => s + pB[i]!),
  );
  return {
    timeUnit: d.timeUnit,
    baselineStaffing: summarize(sA).mean,
    variantStaffing: summarize(sB).mean,
    staffingChange,
    baselineWaitingHours: summarize(wA).mean,
    variantWaitingHours: summarize(wB).mean,
    waitingHoursChange,
    waitingValue: { baseline: vA, variant: vB, same: vA === vB },
    waitingPenaltyChange,
    netCostChange,
    breakEven: breakEven(sA, sB, wA, wB, staffingChange, waitingHoursChange, paired, confidence),
  };
}

function breakEven(
  sA: number[], sB: number[], wA: number[], wB: number[],
  S: DifferenceSummary, W: DifferenceSummary, paired: boolean, confidence: number,
): BreakEven {
  const none = (status: BreakEvenStatus, preferredAbove: BreakEven["preferredAbove"] = null): BreakEven => ({
    status, value: null, ciLow: null, ciHigh: null, intervalMethod: null, preferredAbove,
  });
  if (!Number.isFinite(S.mean) || !Number.isFinite(W.mean)) return none("not-computable");
  const staffSame = S.allZero || S.mean === 0;
  const waitSame = W.allZero || W.mean === 0;
  if (waitSame && staffSame) return none("no-waiting-change");
  if (waitSame) return none("no-waiting-change", S.mean < 0 ? "variant" : "baseline");
  const waitCiHasZero = !(W.ciHigh < 0 || W.ciLow > 0);
  if (waitCiHasZero) return none("waiting-change-inconclusive");
  if (staffSame) return none("no-staffing-change", W.mean < 0 ? "variant" : "baseline");
  if (S.mean > 0 && W.mean > 0) return none("baseline-dominates", "baseline");
  if (S.mean < 0 && W.mean < 0) return none("variant-dominates", "variant");

  const value = -S.mean / W.mean;
  // Above w*, the option that reduces waiting is cheaper in the model.
  const preferredAbove = W.mean < 0 ? "variant" : "baseline";
  const deterministicStaffing = paired ? S.se === 0 : false;
  if (deterministicStaffing) {
    // ΔS is a constant, so w* = −ΔS/ΔWh is monotone in ΔWh; transform the ΔWh interval exactly.
    const a = -S.mean / W.ciLow;
    const b = -S.mean / W.ciHigh;
    return { status: "finite", value, ciLow: Math.min(a, b), ciHigh: Math.max(a, b), intervalMethod: "exact-transform", preferredAbove };
  }
  // Delta method for a ratio of means. With paired replications, use the covariance of per-replication differences.
  const n = paired ? sA.length : Math.min(sA.length, wA.length);
  let varRatio: number;
  if (paired) {
    const ds = sB.map((v, i) => v - sA[i]!);
    const dw = wB.map((v, i) => v - wA[i]!);
    const ms = S.mean;
    const mw = W.mean;
    let vs = 0, vw = 0, cov = 0;
    for (let i = 0; i < n; i++) {
      vs += (ds[i]! - ms) ** 2;
      vw += (dw[i]! - mw) ** 2;
      cov += (ds[i]! - ms) * (dw[i]! - mw);
    }
    vs /= n - 1; vw /= n - 1; cov /= n - 1;
    varRatio = (value * value * (vs / (ms * ms) + vw / (mw * mw) - (2 * cov) / (ms * mw))) / n;
  } else {
    varRatio = value * value * ((S.se * S.se) / (S.mean * S.mean) + (W.se * W.se) / (W.mean * W.mean));
  }
  const se = Math.sqrt(Math.max(0, varRatio));
  const t = tQuantile(1 - (1 - confidence) / 2, Math.max(1, n - 1));
  return { status: "finite", value, ciLow: value - t * se, ciHigh: value + t * se, intervalMethod: "delta-method", preferredAbove };
}
