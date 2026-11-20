/**
 * Phase 1 audit of queue.daypart shift boundaries and cost accounting.
 * Each finding has a regression test; 0.1.0 behaviour is pinned so it stays reproducible.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import "../src/index";
import { daypartModel, daypartModelV010, daypartSegments, simulateScheduled, type Segment, type ScheduledSamplers } from "../src/models/daypart";
import { createStreams } from "../src/rng";
import { runReplications } from "../src/runner";
import { createBaseline, editDraft, fork, runScenario } from "../src/scenario/scenario";
import { compareScenarios } from "../src/compare/compare";

const fixed = (unitExp: number[], serv: number[]): ScheduledSamplers => {
  let i = 0;
  let j = 0;
  return { unitExponential: () => (i < unitExp.length ? unitExp[i++]! : 1e12), service: () => serv[j++]! };
};
const open = (start: number, end: number, ratePerHour: number, staff: number, block = 0): Segment => ({ start, end, ratePerHour, staff, closed: false, block });
const closed = (start: number, end: number): Segment => ({ start, end, ratePerHour: 0, staff: 0, closed: true, block: -1 });
const waits = (r: { arrival: readonly number[]; serviceStart: readonly number[] }) => r.arrival.map((a, i) => r.serviceStart[i]! - a);

describe("finding 1: an arrival landing exactly on the end of its block", () => {
  // Rate 1/h on [0,2) and E = 2 → the cumulative rate reaches E exactly at t = 2 = closing.
  it("0.2.0: it meets its own block's staff, is served at once, and is paid as after-closing time", () => {
    const r = simulateScheduled([open(0, 2, 1, 1), closed(2, 24)], fixed([2], [0.5]), "0.2.0");
    expect(r.arrival).toEqual([2]);
    expect(r.block).toEqual([0]);
    expect(waits(r)).toEqual([0]);
    expect(r.departure).toEqual([2.5]);
    expect(r.areaOnDutyClosed).toBeCloseTo(0.5, 12);
    expect(r.areaScheduled).toBeCloseTo(2, 12);
  });

  it("0.1.0 (pinned): the boundary ran first, so the customer met zero staff and the run stalled", () => {
    expect(() => simulateScheduled([open(0, 2, 1, 1), closed(2, 24)], fixed([2], [0.5]), "0.1.0")).toThrow(/stalled/);
    // With a second day the 0.1.0 customer waited overnight until the next opening.
    const two = simulateScheduled([open(0, 2, 1, 1), closed(2, 24), open(24, 26, 1, 1), closed(26, 48)], fixed([2], [0.5]), "0.1.0");
    expect(waits(two)).toEqual([22]);
  });

  it("0.2.0: at an interior boundary the arrival belongs to the earlier block and keeps its staffing", () => {
    // 1 staff on [0,2), 0 staff on [2,4), 1 staff on [4,6). Arrival exactly at t = 2 (block 0).
    const r = simulateScheduled([open(0, 2, 1, 1), open(2, 4, 1, 0, 1), open(4, 6, 0, 1, 2)], fixed([2, 1e12], [1]), "0.2.0");
    expect(r.arrival).toEqual([2]);
    expect(waits(r)).toEqual([0]);
    // Served 2 → 3 by the block-0 staff member finishing after the decrease to 0: 1 h overrun.
    expect(r.areaOverrun).toBeCloseTo(1, 12);
  });
});

describe("finding 2: overrun after a mid-day decrease is paid and reported separately", () => {
  it("hand-computed: staff 2 on [0,2), 1 on [2,10); services overlap the decrease", () => {
    // From the 0.1.0 test: arrivals 0.5, 1.0, 1.5; services 3, 3, 1. Both early customers keep being
    // served after t = 2, so [2, 3.5) has busy 2 > scheduled 1: overrun 1.5 h.
    for (const policy of ["0.1.0", "0.2.0"] as const) {
      const r = simulateScheduled([open(0, 2, 1, 2), open(2, 10, 1, 1, 1)], fixed([0.5, 0.5, 0.5], [3, 3, 1]), policy);
      expect(r.areaScheduled).toBeCloseTo(2 * 2 + 1 * 8, 12);
      expect(r.areaOverrun).toBeCloseTo(1.5, 12);
      expect(r.areaOnDuty).toBeCloseTo(13.5, 12);
    }
  });

  it("peak-only schedule: 0.2.0 splits paid time into scheduled + overrun + after-closing exactly", () => {
    const p = { ...daypartModel.defaults, staff3: 3 };
    const r = runReplications(daypartModel, p, { warmup: 0, horizon: 24 * 20 }, 2026, 10);
    for (const m of r.perReplication) {
      expect(m.scheduledHoursPerDay).toBe(2 * (2 + 2 + 3 + 2 + 2 + 2));
      expect(m.overrunHoursPerDay).toBeGreaterThan(0); // the extra person finishing after 14:00
      expect(m.staffHoursPerDay).toBeCloseTo(m.scheduledHoursPerDay! + m.overrunHoursPerDay! + m.overtimeHoursPerDay!, 9);
      expect(m.scheduledCostPerDay! + m.extraTimeCostPerDay!).toBeCloseTo(m.staffingCostPerDay!, 9);
    }
  });
});

describe("finding 3: after closing, idle staff were paid until the last customer left (0.1.0)", () => {
  // 2 staff on [0,2), closed after. One customer arrives 1.5 and is served until 3.5.
  const segs = [open(0, 2, 1, 2), closed(2, 24)];
  it("0.1.0 (pinned): both staff paid 2 → 3.5", () => {
    expect(simulateScheduled(segs, fixed([1.5], [2]), "0.1.0").areaOnDutyClosed).toBeCloseTo(3, 12);
  });
  it("0.2.0: the idle staff member leaves at closing, the same rule as a mid-day decrease", () => {
    const r = simulateScheduled(segs, fixed([1.5], [2]), "0.2.0");
    expect(r.areaOnDutyClosed).toBeCloseTo(1.5, 12);
    expect(r.areaOnDuty).toBeCloseTo(4 + 1.5, 12);
  });
  it("0.2.0: while customers still wait after closing, every block-6 staff member keeps serving", () => {
    // 2 staff; 4 customers at 1.0, 1.25, 1.5, 1.75 with services 2 each. At closing 2 in service, 2 waiting.
    const r = simulateScheduled(segs, fixed([1, 0.25, 0.25, 0.25], [2, 2, 2, 2]), "0.2.0");
    expect(r.serviceStart).toEqual([1, 1.25, 3, 3.25]);
    // After closing: busy 2 on [2, 5), then 1 on [5, 5.25). Paid 6.25 h.
    expect(r.areaOnDutyClosed).toBeCloseTo(6.25, 12);
  });
});

describe("conservation and unit consistency (0.2.0)", () => {
  it("property: conservation at every boundary, all customers served, and costs use one per-day basis", () => {
    fc.assert(
      fc.property(fc.nat({ max: 0xffffffff }), fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 6, maxLength: 6 }), (seed, staff) => {
        const st = createStreams(seed, ["arrivals", "service"], 0);
        const days = 3;
        const r = simulateScheduled(daypartSegments([8, 14, 24, 14, 10, 6], staff, days), {
          unitExponential: () => st["arrivals"]!.exponential(1), service: () => st["service"]!.exponential(10),
        }, "0.2.0");
        for (const b of r.boundaries) if (b.arrived !== b.departed + b.inSystem || b.inSystem !== b.inQueue + b.busy) return false;
        if (!r.departure.every(Number.isFinite)) return false;
        const totalWait = waits(r).reduce((s, w) => s + w, 0);
        const sched = staff.reduce((s, x) => s + 2 * x, 0) * days;
        return (
          Math.abs(r.areaQueue - totalWait) < 1e-7 &&
          Math.abs(r.areaScheduled - sched) < 1e-7 &&
          Math.abs(r.areaOnDuty - (r.areaScheduled + r.areaOverrun + r.areaOnDutyClosed)) < 1e-7 &&
          r.areaBusy <= r.areaOnDuty + 1e-9
        );
      }),
      { numRuns: 60 },
    );
  });

  it("per-day metrics: staffing, waiting penalty and net modelled cost are consistent", () => {
    const r = runReplications(daypartModel, { ...daypartModel.defaults, staff3: 3 }, { warmup: 0, horizon: 24 * 10 }, 7, 5);
    for (const m of r.perReplication) {
      expect(m.staffingCostPerDay).toBeCloseTo(m.staffHoursPerDay! * 30, 9);
      expect(m.waitingPenaltyPerDay).toBeCloseTo(m.waitingHoursPerDay! * 20, 9);
      expect(m.modeledCostPerDay).toBeCloseTo(m.staffingCostPerDay! + m.waitingPenaltyPerDay!, 9);
    }
  });

  it("0.1.0 and 0.2.0 give identical queues for these seeds; only paid after-closing time can differ", () => {
    for (const staff3 of [2, 3]) {
      const p = { ...daypartModel.defaults, staff3 };
      const a = runReplications(daypartModelV010, p, { warmup: 0, horizon: 24 * 20 }, 2026, 10);
      const b = runReplications(daypartModel, p, { warmup: 0, horizon: 24 * 20 }, 2026, 10);
      a.perReplication.forEach((m, i) => {
        const n = b.perReplication[i]!;
        for (const k of ["meanWait", "shareWaitOver15Min", "customersPerDay", "waitingHoursPerDay", "maxQueueLength", "openingBacklog"]) expect(n[k]).toBe(m[k]);
        expect(n.overtimeHoursPerDay!).toBeLessThanOrEqual(m.overtimeHoursPerDay! + 1e-12);
      });
    }
  });
});

describe("break-even values come from the simulated differences", () => {
  const settings = { warmup: 0, horizon: 24 * 10 };
  const scenarios = async (waitingCostPerHour: number) => {
    const base = await runScenario(await createBaseline({ name: "Today", modelId: "queue.daypart", modelVersion: "0.2.0", params: { ...daypartModel.defaults, waitingCostPerHour }, settings, masterSeed: 3, replications: 12 }));
    const peak = await runScenario(await editDraft(await fork(base, { name: "Peak" }), { params: { staff3: 3 } }));
    return { base, peak, cmp: await compareScenarios(base, peak) };
  };

  it("w* = −ΔS/ΔW from the per-replication results, and it does not depend on the assumed waiting value", async () => {
    const x = await scenarios(20);
    const t = x.cmp.tradeoff!;
    const dS = x.peak.result!.perReplication.map((m, i) => m.staffingCostPerDay! - x.base.result!.perReplication[i]!.staffingCostPerDay!);
    const dW = x.peak.result!.perReplication.map((m, i) => m.waitingHoursPerDay! - x.base.result!.perReplication[i]!.waitingHoursPerDay!);
    const mean = (v: number[]) => v.reduce((s, y) => s + y, 0) / v.length;
    expect(t.breakEven.status).toBe("finite");
    expect(t.breakEven.value).toBeCloseTo(-mean(dS) / mean(dW), 9);
    expect(t.breakEven.intervalMethod).toBe("delta-method"); // overrun/after-closing time makes ΔS random
    const y = await scenarios(55);
    expect(y.cmp.tradeoff!.breakEven.value).toBeCloseTo(t.breakEven.value!, 9);
    expect(y.cmp.tradeoff!.netCostChange.mean).not.toBeCloseTo(t.netCostChange.mean, 3);
  });
});
