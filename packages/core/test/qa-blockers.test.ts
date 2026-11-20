/**
 * QA release blockers (independent browser test of the hosted app), at the level of the core:
 *  1. A path can say an assumption does not apply to it: not zero, not unknown. It is not asked for there, every
 *     calculation that uses it does not apply there, and Compare says so instead of setting 0 against a number.
 *     A compared number says what it is made of and which figures it leaves out; a side made only of zeros is said.
 *  2. (form-level; see web) one question-length limit everywhere.
 *  3. The trade-off's summary is one reading of its own lists, so it cannot contradict the possibilities shown.
 * Drafts: the recorded LIVE café draft (sprint-live-drafts.json), the built-in solar and moving examples, the restaurant
 * fixture. No network.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { buildFromTemplate, MOVE_CITY, SOLAR } from "../src/reality/examples";
import { MAX_QUESTION_LENGTH, proposalToReality, selectAll, type Proposal } from "../src/reality/proposal";
import { branchFingerprint, evaluateFormula, exportRealities, forkBranch, importRealities, MAX_STATED_TEXT, updateBranch, type Reality } from "../src/reality/reality";
import { revisitRequest, checkRevisitRequest } from "../src/reality/revisit";
import { branchStory, compareStory } from "../src/reality/story";

const fixtures = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../web/e2e/fixtures/${file}`, import.meta.url)), "utf8"));
const cafe = fixtures("sprint-live-drafts.json").cafe as { question: string; proposal: Proposal };
const restaurant = fixtures("restaurant-proposal.json") as Proposal;
let n = 0;
const ids = () => `qa${++n}`;
const META = { model: "mock", createdAt: "2026-11-13T00:00:00Z" };
const named = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;
const cafeMap = () => proposalToReality(cafe.question, cafe.proposal, selectAll(cafe.proposal), META, ids);

describe("1. what does not apply to a path is neither zero nor unknown", () => {
  it("reproduced: on the job path Compare asks for the café's figures, and zeros make 7,000 against 0 look like a result", async () => {
    let r = await cafeMap();
    const open = named(r, "Open Café").id;
    const stay = named(r, "Stay at Job").id;
    expect(compareStory(r, open, stay).toSettle.filter((s) => s.missingB).map((s) => s.variable.key)).toEqual(["cafeRevenue", "cafeCosts", "hoursPerWeekJob", "hoursPerWeekCafe"]);
    r = await updateBranch(r, open, { values: { cafeRevenue: 18000, cafeCosts: 11000 }, sources: { cafeRevenue: "user", cafeCosts: "user" } });
    r = await updateBranch(r, stay, { values: { cafeRevenue: 0, cafeCosts: 0, jobSalary: 80000 }, sources: { cafeRevenue: "user", cafeCosts: "user", jobSalary: "user" } });
    const c = compareStory(r, open, stay);
    expect(c.calculated.map((x) => [x.formula.label, x.a, x.b])).toEqual([["Net café profit per month", 7000, 0]]);
    // Now said beside it: made only of revenue and costs, every input is 0 on the job path, and the salary is left out.
    const note = c.notes[0]!;
    expect(note.uses.map((v) => v.key)).toEqual(["cafeRevenue", "cafeCosts"]);
    expect(note.allZero).toBe("b");
    expect(note.leftOut.map((x) => [x.variable.key, x.a, x.b])).toEqual([["jobSalary", null, 80000]]);
  });

  it("marking the café's revenue as not applying on the job path: the profit does not apply there, is not compared, and nothing more is asked for it", async () => {
    let r = await cafeMap();
    const open = named(r, "Open Café").id;
    const stay = named(r, "Stay at Job").id;
    r = await updateBranch(r, stay, { notApplicable: ["cafeRevenue"] });
    const job = r.branches.find((b) => b.id === stay)!;
    expect(job.notApplicable).toEqual(["cafeRevenue"]);
    expect(job.values.cafeRevenue).toBeNull();
    const profit = r.formulas.find((f) => f.label === "Net café profit per month")!;
    expect(evaluateFormula(r, job, profit.key)).toEqual({ status: "not-applicable", reason: "Café monthly revenue does not apply to this path" });
    // Not asked on that path any more; the other café figure is no longer needed for anything there.
    const story = branchStory(r, job);
    expect(story.unknowns.map((u) => u.variable.key)).not.toContain("cafeRevenue");
    expect(story.unknowns.find((u) => u.variable.key === "cafeCosts")?.unlocks).toEqual([]);
    expect(story.known.notApplicable.map((v) => v.key)).toEqual(["cafeRevenue"]);
    const c = compareStory(r, open, stay);
    expect(c.notApplicableIn.map((x) => [x.formula.label, x.side])).toEqual([["Net café profit per month", "b"]]);
    expect(c.waiting.map((f) => f.label)).toEqual(["Total weekly time commitment"]);
    // Compare asks only for what the remaining outcome needs, and never for the café on the job path.
    expect(c.toSettle.filter((s) => s.missingB).map((s) => s.variable.key)).toEqual(["hoursPerWeekJob", "hoursPerWeekCafe"]);
    expect(c.missingForCalculation).not.toContain("Café monthly revenue");
    expect(c.differences.map((d) => d.variable.key)).toContain("cafeRevenue");
    expect(c.notApplicable.b).toEqual(["cafeRevenue"]);
    expect(c.unknownInBoth.map((v) => v.key)).not.toContain("cafeRevenue");
  });

  it("an answer means it applies again; undoing the mark makes it unknown, not zero", async () => {
    let r = await cafeMap();
    const stay = named(r, "Stay at Job").id;
    r = await updateBranch(r, stay, { notApplicable: ["cafeRevenue", "cafeCosts"] });
    r = await updateBranch(r, stay, { values: { cafeRevenue: 500 }, sources: { cafeRevenue: "user" } });
    expect(r.branches.find((b) => b.id === stay)!.notApplicable).toEqual(["cafeCosts"]);
    r = await updateBranch(r, stay, { notApplicable: [] });
    const job = r.branches.find((b) => b.id === stay)!;
    expect(job.notApplicable).toBeUndefined();
    expect(job.values.cafeCosts).toBeNull();
  });

  it("files without the mark keep their fingerprints; with it, it is hashed, survives export and import, and a malformed one is refused", async () => {
    const r0 = await cafeMap();
    const stay = named(r0, "Stay at Job");
    const { fingerprint, ...rest } = stay;
    expect(await branchFingerprint(r0, rest)).toBe(fingerprint);
    const r = await updateBranch(r0, stay.id, { notApplicable: ["cafeRevenue"] });
    expect(r.branches.find((b) => b.id === stay.id)!.fingerprint).not.toBe(fingerprint);
    const [back] = await importRealities(exportRealities([r]));
    expect(back!.branches.find((b) => b.id === stay.id)).toMatchObject({ notApplicable: ["cafeRevenue"], fingerprint: r.branches.find((b) => b.id === stay.id)!.fingerprint });
    // A file whose fingerprints match but whose mark is wrong (an unknown key, or a value marked as not applying) is refused.
    for (const [mark, error] of [[["noSuchThing"], /unknown assumption/], [["jobSalary"], /cannot also be marked/]] as const) {
      const bundle = JSON.parse(exportRealities([r0]));
      const raw = bundle.realities[0].branches.find((b: { id: string }) => b.id === stay.id);
      if (mark[0] === "jobSalary") raw.values.jobSalary = 80000;
      raw.notApplicable = mark;
      const { fingerprint: _old, ...content } = raw;
      raw.fingerprint = await branchFingerprint(bundle.realities[0], content);
      await expect(importRealities(JSON.stringify(bundle)), mark[0]).rejects.toThrow(error);
    }
  });

  it("a new path does not inherit the mark: the change being explored may make it apply, so it starts unknown there", async () => {
    let r = await cafeMap();
    const stay = named(r, "Stay at Job").id;
    r = await updateBranch(r, stay, { notApplicable: ["cafeRevenue"] });
    const { reality, branch } = await forkBranch(r, stay, { name: "Stay, then open on weekends" }, ids);
    expect(branch.notApplicable).toBeUndefined();
    expect(branchStory(reality, branch).unknowns.map((u) => u.variable.key)).toContain("cafeRevenue");
  });

  it("another domain: the restaurant compares as before, and a figure it leaves out is named beside it", async () => {
    let r = await proposalToReality("What if I opened a restaurant?", restaurant, selectAll(restaurant), META, ids);
    const small = r.branches.find((b) => b.name.startsWith("Small café"))!.id;
    const full = named(r, "Full restaurant with staff").id;
    for (const [id, rev, cost, hours] of [[small, 12000, 10500, 60], [full, 20000, 17000, 50]] as const) {
      r = await updateBranch(r, id, { values: { monthlyRevenue: rev, monthlyCosts: cost, hoursPerWeek: hours }, sources: { monthlyRevenue: "user", monthlyCosts: "user", hoursPerWeek: "user" } });
    }
    const c = compareStory(r, small, full);
    const profit = c.calculated.find((x) => x.formula.label === "Profit per month")!;
    expect([profit.a, profit.b, profit.difference]).toEqual([1500, 3000, 1500]);
    const note = c.notes.find((x) => x.formula.key === profit.formula.key)!;
    expect(note.allZero).toBeNull();
    expect(note.leftOut.map((x) => x.variable.key)).toEqual(["hoursPerWeek"]);
    expect(c.notApplicableIn).toEqual([]);
  });
});

describe("2. one question-length limit everywhere", () => {
  it("a stored figure may be as long as the question, and a fresh look carries the whole question", async () => {
    expect(MAX_STATED_TEXT).toBeGreaterThanOrEqual(MAX_QUESTION_LENGTH);
    const long = `What if I moved to Lisbon for a remote role? ${"I would keep my savings and rent out my flat. ".repeat(12)}`.slice(0, MAX_QUESTION_LENGTH);
    expect(long.length).toBe(MAX_QUESTION_LENGTH);
    const r = await buildFromTemplate({ ...MOVE_CITY, question: long }, ids);
    const req = revisitRequest(r, r.branches[1]!, "");
    expect(req.question).toBe(long);
    expect(checkRevisitRequest(req)).toMatchObject({ ok: true });
  });
});

describe("3. the trade-off's summary agrees with its own lists", () => {
  it("solar: the battery path's outage backup is listed for that path only, so the summary does not say both list the same", async () => {
    const r = await buildFromTemplate(SOLAR, ids);
    const start = r.branches.find((b) => b.parentId === null)!;
    const battery = named(r, "Add a battery");
    const t = compareStory(r, start.id, battery.id).tradeOff;
    expect(t.eitherWay.map((i) => [i.possibility.text, i.from])).toEqual([["Roof may need repairs first", "both"], ["Backup power during outages", "b"]]);
    expect(t.kind).toBe("unsorted");
    // Shaded roof vs higher prices: both list only the shared roof note, so here "the same" is true.
    const same = compareStory(r, named(r, "Electricity prices rise 30%").id, named(r, "Shaded roof, no export payments").id).tradeOff;
    expect(same.kind).toBe("same");
    expect(same.eitherWay.every((i) => i.from === "both")).toBe(true);
  });

  it("the summary kind is derived from the lists for every pair of paths in the examples and drafts", async () => {
    const maps = [await buildFromTemplate(SOLAR, ids), await buildFromTemplate(MOVE_CITY, ids), await cafeMap()];
    for (const r of maps) for (const a of r.branches) for (const b of r.branches) {
      if (a.id === b.id) continue;
      const t = compareStory(r, a.id, b.id).tradeOff;
      const expected = t.forA.length + t.forB.length > 0 ? "split" : t.eitherWay.some((i) => i.from !== "both") ? "unsorted" : "same";
      expect(t.kind, `${a.name} vs ${b.name}`).toBe(expected);
    }
  });
});
