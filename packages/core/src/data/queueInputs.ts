/**
 * Estimate queue-model inputs (arrival rate, service rate) from an observation log.
 *
 * The log is a CSV with one row per arrival. Columns are mapped by the user, not hardcoded.
 * The observation window [start, end) MUST be supplied explicitly. It is never inferred from
 * the first and last arrivals, which would overstate the rate because those two arrivals
 * sit at the window's edges by construction.
 *
 *   λ̂ = n / T                  n = valid arrivals with start <= t < end, T = window length in hours
 *   CI(λ): exact Poisson (Garwood) interval
 *   mean service s̄ (hours), t interval; μ̂ = 1 / s̄; CI(μ) = [1 / upper(s̄), 1 / lower(s̄)]
 *
 * Fit checks (they can only flag poor fits; passing them does not show the exponential/Poisson
 * assumptions are correct):
 *   - CV of interarrival times and of service times (1 for exponential; asymptotic SD of the
 *     sample CV under exponentiality ≈ 1/√n, so |CV − 1| > 3/√n is flagged).
 *   - Index of dispersion of arrival counts per bin (1 for a stationary Poisson process),
 *     with a two-sided chi-square test; p < 0.01 suggests the rate varies over time.
 */
import { sha256Hex } from "../serialize/canonical";
import { chiSquareCdf, poissonRateInterval } from "../stats/gamma";
import { summarize } from "../stats/summary";
import { regularizedIncompleteBeta } from "../stats/tdist";
import { parseCsv, CsvError } from "./csv";
import { formatUtc, parseTimestamp, type TimezonePolicy } from "./timestamps";

export const QUEUE_ESTIMATOR_ID = "queue-inputs-csv@1.1.0";

export type DurationUnit = "seconds" | "minutes" | "hours";
const HOURS_PER: Record<DurationUnit, number> = { seconds: 1 / 3600, minutes: 1 / 60, hours: 1 };

export interface QueueImportOptions {
  readonly fileName: string;
  /** Set by the user (or a matching dataset card). Never guessed from the file name. */
  readonly synthetic: boolean;
  readonly mapping: { readonly arrivalTime: string; readonly serviceDuration: string | null };
  readonly serviceDurationUnit: DurationUnit;
  readonly observationWindow: { readonly start: string; readonly end: string };
  readonly timezone: TimezonePolicy;
  /** Exact duplicate rows (same timestamp and duration): drop (default) or keep. */
  readonly duplicateRows?: "drop" | "keep";
  readonly confidence?: number;
  readonly dispersionBinHours?: number;
}

export interface ImportIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  /** Up to 10 file line numbers that triggered the issue. */
  readonly lines?: readonly number[];
}

export interface CvCheck {
  readonly n: number;
  readonly cv: number;
  /** 3/√n: three asymptotic standard deviations of the sample CV under exponentiality. */
  readonly tolerance: number;
  readonly status: "consistent" | "departure" | "strong-departure" | "too-few";
}

export interface DispersionCheck {
  readonly bins: number;
  readonly binHours: number;
  readonly meanCount: number;
  readonly varianceCount: number;
  readonly index: number;
  readonly pValue: number;
  readonly status: "consistent" | "departure" | "too-few";
}

/**
 * Split-half rate test (added in estimator 1.1.0 after Task 8 found a blind spot):
 * under a constant rate, the count in the first half of the window is Binomial(n, 1/2).
 * Two-sided exact p-value; p < 0.01 suggests the rate changed during the window.
 */
export interface RateDriftCheck {
  readonly firstHalf: number;
  readonly secondHalf: number;
  readonly firstRatePerHour: number;
  readonly secondRatePerHour: number;
  readonly pValue: number;
  readonly status: "consistent" | "departure" | "too-few";
}

export function binomialTwoSidedHalf(k: number, n: number): number {
  // P(X <= k) = I_{1/2}(n - k, k + 1); P(X >= k) = I_{1/2}(k, n - k + 1).
  const lower = k >= n ? 1 : regularizedIncompleteBeta(n - k, k + 1, 0.5);
  const upper = k <= 0 ? 1 : regularizedIncompleteBeta(k, n - k + 1, 0.5);
  return Math.min(1, 2 * Math.min(lower, upper));
}

