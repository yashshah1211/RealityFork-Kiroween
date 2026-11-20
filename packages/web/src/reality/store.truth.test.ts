/**
 * R18.1 store behaviour.
 * P1: a change the user describes in words is kept as that change on a new path (a hypothetical, never a value or a
 * known fact), the parent is untouched, and a copy that only has a name says nothing changed.
 * P5: importing a file never replaces or drops a map that is already saved.
 * No AI is involved; the fetcher is a stub that is never called.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildFromTemplate,
  changesFromParent,
  EXAMPLES,
  exportRealities,
  importRealities,
  INTERVENTION_QUESTION,
  isIntervention,
  whatIfView,
  type Possibility,
  type Reality,
} from "@realityfork/core";
import { directEngine } from "../engine";
import type { StorageLike } from "../state/workspace";
import { REALITY_STORAGE_KEY, RealityStore, savedMaps, type ApiFetcher } from "./store";

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
const note = (id: string, text: string): Possibility => ({ id, text, likelihood: "not-judged", note: "", tone: "upside", source: "user" });
const example = (id: string) => buildFromTemplate(EXAMPLES.find((x) => x.id === id)!);
/** A saved-file fixture written by an earlier version of RealityFork (packages/core/test/fixtures). */
const savedFile = (name: string) => readFileSync(fileURLToPath(new URL(`../../../core/test/fixtures/${name}`, import.meta.url)), "utf8");
const noteTexts = (r: Reality) => r.branches[0]!.possibilities.map((p) => p.text);

