import { describe, expect, it } from "vitest";
import fc from "fast-check";
import "../src/index";
import { daypartModel, daypartSegments, nextArrivalTime, simulateScheduled, type Segment, type ScheduledSamplers } from "../src/models/daypart";
import { simulateQueue } from "../src/models/queue";
import { createStreams } from "../src/rng";
import { runReplications } from "../src/runner";
import { summarize } from "../src/stats/summary";
import { estimateBlockRates } from "../src/data/blockRates";
import { generateDailyPatternLog } from "../src/data/synthetic";

const fixed = (unitExp: number[], serv: number[]): ScheduledSamplers => {
  let i = 0;
  let j = 0;
  return { unitExponential: () => (i < unitExp.length ? unitExp[i++]! : 1e12), service: () => serv[j++]! };
};
const open = (start: number, end: number, ratePerHour: number, staff: number, block = 0): Segment => ({ start, end, ratePerHour, staff, closed: false, block });
const waits = (r: { arrival: readonly number[]; serviceStart: readonly number[] }) => r.arrival.map((a, i) => r.serviceStart[i]! - a);

/** Kiefer–Wolfowitz reference for a constant number of servers (valid for ANY arrival times). */
function kwWaits(c: number, arrivals: readonly number[], serv: readonly number[]): number[] {
  const free = new Array<number>(c).fill(0);
  return arrivals.map((a, n) => {
    free.sort((x, y) => x - y);
    const start = Math.max(a, free[0]!);
    free[0] = start + serv[n]!;
    return start - a;
  });
}

