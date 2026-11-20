/**
 * Final QA correction: a figure from the question is not pre-selected for futures its words do not support.
 *
 * Reported: for "What if I left my ₹80,000/month software job in Mumbai to open a café? …" the salary was ticked for
 * the futures where the job ends and not for staying in it. The figure sits in the sentence that asks, so the rule "part
 * of what is asked → the futures that do it" sent it away from the future named for staying. The fix is general: "my"
 * right before a figure, or words that mention both a future that keeps things as they are and one that changes them,
 * leave the figure for the user to place. Nothing here knows cafés, salaries or jobs.
 *
 * The draft is a deterministic fixture (e2e/fixtures/r20a-proposals.json, "quitCafe"); no AI request is made.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { appliedFigures, carryFigureChoices, figurePlan, readStatedValues, type FigurePlan } from "../src/reality/stated";
import { proposalToReality, selectAll, validateProposal, type Proposal } from "../src/reality/proposal";
import { evaluateBranch, exportRealities, importRealities, updateBranch, type Reality } from "../src/reality/reality";
import { compareStory } from "../src/reality/story";

const fixture = (file: string, key: string): Proposal =>
  (JSON.parse(readFileSync(fileURLToPath(new URL(`../../web/e2e/fixtures/${file}`, import.meta.url)), "utf8")) as Record<string, Proposal>)[key]!;
const cafe = () => fixture("r20a-proposals.json", "quitCafe");

/** The question the QA used, word for word. */
const QA = "What if I left my ₹80,000/month software job in Mumbai to open a café? I have ₹10 lakh savings and expect ₹6 lakh setup cost and ₹40,000 monthly rent. Compare quitting to run it full-time, testing a weekend café while employed, and staying in my current job.";
const SALARY = "₹80,000/month software job in Mumbai";
const OWN_WHY = "You wrote “my”, so it may describe what you have now, which some futures could change. Choose where to use it.";

let n = 0;
const ids = () => `p${++n}`;
const META = { model: "mock", createdAt: "2026-11-07T00:00:00Z" };
const row = (plan: FigurePlan, text: string) => plan.rows.find((r) => r.stated.text === text)!;
const place = (plan: FigurePlan) => plan.rows.map((r) => [r.stated.value, r.chosenVariable, r.scope, r.target, r.use]);
/** The same draft with its futures named differently. */
const renamed = (p: Proposal, names: Record<string, string>): Proposal => {
  const q = structuredClone(p);
  for (const b of q.branches) b.name = names[b.name] ?? b.name;
  for (const x of q.possibilities) x.branch = names[x.branch] ?? x.branch;
  return q;
};
const monthlyIncome = (r: Reality, name: string) => evaluateBranch(r, r.branches.find((b) => b.name === name)!).calculated.find((c) => c.formula.label === "Monthly income")!.result;