describe("P1: a change described in words is kept as that change", () => {
  const SENTENCE = "I split the two hours into four focused sessions with breaks.";

  it("the new path holds the sentence as a hypothetical; no value, source or parent changes", async () => {
    const store = make();
    const r = (await store.loadExample("move-city"))!;
    const start = r.branches[0]!;
    const child = (await store.exploreChange(start.id, { text: SENTENCE }))!;
    const after = store.active()!;

    expect(child.parentId).toBe(start.id);
    expect(child.facts).toHaveLength(1);
    expect(child.facts![0]).toMatchObject({ question: INTERVENTION_QUESTION, answer: SENTENCE });
    expect(isIntervention(child.facts![0]!)).toBe(true);
    // Nothing is invented: every value and every recorded source is exactly the parent's, and the parent is unchanged
    // (same content, hence the same fingerprint; the map is re-sealed when a path is added, so it is not the same object).
    expect(child.values).toEqual(start.values);
    expect(child.sources).toEqual(start.sources);
    const parentAfter = after.branches.find((b) => b.id === start.id)!;
    expect(parentAfter).toEqual(start);
    expect(parentAfter.fingerprint).toBe(start.fingerprint);
    expect(after.branches).toHaveLength(r.branches.length + 1);

    // "Changed" has one definition: this path differs by what the user told it, and by no value.
    const diff = changesFromParent(after, child);
    expect(diff.changes).toEqual([]);
    expect(diff.told).toEqual([{ question: INTERVENTION_QUESTION, from: null, to: SENTENCE }]);
    const view = whatIfView(after, child.id)!;
    expect(view.changed).toEqual([]);
    expect(view.told).toEqual(diff.told);
    // No calculation is claimed to have changed.
    expect(view.calculated).toEqual([]);
  });

  it("notes the parent already held are copied as they are; the parent keeps exactly its own", async () => {
    const store = make();
    const r = (await store.loadExample("move-city"))!;
    await store.updateBranch(r.branches[0]!.id, { possibilities: [...r.branches[0]!.possibilities, note("mine", "I would sleep better")] });
    const parent = store.active()!.branches[0]!;
    const child = (await store.exploreChange(parent.id, { text: SENTENCE }))!;
    expect(child.possibilities.map((p) => [p.id, p.text, p.source])).toEqual(parent.possibilities.map((p) => [p.id, p.text, p.source]));
    const parentAfter = store.active()!.branches.find((b) => b.id === parent.id)!;
    expect(parentAfter).toEqual(parent);
    expect(parentAfter.fingerprint).toBe(parent.fingerprint);
  });

  it("the same sentence reuses the same path and is not an edit; a different sentence is a sibling", async () => {
    const store = make();
    const r = (await store.loadExample("move-city"))!;
    const start = r.branches[0]!;
    const first = (await store.exploreChange(start.id, { text: SENTENCE }))!;
    const t = store.getState().edited[r.id];
    const again = (await store.exploreChange(start.id, { text: `  ${SENTENCE}  ` }))!;
    expect(again.id).toBe(first.id);
    expect(store.active()!.branches).toHaveLength(r.branches.length + 1);
    expect(store.getState().edited[r.id]).toBe(t);

    const other = (await store.exploreChange(start.id, { text: "I take the long weekend off before starting." }))!;
    expect(other.id).not.toBe(first.id);
    expect(other.parentId).toBe(start.id);
    expect(store.active()!.branches).toHaveLength(r.branches.length + 2);
  });

  it("a path that only has a name says nothing changed, and is not given an invented change", async () => {
    const store = make();
    const r = (await store.loadExample("move-city"))!;
    const start = r.branches[0]!;
    const copy = (await store.forkWith(start.id, "A quieter month"))!;
    expect(copy.name).toBe("A quieter month");
    expect(copy.facts ?? []).toEqual([]);
    expect(copy.values).toEqual(start.values);
    const diff = changesFromParent(store.active()!, copy);
    expect([diff.changes, diff.told]).toEqual([[], []]);
    // Naming is not describing: the name never becomes an intervention.
    expect((copy.facts ?? []).some(isIntervention)).toBe(false);
  });

  it("a number the user chooses is a value change, not a described one", async () => {
    const store = make();
    const r = (await store.loadExample("move-city"))!;
    const london = r.branches[1]!;
    const child = (await store.exploreChange(london.id, { key: "rent", value: 1200 }))!;
    expect(child.values.rent).toBe(1200);
    expect(child.sources?.rent).toBe("user");
    expect((child.facts ?? []).some(isIntervention)).toBe(false);
    const diff = changesFromParent(store.active()!, child);
    expect(diff.changes.map((c) => c.key)).toEqual(["rent"]);
    expect(diff.told).toEqual([]);
  });

  it("the sentence survives saving, reloading and exporting; the parent keeps its fingerprint", async () => {
    const storage = new MemoryStorage();
    const store = make(storage);
    const r = (await store.loadExample("move-city"))!;
    const start = r.branches[0]!;
    const child = (await store.exploreChange(start.id, { text: SENTENCE }))!;

    const again = make(storage);
    await again.restore();
    expect(again.getState().loadError).toBeNull();
    const loaded = again.getState().realities.find((x) => x.id === r.id)!;
    const back = loaded.branches.find((b) => b.id === child.id)!;
    expect(back.facts).toEqual(child.facts);
    expect(back.fingerprint).toBe(child.fingerprint);
    expect(loaded.branches.find((b) => b.id === start.id)!.fingerprint).toBe(start.fingerprint);

    const [imported] = await importRealities(store.exportText());
    expect(imported!.branches.find((b) => b.id === child.id)!.facts).toEqual(child.facts);
  });
});

