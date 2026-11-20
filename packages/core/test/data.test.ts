import { describe, expect, it } from "vitest";
import fc from "fast-check";
import "../src/index";
import { parseCsv, CsvError } from "../src/data/csv";
import { parseTimestamp } from "../src/data/timestamps";
import { estimateQueueInputs, type QueueImportOptions } from "../src/data/queueInputs";
import { generateSyntheticArrivalLog } from "../src/data/synthetic";
import { forkFromEstimate } from "../src/data/applyEstimate";
import { chiSquareQuantile, poissonRateInterval, regularizedGammaP } from "../src/stats/gamma";
import { createBaseline, runScenario, reproduce } from "../src/scenario/scenario";
import { exportBundle, importBundle } from "../src/scenario/bundle";
import { ScenarioError } from "../src/scenario/types";
import { createStream } from "../src/rng";

const opts = (over: Partial<QueueImportOptions> = {}): QueueImportOptions => ({
  fileName: "log.csv",
  synthetic: true,
  mapping: { arrivalTime: "arrival_time", serviceDuration: "service_minutes" },
  serviceDurationUnit: "minutes",
  observationWindow: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T10:00:00Z" },
  timezone: { assumeOffsetMinutes: null },
  ...over,
});
const codes = (r: { issues: readonly { code: string; severity: string }[] }, sev: "error" | "warning") => r.issues.filter((i) => i.severity === sev).map((i) => i.code);

describe("chi-square and Poisson intervals", () => {
  it("match published values", () => {
    expect(chiSquareQuantile(0.95, 1)).toBeCloseTo(3.841459, 5);
    expect(chiSquareQuantile(0.975, 10)).toBeCloseTo(20.483177, 5);
    expect(chiSquareQuantile(0.025, 10)).toBeCloseTo(3.246973, 5);
    expect(regularizedGammaP(1, 2)).toBeCloseTo(1 - Math.exp(-2), 14);
    // Exact 95% Poisson interval for 10 events: [4.7954, 18.3904].
    const ci = poissonRateInterval(10, 1, 0.95);
    expect(ci.low).toBeCloseTo(4.7954, 3);
    expect(ci.high).toBeCloseTo(18.3904, 3);
    expect(poissonRateInterval(0, 2, 0.95).low).toBe(0);
  });
});

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and a trailing newline", () => {
    const p = parseCsv('\ufeffa,"b ""x"""\r\n1,"two, three"\r\n3,4\r\n');
    expect(p.header).toEqual(["a", 'b "x"']);
    expect(p.rows).toEqual([["1", "two, three"], ["3", "4"]]);
    expect(p.lineNumbers).toEqual([2, 3]);
  });
  it("rejects unterminated quotes, empty files and duplicate column names", () => {
    expect(() => parseCsv('a,b\n1,"oops\n')).toThrow(CsvError);
    expect(() => parseCsv("")).toThrow(/empty/);
    expect(() => parseCsv("a,a\n1,2\n")).toThrow(/duplicate column/);
  });
});

describe("timestamps", () => {
  it("parses explicit offsets to the same instant", () => {
    const a = parseTimestamp("2026-03-02T08:00:00Z", { assumeOffsetMinutes: null });
    const b = parseTimestamp("2026-03-02T03:00:00-05:00", { assumeOffsetMinutes: null });
    const c = parseTimestamp("2026-03-02 13:30:00+0530", { assumeOffsetMinutes: null });
    expect(a.ok && b.ok && c.ok && a.ms === b.ms && b.ms === c.ms).toBe(true);
  });
  it("requires a time zone unless an offset is explicitly assumed", () => {
    const r = parseTimestamp("2026-03-02T08:00:00", { assumeOffsetMinutes: null });
    expect(r.ok === false && r.code).toBe("missing-timezone");
    const s = parseTimestamp("2026-03-02T08:00:00", { assumeOffsetMinutes: 60 });
    expect(s.ok && s.assumedOffset && s.ms).toBe(Date.UTC(2026, 2, 2, 7));
  });
  it("rejects malformed and impossible dates", () => {
    for (const bad of ["03/02/2026 08:00", "2026-02-30T00:00:00Z", "2026-03-02T24:00:00Z", "2026-03-02T08:00:60Z", "2026-03-02T08:00:00+15:00", "tomorrow"]) {
      expect(parseTimestamp(bad, { assumeOffsetMinutes: null }).ok).toBe(false);
    }
  });
});