describe("the reported café question", () => {
  it("the fixture is a valid draft, and the question's figures are read as before; the lakh amounts are now read exactly", () => {
    expect(validateProposal(cafe()).ok).toBe(true);
    const read = readStatedValues(QA);
    // Since the live-test fix a scale word written out is read exactly (1 lakh is 100,000), with the user's own words.
    expect(read.values.map((v) => [v.text, v.value, v.currency, v.period])).toEqual([
      [SALARY, 80000, "₹", "month"], ["₹10 lakh savings", 1000000, "₹", null], ["₹6 lakh setup cost", 600000, "₹", null], ["₹40,000 monthly rent", 40000, "₹", "month"],
    ]);
    expect(read.values[0]!.cues.own).toBe("my");
    expect(read.values[3]!.cues.own).toBeNull();
    expect(read.unclear).toEqual([]);
  });

  it("the salary is offered for its assumption but not ticked and not placed in any future; the user is told why", () => {
    const p = cafe();
    const plan = figurePlan(QA, p, selectAll(p));
    const salary = row(plan, SALARY);
    expect(salary).toMatchObject({ chosenVariable: "monthlySalary", status: "clear", scope: "unclear", target: "none", use: false, unplaced: true, scopeText: "" });
    expect(salary.placement.futures).toBeNull();
    expect(salary.scopeWhy).toBe(OWN_WHY);
    // The rent was already left for the user (a future reads as not opening): unchanged.
    expect(row(plan, "₹40,000 monthly rent")).toMatchObject({ chosenVariable: "monthlyRent", scope: "unclear", target: "none", use: false });
    // Confirming as offered never applies the salary or the rent, whichever future is opened. Only the lakh amounts,
    // which their own words place (savings: something you have, every future; setup cost: the two futures that open
    // the café), are ticked.
    expect(row(plan, "₹10 lakh savings")).toMatchObject({ chosenVariable: "savings", use: true, target: "all" });
    expect(row(plan, "₹6 lakh setup cost")).toMatchObject({ chosenVariable: "setupCost", use: true, target: [0, 1] });
    for (const focus of [0, 1, 2]) {
      expect(appliedFigures(plan, focus, [true, true, true]).map((f) => [f.variable, f.value, f.future])).toEqual([
        ["savings", 1000000, 0], ["savings", 1000000, 1], ["savings", 1000000, 2], ["setupCost", 600000, 0], ["setupCost", 600000, 1],
      ]);
    }
    expect(plan.warning).toBe(`2 figures have no future yet, so they will not be used unless you choose one: “${SALARY}”, “₹40,000 monthly rent”.`);
  });

  it("the same with the futures worded differently (the AI names them differently each time)", () => {
    const p = renamed(cafe(), { "Full-time café": "Quit to run the café full-time", "Part-time café": "Weekend café while employed", "Stay in job": "Stay in my current job" });
    expect(validateProposal(p).ok).toBe(true);
    expect(row(figurePlan(QA, p, selectAll(p)), SALARY)).toMatchObject({ scope: "unclear", target: "none", use: false });
  });

  it("without “my”, words that mention both a future that keeps things as they are and one that changes them are not placed either", () => {
    const p = cafe();
    const q = QA.replace("left my ₹80,000", "left a ₹80,000");
    const salary = figurePlan(q, p, selectAll(p)).rows[0]!;
    expect(salary.stated.cues.own).toBeNull();
    expect(salary).toMatchObject({ chosenVariable: "monthlySalary", scope: "unclear", target: "none", use: false });
    // "job" is in “Stay in job”, "café" in the other two: the words point both ways.
    expect(salary.scopeWhy).toBe("Your words mention “Stay in job”, which reads as keeping things as they are, and also futures that change them. Choose where to use it.");
    // The same when the words name some futures only, but those include one of each kind.
    const some = renamed(p, { "Full-time café": "Quit the job for the café", "Part-time café": "Keep the job and add a weekend café", "Stay in job": "Do nothing yet" });
    const mixed = figurePlan(q, some, selectAll(some)).rows[0]!;
    expect(mixed).toMatchObject({ scope: "unclear", target: "none", use: false });
    expect(mixed.scopeWhy).toBe("Your words mention “Keep the job and add a weekend café”, which reads as keeping things as they are, and also futures that change them. Choose where to use it.");
  });

  it("the user can assign it: to one future, or to the two where the job continues", () => {
    const p = cafe();
    const id = row(figurePlan(QA, p, selectAll(p)), SALARY).stated.id;
    const one = figurePlan(QA, p, selectAll(p), { [id]: { target: 2 } });
    expect(row(one, SALARY)).toMatchObject({ use: true, target: 2, blocked: null, unplaced: false, scopeText: "Used only in “Stay in job”.", scopeWhy: null });
    // Only the salary's own placement is checked here (the lakh amounts are checked above).
    const salaryOnly = (plan: FigurePlan) => appliedFigures(plan, 0, [true, true, true]).filter((f) => f.variable === "monthlySalary");
    expect(salaryOnly(one).map((f) => [f.variable, f.value, f.future])).toEqual([["monthlySalary", 80000, 2]]);
    const two = figurePlan(QA, p, selectAll(p), { [id]: { target: [1, 2] } });
    expect(row(two, SALARY)).toMatchObject({ use: true, blocked: null, scopeText: "Used in “Part-time café” and “Stay in job”." });
    expect(salaryOnly(two).map((f) => [f.variable, f.future])).toEqual([["monthlySalary", 1], ["monthlySalary", 2]]);
    // An explicit untick still wins over a chosen place.
    expect(row(figurePlan(QA, p, selectAll(p), { [id]: { target: [1, 2], use: false } }), SALARY).use).toBe(false);
  });

  it("no number is calculated from a salary on the future where the job ends", async () => {
    const p = cafe();
    const base = figurePlan(QA, p, selectAll(p));
    const rentId = row(base, "₹40,000 monthly rent").stated.id;
    // The user places only the rent (in the two café futures) and accepts the rest as offered.
    const plan = figurePlan(QA, p, selectAll(p), { [rentId]: { target: [0, 1] } });
    let r = await proposalToReality(QA, p, selectAll(p), { ...META, figures: appliedFigures(plan, 0, [true, true, true]) }, ids);
    const id = (name: string) => r.branches.find((b) => b.name === name)!.id;
    r = await updateBranch(r, id("Full-time café"), { values: { cafeRevenue: 60000 }, sources: { cafeRevenue: "user" } });
    const full = r.branches.find((b) => b.name === "Full-time café")!;
    expect(full.values).toMatchObject({ monthlySalary: null, monthlyRent: 40000, cafeRevenue: 60000 });
    expect(full.stated?.monthlySalary).toBeUndefined();
    expect(r.branches.every((b) => b.values.monthlySalary === null)).toBe(true);
    // Before the fix the salary was on this path, so "Monthly income" read 80,000 + 60,000 − 40,000 = 100,000 here.
    expect(monthlyIncome(r, "Full-time café").status).not.toBe("ok");
    const cmp = compareStory(r, id("Full-time café"), id("Stay in job"));
    expect(cmp.calculated.map((c) => c.formula.label)).not.toContain("Monthly income");
    expect(cmp.sameInBoth.map((s) => s.variable.key)).not.toContain("monthlySalary");
  });

  it("once the user places it, the numbers follow the user's choice only; “Doesn't apply”, Compare and export keep working", async () => {
    const p = cafe();
    const base = figurePlan(QA, p, selectAll(p));
    const salaryId = row(base, SALARY).stated.id;
    const rentId = row(base, "₹40,000 monthly rent").stated.id;
    const plan = figurePlan(QA, p, selectAll(p), { [salaryId]: { target: [1, 2] }, [rentId]: { target: [0, 1] } });
    expect(plan.ready).toBe(true);
    let r = await proposalToReality(QA, p, selectAll(p), { ...META, figures: appliedFigures(plan, 2, [true, true, true]) }, ids);
    const id = (name: string) => r.branches.find((b) => b.name === name)!.id;
    const of = (name: string) => r.branches.find((b) => b.name === name)!;
    expect([of("Full-time café").values.monthlySalary, of("Part-time café").values.monthlySalary, of("Stay in job").values.monthlySalary]).toEqual([null, 80000, 80000]);
    expect(of("Stay in job").stated?.monthlySalary).toEqual({ text: SALARY, value: 80000 });
    expect(of("Stay in job").sources).toMatchObject({ monthlySalary: "user" });
    // The formula is unchanged: with the user's own revenue, the part-time path adds the salary it keeps.
    r = await updateBranch(r, id("Part-time café"), { values: { cafeRevenue: 20000 }, sources: { cafeRevenue: "user" } });
    expect(monthlyIncome(r, "Part-time café")).toMatchObject({ status: "ok", value: 80000 + 20000 - 40000 });
    // "Doesn't apply" on the full-time path: the outcome does not apply there, and is never read as zero.
    r = await updateBranch(r, id("Full-time café"), { notApplicable: ["monthlySalary"] });
    expect(monthlyIncome(r, "Full-time café").status).toBe("not-applicable");
    const cmp = compareStory(r, id("Full-time café"), id("Part-time café"));
    expect(cmp.notApplicable.a).toEqual(["monthlySalary"]);
    expect(cmp.notApplicableIn.map((x) => [x.formula.label, x.side])).toEqual([["Monthly income", "a"]]);
    const same = compareStory(r, id("Part-time café"), id("Stay in job"));
    expect(same.sameInBoth.map((s) => [s.variable.key, s.value])).toContainEqual(["monthlySalary", 80000]);
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
  });

  it("editing only the number keeps the user's place for it; adding or removing “my” is a different statement and is not carried", () => {
    const p = cafe();
    const salaryId = row(figurePlan(QA, p, selectAll(p)), SALARY).stated.id;
    const choices = { [salaryId]: { target: [1, 2] as const } };
    const edited = QA.replace("₹80,000", "₹85,000");
    const kept = carryFigureChoices(QA, edited, p, selectAll(p), choices);
    const after = figurePlan(edited, p, selectAll(p), kept.choices);
    expect(row(after, SALARY.replace("80,000", "85,000"))).toMatchObject({ target: [1, 2], use: true });
    const without = QA.replace("left my ₹80,000", "left a ₹80,000");
    const carried = carryFigureChoices(QA, without, p, selectAll(p), choices);
    expect(Object.keys(carried.choices)).toEqual([]);
    expect(carried.notes.join(" ")).toContain("Not kept: your choice for");
  });
});

