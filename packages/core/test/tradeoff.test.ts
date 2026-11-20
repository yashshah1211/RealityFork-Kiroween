import { describe, expect, it } from "vitest";
import "../src/index";
import { compareScenarios } from "../src/compare/compare";
import { computeTradeoff } from "../src/compare/tradeoff";
import { explainTradeoff } from "../src/compare/explain";
import type { ModelDefinition } from "../src/model";
import { registerModel } from "../src/registry";
import { createBaseline, fork, runScenario } from "../src/scenario/scenario";
import type { Scenario } from "../src/scenario/types";

let n = 0;
const ids = () => `to${++n}`;

describe("cost trade-off from simulated results (queue.mmc)", () => {
  it("adding one staff member: staffing +$30/h, waiting change, break-even = 30 / |ΔLq|, all computed from results", async () => {
    const b = await runScenario(
      await createBaseline({ name: "2 staff", modelId: "queue.mmc", modelVersion: "1.1.0", params: { servers: 2, arrivalRatePerHour: 1.6, serviceRatePerHour: 1, serverCostPerHour: 30, waitingCostPerHour: 20 }, settings: { warmup: 1000, horizon: 11000 }, masterSeed: 1, replications: 30 }, ids),
    );
    const v = await runScenario(await fork(b, { name: "3 staff", params: { servers: 3 } }, ids));
    const cmp = await compareScenarios(b, v, { sensitivity: false });
    const t = cmp.tradeoff!;
    expect(t.timeUnit).toBe("hour");
    expect(t.staffingChange.mean).toBe(30);
    expect(t.staffingChange.se).toBe(0); // identical in every replication
    const dLq = v.result!.summary.avgQueueLength!.mean - b.result!.summary.avgQueueLength!.mean;
    expect(t.waitingHoursChange.mean).toBeCloseTo(dLq, 12);
    expect(t.breakEven.status).toBe("finite");
    expect(t.breakEven.value).toBeCloseTo(30 / -dLq, 10);
    // Seed 1 matches the Task 8 report: ΔLq ≈ −2.566, break-even ≈ $11.69.
    expect(t.breakEven.value!).toBeGreaterThan(11.5);
    expect(t.breakEven.value!).toBeLessThan(11.9);
    expect(t.breakEven.intervalMethod).toBe("exact-transform");
    expect(t.breakEven.ciLow!).toBeLessThanOrEqual(t.breakEven.value!);
    expect(t.breakEven.ciHigh!).toBeGreaterThanOrEqual(t.breakEven.value!);
    expect(t.breakEven.preferredAbove).toBe("variant");
    // Net modelled cost change equals the paired difference of the model's own costPerHour metric.
    const dCost = cmp.outcomes.find((o) => o.metric === "costPerHour")!.difference.mean;
    expect(t.netCostChange.mean).toBeCloseTo(dCost, 9);
    // The cost total is no longer labelled better or worse.
    expect(cmp.outcomes.find((o) => o.metric === "costPerHour")!.direction).toBeNull();
    const text = cmp.statements.filter((s) => s.kind === "tradeoff").map((s) => s.text).join(" ");
    expect(text).toContain("hypothetical assumption, so this is not a cash saving");
    expect(text).toMatch(/Break-even: the two options have equal modelled cost when an hour of customer waiting is worth \$11\.\d\d/);
  }, 60_000);
});

