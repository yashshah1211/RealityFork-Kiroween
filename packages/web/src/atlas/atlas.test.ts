/**
 * 3D Explore preview: the presentation rules that decide what is drawn. Built with the real RealityStore and the
 * built-in examples (no AI, no network): which paths get the detailed London world, which get the open landscape,
 * and where each island goes.
 */
import { describe, expect, it } from "vitest";
import type { Reality } from "@realityfork/core";
import { directEngine } from "../engine";
import type { StorageLike } from "../state/workspace";
import { RealityStore, type ApiFetcher } from "../reality/store";
import { focusLayout, lineage, neighbour, overviewLayout, treeOf } from "./layout";
import { atlasRequested } from "./flag";
import { DESCRIBED_LANDSCAPE, OPEN_LANDSCAPE, worldFor } from "./worlds";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}
const noAi: ApiFetcher = async () => {
  throw new Error("no AI request is expected");
};
const make = () => new RealityStore(directEngine, new MemoryStorage(), noAi, async () => undefined);
const byName = (r: Reality, name: string) => {
  const b = r.branches.find((x) => x.name === name);
  if (!b) throw new Error(`no path "${name}" in ${r.branches.map((x) => x.name).join(", ")}`);
  return b;
};
const worldOf = (s: RealityStore, name: string) => worldFor(s.active()!, byName(s.active()!, name));

describe("the preview flag", () => {
  it("is opt-in and exact", () => {
    expect(atlasRequested("")).toBe(false);
    expect(atlasRequested("?preview=atlas")).toBe(true);
    expect(atlasRequested("?x=1&preview=atlas")).toBe(true);
    expect(atlasRequested("?preview=Atlas")).toBe(false);
    expect(atlasRequested("?preview=atlas2")).toBe(false);
  });
});

describe("which world a path is drawn as", () => {
  it("Mumbai to London: London only where the map says City is London", async () => {
    const s = make();
    await s.loadExample("move-city");
    expect(worldOf(s, "Stay in Mumbai")).toEqual({ kind: "generic", reason: OPEN_LANDSCAPE });
    expect(worldOf(s, "Move to London").kind).toBe("london");
    expect(worldOf(s, "Move to London").reason).toBe("Shown as London: City is London on this path.");
    expect(worldOf(s, "London, remote job").kind).toBe("london");
  });

  it("a new path with a different value keeps the place; choosing another city does not", async () => {
    const s = make();
    await s.loadExample("move-city");
    const london = byName(s.active()!, "Move to London");
    await s.exploreChange(london.id, { key: "rent", value: 1200 });
    const rentPath = s.selected()!;
    expect(rentPath.parentId).toBe(london.id);
    expect(worldFor(s.active()!, rentPath).kind).toBe("london");
    await s.exploreChange(london.id, { key: "city", value: "Mumbai" });
    expect(worldFor(s.active()!, s.selected()!).kind).toBe("generic");
  });

  it("a change described in words never gets a detailed place, even when it names one", async () => {
    const s = make();
    await s.loadExample("move-city");
    const london = byName(s.active()!, "Move to London");
    await s.exploreChange(london.id, { text: "Live in Manchester instead" });
    const described = s.selected()!;
    expect(described.values.city).toBe("London"); // the value is copied: RealityFork does not read the words
    expect(worldFor(s.active()!, described)).toEqual({ kind: "generic", reason: DESCRIBED_LANDSCAPE });
    // ...and what continues from it does not get the place back by itself
    await s.exploreChange(described.id, { key: "rent", value: 900 });
    expect(worldFor(s.active()!, s.selected()!).kind).toBe("generic");
    // choosing the place again after the words does
    const root = s.active()!.branches[0]!;
    await s.exploreChange(root.id, { text: "Move to London with my partner" });
    expect(worldFor(s.active()!, s.selected()!).kind).toBe("generic");
    await s.exploreChange(s.selected()!.id, { key: "city", value: "London" });
    expect(worldFor(s.active()!, s.selected()!).kind).toBe("london");
  });

  it("solar: every path is an open landscape (no place, no invented imagery)", async () => {
    const s = make();
    await s.loadExample("solar");
    const r = s.active()!;
    expect(r.branches.length).toBe(4);
    for (const b of r.branches) expect(worldFor(r, b)).toEqual({ kind: "generic", reason: OPEN_LANDSCAPE });
  });

  it("maps without a place choice use the path's name, and only from the start of it", async () => {
    const s = make();
    await s.create("What if I changed jobs?");
    const root = s.active()!.branches[0]!;
    await s.forkWith(root.id, "Move to London for a new job");
    const named = s.selected()!;
    await s.forkWith(named.id, "Working draft");
    const copy = s.selected()!;
    await s.forkWith(root.id, "Stay here, visit London");
    const visit = s.selected()!;
    await s.forkWith(root.id, "Don't move to London");
    const dont = s.selected()!;
    const r = s.active()!;
    expect(worldFor(r, named).kind).toBe("london");
    expect(worldFor(r, copy)).toEqual({ kind: "london", reason: "Shown as London: it continues “Move to London for a new job”." });
    expect(worldFor(r, visit).kind).toBe("generic");
    expect(worldFor(r, dont).kind).toBe("generic");
    expect(worldFor(r, root).kind).toBe("generic");
  });
});

