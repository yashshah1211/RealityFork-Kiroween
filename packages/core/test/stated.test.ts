import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { parseNumberInput } from "../src/reality/amounts";
import { appliedFigures, carryFigureChoices, currencyHint, figurePlan, matchStatedValues, readStatedValues } from "../src/reality/stated";
import { proposalToReality, selectAll, validateProposal, type AppliedFigure, type Proposal } from "../src/reality/proposal";
import {
  createReality, evaluateBranch, exportRealities, forkBranch, importRealities, removeVariable, updateBranch, addVariable, MAX_STATED_TEXT,
  type Reality,
} from "../src/reality/reality";
import { compareStory, knownView, staleSuggestions, valueOrigin } from "../src/reality/story";

const fixture = (file: string, key: string): Proposal =>
  (JSON.parse(readFileSync(fileURLToPath(new URL(`../../web/e2e/fixtures/${file}`, import.meta.url)), "utf8")) as Record<string, Proposal>)[key]!;
const bookstore = () => fixture("audit-proposals.json", "bookstore");
const education = () => fixture("r19-proposals.json", "education");
const projects = () => fixture("r19-proposals.json", "projects");

const BOOKSTORE = "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?";
const STUDY = "What if I studied two hours daily instead of one hour for exams four weeks away?";
const COLLEGE = "What if my college replaced written exams with team-based projects?";

let n = 0;
const ids = () => `s${++n}`;
const META = { model: "mock", createdAt: "2026-11-07T00:00:00Z" };
const brief = (q: string) => readStatedValues(q).values.map((v) => ({ text: v.text, value: v.value, currency: v.currency, base: v.base, period: v.period }));
const unusedTexts = (q: string) => readStatedValues(q).unclear.map((u) => u.text);