describe("estimator: explicit observation window and unit conversion", () => {
  const csv = "arrival_time,service_minutes\n2026-03-02T01:00:00Z,30\n2026-03-02T02:00:00Z,90\n2026-03-02T03:00:00Z,60\n2026-03-02T04:00:00Z,60\n";

  it("uses n / T over the stated window, not first-to-last arrival", async () => {
    const r = await estimateQueueInputs(csv, opts());
    expect(r.ok).toBe(true);
    // 4 arrivals in a 10 h window → 0.4/h. (First-to-last would give 4 / 3 h ≈ 1.33/h.)
    expect(r.arrivalRate!.perHour).toBeCloseTo(0.4, 12);
    expect(r.window!.hours).toBe(10);
    expect(r.arrivalRate!.formula).toContain("4 arrivals / 10 h");
    expect(codes(r, "warning")).toContain("few-arrivals");
  });

  it("converts the mean service duration to a rate per hour in every unit", async () => {
    const m = await estimateQueueInputs(csv, opts());
    expect(m.service!.meanHours).toBeCloseTo(1, 12); // mean 60 min
    expect(m.service!.ratePerHour).toBeCloseTo(1, 12);
    const sec = await estimateQueueInputs(csv.replace("service_minutes", "service_seconds"), opts({ mapping: { arrivalTime: "arrival_time", serviceDuration: "service_seconds" }, serviceDurationUnit: "seconds" }));
    expect(sec.service!.ratePerHour).toBeCloseTo(60, 9); // mean 60 s → 60/h
    const hrs = await estimateQueueInputs(csv, opts({ serviceDurationUnit: "hours", observationWindow: { start: "2026-03-02T00:00:00Z", end: "2026-03-10T00:00:00Z" } }));
    expect(hrs.service!.ratePerHour).toBeCloseTo(1 / 60, 12);
    expect(hrs.service!.rateCiLow).toBeLessThanOrEqual(hrs.service!.ratePerHour);
  });

  it("window is half-open [start, end); arrivals outside it are excluded with a warning", async () => {
    const r = await estimateQueueInputs(csv, opts({ observationWindow: { start: "2026-03-02T02:00:00Z", end: "2026-03-02T04:00:00Z" } }));
    expect(r.counts.arrivalsInWindow).toBe(2);
    expect(r.counts.outsideWindow).toBe(2);
    expect(codes(r, "warning")).toContain("outside-window");
  });

  it("window offsets are honoured", async () => {
    const r = await estimateQueueInputs(csv, opts({ observationWindow: { start: "2026-03-01T19:00:00-05:00", end: "2026-03-02T05:00:00-05:00" } }));
    expect(r.window!.startUtc).toBe("2026-03-02T00:00:00.000Z");
    expect(r.counts.arrivalsInWindow).toBe(4);
  });
});