// Every mechanics test runs under both boundary policies (0.1.0 kept for reproducibility, 0.2.0 current).
describe.each(["0.1.0", "0.2.0"] as const)("boundary policy %s", (policy) => {
  const sim = (segs: readonly Segment[], smp: ScheduledSamplers) => simulateScheduled(segs, smp, policy);

  describe("piecewise-constant arrival generator (time change)", () => {
    it("crosses rate boundaries exactly: hand-computed example", () => {
      // Rates 2/h on [0,1), 0 on [1,3), 2/h on [3,4). From t = 0.4 with E = 2.0:
      // [0.4,1) contributes 1.2, [1,3) contributes 0, so 0.8 remains → 3 + 0.8/2 = 3.4.
      const segs = [open(0, 1, 2, 1), open(1, 3, 0, 1), open(3, 4, 2, 1)];
      expect(nextArrivalTime(0.4, 2.0, segs).time).toBeCloseTo(3.4, 12);
      expect(nextArrivalTime(0.4, 2.0, segs).index).toBe(2);
      expect(nextArrivalTime(3.9, 5, segs).time).toBe(Number.POSITIVE_INFINITY);
    });

    it("property: no arrivals ever fall in zero-rate intervals", () => {
      fc.assert(
        fc.property(fc.nat({ max: 0xffffffff }), (seed) => {
          const st = createStreams(seed, ["a", "s"], 0);
          const segs = [open(0, 2, 5, 3), open(2, 5, 0, 3, 1), open(5, 6, 8, 3, 2), open(6, 9, 0, 3, 3)];
          const r = sim(segs, { unitExponential: () => st["a"]!.exponential(1), service: () => st["s"]!.exponential(10) });
          return r.arrival.every((t) => (t < 2 || (t >= 5 && t < 6)) && t >= 0);
        }),
        { numRuns: 100 },
      );
    });

    it("counts per block match their Poisson means over many days (statistical check)", () => {
      const rates = [8, 14, 24, 14, 10, 6];
      const segs = daypartSegments(rates, [50, 50, 50, 50, 50, 50], 400);
      const st = createStreams(31, ["a", "s"], 0);
      const r = sim(segs, { unitExponential: () => st["a"]!.exponential(1), service: () => st["s"]!.exponential(100) });
      const counts = [0, 0, 0, 0, 0, 0];
      r.block.forEach((b) => counts[b]!++);
      rates.forEach((rate, b) => {
        const expected = rate * 2 * 400;
        // Poisson SD = √expected; 4 SD bound per block (6 checks; seeded, so deterministic).
        expect(Math.abs(counts[b]! - expected)).toBeLessThan(4 * Math.sqrt(expected));
      });
      expect(r.block.every((b) => b >= 0)).toBe(true); // nothing while closed
    });
  });

  describe("stationary special case reproduces the validated queue.mmc model", () => {
    it("one constant segment: identical arrivals and waits to queue.mmc, sample path by sample path", () => {
      fc.assert(
        fc.property(fc.nat({ max: 0xffffffff }), fc.integer({ min: 1, max: 4 }), fc.double({ min: 0.3, max: 3, noNaN: true }), (seed, c, lam) => {
          const H = 200;
          const s1 = createStreams(seed, ["arrivals", "service"], 0);
          const a = sim([open(0, H, lam, c)], { unitExponential: () => s1["arrivals"]!.exponential(1), service: () => s1["service"]!.exponential(1) });
          const s2 = createStreams(seed, ["arrivals", "service"], 0);
          const b = simulateQueue(c, { interarrival: () => s2["arrivals"]!.exponential(lam), service: () => s2["service"]!.exponential(1) }, { warmup: 0, horizon: H });
          expect(a.arrival).toEqual(b.customers.arrival);
          expect(waits(a)).toEqual(b.customers.arrival.map((x, i) => b.customers.serviceStart[i]! - x));
          // Time-integrated queue over the drained run equals total waiting in both models.
          const total = waits(a).reduce((s, w) => s + w, 0);
          expect(a.areaQueue).toBeCloseTo(total, 9);
        }),
        { numRuns: 60 },
      );
    });

    it("splitting one constant-rate period into many boundaries changes nothing beyond rounding", () => {
      const st1 = createStreams(5, ["a", "s"], 0);
      const one = sim([open(0, 100, 1.6, 2)], { unitExponential: () => st1["a"]!.exponential(1), service: () => st1["s"]!.exponential(1) });
      const st2 = createStreams(5, ["a", "s"], 0);
      const many = Array.from({ length: 50 }, (_, i) => open(i * 2, i * 2 + 2, 1.6, 2, i));
      const split = sim(many, { unitExponential: () => st2["a"]!.exponential(1), service: () => st2["s"]!.exponential(1) });
      expect(split.arrival.length).toBe(one.arrival.length);
      split.arrival.forEach((t, i) => expect(Math.abs(t - one.arrival[i]!)).toBeLessThan(1e-9));
    });
  });

  describe("queue mechanics with time-varying demand and staffing", () => {
    it("constant staff, time-varying arrivals: waits equal the Kiefer–Wolfowitz reference", () => {
      fc.assert(
        fc.property(fc.nat({ max: 0xffffffff }), fc.integer({ min: 1, max: 4 }), (seed, c) => {
          const st = createStreams(seed, ["a", "s"], 0);
          const segs = [open(0, 3, 1, c), open(3, 5, 6, c, 1), open(5, 6, 0, c, 2), open(6, 10, 2, c, 3)];
          const r = sim(segs, { unitExponential: () => st["a"]!.exponential(1), service: () => st["s"]!.exponential(2) });
          const serv = r.departure.map((d, i) => d - r.serviceStart[i]!);
          const ref = kwWaits(c, r.arrival, serv);
          return waits(r).every((w, i) => Math.abs(w - ref[i]!) < 1e-9);
        }),
        { numRuns: 100 },
      );
    });

    it("hand-computed: a staffing DECREASE never interrupts service; overrun is paid", () => {
      // Staff 2 on [0,2), 1 on [2,10). Rate 1/h; E = 0.5 each → arrivals at 0.5, 1.0, 1.5. Services 3, 3, 1.
      // c1 0.5–3.5, c2 1.0–4.0. At t = 2 capacity drops to 1 but both keep serving.
      // c1 leaves at 3.5: busy 1 = capacity 1, so c3 does NOT start. c2 leaves at 4.0, c3 starts 4.0 → 5.0.
      const r = sim([open(0, 2, 1, 2), open(2, 10, 1, 1, 1)], fixed([0.5, 0.5, 0.5], [3, 3, 1]));
      expect(r.arrival).toEqual([0.5, 1.0, 1.5]);
      expect(waits(r)).toEqual([0, 0, 2.5]);
      expect(r.departure).toEqual([3.5, 4.0, 5.0]);
      // On duty = max(capacity, busy): [0,2) 2×2 = 4; [2,3.5) busy 2 → 3; [3.5,10) 1 → 6.5. Total 13.5.
      expect(r.areaOnDuty).toBeCloseTo(13.5, 12);
      expect(r.areaQueue).toBeCloseTo(2.5, 12);
      expect(r.areaBusy).toBeCloseTo(7, 12);
    });

    it("hand-computed: a staffing INCREASE starts waiting customers immediately", () => {
      // 1 staff on [0,2), 3 staff on [2,6). Arrivals at 0.5, 1.0, 1.5 (rate 1, E = 0.5); services 5 each.
      // c1 starts 0.5; c2 and c3 wait until t = 2, then start together.
      const r = sim([open(0, 2, 1, 1), open(2, 6, 1, 3, 1)], fixed([0.5, 0.5, 0.5], [5, 5, 5]));
      expect(waits(r)).toEqual([0, 1.0, 0.5]);
    });

    it("hand-computed: queue carries over a zero-arrival interval; conservation at each boundary", () => {
      // Rate 2 on [0,1), 0 on [1,3), 2 on [3,4); 1 staff throughout. E = 0.4, 0.4, 2.0 → arrivals 0.2, 0.4, 3.4.
      // Services 1, 1, 0.1. c2 waits from 0.4 and starts at 1.2, after the boundary at t = 1.
      const r = sim([open(0, 1, 2, 1), open(1, 3, 0, 1, 1), open(3, 4, 2, 1, 2)], fixed([0.4, 0.4, 2.0], [1, 1, 0.1]));
      expect(r.arrival.map((x) => Number(x.toFixed(12)))).toEqual([0.2, 0.4, 3.4]);
      expect(waits(r).map((x) => Number(x.toFixed(12)))).toEqual([0, 0.8, 0]);
      expect(r.boundaries[0]).toMatchObject({ time: 1, inSystem: 2, arrived: 2, departed: 0, inQueue: 1, busy: 1 });
      expect(r.boundaries[1]).toMatchObject({ time: 3, inSystem: 0, arrived: 2, departed: 2 });
    });

    it("closing: arrivals stop, block-6 staff stay until empty (overtime), then capacity drops to 0", () => {
      // Open [0,2) rate 1, staff 1; closed [2,24). Arrivals at 1.0, 1.5 (E = 1.0, 0.5); services 2, 2.
      // c1 1.0–3.0, c2 waits 1.5–3.0, served 3.0–5.0. Overtime on duty 2→5 = 3 h, then 0.
      const segs: Segment[] = [open(0, 2, 1, 1), { start: 2, end: 24, ratePerHour: 0, staff: 0, closed: true, block: -1 }];
      const r = sim(segs, fixed([1.0, 0.5], [2, 2]));
      expect(waits(r)).toEqual([0, 1.5]);
      expect(r.areaOnDuty).toBeCloseTo(2 + 3, 12);
      expect(r.areaOnDutyClosed).toBeCloseTo(3, 12);
    });

    it("property: conservation at every boundary; no service starts while busy ≥ capacity; no idle staff while customers wait", () => {
      fc.assert(
        fc.property(fc.nat({ max: 0xffffffff }), fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 4, maxLength: 4 }), (seed, staff) => {
          const st = createStreams(seed, ["a", "s"], 0);
          const rates = [3, 7, 0, 4];
          const segs = rates.map((r, i) => open(i * 2, i * 2 + 2, r, staff[i]!, i));
          const r = sim(segs, { unitExponential: () => st["a"]!.exponential(1), service: () => st["s"]!.exponential(2.5) });
          for (const b of r.boundaries) if (b.arrived !== b.departed + b.inSystem || b.inSystem !== b.inQueue + b.busy) return false;
          const cap = (t: number) => (t >= 8 ? staff[3]! : staff[Math.floor(t / 2)]!);
          const busyAt = (t: number, exclude: number) =>
            r.serviceStart.filter((s, j) => j !== exclude && s < t && r.departure[j]! > t).length;
          for (let i = 0; i < r.arrival.length; i++) {
            const s = r.serviceStart[i]!;
            if (busyAt(s, i) >= cap(s)) return false; // started only when a slot was free
            if (s > r.arrival[i]! && busyAt(r.arrival[i]!, i) < cap(r.arrival[i]!) && r.serviceStart.filter((x, j) => j < i && x > r.arrival[i]!).length === 0) {
              // Waiting while a slot is free is allowed only behind earlier waiting customers (FIFO).
              return false;
            }
          }
          return true;
        }),
        { numRuns: 100 },
      );
    });

    it("matched arrivals across staffing alternatives (same seed, different staff)", () => {
      const run = (staff: number[]) => {
        const st = createStreams(9, ["arrivals", "service"], 0);
        return sim(daypartSegments([8, 14, 24, 14, 10, 6], staff, 3), { unitExponential: () => st["arrivals"]!.exponential(1), service: () => st["service"]!.exponential(10) });
      };
      const a = run([2, 2, 2, 2, 2, 2]);
      const b = run([2, 2, 3, 2, 2, 2]);
      expect(b.arrival).toEqual(a.arrival);
      expect(b.departure.map((d, i) => d - b.serviceStart[i]!)).toEqual(a.departure.map((d, i) => d - a.serviceStart[i]!));
    });
  });
});

