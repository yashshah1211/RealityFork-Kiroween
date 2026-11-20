/**
 * Adaptive scenery: which universe a map is drawn in, decided from the map's own words, deterministically, with the
 * words that decided it. Built with the real RealityStore and the built-in examples; custom questions are blank maps
 * created through the store (no AI, no network).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { proposalToReality, selectAll, validateProposal, type Reality } from "@realityfork/core";
import { directEngine } from "../../engine";
import type { StorageLike } from "../../state/workspace";
import { RealityStore, type ApiFetcher } from "../../reality/store";
import { pathScenery, resolveScenery } from "./resolve";

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
async function question(q: string): Promise<Reality> {
  const s = make();
  await s.create(q);
  return s.active()!;
}

describe("the universe of a map", () => {
  it("built-in examples: moving city, solar and café each get their own family", async () => {
    const s = make();
    await s.loadExample("move-city");
    const city = resolveScenery(s.active()!);
    expect(city.family).toBe("urban");
    expect(city.why).toBe("City at night: your question mentions “moved from”, “Mumbai” and “London”.");
    await s.loadExample("solar");
    expect(resolveScenery(s.active()!).family).toBe("energy");
    await s.loadExample("cafe-queue");
    const cafe = resolveScenery(s.active()!);
    expect(cafe.family).toBe("business");
    expect(cafe.theme).toBe("cafe");
  });

  it("custom questions use the same rules, with no example ids anywhere", async () => {
    const cases: [string, string, string][] = [
      ["What if I moved to another country?", "urban", "city"],
      ["What if I installed solar panels?", "energy", "home"],
      ["What if our village put up two wind turbines?", "energy", "wind"],
      ["What if our city changed its flood policy?", "energy", "water"],
      ["What if we planted a forest on the hill behind the school?", "energy", "woodland"],
      ["What if our farm went organic?", "energy", "farm"],
      ["What if I opened a café?", "business", "cafe"],
      ["What if I opened a bookshop in my town?", "business", "shop"],
      ["What if I started my own independent gaming company?", "business", "studio"],
      ["What if I turned my garage into a furniture workshop?", "business", "workshop"],
      ["What if I started a small consultancy?", "business", "office"],
      ["What if I started a business?", "business", "office"],
    ];
    for (const [q, family, theme] of cases) {
      const c = resolveScenery(await question(q));
      expect(c.family, q).toBe(family);
      expect(c.theme, q).toBe(theme);
      expect(c.automatic).toBe(true);
      expect(c.evidence.length, q).toBeGreaterThan(0);
    }
  });

  it("anything unclear, about ideas or policy, or split between families is the abstract universe", async () => {
    const symbolic: [string, string][] = [
      ["What if I learned to play the cello?", "sky"],
      ["What if Rome never fell?", "ruins"],
      ["What if humans could photosynthesize?", "observatory"],
      ["What if the council voted on a new parking policy?", "forum"],
      ["What if I said yes?", "sky"],
    ];
    for (const [q, theme] of symbolic) {
      const c = resolveScenery(await question(q));
      expect(c.family, q).toBe("neutral");
      expect(c.theme, q).toBe(theme);
    }
    expect(resolveScenery(await question("What if Rome never fell?")).why).toBe("Open sky, old ruins: the question is about “never fell”, so the scenery stays symbolic and shows no particular place.");
    const policy = resolveScenery(await question("What if the government passed a law on remote work?"));
    expect(policy.family).toBe("neutral");
    expect(policy.why).toContain("symbolic");
    // A café and a city in the same breath, with nothing else to go on: not a confident call.
    const close = resolveScenery(await question("What if I bought a café in the city centre?"));
    expect(close.family).toBe("neutral");
    expect(close.why).toContain("point both to");
    // ...while opening one somewhere is about the business, wherever it is.
    expect(resolveScenery(await question("What if I opened a bakery in Lisbon?")).family).toBe("business");
  });

  it("is deterministic and explains itself with the user's own words", async () => {
    const r = await question("What if I relocated to Zürich for a new job?");
    const a = resolveScenery(r);
    const b = resolveScenery(r);
    expect(a).toEqual(b);
    expect(a.family).toBe("urban");
    expect(a.why).toContain("“relocated”");
    expect(a.why).toContain("“Zürich”");
  });

  it("does not read the AI's possibilities: only the question and what the map records", async () => {
    const s = make();
    await s.create("What if I learned to play the cello?");
    const root = s.active()!.branches[0]!;
    await s.updateBranch(root.id, { possibilities: [{ id: "p1", text: "Solar panels and a heat pump could cut costs", likelihood: "not-judged", note: "", source: "user" }] });
    expect(resolveScenery(s.active()!).family).toBe("neutral");
  });

  it("an override changes only the picture: the map and its fingerprints stay the same", async () => {
    const s = make();
    await s.loadExample("solar");
    const before = JSON.stringify(s.active());
    const c = resolveScenery(s.active()!, "urban");
    expect(c.family).toBe("urban");
    expect(c.automatic).toBe(false);
    expect(c.why).toContain("you chose this scenery");
    expect(JSON.stringify(s.active())).toBe(before);
    // Choosing the automatic family explicitly is the same as automatic.
    expect(resolveScenery(s.active()!, "energy").family).toBe("energy");
    // A setting within a family is a choice too, and changes nothing in the map either.
    const studio = resolveScenery(s.active()!, { family: "business", theme: "workshop" });
    expect([studio.family, studio.theme, studio.automatic]).toEqual(["business", "workshop", false]);
    expect(studio.why).toContain("Shops and studios, a workshop: you chose this scenery");
    expect(studio.why).toContain("Chosen automatically, it would be energy and environment, a home and its energy.");
    expect(JSON.stringify(s.active())).toBe(before);
  });
});

describe("what one path shows", () => {
  it("solar: panels where the map is about solar and the system is there; a battery only where it is yes", async () => {
    const s = make();
    await s.loadExample("solar");
    const r = s.active()!;
    const choice = resolveScenery(r);
    const start = pathScenery(r, r.branches[0]!, choice);
    expect(start.props).toEqual(["solar"]);
    expect(start.reasons.join(" ")).toContain("“System size” is 4 kW on this path");
    const battery = pathScenery(r, byName(r, "Add a battery"), choice);
    expect(battery.props).toEqual(["solar", "battery"]);
    expect(battery.reasons.join(" ")).toContain("“Battery included” is yes on this path");
    expect(pathScenery(r, byName(r, "Shaded roof, no export payments"), choice).props).toEqual(["solar"]);
    // A path the user sets to a 0 kW system shows no panels.
    await s.exploreChange(r.branches[0]!.id, { key: "systemKw", value: 0 });
    const none = pathScenery(s.active()!, s.selected()!, resolveScenery(s.active()!));
    expect(none.props).toEqual([]);
    expect(none.reasons.join(" ")).toContain("No solar panels");
  });

  it("moving city: London only where the map says so; a described change is a marked what-if with no place", async () => {
    const s = make();
    await s.loadExample("move-city");
    const r = s.active()!;
    const choice = resolveScenery(r);
    expect(pathScenery(r, byName(r, "Stay in Mumbai"), choice).place).toBeNull();
    expect(pathScenery(r, byName(r, "Move to London"), choice).place).toBe("london");
    await s.exploreChange(byName(r, "Move to London").id, { text: "Share a flat in Zone 2 with a friend" });
    const what = pathScenery(s.active()!, s.selected()!, resolveScenery(s.active()!));
    expect(what.hypothetical).toBe(true);
    expect(what.place).toBeNull();
    expect(what.family).toBe("urban");
    expect(what.reasons.join(" ")).toContain("does not interpret");
  });

  it("café: people at the counter only as the path records them, never for a figure the picture cannot show", async () => {
    const s = make();
    await s.loadExample("cafe-queue");
    const r = s.active()!;
    const choice = resolveScenery(r);
    const one = pathScenery(r, byName(r, "One barista"), choice);
    const two = pathScenery(r, byName(r, "Two baristas"), choice);
    expect([one.theme, one.people, two.people]).toEqual(["cafe", 1, 2]);
    expect(two.reasons).toContain("Two people at the counter, because “Baristas on duty” is 2 on this path.");
    await s.exploreChange(byName(r, "Two baristas").id, { key: "baristas", value: 12 });
    const many = pathScenery(s.active()!, s.selected()!, resolveScenery(s.active()!));
    expect(many.people).toBe(0);
    expect(many.reasons.join(" ")).toContain("Nobody is drawn at work: “Baristas on duty” is 12 on this path");
  });

  it("an AI-drafted solar map: panels where a path is named for them, none assumed for the start or for “No solar”", async () => {
    const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../../../e2e/fixtures/domain-proposals.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    const check = validateProposal(fx["What if my household installed solar panels?"]);
    if (!check.ok) throw new Error(check.errors.join("; "));
    let n = 0;
    const r = await proposalToReality("What if my household installed solar panels?", check.proposal, selectAll(check.proposal), { model: "fixture", createdAt: "2026-10-31T00:00:00.000Z" }, () => `id${n++}`);
    const choice = resolveScenery(r);
    expect([choice.family, choice.theme]).toEqual(["energy", "home"]);
    const at = (name: string) => pathScenery(r, byName(r, name), choice);
    expect(at("As things are").props).toEqual([]);
    expect(at("As things are").reasons).toContain("No solar panels shown: nothing recorded for this path says it has one.");
    expect(at("Panels only").props).toEqual(["solar"]);
    expect(at("Panels only").reasons).toContain("Solar panels, because the path is called “Panels only”.");
    expect(at("Panels and battery").props).toEqual(["solar", "battery"]);
    expect(at("Panels and battery").reasons).toContain("A battery, because “Battery included” is yes on this path.");
    expect(at("No solar").props).toEqual([]);
    expect(at("No solar").reasons).toContain("No solar panels: the path is called “No solar”.");
  });

  it("the words of a described change are never read for details, even when they name one", async () => {
    const s = make();
    await s.create("What if I installed solar panels?");
    await s.exploreChange(s.active()!.branches[0]!.id, { text: "Put solar panels on the garage roof" });
    const p = pathScenery(s.active()!, s.selected()!, resolveScenery(s.active()!));
    expect(p.hypothetical).toBe(true);
    expect(p.props).toEqual([]);
    expect(p.reasons.join(" ")).toContain("does not interpret");
  });

  it("every reason says the scenery is illustrative unless it is the detailed place the map names", async () => {
    const s = make();
    await s.loadExample("cafe-queue");
    const r = s.active()!;
    for (const b of r.branches) expect(pathScenery(r, b, resolveScenery(r)).reasons[0]).toContain("nothing in the picture is a fact about this future");
  });
});