describe("reading figures from a question (local, no AI)", () => {
  it("the bookstore question: three amounts in rupees, exactly as written, with the period they state", () => {
    expect(brief(BOOKSTORE)).toEqual([
      { text: "₹20,000 per month in sales", value: 20000, currency: "₹", base: "", period: "month" },
      { text: "₹8,000 rent", value: 8000, currency: "₹", base: "", period: null },
      { text: "₹4,000 other monthly expenses", value: 4000, currency: "₹", base: "", period: "month" },
    ]);
    expect(readStatedValues(BOOKSTORE).unclear).toEqual([]);
  });

  it("the study question: two hours a day, one hour a day (period taken from the first, and said so), four weeks", () => {
    const r = readStatedValues(STUDY);
    expect(r.values.map((v) => [v.value, v.base, v.period])).toEqual([[2, "hour", "day"], [1, "hour", "day"], [4, "week", null]]);
    expect(r.values[0]!.inherited).toEqual([]);
    expect(r.values[1]!.inherited.join(" ")).toMatch(/per day.*taken from “studied two hours daily”/);
    expect(r.unclear).toEqual([]);
  });

  it("a question without numbers reads nothing and reports nothing", () => {
    expect(readStatedValues(COLLEGE)).toEqual({ values: [], unclear: [] });
    expect(readStatedValues("")).toEqual({ values: [], unclear: [] });
    expect(readStatedValues("What if one of my friends moved to a third city?")).toEqual({ values: [], unclear: [] });
  });

  it("never reads a number the typed-amount policy refuses (R18.1): it is reported as not used, with the user's own text", () => {
    for (const bad of ["1,5", "1.500", "1.200,50", "2.500", "1,2,3"]) {
      const q = `What if I paid ${bad} per month for rent?`;
      expect(brief(q), bad).toEqual([]);
      expect(unusedTexts(q), bad).toEqual([bad]);
      // The same text refused when typed: one policy.
      expect(parseNumberInput(bad, "").ok, bad).toBe(false);
    }
  });

  it("does not guess when a number is stuck to letters, scaled, signed, a percentage, a range, a fraction, a time or a year", () => {
    const cases: [string, string][] = [
      ["What if I earned 20k per month?", "20k"],
      ["What if I earned 1e3 per month?", "1e3"],
      ["What if I had 7pm classes?", "7pm"],
      // A scale word written out ("5 lakh", "2 million") is read exactly (scale-figures.test.ts); short ones are not.
      ["What if rent was 5 L a year?", "5 L"],
      ["What if I raised 2 mn?", "2 mn"],
      ["What if I raised 3 hundred?", "3 hundred"],
      ["What if costs fell by 5%?", "5%"],
      ["What if costs fell by 5 percent?", "5 percent"],
      ["What if I lost -500 a month?", "-500"],
      ["What if I owed (300) a month?", "(300)"],
      ["What if I worked 20-30 hours a week?", "20-30 hours"],
      ["What if I worked between 5 and 8 days?", "between 5 and 8 days"],
      ["What if I studied two to three hours?", "two to three hours"],
      ["What if I studied 2 or 3 hours?", "2 or 3 hours"],
      ["What if I studied 1 hour 30 minutes a day?", "1 hour 30 minutes"],
      ["What if I moved at 10:30?", "10:30"],
      ["What if I got 1/2 of the pay?", "1/2"],
      ["What if I moved in 2027?", "2027"],
      ["What if I studied twenty five hours?", "twenty five"],
    ];
    for (const [q, shown] of cases) {
      expect(brief(q), q).toEqual([]);
      expect(unusedTexts(q), q).toEqual([shown]);
    }
  });

  it("an ordinal is not an amount, and a number word counts only before a unit of time", () => {
    expect(readStatedValues("What if I skipped the 3rd week?")).toEqual({ values: [], unclear: [] });
    expect(brief("What if I studied three hours a day?").map((v) => v.value)).toEqual([3]);
    expect(brief("What if I read one of three books?")).toEqual([]);
  });

  it("a currency is never inferred: only a symbol the user wrote counts", () => {
    const a = readStatedValues("What if I moved to Mumbai and paid 20000 in rent?").values;
    expect(a).toHaveLength(1);
    expect(a[0]!.currency).toBeNull();
    const b = readStatedValues("What if I moved to London and paid 3,000 rupees a month?").values;
    expect(b[0]!.currency).toBeNull();
    expect(brief("What if rent is $3,000 per month and ₹5,000 a week?").map((v) => v.currency)).toEqual(["$", "₹"]);
    expect(brief("What if rent is 3,000$ per month?")[0]).toMatchObject({ value: 3000, currency: "$", period: "month" });
  });

  it("keeps decimals and thousands exactly as the typed-amount policy does", () => {
    expect(brief("What if I studied 1.5 hours a day?")[0]).toMatchObject({ value: 1.5, base: "hour", period: "day" });
    expect(brief("What if I saved ₹1,00,000 per year?")[0]).toMatchObject({ value: 100000, currency: "₹", period: "year" });
    expect(brief("What if I saved ₹ 500 a week?")[0]).toMatchObject({ value: 500, currency: "₹", period: "week" });
    expect(brief("What if rent is ₹12000/month?")[0]).toMatchObject({ value: 12000, period: "month" });
  });

  it("a period needs 'per' or a rate word: 'in a week' is not 'per week'", () => {
    expect(brief("What if I finished in 4 hours in a week?")[0]).toMatchObject({ base: "hour", period: null });
    expect(brief("What if I studied 2 hours a week?")[0]).toMatchObject({ base: "hour", period: "week" });
    expect(brief("What if I paid ₹500 each month?")[0]).toMatchObject({ currency: "₹", period: "month" });
  });

  it("the words it keeps are the user's own words from the question", () => {
    const squash = (s: string) => s.replace(/\s+/g, " ");
    for (const q of [BOOKSTORE, STUDY, "What if I spent ₹ 500 a week and 2 hours a day on 3 courses?"]) {
      for (const v of readStatedValues(q).values) expect(squash(q)).toContain(v.text);
    }
  });

  it("two figures with the same words get different ids", () => {
    const ids2 = readStatedValues("What if I paid ₹5 rent or ₹5 rent?").values.map((v) => v.id);
    expect(new Set(ids2).size).toBe(ids2.length);
  });

  it("property: never throws, every figure and every unused number is text of the question, values are finite", () => {
    const piece = fc.oneof(
      fc.constantFrom("what if", "I", "paid", "per month", "daily", "rent", "sales", "hours", "weeks", "instead of", "and", "between", "to", "or", ",", ".", "?", "₹", "$", "€", "%", "-", "/", ":", "k", "lakh", "two", "one", "twenty", "five", "(", ")",
        // R20A: hedges and lump-sum words anywhere around a number must never break "every quote is text of the question".
        "at least", "up to", "about", "roughly", "over", "under", "or more", "or so", "no more than", "budget", "savings", "total", "~"),
      fc.integer({ min: 0, max: 99999999 }).map(String),
      fc.tuple(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 999 })).map(([a, b]) => `${a}.${b}`),
      fc.tuple(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 999 })).map(([a, b]) => `${a},${b}`),
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 24 }), (parts) => {
        const q = parts.join(" ");
        const r = readStatedValues(q);
        const squash = (s: string) => s.replace(/\s+/g, " ").trim();
        for (const v of r.values) {
          expect(Number.isFinite(v.value)).toBe(true);
          expect(squash(q)).toContain(v.text);
        }
        for (const u of r.unclear) expect(squash(q)).toContain(u.text);
      }),
      { numRuns: 400 },
    );
  });

  it("property: an amount written the way the app shows it is read exactly; one the policy refuses is never read", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999_999 }), (value) => {
        const shown = value.toLocaleString("en-US");
        expect(brief(`What if I paid ₹${shown} per month in rent?`)[0]).toMatchObject({ value, currency: "₹", period: "month" });
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 100, max: 999 }), (a, b) => {
        // "a.bbb" (could be a decimal or thousands) and "a,bb" (a comma that is no thousands separator) are refused when typed.
        for (const text of [`${a}.${b}`, `${a},${b % 100}`.replace(/,(\d)$/, ",$1")]) {
          if (parseNumberInput(text, "").ok) continue;
          expect(brief(`What if I paid ${text} per month in rent?`)).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("where the figures go in the AI's draft", () => {
  it("bookstore: each amount fits its own assumption; only an amount that states its period is pre-ticked, for the future that does it", () => {
    const p = bookstore();
    const plan = figurePlan(BOOKSTORE, p, selectAll(p));
    // R20A: the rent amount names no period (the others do), so the period is not borrowed: it is shown and left to the user.
    expect(plan.rows.map((r) => [r.stated.value, r.chosenVariable, r.status, r.use, r.target])).toEqual([
      [20000, "monthlySales", "clear", true, 0],
      [8000, "rent", "check", false, 0],
      [4000, "otherCosts", "clear", true, 0],
    ]);
    expect(plan.problem).toBeNull();
    expect(plan.ready).toBe(true);
    expect(plan.unused).toEqual([]);
    expect(plan.rows[1]!.notes.join(" ")).toMatch(/per month for the other amounts, not this one.*tick it only if it is/);
    // Ticking it is the user's confirmation, and then it is used like the others.
    const ticked = figurePlan(BOOKSTORE, p, selectAll(p), { [plan.rows[1]!.stated.id]: { use: true } });
    expect(ticked.rows.map((r) => r.use)).toEqual([true, true, true]);
    expect(ticked.ready).toBe(true);
  });

  it("study plan: two figures for one assumption go to the futures whose names say them; the second borrows from the first, so the user ticks it; four weeks is shared", () => {
    const p = education();
    const plan = figurePlan(STUDY, p, selectAll(p));
    // R20A: "one hour" has no period or meaning of its own (taken from "two hours daily"), so it is not pre-ticked; the weeks are the same
    // in the two futures being compared, so they go to both.
    expect(plan.rows.map((r) => [r.stated.value, r.chosenVariable, r.status, r.use, r.target])).toEqual([
      [2, "studyHours", "clear", true, 0],
      [1, "studyHours", "check", false, 1],
      [4, "weeksToExams", "clear", true, "all"],
    ]);
    expect(plan.rows[0]!.conflictsWith).toHaveLength(1);
    expect(plan.rows[0]!.notes.join(" ")).toMatch(/each goes in a different future/);
    expect(plan.rows[1]!.notes.join(" ")).toMatch(/taken from another figure, so it is used only if you tick it/);
    expect(plan.ready).toBe(true);
    const ticked = figurePlan(STUDY, p, selectAll(p), { [plan.rows[1]!.stated.id]: { use: true } });
    expect(ticked.rows.map((r) => r.use)).toEqual([true, true, true]);
    expect(ticked.ready).toBe(true);
  });

  it("study plan: when no future's name says which figure it is, nothing is guessed — both are left unticked and nothing is ready", () => {
    const p = education();
    p.branches[0]!.name = "Study longer";
    p.branches[1]!.name = "Keep my routine";
    const plan = figurePlan(STUDY, p, selectAll(p));
    const study = plan.rows.filter((r) => r.chosenVariable === "studyHours");
    expect(study.map((r) => [r.use, r.target, r.future])).toEqual([[false, "none", null], [false, "none", null]]);
    // Only the weeks figure is ticked; the user still has to say where the hours go.
    expect(plan.rows.filter((r) => r.use).map((r) => r.chosenVariable)).toEqual(["weeksToExams"]);
    // The user chooses one future each: now it works. Choosing the same future for both collides.
    const a = figurePlan(STUDY, p, selectAll(p), { [study[0]!.stated.id]: { use: true, target: 0 }, [study[1]!.stated.id]: { use: true, target: 1 } });
    expect(a.problem).toBeNull();
    expect(a.ready).toBe(true);
    const clash = figurePlan(STUDY, p, selectAll(p), { [study[0]!.stated.id]: { use: true, target: 0 }, [study[1]!.stated.id]: { use: true, target: 0 } });
    expect(clash.problem).toMatch(/Two figures are set for “Study hours per day” in the same future/);
    expect(clash.ready).toBe(false);
    expect(appliedFigures(clash, 0, [true, true])).toEqual([]);
  });

  it("two ticked figures for one assumption cannot both go to 'the future I open'", () => {
    const p = education();
    const base = figurePlan(STUDY, p, selectAll(p));
    const [two, one] = base.rows.filter((r) => r.chosenVariable === "studyHours");
    const plan = figurePlan(STUDY, p, selectAll(p), { [two!.stated.id]: { use: true, target: "open" }, [one!.stated.id]: { use: true, target: "open" } });
    expect(plan.problem).not.toBeNull();
    expect(plan.ready).toBe(false);
  });

  it("a question without numbers offers nothing", () => {
    const p = projects();
    const plan = figurePlan(COLLEGE, p, selectAll(p));
    expect(plan).toMatchObject({ rows: [], unused: [], problem: null, offer: false, ready: false });
  });

  it("a figure the draft has no assumption for is listed as not used, never forced into the nearest one", () => {
    const p = bookstore();
    const q = "What if I opened a bookstore with ₹20,000 per month in sales and 3 helpers?";
    const plan = figurePlan(q, p, selectAll(p));
    expect(plan.rows.map((r) => r.chosenVariable)).toEqual(["monthlySales"]);
    expect(plan.unused.map((u) => u.text)).toEqual(["3 helpers"]);
    expect(plan.unused[0]!.why).toBe("none of this draft's number assumptions fits it");
  });

  it("when the draft keeps the same idea as a CHOICE (what the live model did for 'two hours instead of one hour'), the figure is not forced into a number and the reason says so", () => {
    const p = education();
    const hours = p.variables.find((v) => v.key === "studyHours")!;
    Object.assign(hours, { kind: "category", unit: "", options: ["none", "one", "two"], label: "Daily study time" });
    const plan = figurePlan(STUDY, p, selectAll(p));
    // Only the weeks fit a number assumption; the hours are left alone, never put in a field that is not a number.
    expect(plan.rows.map((r) => [r.stated.value, r.chosenVariable])).toEqual([[4, "weeksToExams"]]);
    expect(plan.unused.map((u) => u.text)).toEqual(["studied two hours daily", "one hour for exams"]);
    for (const u of plan.unused) expect(u.why).toBe("none of this draft's number assumptions fits it; “Daily study time” is a choice in this draft, not a number");
    expect(plan.ready).toBe(true);
    // The weeks count down to a date, which is the same in both futures.
    expect(appliedFigures(plan, 0, [true, true]).map((f) => [f.variable, f.future])).toEqual([["weeksToExams", 0], ["weeksToExams", 1]]);
  });

  it("a different currency is never bridged; a missing currency or period is said and the figure is not pre-ticked", () => {
    const p = bookstore();
    const dollars = figurePlan("What if I opened a bookstore with $20,000 per month in sales?", p, selectAll(p));
    expect(dollars.rows).toEqual([]);
    expect(dollars.unused.map((u) => u.text)).toEqual(["$20,000 per month in sales"]);

    const noSymbol = figurePlan("What if I opened a bookstore with 20000 per month in sales?", p, selectAll(p));
    expect(noSymbol.rows[0]).toMatchObject({ chosenVariable: "monthlySales", status: "check", use: false });
    expect(noSymbol.rows[0]!.notes.join(" ")).toMatch(/no currency symbol; this field is in “₹ per month”/);
    expect(noSymbol.ready).toBe(false);

    const noPeriod = figurePlan("What if I opened a bookstore with ₹20,000 in sales?", p, selectAll(p));
    expect(noPeriod.rows[0]).toMatchObject({ chosenVariable: "monthlySales", status: "check", use: false });
    expect(noPeriod.rows[0]!.notes.join(" ")).toMatch(/does not say per month/);

    // The field has no currency but the question does: it would be dropped, so it is said and not pre-ticked.
    const q = structuredClone(p);
    q.variables.find((v) => v.key === "monthlySales")!.unit = "per month";
    const none = figurePlan(BOOKSTORE, q, selectAll(q));
    expect(none.rows.find((r) => r.chosenVariable === "monthlySales")).toMatchObject({ status: "check", use: false });
    expect(none.rows.find((r) => r.chosenVariable === "monthlySales")!.notes.join(" ")).toMatch(/this field has no currency/);
  });

  it("a period or unit that disagrees excludes the assumption (hours are not weeks, per week is not per month)", () => {
    const p = education();
    const m = matchStatedValues(readStatedValues("What if I studied 3 weeks daily?"), p, selectAll(p).variables, ["a", "b"]);
    expect(m[0]!.candidates).not.toContain("studyHours");
    const week = bookstore();
    const per = matchStatedValues(readStatedValues("What if sales are ₹500 per week?"), week, selectAll(week).variables, ["a", "b"]);
    expect(per[0]!.candidates).not.toContain("monthlySales");
  });

  it("an unclear mapping is left to the user: two equally good assumptions give no pre-selection", () => {
    const p = structuredClone(bookstore());
    p.variables.find((v) => v.key === "rent")!.label = "Shop costs";
    p.variables.find((v) => v.key === "otherCosts")!.label = "Shop costs";
    const plan = figurePlan("What if I opened a bookstore with ₹4,000 shop costs per month?", p, selectAll(p));
    expect(plan.rows[0]).toMatchObject({ variable: null, status: "unclear", use: false });
    expect(plan.rows[0]!.notes.join(" ")).toMatch(/More than one assumption fits/);
    expect(plan.rows[0]!.candidates).toEqual(expect.arrayContaining(["rent", "otherCosts"]));
    // The user picks one: it works, and it is exactly their pick.
    const picked = figurePlan("What if I opened a bookstore with ₹4,000 shop costs per month?", p, selectAll(p), { [plan.rows[0]!.stated.id]: { use: true, variable: "rent" } });
    expect(picked.ready).toBe(true);
    expect(appliedFigures(picked, 0, [true, true])).toEqual([{ variable: "rent", value: 4000, text: plan.rows[0]!.stated.text, future: 0 }]);
  });

  it("an assumption the user left out of the draft is not offered", () => {
    const p = bookstore();
    const sel = { ...selectAll(p), variables: p.variables.map((v) => v.key !== "rent") };
    const plan = figurePlan(BOOKSTORE, p, sel);
    expect(plan.rows.map((r) => r.chosenVariable)).toEqual(["monthlySales", "otherCosts"]);
    expect(plan.unused.map((u) => u.text)).toEqual(["₹8,000 rent"]);
  });

  it("a user's own pick overrides the proposal, and a pick that is not a kept assumption means none", () => {
    const p = bookstore();
    const first = figurePlan(BOOKSTORE, p, selectAll(p)).rows[0]!;
    expect(figurePlan(BOOKSTORE, p, selectAll(p), { [first.stated.id]: { variable: "rent" } }).rows[0]!.chosenVariable).toBe("rent");
    const none = figurePlan(BOOKSTORE, p, selectAll(p), { [first.stated.id]: { variable: "doesNotExist" } }).rows[0]!;
    expect(none.chosenVariable).toBeNull();
    expect(none.blocked).toMatch(/Choose which assumption/);
    expect(figurePlan(BOOKSTORE, p, selectAll(p), { [first.stated.id]: { use: false } }).rows[0]!.use).toBe(false);
  });

  it("appliedFigures: 'open' follows the future opened, 'all' every included future, 'none' nothing, a left-out future is dropped", () => {
    const p = bookstore();
    const rowId = figurePlan(BOOKSTORE, p, selectAll(p)).rows[0]!.stated.id;
    const at = (target: "open" | "all" | "none" | number, focus: number | undefined, included = [true, true]) =>
      appliedFigures(figurePlan(BOOKSTORE, p, selectAll(p), { [rowId]: { target } }), focus, included).filter((f) => f.variable === "monthlySales").map((f) => f.future);
    expect(at("open", 1)).toEqual([1]);
    expect(at("open", undefined)).toEqual([]);
    expect(at("all", 0)).toEqual([0, 1]);
    expect(at("all", 0, [true, false])).toEqual([0]);
    expect(at("none", 0)).toEqual([]);
    expect(at(1, 0)).toEqual([1]);
    expect(at(1, 0, [true, false])).toEqual([]);
  });

  it("a figure sent to a future the user left out of the draft is blocked, never dropped quietly", () => {
    const p = bookstore();
    const sel = { ...selectAll(p), branches: [true, false] };
    const id = figurePlan(BOOKSTORE, p, sel).rows[0]!.stated.id;
    const plan = figurePlan(BOOKSTORE, p, sel, { [id]: { target: 1 } });
    expect(plan.rows[0]).toMatchObject({ use: true, blocked: "That future is left out of the draft." });
    expect(plan.ready).toBe(false);
    expect(appliedFigures(plan, 0, [true, false])).toEqual([]);
    // Unticking it, or sending it to a future that is there, clears the block.
    expect(figurePlan(BOOKSTORE, p, sel, { [id]: { target: 1, use: false } }).ready).toBe(true);
    expect(figurePlan(BOOKSTORE, p, sel, { [id]: { target: 0 } }).ready).toBe(true);
  });

  it("the same inputs always give the same plan", () => {
    const p = education();
    expect(figurePlan(STUDY, p, selectAll(p))).toEqual(figurePlan(STUDY, structuredClone(p), selectAll(p)));
  });

  it("currencyHint: tells when the question named a currency the field lacks, and nothing otherwise", () => {
    expect(currencyHint(BOOKSTORE, "Sales per month", "per month")).toMatch(/Your question says ₹ here/);
    expect(currencyHint(BOOKSTORE, "Sales per month", "₹ per month")).toBeNull();
    expect(currencyHint(BOOKSTORE, "Number of staff", "people")).toBeNull();
    expect(currencyHint(COLLEGE, "Sales per month", "per month")).toBeNull();
  });
});

describe("confirmed figures become the user's own values on the chosen futures only", () => {
  const apply = (p: Proposal, figures: AppliedFigure[], question = BOOKSTORE) => proposalToReality(question, p, selectAll(p), { ...META, figures }, ids);
  /** What the user confirms: the pre-ticked figures as they are, plus the ones for these assumptions, which they tick themselves. */
  const confirmed = (q: string, p: Proposal, focus: number, tick: readonly string[] = []) => {
    const base = figurePlan(q, p, selectAll(p));
    const choices = Object.fromEntries(base.rows.filter((r) => r.chosenVariable && tick.includes(r.chosenVariable)).map((r) => [r.stated.id, { use: true }]));
    return appliedFigures(figurePlan(q, p, selectAll(p), choices), focus, p.branches.map(() => true));
  };

  it("bookstore: one confirmation (rent ticked by the user, its period was not written) gives ₹8,000 a month of profit on the opened future; the root and the other future stay unknown", async () => {
    const p = bookstore();
    // Without the tick the rent is left out: nothing is filled in from a period the user did not write.
    const without = await apply(p, confirmed(BOOKSTORE, p, 0));
    expect(without.branches[1]!.values).toMatchObject({ monthlySales: 20000, rent: null, otherCosts: 4000 });
    const r = await apply(p, confirmed(BOOKSTORE, p, 0, ["rent"]));
    const [root, open, closed] = r.branches;
    expect(open!.name).toBe("Open the bookstore");
    expect(open!.values).toMatchObject({ openShop: true, monthlySales: 20000, rent: 8000, otherCosts: 4000 });
    expect(open!.sources).toEqual({ openShop: "ai", monthlySales: "user", rent: "user", otherCosts: "user" });
    expect(open!.stated).toEqual({
      monthlySales: { text: "₹20,000 per month in sales", value: 20000 },
      rent: { text: "₹8,000 rent", value: 8000 },
      otherCosts: { text: "₹4,000 other monthly expenses", value: 4000 },
    });
    const profit = evaluateBranch(r, open!).calculated.find((c) => c.formula.label === "shopProfit")!;
    expect(profit.result).toMatchObject({ status: "ok", value: 8000 });
    expect(root!.values.monthlySales).toBeNull();
    expect(root!.stated).toBeUndefined();
    expect(closed!.values.monthlySales).toBeNull();
    expect(closed!.stated).toBeUndefined();
    expect(closed!.sources).toEqual({ openShop: "ai" });
    expect(evaluateBranch(r, closed!).calculated.every((c) => c.result.status !== "ok")).toBe(true);
  });

  it("bookstore: no suggestion is flagged 'made before you told us' just because the figures came with the draft", async () => {
    const p = bookstore();
    const r = await apply(p, confirmed(BOOKSTORE, p, 0, ["rent"]));
    for (const b of r.branches) expect(staleSuggestions(r, b), b.name).toEqual([]);
    // Control: the same figures typed afterwards DO flag the suggestion that depends on them.
    const plain = await proposalToReality(BOOKSTORE, p, selectAll(p), META, ids);
    const open = plain.branches[1]!;
    const typed = await updateBranch(plain, open.id, { values: { monthlySales: 20000 }, sources: { monthlySales: "user" } });
    expect(staleSuggestions(typed, typed.branches[1]!).length).toBeGreaterThan(0);
  });

  it("study plan: two hours and one hour land on their own futures; the four weeks, the same in both, land on both; no improvement is invented", async () => {
    const p = education();
    // As pre-ticked: the two-hours figure and the shared weeks. The one-hour figure borrows its period, so it is the user's to tick.
    const preTicked = await apply(p, confirmed(STUDY, p, 0), STUDY);
    expect(preTicked.branches[2]!.values).toMatchObject({ studyHours: null, weeksToExams: 4 });
    // Ticked by the user, it lands on the future whose name says it.
    const r = await apply(p, confirmed(STUDY, p, 0, ["studyHours"]), STUDY);
    const [, two, one] = r.branches;
    expect(two!.values).toMatchObject({ studyHours: 2, weeksToExams: 4 });
    expect(one!.values).toMatchObject({ studyHours: 1, weeksToExams: 4 });
    expect(two!.stated!.studyHours).toEqual({ text: "studied two hours daily", value: 2 });
    expect(one!.stated!.studyHours!.value).toBe(1);
    expect(one!.stated!.weeksToExams).toEqual({ text: "exams four weeks away", value: 4 });
    expect(evaluateBranch(r, two!).calculated[0]!.result).toMatchObject({ status: "ok", value: 56 });
    expect(evaluateBranch(r, one!).calculated[0]!.result).toMatchObject({ status: "ok", value: 28 });
    // Choosing 'the future I open' for the weeks puts them on that one only (the earlier default).
    const weeksId = figurePlan(STUDY, p, selectAll(p)).rows.find((x) => x.chosenVariable === "weeksToExams")!.stated.id;
    const only = await apply(p, appliedFigures(figurePlan(STUDY, p, selectAll(p), { [weeksId]: { target: "open" } }), 0, [true, true]), STUDY);
    expect(only.branches[2]!.values.weeksToExams).toBeNull();
    expect(evaluateBranch(only, only.branches[2]!).calculated[0]!.result.status).not.toBe("ok");
  });

  it("without figures nothing changes: every number is unknown and no path records a figure from the question", async () => {
    const p = bookstore();
    const r = await proposalToReality(BOOKSTORE, p, selectAll(p), META, ids);
    expect(r.branches.every((b) => b.values.monthlySales === null && b.stated === undefined)).toBe(true);
    expect(r.branches[1]!.sources).toEqual({ openShop: "ai" });
  });

  it("a figure naming an unknown assumption, a non-number, a future that was left out, or a bad value is ignored", async () => {
    const p = bookstore();
    const sel = { ...selectAll(p), branches: [true, false] };
    const bad: AppliedFigure[] = [
      { variable: "nope", value: 1, text: "x", future: 0 },
      { variable: "openShop", value: 1, text: "x", future: 0 },
      { variable: "rent", value: Number.NaN, text: "x", future: 0 },
      { variable: "rent", value: Number.POSITIVE_INFINITY, text: "x", future: 0 },
      { variable: "rent", value: 5, text: "  ", future: 0 },
      { variable: "rent", value: 5, text: "₹5 rent", future: 1 },
      { variable: "rent", value: 5, text: "₹5 rent", future: 7 },
    ];
    const r = await proposalToReality(BOOKSTORE, p, sel, { ...META, figures: bad }, ids);
    expect(r.branches).toHaveLength(2);
    expect(r.branches[1]!.values.rent).toBeNull();
    expect(r.branches[1]!.stated).toBeUndefined();
  });

  it("a figure for an assumption the user left out of the draft is ignored", async () => {
    const p = bookstore();
    const sel = { ...selectAll(p), variables: p.variables.map((v) => v.key !== "rent") };
    const r = await proposalToReality(BOOKSTORE, p, sel, { ...META, figures: [{ variable: "rent", value: 8000, text: "₹8,000 rent", future: 0 }] }, ids);
    expect(r.variables.some((v) => v.key === "rent")).toBe(false);
    expect(r.branches[1]!.stated).toBeUndefined();
  });

  it("a figure that is set again by typing keeps the new number; the old words are no longer shown for it", async () => {
    const p = bookstore();
    const r = await apply(p, confirmed(BOOKSTORE, p, 0, ["rent"]));
    const open = r.branches[1]!;
    expect(knownView(r, open).values.find((v) => v.variable.key === "rent")!.stated).toEqual({ text: "₹8,000 rent", value: 8000 });
    expect(valueOrigin(r, open, "rent")).toMatchObject({ origin: "user", stated: { value: 8000 } });
    const typed = await updateBranch(r, open.id, { values: { rent: 9000 }, sources: { rent: "user" } });
    const after = typed.branches[1]!;
    expect(after.values.rent).toBe(9000);
    expect(knownView(typed, after).values.find((v) => v.variable.key === "rent")!.stated).toBeUndefined();
    expect(valueOrigin(typed, after, "rent").stated).toBeUndefined();
    // Typing the same number again shows the words again: it is still the number those words gave.
    const same = await updateBranch(typed, open.id, { values: { rent: 8000 } });
    expect(knownView(same, same.branches[1]!).values.find((v) => v.variable.key === "rent")!.stated?.value).toBe(8000);
  });

  it("branching from a path keeps its figures and their words; the other fields of the copy start as before", async () => {
    const p = bookstore();
    const r = await apply(p, confirmed(BOOKSTORE, p, 0, ["rent"]));
    const f = await forkBranch(r, r.branches[1]!.id, { name: "Copy" }, ids);
    expect(f.branch.values.rent).toBe(8000);
    expect(f.branch.stated).toEqual(r.branches[1]!.stated);
    expect(f.branch.stated).not.toBe(r.branches[1]!.stated);
    expect(f.branch.sources).toMatchObject({ rent: "user" });
    const child = f.reality.branches.find((b) => b.id === f.branch.id)!;
    expect(knownView(f.reality, child).values.find((v) => v.variable.key === "rent")).toMatchObject({ value: 8000, stated: { text: "₹8,000 rent" } });
  });
});

describe("storing figures from the question", () => {
  const bookstoreReality = async (): Promise<Reality> => {
    const p = bookstore();
    return proposalToReality(BOOKSTORE, p, selectAll(p), { ...META, figures: appliedFigures(figurePlan(BOOKSTORE, p, selectAll(p)), 0, [true, true]) }, ids);
  };

  it("survives export and import unchanged, fingerprints included", async () => {
    const r = await bookstoreReality();
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
    expect(back!.branches[1]!.stated).toEqual(r.branches[1]!.stated);
  });

  it("is part of the fingerprint only when present: older files and paths without figures keep theirs", async () => {
    const plain = await createReality({ question: "What if I moved?", startName: "Start" }, ids);
    const withEmpty = JSON.parse(JSON.stringify(plain)) as Reality;
    (withEmpty.branches[0] as { stated?: object }).stated = {};
    const [again] = await importRealities(exportRealities([withEmpty]));
    expect(again!.branches[0]!.fingerprint).toBe(plain.branches[0]!.fingerprint);
    const r = await bookstoreReality();
    expect(r.branches[1]!.fingerprint).not.toBe((await proposalToReality(BOOKSTORE, bookstore(), selectAll(bookstore()), META, ids)).branches[1]!.fingerprint);
  });

  it("changing the recorded words of a figure is detected on import", async () => {
    const r = await bookstoreReality();
    const text = exportRealities([r]).replace("₹8,000 rent", "₹9,000 rent");
    await expect(importRealities(text)).rejects.toThrow();
  });

  it("validation rejects a malformed figure by its own rule (the fingerprint is re-sealed, so this is not the hash check)", async () => {
    const r = await bookstoreReality();
    const open = r.branches[1]!.id;
    const put = (stated: Record<string, unknown>) => updateBranch(r, open, { stated: stated as never });
    await expect(put({ ghost: { text: "x", value: 1 } })).rejects.toThrow(/unknown assumption "ghost"/);
    await expect(put({ openShop: { text: "yes", value: 1 } })).rejects.toThrow(/"Open the shop" is not a number/);
    await expect(put({ rent: { text: "   ", value: 8000 } })).rejects.toThrow(/figure from the question for "Rent" is malformed/);
    await expect(put({ rent: { text: "x".repeat(MAX_STATED_TEXT + 1), value: 8000 } })).rejects.toThrow(/malformed/);
    await expect(put({ rent: { text: "₹8,000 rent", value: "8000" } })).rejects.toThrow(/malformed/);
    await expect(put({ rent: { text: "₹8,000 rent", value: Number.NaN } })).rejects.toThrow(/malformed/);
    await expect(put({ rent: "₹8,000 rent" })).rejects.toThrow(/malformed/);
    // A well-formed one is accepted and re-sealed.
    const ok = await updateBranch(r, open, { stated: { rent: { text: "₹9,000 rent", value: 9000 } }, values: { rent: 9000 } });
    expect(ok.branches[1]!.stated!.rent).toEqual({ text: "₹9,000 rent", value: 9000 });
  });

  it("removing an assumption removes its figure and source with it", async () => {
    const p = bookstore();
    const sel = selectAll(p);
    const figures = appliedFigures(figurePlan(BOOKSTORE, p, sel), 0, [true, true]).filter((f) => f.variable === "monthlySales");
    let r = await proposalToReality(BOOKSTORE, p, { ...sel, formulas: p.formulas.map(() => false) }, { ...META, figures }, ids);
    expect(r.branches[1]!.stated?.monthlySales).toBeDefined();
    r = await removeVariable(r, "monthlySales");
    expect(r.branches[1]!.stated).toBeUndefined();
    expect(r.branches[1]!.sources).toEqual({ openShop: "ai" });
  });

  it("a plain addVariable after figures were applied leaves them alone", async () => {
    const r = await bookstoreReality();
    const more = await addVariable(r, { key: "staff", label: "Staff", kind: "number", unit: "people", options: [], source: "", uncertainty: "" }, null);
    expect(more.branches[1]!.stated).toEqual(r.branches[1]!.stated);
  });
});

// =====================================================================================================================
// R20A, trustworthy figures: RV-01 (a period the user did not write), RV-02 (hedged amounts), RV-03 (an edited question
// keeps the user's choices) and RV-06 (a figure shared by the futures goes to all of them, and says so).
// =====================================================================================================================

const r20a = (key: string): Proposal => fixture("r20a-proposals.json", key);
const MISSION_BOOKSTORE = "What if I opened a bookstore? I have a budget of ₹500,000 and expect monthly rent of ₹35,000.";
const MISSION_STUDY = "What if I studied for 3 hours every day instead of 1 hour for the next 6 months?";
const grouped = (n: number) => n.toLocaleString("en-US");

/** A draft with only number assumptions, for rules that depend on nothing else in a proposal. */
const draftWith = (fields: { key: string; label: string; unit: string }[], futures = ["Future one", "Future two"]): Proposal =>
  ({
    interpretation: "x", contextQuestions: [], questions: [], missingEvidence: [], limitations: [], formulas: [], possibilities: [],
    branches: futures.map((name) => ({ name, description: name, settings: [] })),
    variables: fields.map((f) => ({ ...f, kind: "number" as const, options: [], why: "x" })),
  }) as unknown as Proposal;

describe("R20A drafts used by these tests", () => {
  it("pass the same checks as a draft from the AI", () => {
    for (const key of ["bookstoreStartingBudget", "bookstoreMonthlyBudget", "studyMonths", "relocation", "bookstoreOrNot", "startupOrNot", "housing"]) {
      const check = validateProposal(r20a(key));
      expect(check.ok, `${key}: ${check.ok ? "" : check.errors.join("; ")}`).toBe(true);
    }
  });
});

describe("R20A RV-01: a period the user did not write is never filled in", () => {
  it("'a budget of ₹500,000' is pre-ticked for a 'Starting budget' (no period), and so is the rent that says 'monthly'", () => {
    const p = r20a("bookstoreStartingBudget");
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    expect(plan.rows.map((r) => [r.stated.value, r.chosenVariable, r.status, r.use])).toEqual([
      [500000, "startingBudget", "clear", true],
      [35000, "monthlyRent", "clear", true],
    ]);
    expect(plan.rows[0]!.notes).toEqual([]);
    expect(plan.ready).toBe(true);
  });

  it("the same budget is NOT pre-ticked into a 'Monthly budget' (₹ per month); it is offered with the reason, and the explicit monthly rent still is", () => {
    const p = r20a("bookstoreMonthlyBudget");
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    const budget = plan.rows.find((r) => r.stated.value === 500000)!;
    expect(budget).toMatchObject({ chosenVariable: "monthlyBudget", status: "check", use: false });
    expect(budget.notes.join(" ")).toMatch(/does not say per month; this field is “₹ per month”\. Tick it only if the amount is per month\./);
    // A budget is never described as following another amount's period.
    expect(budget.notes.join(" ")).not.toMatch(/other amounts/);
    expect(plan.rows.find((r) => r.stated.value === 35000)).toMatchObject({ chosenVariable: "monthlyRent", status: "clear", use: true });
    // Nothing is applied for it unless the user ticks it; then it is applied exactly as written.
    expect(appliedFigures(plan, 0, [true, true]).map((f) => f.variable)).toEqual(["monthlyRent", "monthlyRent"]);
    const ticked = figurePlan(MISSION_BOOKSTORE, p, selectAll(p), { [budget.stated.id]: { use: true } });
    expect(appliedFigures(ticked, 0, [true, true]).filter((f) => f.variable === "monthlyBudget").map((f) => f.value)).toEqual([500000, 500000]);
  });

  it("an explicit period stays authoritative: 'a budget of ₹50,000 a month' fits a monthly budget, and a per-month amount is not put in a field with no period", () => {
    const monthly = r20a("bookstoreMonthlyBudget");
    const q = "What if I opened a bookstore? I have a budget of ₹50,000 a month and expect monthly rent of ₹35,000.";
    expect(figurePlan(q, monthly, selectAll(monthly)).rows.map((r) => [r.stated.value, r.chosenVariable, r.status, r.use])).toEqual([
      [50000, "monthlyBudget", "clear", true],
      [35000, "monthlyRent", "clear", true],
    ]);
    const lump = r20a("bookstoreStartingBudget");
    const row = figurePlan(q, lump, selectAll(lump)).rows.find((r) => r.stated.value === 50000)!;
    expect(row).toMatchObject({ chosenVariable: "startingBudget", status: "check", use: false });
    expect(row.notes.join(" ")).toMatch(/says per month; this field has no period/);
  });

  it("budget, savings, total, one-time, deposit, loan and capital wording never borrows the period of another amount", () => {
    for (const [cue, field] of [["budget", "budget"], ["savings", "savings"], ["total", "total"], ["one-time cost", "cost"], ["up-front cost", "cost"], ["deposit", "deposit"], ["loan", "loan"], ["capital", "capital"]] as const) {
      const p = draftWith([{ key: "x", label: `Monthly ${field}`, unit: "₹ per month" }]);
      const plan = figurePlan(`What if I paid ₹30,000 per month on the gym and had a ${cue} of ₹500,000?`, p, selectAll(p));
      const row = plan.rows.find((r) => r.stated.value === 500000)!;
      expect(row, cue).toMatchObject({ chosenVariable: "x", status: "check", use: false });
      expect(row.stated.lumpSum, cue).toBe(true);
      expect(row.notes.join(" "), cue).toMatch(/does not say per month/);
      expect(row.notes.join(" "), cue).not.toMatch(/other amounts/);
    }
  });

  it("any other amount that follows its neighbours' period is still not pre-ticked; the note says why and what to do", () => {
    const p = draftWith([{ key: "x", label: "Monthly fees", unit: "₹ per month" }]);
    const row = figurePlan("What if I paid ₹30,000 per month on the gym and ₹8,000 in fees?", p, selectAll(p)).rows[0]!;
    expect(row).toMatchObject({ chosenVariable: "x", status: "check", use: false });
    expect(row.notes.join(" ")).toMatch(/per month for the other amounts, not this one\. It may be per month too: tick it only if it is\./);
  });

  it("property: an amount written without a period is never pre-ticked into a field that has one", () => {
    const words = ["budget", "savings", "rent", "fees", "income", "total", "deposit", "salary"];
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }), fc.constantFrom(...words), fc.constantFrom("month", "week", "day", "year"), fc.boolean(),
        (n, word, period, neighbour) => {
          const p = draftWith([{ key: "x", label: `Your ${word}`, unit: `₹ per ${period}` }]);
          const q = `What if I ${neighbour ? `paid ₹${grouped(n + 1)} per ${period} on the gym and ` : ""}had ${word} of ₹${grouped(n)}?`;
          const rows = figurePlan(q, p, selectAll(p)).rows.filter((r) => r.stated.period === null);
          expect(rows, q).toHaveLength(1);
          expect(rows[0]!.use, q).toBe(false);
          expect(rows[0]!.status, q).toBe("check");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a figure that borrowed its period or meaning from another figure is shown, not pre-ticked; the figure it was compared with is", () => {
    const p = r20a("studyMonths");
    const plan = figurePlan(MISSION_STUDY, p, selectAll(p));
    const hours = plan.rows.filter((r) => r.chosenVariable === "studyHours");
    expect(hours.map((r) => [r.stated.value, r.status, r.use, r.target])).toEqual([[3, "clear", true, 0], [1, "check", false, 1]]);
    expect(hours[1]!.notes.join(" ")).toMatch(/“per day” is taken from.*used only if you tick it/);
  });
});

describe("R20A RV-02: a hedged amount is kept with its words and is never an exact value until the user says so", () => {
  const HEDGES: [string, "min" | "max" | "about"][] = [
    ["at least", "min"], ["at most", "max"], ["up to", "max"], ["about", "about"], ["approximately", "about"], ["roughly", "about"], ["around", "about"], ["over", "min"], ["under", "max"],
    ["no more than", "max"], ["no less than", "min"], ["more than", "min"], ["less than", "max"], ["fewer than", "max"], ["nearly", "about"], ["almost", "about"], ["maximum of", "max"], ["minimum of", "min"],
  ];

  for (const [word, kind] of HEDGES) {
    it(`“${word}” stays with the amount, the number is not changed, the row is not pre-ticked, and ticking it applies exactly that number`, () => {
      const q = `What if I opened a bookstore and paid ${word} ₹35,000 per month in rent?`;
      const read = readStatedValues(q).values;
      expect(read).toHaveLength(1);
      expect(read[0]).toMatchObject({ value: 35000, currency: "₹", period: "month", qualifier: { kind, word } });
      expect(read[0]!.text.toLowerCase()).toContain(word);
      expect(q.replace(/\s+/g, " ")).toContain(read[0]!.text);
      const p = bookstore();
      const plan = figurePlan(q, p, selectAll(p));
      const row = plan.rows.find((r) => r.chosenVariable === "rent")!;
      expect(row).toMatchObject({ status: "check", use: false });
      expect(row.notes.join(" ")).toContain(`You wrote “${word}”`);
      expect(row.notes.join(" ")).toMatch(/not an exact amount|not read as an exact amount/);
      // The note says why it is not ticked; the instruction is the checkbox's own label, not repeated here.
      expect(row.notes.join(" ")).not.toMatch(/Tick it only/);
      expect(plan.ready).toBe(false);
      expect(appliedFigures(plan, 0, [true, true])).toEqual([]);
      const ticked = figurePlan(q, p, selectAll(p), { [row.stated.id]: { use: true } });
      expect(appliedFigures(ticked, 0, [true, true])).toEqual([{ variable: "rent", value: 35000, text: row.stated.text, future: 0 }]);
    });
  }

  it("a hedge written after the figure and its unit counts too: 'or more', 'or less', 'or fewer', 'or so', 'and above', 'at most', 'at least'", () => {
    for (const [phrase, kind] of [["or more", "min"], ["or less", "max"], ["or fewer", "max"], ["or so", "about"], ["and above", "min"], ["at most", "max"], ["at least", "min"]] as const) {
      const q = `What if rent was ₹35,000 per month ${phrase}?`;
      const v = readStatedValues(q).values;
      expect(v, phrase).toHaveLength(1);
      expect(v[0], phrase).toMatchObject({ value: 35000, period: "month", qualifier: { kind, word: phrase } });
      expect(v[0]!.text, phrase).toContain(phrase);
      const p = bookstore();
      expect(figurePlan(q, p, selectAll(p)).rows.find((r) => r.chosenVariable === "rent"), phrase).toMatchObject({ status: "check", use: false });
    }
    expect(readStatedValues("What if I studied 3 hours a day or less?").values[0]).toMatchObject({ value: 3, base: "hour", period: "day", qualifier: { kind: "max", word: "or less" } });
    expect(readStatedValues("What if 20 customers or so came each day?").values[0]).toMatchObject({ value: 20, qualifier: { kind: "about", word: "or so" } });
  });

  it("several figures in one sentence: each takes only its own hedge", () => {
    const pair = (q: string) => readStatedValues(q).values.map((v) => [v.value, v.qualifier?.word ?? null, v.qualifier?.kind ?? null]);
    expect(pair("What if my income was about ₹40,000 a month and my savings were at least ₹5,000 a month?")).toEqual([[40000, "about", "about"], [5000, "at least", "min"]]);
    expect(pair("What if my income is ₹40,000 a month and my rent is up to ₹12,000 a month?")).toEqual([[40000, null, null], [12000, "up to", "max"]]);
    expect(pair("What if I studied about 3 hours a day for roughly 6 months?")).toEqual([[3, "about", "about"], [6, "roughly", "about"]]);
    // The hedge before the second figure is not part of the first one's quote.
    expect(readStatedValues("What if I studied about 3 hours a day for roughly 6 months?").values.map((v) => v.text)).toEqual(["studied about 3 hours a day", "roughly 6 months"]);
    expect(pair("What if I studied about 3 hours a day for 6 months?")).toEqual([[3, "about", "about"], [6, null, null]]);
    expect(pair("What if I paid at most ₹35,000 in rent and over ₹500,000 for the shop?")).toEqual([[35000, "at most", "max"], [500000, "over", "min"]]);
    // In the draft, the hedged one is left for the user and the plain one is pre-ticked.
    const p = draftWith([{ key: "inc", label: "Monthly income", unit: "₹ per month" }, { key: "rent", label: "Monthly rent", unit: "₹ per month" }]);
    const plan = figurePlan("What if my income is ₹40,000 a month and my rent is up to ₹12,000 a month?", p, selectAll(p));
    expect(plan.rows.map((r) => [r.chosenVariable, r.use, r.status])).toEqual([["inc", true, "clear"], ["rent", false, "check"]]);
  });

  it("only a hedge directly before or after the figure counts", () => {
    for (const q of [
      "What if I am about to pay ₹35,000 per month in rent?",
      "What if at least one of us paid ₹35,000 per month in rent?",
      "What if I woke up 3 hours earlier each day?",
      "What if I paid ₹35,000 per month in rent, at least in the first year?",
    ]) {
      for (const v of readStatedValues(q).values) expect(v.qualifier, q).toBeNull();
    }
  });

  it("'over' and 'under' are not read as an exact amount either, and the note says they can also mean 'during'", () => {
    const p = bookstore();
    const row = figurePlan("What if I paid over ₹35,000 per month in rent?", p, selectAll(p)).rows[0]!;
    expect(row.notes.join(" ")).toMatch(/“over”, which can mean more than the amount or during it, so it is not read as an exact amount/);
    expect(readStatedValues("What if I studied for over 6 months?").values[0]).toMatchObject({ value: 6, base: "month", qualifier: { kind: "min", word: "over" } });
  });

  it("a range or a choice is still not read, with or without a hedge", () => {
    expect(readStatedValues("What if I paid between ₹30,000 and ₹40,000 per month?").values).toEqual([]);
    expect(readStatedValues("What if I paid at least ₹30,000 or ₹40,000 per month?").values).toEqual([]);
  });

  it("the quote keeps the hedge into the saved map: the words the user wrote are what is shown", async () => {
    const p = bookstore();
    const q = "What if I opened a bookstore and paid at least ₹35,000 per month in rent?";
    const row = figurePlan(q, p, selectAll(p)).rows.find((r) => r.chosenVariable === "rent")!;
    const ticked = figurePlan(q, p, selectAll(p), { [row.stated.id]: { use: true } });
    const r = await proposalToReality(q, p, selectAll(p), { ...META, figures: appliedFigures(ticked, 0, [true, true]) }, ids);
    expect(r.branches[1]!.values.rent).toBe(35000);
    expect(r.branches[1]!.stated!.rent!.text).toContain("at least");
    expect(knownView(r, r.branches[1]!).values.find((v) => v.variable.key === "rent")!.stated!.text).toMatch(/at least ₹35,000/);
  });

  it("property: a hedge never changes the number and never makes a row pre-ticked", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999_999 }), fc.constantFrom(...HEDGES.map(([w]) => w)), (n, word) => {
        const q = `What if rent was ${word} ₹${grouped(n)} per month?`;
        const v = readStatedValues(q).values;
        expect(v, q).toHaveLength(1);
        expect(v[0]!.value, q).toBe(n);
        expect(v[0]!.qualifier?.word, q).toBe(word);
        const p = bookstore();
        const row = figurePlan(q, p, selectAll(p)).rows.find((r) => r.chosenVariable === "rent")!;
        expect(row.use, q).toBe(false);
        expect(row.status, q).toBe("check");
      }),
      { numRuns: 150 },
    );
  });
});