describe("estimator: invalid imports", () => {
  const ok = "arrival_time,service_minutes\n2026-03-02T01:00:00Z,30\n2026-03-02T02:00:00Z,30\n";
  it("rejects invalid or missing observation windows", async () => {
    expect(codes(await estimateQueueInputs(ok, opts({ observationWindow: { start: "2026-03-02T05:00:00Z", end: "2026-03-02T05:00:00Z" } })), "error")).toContain("window-order");
    expect(codes(await estimateQueueInputs(ok, opts({ observationWindow: { start: "", end: "2026-03-02T05:00:00Z" } })), "error")).toContain("window-start");
    expect(codes(await estimateQueueInputs(ok, opts({ observationWindow: { start: "2026-03-02T00:00:00", end: "2026-03-02T05:00:00Z" } })), "error")).toContain("window-start");
  });
  it("rejects unknown columns and lists available ones", async () => {
    const r = await estimateQueueInputs(ok, opts({ mapping: { arrivalTime: "time", serviceDuration: null } }));
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toContain("arrival_time, service_minutes");
  });
  it("rejects files with no data or no arrivals in the window", async () => {
    expect(codes(await estimateQueueInputs("arrival_time,service_minutes\n", opts()), "error")).toContain("no-rows");
    expect(codes(await estimateQueueInputs(ok, opts({ observationWindow: { start: "2027-01-01T00:00:00Z", end: "2027-01-02T00:00:00Z" } })), "error")).toContain("no-arrivals");
    expect(codes(await estimateQueueInputs('a,b\n"x', opts()), "error")).toContain("csv-parse");
  });
  it("excludes and reports malformed values, missing data, duplicates, negatives and zeros", async () => {
    const messy = [
      "arrival_time,service_minutes,clerk",
      "2026-03-02T01:00:00Z,30,a",
      "2026-03-02T01:00:00Z,30,a", // exact duplicate (same timestamp and duration)
      "2026-03-02T02:00:00Z,-5,b", // negative
      "2026-03-02T03:00:00Z,,b", // missing duration
      "2026-03-02T03:30:00Z,1,5,c", // comma decimal splits into an extra field → duration "1"
      "2026-03-02T04:00:00Z,abc,c", // not a number
      "03/02/2026 05:00,30,c", // malformed timestamp
      "2026-03-02T06:00:00,30,c", // no time zone
      ",30,c", // missing timestamp
      ",,", // blank
      "2026-03-02T07:00:00Z,0,d", // zero
      "2026-03-02T08:00:00Z,40,d",
    ].join("\n");
    const r = await estimateQueueInputs(messy, opts());
    expect(r.ok).toBe(true);
    expect(r.counts).toMatchObject({
      duplicateRowsDropped: 1, serviceNegative: 1, serviceMissing: 1, serviceInvalid: 1, invalidTimestamp: 1,
      missingTimezone: 1, missingTimestamp: 1, blankRows: 1, serviceZero: 1,
    });
    // Arrivals counted: 01:00, 02:00, 03:00, 03:30, 04:00, 07:00, 08:00 = 7.
    expect(r.counts.arrivalsInWindow).toBe(7);
    expect(r.counts.serviceSamples).toBe(4); // 30, 1, 0, 40
    const w = codes(r, "warning");
    for (const c of ["duplicate-row", "service-negative", "service-missing", "service-invalid", "invalid-timestamp", "missing-timezone", "missing-timestamp", "service-zero"]) expect(w).toContain(c);
    expect(r.issues.find((i) => i.code === "service-negative")!.lines).toEqual([4]);
    const kept = await estimateQueueInputs(messy, opts({ duplicateRows: "keep" }));
    expect(kept.counts.arrivalsInWindow).toBe(8);
  });
  it("counts timestamps that needed an assumed offset and warns about it", async () => {
    const r = await estimateQueueInputs("arrival_time,service_minutes\n2026-03-02T01:00:00,30\n2026-03-02T02:00:00,30\n", opts({ timezone: { assumeOffsetMinutes: 0 } }));
    expect(r.counts.assumedTimezone).toBe(2);
    expect(codes(r, "warning")).toContain("assumed-timezone");
  });
  it("flags a suspicious duration unit", async () => {
    const r = await estimateQueueInputs("arrival_time,service_minutes\n2026-03-02T01:00:00Z,30\n2026-03-02T02:00:00Z,30\n", opts({ serviceDurationUnit: "hours" }));
    expect(codes(r, "warning")).toContain("unit-suspicious");
  });
});

