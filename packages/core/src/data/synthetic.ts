/**
 * Deterministic SYNTHETIC arrival log generator (stationary Poisson arrivals, exponential
 * service) for demos and estimator tests. Output is labelled synthetic in its dataset card.
 */
import { createStream } from "../rng";
import { nextArrivalTime, type Segment } from "../models/daypart";
import { formatUtc, formatWithOffset, parseTimestamp } from "./timestamps";

export interface SyntheticLogSpec {
  readonly seed: number;
  readonly arrivalRatePerHour: number;
  readonly meanServiceMinutes: number;
  /** ISO timestamp with offset. */
  readonly start: string;
  readonly hours: number;
}

export interface SyntheticLog {
  readonly csv: string;
  readonly rows: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export function generateSyntheticArrivalLog(spec: SyntheticLogSpec): SyntheticLog {
  const start = parseTimestamp(spec.start, { assumeOffsetMinutes: null });
  if (!start.ok) throw new RangeError(`start: ${start.message}`);
  const arrivals = createStream(spec.seed, "synthetic-arrivals", 0);
  const service = createStream(spec.seed, "synthetic-service", 0);
  const endMs = start.ms + spec.hours * 3_600_000;
  const lines = ["arrival_time,service_minutes"];
  let t = start.ms;
  for (;;) {
    t += arrivals.exponential(spec.arrivalRatePerHour) * 3_600_000;
    if (t >= endMs) break;
    const s = service.exponential(1 / spec.meanServiceMinutes);
    // Millisecond timestamps and 2-decimal minutes, as a real log might store them.
    lines.push(`${formatUtc(Math.floor(t))},${s.toFixed(2)}`);
  }
  return { csv: lines.join("\n") + "\n", rows: lines.length - 1, windowStart: formatUtc(start.ms), windowEnd: formatUtc(endMs) };
}

export interface DatasetCard {
  readonly name: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly synthetic: boolean;
  readonly license: string;
  readonly description: string;
  readonly generator: string | null;
  readonly generatorParameters: Readonly<Record<string, string | number>> | null;
  readonly observationWindow: { readonly start: string; readonly end: string };
  readonly columns: Readonly<Record<string, string>>;
  readonly serviceDurationUnit: "seconds" | "minutes" | "hours";
}

export interface DailyPatternSpec {
  readonly seed: number;
  readonly days: number;
  /** Calendar date of day 1 in local time, YYYY-MM-DD. */
  readonly firstDay: string;
  /** Fixed local offset (no daylight-saving changes). */
  readonly utcOffsetMinutes: number;
  readonly openHour: number;
  readonly blockHours: number;
  readonly ratesPerHour: readonly number[];
  readonly meanServiceMinutes: number;
}

/**
 * SYNTHETIC log with a time-of-day pattern: piecewise-constant Poisson arrivals over consecutive
 * blocks of each day, generated exactly by time change (the same method as queue.daypart).
 * Timestamps are written in local time with the fixed offset.
 */
export function generateDailyPatternLog(spec: DailyPatternSpec): SyntheticLog {
  const day0 = Date.parse(`${spec.firstDay}T00:00:00Z`) - spec.utcOffsetMinutes * 60_000; // local midnight of day 1
  if (!Number.isFinite(day0)) throw new RangeError("firstDay must be YYYY-MM-DD");
  const H = 3_600_000;
  const segs: Segment[] = [];
  for (let d = 0; d < spec.days; d++) {
    const open = (d * 24 + spec.openHour) ;
    spec.ratesPerHour.forEach((r, b) => {
      segs.push({ start: open + b * spec.blockHours, end: open + (b + 1) * spec.blockHours, ratePerHour: r, staff: 0, closed: false, block: b });
    });
    const close = open + spec.ratesPerHour.length * spec.blockHours;
    const nextOpen = (d + 1) * 24 + spec.openHour;
    if (d < spec.days - 1) segs.push({ start: close, end: nextOpen, ratePerHour: 0, staff: 0, closed: true, block: -1 });
  }
  const arrivals = createStream(spec.seed, "synthetic-arrivals", 0);
  const service = createStream(spec.seed, "synthetic-service", 0);
  const lines = ["arrival_time,service_minutes"];
  let t = segs[0]!.start;
  let idx = 0;
  for (;;) {
    const next = nextArrivalTime(t, arrivals.exponential(1), segs, idx);
    if (!Number.isFinite(next.time)) break;
    t = next.time;
    idx = next.index;
    const ms = Math.floor(day0 + t * H);
    lines.push(`${formatWithOffset(ms, spec.utcOffsetMinutes)},${service.exponential(1 / spec.meanServiceMinutes).toFixed(2)}`);
  }
  const first = segs[0]!.start;
  const last = segs[segs.length - 1]!.end;
  return {
    csv: lines.join("\n") + "\n",
    rows: lines.length - 1,
    windowStart: formatWithOffset(day0 + first * H, spec.utcOffsetMinutes),
    windowEnd: formatWithOffset(day0 + last * H, spec.utcOffsetMinutes),
  };
}
