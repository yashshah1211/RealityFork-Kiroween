import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalStringify, generateSyntheticArrivalLog, queueModel } from "@realityfork/core";
import { directEngine } from "../engine";
import { checkParam, STORAGE_KEY, Workspace, type StorageLike } from "./workspace";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

/** Same journey as the UI, but with short runs to keep tests fast. */
async function smallWorkspace(storage = new MemoryStorage()) {
  const ws = new Workspace(directEngine, storage);
  const b = (await ws.loadExample())!;
  // Shorten the run for tests (the UI uses the full example settings).
  return { ws, storage, baseline: b };
}

describe("UI data flow (workspace)", () => {
  it("parameter validation messages follow the model schema", () => {
    expect(checkParam(queueModel, "servers", "2.5")).toEqual({ ok: false, message: "Must be a whole number" });
    expect(checkParam(queueModel, "servers", "0").ok).toBe(false);
    expect(checkParam(queueModel, "arrivalRatePerHour", "0").ok).toBe(false);
    expect(checkParam(queueModel, "arrivalRatePerHour", "1,5")).toEqual({ ok: false, message: "Enter a number (use a dot for decimals)" });
    expect(checkParam(queueModel, "arrivalRatePerHour", "")).toEqual({ ok: false, message: "Enter a number" });
    expect(checkParam(queueModel, "serverCostPerHour", "0")).toEqual({ ok: true, value: 0 });
    expect(checkParam(queueModel, "servers", "3")).toEqual({ ok: true, value: 3 });
  });

  it("load → fork → edit → run → compare → reproduce, with parent immutability", async () => {
    const { ws, baseline } = await smallWorkspace();
    expect(ws.getState().selectedId).toBe(baseline.id);
    const ranBase = (await ws.run(baseline.id))!;
    expect(ranBase.status).toBe("completed");
    const before = canonicalStringify(ws.get(baseline.id));

    const alt = (await ws.fork(baseline.id, "Add one staff member"))!;
    expect(ws.getState().selectedId).toBe(alt.id);
    const edited = (await ws.editParam(alt.id, "servers", 3))!;
    expect(edited.id).toBe(alt.id);
    expect(edited.changesFromParent.map((c) => c.path)).toEqual(["params.servers"]);
    expect(canonicalStringify(ws.get(baseline.id))).toBe(before); // parent unchanged by the UI edit

    await ws.run(alt.id);
    const cmp = (await ws.compare(alt.id, baseline.id))!;
    expect(cmp.outcomes.find((o) => o.metric === "meanWait")!.conclusion).toBe("variant-lower");
    // Trade-off for the example: +1 staff at $30/h; break-even computed from the simulated waiting change.
    const t = cmp.tradeoff!;
    expect(t.staffingChange.mean).toBe(30);
    expect(t.waitingHoursChange.mean).toBeLessThan(0);
    expect(t.breakEven.status).toBe("finite");
    expect(t.breakEven.value).toBeCloseTo(-30 / t.waitingHoursChange.mean, 10);
    expect(await ws.compare(alt.id, baseline.id)).toBe(cmp); // cached by result hash

    const rep = (await ws.reproduce(alt.id))!;
    expect(rep.status).toBe("identical");
    expect(ws.getState().busy).toBeNull();
  }, 60_000);

  it("completed scenarios cannot be edited through the UI layer; the error is surfaced", async () => {
    const { ws, baseline } = await smallWorkspace();
    await ws.run(baseline.id);
    const result = await ws.editParam(baseline.id, "servers", 4);
    expect(result).toBeUndefined();
    expect(ws.getState().error).toMatch(/locked/);
    expect(ws.get(baseline.id).spec.params.servers).toBe(2);
  }, 60_000);

  it("persists a validated bundle and restores it; corrupted storage is reported, not loaded", async () => {
    const { ws, storage, baseline } = await smallWorkspace();
    await ws.fork(baseline.id, "Alt");
    const again = new Workspace(directEngine, storage);
    await again.restore();
    expect(again.getState().scenarios.map((s) => s.name)).toEqual(["Front desk (today)", "Alt"]);

    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, bundle: saved.bundle.replace('"servers": 2', '"servers": 7') }));
    const broken = new Workspace(directEngine, storage);
    await broken.restore();
    expect(broken.getState().scenarios).toHaveLength(0);
    expect(broken.getState().loadError).toMatch(/could not be validated/);
  });

  it("export → import round trip through the UI layer; tampered imports show an error", async () => {
    const { ws, baseline } = await smallWorkspace();
    await ws.fork(baseline.id, "Alt");
    const text = ws.exportText();
    const other = new Workspace(directEngine, new MemoryStorage());
    await other.importText(text);
    expect(other.getState().scenarios.map((s) => s.fingerprint)).toEqual(ws.getState().scenarios.map((s) => s.fingerprint));
    await other.importText(text.replace('"arrivalRatePerHour": 16', '"arrivalRatePerHour": 1.9'));
    expect(other.getState().error).toMatch(/fingerprint does not match/);
    expect(other.getState().scenarios).toHaveLength(2); // previous state kept
  });

  it("CSV estimate → apply with an override → new fork with provenance; parent unchanged", async () => {
    const { ws, baseline } = await smallWorkspace();
    const log = generateSyntheticArrivalLog({ seed: 424242, arrivalRatePerHour: 1.5, meanServiceMinutes: 50, start: "2026-03-02T00:00:00Z", hours: 400 });
    const report = await ws.estimate(log.csv, {
      fileName: "clinic-arrivals-SYNTHETIC.csv", synthetic: true,
      mapping: { arrivalTime: "arrival_time", serviceDuration: "service_minutes" }, serviceDurationUnit: "minutes",
      observationWindow: { start: log.windowStart, end: log.windowEnd }, timezone: { assumeOffsetMinutes: null },
    });
    expect(report.ok).toBe(true);
    const before = canonicalStringify(ws.get(baseline.id));
    const child = (await ws.applyEstimate(baseline.id, report, "Measured demand", { serviceRate: 1.25 }))!;
    expect(child.parentId).toBe(baseline.id);
    expect(child.spec.params.arrivalRatePerHour).toBe(report.arrivalRate!.perHour);
    expect(child.spec.params.serviceRatePerHour).toBe(1.25);
    expect(child.spec.dataProvenance).toMatchObject({ synthetic: true, serviceRateOverridden: true, arrivalRateOverridden: false });
    expect(canonicalStringify(ws.get(baseline.id))).toBe(before);
    expect(ws.getState().selectedId).toBe(child.id);
  });

  it("scheduling example: demand from the synthetic log, three real forks, run, compare, export/import", async () => {
    const card = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../data/synthetic/frontdesk-daily-SYNTHETIC.card.json", import.meta.url)), "utf8"));
    const csv = readFileSync(fileURLToPath(new URL("../../../../data/synthetic/frontdesk-daily-SYNTHETIC.csv", import.meta.url)), "utf8");
    const ws = new Workspace(directEngine, new MemoryStorage());
    const r = (await ws.loadScheduleExample({ csv, fileName: card.fileName, synthetic: true, observationWindow: card.observationWindow, localUtcOffsetMinutes: -300 }))!;
    // Rates come from the log; staffing is entered by hand; provenance is in the fingerprinted spec.
    expect(r.base.spec.params.rate3).toBe(24.85);
    expect(r.base.spec.dataProvenance).toMatchObject({ kind: "block-rates", synthetic: true, block3Arrivals: 497, block3ExposureHours: 20 });
    expect(r.allDay.parentId).toBe(r.base.id);
    expect(r.peak.parentId).toBe(r.base.id);
    expect(r.peak.changesFromParent.map((c) => c.path)).toEqual(["params.staff3"]);
    expect(r.allDay.changesFromParent).toHaveLength(6);
    expect(ws.family(r.peak.id).map((s) => s.id)).toEqual([r.base.id, r.allDay.id, r.peak.id]);
    await ws.runMany([r.base.id, r.allDay.id, r.peak.id]);
    expect(ws.getState().scenarios.every((s) => s.status === "completed")).toBe(true);
    const cAll = (await ws.compare(r.allDay.id, r.base.id, true))!;
    const cPeak = (await ws.compare(r.peak.id, r.base.id, true))!;
    expect(cPeak.sensitivity.available).toBe(false); // quick comparison: no one-at-a-time runs
    expect(cPeak.tradeoff!.breakEven.status).toBe("finite");
    expect(cPeak.tradeoff!.breakEven.value!).toBeLessThan(cAll.tradeoff!.breakEven.value!);
    const other = new Workspace(directEngine, new MemoryStorage());
    await other.importText(ws.exportText());
    expect(other.getState().scenarios.map((s) => s.fingerprint)).toEqual(ws.getState().scenarios.map((s) => s.fingerprint));
    expect((await other.reproduce(r.peak.id))!.status).toBe("identical");
  }, 120_000);

  it("tree helpers expose lineage for the visual branching view", async () => {
    const { ws, baseline } = await smallWorkspace();
    const a = (await ws.fork(baseline.id, "A"))!;
    const a2 = (await ws.fork(a.id, "A2"))!;
    expect(ws.roots().map((s) => s.id)).toEqual([baseline.id]);
    expect(ws.children(baseline.id).map((s) => s.id)).toEqual([a.id]);
    expect(ws.lineage(a2.id).map((s) => s.name)).toEqual(["Front desk (today)", "A", "A2"]);
    expect((await ws.fork(a.id, "   "))).toBeUndefined();
    expect(ws.getState().error).toMatch(/name/);
  });
});
