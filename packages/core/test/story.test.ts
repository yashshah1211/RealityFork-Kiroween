import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { proposalToReality, selectAll, type Proposal } from "../src/reality/proposal";
import { evaluateBranch, exportRealities, forkBranch, importRealities, updateBranch } from "../src/reality/reality";
import { branchStory, compareStory, countName, forkChoices, forkIdeas } from "../src/reality/story";
import { buildFromTemplate, CAFE_QUEUE, SOLAR } from "../src/reality/examples";

let n = 0;
const ids = () => `s${++n}`;
const restaurant = (): Proposal => JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/restaurant-proposal.json", import.meta.url)), "utf8"));
const build = async () => {
  const p = restaurant();
  return proposalToReality("What if I started my own restaurant?", p, selectAll(p), { model: "m", createdAt: "2026-11-07T00:00:00Z" }, ids);
};

describe("branch story", () => {
  it("groups what changed, upsides, challenges and unknowns; unknowns that unlock a calculation come first", async () => {
    const r = await build();
    const cafe = r.branches[1]!;
    const s = branchStory(r, cafe);
    expect(s.isStart).toBe(false);
    expect(s.changes.map((c) => [c.label, c.to])).toEqual([["Type of place", "café"], ["Hire staff", false]]);
    expect(s.upsides.map((p) => p.text)).toEqual(["Full control over the menu and atmosphere"]);
    expect(s.challenges.map((p) => p.text)).toEqual(["Long hours leave little time for family"]);
    expect(s.unsorted.map((p) => p.text)).toEqual(["Local competition changes"]);
    expect(s.unknowns.map((u) => [u.variable.key, u.unlocks])).toEqual([
      ["monthlyRevenue", ["Profit per month", "Months to earn back the start-up cost"]],
      ["monthlyCosts", ["Profit per month", "Months to earn back the start-up cost"]],
      ["startupCost", ["Months to earn back the start-up cost"]],
      ["hoursPerWeek", []],
    ]);
    expect(s.calculated).toEqual([]);
    expect(s.blocked.map((x) => x.formula.key)).toEqual(["profitPerMonth", "monthsToEarnBackTheStartUpCost"]);
    expect(branchStory(r, r.branches[0]!).isStart).toBe(true);
  });

  it("only reports a calculated value once the user's numbers make it computable", async () => {
    let r = await build();
    const cafe = r.branches[1]!;
    r = await updateBranch(r, cafe.id, { values: { monthlyRevenue: 9000, monthlyCosts: 9500 } });
    const s = branchStory(r, r.branches[1]!);
    expect(s.calculated.map((x) => [x.formula.key, x.value])).toEqual([["profitPerMonth", -500]]);
    expect(s.blocked.map((x) => [x.formula.key, x.missing])).toEqual([["monthsToEarnBackTheStartUpCost", ["Start-up cost"]]]);
    expect(s.unknowns.map((u) => u.variable.key)).toEqual(["startupCost", "hoursPerWeek"]);
    expect(evaluateBranch(r, r.branches[1]!).calculated[0]!.result).toEqual({ status: "ok", value: -500 });
    // With every input known, payback still needs a monthly profit: "not applicable", never a made-up number.
    r = await updateBranch(r, cafe.id, { values: { startupCost: 40000 } });
    const s2 = branchStory(r, r.branches[1]!);
    expect(s2.notApplicable.map((x) => x.formula.key)).toEqual(["monthsToEarnBackTheStartUpCost"]);
    expect(s2.blocked).toEqual([]);
  });
});

describe("fork choices", () => {
  it("offers the other values of choices and yes/no decisions, this reality's own decisions first", async () => {
    const r = await build();
    const c = forkChoices(r, r.branches[1]!);
    expect(c.map((x) => [x.variable.key, x.value, x.changesOwnDecision])).toEqual([
      ["format", "full restaurant", true],
      ["hireStaff", true, true],
    ]);
    // In the starting reality nothing is decided yet, so every value is a possible new path.
    expect(forkChoices(r, r.branches[0]!).map((x) => x.value)).toEqual(["café", "full restaurant", true, false]);
  });
});

describe("compare story", () => {
  it("leads with differences and sorted possibilities; numbers only when both sides are calculated", async () => {
    let r = await build();
    const [, cafe, full] = r.branches;
    let cmp = compareStory(r, cafe!.id, full!.id);
    expect(cmp.differences.map((d) => [d.variable.key, d.a, d.b])).toEqual([["format", "café", "full restaurant"], ["hireStaff", false, true]]);
    expect(cmp.upsides.onlyA.map((p) => p.text)).toEqual(["Full control over the menu and atmosphere"]);
    expect(cmp.challenges.onlyB.map((p) => p.text)).toEqual(["Managing people becomes a large part of the job"]);
    expect(cmp.unsorted.both.map((p) => p.text)).toEqual(["Local competition changes"]);
    expect(cmp.calculated).toEqual([]);
    expect(cmp.missingForCalculation).toEqual(["Sales per month", "Running costs per month", "Start-up cost"]);
    expect(cmp.unknownInBoth.map((v) => v.key)).toEqual(["monthlyRevenue", "monthlyCosts", "startupCost", "hoursPerWeek"]);
    r = await updateBranch(r, cafe!.id, { values: { monthlyRevenue: 9000, monthlyCosts: 7500 } });
    r = await updateBranch(r, full!.id, { values: { monthlyRevenue: 20000, monthlyCosts: 17000 } });
    cmp = compareStory(r, cafe!.id, full!.id);
    expect(cmp.calculated.map((x) => [x.formula.key, x.a, x.b, x.difference])).toEqual([["profitPerMonth", 1500, 3000, 1500]]);
    expect(cmp.differences.map((d) => d.variable.key)).toEqual(["format", "hireStaff", "monthlyRevenue", "monthlyCosts"]);
  });
});

