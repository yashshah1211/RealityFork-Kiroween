/**
 * Live-test fix: amounts written with a scale word ("₹5 lakh") are read exactly, by the one typed-amount policy, keep
 * the user's own words and are used only after the user confirms; a figure no assumption can hold is reported, never
 * dropped. The draft is a sanitized reconstruction of the live Groq reply (web/e2e/fixtures/live-gaming-mumbai.json).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { MAX_AMOUNT, parseNumberInput } from "../src/reality/amounts";
import { appliedFigures, figurePlan, readStatedValues } from "../src/reality/stated";
import { proposalToReality, selectAll, validateProposal, type Proposal } from "../src/reality/proposal";

const live = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/live-gaming-mumbai.json", import.meta.url)), "utf8")) as { question: string; proposal: Proposal };
const QUESTION = live.question;
const draft = () => {
  const v = validateProposal(live.proposal);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.proposal;
};
/** The same draft without an assumption that can hold an amount of savings. */
const withoutSavings = (): Proposal => {
  const p = structuredClone(draft());
  p.variables = p.variables.filter((v) => v.key !== "savings");
  p.formulas = [];
  p.possibilities = p.possibilities.filter((x) => !x.about.includes("savings"));
  return p;
};
const value = (raw: string, unit = "") => {
  const r = parseNumberInput(raw, unit);
  return r.ok ? r.value : `refused: ${r.message}`;
};

describe("a scale word written out is read exactly, by the typed-amount policy", () => {
  it("lakh, crore, thousand, million and billion move the decimal point; nothing is rounded", () => {
    expect(value("5 lakh", "₹")).toBe(500000);
    expect(value("₹5 lakh", "₹")).toBe(500000);
    expect(value("5 lakhs", "₹")).toBe(500000);
    expect(value("₹ 2 lac", "₹")).toBe(200000);
    // 1.1 × 100000 in binary floating point is 110000.00000000001; the decimal point is moved instead.
    expect(1.1 * 100000).not.toBe(110000);
    expect(value("1.1 lakh", "₹")).toBe(110000);
    expect(value("2.75 crore", "₹")).toBe(27500000);
    expect(value("1,234.5 thousand")).toBe(1234500);
    expect(value("20 thousand")).toBe(20000);
    expect(value("$2 million", "$")).toBe(2000000);
    expect(value("3.25 billion")).toBe(3250000000);
    expect(value("0.5 Lakh")).toBe(50000);
  });
  it("the number before the word is held to the same rules, and nothing else is guessed", () => {
    expect(value("1.500 lakh")).toMatch(/^refused: “1\.500 lakh” could mean 1\.5 lakh or 1500 lakh/);
    expect(value("1,5 lakh")).toMatch(/^refused: .*comma that does not separate thousands/);
    for (const short of ["20k", "20 k", "5 L", "2 cr", "3 mn", "1 bn", "5lakh", "lakh", "five lakh", "3 hundred", "2 dozen"]) expect(value(short), short).toMatch(/^refused:/);
    // A different currency is still refused, and so is a symbol on a field with none.
    expect(value("£5 lakh", "₹")).toMatch(/^refused: This is in ₹/);
    expect(value("₹5 lakh", "")).toMatch(/^refused: .*has no currency/);
    // Still below the largest amount RealityFork calculates with.
    expect(value("100 billion")).toBe(1e11);
    expect(value(`${MAX_AMOUNT / 1e7} crore`)).toMatch(/^refused: .*larger than RealityFork can calculate/);
  });
});

describe("the live question: “₹5 lakh in savings”", () => {
  it("is read from the question as ₹500,000, in the user's own words, as a lump sum", () => {
    const read = readStatedValues(QUESTION);
    expect(read.values.map((v) => [v.text, v.value, v.currency, v.period, v.lumpSum, v.scale])).toEqual([
      ["₹5 lakh in savings", 500000, "₹", null, true, { word: "lakh", written: "₹5 lakh" }],
    ]);
    expect(read.unclear).toEqual([]);
  });
  it("is offered for “Savings available” with how it was read, and nothing is applied before the user confirms", () => {
    const p = draft();
    const plan = figurePlan(QUESTION, p, selectAll(p));
    expect(plan.offer).toBe(true);
    expect(plan.rows.map((r) => [r.stated.text, r.stated.value, r.chosenVariable])).toEqual([["₹5 lakh in savings", 500000, "savings"]]);
    expect(plan.rows[0]!.notes).toContain("You wrote “₹5 lakh”: read as ₹500,000 (1 lakh is 100,000).");
    expect(plan.unused).toEqual([]);
  });
  it("after confirmation it becomes the user's figure, with their words, on the futures chosen; without it every number stays unknown", async () => {
    const p = draft();
    const plan = figurePlan(QUESTION, p, selectAll(p));
    const figures = appliedFigures(plan, 0, [true, true, true]);
    expect(figures.map((f) => [f.variable, f.value, f.text])).toEqual([
      ["savings", 500000, "₹5 lakh in savings"], ["savings", 500000, "₹5 lakh in savings"], ["savings", 500000, "₹5 lakh in savings"],
    ]);
    let n = 0;
    const ids = () => `g${++n}`;
    const meta = { model: "fixture", createdAt: "2026-11-17T00:00:00Z" };
    const confirmed = await proposalToReality(QUESTION, p, selectAll(p), { ...meta, figures }, ids);
    const quit = confirmed.branches.find((b) => b.name === "Launch and quit job")!;
    expect(quit.values.savings).toBe(500000);
    expect(quit.sources?.savings).toBe("user");
    expect(quit.stated?.savings).toEqual({ text: "₹5 lakh in savings", value: 500000 });
    // The start keeps things as they are; no other number is set by the figure.
    expect(confirmed.branches[0]!.values.savings ?? null).toBeNull();
    expect(quit.values.monthlyCosts ?? null).toBeNull();
    const unconfirmed = await proposalToReality(QUESTION, p, selectAll(p), meta, ids);
    expect(unconfirmed.branches.every((b) => (b.values.savings ?? null) === null && b.stated === undefined)).toBe(true);
  });
  it("with no assumption that can hold it, it is listed as not used with the reason, and nothing is offered or applied", () => {
    const p = withoutSavings();
    expect(validateProposal(p).ok).toBe(true);
    const plan = figurePlan(QUESTION, p, selectAll(p));
    expect(plan.offer).toBe(false);
    expect(plan.unused).toEqual([{ text: "₹5 lakh in savings", why: "none of this draft's number assumptions fits it" }]);
    expect(appliedFigures(plan, 0, [true, true, true])).toEqual([]);
  });
  it("two scaled figures that belong together are not read one by one", () => {
    for (const [q, why] of [
      ["What if I saved 5 lakh 50 thousand?", "two numbers in a row are not read"],
      ["What if I had ₹5 lakh or ₹6 lakh in savings?", "it is one of two possible figures, so none is used"],
      ["What if rent was between 5 and 6 lakh?", "it looks like a range, so no single figure is used"],
    ] as const) {
      const read = readStatedValues(q);
      expect(read.values, q).toEqual([]);
      expect(read.unclear.map((u) => u.why), q).toEqual([why]);
    }
  });
});
