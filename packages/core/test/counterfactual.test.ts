/**
 * R17: "What if this changed?". A new path with one user-chosen change, compared with its parent: what the user changed,
 * what formulas recalculate, and which possibilities may no longer hold (never recalculated). One mechanism for every
 * situation: relocation (a number), a restaurant (running costs) and a university (a choice, or a described change).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { proposalToReality, selectAll, type Proposal } from "../src/reality/proposal";
import { exportRealities, forkBranch, importRealities, updateBranch, type AssumptionValue, type Reality } from "../src/reality/reality";
import { applyRevisit, revisitCause, revisitRequest, selectAllRevisit, validateRevisit } from "../src/reality/revisit";
import { relatedAssumptions, staleSuggestions, whatIfView } from "../src/reality/story";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/reactive-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
const counter = () => {
  let n = 0;
  return () => `w${++n}`;
};
const ids = counter();
const map = (k: string, q: string) => proposalToReality(q, fx[k]!, selectAll(fx[k]!), { model: "m", createdAt: "2026-11-08T10:00:00.000Z" }, ids);
const named = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;
const answer = (r: Reality, id: string, values: Record<string, AssumptionValue>) =>
  updateBranch(r, id, { values, sources: Object.fromEntries(Object.keys(values).map((k) => [k, "user" as const])) });
/** What exploreChange does in the browser store, through the same public operations. */
async function whatIf(r: Reality, fromId: string, change: { key: string; value: AssumptionValue } | { text: string }) {
  const from = r.branches.find((b) => b.id === fromId)!;
  const f = await forkBranch(r, fromId, { name: "key" in change ? `${from.name} · changed` : change.text }, ids);
  const next = "key" in change
    ? await answer(f.reality, f.branch.id, { [change.key]: change.value })
    : await updateBranch(f.reality, f.branch.id, { facts: [...(f.branch.facts ?? []), { id: "wf1", question: "What is different on this path?", answer: change.text }] });
  return { r: next, id: f.branch.id };
}

describe("relocation: a different income on a new path", () => {
  const REMOTE = "Remote relocation to Germany";
  async function withSavingsConsequence(income: number | null, costs: number | null) {
    let r = await map("relocation-tailored", "What if I moved to Germany while keeping my current remote job?");
    const b0 = named(r, REMOTE);
    r = await answer(r, b0.id, { monthlyIncome: income, livingCosts: costs });
    r = await updateBranch(r, b0.id, { facts: [{ id: "f1", question: "", answer: "I expect the cost of living in Germany to be higher than in my current city." }] });
    const b = named(r, REMOTE);
    const req = revisitRequest(r, b, revisitCause(r, b));
    const reply = {
      summary: "Because you expect living costs in Germany to be higher, this path could leave less money each month.", reconsider: [], questions: [], evidence: [],
      add: [{
        text: "Monthly savings could shrink", trigger: "living costs in Germany turn out higher while your income stays the same", mechanism: "Essential costs would take a larger share of the same income.",
        downstream: "Housing choices or savings goals may need to change.", uncertainty: "Your actual rent, insurance, taxes and income.", tone: "challenge", about: ["livingCosts", "monthlyIncome"],
      }],
    };
    const c = validateRevisit(reply, req);
    if (!c.ok) throw new Error(c.errors.join("; "));
    return applyRevisit(r, b.id, req, c.suggestion, selectAllRevisit(c.suggestion), { model: "m", at: "2026-11-08T11:00:00.000Z" }, ids);
  }

  it("recalculates only through the formula, flags the dependent consequence without rewriting it, and leaves the parent alone", async () => {
    const r0 = await withSavingsConsequence(4000, 4500);
    const parent = named(r0, REMOTE);
    const { r, id } = await whatIf(r0, parent.id, { key: "monthlyIncome", value: 5000 });
    const w = whatIfView(r, id)!;
    expect(w.parent.id).toBe(parent.id);
    expect(w.changed).toEqual([{ key: "monthlyIncome", label: "Monthly income", unit: "per month", from: 4000, to: 5000 }]);
    expect(w.calculated.map((c) => [c.formula.label, c.from, c.to])).toEqual([["Left each month", { status: "ok", value: -500 }, { status: "ok", value: 500 }]]);
    expect(w.reconsider.map((x) => [x.possibility.text, x.because])).toEqual([["Monthly savings could shrink", ["Monthly income"]]]);
    // The consequence keeps its words; it is flagged, not recalculated.
    const child = r.branches.find((b) => b.id === id)!;
    const savings = child.possibilities.find((p) => p.text === "Monthly savings could shrink")!;
    expect(savings).toEqual(parent.possibilities.find((p) => p.text === "Monthly savings could shrink"));
    expect(staleSuggestions(r, child).map((s) => s.possibility.text)).toContain("Monthly savings could shrink");
    expect(staleSuggestions(r, named(r, REMOTE)).map((s) => s.possibility.text)).not.toContain("Monthly savings could shrink");
    // The parent is byte for byte the same, fingerprint included.
    expect(named(r, REMOTE)).toEqual(parent);
    expect(child.sources?.monthlyIncome).toBe("user");
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
  });

  it("with an input still unknown, says what the calculation still needs instead of producing a number", async () => {
    const r0 = await withSavingsConsequence(null, null);
    const { r, id } = await whatIf(r0, named(r0, REMOTE).id, { key: "monthlyIncome", value: 5000 });
    const w = whatIfView(r, id)!;
    expect(w.calculated.map((c) => [c.formula.label, c.to])).toEqual([["Left each month", { status: "missing", missing: ["Living costs in Germany"] }]]);
    expect(w.calculated.every((c) => c.to.status !== "ok")).toBe(true);
  });

  it("lists the assumptions the AI linked to a suggestion first, and infers nothing from its words", async () => {
    const r = await withSavingsConsequence(4000, 4500);
    const b = named(r, REMOTE);
    const savings = b.possibilities.find((p) => p.text === "Monthly savings could shrink")!;
    const rel = relatedAssumptions(r, b, savings);
    // Linked ones first, in the map's order of assumptions.
    expect(rel.filter((x) => x.linked).map((x) => [x.variable.key, x.value])).toEqual([["monthlyIncome", 4000], ["livingCosts", 4500]]);
    expect(rel.map((x) => x.variable.key).sort()).toEqual(r.variables.map((v) => v.key).sort());
    // A suggestion without dependencies is linked to nothing, whatever its text says.
    expect(relatedAssumptions(r, b, { about: [] }).some((x) => x.linked)).toBe(false);
  });
});