describe("compatibility with files saved before tones and origins existed (6e4b8f2)", () => {
  const old = readFileSync(fileURLToPath(new URL("./fixtures/realities-6e4b8f2.json", import.meta.url)), "utf8");

  it("imports unchanged: every stored fingerprint still matches", async () => {
    const realities = await importRealities(old);
    const stored = JSON.parse(old).realities.flatMap((r: { branches: { fingerprint: string }[] }) => r.branches.map((b) => b.fingerprint));
    expect(realities.flatMap((r) => r.branches.map((b) => b.fingerprint))).toEqual(stored);
    expect(realities.every((r) => r.origin === undefined)).toBe(true);
    expect(exportRealities(realities)).toBe(old);
  });

  it("old possibilities show as unsorted; new branches can add tones", async () => {
    const [, dog] = await importRealities(old);
    const large = dog!.branches[1]!;
    expect(branchStory(dog!, large).unsorted.map((p) => p.text)).toEqual(["Needs a bigger car"]);
    const f = await forkBranch(dog!, large.id, { name: "Large dog, walker" }, ids);
    const r = await updateBranch(f.reality, f.branch.id, { possibilities: [...f.branch.possibilities, { id: "t1", text: "More time outdoors", likelihood: "not-judged", note: "", tone: "upside" }] });
    expect(branchStory(r, r.branches[2]!).upsides.map((p) => p.text)).toEqual(["More time outdoors"]);
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
    await expect(updateBranch(r, r.branches[2]!.id, { possibilities: [{ id: "t2", text: "x", likelihood: "not-judged", note: "", tone: "sure" as never }] })).rejects.toThrow(/unknown tone/);
  });
});

describe("ideas for another path (counts the map already varies)", () => {
  it("café: one more barista than any path so far, from either path; never zero, never a path that already exists", async () => {
    const r = await buildFromTemplate(CAFE_QUEUE, ids);
    const [one, two] = [r.branches[0]!, r.branches[1]!];
    // Baristas are 1 and 2 on the map: the idea is 3. Nothing below 1 is offered (0 baristas is not suggested).
    expect(forkIdeas(r, one).map((x) => [x.variable.key, x.value, x.direction])).toEqual([["baristas", 3, "up"]]);
    // Named for what the new path has, not after the path it starts from ("One barista · Baristas on duty: 3 people").
    expect(forkIdeas(r, one).map((x) => x.name)).toEqual(["Three baristas"]);
    expect(forkIdeas(r, two).map((x) => [x.variable.key, x.value, x.direction])).toEqual([["baristas", 3, "up"]]);
    // Customers per hour, wages and service speed are the same on every path: not a choice this map varies.
    expect(forkIdeas(r, one).some((x) => x.variable.key !== "baristas")).toBe(false);
    // Once a path from here has 3, the next idea from here is 4; the map itself is never changed by asking.
    const f = await forkBranch(r, one.id, { name: "Three" }, ids);
    const r3 = await updateBranch(f.reality, f.branch.id, { values: { baristas: 3 }, sources: { baristas: "user" } });
    expect(forkIdeas(r3, r3.branches[0]!).map((x) => [x.value, x.name])).toEqual([[4, "Four baristas"]]);
    expect(r3.branches).toHaveLength(3);
  });
  it("a map whose numbers differ by more than one (solar sizes, prices) gets no number ideas", async () => {
    const r = await buildFromTemplate(SOLAR, ids);
    for (const b of r.branches) expect(forkIdeas(r, b)).toEqual([]);
  });
});

describe("names for a count", () => {
  const v = (label: string, unit = "") => ({ key: "k", label, kind: "number" as const, unit, options: [], source: "", uncertainty: "" });
  it("names the counted thing with the number in words, singular for one", () => {
    expect(countName(v("Baristas on duty", "people"), 3)).toBe("Three baristas");
    expect(countName(v("Baristas on duty", "people"), 1)).toBe("One barista");
    expect(countName(v("Rooms"), 1)).toBe("One room");
    expect(countName(v("Number of delivery vans"), 2)).toBe("Two delivery vans");
    expect(countName(v("Days per week at the office", "days"), 4)).toBe("Four days per week");
    expect(countName(v("Staff", "people"), 14)).toBe("14 staff");
  });
  it("keeps the label's own words when it does not name a counted thing", () => {
    expect(countName(v("Team size", "people"), 3)).toBe("Team size: 3 people");
    expect(countName(v("Months until the first release", "months"), 2)).toBe("Months until the first release: 2 months");
  });
});