describe("where islands go", () => {
  it("focus: the selected future, where it came from, other paths from the same place, what continues", async () => {
    const s = make();
    await s.loadExample("solar");
    const r = s.active()!;
    const nodes = treeOf(r);
    const start = r.branches[0]!;
    const battery = byName(r, "Add a battery");
    const atStart = focusLayout(nodes, start.id);
    expect(atStart.get(start.id)?.role).toBe("selected");
    expect([...atStart.values()].filter((x) => x.visible && x.role === "child")).toHaveLength(3);
    const atBattery = focusLayout(nodes, battery.id);
    expect(atBattery.get(start.id)?.role).toBe("ancestor");
    expect([...atBattery.values()].filter((x) => x.visible && x.role === "sibling")).toHaveLength(2);
    // on a phone, at most two other islands are shown beside the selected one
    const phone = focusLayout(nodes, start.id, { narrow: true });
    expect([...phone.values()].filter((x) => x.visible)).toHaveLength(3);
    // every path has a place, visible or waiting
    expect(atBattery.size).toBe(r.branches.length);
  });

  it("overview shows every path, and the line to the selected one is marked", async () => {
    const s = make();
    await s.loadExample("move-city");
    const r = s.active()!;
    const nodes = treeOf(r);
    const remote = byName(r, "London, remote job");
    const ov = overviewLayout(nodes, remote.id);
    expect([...ov.values()].every((x) => x.visible)).toBe(true);
    expect(lineage(nodes, remote.id).map((id) => r.branches.find((b) => b.id === id)!.name)).toEqual(["Stay in Mumbai", "Move to London", "London, remote job"]);
    expect([...ov.entries()].filter(([, x]) => x.onPath).length).toBe(3);
  });

  it("keyboard moves follow the tree", async () => {
    const s = make();
    await s.loadExample("solar");
    const r = s.active()!;
    const nodes = treeOf(r);
    const [start, a, b, c] = [r.branches[0]!, ...r.branches.filter((x) => x.parentId === r.branches[0]!.id)];
    expect(neighbour(nodes, start.id, "ArrowDown")).toBe(a!.id);
    expect(neighbour(nodes, a!.id, "ArrowRight")).toBe(b!.id);
    expect(neighbour(nodes, c!.id, "ArrowRight")).toBeNull();
    expect(neighbour(nodes, b!.id, "ArrowLeft")).toBe(a!.id);
    expect(neighbour(nodes, b!.id, "ArrowUp")).toBe(start.id);
    expect(neighbour(nodes, start.id, "ArrowUp")).toBeNull();
    expect(neighbour(nodes, c!.id, "Home")).toBe(start.id);
  });
});
