import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { daypartModel, DAYPART_BLOCKS } from "../src/models/daypart";
import { explainStaffingChoice, scheduleView, standardAlternatives } from "../src/compare/schedule";
import { blockRatesProvenance, estimateBlockRates, readBlockProvenance } from "../src/data/blockRates";
import { createBaseline, editDraft, fork, reproduce, runScenario } from "../src/scenario/scenario";
import { exportBundle, importBundle } from "../src/scenario/bundle";
import { compareScenarios } from "../src/compare/compare";

const data = (f: string) => readFileSync(fileURLToPath(new URL(`../../../data/synthetic/${f}`, import.meta.url)), "utf8");

describe("schedule view", () => {
  it("capacity, load and peak come from the parameters", () => {
    const v = scheduleView(daypartModel.defaults);
    expect(v.peakIndex).toBe(2);
    expect(v.blocks[2]).toMatchObject({ label: "12:00–14:00", ratePerHour: 24, staff: 2, capacityPerHour: 20, load: 1.2 });
    expect(v.scheduledStaffHours).toBe(24);
    expect(scheduleView({ ...daypartModel.defaults, staff1: 0 }).blocks[0]!.load).toBe(Number.POSITIVE_INFINITY);
  });

  it("standard alternatives add one person all day, or only in the busiest block", () => {
    const alt = standardAlternatives({ ...daypartModel.defaults, rate5: 30 });
    expect(alt.peakLabel).toBe("16:00–18:00");
    expect(alt.peakOnly).toEqual({ staff5: 3 });
    expect(Object.values(alt.allDay)).toEqual([3, 3, 3, 3, 3, 3]);
  });
});

describe("block-rate provenance", () => {
  const blocks = DAYPART_BLOCKS.map((b, i) => ({ label: b.label, startHour: 8 + 2 * i, endHour: 10 + 2 * i }));
  const estimate = () =>
    estimateBlockRates(data("frontdesk-daily-SYNTHETIC.csv"), {
      fileName: "frontdesk-daily-SYNTHETIC.csv", synthetic: true, arrivalColumn: "arrival_time",
      observationWindow: { start: "2026-03-02T08:00:00.000-05:00", end: "2026-03-11T20:00:00.000-05:00" },
      timezone: { assumeOffsetMinutes: null }, localUtcOffsetMinutes: -300, blocks,
    });

  it("round-trips counts, exposure and intervals, and is part of the fingerprint and the export", async () => {
    const r = await estimate();
    const prov = blockRatesProvenance(r, { fileName: "frontdesk-daily-SYNTHETIC.csv", synthetic: true, localUtcOffsetMinutes: -300 });
    const view = readBlockProvenance(prov)!;
    expect(view.synthetic).toBe(true);
    expect(view.blocks.map((b) => b.arrivals)).toEqual(r.blocks.map((b) => b.count));
    expect(view.blocks.map((b) => b.exposureHours)).toEqual([20, 20, 20, 20, 20, 20]);
    expect(view.blocks[2]!.rate).toBe(r.blocks[2]!.ratePerHour);
    const params = { ...daypartModel.defaults, ...Object.fromEntries(r.blocks.map((b, i) => [`rate${i + 1}`, b.ratePerHour])) };
    const settings = { warmup: 0, horizon: 24 * 3 };
    const withProv = await createBaseline({ name: "x", modelId: "queue.daypart", modelVersion: "0.2.0", params, settings, masterSeed: 1, replications: 3, dataProvenance: prov });
    const without = await createBaseline({ name: "x", modelId: "queue.daypart", modelVersion: "0.2.0", params, settings, masterSeed: 1, replications: 3 });
    expect(withProv.fingerprint).not.toBe(without.fingerprint);
    const ran = await runScenario(withProv);
    const peak = await runScenario(await editDraft(await fork(ran, { name: "peak" }), { params: standardAlternatives(params).peakOnly }));
    expect(peak.spec.dataProvenance).toEqual(prov); // forks keep the data provenance
    const { scenarios } = await importBundle(exportBundle([ran, peak]));
    expect(readBlockProvenance(scenarios[1]!.spec.dataProvenance)).toEqual(view);
    expect((await reproduce(scenarios[1]!)).status).toBe("identical");
  });

  it("returns null for other provenance kinds", () => {
    expect(readBlockProvenance(null)).toBeNull();
    expect(readBlockProvenance({ kind: "queue-inputs" })).toBeNull();
  });
});

describe("staffing-choice explanation", () => {
  it("is filled from computed values only", async () => {
    const settings = { warmup: 0, horizon: 24 * 10 };
    const base = await runScenario(await createBaseline({ name: "Today", modelId: "queue.daypart", modelVersion: "0.2.0", params: daypartModel.defaults, settings, masterSeed: 5, replications: 10 }));
    const alt = standardAlternatives(base.spec.params);
    const all = await runScenario(await editDraft(await fork(base, { name: "All day" }), { params: alt.allDay }));
    const peak = await runScenario(await editDraft(await fork(base, { name: "Peak" }), { params: alt.peakOnly }));
    const cAll = await compareScenarios(base, all, { sensitivity: false });
    const cPeak = await compareScenarios(base, peak, { sensitivity: false });
    const cInc = await compareScenarios(peak, all, { sensitivity: false });
    const text = explainStaffingChoice(base, [{ scenario: peak, vsBaseline: cPeak }, { scenario: all, vsBaseline: cAll }], { cheaper: peak, dearer: all, comparison: cInc }).join("\n");
    const peakWait = base.result!.summary.meanWaitBlock3!.mean;
    expect(text).toContain("demand is highest 12:00–14:00");
    expect(text).toContain("120% of what 2 staff can serve");
    expect(text).toContain(`${(peakWait * 60).toFixed(1)} min`);
    const share = cPeak.tradeoff!.waitingHoursChange.mean / cAll.tradeoff!.waitingHoursChange.mean;
    expect(text).toContain(`removes ${(share * 100).toFixed(0)}% as much waiting`);
    const be = cInc.tradeoff!.breakEven.value!;
    expect(text).toContain(`$${be.toFixed(2)}`);
    expect(text).toContain("not predictions");
  }, 60_000);
});