describe("P5: importing a file never replaces a saved map", () => {
  /** A blank map with one note, exported; then a second note added. `older` is the file written before the second note. */
  async function savedThenEdited(storage = new MemoryStorage()) {
    const store = make(storage);
    const r = (await store.create("keep my work"))!;
    const startId = r.branches[0]!.id;
    await store.updateBranch(startId, { possibilities: [note("n1", "Version one, written before the export")] });
    const older = store.exportText();
    await store.updateBranch(startId, { possibilities: [...store.active()!.branches[0]!.possibilities, note("n2", "Version two, written after the export")] });
    store.home();
    return { store, storage, older, id: r.id };
  }

  it("an older file over an edited map: the newer map is preserved, the older version is added as a separate copy, and the notice says so", async () => {
    const { store, storage, older, id } = await savedThenEdited();
    const newer = store.getState().realities[0]!;
    const times = store.getState().edited;
    expect(noteTexts(newer)).toEqual(["Version one, written before the export", "Version two, written after the export"]);

    await store.importText(older);
    const s = store.getState();
    expect(s.error).toBeNull();
    expect(s.realities).toHaveLength(2);
    // The saved map is the very same object, with its note from after the export and its recorded edit time.
    expect(s.realities[0]).toBe(newer);
    expect(noteTexts(s.realities[0]!)).toContain("Version two, written after the export");
    expect(s.edited[id]).toBe(times[id]);
    // The older version is its own map under a new ID: same question, the older content, nothing recorded about when.
    const copy = s.realities[1]!;
    expect(copy.id).not.toBe(id);
    expect(copy.question).toBe(newer.question);
    expect(noteTexts(copy)).toEqual(["Version one, written before the export"]);
    expect(s.edited[copy.id]).toBeUndefined();
    expect(Object.keys(s.edited)).toEqual([id]);
    // The interface reports the conflict in plain words.
    expect(s.notice).toBe(
      `Restored 1 reality from the file. 1 map differs from the saved map with the same ID, so it was added as a separate copy (map ${copy.id.slice(-6)}). Nothing you saved was changed.`,
    );
    expect(s.activeId).toBeNull();
    // Both maps are listed under "All your maps"; the saved one keeps its place by its edit time.
    expect(savedMaps(s).map((m) => m.reality.id)).toEqual([id, copy.id]);

    // And a reload shows the same two maps.
    const again = make(storage);
    await again.restore();
    expect(again.getState().loadError).toBeNull();
    expect(again.getState().realities.map((r) => r.id)).toEqual([id, copy.id]);
    expect(noteTexts(again.getState().realities[0]!)).toHaveLength(2);
    expect(noteTexts(again.getState().realities[1]!)).toHaveLength(1);
    expect(again.getState().edited).toEqual({ [id]: times[id] });
  });

  it("importing the same older file again adds nothing more", async () => {
    const { store, older } = await savedThenEdited();
    await store.importText(older);
    const once = store.getState().realities;
    expect(once).toHaveLength(2);
    await store.importText(older);
    expect(store.getState().realities).toEqual(once);
    expect(store.getState().notice).toBe("Nothing new: every map in the file is already saved exactly as it is.");
  });

  it("a file of maps already saved exactly as they are changes nothing, including their edit times", async () => {
    const { store } = await savedThenEdited();
    const before = store.getState().realities;
    const times = store.getState().edited;
    await store.importText(store.exportText());
    expect(store.getState().realities).toEqual(before);
    expect(store.getState().realities[0]).toBe(before[0]);
    expect(store.getState().edited).toEqual(times);
    expect(store.getState().notice).toBe("Nothing new: every map in the file is already saved exactly as it is.");
  });

  it("a mixed file is handled map by map, and the notice reports each kind", async () => {
    const { store, older, id } = await savedThenEdited();
    const cafe = (await store.loadExample("cafe-queue"))!;
    store.home();
    const newer = store.getState().realities[0]!;
    const [olderMap] = await importRealities(older);
    const solar = await example("solar");

    // One file: an older version of a saved map, a map saved exactly as it is, and a map that is new here.
    await store.importText(exportRealities([olderMap!, cafe, solar]));
    let s = store.getState();
    const copy = s.realities.find((r) => r.id !== id && r.id !== cafe.id && r.id !== solar.id)!;
    expect(s.realities.map((r) => r.id)).toEqual([id, cafe.id, copy.id, solar.id]);
    expect(s.realities[0]).toBe(newer);
    expect(s.notice).toBe(
      `Restored 2 realities from the file. 1 already saved was left as it is. 1 map differs from the saved map with the same ID, so it was added as a separate copy (map ${copy.id.slice(-6)}). Nothing you saved was changed.`,
    );

    // The same maps again: nothing is new.
    await store.importText(exportRealities([solar, newer, cafe]));
    s = store.getState();
    expect(s.realities).toHaveLength(4);
    expect(s.notice).toBe("Nothing new: every map in the file is already saved exactly as it is.");

    // Something new beside something already saved.
    const move = await example("move-city");
    await store.importText(exportRealities([solar, move]));
    s = store.getState();
    expect(s.realities).toHaveLength(5);
    expect(s.notice).toBe("Restored 1 reality from the file. 1 already saved was left as it is.");
  });

  it("a normal import into an empty browser restores every map as it was, with no edit times", async () => {
    const source = make();
    for (const ex of ["move-city", "solar", "cafe-queue"]) await source.loadExample(ex);
    const text = source.exportText();
    const fresh = make();
    await fresh.importText(text);
    const s = fresh.getState();
    expect(s.error).toBeNull();
    expect(s.realities).toEqual(await importRealities(text));
    expect(s.edited).toEqual({});
    expect(s.notice).toBe("Restored 3 realities from the file.");

    const one = make();
    await one.importText(exportRealities([s.realities[0]!]));
    expect(one.getState().notice).toBe("Restored 1 reality from the file.");
  });

  it("a file that cannot be read changes nothing and says why", async () => {
    const { store, older } = await savedThenEdited();
    const before = store.getState().realities;
    const times = store.getState().edited;
    await store.importText("this is not a realities file");
    expect(store.getState().realities).toBe(before);
    expect(store.getState().error).toMatch(/not valid JSON/);

    // A file edited by hand no longer matches its fingerprints and is refused whole.
    const tampered = older.replace("Version one, written before the export", "Version one, quietly changed");
    expect(tampered).not.toBe(older);
    await store.importText(tampered);
    expect(store.getState().realities).toBe(before);
    expect(store.getState().error).toMatch(/fingerprint does not match/);
    expect(store.getState().edited).toEqual(times);
  });

  it("files saved by earlier versions import beside saved maps; two with the same map ID both survive", async () => {
    const store = make();
    // 6e4b8f2 (before tones and origins): two maps.
    await store.importText(savedFile("realities-6e4b8f2.json"));
    expect(store.getState().error).toBeNull();
    expect(store.getState().realities.map((r) => r.id)).toEqual(["fx1", "fx8"]);
    expect(store.getState().notice).toBe("Restored 2 realities from the file.");
    const first = store.getState().realities;

    // 5b17057 and 4e4bdfe are different maps that were both saved with the ID "id1". Importing the second over the first
    // used to replace it; now both are kept.
    await store.importText(savedFile("realities-5b17057.json"));
    expect(store.getState().notice).toBe("Restored 1 reality from the file.");
    await store.importText(savedFile("realities-4e4bdfe.json"));
    const s = store.getState();
    expect(s.error).toBeNull();
    expect(s.realities).toHaveLength(4);
    expect(s.realities.slice(0, 2)).toEqual(first);
    expect(s.realities.map((r) => r.question)).toEqual([
      "What if I moved from Mumbai to London?", "What if our family adopted a dog?", "What if I started my own restaurant?", "What if I moved to another country?",
    ]);
    expect(s.realities[2]!.id).toBe("id1");
    expect(s.realities[3]!.id).not.toBe("id1");
    expect(s.notice).toMatch(/^Restored 1 reality from the file\. 1 map differs from the saved map with the same ID, so it was added as a separate copy \(map \w{6}\)\. Nothing you saved was changed\.$/);
    expect(s.edited).toEqual({});

    // Each file again: nothing is new, and nothing piles up.
    for (const name of ["realities-6e4b8f2.json", "realities-5b17057.json", "realities-4e4bdfe.json"]) {
      await store.importText(savedFile(name));
      expect(store.getState().realities).toHaveLength(4);
      expect(store.getState().notice).toBe("Nothing new: every map in the file is already saved exactly as it is.");
    }

    // The result exports and imports whole, with every fingerprint intact.
    const back = await importRealities(store.exportText());
    expect(back).toEqual(store.getState().realities);
  });
});

describe("storage format", () => {
  it("the storage key is unchanged, so every map saved by an earlier version still loads", () => {
    expect(REALITY_STORAGE_KEY).toBe("realityfork.realities.v1");
  });
});
