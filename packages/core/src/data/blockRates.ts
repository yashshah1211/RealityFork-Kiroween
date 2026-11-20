/**
 * Time-of-day demand estimation (feasibility spike).
 *
 * One local-time definition is used throughout: a single fixed UTC offset declared by the user.
 * Each arrival instant is converted to local clock time with that offset. Named time zones and
 * daylight-saving changes are NOT supported; rows whose own offset differs from the declared
 * offset are counted and reported.
 *
 *   exposure_b = Σ over days of |[day + start_b, day + end_b) ∩ observation window| (hours)
 *   λ̂_b = count_b / exposure_b, with an exact Poisson (Garwood) interval
 */
import { sha256Hex } from "../serialize/canonical";
import { poissonRateInterval } from "../stats/gamma";
import { parseCsv } from "./csv";
import { formatWithOffset, parseTimestamp, type TimezonePolicy } from "./timestamps";

export const BLOCK_ESTIMATOR_ID = "block-rates-csv@0.1.0";

export interface BlockDef {
  readonly label: string;
  /** Local clock hours, 0 ≤ start < end ≤ 24. */
  readonly startHour: number;
  readonly endHour: number;
}

export interface BlockRateOptions {
  readonly fileName: string;
  readonly synthetic: boolean;
  readonly arrivalColumn: string;
  readonly observationWindow: { readonly start: string; readonly end: string };
  readonly timezone: TimezonePolicy;
  readonly localUtcOffsetMinutes: number;
  readonly blocks: readonly BlockDef[];
  readonly confidence?: number;
  /** Blocks with fewer arrivals than this are flagged as sparse (default 10). */
  readonly sparseBelow?: number;
}

export interface BlockEstimate {
  readonly label: string;
  readonly startHour: number;
  readonly endHour: number;
  readonly count: number;
  readonly exposureHours: number;
  readonly ratePerHour: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly sparse: boolean;
}