describe("queue.daypart model: accounting, determinism and repeated days", () => {
  const settings = { warmup: 0, horizon: 24 * 20 };
  it("deterministic replay and exact accounting identities", () => {
    const r1 = runReplications(daypartModel, daypartModel.defaults, settings, 3, 5);
    const r2 = runReplications(daypartModel, daypartModel.defaults, settings, 3, 5);
    expect(r1).toEqual(r2);
    for (const m of r1.perReplication) {
      expect(m.staffingCostPerDay).toBeCloseTo(m.staffHoursPerDay! * 30, 9);
      expect(m.modeledCostPerDay).toBeCloseTo(m.staffingCostPerDay! + 20 * m.waitingHoursPerDay!, 9);
      // Default schedule: 2 staff × 12 h scheduled + overtime.
      expect(m.staffHoursPerDay! - m.overtimeHoursPerDay!).toBeCloseTo(24, 9);
    }
  });

  it("waiting customer-hours equal total waiting time (all customers drained)", () => {
    const st = createStreams(4, ["arrivals", "service"], 0);
    const r = simulateScheduled(daypartSegments([8, 14, 24, 14, 10, 6], [2, 2, 2, 2, 2, 2], 5), { unitExponential: () => st["arrivals"]!.exponential(1), service: () => st["service"]!.exponential(10) });
    expect(r.areaQueue).toBeCloseTo(waits(r).reduce((s, w) => s + w, 0), 9);
    expect(r.departure.every((d) => Number.isFinite(d))).toBe(true);
  });

  it("stable across repeated days: the system empties overnight and 5-day vs 40-day runs agree", () => {
    const short = runReplications(daypartModel, daypartModel.defaults, { warmup: 0, horizon: 24 * 5 }, 11, 30);
    const long = runReplications(daypartModel, daypartModel.defaults, { warmup: 0, horizon: 24 * 40 }, 12, 30);
    expect(short.summary.openingBacklog!.mean).toBe(0);
    expect(long.summary.openingBacklog!.mean).toBe(0);
    const a = short.summary.meanWait!;
    const b = long.summary.meanWait!;
    expect(Math.abs(a.mean - b.mean)).toBeLessThan(4 * Math.sqrt(a.se ** 2 + b.se ** 2));
  });

  it("rejects warm-up and partial days", () => {
    expect(() => runReplications(daypartModel, daypartModel.defaults, { warmup: 1, horizon: 48 }, 1, 2)).toThrow(/warm-up must be 0/);
    expect(() => runReplications(daypartModel, daypartModel.defaults, { warmup: 0, horizon: 30 }, 1, 2)).toThrow(/whole number/);
  });

  it("an open block with no staff and customers left at the end is reported, not silently dropped", () => {
    const segs = [open(0, 2, 5, 0)];
    expect(() => simulateScheduled(segs, fixed([0.5], [1]))).toThrow(/stalled/);
  });
});