describe("restaurant: lower running costs (premises) on a new path", () => {
  it("profit recalculates from the user's numbers; sales are not touched; the dependent challenge is flagged", async () => {
    let r = await map("restaurant-tailored", "What if I opened a small restaurant?");
    const cafe = named(r, "Small café");
    r = await answer(r, cafe.id, { monthlySales: 300000, monthlyCosts: 280000 });
    const parent = named(r, "Small café");
    const { r: r2, id } = await whatIf(r, parent.id, { key: "monthlyCosts", value: 250000 });
    const w = whatIfView(r2, id)!;
    expect(w.changed.map((v) => [v.label, v.from, v.to])).toEqual([["Running costs per month", 280000, 250000]]);
    expect(w.calculated.map((c) => [c.formula.label, c.from, c.to])).toEqual([["Profit per month", { status: "ok", value: 20000 }, { status: "ok", value: 50000 }]]);
    // Months to earn back still needs the budget, which nobody entered: no number is made up.
    expect(w.stillNeeds.map((x) => [x.formula.label, x.missing])).toEqual([["Months to earn back the budget", ["Start-up budget"]]]);
    expect(w.reconsider.map((x) => x.possibility.text)).toEqual(["Finding an affordable space with enough passers-by"]);
    expect(r2.branches.find((b) => b.id === id)!.values.monthlySales).toBe(300000);
    expect(named(r2, "Small café")).toEqual(parent);
  });
});

describe("university: no formulas, so only possibilities are affected", () => {
  it("a different assessment model flags the suggestions that depend on it and calculates nothing", async () => {
    const r = await map("university-tailored", "What if my university replaced written exams with project-based assessment?");
    const parent = named(r, "Projects replace exams");
    const { r: r2, id } = await whatIf(r, parent.id, { key: "assessmentMix", value: "mixed" });
    const w = whatIfView(r2, id)!;
    expect(w.hasFormulas).toBe(false);
    expect([w.calculated, w.stillNeeds]).toEqual([[], []]);
    expect(w.changed.map((v) => [v.from, v.to])).toEqual([["projects only", "mixed"]]);
    expect(w.reconsider.map((x) => x.possibility.text).sort()).toEqual(["Deadlines across the term may overlap", "Less pressure from single high-stakes exams"]);
    expect(named(r2, "Projects replace exams")).toEqual(parent);
  });

  it("a change described in the user's words is kept as something they said; every earlier suggestion is marked as made before it", async () => {
    const r = await map("university-tailored", "What if my university replaced written exams with project-based assessment?");
    const parent = named(r, "Projects replace exams");
    const { r: r2, id } = await whatIf(r, parent.id, { text: "Each project is limited to two people" });
    const w = whatIfView(r2, id)!;
    expect(w.changed).toEqual([]);
    expect(w.told).toEqual([{ question: "What is different on this path?", from: null, to: "Each project is limited to two people" }]);
    expect(w.reconsider).toEqual([]);
    expect(w.madeBefore).toBe(r2.branches.find((b) => b.id === id)!.possibilities.length);
    // Nothing became a value: the words are not turned into an assumption.
    expect(r2.branches.find((b) => b.id === id)!.values).toEqual(parent.values);
  });

  it("the starting path has no parent to compare with", async () => {
    const r = await map("university-tailored", "What if?");
    expect(whatIfView(r, r.branches[0]!.id)).toBeNull();
  });
});