export interface QueueImportReport {
  readonly ok: boolean;
  readonly estimator: string;
  readonly issues: readonly ImportIssue[];
  readonly file: { readonly name: string; readonly sha256: string; readonly header: readonly string[]; readonly dataRows: number; readonly synthetic: boolean };
  readonly options: {
    readonly mapping: QueueImportOptions["mapping"];
    readonly serviceDurationUnit: DurationUnit;
    readonly timezone: string;
    readonly duplicateRows: "drop" | "keep";
    readonly confidence: number;
  };
  readonly window: { readonly startUtc: string; readonly endUtc: string; readonly hours: number } | null;
  readonly counts: {
    readonly blankRows: number;
    readonly missingTimestamp: number;
    readonly invalidTimestamp: number;
    readonly missingTimezone: number;
    readonly assumedTimezone: number;
    readonly outsideWindow: number;
    readonly duplicateRowsDropped: number;
    readonly arrivalsInWindow: number;
    readonly serviceSamples: number;
    readonly serviceMissing: number;
    readonly serviceInvalid: number;
    readonly serviceNegative: number;
    readonly serviceZero: number;
  };
  readonly arrivalRate: { readonly perHour: number; readonly ciLow: number; readonly ciHigh: number; readonly n: number; readonly hours: number; readonly method: string; readonly formula: string } | null;
  readonly service: {
    readonly n: number;
    readonly meanHours: number;
    readonly sdHours: number;
    readonly meanCiLowHours: number;
    readonly meanCiHighHours: number;
    readonly ratePerHour: number;
    readonly rateCiLow: number;
    readonly rateCiHigh: number;
    readonly formula: string;
  } | null;
  readonly fit: {
    readonly interarrivalCv: CvCheck | null;
    readonly serviceCv: CvCheck | null;
    readonly dispersion: DispersionCheck | null;
    readonly rateDrift: RateDriftCheck | null;
  };
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function cvCheck(values: readonly number[]): CvCheck | null {
  if (values.length === 0) return null;
  const n = values.length;
  if (n < 10) return { n, cv: Number.NaN, tolerance: Number.NaN, status: "too-few" };
  const s = summarize(values);
  const cv = s.sd / s.mean;
  const tolerance = 3 / Math.sqrt(n);
  const dev = Math.abs(cv - 1);
  return { n, cv, tolerance, status: dev <= tolerance ? "consistent" : dev > Math.max(0.3, tolerance) ? "strong-departure" : "departure" };
}

function round(x: number, digits = 4): string {
  return String(Number(x.toPrecision(digits)));
}

export function csvHeader(text: string): readonly string[] {
  return parseCsv(text).header;
}

export async function estimateQueueInputs(text: string, opts: QueueImportOptions): Promise<QueueImportReport> {
  const issues: ImportIssue[] = [];
  const confidence = opts.confidence ?? 0.95;
  const duplicateRows = opts.duplicateRows ?? "drop";
  const tzLabel =
    opts.timezone.assumeOffsetMinutes === null
      ? "explicit offsets required"
      : `assume UTC${opts.timezone.assumeOffsetMinutes >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(opts.timezone.assumeOffsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(opts.timezone.assumeOffsetMinutes) % 60).padStart(2, "0")} when missing`;
  const counts = {
    blankRows: 0, missingTimestamp: 0, invalidTimestamp: 0, missingTimezone: 0, assumedTimezone: 0, outsideWindow: 0, duplicateRowsDropped: 0,
    arrivalsInWindow: 0, serviceSamples: 0, serviceMissing: 0, serviceInvalid: 0, serviceNegative: 0, serviceZero: 0,
  };
  const sha256 = await sha256Hex(text);
  const base = {
    estimator: QUEUE_ESTIMATOR_ID,
    options: { mapping: opts.mapping, serviceDurationUnit: opts.serviceDurationUnit, timezone: tzLabel, duplicateRows, confidence },
  };
  const fail = (header: readonly string[], dataRows: number, window: QueueImportReport["window"] = null): QueueImportReport => ({
    ...base, ok: false, issues, file: { name: opts.fileName, sha256, header, dataRows, synthetic: opts.synthetic }, window, counts,
    arrivalRate: null, service: null, fit: { interarrivalCv: null, serviceCv: null, dispersion: null, rateDrift: null },
  });

  let csv;
  try {
    csv = parseCsv(text);
  } catch (e) {
    issues.push({ severity: "error", code: "csv-parse", message: e instanceof CsvError ? e.message : String(e) });
    return fail([], 0);
  }
  const { header, rows, lineNumbers } = csv;
  if (!(opts.confidence === undefined || (confidence > 0 && confidence < 1))) {
    issues.push({ severity: "error", code: "bad-confidence", message: "confidence must be in (0, 1)" });
  }
  if (!(opts.serviceDurationUnit in HOURS_PER)) issues.push({ severity: "error", code: "bad-unit", message: `unknown duration unit "${opts.serviceDurationUnit}"` });
  const ai = header.indexOf(opts.mapping.arrivalTime);
  const si = opts.mapping.serviceDuration === null ? -1 : header.indexOf(opts.mapping.serviceDuration);
  if (ai < 0) issues.push({ severity: "error", code: "missing-column", message: `arrival-time column "${opts.mapping.arrivalTime}" not found; columns are: ${header.join(", ")}` });
  if (opts.mapping.serviceDuration !== null && si < 0)
    issues.push({ severity: "error", code: "missing-column", message: `service-duration column "${opts.mapping.serviceDuration}" not found; columns are: ${header.join(", ")}` });
  if (opts.mapping.serviceDuration !== null && si === ai) issues.push({ severity: "error", code: "same-column", message: "arrival time and service duration must be different columns" });

  // Observation window (explicit, required).
  const ws = parseTimestamp(opts.observationWindow.start ?? "", opts.timezone);
  const we = parseTimestamp(opts.observationWindow.end ?? "", opts.timezone);
  let window: QueueImportReport["window"] = null;
  if (!ws.ok) issues.push({ severity: "error", code: "window-start", message: `observation start: ${ws.message}` });
  if (!we.ok) issues.push({ severity: "error", code: "window-end", message: `observation end: ${we.message}` });
  if (ws.ok && we.ok) {
    if (!(we.ms > ws.ms)) issues.push({ severity: "error", code: "window-order", message: "observation end must be after observation start" });
    else window = { startUtc: formatUtc(ws.ms), endUtc: formatUtc(we.ms), hours: (we.ms - ws.ms) / 3_600_000 };
  }
  if (rows.length === 0) issues.push({ severity: "error", code: "no-rows", message: "the file has a header but no data rows" });
  if (issues.some((i) => i.severity === "error") || !window || !ws.ok || !we.ok) return fail(header, rows.length, window);

  const lines: Record<string, number[]> = {};
  const note = (code: string, line: number) => {
    const l = (lines[code] ??= []);
    if (l.length < 10) l.push(line);
  };
  const seen = new Set<string>();
  const arrivals: number[] = [];
  const services: number[] = [];
  const unitFactor = HOURS_PER[opts.serviceDurationUnit];
  rows.forEach((row, idx) => {
    const line = lineNumbers[idx]!;
    if (row.every((c) => c.trim() === "")) {
      counts.blankRows++;
      return;
    }
    const tRaw = (row[ai] ?? "").trim();
    if (tRaw === "") {
      counts.missingTimestamp++;
      note("missing-timestamp", line);
      return;
    }
    const t = parseTimestamp(tRaw, opts.timezone);
    if (!t.ok) {
      if (t.code === "missing-timezone") {
        counts.missingTimezone++;
        note("missing-timezone", line);
      } else {
        counts.invalidTimestamp++;
        note("invalid-timestamp", line);
      }
      return;
    }
    if (t.assumedOffset) counts.assumedTimezone++;
    const sRaw = si >= 0 ? (row[si] ?? "").trim() : "";
    const key = `${t.ms}|${sRaw}`;
    if (seen.has(key) && duplicateRows === "drop") {
      counts.duplicateRowsDropped++;
      note("duplicate-row", line);
      return;
    }
    seen.add(key);
    if (t.ms < ws.ms || t.ms >= we.ms) {
      counts.outsideWindow++;
      note("outside-window", line);
      return;
    }
    arrivals.push(t.ms);
    if (si < 0) return;
    if (sRaw === "") {
      counts.serviceMissing++;
      note("service-missing", line);
      return;
    }
    if (!NUM_RE.test(sRaw)) {
      counts.serviceInvalid++;
      note("service-invalid", line);
      return;
    }
    const v = Number(sRaw);
    if (v < 0) {
      counts.serviceNegative++;
      note("service-negative", line);
      return;
    }
    if (v === 0) {
      counts.serviceZero++;
      note("service-zero", line);
    }
    services.push(v * unitFactor);
  });
  counts.arrivalsInWindow = arrivals.length;
  counts.serviceSamples = services.length;

  const warn = (code: string, n: number, message: string) => {
    if (n > 0) issues.push({ severity: "warning", code, message, lines: lines[code] ?? [] });
  };
  warn("missing-timestamp", counts.missingTimestamp, `${counts.missingTimestamp} row(s) have no arrival time and were excluded`);
  warn("invalid-timestamp", counts.invalidTimestamp, `${counts.invalidTimestamp} row(s) with unreadable or impossible arrival times were excluded`);
  warn("missing-timezone", counts.missingTimezone, `${counts.missingTimezone} row(s) were excluded because their arrival time has no time zone offset; choose an offset to assume or fix the file`);
  warn("duplicate-row", counts.duplicateRowsDropped, `${counts.duplicateRowsDropped} exact duplicate row(s) were dropped`);
  warn("outside-window", counts.outsideWindow, `${counts.outsideWindow} arrival(s) fall outside the observation window and were not counted`);
  warn("service-missing", counts.serviceMissing, `${counts.serviceMissing} arrival(s) have no service duration (they still count as arrivals)`);
  warn("service-invalid", counts.serviceInvalid, `${counts.serviceInvalid} service duration(s) are not numbers (decimal point "." expected) and were excluded`);
  warn("service-negative", counts.serviceNegative, `${counts.serviceNegative} negative service duration(s) were excluded`);
  warn("service-zero", counts.serviceZero, `${counts.serviceZero} service duration(s) are exactly 0; check for rounding or missing values`);
  if (counts.assumedTimezone > 0) {
    issues.push({ severity: "warning", code: "assumed-timezone", message: `${counts.assumedTimezone} timestamp(s) had no offset; ${tzLabel}. Daylight-saving changes are not applied.` });
  }
  if (arrivals.length === 0) {
    issues.push({ severity: "error", code: "no-arrivals", message: "no valid arrivals fall inside the observation window, so the arrival rate cannot be estimated" });
    return fail(header, rows.length, window);
  }
  if (si >= 0 && services.length < 2) {
    issues.push({ severity: "error", code: "few-services", message: `only ${services.length} valid service duration(s); at least 2 are needed to estimate the service rate` });
    return fail(header, rows.length, window);
  }

  const T = window.hours;
  const n = arrivals.length;
  const lam = n / T;
  const lamCi = poissonRateInterval(n, T, confidence);
  const arrivalRate = {
    perHour: lam, ciLow: lamCi.low, ciHigh: lamCi.high, n, hours: T,
    method: `exact Poisson (Garwood) ${confidence * 100}% interval`,
    formula: `λ̂ = n / T = ${n} arrivals / ${round(T, 6)} h = ${round(lam)} per hour`,
  };
  if (n < 30) issues.push({ severity: "warning", code: "few-arrivals", message: `only ${n} arrivals; the rate estimate is very uncertain` });

  let service: QueueImportReport["service"] = null;
  if (si >= 0) {
    const s = summarize(services, confidence);
    const meanHours = s.mean;
    if (!(meanHours > 0)) {
      issues.push({ severity: "error", code: "zero-service", message: "mean service duration is 0, so the service rate is undefined" });
      return fail(header, rows.length, window);
    }
    service = {
      n: services.length, meanHours, sdHours: s.sd, meanCiLowHours: s.ciLow, meanCiHighHours: s.ciHigh,
      ratePerHour: 1 / meanHours,
      rateCiLow: s.ciHigh > 0 ? 1 / s.ciHigh : 0,
      rateCiHigh: s.ciLow > 0 ? 1 / s.ciLow : Number.POSITIVE_INFINITY,
      formula: `μ̂ = 1 / mean service = 1 / ${round(meanHours * 60)} min = 1 / ${round(meanHours)} h = ${round(1 / meanHours)} per hour`,
    };
    if (meanHours > T) issues.push({ severity: "warning", code: "unit-suspicious", message: `mean service (${round(meanHours)} h) exceeds the observation window; check the duration unit` });
    if (meanHours < 1 / 3600) issues.push({ severity: "warning", code: "unit-suspicious", message: "mean service is under one second; check the duration unit" });
  }

  const sorted = [...arrivals].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => (t - sorted[i]!) / 3_600_000);
  const interarrivalCv = cvCheck(gaps);
  const serviceCv = si >= 0 ? cvCheck(services) : null;

