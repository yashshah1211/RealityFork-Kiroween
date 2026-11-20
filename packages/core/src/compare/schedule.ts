/**
 * Staffing-schedule views and explanations for queue.daypart. Everything here is computed from
 * parameters, simulated summaries and core comparisons; the UI only formats the results.
 * Explanations are templates filled with computed values (claims policy).
 */
import { DAYPART_BLOCKS } from "../models/daypart";
import type { Scenario } from "../scenario/types";
import type { ScenarioComparison } from "./types";
import { formatNumber } from "./explain";

export interface ScheduleBlockView {
  readonly index: number;
  readonly label: string;
  readonly ratePerHour: number;
  readonly staff: number;
  /** staff × services per staff member per hour. */
  readonly capacityPerHour: number;
  /** Expected arrivals ÷ capacity in this block (≥ 1 means a queue must build). Infinity with 0 staff and demand. */
  readonly load: number;
}

export interface ScheduleView {
  readonly blocks: readonly ScheduleBlockView[];
  /** Index of the busiest block (highest arrival rate; earliest on ties). */
  readonly peakIndex: number;
  readonly scheduledStaffHours: number;
}

const BLOCK_HOURS = 2;

export function scheduleView(params: Readonly<Record<string, number>>): ScheduleView {
  const mu = params.serviceRatePerHour!;
  const blocks = DAYPART_BLOCKS.map((b, i) => {
    const rate = params[`rate${b.key}`]!;
    const staff = params[`staff${b.key}`]!;
    const cap = staff * mu;
    return { index: i, label: b.label, ratePerHour: rate, staff, capacityPerHour: cap, load: cap > 0 ? rate / cap : rate > 0 ? Number.POSITIVE_INFINITY : 0 };
  });
  let peakIndex = 0;
  blocks.forEach((b, i) => {
    if (b.ratePerHour > blocks[peakIndex]!.ratePerHour) peakIndex = i;
  });
  return { blocks, peakIndex, scheduledStaffHours: blocks.reduce((s, b) => s + b.staff * BLOCK_HOURS, 0) };
}

/** Staff parameters for "one more person all day" and "one more person in the busiest block". */
export function standardAlternatives(params: Readonly<Record<string, number>>): {
  readonly allDay: Record<string, number>;
  readonly peakOnly: Record<string, number>;
  readonly peakLabel: string;
} {
  const v = scheduleView(params);
  const allDay: Record<string, number> = {};
  for (const b of DAYPART_BLOCKS) allDay[`staff${b.key}`] = params[`staff${b.key}`]! + 1;
  const key = DAYPART_BLOCKS[v.peakIndex]!.key;
  return { allDay, peakOnly: { [`staff${key}`]: params[`staff${key}`]! + 1 }, peakLabel: DAYPART_BLOCKS[v.peakIndex]!.label };
}

export interface FutureOption {
  readonly scenario: Scenario;
  /** Comparison against the baseline (baseline first). */
  readonly vsBaseline: ScenarioComparison;
}

const money = (x: number) => `$${Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)}`;
const minutes = (h: number) => `${(h * 60).toFixed(1)} min`;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/**
 * Plain-language explanation of why targeted staffing may give a better trade-off, from:
 * the baseline schedule and per-block waits, each option's trade-off against the baseline, and
 * (optional) the comparison between the cheapest and the most expensive option.
 */
export function explainStaffingChoice(baseline: Scenario, options: readonly FutureOption[], incremental: { readonly cheaper: Scenario; readonly dearer: Scenario; readonly comparison: ScenarioComparison } | null): string[] {
  const out: string[] = [];
  const v = scheduleView(baseline.spec.params);
  const peak = v.blocks[v.peakIndex]!;
  const sum = baseline.result?.summary;
  const peakWait = sum?.[`meanWaitBlock${DAYPART_BLOCKS[v.peakIndex]!.key}`]?.mean;
  const quiet = v.blocks.reduce((a, b) => (b.ratePerHour < a.ratePerHour ? b : a));
  const quietWait = sum?.[`meanWaitBlock${DAYPART_BLOCKS[quiet.index]!.key}`]?.mean;
  out.push(
    `In "${baseline.name}", demand is highest ${peak.label}: about ${formatNumber(peak.ratePerHour)} customers per hour, ` +
      `${pct(peak.load)} of what ${peak.staff} staff can serve (${formatNumber(peak.capacityPerHour)} per hour).` +
      (peakWait !== undefined && Number.isFinite(peakWait) && quietWait !== undefined && Number.isFinite(quietWait)
        ? ` In the simulation, customers arriving then wait ${minutes(peakWait)} on average, compared with ${minutes(quietWait)} for those arriving ${quiet.label}.`
        : ""),
  );
  const slack = v.blocks.filter((b) => b.index !== v.peakIndex && b.load < 0.75).length;
  const others = v.blocks.length - 1;
  if (slack > 0)
    out.push(
      `${slack === others ? `In all ${others} other time blocks` : `In ${slack} of the other ${others} time blocks`}, today's staff can already serve more than a third more customers than are expected, so an extra person there would often be idle.`,
    );

  const efficient = options
    .map((o) => ({ o, t: o.vsBaseline.tradeoff }))
    .filter((x): x is { o: FutureOption; t: NonNullable<ScenarioComparison["tradeoff"]> } => x.t !== null && x.t.staffingChange.mean > 0 && x.t.waitingHoursChange.mean < 0);
  for (const { o, t } of efficient) {
    out.push(
      `"${o.scenario.name}" adds ${money(t.staffingChange.mean)} a day in staffing and removes ${formatNumber(-t.waitingHoursChange.mean)} customer-hours of waiting a day: ` +
        `${formatNumber((-t.waitingHoursChange.mean / t.staffingChange.mean) * 100)} customer-hours less waiting per $100 of extra staffing.`,
    );
  }
  if (incremental) {
    const a = options.find((o) => o.scenario.id === incremental.cheaper.id)?.vsBaseline.tradeoff;
    const b = options.find((o) => o.scenario.id === incremental.dearer.id)?.vsBaseline.tradeoff;
    const t = incremental.comparison.tradeoff;
    if (a && b && t && b.waitingHoursChange.mean < 0 && b.staffingChange.mean > 0 && a.waitingHoursChange.mean < 0) {
      const shareWait = a.waitingHoursChange.mean / b.waitingHoursChange.mean;
      const shareCost = a.staffingChange.mean / b.staffingChange.mean;
      out.push(
        `So under these assumptions, "${incremental.cheaper.name}" removes ${pct(shareWait)} as much waiting as "${incremental.dearer.name}" for ${pct(shareCost)} of its extra staffing cost.`,
      );
      if (t.breakEven.status === "finite" && t.breakEven.value !== null) {
        out.push(
          `Going from "${incremental.cheaper.name}" to "${incremental.dearer.name}" costs ${money(t.staffingChange.mean)} more a day and removes another ${formatNumber(-t.waitingHoursChange.mean)} customer-hours of waiting. ` +
            `It is cheaper in the model only if an hour of a customer's waiting is worth more than ${money(t.breakEven.value)} to you` +
            (t.breakEven.ciLow !== null && t.breakEven.ciHigh !== null ? ` (likely range ${money(t.breakEven.ciLow)} to ${money(t.breakEven.ciHigh)}).` : "."),
        );
      }
    }
  }
  out.push("These are model estimates on synthetic data under the stated assumptions, not predictions for a real service center.");
  return out;
}
