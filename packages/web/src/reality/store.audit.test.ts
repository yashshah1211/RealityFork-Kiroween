/**
 * R18 store behaviour: every saved map stays reachable with its edits (RF-02), a typed starting value is the user's and
 * example figures are examples (RF-06), and Compare's simulated outcomes come from the validated engine, never from a
 * run that does not exist (RF-03). No AI is involved; the fetcher is a stub that is never called.
 */
import { describe, expect, it } from "vitest";
import { importRealities, knownView, valueOrigin } from "@realityfork/core";
import { directEngine } from "../engine";
import type { StorageLike } from "../state/workspace";
import { REALITY_STORAGE_KEY, RealityStore, savedMaps, simCompareKey, simKey, type ApiFetcher } from "./store";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}
const noAi: ApiFetcher = async () => {
  throw new Error("no AI request is expected in these tests");
};
/** A clock one minute apart per reading, so edit order is unambiguous. */
const clock = () => {
  let t = Date.parse("2026-11-07T09:00:00.000Z");
  return () => new Date((t += 60_000)).toISOString();
};
const make = (storage: StorageLike = new MemoryStorage(), now = clock()) => new RealityStore(directEngine, storage, noAi, async () => undefined, now);

describe("RF-02: every saved map stays reachable", () => {
  it("six maps, each edited, all come back after a reload with their edits; opening one changes neither order nor times", async () => {
    const storage = new MemoryStorage();
    const store = make(storage);
    for (const [i, ex] of ["move-city", "solar", "cafe-queue", "move-city", "solar", "cafe-queue"].entries()) {
      const r = await store.loadExample(ex);
      const start = r!.branches[0]!;
      await store.updateBranch(start.id, { possibilities: [...start.possibilities, { id: `edit-${i + 1}`, text: `My edit ${i + 1}`, likelihood: "not-judged", note: "", tone: "upside" }] });
      store.home();
    }
    const ids = store.getState().realities.map((r) => r.id);
    expect(new Set(ids).size).toBe(6);

    const again = make(storage);
    await again.restore();
    const s = again.getState();
    expect(s.loadError).toBeNull();
    expect(s.realities.map((r) => r.id)).toEqual(ids);
    s.realities.forEach((r, i) => expect(r.branches[0]!.possibilities.map((p) => p.text)).toContain(`My edit ${i + 1}`));
    // Most recently edited first, each map once, each with its recorded time.
    expect(savedMaps(s).map((m) => m.reality.id)).toEqual([...ids].reverse());
    expect(savedMaps(s).every((m) => m.edited !== null)).toBe(true);
    const times = s.edited;
    for (const id of ids) {
      again.open(id);
      again.home();
    }
    expect(again.getState().edited).toEqual(times);
    expect(savedMaps(again.getState()).map((m) => m.reality.id)).toEqual([...ids].reverse());
  });

  it("reusing an existing path is not an edit", async () => {
    const store = make();
    const r = (await store.loadExample("move-city"))!;
    const london = r.branches[1]!;
    await store.exploreChange(london.id, { key: "rent", value: 1200 });
    const t = store.getState().edited[r.id];
    await store.exploreChange(london.id, { key: "rent", value: 1200 });
    expect(store.getState().edited[r.id]).toBe(t);
    expect(store.active()!.branches).toHaveLength(4);
  });

  it("maps saved before R18 (no edit times) load; they follow in creation order, newest first; a malformed time is ignored", async () => {
    const storage = new MemoryStorage();
    const store = make(storage);
    await store.loadExample("solar");
    await store.loadExample("move-city");
    const saved = JSON.parse(storage.getItem(REALITY_STORAGE_KEY)!) as { activeId: string; bundle: string };
    storage.setItem(REALITY_STORAGE_KEY, JSON.stringify({ activeId: saved.activeId, bundle: saved.bundle }));
    const old = make(storage);
    await old.restore();
    expect(old.getState().loadError).toBeNull();
    expect(old.getState().edited).toEqual({});
    expect(savedMaps(old.getState()).map((m) => [m.reality.question, m.edited])).toEqual([
      ["What if I moved from Mumbai to London?", null],
      ["What if our household installed solar panels?", null],
    ]);
    const firstId = old.getState().realities[0]!.id;
    storage.setItem(REALITY_STORAGE_KEY, JSON.stringify({ ...saved, edited: { [firstId]: 42, unknownMap: "2026-11-07T09:00:00.000Z" } }));
    const odd = make(storage);
    await odd.restore();
    expect(odd.getState().edited).toEqual({});
    expect(odd.getState().realities).toHaveLength(2);
  });

  it("export and import carry every map unchanged; the file has no edit times; importing maps that are already saved changes nothing", async () => {
    const store = make();
    for (const ex of ["move-city", "solar", "cafe-queue"]) await store.loadExample(ex);
    const text = store.exportText();
    expect(Object.keys(JSON.parse(text))).toEqual(["schema", "realities"]);
    const fresh = make();
    await fresh.importText(text);
    expect(fresh.getState().realities).toEqual(await importRealities(text));
    expect(fresh.getState().edited).toEqual({});
    // R18.1: maps already saved with identical content are left exactly as they are, with their recorded edit times.
    const times = store.getState().edited;
    const before = store.getState().realities;
    await store.importText(text);
    expect(store.getState().realities).toEqual(before);
    expect(store.getState().edited).toEqual(times);
    expect(store.getState().notice).toMatch(/^Nothing new/);
  });

  it("removing a map drops its time and nothing else", async () => {
    const store = make();
    const a = (await store.loadExample("solar"))!;
    const b = (await store.loadExample("cafe-queue"))!;
    store.removeReality(a.id);
    expect(store.getState().realities.map((r) => r.id)).toEqual([b.id]);
    expect(Object.keys(store.getState().edited)).toEqual([b.id]);
  });
});