export interface BlockRateReport {
  readonly ok: boolean;
  readonly estimator: string;
  readonly fileSha256: string;
  readonly issues: readonly { readonly severity: "error" | "warning"; readonly code: string; readonly message: string }[];
  readonly window: { readonly startLocal: string; readonly endLocal: string; readonly hours: number } | null;
  readonly counts: { readonly rows: number; readonly invalid: number; readonly outsideWindow: number; readonly outsideBlocks: number; readonly offsetMismatch: number };
  readonly blocks: readonly BlockEstimate[];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export async function estimateBlockRates(text: string, o: BlockRateOptions): Promise<BlockRateReport> {
  const issues: BlockRateReport["issues"][number][] = [];
  const sha = await sha256Hex(text);
  const conf = o.confidence ?? 0.95;
  const sparseBelow = o.sparseBelow ?? 10;
  const counts = { rows: 0, invalid: 0, outsideWindow: 0, outsideBlocks: 0, offsetMismatch: 0 };
  const fail = (window: BlockRateReport["window"] = null): BlockRateReport => ({ ok: false, estimator: BLOCK_ESTIMATOR_ID, fileSha256: sha, issues, window, counts, blocks: [] });

  const sorted = [...o.blocks].sort((a, b) => a.startHour - b.startHour);
  sorted.forEach((b, i) => {
    if (!(b.startHour >= 0 && b.endHour <= 24 && b.endHour > b.startHour)) issues.push({ severity: "error", code: "bad-block", message: `block "${b.label}" must satisfy 0 ≤ start < end ≤ 24` });
    if (i > 0 && b.startHour < sorted[i - 1]!.endHour) issues.push({ severity: "error", code: "overlap", message: `blocks "${sorted[i - 1]!.label}" and "${b.label}" overlap` });
  });
  let csv;
  try {
    csv = parseCsv(text);
  } catch (e) {
    issues.push({ severity: "error", code: "csv-parse", message: (e as Error).message });
    return fail();
  }
  const ai = csv.header.indexOf(o.arrivalColumn);
  if (ai < 0) issues.push({ severity: "error", code: "missing-column", message: `column "${o.arrivalColumn}" not found; columns are: ${csv.header.join(", ")}` });
  const ws = parseTimestamp(o.observationWindow.start, o.timezone);
  const we = parseTimestamp(o.observationWindow.end, o.timezone);
  if (!ws.ok || !we.ok || !(we.ms > ws.ms)) issues.push({ severity: "error", code: "window", message: "observation window must be two valid timestamps with end after start" });
  if (issues.some((i) => i.severity === "error") || !ws.ok || !we.ok) return fail();
  const window = { startLocal: formatWithOffset(ws.ms, o.localUtcOffsetMinutes), endLocal: formatWithOffset(we.ms, o.localUtcOffsetMinutes), hours: (we.ms - ws.ms) / HOUR };

  const off = o.localUtcOffsetMinutes * 60_000;
  const blockCount = o.blocks.map(() => 0);
  for (const row of csv.rows) {
    if (row.every((c) => c.trim() === "")) continue;
    counts.rows++;
    const t = parseTimestamp(row[ai] ?? "", o.timezone);
    if (!t.ok) {
      counts.invalid++;
      continue;
    }
    if (!t.assumedOffset && t.offsetMinutes !== o.localUtcOffsetMinutes) counts.offsetMismatch++;
    if (t.ms < ws.ms || t.ms >= we.ms) {
      counts.outsideWindow++;
      continue;
    }
    const local = t.ms + off;
    const hourOfDay = (((local % DAY) + DAY) % DAY) / HOUR;
    const b = o.blocks.findIndex((x) => hourOfDay >= x.startHour && hourOfDay < x.endHour);
    if (b < 0) counts.outsideBlocks++;
    else blockCount[b]!++;
  }
  // Exposure: overlap of each day's block with the window, in local clock time.
  const startLocal = ws.ms + off;
  const endLocal = we.ms + off;
  const firstDay = Math.floor(startLocal / DAY) * DAY;
  const blocks: BlockEstimate[] = o.blocks.map((b, i) => {
    let exposureMs = 0;
    for (let d = firstDay; d < endLocal; d += DAY) {
      const s = Math.max(d + b.startHour * HOUR, startLocal);
      const e = Math.min(d + b.endHour * HOUR, endLocal);
      if (e > s) exposureMs += e - s;
    }
    const exposureHours = exposureMs / HOUR;
    const count = blockCount[i]!;
    const ci = exposureHours > 0 ? poissonRateInterval(count, exposureHours, conf) : { low: Number.NaN, high: Number.NaN };
    return {
      label: b.label, startHour: b.startHour, endHour: b.endHour, count, exposureHours,
      ratePerHour: exposureHours > 0 ? count / exposureHours : Number.NaN, ciLow: ci.low, ciHigh: ci.high, sparse: count < sparseBelow,
    };
  });
  for (const b of blocks) {
    if (b.exposureHours === 0) issues.push({ severity: "error", code: "no-exposure", message: `block "${b.label}" is never inside the observation window` });
    else if (b.sparse) issues.push({ severity: "warning", code: "sparse-block", message: `block "${b.label}" has only ${b.count} arrivals in ${b.exposureHours} h; its rate is very uncertain` });
  }
  if (counts.invalid) issues.push({ severity: "warning", code: "invalid-timestamp", message: `${counts.invalid} row(s) with unreadable or zone-less timestamps were excluded` });
  if (counts.outsideWindow) issues.push({ severity: "warning", code: "outside-window", message: `${counts.outsideWindow} arrival(s) outside the observation window were not counted` });
  if (counts.outsideBlocks) issues.push({ severity: "warning", code: "outside-blocks", message: `${counts.outsideBlocks} arrival(s) fall outside every defined block (e.g. while closed) and were not counted` });
  if (counts.offsetMismatch) issues.push({ severity: "warning", code: "offset-mismatch", message: `${counts.offsetMismatch} timestamp(s) carry a UTC offset different from the declared local offset; they were converted to the declared local time, which is wrong if the site changed clocks (daylight saving)` });
  return { ok: !issues.some((i) => i.severity === "error"), estimator: BLOCK_ESTIMATOR_ID, fileSha256: sha, issues, window, counts, blocks };
}

/**
 * Flat provenance record for a queue.daypart scenario whose arrival rates come from a block-rate
 * report. It goes into spec.dataProvenance, so it is part of the fingerprint and of every export.
 * Keys rate1…rate6 are the only parameters taken from data; everything else is entered by hand.
 */
export function blockRatesProvenance(report: BlockRateReport, source: { readonly fileName: string; readonly synthetic: boolean; readonly localUtcOffsetMinutes: number }): Record<string, string | number | boolean> {
  if (!report.ok || !report.window) throw new Error("cannot record provenance for a failed block-rate estimate");
  const p: Record<string, string | number | boolean> = {
    kind: "block-rates",
    estimator: report.estimator,
    fileName: source.fileName,
    sha256: report.fileSha256,
    synthetic: source.synthetic,
    windowStartLocal: report.window.startLocal,
    windowEndLocal: report.window.endLocal,
    localUtcOffsetMinutes: source.localUtcOffsetMinutes,
    rowsRead: report.counts.rows,
    excludedInvalid: report.counts.invalid,
    excludedOutsideWindow: report.counts.outsideWindow,
    excludedOutsideBlocks: report.counts.outsideBlocks,
    offsetMismatches: report.counts.offsetMismatch,
    fromData: "rate1,rate2,rate3,rate4,rate5,rate6",
    warnings: report.issues.filter((i) => i.severity === "warning").map((i) => i.code).join(",") || "none",
  };
  report.blocks.forEach((b, i) => {
    const k = `block${i + 1}`;
    p[`${k}Label`] = b.label;
    p[`${k}Arrivals`] = b.count;
    p[`${k}ExposureHours`] = b.exposureHours;
    p[`${k}Rate`] = b.ratePerHour;
    p[`${k}CiLow`] = b.ciLow;
    p[`${k}CiHigh`] = b.ciHigh;
    p[`${k}Sparse`] = b.sparse;
  });
  return p;
}

export interface BlockProvenanceView {
  readonly fileName: string;
  readonly synthetic: boolean;
  readonly sha256: string;
  readonly estimator: string;
  readonly windowStartLocal: string;
  readonly windowEndLocal: string;
  readonly warnings: readonly string[];
  readonly blocks: readonly { readonly label: string; readonly arrivals: number; readonly exposureHours: number; readonly rate: number; readonly ciLow: number; readonly ciHigh: number; readonly sparse: boolean }[];
}

/** Read back a provenance record written by blockRatesProvenance; null for anything else. */
export function readBlockProvenance(p: Readonly<Record<string, string | number | boolean>> | null): BlockProvenanceView | null {
  if (!p || p.kind !== "block-rates") return null;
  const blocks = [];
  for (let i = 1; typeof p[`block${i}Arrivals`] === "number"; i++) {
    blocks.push({
      label: String(p[`block${i}Label`]), arrivals: p[`block${i}Arrivals`] as number, exposureHours: p[`block${i}ExposureHours`] as number,
      rate: p[`block${i}Rate`] as number, ciLow: p[`block${i}CiLow`] as number, ciHigh: p[`block${i}CiHigh`] as number, sparse: p[`block${i}Sparse`] === true,
    });
  }
  const w = String(p.warnings ?? "none");
  return {
    fileName: String(p.fileName), synthetic: p.synthetic === true, sha256: String(p.sha256), estimator: String(p.estimator),
    windowStartLocal: String(p.windowStartLocal), windowEndLocal: String(p.windowEndLocal),
    warnings: w === "none" ? [] : w.split(","), blocks,
  };
}