describe("break-even edge cases (test model with controlled outputs)", () => {
  type P = { staff: number; wait: number; noise: number; value: number };
  type M = { staffCost: number; waitHours: number };
  const model: ModelDefinition<P, M> = {
    id: "test.tradeoff",
    version: "0.0.1",
    title: "test",
    streams: ["u"],
    parameters: {
      staff: { label: "staff", unit: "", description: "", min: 0, max: 100 },
      wait: { label: "wait", unit: "", description: "", min: 0, max: 100 },
      noise: { label: "noise", unit: "", description: "", min: 0, max: 100 },
      value: { label: "value", unit: "", description: "", min: 0, max: 100 },
    },
    metrics: { staffCost: { label: "s", unit: "", lowerIsBetter: null, description: "" }, waitHours: { label: "w", unit: "", lowerIsBetter: null, description: "" } },
    defaults: { staff: 2, wait: 10, noise: 0.1, value: 5 },
    run: (p, s) => ({ staffCost: p.staff * 10, waitHours: p.wait + p.noise * (s["u"]!.uniform() - 0.5) }),
    decision: { timeUnit: "day", staffingCost: (_p, m) => m.staffCost, waitingHours: (_p, m) => m.waitHours, waitingValue: (p) => p.value },
  };
  registerModel(model);
  const make = async (base: Partial<P>, alt: Partial<P>) => {
    const b = await runScenario(await createBaseline({ name: "B", modelId: model.id, modelVersion: model.version, params: base, settings: { warmup: 0, horizon: 1 }, masterSeed: 4, replications: 20 }, ids));
    const v = await runScenario(await fork(b, { name: "V", params: alt }, ids));
    return { b, v, t: computeTradeoff(b, v, model as unknown as ModelDefinition, true, 0.95)! };
  };

  it("finite: more staff, less waiting → w* = ΔS / |ΔW|", async () => {
    const { t } = await make({}, { staff: 3, wait: 6 });
    expect(t.breakEven.status).toBe("finite");
    expect(t.breakEven.value).toBeCloseTo(10 / 4, 9);
  });
  it("fewer staff, more waiting → finite; above w* the baseline is preferred", async () => {
    const { t } = await make({}, { staff: 1, wait: 14 });
    expect(t.breakEven.status).toBe("finite");
    expect(t.breakEven.value).toBeCloseTo(10 / 4, 9);
    expect(t.breakEven.preferredAbove).toBe("baseline");
  });
  it("dominance cases have no break-even", async () => {
    expect((await make({}, { staff: 3, wait: 14 })).t.breakEven.status).toBe("baseline-dominates");
    expect((await make({}, { staff: 1, wait: 6 })).t.breakEven.status).toBe("variant-dominates");
  });
  it("zero denominator: no waiting change → no finite threshold", async () => {
    const { t } = await make({}, { staff: 3 });
    expect(t.waitingHoursChange.allZero).toBe(true);
    expect(t.breakEven.status).toBe("no-waiting-change");
    expect(t.breakEven.value).toBeNull();
    expect(explainTradeoff(t, "B", "V").join(" ")).toContain("No break-even value");
  });
  it("inconclusive waiting change → no finite threshold, explained", async () => {
    // Same expected wait; different noise makes the paired difference random around 0.
    const { t } = await make({ noise: 0.1 }, { staff: 3, noise: 5 });
    expect(t.breakEven.status).toBe("waiting-change-inconclusive");
    expect(explainTradeoff(t, "B", "V").join(" ")).toContain("statistically inconclusive");
  });
  it("no staffing change → the option with less waiting is cheaper for any positive value", async () => {
    const { t } = await make({}, { wait: 6 });
    expect(t.breakEven.status).toBe("no-staffing-change");
    expect(t.breakEven.preferredAbove).toBe("variant");
  });
  it("different assumed waiting values are reported, and the net change uses each scenario's own value", async () => {
    const { t } = await make({}, { staff: 3, wait: 6, value: 7 });
    expect(t.waitingValue).toEqual({ baseline: 5, variant: 7, same: false });
    expect(t.netCostChange.mean).toBeCloseTo(10 + (7 * 6 - 5 * 10), 1);
  });
  it("random staffing cost uses the delta method and labels it approximate", async () => {
    type Q = { staff: number };
    const m2: ModelDefinition<Q, M> = {
      ...(model as unknown as ModelDefinition<Q, M>),
      id: "test.tradeoff2",
      parameters: { staff: { label: "staff", unit: "", description: "", min: 0, max: 100 } },
      defaults: { staff: 2 },
      run: (p, s) => {
        const u = s["u"]!.uniform();
        return { staffCost: p.staff * 10 + u, waitHours: 20 / p.staff + u };
      },
      decision: { timeUnit: "day", staffingCost: (_p, m) => m.staffCost, waitingHours: (_p, m) => m.waitHours, waitingValue: () => 1 },
    };
    registerModel(m2);
    const b = await runScenario(await createBaseline({ name: "B", modelId: m2.id, modelVersion: m2.version, settings: { warmup: 0, horizon: 1 }, masterSeed: 9, replications: 20 }, ids));
    const v: Scenario = await runScenario(await fork(b, { name: "V", params: { staff: 4 } }, ids));
    const t = computeTradeoff(b, v, m2 as unknown as ModelDefinition, true, 0.95)!;
    // With matched streams the u terms cancel exactly, so the differences are deterministic: ΔS = 20, ΔW = −5.
    expect(t.breakEven.value).toBeCloseTo(4, 9);
    expect(["exact-transform", "delta-method"]).toContain(t.breakEven.intervalMethod);
    const unpaired = computeTradeoff(b, v, m2 as unknown as ModelDefinition, false, 0.95)!;
    expect(unpaired.breakEven.intervalMethod).toBe("delta-method");
  });
});