describe("other questions keep their placements", () => {
  const r20a = (key: string) => fixture("r20a-proposals.json", key);
  const BOOKSTORE = "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?";

  it("the mission bookstore, moving city, starting a company and the R19 bookstore: placed as before", () => {
    const shop = r20a("bookstoreOrNot");
    expect(place(figurePlan("What if I opened a bookstore? I have a budget of ₹500,000 and expect monthly rent of ₹35,000.", shop, selectAll(shop)))).toEqual([
      [500000, "startingBudget", "personal", "all", true], [35000, "monthlyRent", "scenario", 0, true],
    ]);
    const move = r20a("relocation");
    expect(place(figurePlan("What if I moved to London? Rent there is £2,000 a month.", move, selectAll(move)))).toEqual([[2000, "monthlyRent", "scenario", 0, true]]);
    expect(place(figurePlan("What if I moved to London? My rent would be £2,000 a month.", move, selectAll(move)))).toEqual([[2000, "monthlyRent", "scenario", 0, true]]);
    const startup = r20a("startupOrNot");
    expect(place(figurePlan("What if I started a company? I have savings of ₹800,000 and expect an office to cost ₹40,000 a month.", startup, selectAll(startup)))).toEqual([
      [800000, "savings", "personal", "all", true], [40000, "officeCost", "scenario", 0, true],
    ]);
    const audit = fixture("audit-proposals.json", "bookstore");
    expect(figurePlan(BOOKSTORE, audit, selectAll(audit)).rows.map((r) => [r.stated.value, r.scope, r.target])).toEqual([
      [20000, "scenario", 0], [8000, "scenario", 0], [4000, "scenario", 0],
    ]);
  });

  it("“my” does not override a clearer cue: my budget is the same everywhere, and “there” still points to the move", () => {
    const shop = r20a("bookstoreOrNot");
    expect(place(figurePlan("What if I opened a bookstore with my ₹500,000 budget?", shop, selectAll(shop)))).toEqual([[500000, "startingBudget", "personal", "all", true]]);
    const move = r20a("relocation");
    expect(place(figurePlan("What if I moved to London? I would pay my £2,000 monthly rent there.", move, selectAll(move)))).toEqual([[2000, "monthlyRent", "scenario", 0, true]]);
  });
});
