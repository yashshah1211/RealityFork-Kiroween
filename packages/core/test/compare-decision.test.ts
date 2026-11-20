/**
 * Compare as a decision view (product sprint; the staffing trade-off of computeTradeoff is tested in tradeoff.test.ts):
 * the trade-off between two paths, and what would let their calculated
 * outcomes be compared. Both are built only from what the paths already hold: the trade-off regroups their own
 * possibilities (nothing is added, reworded, weighed or scored) and the figures to settle are exactly the inputs the
 * evaluation reports missing. Exercised on unrelated decisions: three recorded LIVE model drafts (moving abroad, a café,
 * self-study) and the restaurant fixture.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { proposalToReality, selectAll, type Proposal } from "../src/reality/proposal";
import { forkBranch, updateBranch, type Reality } from "../src/reality/reality";
import { compareStory, type TradeItem } from "../src/reality/story";

const fixtures = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../web/e2e/fixtures/${file}`, import.meta.url)), "utf8"));
const live = fixtures("sprint-live-drafts.json") as Record<string, { question: string; proposal: Proposal }>;
const restaurant = fixtures("restaurant-proposal.json") as Proposal;
const META = { model: "mock", createdAt: "2026-11-13T00:00:00Z" };
let n = 0;
const ids = () => `t${++n}`;
const build = (q: string, p: Proposal) => proposalToReality(q, p, selectAll(p), META, ids);
const path = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;
const texts = (items: readonly TradeItem[]) => items.map((i) => i.possibility.text);

describe("the trade-off between two paths", () => {
  it("café (recorded live draft): each choice gets its own upsides and the other path's difficulties, and the shared one favours neither", async () => {
    const { question, proposal } = live.cafe!;
    const r = await build(question, proposal);
    const t = compareStory(r, path(r, "Open Café").id, path(r, "Stay at Job").id).tradeOff;
    expect(texts(t.forA)).toEqual([
      "You could earn more than your current salary if the café becomes popular.",
      "You may miss out on a potentially rewarding entrepreneurial experience.",
    ]);
    expect(t.forA.map((i) => [i.reason, i.from])).toEqual([["upside", "a"], ["challenge", "b"]]);
    expect(texts(t.forB)).toEqual([
      "Your income remains stable and you avoid the risks of starting a business.",
      "Initial costs and the need for a food‑service license may strain cash flow.",
    ]);
    expect(t.forB.map((i) => [i.reason, i.from])).toEqual([["upside", "b"], ["challenge", "a"]]);
    expect(t.eitherWay.map((i) => [i.possibility.text, i.reason, i.from])).toEqual([["The success of the café will depend heavily on location and local demand.", "uncertain", "both"]]);
    // Each path's own possibilities, not counting the one both share.
    expect([t.ownA, t.ownB]).toEqual([2, 2]);
  });

  it("self-study (recorded live draft): the path the user asked about has no possibilities of its own; that is counted, and what favours it comes only from the other path", async () => {
    const { question, proposal } = live.selfStudy!;
    const r = await build(question, proposal);
    const self = r.branches.find((b) => b.name.startsWith("Self"))!;
    const t = compareStory(r, self.id, path(r, "University").id).tradeOff;
    // Its only possibility is the one every path shares, so nothing is its own.
    expect(self.possibilities.filter((p) => !p.setAside)).toHaveLength(1);
    expect(t.ownA).toBe(0);
    expect(texts(t.forA)).toEqual(["High tuition and fixed schedules may limit flexibility and increase financial pressure."]);
    expect(t.forA[0]).toMatchObject({ reason: "challenge", from: "b" });
    expect(texts(t.forB)).toEqual(["A recognized degree can open doors in fields that require accredited qualifications."]);
    expect(t.eitherWay).toHaveLength(1);
  });

  it("moving abroad (recorded live draft): a future with nothing noted has ownB 0, and the other path's difficulty still speaks for it", async () => {
    const { question, proposal } = live.abroad!;
    const r = await build(question, proposal);
    const t = compareStory(r, path(r, "Stay where you are").id, path(r, "Move and work remotely").id).tradeOff;
    expect(t.ownB).toBe(0);
    expect(texts(t.forB)).toEqual(["Local job market may limit the speed or level of career advancement you hope for."]);
    expect(texts(t.forA)).toEqual(["You keep your existing network and avoid the hassle of immigration."]);
  });

  it("a path copied from another lists the same possibilities: nothing favours either choice, everything is 'either way'", async () => {
    const r0 = await build("What if I opened a restaurant?", restaurant);
    const cafe = r0.branches.find((b) => b.name.startsWith("Small café"))!;
    const { reality: r, branch: copy } = await forkBranch(r0, cafe.id, { name: "Café, copy" }, ids);
    const t = compareStory(r, cafe.id, copy.id).tradeOff;
    expect(t.forA).toEqual([]);
    expect(t.forB).toEqual([]);
    expect([t.ownA, t.ownB]).toEqual([0, 0]);
    expect(t.eitherWay.map((i) => i.from)).toEqual(cafe.possibilities.filter((p) => !p.setAside).map(() => "both"));
  });

  it("property: for any two paths of any of these drafts, every possibility of either path appears exactly once, unchanged, and no other text appears", async () => {
    const realities = await Promise.all([
      build(live.cafe!.question, live.cafe!.proposal),
      build(live.selfStudy!.question, live.selfStudy!.proposal),
      build(live.abroad!.question, live.abroad!.proposal),
      build("What if I opened a restaurant?", restaurant),
    ]);
    const pairs = realities.flatMap((r) => r.branches.flatMap((a) => r.branches.filter((b) => b.id !== a.id).map((b) => [r, a, b] as const)));
    fc.assert(
      fc.property(fc.constantFrom(...pairs), ([r, a, b]) => {
        const t = compareStory(r, a.id, b.id).tradeOff;
        const all = [...t.forA, ...t.forB, ...t.eitherWay];
        const key = (s: string) => s.trim().toLowerCase();
        const own = [...a.possibilities, ...b.possibilities].filter((p) => !p.setAside);
        // Each distinct text once (a possibility listed on both paths is one point, not two).
        expect(new Set(all.map((i) => key(i.possibility.text))).size).toBe(all.length);
        expect(new Set(all.map((i) => key(i.possibility.text)))).toEqual(new Set(own.map((p) => key(p.text))));
        // The very same objects as on the paths: nothing reworded or invented.
        for (const i of all) expect(own).toContain(i.possibility);
        // An upside favours the path it is written for; a difficulty favours the other one.
        for (const i of t.forA) expect(i.reason === "upside" ? i.from : i.from === "b" ? "a" : "?").toBe("a");
        for (const i of t.forB) expect(i.reason === "upside" ? i.from : i.from === "a" ? "b" : "?").toBe("b");
      }),
      { numRuns: Math.min(200, pairs.length * 4) },
    );
  });
});

describe("what would let the calculated outcomes be compared", () => {
  it("café (recorded live draft): the four inputs the two outcomes need, per path, and nothing they do not need", async () => {
    const { question, proposal } = live.cafe!;
    const r = await build(question, proposal);
    const a = path(r, "Open Café");
    const b = path(r, "Stay at Job");
    const c = compareStory(r, a.id, b.id);
    expect(c.toSettle.map((s) => [s.variable.key, s.missingA, s.missingB, s.outcomes])).toEqual([
      ["cafeRevenue", true, true, ["Net café profit per month"]],
      ["cafeCosts", true, true, ["Net café profit per month"]],
      ["hoursPerWeekJob", true, true, ["Total weekly time commitment"]],
      ["hoursPerWeekCafe", true, true, ["Total weekly time commitment"]],
    ]);
    // The salary is unknown but no outcome needs it, so it is not asked for here.
    expect(c.toSettle.some((s) => s.variable.key === "jobSalary")).toBe(false);
  });

  it("once the user gives a figure on one path it is no longer asked there, and when both paths have them the outcome is compared", async () => {
    const { question, proposal } = live.cafe!;
    let r = await build(question, proposal);
    const a = path(r, "Open Café").id;
    const b = path(r, "Stay at Job").id;
    r = await updateBranch(r, a, { values: { cafeRevenue: 18000 }, sources: { cafeRevenue: "user" } });
    const half = compareStory(r, a, b);
    expect(half.toSettle.find((s) => s.variable.key === "cafeRevenue")).toMatchObject({ missingA: false, missingB: true });
    r = await updateBranch(r, a, { values: { cafeCosts: 11000 }, sources: { cafeCosts: "user" } });
    r = await updateBranch(r, b, { values: { cafeRevenue: 0, cafeCosts: 0 }, sources: { cafeRevenue: "user", cafeCosts: "user" } });
    const done = compareStory(r, a, b);
    expect(done.calculated.map((x) => [x.formula.label, x.a, x.b, x.difference])).toEqual([["Net café profit per month", 7000, 0, -7000]]);
    expect(done.toSettle.map((s) => s.variable.key)).toEqual(["hoursPerWeekJob", "hoursPerWeekCafe"]);
  });

  it("restaurant: an input already known on one side is asked only on the other; a draft without formulas asks for nothing", async () => {
    let r = await build("What if I opened a restaurant?", restaurant);
    const cafe = r.branches.find((x) => x.name.startsWith("Small café"))!.id;
    const full = path(r, "Full restaurant with staff").id;
    r = await updateBranch(r, cafe, { values: { monthlyRevenue: 12000, monthlyCosts: 10500 }, sources: { monthlyRevenue: "user", monthlyCosts: "user" } });
    const c = compareStory(r, cafe, full);
    for (const s of c.toSettle) expect(s.missingA, s.variable.key).toBe(s.variable.key === "startupCost");
    expect(c.toSettle.find((s) => s.variable.key === "monthlyRevenue")).toMatchObject({ missingA: false, missingB: true });
    const abroad = await build(live.abroad!.question, live.abroad!.proposal);
    expect(abroad.formulas).toEqual([]);
    expect(compareStory(abroad, abroad.branches[1]!.id, abroad.branches[2]!.id).toSettle).toEqual([]);
  });
});