describe("RF-06: who gave each value", () => {
  it("a starting value typed in the editor is recorded as the user's and shown under Known; an unknown one has no source", async () => {
    const store = make();
    await store.create("I rented a bigger flat?");
    await store.addVariable({ label: "Monthly rent", kind: "number", unit: "£ per month" }, 1200);
    await store.addVariable({ label: "Deposit", kind: "number", unit: "£" }, null);
    const r = store.active()!;
    expect(r.branches[0]!.sources).toEqual({ monthlyRent: "user" });
    expect(knownView(r, r.branches[0]!).values.map((x) => [x.variable.key, x.value])).toEqual([["monthlyRent", 1200]]);
  });

  it("an example's figures are examples, never the user's", async () => {
    const store = make();
    const r = (await store.loadExample("move-city"))!;
    const london = r.branches[1]!;
    expect(valueOrigin(r, london, "rent").origin).toBe("example");
    expect(knownView(r, london).values).toEqual([]);
    await store.answer(london.id, "rent", 1300);
    const after = store.active()!;
    expect(valueOrigin(after, after.branches[1]!, "rent").origin).toBe("user");
  });
});

describe("RF-03: simulated outcomes in Compare", () => {
  it("compares two finished runs with the validated engine, paired; never compares a path that was not simulated", async () => {
    const store = make();
    const r = (await store.loadExample("cafe-queue"))!;
    const [one, two] = r.branches;
    await store.runSimulation(one!.id, "queueWait");
    await store.compareSimulations(two!.id, one!.id, "queueWait");
    expect(store.getState().simCompare).toEqual({});
    await store.runSimulation(two!.id, "queueWait");
    await store.compareSimulations(two!.id, one!.id, "queueWait");
    const s = store.getState();
    const entry = s.simCompare[simCompareKey(two!, one!, "queueWait")];
    const ra = s.sims[simKey(two!, "queueWait")];
    const rb = s.sims[simKey(one!, "queueWait")];
    if (entry?.status !== "done" || ra?.status !== "done" || rb?.status !== "done") throw new Error("expected two runs and their comparison");
    expect(entry.outcome.metric).toBe("meanWait");
    expect(entry.paired).toBe(true);
    expect(entry.outcome.baselineMean).toBe(ra.scenario.result!.summary.meanWait!.mean);
    expect(entry.outcome.variantMean).toBe(rb.scenario.result!.summary.meanWait!.mean);
    expect(entry.outcome.directDifference).toBeCloseTo(entry.outcome.variantMean - entry.outcome.baselineMean, 12);
    expect(entry.outcome.difference.ciLow).toBeLessThan(entry.outcome.difference.ciHigh);
    // One barista (B) waits longer than two (A) in this seeded run, and the interval excludes zero.
    expect(entry.outcome.conclusion).toBe("variant-higher");
    await store.compareSimulations(two!.id, one!.id, "queueWait");
    expect(store.getState().simCompare[simCompareKey(two!, one!, "queueWait")]).toBe(entry);
  }, 120_000);

  it("after a path changes, its earlier run is not shown for it: the run is out of date, never zero", async () => {
    const store = make();
    const r = (await store.loadExample("cafe-queue"))!;
    const two = r.branches[1]!;
    await store.runSimulation(two.id, "queueWait");
    await store.answer(two.id, "customersPerHour", 30);
    const changed = store.active()!.branches[1]!;
    expect(changed.fingerprint).not.toBe(two.fingerprint);
    expect(store.getState().sims[simKey(changed, "queueWait")]).toBeUndefined();
    expect(store.getState().lastRun[`${two.id}|queueWait`]).toBe(two.fingerprint);
  }, 120_000);
});