describe("estimator: recovers known parameters from SYNTHETIC data", () => {
  const spec = { arrivalRatePerHour: 1.5, meanServiceMinutes: 50, start: "2026-03-02T00:00:00Z", hours: 400 };
  const run = (seed: number) => {
    const log = generateSyntheticArrivalLog({ ...spec, seed });
    return estimateQueueInputs(log.csv, opts({ observationWindow: { start: log.windowStart, end: log.windowEnd }, confidence: 0.95 }));
  };

  it("fixed seed: true values inside the intervals, and fit checks consistent", async () => {
    const r = await run(424242);
    expect(r.ok).toBe(true);
    expect(r.arrivalRate!.ciLow).toBeLessThan(1.5);
    expect(r.arrivalRate!.ciHigh).toBeGreaterThan(1.5);
    expect(r.service!.rateCiLow).toBeLessThan(1.2);
    expect(r.service!.rateCiHigh).toBeGreaterThan(1.2);
    expect(r.fit.interarrivalCv!.status).toBe("consistent");
    expect(r.fit.serviceCv!.status).toBe("consistent");
  });

  it("coverage over 200 independent synthetic datasets is close to the nominal 95%", async () => {
    let lamHit = 0;
    let muHit = 0;
    const N = 200;
    for (let s = 0; s < N; s++) {
      const r = await run(1000 + s);
      if (r.arrivalRate!.ciLow <= 1.5 && 1.5 <= r.arrivalRate!.ciHigh) lamHit++;
      if (r.service!.rateCiLow <= 1.2 && 1.2 <= r.service!.rateCiHigh) muHit++;
    }
    // Binomial(200, 0.95) has SD ≈ 1.5 percentage points; [0.90, 0.99] is more than ±3 SD.
    expect(lamHit / N).toBeGreaterThanOrEqual(0.9);
    expect(lamHit / N).toBeLessThanOrEqual(0.99);
    expect(muHit / N).toBeGreaterThanOrEqual(0.9);
    expect(muHit / N).toBeLessThanOrEqual(0.99);
  });

  it("flags constant service times and a time-varying arrival rate as poor M/M/c fits", async () => {
    const lines = ["arrival_time,service_minutes"];
    // Random Poisson arrivals at 3/h for 100 h, then 0.5/h for 100 h; constant 20-minute service.
    const rng = createStream(77, "nonstationary", 0);
    let t = Date.UTC(2026, 2, 2);
    const end1 = t + 100 * 3_600_000;
    const end2 = end1 + 100 * 3_600_000;
    while (t < end2) {
      t += rng.exponential(t < end1 ? 3 : 0.5) * 3_600_000;
      if (t < end2) lines.push(`${new Date(Math.floor(t)).toISOString()},20`);
    }
    const r = await estimateQueueInputs(lines.join("\n"), opts({ observationWindow: { start: "2026-03-02T00:00:00Z", end: new Date(end2).toISOString() } }));
    expect(r.fit.serviceCv!.status).toBe("strong-departure");
    expect(r.fit.dispersion!.status).toBe("departure");
    expect(codes(r, "warning")).toEqual(expect.arrayContaining(["fit-cv", "fit-dispersion"]));
  });

  it("KNOWN BLIND SPOT: regular arrivals with a rate change can pass both arrival checks", async () => {
    // Deterministic arrivals: every 20 min for 100 h, then every 2 h for 100 h. This is clearly not
    // Poisson, but regularity lowers the dispersion index while the rate change raises it, and the
    // mixture of two gap lengths happens to give an interarrival CV near 1. Both checks pass.
    // Documented limitation: passing the checks does not show the M/M/c assumptions hold.
    const lines = ["arrival_time,service_minutes"];
    let t = Date.UTC(2026, 2, 2);
    const end1 = t + 100 * 3_600_000;
    const end2 = end1 + 100 * 3_600_000;
    while (t < end2) {
      t += (t < end1 ? 20 : 120) * 60_000;
      if (t < end2) lines.push(`${new Date(t).toISOString()},20`);
    }
    const r = await estimateQueueInputs(lines.join("\n"), opts({ observationWindow: { start: "2026-03-02T00:00:00Z", end: new Date(end2).toISOString() } }));
    expect(r.fit.dispersion!.status).toBe("consistent");
    expect(r.fit.interarrivalCv!.status).toBe("consistent");
    expect(r.fit.interarrivalCv!.cv).toBeGreaterThan(0.95);
    // The constant service times are still caught.
    expect(r.fit.serviceCv!.status).toBe("strong-departure");
    // Task 8: the split-half rate test (estimator 1.1.0) catches the rate change itself.
    // Arrivals at 20, 40, …, 6000 min, then every 120 min until 12000. The one at exactly 6000 min (the
    // midpoint) belongs to the second half, since halves are [start, mid) and [mid, end): 299 + 50.
    expect(r.fit.rateDrift!.firstHalf).toBe(299);
    expect(r.fit.rateDrift!.secondHalf).toBe(50);
    expect(r.fit.rateDrift!.status).toBe("departure");
    expect(codes(r, "warning")).toContain("fit-rate-drift");
  });

  it("split-half rate test: exact binomial p-value matches a hand calculation", async () => {
    // 3 arrivals in the first half, 0 in the second: P(X ≥ 3 | n=3, p=0.5) = 1/8, two-sided p = 0.25.
    const csv = "arrival_time,service_minutes\n2026-03-02T01:00:00Z,1\n2026-03-02T02:00:00Z,1\n2026-03-02T03:00:00Z,1\n";
    const r = await estimateQueueInputs(csv, opts({ observationWindow: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T08:00:00Z" } }));
    expect(r.fit.rateDrift!.pValue).toBeCloseTo(0.25, 12);
    expect(r.fit.rateDrift!.status).toBe("too-few");
  });

  it("split-half rate test: false-alarm rate on stationary SYNTHETIC data is near its 1% level", async () => {
    let alarms = 0;
    const N = 200;
    for (let s = 0; s < N; s++) {
      const r = await run(5000 + s);
      if (r.fit.rateDrift!.status === "departure") alarms++;
    }
    // Expected 1% (2 of 200); P(Binomial(200, 0.01) ≥ 9) < 0.001.
    expect(alarms / N).toBeLessThanOrEqual(0.04);
  });

  it("property: estimation is deterministic and independent of row order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 10_000 }), async (seed) => {
        const log = generateSyntheticArrivalLog({ ...spec, hours: 40, seed });
        const [head, ...rows] = log.csv.trim().split("\n");
        const shuffled = [head, ...rows.reverse()].join("\n");
        const o = opts({ observationWindow: { start: log.windowStart, end: log.windowEnd } });
        const a = await estimateQueueInputs(log.csv, o);
        const b = await estimateQueueInputs(shuffled, o);
        return a.arrivalRate!.perHour === b.arrivalRate!.perHour && Math.abs(a.service!.meanHours - b.service!.meanHours) < 1e-12;
      }),
      { numRuns: 20 },
    );
  });
});