describe("R20A RV-03: editing the question keeps the user's choices for a figure whose meaning did not change", () => {
  const study = () => r20a("studyMonths");
  const OLD = MISSION_STUDY;
  const NEW = MISSION_STUDY.replace("3 hours", "2 hours");
  const hoursRow = (plan: ReturnType<typeof figurePlan>, value: number) => plan.rows.find((r) => r.chosenVariable === "studyHours" && r.stated.value === value)!;

  it("the problem: without carrying, the corrected figure has no future, is not ticked, and the rest of the panel is still ready", () => {
    const p = study();
    const plain = figurePlan(NEW, p, selectAll(p));
    const two = hoursRow(plain, 2);
    expect(two).toMatchObject({ use: false, target: "none", unplaced: true });
    expect(plain.unplaced.map((r) => r.stated.value)).toEqual([2]);
    expect(plain.warning).toBe("“studied for 2 hours every day” has no future yet, so it will not be used unless you choose one.");
  });

  it("changing only the number keeps the tick and the future, and says so; the future's name is flagged because it still shows the old number", () => {
    const p = study();
    const sel = selectAll(p);
    const carried = carryFigureChoices(OLD, NEW, p, sel, {});
    const after = figurePlan(NEW, p, sel, carried.choices);
    expect(hoursRow(after, 2)).toMatchObject({ use: true, target: 0, unplaced: false, blocked: null });
    expect(after.warning).toBeNull();
    expect(after.ready).toBe(true);
    expect(carried.notes).toEqual([
      "Kept your choices for “studied for 2 hours every day” (it was “studied for 3 hours every day”). It goes in “Study three hours daily”.",
      "The name “Study three hours daily” was written for the earlier number. Check that it still fits, or ask for possibilities that match your new wording.",
    ]);
    // The figure that did not change is left to its own defaults.
    expect(hoursRow(after, 1)).toMatchObject({ use: false, target: 1 });
    // Confirmation is the user's: the carried plan applies nothing until it is confirmed, and then the new number is what is applied.
    expect(appliedFigures(after, 0, [true, true]).find((f) => f.variable === "studyHours")).toMatchObject({ value: 2, future: 0 });
  });

  it("the user's own choices are carried as they were: an unticked figure stays unticked, a future they picked stays", () => {
    const p = study();
    const sel = selectAll(p);
    const old = figurePlan(OLD, p, sel);
    const one = hoursRow(old, 1);
    const three = hoursRow(old, 3);
    const choices = { [three.stated.id]: { use: false }, [one.stated.id]: { use: true, target: 0 as const } };
    const carried = carryFigureChoices(OLD, NEW, p, sel, choices);
    const after = figurePlan(NEW, p, sel, carried.choices);
    expect(hoursRow(after, 2)).toMatchObject({ use: false, unplaced: false });
    expect(hoursRow(after, 1)).toMatchObject({ use: true, target: 0 });
  });

  it("a confirmed plan keeps every resolved choice for the edited figure, and the plan is no longer confirmed by the carry itself", () => {
    const p = study();
    const sel = selectAll(p);
    const old = figurePlan(OLD, p, sel);
    // What confirmFigures stores: every row, resolved.
    const confirmed = Object.fromEntries(old.rows.map((r) => [r.stated.id, { use: r.use, variable: r.chosenVariable, target: r.target }]));
    const carried = carryFigureChoices(OLD, NEW, p, sel, confirmed);
    const after = figurePlan(NEW, p, sel, carried.choices);
    expect(after.rows.map((r) => [r.stated.value, r.use, r.target])).toEqual([[2, true, 0], [1, false, 1], [6, false, "all"]]);
    expect(Object.keys(carried.choices)).toHaveLength(3);
  });

  it("a figure whose unit, period, hedge or words changed is not carried, and the loss is said", () => {
    const p = study();
    const sel = selectAll(p);
    // The user ticked the figure (confirming a plan stores every row's choice the same way).
    const decided = { [hoursRow(figurePlan(OLD, p, sel), 3).stated.id]: { use: true, target: 0 as const } };
    const cases: string[] = [
      OLD.replace("3 hours every day", "3 hours every week"),
      OLD.replace("3 hours every day", "about 3 hours every day"),
      OLD.replace("studied for 3", "slept for 3"),
    ];
    for (const edited of cases) {
      const carried = carryFigureChoices(OLD, edited, p, sel, decided);
      expect(carried.notes.join(" "), edited).toMatch(/Not kept: your choice for “studied for 3 hours every day”/);
      // Whatever the new figure is, it starts from its own defaults: nothing was carried onto it.
      expect(carried.choices, edited).toEqual({});
      const target = figurePlan(edited, p, sel, carried.choices).rows.find((r) => r.stated.value === 3 && r.chosenVariable === "studyHours");
      if (target) expect(target.use, edited).toBe(false);
    }
    // A hedge added is a different statement: the earlier tick never becomes consent to treat "about 3" as exactly 3.
    const hedgedQuestion = OLD.replace("3 hours every day", "about 3 hours every day");
    const hedged = carryFigureChoices(OLD, hedgedQuestion, p, sel, decided);
    expect(figurePlan(hedgedQuestion, p, sel, hedged.choices).rows.find((r) => r.stated.qualifier)!).toMatchObject({ use: false, status: "check" });
  });

  it("figures swapped between the futures follow their numbers, not their position", () => {
    const p = study();
    const sel = selectAll(p);
    const swapped = "What if I studied for 1 hour every day instead of 3 hours for the next 6 months?";
    const carried = carryFigureChoices(OLD, swapped, p, sel, {});
    const after = figurePlan(swapped, p, sel, carried.choices);
    expect(after.rows.filter((r) => r.chosenVariable === "studyHours").map((r) => [r.stated.value, r.target])).toEqual([[1, 1], [3, 0]]);
    // Nothing was pinned, so nothing is claimed as kept.
    expect(carried).toEqual({ choices: {}, notes: [] });
  });

  it("a future that is left out of the draft is said, not dropped: the figure is blocked until the user picks another", () => {
    const p = study();
    const sel = { ...selectAll(p), branches: [false, true] };
    const carried = carryFigureChoices(OLD, NEW, p, selectAll(p), { [hoursRow(figurePlan(OLD, p, selectAll(p)), 3).stated.id]: { use: true, target: 0 } });
    const after = figurePlan(NEW, p, sel, carried.choices);
    expect(hoursRow(after, 2)).toMatchObject({ use: true, blocked: "That future is left out of the draft." });
    expect(after.ready).toBe(false);
  });

  it("property: carrying choices across any edit never throws, only keys figures of the new wording, and never makes a figure used that the user did not tick", () => {
    const piece = fc.oneof(
      fc.constantFrom("what if", "I", "studied", "for", "hours", "every day", "a day", "instead of", "the next", "months", "about", "at least", "or more", "and", "?", ".", "₹", "per month"),
      fc.integer({ min: 0, max: 99 }).map(String),
    );
    const p = r20a("studyMonths");
    const sel = selectAll(p);
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 18 }), fc.array(piece, { maxLength: 18 }), (a, b) => {
        const oldQ = a.join(" ");
        const newQ = b.join(" ");
        const choices = Object.fromEntries(figurePlan(oldQ, p, sel).rows.map((r) => [r.stated.id, { use: false, target: 0 as const }]));
        const carried = carryFigureChoices(oldQ, newQ, p, sel, choices);
        const ids = new Set(readStatedValues(newQ).values.map((v) => v.id));
        for (const id of Object.keys(carried.choices)) expect(ids.has(id), `${oldQ} → ${newQ}`).toBe(true);
        // Everything here was explicitly unticked, so nothing may come back ticked.
        for (const c of Object.values(carried.choices)) expect(c.use ?? false).toBe(false);
        expect(figurePlan(newQ, p, sel, carried.choices).rows.every((r) => !r.use || choices[r.stated.id]?.use !== false)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("the same wording changes nothing; an empty plan carries nothing", () => {
    const p = study();
    const sel = selectAll(p);
    const choices = { [hoursRow(figurePlan(OLD, p, sel), 1).stated.id]: { use: true } };
    expect(carryFigureChoices(OLD, OLD, p, sel, choices)).toEqual({ choices, notes: [] });
    expect(carryFigureChoices(OLD, "What if I studied?", p, sel, {})).toEqual({ choices: {}, notes: [] });
  });
});

describe("R20A RV-03: an offered figure with no future is warned about, never dropped silently", () => {
  it("two figures that no future's name tells apart: both are listed as having no future, the rest stays usable, and each warning goes away when the user decides", () => {
    const p = education();
    p.branches[0]!.name = "Study longer";
    p.branches[1]!.name = "Keep my routine";
    const plan = figurePlan(STUDY, p, selectAll(p));
    const study = plan.rows.filter((r) => r.chosenVariable === "studyHours");
    expect(plan.unplaced.map((r) => r.stated.text)).toEqual(study.map((r) => r.stated.text));
    expect(plan.warning).toBe("2 figures have no future yet, so they will not be used unless you choose one: “studied two hours daily”, “one hour for exams”.");
    expect(plan.ready).toBe(true);
    // Deciding to leave one out is the user's call, and it is no longer a warning.
    const left = figurePlan(STUDY, p, selectAll(p), { [study[0]!.stated.id]: { use: false } });
    expect(left.unplaced.map((r) => r.stated.text)).toEqual(["one hour for exams"]);
    expect(left.warning).toBe("“one hour for exams” has no future yet, so it will not be used unless you choose one.");
    // Choosing a future for each clears it.
    const chosen = figurePlan(STUDY, p, selectAll(p), { [study[0]!.stated.id]: { use: true, target: 0 }, [study[1]!.stated.id]: { use: true, target: 1 } });
    expect(chosen.unplaced).toEqual([]);
    expect(chosen.warning).toBeNull();
  });

  it("a figure that is only waiting to be ticked (it has its future) is not the same thing as one with no future", () => {
    const p = bookstore();
    const plan = figurePlan(BOOKSTORE, p, selectAll(p));
    expect(plan.rows.find((r) => r.chosenVariable === "rent")).toMatchObject({ use: false, target: 0, unplaced: false });
    expect(plan.warning).toBeNull();
  });
});

describe("R20A RV-06: a figure that is shared goes to every future, and the question must show it", () => {
  it("the bookstore example: a budget and a rent written apart from the question are offered for both futures, in plain words", () => {
    const p = r20a("bookstoreStartingBudget");
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    // A budget is something the person has. The rent is expected, and neither draft future reads as not opening the shop.
    expect(plan.rows.map((r) => [r.stated.value, r.scope, r.target, r.use])).toEqual([[500000, "personal", "all", true], [35000, "scenario", "all", true]]);
    expect(plan.rows.map((r) => r.scopeText)).toEqual(["Used in every future in the draft (2).", "Used in every future in the draft (2)."]);
    expect(plan.rows[0]!.scopeWhy).toBe("It is something you have (a budget, savings or what you said you have), so it is the same whichever future you choose.");
    expect(plan.rows[1]!.scopeWhy).toBe("You wrote “expect”, so it follows from what you ask about. No future reads as not doing it, so it goes to every future.");
    expect(appliedFigures(plan, 0, [true, true]).map((f) => [f.variable, f.future])).toEqual([["startingBudget", 0], ["startingBudget", 1], ["monthlyRent", 0], ["monthlyRent", 1]]);
  });

  it("the same facts inside the question itself: the budget is shared either way; the rent is part of what is asked, and goes only to the futures that do it", () => {
    const q = "What if I opened a bookstore with a budget of ₹500,000 and monthly rent of ₹35,000?";
    // Two ways of opening it: nothing reads as not opening, so both get the rent.
    const both = r20a("bookstoreStartingBudget");
    expect(figurePlan(q, both, selectAll(both)).rows.map((r) => [r.stated.value, r.scope, r.target])).toEqual([[500000, "personal", "all"], [35000, "scenario", "all"]]);
    // Opening or not: the rent is not copied to the future that does not open.
    const p = r20a("bookstoreOrNot");
    const plan = figurePlan(q, p, selectAll(p));
    expect(plan.rows.map((r) => [r.stated.value, r.scope, r.target])).toEqual([[500000, "personal", "all"], [35000, "scenario", 0]]);
    expect(plan.rows[1]!.scopeText).toBe("Used only in “Open the bookstore”.");
    expect(plan.rows[1]!.scopeWhy).toBe("It is part of what you are asking about. “Don't open it” reads as not doing it (it starts with “don't”), so it is not copied there. Choose “every future” if it holds there too.");
  });

  it("figures that are part of what is asked about do not spread: the R19 bookstore's amounts go to the future opened only", () => {
    const p = bookstore();
    const plan = figurePlan(BOOKSTORE, p, selectAll(p));
    expect(plan.rows.map((r) => [r.scope, r.target])).toEqual([["scenario", 0], ["scenario", 0], ["scenario", 0]]);
    const ticked = figurePlan(BOOKSTORE, p, selectAll(p), { [plan.rows[1]!.stated.id]: { use: true } });
    expect(new Set(appliedFigures(ticked, 0, [true, true]).map((f) => f.future))).toEqual(new Set([0]));
    // Whichever card is pressed, the shop's amounts stay with the future that opens the shop.
    expect(new Set(appliedFigures(ticked, 1, [true, true]).map((f) => f.future))).toEqual(new Set([0]));
    // "The future I open" is still there to choose: then they follow the card pressed.
    const follow = figurePlan(BOOKSTORE, p, selectAll(p), Object.fromEntries(plan.rows.map((r) => [r.stated.id, { use: true, target: "open" as const }])));
    expect(new Set(appliedFigures(follow, 1, [true, true]).map((f) => f.future))).toEqual(new Set([1]));
  });

  it("a statement written apart from the question but as a possibility belongs to the future that does it, not to the one that stays", () => {
    const p = r20a("relocation");
    for (const q of ["What if I moved to London? My rent would be £2,000 a month.", "What if I moved to London? I'd pay £2,000 a month in rent.", "What if I moved to London? If I do, rent will be £2,000 a month."]) {
      const row = figurePlan(q, p, selectAll(p)).rows[0]!;
      expect(row, q).toMatchObject({ chosenVariable: "monthlyRent", scope: "scenario", target: 0, use: true });
    }
  });

  it("a figure the question compares elsewhere is the same in each compared future; the compared figures stay one per future", () => {
    const p = r20a("studyMonths");
    const plan = figurePlan(MISSION_STUDY, p, selectAll(p));
    const [three, one, months] = plan.rows;
    expect([three!.scope, three!.target, one!.scope, one!.target]).toEqual(["competing", 0, "competing", 1]);
    expect([months!.chosenVariable, months!.scope, months!.target]).toEqual(["horizonMonths", "common", "all"]);
    expect(months!.scopeWhy).toBe("Your question compares other figures, so this one is the same in each future.");
    // Matched by its unit only, so it is the user's to tick; once ticked it goes to both.
    expect(months).toMatchObject({ status: "check", use: false });
    const ticked = figurePlan(MISSION_STUDY, p, selectAll(p), { [months!.stated.id]: { use: true }, [one!.stated.id]: { use: true } });
    expect(appliedFigures(ticked, 0, [true, true]).map((f) => [f.variable, f.value, f.future])).toEqual([
      ["studyHours", 3, 0], ["studyHours", 1, 1], ["horizonMonths", 6, 0], ["horizonMonths", 6, 1],
    ]);
  });

  it("a figure the user places in one future stays there, and the choice is theirs: no reason is given for a place they chose", () => {
    const p = r20a("bookstoreStartingBudget");
    const base = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    const budget = base.rows[0]!;
    const only = figurePlan(MISSION_BOOKSTORE, p, selectAll(p), { [budget.stated.id]: { target: 1 } });
    expect(only.rows[0]).toMatchObject({ target: 1, scopeText: "Used only in “Start online first”.", scopeWhy: null });
    expect(appliedFigures(only, 0, [true, true]).filter((f) => f.variable === "startingBudget").map((f) => f.future)).toEqual([1]);
    const open = figurePlan(MISSION_BOOKSTORE, p, selectAll(p), { [budget.stated.id]: { target: "open" } });
    expect(appliedFigures(open, 0, [true, true]).filter((f) => f.variable === "startingBudget").map((f) => f.future)).toEqual([0]);
  });

  it("only the futures in the draft are used; with one future left there is nothing to choose and nothing is said about scope", () => {
    const p = r20a("bookstoreStartingBudget");
    const sel = { ...selectAll(p), branches: [true, false] };
    const plan = figurePlan(MISSION_BOOKSTORE, p, sel);
    expect(plan.rows.map((r) => [r.target, r.scopeText])).toEqual([["all", ""], ["all", ""]]);
    expect(new Set(appliedFigures(plan, 0, [true, false]).map((f) => f.future))).toEqual(new Set([0]));
  });

  it("an assumption left out of the draft is not offered for any future", () => {
    const p = r20a("bookstoreStartingBudget");
    const sel = { ...selectAll(p), variables: p.variables.map((v) => v.key !== "monthlyRent") };
    expect(figurePlan(MISSION_BOOKSTORE, p, sel).rows.map((r) => r.chosenVariable)).toEqual(["startingBudget"]);
  });

  it("Compare shows the shared facts as the same in both and not as a difference; a figure kept to one future is a difference there", async () => {
    const p = r20a("bookstoreStartingBudget");
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    const shared = await proposalToReality(MISSION_BOOKSTORE, p, selectAll(p), { ...META, figures: appliedFigures(plan, 0, [true, true]) }, ids);
    const [root, physical, online] = shared.branches;
    expect(physical!.values).toMatchObject({ startingBudget: 500000, monthlyRent: 35000 });
    expect(online!.values).toMatchObject({ startingBudget: 500000, monthlyRent: 35000 });
    expect(physical!.sources).toMatchObject({ startingBudget: "user", monthlyRent: "user" });
    expect(online!.stated).toEqual({ startingBudget: { text: "budget of ₹500,000", value: 500000 }, monthlyRent: { text: "expect monthly rent of ₹35,000", value: 35000 } });
    expect(root!.values.startingBudget).toBeNull();
    expect(root!.stated).toBeUndefined();
    const cmp = compareStory(shared, physical!.id, online!.id);
    expect(cmp.differences.map((d) => d.variable.key)).toEqual(["shopFormat"]);
    expect(cmp.sameInBoth.map((s) => [s.variable.key, s.value])).toEqual([["startingBudget", 500000], ["monthlyRent", 35000]]);
    expect(cmp.calculated.map((c) => [c.formula.label, c.a, c.b, c.difference])).toEqual([["Months of rent the budget covers", 500000 / 35000, 500000 / 35000, 0]]);
    expect(cmp.missingForCalculation).toEqual([]);

    // Kept to the future opened, Compare says so: the other future has nothing decided, and the calculation cannot be compared.
    const budgetId = plan.rows[0]!.stated.id;
    const kept = figurePlan(MISSION_BOOKSTORE, p, selectAll(p), { [budgetId]: { target: "open" } });
    const narrow = await proposalToReality(MISSION_BOOKSTORE, p, selectAll(p), { ...META, figures: appliedFigures(kept, 0, [true, true]) }, ids);
    const c2 = compareStory(narrow, narrow.branches[1]!.id, narrow.branches[2]!.id);
    expect(c2.differences.find((d) => d.variable.key === "startingBudget")).toMatchObject({ a: 500000, b: null });
    expect(c2.sameInBoth.map((s) => s.variable.key)).toEqual(["monthlyRent"]);
    expect(c2.missingForCalculation).toEqual(["Starting budget"]);
  });

  it("shared figures survive export and import unchanged, fingerprints included", async () => {
    const p = r20a("bookstoreStartingBudget");
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    const r = await proposalToReality(MISSION_BOOKSTORE, p, selectAll(p), { ...META, figures: appliedFigures(plan, 0, [true, true]) }, ids);
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
  });
});

// =====================================================================================================================
// R20A.1, figure scope. A number the user wrote belongs to the futures it is true in. "Rent there is £2,000" is true where
// the user moves, not where they stay; "I have savings of ₹800,000" is true wherever they end up. The rules are general
// (how the draft's futures read, what the figure's own clause says); none of them knows London, bookstores or rent.
// =====================================================================================================================

import { decideScope, futureRoles, type FutureRole, type ScopeCues } from "../src/reality/scope";

describe("R20A.1: how the futures read", () => {
  const roleOf = (names: string[], asked = "") => {
    const futures = names.map((name) => ({ name, description: "", settings: [] as { variable: string; value: string }[] }));
    const askedStems = new Set(readStatedValues(`${asked} 1`).values[0]?.cues.askedStems ?? []);
    return futureRoles(futures, [], futures.map(() => true), askedStems, (w) => w.toLowerCase(), () => []).map((r) => r.baseline);
  };

  it("a future whose name starts by refusing, staying, keeping or waiting reads as not doing it; any other does", () => {
    const baseline = ["Don't open it", "Do Not Open", "Do nothing", "Stay in Mumbai", "Keep one hour daily", "Keep my routine", "Wait and save more", "No change", "Not now", "Never move", "Current job", "Postpone the move", "As things are", "Status quo"];
    const doing = ["Open the bookstore", "Open without a loan", "Move to London", "Start online first", "Study two hours daily", "Notable change", "Nothing-fancy shop", "Take the job"];
    expect(roleOf(baseline), baseline.join(", ")).toEqual(baseline.map(() => true));
    // "Nothing-fancy shop" starts with "nothing" as a word, so it is the one honest limit of reading names: it is listed here, not hidden.
    expect(roleOf(doing.filter((n) => n !== "Nothing-fancy shop")), doing.join(", ")).toEqual(doing.filter((n) => n !== "Nothing-fancy shop").map(() => false));
  });

  it("a cue only counts at the start: a refusal in the middle of a name is not a refusal", () => {
    expect(roleOf(["Open the shop without staff", "Move now, not later", "Hire help and keep going"])).toEqual([false, false, false]);
  });

  it("a verb the question itself uses is not a cue: for 'What if I stayed in Mumbai?', 'Stay in Mumbai' is the thing asked", () => {
    expect(roleOf(["Stay in Mumbai", "Move to London"], "What if I stayed in Mumbai?")).toEqual([false, false]);
    expect(roleOf(["Stay in Mumbai", "Move to London"], "What if I moved to London?")).toEqual([true, false]);
  });

  it("a description that starts by keeping things as they are marks a future whose name does not say so", () => {
    const f = [{ name: "Option B", description: "You keep things as they are.", settings: [] }, { name: "Option A", description: "You open the shop.", settings: [] }];
    const roles = futureRoles(f, [], [true, true], new Set(), (w) => w, () => []);
    expect(roles.map((r) => [r.baseline, r.cue])).toEqual([[true, "keep things"], [false, null]]);
  });

  it("a yes/no assumption set to 'no' counts only when it names the asked action (the real model's 'Online Partner' for the bookstore)", () => {
    const real = JSON.parse(readFileSync(fileURLToPath(new URL("../../../docs/validation/r19-live-drafts.json", import.meta.url)), "utf8")) as { results: { id: string; question: string; proposal: Proposal }[] };
    const a = real.results.find((r) => r.id === "A")!;
    const plan = figurePlan(a.question, a.proposal, selectAll(a.proposal));
    // Three amounts, every one for the only future that opens a physical store. "Do Not Open" refuses; "Online Partner" sets "Opening the physical store: no".
    expect(plan.rows.map((r) => [r.chosenVariable, r.target])).toEqual([["monthlySales", 0], ["monthlyRent", 0], ["otherExpenses", 0]]);
    expect(plan.rows[1]!.scopeWhy).toContain("“Do Not Open” reads as not doing it (it starts with “do not”); “Online Partner” reads as not doing it (it sets “Opening the physical store: no”)");
    expect(appliedFigures(plan, 1, [true, true, true]).map((f) => f.future)).toEqual([0, 0]);
  });
});

describe("R20A.1: what a figure's own words say", () => {
  const cues = (q: string, at = 0) => readStatedValues(q).values[at]!.cues;
  const pick = (c: ScopeCues) => ({ deictic: c.deictic, current: c.current, expected: c.expected, personal: c.personal, calendar: c.calendar, asked: c.asked });

  it("points back to what is asked, to today, or is an expectation", () => {
    expect(pick(cues("What if I moved? Rent there is £2,000 a month."))).toMatchObject({ deictic: "there", current: null, expected: null, asked: false });
    expect(pick(cues("What if I moved? The new rent is £2,000 a month."))).toMatchObject({ deictic: "new" });
    expect(pick(cues("What if I moved? Rent here is £1,000 a month."))).toMatchObject({ current: "here", deictic: null });
    expect(pick(cues("What if I moved? I currently pay £1,000 a month in rent."))).toMatchObject({ current: "currently" });
    expect(pick(cues("What if I moved? I expect rent of £2,000 a month."))).toMatchObject({ expected: "expect" });
    expect(pick(cues("What if I moved? Rent would be £2,000 a month."))).toMatchObject({ expected: "would" });
    expect(pick(cues("What if I moved? If I do, rent is £2,000 a month."))).toMatchObject({ expected: "if" });
  });

  it("something the person has, and a countdown to a date, are shared kinds of statement", () => {
    expect(cues("What if I moved? I have savings of £10,000.").personal).toBe(true);
    expect(cues("What if I moved? My budget is £10,000.").personal).toBe(true);
    expect(cues("What if I moved? I've got £10,000.").personal).toBe(true);
    expect(cues("What if I studied more? The exams are four weeks away.").calendar).toBe(true);
    expect(cues("What if I studied more? I have 3 days left.").calendar).toBe(true);
    expect(cues("What if I moved? Rent is £2,000 a month.").personal).toBe(false);
  });

  it("the sentence that asks is not read as a possibility just because it says 'if'; 'May' the month is not 'may'", () => {
    expect(cues("What if I paid £500 rent?").expected).toBeNull();
    expect(cues("What if I moved? I pay £500 in May.").expected).toBeNull();
    expect(cues("What if I moved? Rent may be £500.").expected).toBe("may");
  });

  it("each figure is read from its own clause: in 'I have a budget of ₹500,000 and expect monthly rent of ₹35,000' the budget is the person's and the rent is expected", () => {
    const v = readStatedValues(MISSION_BOOKSTORE).values;
    expect(v.map((x) => [x.value, x.cues.personal, x.cues.expected])).toEqual([[500000, true, null], [35000, false, "expect"]]);
  });

  it("the words of its clause (stems) leave out numbers, units, hedges and function words, so editing a number never changes them", () => {
    const stems = (q: string) => readStatedValues(q).values[0]!.cues.stems;
    expect(stems("What if I moved? Rent there is £2,000 a month.")).toEqual(["rent"]);
    expect(stems("What if I moved? Rent there is £2,500 a month.")).toEqual(stems("What if I moved? Rent there is £2,000 a month."));
    expect(stems("What if I studied three hours daily?")).toEqual(stems("What if I studied two hours daily?"));
  });
});

describe("R20A.1: a figure goes only to the futures it applies to", () => {
  const place = (plan: ReturnType<typeof figurePlan>) => plan.rows.map((r) => [r.stated.value, r.scope, r.target, r.use]);
  const MOVE = "What if I moved to London?";

  // ---- 1. Moving to a city versus staying ----
  it("1. 'Rent there is £2,000 a month' belongs to London, not to the future where the user stays, and the plan says why", () => {
    const p = r20a("relocation");
    const plan = figurePlan(`${MOVE} Rent there is £2,000 a month.`, p, selectAll(p));
    expect(place(plan)).toEqual([[2000, "scenario", 0, true]]);
    expect(plan.rows[0]!.scopeText).toBe("Used only in “Move to London”.");
    // "London" is a word only that future's name has, and the question uses it, so "there" is London.
    expect(plan.rows[0]!.scopeWhy).toBe("“there” points to what you ask about, which “Move to London” describes.");
    for (const focus of [0, 1]) expect(appliedFigures(plan, focus, [true, true]).map((f) => f.future)).toEqual([0]);
  });

  it("1. when no word of the question tells the futures apart, 'there' still goes only to the one that does it, and the other is named as not doing it", () => {
    const p = r20a("relocation");
    const plan = figurePlan("What if I changed city? Rent there is £2,000 a month.", p, selectAll(p));
    expect(place(plan)).toEqual([[2000, "scenario", 0, true]]);
    expect(plan.rows[0]!.scopeWhy).toBe("“there” points to what you ask about, so it goes only to “Move to London”. “Stay in Mumbai” reads as not doing it (it starts with “stay”), so it is not copied there.");
  });

  it("1. 'Rent here' points to today, so it goes to the future that keeps things as they are", () => {
    const p = r20a("relocation");
    const plan = figurePlan(`${MOVE} Rent here is £1,000 a month.`, p, selectAll(p));
    expect(place(plan)).toEqual([[1000, "current", 1, true]]);
    expect(plan.rows[0]!.scopeWhy).toBe("“here” points to how things are today, so it goes to “Stay in Mumbai”, which reads as keeping things as they are.");
  });

  it("1. a figure that names a place goes to the future whose name has that word and not the other", () => {
    const p = r20a("relocation");
    const plan = figurePlan(`${MOVE} In London rent is £2,000 a month.`, p, selectAll(p));
    expect(place(plan)).toEqual([[2000, "named", 0, true]]);
    expect(plan.rows[0]!.scopeWhy).toBe("Your words name “Move to London” and not the other future.");
  });

  it("1. 'there' means the place asked about, even when the user asks about staying", () => {
    const p = r20a("relocation");
    // The question is about staying, so "Stay in Mumbai" is the thing asked (its verb is the question's own), and "there" points to it.
    const plan = figurePlan("What if I stayed in Mumbai? Rent there is £1,000 a month.", p, selectAll(p));
    expect(place(plan)).toEqual([[1000, "scenario", 1, true]]);
  });

  // ---- 2. Starting a business versus not starting ----
  it("2. a business: savings are the person's and go to both; the office cost follows from starting, so it does not go to staying employed", () => {
    const p = r20a("startupOrNot");
    const plan = figurePlan("What if I started a company? I have savings of ₹800,000 and expect an office to cost ₹40,000 a month.", p, selectAll(p));
    expect(place(plan)).toEqual([[800000, "personal", "all", true], [40000, "scenario", 0, true]]);
    expect(plan.rows[1]!.scopeWhy).toBe("You wrote “expect”, so it follows from what you ask about. “Stay employed” reads as not doing it (it starts with “stay”), so it is not copied there. Choose “every future” if it holds there too.");
    expect(appliedFigures(plan, 1, [true, true]).map((f) => [f.variable, f.future])).toEqual([["savings", 0], ["savings", 1], ["officeCost", 0]]);
  });

  it("2. the mission's bookstore example with a future that does not open: the budget goes to both, the rent only to the future that opens", () => {
    const p = r20a("bookstoreOrNot");
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    expect(place(plan)).toEqual([[500000, "personal", "all", true], [35000, "scenario", 0, true]]);
    expect(plan.rows[1]!.scopeText).toBe("Used only in “Open the bookstore”.");
    expect(plan.rows[1]!.placement.except).toEqual(["Don't open it"]);
  });

  // ---- 3. Two alternatives sharing the same baseline budget ----
  it("3. two ways of doing it share the budget, and the rent too when neither reads as not doing it", () => {
    const p = r20a("bookstoreStartingBudget");
    expect(place(figurePlan(MISSION_BOOKSTORE, p, selectAll(p)))).toEqual([[500000, "personal", "all", true], [35000, "scenario", "all", true]]);
    const h = r20a("housing");
    const plan = figurePlan("What if I rented a flat or bought one? I have savings of ₹300,000.", h, selectAll(h));
    expect(place(plan)).toEqual([[300000, "personal", "all", true]]);
  });

  // ---- 4. Two alternatives with different recurring expenses ----
  const HOUSING = "What if I rented a flat or bought one? I have savings of ₹300,000. Rent would be ₹20,000 a month, while the loan payment would be ₹15,000 a month.";
  it("4. one expense is named for its alternative; the other names none, so the user chooses instead of the draft guessing", () => {
    const p = r20a("housing");
    const plan = figurePlan(HOUSING, p, selectAll(p));
    expect(place(plan)).toEqual([[300000, "personal", "all", true], [20000, "named", 0, true], [15000, "unclear", "none", false]]);
    expect(plan.rows[1]!.scopeWhy).toBe("Your words name “Rent a flat” and not the other future.");
    expect(plan.rows[2]!.scopeWhy).toBe("Other figures in your question belong to one future each, so it is unclear whether this one is the same in all of them. Choose where to use it.");
    // It is said before confirming, and the rest can still be used.
    expect(plan.warning).toBe("“loan payment would be ₹15,000 a month” has no future yet, so it will not be used unless you choose one.");
    expect(plan.ready).toBe(true);
    // The user's choice puts it where they say; the other expense stays where it was named.
    const chosen = figurePlan(HOUSING, p, selectAll(p), { [plan.rows[2]!.stated.id]: { use: true, target: 1 } });
    expect(chosen.warning).toBeNull();
    expect(appliedFigures(chosen, 0, [true, true]).map((f) => [f.variable, f.future])).toEqual([["savings", 0], ["savings", 1], ["monthlyRent", 0], ["monthlyLoan", 1]]);
  });

  // ---- 5 and 6. One sentence or separate sentences ----
  it("5/6. the same facts in one sentence or in separate sentences are placed the same way", () => {
    const p = r20a("bookstoreOrNot");
    const apart = place(figurePlan(MISSION_BOOKSTORE, p, selectAll(p)));
    const together = place(figurePlan("What if I opened a bookstore with a budget of ₹500,000 and monthly rent of ₹35,000?", p, selectAll(p)));
    expect(together.map((r) => [r[0], r[2]])).toEqual(apart.map((r) => [r[0], r[2]]));
    expect(together).toEqual([[500000, "personal", "all", true], [35000, "scenario", 0, true]]);
  });

  // ---- 7. Figures that refer to one alternative ----
  it("7. 'The shop would cost …' names the shop, so it goes to the future that has one", () => {
    const p = r20a("bookstoreStartingBudget");
    const plan = figurePlan("What if I opened a physical shop or sold online? The shop would cost ₹35,000 a month in rent.", p, selectAll(p));
    expect(place(plan)).toEqual([[35000, "named", 0, true]]);
  });

  it("7. a word that every future's name has ties a figure to none of them", () => {
    const p = r20a("relocation");
    // Both names contain "move" or neither does for this stem: "Move to London" has it, "Stay in Mumbai" does not, so it IS distinctive; check the shared case with a draft whose names share it.
    const same = structuredClone(p);
    same.branches[1]!.name = "Move to Mumbai";
    const plan = figurePlan("What if I moved? The move costs £500 a month in rent.", same, selectAll(same));
    expect(plan.rows[0]!.scope).not.toBe("named");
  });

  // ---- 8. Ambiguous figures with no trustworthy default ----
  it("8. a plain fact in a draft that has a future that does not do it is not placed: nothing is ticked and the user is told", () => {
    const p = r20a("relocation");
    const plan = figurePlan(`${MOVE} Rent is £2,000 a month.`, p, selectAll(p));
    expect(place(plan)).toEqual([[2000, "unclear", "none", false]]);
    expect(plan.rows[0]!.scopeWhy).toBe("Your question does not say whether it holds if you do it or not. Choose where to use it.");
    expect(plan.rows[0]).toMatchObject({ unplaced: true, scopeText: "" });
    expect(plan.warning).toBe("“Rent is ₹2,000 a month”".replace("₹", "£") + " has no future yet, so it will not be used unless you choose one.");
    expect(plan.ready).toBe(false);
    expect(appliedFigures(plan, 0, [true, true])).toEqual([]);
    // Only the user's choice makes it usable.
    const chosen = figurePlan(`${MOVE} Rent is £2,000 a month.`, p, selectAll(p), { [plan.rows[0]!.stated.id]: { use: true, target: 0 } });
    expect(chosen.ready).toBe(true);
    expect(appliedFigures(chosen, 0, [true, true]).map((f) => f.future)).toEqual([0]);
  });

  it("8. choosing a future for an unplaced figure is the decision it was waiting for: it is then ticked, an explicit untick still wins, and a hedge still needs its own tick", () => {
    const p = r20a("relocation");
    const q = `${MOVE} Rent is £2,000 a month.`;
    const id = figurePlan(q, p, selectAll(p)).rows[0]!.stated.id;
    // Choosing the place alone (no tick) is enough: the panel says "will not be used unless you choose one", so choosing must work.
    const chosen = figurePlan(q, p, selectAll(p), { [id]: { target: 0 } });
    expect(chosen.rows[0]).toMatchObject({ use: true, target: 0, unplaced: false, blocked: null, scopeText: "Used only in “Move to London”.", scopeWhy: null });
    expect(chosen.warning).toBeNull();
    expect(chosen.ready).toBe(true);
    expect(appliedFigures(chosen, 1, [true, true]).map((f) => f.future)).toEqual([0]);
    // "No future" is not a choice, and an explicit untick is the user's last word.
    expect(figurePlan(q, p, selectAll(p), { [id]: { target: "none" } }).rows[0]).toMatchObject({ use: false, unplaced: true });
    expect(figurePlan(q, p, selectAll(p), { [id]: { target: 0, use: false } }).rows[0]).toMatchObject({ use: false, unplaced: false });
    // A hedged amount is exact only when the user ticks it, wherever it goes.
    const hedged = `${MOVE} Rent is at least £2,000 a month.`;
    const hid = figurePlan(hedged, p, selectAll(p)).rows[0]!.stated.id;
    expect(figurePlan(hedged, p, selectAll(p), { [hid]: { target: 0 } }).rows[0]).toMatchObject({ use: false, status: "check" });
  });

  it("8. wording that points two ways is not placed either: 'my savings there' is both the person's and the place's", () => {
    const p = r20a("startupOrNot");
    for (const q of ["What if I started a company? My savings there are ₹800,000.", "What if I started a company? I now have savings of ₹800,000.", "What if I started a company? I expect to have savings of ₹800,000."]) {
      const rows = figurePlan(q, p, selectAll(p)).rows;
      expect(rows.length, q).toBeGreaterThan(0);
      expect(rows[0], q).toMatchObject({ scope: "unclear", target: "none", use: false });
    }
  });

  it("8. 'here' with no future that keeps things as they are is not guessed", () => {
    const p = r20a("bookstoreStartingBudget");
    const row = figurePlan("What if I opened a bookstore? Rent here is ₹30,000 a month.", p, selectAll(p)).rows[0]!;
    expect(row).toMatchObject({ scope: "unclear", target: "none", use: false });
    expect(row.scopeWhy).toBe("“here” points to how things are today, but no future reads as keeping things as they are. Choose where to use it.");
  });

  it("8. 'there' with two futures that both do it, and no word that tells them apart, is not guessed", () => {
    const p = structuredClone(r20a("bookstoreStartingBudget"));
    p.branches[1]!.name = "Open an online shop";
    p.possibilities = p.possibilities.map((x) => ({ ...x, branch: x.branch === "Start online first" ? "Open an online shop" : x.branch }));
    const row = figurePlan("What if I opened a bookstore? Rent there is ₹35,000 a month.", p, selectAll(p)).rows[0]!;
    expect(row).toMatchObject({ scope: "unclear", target: "none", use: false });
    expect(row.scopeWhy).toBe("“there” could point to more than one future. Choose where to use it.");
  });

  // ---- shared kinds stay shared ----
  it("a countdown and a figure the question compares elsewhere are the same in every future, even when one future keeps things as they are", () => {
    const p = r20a("studyMonths");
    const plan = figurePlan("What if I studied for 3 hours every day instead of 1 hour for exams four weeks away?", p, selectAll(p));
    const weeks = plan.rows.find((r) => r.stated.base === "week");
    // No assumption in this draft counts weeks, so it is offered nowhere; the countdown rule itself is shown on the study draft with weeks.
    expect(weeks).toBeUndefined();
    const edu = education();
    const countdown = figurePlan(STUDY, edu, selectAll(edu)).rows.find((r) => r.chosenVariable === "weeksToExams")!;
    expect(countdown).toMatchObject({ scope: "calendar", target: "all" });
    expect(countdown.scopeWhy).toBe("It counts down to a date, which is the same in every future.");
  });

  it("a set of futures is a first-class place: a draft with two that do it and one that does not gives the first two, and the plan can say it", () => {
    // A draft the validator accepts: two futures that open the shop in different ways (a street shop, an online shop) and one that does not.
    const p = r20a("bookstoreTwoWaysOrNot");
    expect(validateProposal(p)).toMatchObject({ ok: true });
    expect(p.branches.map((b) => b.name)).toEqual(["Open a street shop", "Don't open it", "Open an online shop"]);
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    const rent = plan.rows.find((r) => r.chosenVariable === "monthlyRent")!;
    expect(rent.target).toEqual([0, 2]);
    expect(rent.scopeText).toBe("Used in every future except “Don't open it”.");
    expect(appliedFigures(plan, 1, [true, true, true]).filter((f) => f.variable === "monthlyRent").map((f) => f.future)).toEqual([0, 2]);
    // The user can still choose any one, every future, or the same set again.
    const one = figurePlan(MISSION_BOOKSTORE, p, selectAll(p), { [rent.stated.id]: { target: 2 } });
    expect(one.rows.find((r) => r.chosenVariable === "monthlyRent")!.scopeText).toBe("Used only in “Open an online shop”.");
    // Two ticked figures for one assumption cannot overlap in a set, and a set with a future left out is blocked, not trimmed.
    const left = figurePlan(MISSION_BOOKSTORE, p, { ...selectAll(p), branches: [true, true, false] });
    expect(left.rows.find((r) => r.chosenVariable === "monthlyRent")!.target).toBe(0);
    const stale = figurePlan(MISSION_BOOKSTORE, p, { ...selectAll(p), branches: [true, true, false] }, { [rent.stated.id]: { use: true, target: [0, 2] } });
    expect(stale.rows.find((r) => r.chosenVariable === "monthlyRent")).toMatchObject({ blocked: "That future is left out of the draft." });
    expect(stale.ready).toBe(false);
  });
});

describe("R20A.1: editing the question never carries a choice of place onto a statement that now means something else", () => {
  const MOVE = "What if I moved to London?";
  const SHARED = `${MOVE} I have a budget of £2,000 a month for rent.`;
  const SPECIFIC = `${MOVE} My rent there would be £2,000 a month.`;
  const rentRow = (plan: ReturnType<typeof figurePlan>) => plan.rows.find((r) => r.chosenVariable === "monthlyRent")!;
  /** What confirming stores: every row, resolved. */
  const confirmedOf = (q: string, p: Proposal, sel = selectAll(p)) => Object.fromEntries(figurePlan(q, p, sel).rows.map((r) => [r.stated.id, { use: r.use, variable: r.chosenVariable, target: r.target }]));

  it("9. a shared figure edited into one about London does not keep 'every future'; it is placed by its new wording", () => {
    const p = r20a("relocation");
    expect(rentRow(figurePlan(SHARED, p, selectAll(p)))).toMatchObject({ scope: "personal", target: "all" });
    const carried = carryFigureChoices(SHARED, SPECIFIC, p, selectAll(p), confirmedOf(SHARED, p));
    expect(carried.choices).toEqual({});
    expect(carried.notes.join(" ")).toMatch(/Not kept: your choice for “£2,000 a month for rent”/);
    expect(rentRow(figurePlan(SPECIFIC, p, selectAll(p), carried.choices))).toMatchObject({ scope: "scenario", target: 0, use: true });
  });

  it("10. a figure about London edited into one the person has does not keep 'Move to London'; it is placed by its new wording", () => {
    const p = r20a("relocation");
    expect(rentRow(figurePlan(SPECIFIC, p, selectAll(p)))).toMatchObject({ scope: "scenario", target: 0 });
    const carried = carryFigureChoices(SPECIFIC, SHARED, p, selectAll(p), confirmedOf(SPECIFIC, p));
    expect(carried.choices).toEqual({});
    expect(carried.notes.join(" ")).toMatch(/Not kept: your choice for “My rent there would be £2,000 a month”|Not kept: your choice for “rent there would be £2,000 a month”/);
    expect(rentRow(figurePlan(SHARED, p, selectAll(p), carried.choices))).toMatchObject({ scope: "personal", target: "all" });
  });

  it("'there' changed to 'here' is a different statement: the choice of London is not moved onto the future that stays", () => {
    const p = r20a("relocation");
    const there = `${MOVE} Rent there is £2,000 a month.`;
    const here = `${MOVE} Rent here is £2,000 a month.`;
    const carried = carryFigureChoices(there, here, p, selectAll(p), confirmedOf(there, p));
    expect(carried.choices).toEqual({});
    expect(rentRow(figurePlan(here, p, selectAll(p), carried.choices))).toMatchObject({ scope: "current", target: 1 });
  });

  it("changing only the number keeps a shared choice, a place choice and an explicit narrowing", () => {
    const p = r20a("relocation");
    for (const [q, edited, target] of [[SHARED, SHARED.replace("2,000", "2,500"), "all"], [`${MOVE} Rent there is £2,000 a month.`, `${MOVE} Rent there is £2,500 a month.`, 0]] as const) {
      const carried = carryFigureChoices(q, edited, p, selectAll(p), confirmedOf(q, p));
      const after = rentRow(figurePlan(edited, p, selectAll(p), carried.choices));
      expect(after, edited).toMatchObject({ use: true, target });
      expect(after.stated.value, edited).toBe(2500);
    }
    // A narrowing the user chose themselves stays through a number edit.
    const narrow = { [rentRow(figurePlan(SHARED, p, selectAll(p))).stated.id]: { use: true, target: 1 as const } };
    const carried = carryFigureChoices(SHARED, SHARED.replace("2,000", "2,500"), p, selectAll(p), narrow);
    expect(rentRow(figurePlan(SHARED.replace("2,000", "2,500"), p, selectAll(p), carried.choices))).toMatchObject({ use: true, target: 1 });
  });

  it("an earlier default is only pinned for figures that compete (their place depends on the number); never onto a figure whose place comes from its words", () => {
    const p = r20a("relocation");
    // Unclear before and after: nothing to pin, nothing is invented for the edited figure.
    const q = `${MOVE} Rent is £2,000 a month.`;
    const carried = carryFigureChoices(q, q.replace("2,000", "2,500"), p, selectAll(p), {});
    expect(carried).toEqual({ choices: {}, notes: [] });
    expect(rentRow(figurePlan(q.replace("2,000", "2,500"), p, selectAll(p), carried.choices))).toMatchObject({ target: "none", use: false });
  });

  it("editing the sentence that asks, with the figure's own words unchanged, does not replay the old proposal: 'there' now points elsewhere, and the move is said", () => {
    const p = r20a("relocation");
    const there = "Rent there is £2,000 a month.";
    const before = `${MOVE} ${there}`;
    const after = `What if I stayed in Mumbai? ${there}`;
    expect(rentRow(figurePlan(before, p, selectAll(p)))).toMatchObject({ target: 0 });
    // After a confirmation the stored plan holds every row as resolved, including the place the OLD wording proposed.
    const carried = carryFigureChoices(before, after, p, selectAll(p), confirmedOf(before, p));
    const shown = rentRow(figurePlan(after, p, selectAll(p), carried.choices));
    expect(shown).toMatchObject({ target: 1, use: true, scopeText: "Used only in “Stay in Mumbai”." });
    expect(carried.choices[shown.stated.id]!.target).toBeUndefined();
    expect(carried.notes).toEqual(["Changed: “Rent there is £2,000 a month” was used in “Move to London”; with your new wording it goes in “Stay in Mumbai”. Check that this is right."]);
    // Nothing is said when nothing moved: an edit that leaves the place where it was reports nothing and keeps it.
    const kept = `What if I moved to London next year? ${there}`;
    const same = carryFigureChoices(before, kept, p, selectAll(p), confirmedOf(before, p));
    expect(rentRow(figurePlan(kept, p, selectAll(p), same.choices))).toMatchObject({ target: 0, use: true });
    expect(same.notes).toEqual([]);
    // When the new wording no longer says where it holds ("there" is gone), it is a different statement: the old place is not
    // carried, the loss is said, and the figure is left for the user to place, never given the old place or a guess.
    const vague = `What if I moved to London? Rent is £2,000 a month.`;
    const asked = carryFigureChoices(before, vague, p, selectAll(p), confirmedOf(before, p));
    expect(asked.choices).toEqual({});
    expect(asked.notes).toEqual(["Not kept: your choice for “Rent there is £2,000 a month”. That figure now means something else, or is no longer in your question."]);
    expect(rentRow(figurePlan(vague, p, selectAll(p), asked.choices))).toMatchObject({ target: "none", use: false, unplaced: true });
  });

  it("a place the user chose themselves, different from what the draft proposed, stays through an edit of the sentence that asks", () => {
    const p = r20a("relocation");
    const before = `${MOVE} Rent is £2,000 a month.`;
    const after = "What if I stayed in Mumbai? Rent is £2,000 a month.";
    // The draft could not place it (unclear); the user picked London. That is a decision, not a proposal.
    const id = rentRow(figurePlan(before, p, selectAll(p))).stated.id;
    const carried = carryFigureChoices(before, after, p, selectAll(p), { [id]: { use: true, target: 0 } });
    expect(rentRow(figurePlan(after, p, selectAll(p), carried.choices))).toMatchObject({ target: 0, use: true });
    // An explicit untick is always kept, whatever the new wording proposes.
    const unticked = carryFigureChoices(before, after, p, selectAll(p), { [id]: { use: false } });
    expect(rentRow(figurePlan(after, p, selectAll(p), unticked.choices))).toMatchObject({ use: false });
  });

  it("figures that compete swap places with their numbers after a confirmation: each follows the name that says it, not its position, and the move is said", () => {
    const p = r20a("studyMonths");
    const before = MISSION_STUDY;
    const swapped = "What if I studied for 1 hour every day instead of 3 hours for the next 6 months?";
    const carried = carryFigureChoices(before, swapped, p, selectAll(p), confirmedOf(before, p));
    const rows = figurePlan(swapped, p, selectAll(p), carried.choices).rows.filter((r) => r.chosenVariable === "studyHours");
    // 1 hour belongs to "Keep one hour daily" (future 1) and 3 hours to "Study three hours daily" (future 0), as the names say.
    expect(rows.map((r) => [r.stated.value, r.target])).toEqual([[1, 1], [3, 0]]);
    expect(rows[0]).toMatchObject({ use: true });
    expect(carried.notes[0]).toMatch(/^Changed: “studied for 1 hour every day” \(it was “studied for 3 hours every day”\) was used in “Study three hours daily”; with your new wording it goes in “Keep one hour daily”\./);
    // The same place is not described twice.
    expect(carried.notes.filter((n) => n.includes("studied for 1 hour every day"))).toHaveLength(1);
  });
});

describe("R20A.1: Compare says what is shared, what differs and what is still unknown", () => {
  it("a draft with a future that does not open: the budget is the same in both, the rent differs, and the calculation names what is missing", async () => {
    const p = r20a("bookstoreOrNot");
    const plan = figurePlan(MISSION_BOOKSTORE, p, selectAll(p));
    const r = await proposalToReality(MISSION_BOOKSTORE, p, selectAll(p), { ...META, figures: appliedFigures(plan, 1, [true, true]) }, ids);
    const open = r.branches.find((b) => b.name === "Open the bookstore")!;
    const not = r.branches.find((b) => b.name === "Don't open it")!;
    expect(open.values).toMatchObject({ startingBudget: 500000, monthlyRent: 35000 });
    expect(not.values).toMatchObject({ startingBudget: 500000, monthlyRent: null });
    const cmp = compareStory(r, open.id, not.id);
    expect(cmp.sameInBoth.map((s) => s.variable.key)).toEqual(["startingBudget"]);
    expect(cmp.differences.map((d) => [d.variable.key, d.a, d.b])).toEqual([["openShop", true, false], ["monthlyRent", 35000, null]]);
    expect(cmp.missingForCalculation).toEqual(["Monthly rent"]);
    // Provenance and ancestry are those of the content: the starting point is untouched and everything survives export and import.
    expect(r.branches[0]!.values.startingBudget).toBeNull();
    expect(open.parentId).toBe(r.branches[0]!.id);
    expect(not.sources).toMatchObject({ startingBudget: "user", openShop: "ai" });
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
  });

  it("different recurring expenses: each belongs to its own alternative, the savings are the same in both, and nothing is invented for the other side", async () => {
    const p = r20a("housing");
    const plan = figurePlan(HOUSING_Q, p, selectAll(p));
    const chosen = figurePlan(HOUSING_Q, p, selectAll(p), { [plan.rows[2]!.stated.id]: { use: true, target: 1 } });
    const r = await proposalToReality(HOUSING_Q, p, selectAll(p), { ...META, figures: appliedFigures(chosen, 0, [true, true]) }, ids);
    const rent = r.branches.find((b) => b.name === "Rent a flat")!;
    const buy = r.branches.find((b) => b.name === "Buy a flat")!;
    expect([rent.values.monthlyRent, rent.values.monthlyLoan, buy.values.monthlyRent, buy.values.monthlyLoan]).toEqual([20000, null, null, 15000]);
    const cmp = compareStory(r, rent.id, buy.id);
    expect(cmp.sameInBoth.map((s) => [s.variable.key, s.value])).toEqual([["savings", 300000]]);
    expect(cmp.differences.map((d) => [d.variable.key, d.a, d.b])).toEqual([["tenure", "renting", "owning"], ["monthlyRent", 20000, null], ["monthlyLoan", null, 15000]]);
    expect(cmp.unknownInBoth).toEqual([]);
  });
});

const HOUSING_Q = "What if I rented a flat or bought one? I have savings of ₹300,000. Rent would be ₹20,000 a month, while the loan payment would be ₹15,000 a month.";

describe("R20A.1: invariants of placement", () => {
  it("property: whatever the wording and the draft, a figure is never applied to a future that is not in the draft, a set is ascending with at least two, and 'unclear' is never ticked", () => {
    const names = ["Open the shop", "Don't open it", "Move to London", "Stay put", "Keep my routine", "Start online first", "Wait and see", "Rent a flat"];
    const piece = fc.constantFrom("what if", "I", "moved", "opened", "rent", "there", "here", "now", "new", "expect", "would", "if", "I have", "my budget", "savings", "is", "of", "and", ".", "?", ",", "£2,000", "₹35,000", "a month", "per month", "4 weeks away", "at least", "about");
    const draft = (picked: string[]) => {
      const p = structuredClone(r20a("relocation"));
      p.branches = picked.map((name, i) => ({ name: `${name}${i}`.replace(/\d/g, ""), description: "x", settings: [] }));
      p.possibilities = [];
      return p;
    };
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 16 }), fc.uniqueArray(fc.constantFrom(...names), { minLength: 2, maxLength: 4 }), fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }), (parts, picked, keepFlags) => {
        const q = parts.join(" ");
        const p = draft(picked);
        const kept = picked.map((_, i) => keepFlags[i] ?? true);
        const sel = { ...selectAll(p), branches: kept };
        const plan = figurePlan(q, p, sel);
        for (const row of plan.rows) {
          const t = row.target;
          if (Array.isArray(t)) {
            expect(t.length, q).toBeGreaterThanOrEqual(2);
            expect([...t].sort((a, b) => a - b), q).toEqual(t);
            expect(t.every((i) => kept[i]), q).toBe(true);
          }
          if (typeof t === "number") expect(kept[t] ?? false, q).toBe(true);
          if (row.scope === "unclear") expect([row.use, t], q).toEqual([false, "none"]);
        }
        const included = kept;
        for (const f of appliedFigures(plan, undefined, included)) expect(included[f.future], q).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
