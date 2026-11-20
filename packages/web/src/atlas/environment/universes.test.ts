/**
 * AI-drafted maps reach the adaptive scenery: schema-valid planner drafts for questions that are not built-in examples
 * (e2e/fixtures/universe-proposals.json) are turned into maps by the real RealityStore with a mocked provider, then
 * drawn by the same rules as any map. No network; the only request is the one planner draft the user asked for.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateProposal, type Proposal } from "@realityfork/core";
import { directEngine } from "../../engine";
import type { StorageLike } from "../../state/workspace";
import { RealityStore, type ApiFetcher } from "../../reality/store";
import { pathScenery, resolveScenery, type Family, type Theme } from "./resolve";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../../../e2e/fixtures/universe-proposals.json", import.meta.url)), "utf8")) as Record<string, unknown>;
const drafts = Object.entries(fx).filter((e): e is [string, Proposal] => !e[0].startsWith("_"));
const GAMING = "What if I started my own independent gaming company?";
const CAFE = "What if I opened a small café in my neighbourhood?";
const WETLANDS = "What if our town council chose to restore the river's wetlands instead of building higher flood walls?";
const FUTURE_SELF = "What if I could talk to my future self once a year?";
const EXPECTED: Readonly<Record<string, readonly [Family, Theme]>> = {
  [GAMING]: ["business", "studio"],
  [CAFE]: ["business", "cafe"],
  [WETLANDS]: ["energy", "water"],
  [FUTURE_SELF]: ["neutral", "sky"],
};

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

/** The user asks the question, the (mocked) planner drafts the futures, the user chooses the first one. */
async function accept(question: string) {
  const proposal = fx[question] as Proposal;
  const calls: string[] = [];
  const fetcher: ApiFetcher = async (path) => {
    calls.push(path);
    return { status: 200, body: { ok: true, proposal, model: "fixture: universe-proposals.json (mocked, no AI request)", warnings: [] } };
  };
  const s = new RealityStore(directEngine, new MemoryStorage(), fetcher, async () => undefined);
  await s.requestPlan(question);
  expect(s.getState().plan.status, question).toBe("ready");
  await s.acceptPlan(0);
  const r = s.active();
  if (!r) throw new Error(`no map for ${question}`);
  return { s, r, calls, proposal };
}

describe("AI-drafted maps get their own universe", () => {
  it("every fixture is a valid planner draft", () => {
    expect(drafts.map(([q]) => q).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [q, p] of drafts) {
      const check = validateProposal(p);
      expect(check.ok ? [] : check.errors, q).toEqual([]);
    }
  });

  it("each map is drawn from its own words, with the one planner request the user made and none for the scenery", async () => {
    for (const [q] of drafts) {
      const { r, calls, proposal } = await accept(q);
      const c = resolveScenery(r);
      expect([c.family, c.theme], q).toEqual(EXPECTED[q]);
      expect(c.automatic).toBe(true);
      expect(calls).toEqual(["/api/plan"]);
      // The map is the draft as the user accepted it: the same futures, the same choices on each, every number unknown.
      expect(r.branches.slice(1).map((b) => b.name)).toEqual(proposal.branches.map((b) => b.name));
      proposal.branches.forEach((pb, i) => {
        const b = r.branches[i + 1]!;
        for (const st of pb.settings) {
          const v = proposal.variables.find((x) => x.key === st.variable)!;
          expect(b.values[st.variable], `${q}: ${pb.name}`).toEqual(v.kind === "boolean" ? st.value === "yes" : st.value);
        }
      });
      for (const b of r.branches) for (const v of r.variables.filter((x) => x.kind === "number")) expect(b.values[v.key] ?? null).toBeNull();
      // Every path's picture is illustrative, and no number the map does not hold appears in it (nobody is drawn at work).
      for (const b of r.branches) {
        const p = pathScenery(r, b, c);
        expect(p.reasons[0]).toContain("nothing in the picture is a fact about this future");
        expect(p.people).toBe(0);
        expect(p.place).toBeNull();
      }
    }
  });

  it("a path's own choice can name its setting or add a detail; nothing else does", async () => {
    const game = await accept(GAMING);
    const g = resolveScenery(game.r);
    const themes = Object.fromEntries(game.r.branches.map((b) => [b.name, pathScenery(game.r, b, g).theme]));
    expect(themes).toEqual({ "As things are": "studio", "Self-funded indie studio": "studio", "Publisher-backed team": "office", "Keep my job, make games at night": "studio" });
    const office = pathScenery(game.r, game.r.branches.find((b) => b.name === "Publisher-backed team")!, g);
    expect(office.reasons).toContain("Drawn as a small business, because “Where the work happens” is “Co-working office” on this path.");

    const flood = await accept(WETLANDS);
    const w = resolveScenery(flood.r);
    const props = Object.fromEntries(flood.r.branches.map((b) => [b.name, pathScenery(flood.r, b, w).props]));
    expect(props).toEqual({ "As things are": [], "Restore the wetlands": ["wetland"], "Build higher flood walls": ["levee"], "Wetlands first, walls later": ["levee", "wetland"] });

    // A number the user enters later is the path's own figure: a team of three is drawn as three people at work.
    const b = game.r.branches.find((x) => x.name === "Self-funded indie studio")!;
    await game.s.answer(b.id, "teamSize", 3);
    const after = pathScenery(game.s.active()!, game.s.active()!.branches.find((x) => x.id === b.id)!, resolveScenery(game.s.active()!));
    expect(after.people).toBe(3);
    expect(after.reasons).toContain("Three people at work, because “Team size” is 3 on this path.");
  });

  it("choosing other scenery changes only the picture: the saved map is byte for byte the same", async () => {
    const { s, r } = await accept(FUTURE_SELF);
    const before = JSON.stringify(s.active());
    const chosen = resolveScenery(r, { family: "energy", theme: "woodland" });
    expect([chosen.family, chosen.theme, chosen.automatic]).toEqual(["energy", "woodland", false]);
    for (const b of r.branches) expect(pathScenery(r, b, chosen).props).toEqual([]);
    expect(JSON.stringify(s.active())).toBe(before);
  });
});
