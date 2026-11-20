import { describe, expect, it } from "vitest";
import "../src/index";
import { classifyDifference, compareScenarios } from "../src/compare/compare";
import { explainUncertainty, INCONCLUSIVE_TEXT, plainOutcome } from "../src/compare/explain";
import type { OutcomeComparison } from "../src/compare/types";
import type { ModelDefinition } from "../src/model";
import { registerModel } from "../src/registry";
import { createBaseline, fork, runScenario } from "../src/scenario/scenario";
import type { Scenario } from "../src/scenario/types";
import { pairedDifference, welchDifference } from "../src/stats/difference";
import { mmcAnalytic } from "../src/analytic/erlang";

let n = 0;
const ids = () => `c${++n}`;
const settings = { warmup: 300, horizon: 3300 };
const baseline = (params: Record<string, number> = {}, seed = 11, replications = 30) =>
  createBaseline({ name: "Baseline", modelId: "queue.mmc", modelVersion: "1.1.0", params, settings, masterSeed: seed, replications }, ids).then(runScenario);
const variantOf = async (b: Scenario, name: string, params: Record<string, number>) => runScenario(await fork(b, { name, params }, ids));
const outcome = (cmp: Awaited<ReturnType<typeof compareScenarios>>, m: string) => cmp.outcomes.find((o) => o.metric === m)!;

describe("difference statistics", () => {
  it("paired difference equals the summary of per-replication differences", () => {
    const d = pairedDifference([1, 2, 3, 4], [2, 4, 6, 8], 0.95);
    expect(d.mean).toBe(2.5);
    expect(d.df).toBe(3);
    expect(d.method).toBe("paired-t");
  });

  it("Welch interval matches a hand computation", () => {
    // a: mean 2, var 1 (n=3); b: mean 5, var 4 (n=3). se = sqrt(1/3 + 4/3); df = (5/3)^2 / ((1/9)/2 + (16/9)/2) = 2.941...
    const d = welchDifference([1, 2, 3], [3, 5, 7], 0.95);
    expect(d.mean).toBe(3);
    expect(d.se).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(d.df).toBeCloseTo(25 / 9 / (17 / 18), 10);
  });

  it("classification never turns an interval containing 0 into 'no effect'", () => {
    const base = { method: "paired-t" as const, n: 10, nonFinite: 0, se: 1, df: 9, confidence: 0.95, allZero: false };
    expect(classifyDifference({ ...base, mean: 0.5, ciLow: -1, ciHigh: 2 })).toBe("inconclusive");
    expect(classifyDifference({ ...base, mean: 2, ciLow: 1, ciHigh: 3 })).toBe("variant-higher");
    expect(classifyDifference({ ...base, mean: -2, ciLow: -3, ciHigh: -1 })).toBe("variant-lower");
    expect(classifyDifference({ ...base, mean: 0, ciLow: 0, ciHigh: 0, allZero: true })).toBe("identical-in-every-replication");
    expect(classifyDifference({ ...base, mean: NaN, ciLow: NaN, ciHigh: NaN, nonFinite: 3 })).toBe("not-computable");
  });

  it("inconclusive wording says inconclusive and explicitly not 'no effect'", () => {
    const o: OutcomeComparison = {
      metric: "m", label: "Average wait before service", unit: "hours", lowerIsBetter: true, baselineMean: 1, variantMean: 1.1, directDifference: 0.1, relativeChange: 0.1,
      difference: { method: "paired-t", n: 30, nonFinite: 0, mean: 0.1, se: 0.2, df: 29, confidence: 0.95, ciLow: -0.3, ciHigh: 0.5, allZero: false },
      conclusion: "inconclusive", direction: null, pairing: null,
    };
    const text = explainUncertainty(o, 30);
    expect(text).toContain("statistically inconclusive");
    expect(text).toContain("not evidence that there is no effect");
    expect(text).toContain(INCONCLUSIVE_TEXT);
    expect(plainOutcome(o)).toBe("Average wait before service: no clear difference in the simulation (1 hours → 1.1 hours); the result is inconclusive, not proof of no effect.");
    expect(plainOutcome({ ...o, conclusion: "variant-lower", directDifference: -0.5, variantMean: 0.5, relativeChange: -0.5 })).toBe(
      "Average wait before service is lower in the simulation: 1 hours → 0.5 hours, -50.0%.",
    );
    expect(plainOutcome({ ...o, conclusion: "not-computable" })).toMatch(/cannot be computed/);
  });
});