  const binHours = opts.dispersionBinHours ?? 1;
  const k = Math.floor(T / binHours);
  let dispersion: DispersionCheck | null = null;
  if (k >= 2) {
    const binCounts = new Array<number>(k).fill(0);
    for (const t of arrivals) {
      const b = Math.floor((t - ws.ms) / (binHours * 3_600_000));
      if (b < k) binCounts[b]!++;
    }
    const s = summarize(binCounts);
    const index = s.mean > 0 ? (s.sd * s.sd) / s.mean : Number.NaN;
    const stat = (k - 1) * index;
    const cdf = Number.isFinite(stat) ? chiSquareCdf(stat, k - 1) : Number.NaN;
    const pValue = Number.isFinite(cdf) ? Math.min(1, 2 * Math.min(cdf, 1 - cdf)) : Number.NaN;
    dispersion = {
      bins: k, binHours, meanCount: s.mean, varianceCount: s.sd * s.sd, index, pValue,
      status: !Number.isFinite(pValue) || s.mean * k < 20 ? "too-few" : pValue < 0.01 ? "departure" : "consistent",
    };
  }
  const fitWarn = (what: string, c: CvCheck | null, meaning: string) => {
    if (c && (c.status === "departure" || c.status === "strong-departure")) {
      issues.push({ severity: "warning", code: "fit-cv", message: `${what} have CV ${round(c.cv, 3)} (exponential ≈ 1, tolerance ±${round(c.tolerance, 2)}): ${meaning}` });
    }
  };
  fitWarn("Interarrival times", interarrivalCv, "arrivals may not be a Poisson process, so M/M/c results may be misleading");
  fitWarn("Service times", serviceCv, "service times may not be exponential, so M/M/c results may be misleading");
  if (dispersion?.status === "departure") {
    issues.push({ severity: "warning", code: "fit-dispersion", message: `arrival counts per ${binHours} h vary more or less than a constant-rate Poisson process (dispersion index ${round(dispersion.index, 3)}, p = ${dispersion.pValue.toExponential(2)}); the arrival rate may change over time` });
  }

