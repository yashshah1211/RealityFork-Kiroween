/**
 * A future's visual state: what each path's picture shows and how it differs from its parent's, read from the map's
 * own figures through pathScenery. Built with the real RealityStore and the built-in examples (no AI, no network).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { proposalToReality, selectAll, updateBranch, validateProposal, type Reality } from "@realityfork/core";
import { directEngine } from "../../engine";
import type { StorageLike } from "../../state/workspace";
import { RealityStore, type ApiFetcher } from "../../reality/store";
import { pathScenery, resolveScenery } from "./resolve";
import { sceneView } from "./difference";

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
  if (!b) throw new Error(`no path "${name}"`);
  return b;
};
/** The scene view of a path, the way Explore computes it. */
const view = (r: Reality, name: string) => {
  const choice = resolveScenery(r);
  const b = byName(r, name);
  const parent = b.parentId ? r.branches.find((x) => x.id === b.parentId) : undefined;
  return sceneView(pathScenery(r, b, choice), parent && pathScenery(r, parent, choice));
};

describe("what a future's picture shows, and what differs from its parent", () => {
  it("café: one person at the counter on the start, two on the path with two baristas; a new path with three says three", async () => {
    const s = make();
    await s.loadExample("cafe-queue");
    let r = s.active()!;
    expect(view(r, "One barista")).toEqual({ changes: [], items: ["One person at the counter"] });
    expect(view(r, "Two baristas").changes).toEqual([{ key: "people", now: "Two people at the counter", before: "one person" }]);
    // A child made through the same operation as "Explore another path from here" inherits the café and changes only the count.
    await s.exploreChange(byName(r, "One barista").id, { key: "baristas", value: 3 });
    r = s.active()!;
    const three = r.branches.find((x) => x.values.baristas === 3)!;
    expect(view(r, three.name).changes).toEqual([{ key: "people", now: "Three people at the counter", before: "one person" }]);
    // Nothing else differs: the map, its paths and their values are what the store recorded.
    expect(r.branches).toHaveLength(3);
  });

  it("solar: the battery appears only on the path that says yes; London: the detailed place only where the map names it", async () => {
    const s = make();
    await s.loadExample("solar");
    let r = s.active()!;
    expect(view(r, "Add a battery").changes).toEqual([{ key: "battery", now: "A battery", before: "no battery" }]);
    await s.loadExample("move-city");
    r = s.active()!;
    expect(view(r, "Move to London").changes.map((c) => [c.key, c.now])).toEqual([["place", "The detailed London model"]]);
    // A path that changes nothing the picture can show says so instead of inventing a difference.
    expect(view(r, "London, remote job").changes).toEqual([]);
  });

  it("live test (sanitized draft): keeping the job, quitting it, delaying the launch and the start are four different pictures, from the futures' own choices", async () => {
    const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../../../e2e/fixtures/live-gaming-mumbai.json", import.meta.url)), "utf8")) as { question: string; proposal: unknown };
    const check = validateProposal(fx.proposal);
    if (!check.ok) throw new Error(check.errors.join("; "));
    let n = 0;
    const r = await proposalToReality(fx.question, check.proposal, selectAll(check.proposal), { model: "fixture", createdAt: "2026-11-17T00:00:00.000Z" }, () => `id${n++}`);
    const choice = resolveScenery(r);
    expect([choice.family, choice.theme]).toEqual(["business", "studio"]);
    const at = (name: string) => pathScenery(r, byName(r, name), choice);
    expect(at("As things are").props).toEqual([]);
    expect(at("Launch and stay employed").props).toEqual(["dayjob", "open"]);
    expect(at("Launch and quit job").props).toEqual(["open"]);
    expect(at("Delay launch").props).toEqual(["dayjob", "notyet"]);
    // Every picture differs from every other (what a kit is built from: family, setting, details, people).
    const looks = r.branches.map((b) => { const p = pathScenery(r, b, choice); return `${p.theme}|${[...p.props].sort().join(",")}|${p.people}`; });
    expect(new Set(looks).size).toBe(4);
    // Each difference is said, with the choice it comes from; the start says nothing it does not record.
    expect(view(r, "Launch and quit job").changes).toEqual([{ key: "open", now: "Bunting for the launch", before: "no launch bunting" }]);
    expect(view(r, "Delay launch").changes.map((c) => c.now)).toEqual(["An office tower for the current job", "Scaffolding: the launch waits"]);
    expect(at("Launch and quit job").reasons).toContain("No office tower for a current job: “Current job” is “Quit my job” on this path.");
    expect(at("Delay launch").reasons).toContain("Scaffolding: the launch waits, because “When the studio launches” is “In 6 months” on this path.");
    expect(view(r, "As things are")).toEqual({ changes: [], items: [] });
    // Numbers never change the picture: the same futures with the user's savings entered look the same.
    const withSavings = await updateBranch(r, byName(r, "Launch and quit job").id, { values: { savings: 500000 }, sources: { savings: "user" } });
    expect(pathScenery(withSavings, byName(withSavings, "Launch and quit job"), resolveScenery(withSavings)).props).toEqual(["open"]);
  });

  it("the same decisions are read from a yes/no or a path's own name when no choice records them; maps about other things show none", async () => {
    const s = make();
    await s.create("What if I opened a bakery while keeping my office job?");
    let r = s.active()!;
    await s.addVariable({ key: "keepJob", label: "Keep the office job", kind: "boolean", unit: "", options: [], source: "", uncertainty: "" }, null);
    r = s.active()!;
    await s.exploreChange(r.branches[0]!.id, { key: "keepJob", value: false });
    r = s.active()!;
    const quit = r.branches.find((b) => b.values.keepJob === false)!;
    const choice = resolveScenery(r);
    expect(choice.family).toBe("business");
    expect(pathScenery(r, quit, choice).props).toEqual([]);
    expect(pathScenery(r, quit, choice).reasons).toContain("No office tower for a current job: “Keep the office job” is no on this path.");
    // A path named for waiting, with nothing recorded: the name says it.
    await s.forkWith(r.branches[0]!.id, "Delay the launch until spring");
    r = s.active()!;
    expect(pathScenery(r, byName(r, "Delay the launch until spring"), resolveScenery(r)).props).toEqual(["notyet"]);
    // The café example is about staff, not a job or a launch: unchanged.
    await s.loadExample("cafe-queue");
    r = s.active()!;
    for (const b of r.branches) expect(pathScenery(r, b, resolveScenery(r)).props).toEqual([]);
  });

  it("a change described in words is marked as a what-if and nothing is read from the words", async () => {
    const s = make();
    await s.loadExample("cafe-queue");
    const r0 = s.active()!;
    await s.exploreChange(byName(r0, "Two baristas").id, { text: "Hire a third barista on weekends" });
    const r = s.active()!;
    const what = r.branches.find((x) => x.name === "Hire a third barista on weekends")!;
    expect(view(r, what.name).changes).toEqual([{ key: "what-if", now: "Marked as a what-if: your own words are not drawn", before: "not marked" }]);
  });
});