describe("scenario comparison (R5)", () => {
  it("adding a server: paired comparison, explicit assumptions, direction and measured variance reduction", async () => {
    const b = await baseline();
    const v = await variantOf(b, "Add one staff member", { servers: 3 });
    const cmp = await compareScenarios(b, v);
    expect(cmp.pairing.mode).toBe("paired");
    expect(cmp.assumptions).toEqual([{ path: "params.servers", label: "Staff on duty", unit: "people", from: 2, to: 3 }]);
    const w = outcome(cmp, "meanWait");
    expect(w.conclusion).toBe("variant-lower");
    expect(w.direction).toBe("better");
    expect(w.directDifference).toBeCloseTo(w.variantMean - w.baselineMean, 12);
    // Measured, not assumed: report whatever the ratio is, and check it is consistent.
    expect(w.pairing).not.toBeNull();
    expect(w.pairing!.varianceReduction).toBeCloseTo(1 - w.pairing!.ratio, 12);
    // Arrivals do not depend on staffing, so with matched streams they are identical.
    expect(outcome(cmp, "arrivalRateObserved").conclusion).toBe("identical-in-every-replication");
    // Single parameter: no extra runs, residual exactly 0.
    expect(cmp.sensitivity.available).toBe(true);
    if (cmp.sensitivity.available) {
      expect(cmp.sensitivity.runs).toHaveLength(0);
      const m = cmp.sensitivity.perMetric.find((x) => x.metric === "meanWait")!;
      expect(m.interaction.allZero).toBe(true);
      expect(m.effects[0]!.effect.mean).toBeCloseTo(w.difference.mean, 12);
    }
    expect(cmp.disclaimer).toMatch(/not predictions/);
    expect(cmp.statements.some((s) => s.kind === "pairing")).toBe(true);
  });

  it("ZERO interaction: two cost changes combine additively (cost is linear in each)", async () => {
    const b = await baseline();
    const v = await variantOf(b, "Higher pay, costlier waits", { serverCostPerHour: 45, waitingCostPerHour: 35 });
    const cmp = await compareScenarios(b, v);
    if (!cmp.sensitivity.available) throw new Error(cmp.sensitivity.reason);
    expect(cmp.sensitivity.runs).toHaveLength(2);
    const cost = cmp.sensitivity.perMetric.find((m) => m.metric === "costPerHour")!;
    expect(cost.interaction.allZero).toBe(true);
    expect(cost.interactionConclusion).toBe("identical-in-every-replication");
    // Staff-cost effect is exactly servers × Δ = 2 × 15 = 30 $/h in every replication.
    const staff = cost.effects.find((e) => e.path === "params.serverCostPerHour")!;
    expect(staff.effect.mean).toBeCloseTo(30, 10);
    expect(cost.decompositionError).toBeLessThan(1e-9);
    // Costs do not change queue behaviour at all.
    expect(outcome(cmp, "meanWait").conclusion).toBe("identical-in-every-replication");
  });

  it("NONZERO interaction: more staff and more arrivals interact strongly for waiting time", async () => {
    const b = await baseline();
    const v = await variantOf(b, "Busier day, extra staff", { servers: 3, arrivalRatePerHour: 1.8 });
    const cmp = await compareScenarios(b, v);
    if (!cmp.sensitivity.available) throw new Error(cmp.sensitivity.reason);
    const m = cmp.sensitivity.perMetric.find((x) => x.metric === "meanWait")!;
    // Analytic expectation (Erlang C), only as a sanity reference for the sign:
    const wq = (l: number, c: number) => mmcAnalytic(l, 1, c).wq;
    const expectedResidual = wq(1.8, 3) - wq(1.6, 2) - (wq(1.6, 3) - wq(1.6, 2)) - (wq(1.8, 2) - wq(1.6, 2));
    expect(expectedResidual).toBeLessThan(-1);
    expect(m.interactionConclusion).toBe("variant-lower"); // residual CI entirely below 0
    expect(m.decompositionError).toBeLessThan(1e-9 * (1 + Math.abs(m.combined.mean)));
    expect(m.ranking).toHaveLength(2);
    // Decomposition identity: combined = Σ effects + residual.
    const sum = m.effects.reduce((s, e) => s + e.effect.mean, 0) + m.interaction.mean;
    expect(sum).toBeCloseTo(m.combined.mean, 10);
    // Sensitivity runs are real, reproducible scenarios with matched seeds.
    expect(cmp.sensitivity.runs.map((r) => r.path).sort()).toEqual(["params.arrivalRatePerHour", "params.servers"]);
    expect(cmp.statements.some((s) => s.kind === "caveat" && /not a unique attribution/.test(s.text))).toBe(true);
  });

  it("different seeds: unmatched Welch comparison and no sensitivity decomposition", async () => {
    const b = await baseline({}, 11);
    const other = await baseline({ servers: 3 }, 12);
    const cmp = await compareScenarios(b, other);
    expect(cmp.pairing.mode).toBe("independent");
    expect(outcome(cmp, "meanWait").difference.method).toBe("welch-t");
    expect(outcome(cmp, "meanWait").pairing).toBeNull();
    expect(cmp.sensitivity.available).toBe(false);
  });

  it("refuses to compare unrun scenarios", async () => {
    const draft = await createBaseline({ name: "d", modelId: "queue.mmc", modelVersion: "1.1.0", settings, masterSeed: 1, replications: 2 }, ids);
    await expect(compareScenarios(draft, draft)).rejects.toThrow(/has not been run/);
  });

  it("non-computable metrics are reported as such, not as zero", async () => {
    const b = await baseline({ arrivalRatePerHour: 1e-6 }, 5, 3);
    const v = await variantOf(b, "more staff", { servers: 3 });
    const w = outcome(await compareScenarios(b, v), "meanWait");
    expect(w.conclusion).toBe("not-computable");
  });

  it("matched inputs can INCREASE variance: the comparison reports it instead of assuming a reduction", async () => {
    type P = { flip: number };
    type M = { x: number };
    const anti: ModelDefinition<P, M> = {
      id: "test.anticorrelated",
      version: "0.0.1",
      title: "Test-only model whose output reverses with a switch",
      streams: ["u"],
      parameters: { flip: { label: "Reverse", unit: "", description: "", min: 0, max: 1, integer: true } },
      metrics: { x: { label: "Output", unit: "", lowerIsBetter: null, description: "" } },
      defaults: { flip: 0 },
      run: (p, s) => {
        const u = s["u"]!.uniform();
        return { x: p.flip === 1 ? 1 - u : u };
      },
    };
    registerModel(anti);
    const b = await runScenario(await createBaseline({ name: "A", modelId: anti.id, modelVersion: anti.version, settings: { warmup: 0, horizon: 1 }, masterSeed: 3, replications: 200 }, ids));
    const v = await variantOf(b, "B", { flip: 1 });
    const o = outcome(await compareScenarios(b, v), "x");
    // Var(1 − 2U) / (Var U + Var U) = (4/12) / (2/12) = 2 in expectation.
    expect(o.pairing!.ratio).toBeGreaterThan(1.5);
    expect(o.pairing!.varianceReduction).toBeLessThan(0);
    expect(o.pairing!.correlation).toBeLessThan(-0.9);
    const cmp = await compareScenarios(b, v);
    expect(cmp.statements.find((s) => s.kind === "pairing")!.text).toMatch(/increased the estimated variance/);
  });
});