  const mid = ws.ms + (we.ms - ws.ms) / 2;
  const firstHalf = arrivals.filter((t) => t < mid).length;
  const secondHalf = n - firstHalf;
  const driftP = binomialTwoSidedHalf(firstHalf, n);
  const rateDrift: RateDriftCheck = {
    firstHalf,
    secondHalf,
    firstRatePerHour: firstHalf / (T / 2),
    secondRatePerHour: secondHalf / (T / 2),
    pValue: driftP,
    // With n < 20 even a 100%/0% split is not significant at 1%: report "too few".
    status: n < 20 ? "too-few" : driftP < 0.01 ? "departure" : "consistent",
  };
  if (rateDrift.status === "departure") {
    issues.push({
      severity: "warning",
      code: "fit-rate-drift",
      message: `the arrival rate differs between the first and second half of the window (${round(rateDrift.firstRatePerHour, 3)} vs ${round(rateDrift.secondRatePerHour, 3)} per hour, p = ${driftP.toExponential(2)}). One average rate may not describe this period; consider a shorter window that matches the period you want to model.`,
    });
  }

  return {
    ...base, ok: true, issues, file: { name: opts.fileName, sha256, header, dataRows: rows.length, synthetic: opts.synthetic }, window, counts,
    arrivalRate, service, fit: { interarrivalCv, serviceCv, dispersion, rateDrift },
  };
}