describe("applying estimates: overrides, provenance and fingerprints", () => {
  const log = generateSyntheticArrivalLog({ seed: 424242, arrivalRatePerHour: 1.5, meanServiceMinutes: 50, start: "2026-03-02T00:00:00Z", hours: 400 });
  const imp = () => estimateQueueInputs(log.csv, opts({ fileName: "clinic-arrivals-SYNTHETIC.csv", observationWindow: { start: log.windowStart, end: log.windowEnd } }));
  let k = 0;
  const parent = () =>
    createBaseline({ name: "Base", modelId: "queue.mmc", modelVersion: "1.1.0", settings: { warmup: 20, horizon: 220 }, masterSeed: 1, replications: 3 }, () => `p${++k}`);

  it("accepting estimates applies them and records full provenance in the fingerprint", async () => {
    const r = await imp();
    const p = await parent();
    const f = await forkFromEstimate(p, r, { name: "From data", id: "f1" });
    expect(f.spec.params.arrivalRatePerHour).toBe(r.arrivalRate!.perHour);
    expect(f.spec.params.serviceRatePerHour).toBe(r.service!.ratePerHour);
    const pv = f.spec.dataProvenance!;
    expect(pv).toMatchObject({
      fileName: "clinic-arrivals-SYNTHETIC.csv", sha256: r.file.sha256, synthetic: true, estimator: "queue-inputs-csv@1.1.0",
      windowStartUtc: log.windowStart, arrivalColumn: "arrival_time", serviceColumn: "service_minutes", serviceDurationUnit: "minutes",
      arrivalRateOverridden: false, serviceRateOverridden: false,
    });
    expect(f.changesFromParent.map((c) => c.path)).toEqual(["params.arrivalRatePerHour", "params.serviceRatePerHour", "dataProvenance"]);
    expect(f.changesFromParent.at(-1)!.to).toMatch(/^SYNTHETIC clinic-arrivals-SYNTHETIC\.csv \[record [0-9a-f]{8}\]$/);
    expect(p.spec.dataProvenance).toBeNull(); // parent untouched
  });

  it("overrides are applied and recorded, and change the fingerprint", async () => {
    const r = await imp();
    const p = await parent();
    const a = await forkFromEstimate(p, r, { name: "a", id: "a" });
    const b = await forkFromEstimate(p, r, { name: "b", id: "b", arrivalRateOverride: 2 });
    expect(b.spec.params.arrivalRatePerHour).toBe(2);
    expect(b.spec.params.serviceRatePerHour).toBe(r.service!.ratePerHour);
    expect(b.spec.dataProvenance).toMatchObject({ appliedArrivalRatePerHour: 2, arrivalRateOverridden: true, estimatedArrivalRatePerHour: r.arrivalRate!.perHour });
    expect(b.fingerprint).not.toBe(a.fingerprint);
    await expect(forkFromEstimate(p, r, { name: "x", serviceRateOverride: -1 })).rejects.toThrow(ScenarioError);
  });

  it("a different file (same estimates impossible to tell apart otherwise) gives a different fingerprint", async () => {
    const r1 = await imp();
    const r2 = await estimateQueueInputs(log.csv + "\n", opts({ fileName: "clinic-arrivals-SYNTHETIC.csv", observationWindow: { start: log.windowStart, end: log.windowEnd } }));
    expect(r2.arrivalRate!.perHour).toBe(r1.arrivalRate!.perHour);
    const p = await parent();
    const a = await forkFromEstimate(p, r1, { name: "a", id: "a" });
    const b = await forkFromEstimate(p, r2, { name: "b", id: "b" });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("provenance survives run, export, import and reproduction", async () => {
    const f = await runScenario(await forkFromEstimate(await parent(), await imp(), { name: "From data", id: "fd" }));
    const back = (await importBundle(exportBundle([f]))).scenarios[0]!;
    expect(back.spec.dataProvenance).toEqual(f.spec.dataProvenance);
    expect((await reproduce(back)).status).toBe("identical");
  });

  it("refuses to apply a failed import", async () => {
    const bad = await estimateQueueInputs("arrival_time\n", opts({ mapping: { arrivalTime: "arrival_time", serviceDuration: null } }));
    await expect(forkFromEstimate(await parent(), bad, { name: "x" })).rejects.toThrow(/has errors/);
  });
});