describe("time-of-day demand estimation (spike)", () => {
  const spec = { seed: 777, days: 10, firstDay: "2026-03-02", utcOffsetMinutes: -300, openHour: 8, blockHours: 2, ratesPerHour: [8, 14, 24, 14, 10, 6], meanServiceMinutes: 6 };
  const blocks = ["08", "10", "12", "14", "16", "18"].map((h, i) => ({ label: `${h}:00`, startHour: 8 + 2 * i, endHour: 10 + 2 * i }));

  it("recovers the known block rates with explicit exposure, using one local-time definition", async () => {
    const log = generateDailyPatternLog(spec);
    const r = await estimateBlockRates(log.csv, {
      fileName: "frontdesk-daily-SYNTHETIC.csv", synthetic: true, arrivalColumn: "arrival_time",
      observationWindow: { start: log.windowStart, end: log.windowEnd }, timezone: { assumeOffsetMinutes: null }, localUtcOffsetMinutes: -300, blocks,
    });
    expect(r.ok).toBe(true);
    expect(r.window!.startLocal).toBe("2026-03-02T08:00:00.000-05:00");
    r.blocks.forEach((b, i) => {
      expect(b.exposureHours).toBe(20); // 10 days × 2 h
      expect(b.ciLow).toBeLessThan(spec.ratesPerHour[i]!);
      expect(b.ciHigh).toBeGreaterThan(spec.ratesPerHour[i]!);
    });
    expect(r.counts.outsideBlocks).toBe(0);
    expect(r.counts.offsetMismatch).toBe(0);
  });

  it("partial-day windows get partial exposure; sparse blocks and offset mismatches are flagged", async () => {
    // 08:30 local (before the window), 14:30Z = 09:30 local (inside block 08–10, but written in UTC), 23:00 local (closed).
    const csv = "arrival_time\n2026-03-02T08:30:00-05:00\n2026-03-02T14:30:00Z\n2026-03-02T23:00:00-05:00\n";
    const r = await estimateBlockRates(csv, {
      fileName: "x.csv", synthetic: true, arrivalColumn: "arrival_time",
      observationWindow: { start: "2026-03-02T09:00:00-05:00", end: "2026-03-03T09:00:00-05:00" }, timezone: { assumeOffsetMinutes: null }, localUtcOffsetMinutes: -300, blocks,
    });
    // 08–10 block: day 1 contributes 09–10 (1 h), day 2 contributes 08–09 (1 h).
    expect(r.blocks[0]!.exposureHours).toBe(2);
    expect(r.counts.outsideWindow).toBe(1); // 08:30 is before the window
    expect(r.counts.outsideBlocks).toBe(1); // 23:00 local
    expect(r.counts.offsetMismatch).toBe(1); // the Z timestamp
    expect(r.blocks[0]!.count).toBe(1); // the 14:30Z arrival, converted to 09:30 local
    expect(r.blocks[0]!.ratePerHour).toBe(0.5);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["sparse-block", "offset-mismatch", "outside-blocks"]));
  });
});
