import { describe, expect, it } from "vitest";
import { getModel, listModels, registerModel } from "../src/registry";
import { queueModel } from "../src/models/queue";
import { runReplications } from "../src/runner";
import { ENGINE_VERSION, RNG_VERSION } from "../src/version";
import type { ModelDefinition } from "../src/model";
import "../src/index";

const settings = { warmup: 10, horizon: 110 };

describe("runner (R3.1, R3.2)", () => {
  it("records full reproducibility metadata", () => {
    const r = runReplications(queueModel, queueModel.defaults, settings, 42, 5);
    expect(r.metadata).toEqual({
      modelId: "queue.mmc",
      modelVersion: "1.1.0",
      engineVersion: ENGINE_VERSION,
      rngVersion: RNG_VERSION,
      masterSeed: 42,
      replications: 5,
      streams: ["arrivals", "service"],
      params: queueModel.defaults,
      settings,
      confidence: 0.95,
      dataProvenance: null,
    });
  });

  it("is deterministic: identical inputs give deep-equal results", () => {
    const a = runReplications(queueModel, queueModel.defaults, settings, 9, 8);
    const b = runReplications(queueModel, queueModel.defaults, settings, 9, 8);
    expect(a).toEqual(b);
  });

  it("replications are independent draws (not copies)", () => {
    const r = runReplications(queueModel, queueModel.defaults, settings, 9, 8);
    const waits = new Set(r.perReplication.map((m) => m.meanWait));
    expect(waits.size).toBe(8);
  });

  it("validates parameters against the schema", () => {
    expect(() => runReplications(queueModel, { ...queueModel.defaults, servers: 1.5 }, settings, 1, 2)).toThrow(RangeError);
    expect(() => runReplications(queueModel, { ...queueModel.defaults, arrivalRatePerHour: -1 }, settings, 1, 2)).toThrow(RangeError);
    expect(() => runReplications(queueModel, queueModel.defaults, settings, 1, 1)).toThrow(RangeError);
  });

  it("the built-in queue model is registered", () => {
    expect(listModels()).toContain("queue.mmc@1.1.0");
    expect(getModel("queue.mmc", "1.1.0")).toBe(queueModel);
  });

  it("extensibility: a second model type runs through the same runner without engine changes", () => {
    // Deliberately tiny stochastic inventory model: daily demand ~ Exp(mean), fixed stock.
    type P = { stock: number; meanDemand: number };
    type M = { shortfall: number; leftover: number };
    const inventory: ModelDefinition<P, M> = {
      id: "test.inventory",
      version: "0.0.1",
      title: "Test-only single-period inventory",
      streams: ["demand"],
      parameters: {
        stock: { label: "Units stocked", unit: "units", description: "", min: 0, max: 1e6 },
        meanDemand: { label: "Average demand", unit: "units/day", description: "", min: 1e-9, max: 1e6 },
      },
      metrics: {
        shortfall: { label: "Unmet demand", unit: "units/day", lowerIsBetter: true, description: "" },
        leftover: { label: "Unsold stock", unit: "units/day", lowerIsBetter: true, description: "" },
      },
      defaults: { stock: 10, meanDemand: 8 },
      run(p, streams, s) {
        const days = Math.floor(s.horizon - s.warmup);
        let short = 0;
        let left = 0;
        for (let d = 0; d < days; d++) {
          const demand = streams["demand"]!.exponential(1 / p.meanDemand);
          short += Math.max(0, demand - p.stock);
          left += Math.max(0, p.stock - demand);
        }
        return { shortfall: short / days, leftover: left / days };
      },
    };
    registerModel(inventory);
    const r = runReplications(inventory, inventory.defaults, { warmup: 0, horizon: 2000 }, 3, 10);
    // E[max(0, D - s)] for D ~ Exp(mean m) is m·e^(-s/m) = 8·e^(-1.25) ≈ 2.292.
    expect(r.summary.shortfall.ciLow).toBeLessThan(8 * Math.exp(-1.25));
    expect(r.summary.shortfall.ciHigh).toBeGreaterThan(8 * Math.exp(-1.25));
    expect(getModel("test.inventory", "0.0.1")).toBe(inventory);
  });
});
