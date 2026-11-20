/**
 * R18: the seven P1 audit findings, at the level of the core. Each block names its finding. The browser journeys for the
 * same findings are in packages/web/e2e/audit.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { buildFromTemplate, CAFE_QUEUE, MOVE_CITY } from "../src/reality/examples";
import { PLANNER_SYSTEM_PROMPT, proposalToReality, readableLabel, selectAll, validateProposal, type Proposal } from "../src/reality/proposal";
import { applyRevisit, checkRevisitRequest, revisitCause, revisitRequest, selectAllRevisit, validateRevisit } from "../src/reality/revisit";
import {
  addFormula,
  addVariable,
  changesFromParent,
  createReality,
  diffFacts,
  evaluateFormula,
  exportRealities,
  forkBranch,
  importRealities,
  updateBranch,
  type AssumptionValue,
  type Reality,
} from "../src/reality/reality";
import { branchStory, carriedOver, compareStory, describeChange, formulaUnit, formulaUses, knownView, relatedAssumptions, staleSuggestions, valueOrigin, whatIfView } from "../src/reality/story";

const audit = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/audit-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
const counter = (p: string) => {
  let n = 0;
  return () => `${p}${++n}`;
};
const named = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;
/** What the browser store's exploreChange does, through the same public operations. */
async function explore(r: Reality, fromName: string, change: { key: string; value: AssumptionValue } | { text: string }, ids = counter("e")) {
  const from = named(r, fromName);
  const f = await forkBranch(r, from.id, { name: "key" in change ? `${from.name} · ${change.key}` : change.text }, ids);
  const next = "key" in change
    ? await updateBranch(f.reality, f.branch.id, { values: { [change.key]: change.value }, sources: { [change.key]: "user" } })
    : await updateBranch(f.reality, f.branch.id, { facts: [...(f.branch.facts ?? []), { id: "wf1", question: "What is different on this path?", answer: change.text }] });
  return { r: next, child: next.branches.find((b) => b.id === f.branch.id)! };
}
const accept = (k: string, q: string) => {
  const c = validateProposal(structuredClone(audit[k]));
  if (!c.ok) throw new Error(c.errors.join("; "));
  return proposalToReality(q, c.proposal, selectAll(c.proposal), { model: "m", createdAt: "2026-11-07T10:00:00.000Z" }, counter("a"));
};

describe("RF-01: changing rent changes rent", () => {
  it("the rent decision offers rent alone first, then everything else; nothing else is chosen for the user", async () => {
    const r = await buildFromTemplate(MOVE_CITY, counter("m"));
    const london = named(r, "Move to London");
    const rel = relatedAssumptions(r, london, { about: ["rent"] });
    expect(rel.filter((x) => x.linked).map((x) => [x.variable.key, x.value])).toEqual([["rent", 1500]]);
    expect(rel[0]!.variable.key).toBe("rent");
    expect(rel.slice(1).map((x) => x.variable.key)).toEqual(r.variables.map((v) => v.key).filter((k) => k !== "rent"));
  });

  it("£1,200 on a new path: the child recalculates, the parent keeps £1,500, and the comparison shows +£300", async () => {
    const r0 = await buildFromTemplate(MOVE_CITY, counter("m"));
    const parent = named(r0, "Move to London");
    const { r, child } = await explore(r0, "Move to London", { key: "rent", value: 1200 });
    expect(child.values.rent).toBe(1200);
    expect(named(r, "Move to London")).toEqual(parent);
    expect(evaluateFormula(r, child, "monthlySavings")).toEqual({ status: "ok", value: 1000 });
    expect(evaluateFormula(r, named(r, "Move to London"), "monthlySavings")).toEqual({ status: "ok", value: 700 });
    expect(changesFromParent(r, child).changes.map((c) => [c.key, c.from, c.to])).toEqual([["rent", 1500, 1200]]);
    const w = whatIfView(r, child.id)!;
    expect(w.changed.map((c) => [c.key, c.from, c.to])).toEqual([["rent", 1500, 1200]]);
    expect(w.calculated.map((c) => [c.formula.key, c.from, c.to])).toEqual([
      ["monthlySavings", { status: "ok", value: 700 }, { status: "ok", value: 1000 }],
      ["savingsRate", { status: "ok", value: 22.6 }, { status: "ok", value: 32.3 }],
    ]);
    const cmp = compareStory(r, parent.id, child.id);
    expect(cmp.differences.map((d) => [d.variable.key, d.a, d.b])).toEqual([["rent", 1500, 1200]]);
    expect(cmp.calculated.find((x) => x.formula.key === "monthlySavings")!.difference).toBe(300);
  });
});

describe("RF-04: one definition of a change, including a change described in words", () => {
  const STATEMENT = "I split the two hours into four focused sessions with breaks.";

  it("a described change is a difference from the parent everywhere: path, map caption data, comparison", async () => {
    const r0 = await accept("exam-length", "What if my exams were two hours long?");
    const parent = named(r0, "Two-hour exams");
    const { r, child } = await explore(r0, "Two-hour exams", { text: STATEMENT });
    const d = changesFromParent(r, child);
    expect(d.changes).toEqual([]);
    expect(d.told).toEqual([{ question: "What is different on this path?", from: null, to: STATEMENT }]);
    // The same thing the path's "What this change does" reports, from the same helper.
    expect(whatIfView(r, child.id)!.told).toEqual(d.told);
    expect(branchStory(r, child).told).toEqual(d.told);
    const cmp = compareStory(r, child.id, parent.id);
    expect(cmp.differences).toEqual([]);
    expect(cmp.told.onlyA.map((f) => f.answer)).toEqual([STATEMENT]);
    expect(cmp.told.onlyB).toEqual([]);
    // Nothing became a value, and the parent is untouched.
    expect(child.values).toEqual(parent.values);
    expect(named(r, "Two-hour exams")).toEqual(parent);
    expect(changesFromParent(r, named(r, "Two-hour exams")).told).toEqual([]);
  });

  it("survives export and import, and an approved fresh look on the child", async () => {
    const r0 = await accept("exam-length", "What if my exams were two hours long?");
    const { r } = await explore(r0, "Two-hour exams", { text: STATEMENT });
    const [back] = await importRealities(exportRealities([r]));
    const child = back!.branches.find((b) => b.name === STATEMENT)!;
    expect(changesFromParent(back!, child).told.map((f) => f.to)).toEqual([STATEMENT]);
    // The look's request carries the change; the approved look adds to the path and keeps what the user said.
    const req = revisitRequest(back!, child, revisitCause(back!, child));
    expect(req.change).toContain(STATEMENT);
    const look = {
      summary: "Because the two hours are split into sessions with breaks, fatigue could build up less on this path.", reconsider: [], questions: [], evidence: [],
      add: [{ text: "Concentration could stay steadier across the exam", trigger: "the time is split into focused sessions with breaks", mechanism: "Short breaks can let attention recover between sessions.", downstream: "", uncertainty: "Whether breaks are allowed in your exam rules.", tone: "upside", about: ["breaksAllowed"] }],
    };
    const checked = validateRevisit(look, req);
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    const after = await applyRevisit(back!, child.id, req, checked.suggestion, selectAllRevisit(checked.suggestion), { model: "m", at: "2026-11-07T11:00:00.000Z" }, counter("rv"));
    const looked = after.branches.find((b) => b.id === child.id)!;
    expect(looked.possibilities.map((p) => p.text)).toContain("Concentration could stay steadier across the exam");
    expect(changesFromParent(after, looked).told.map((f) => f.to)).toEqual([STATEMENT]);
    expect(named(after, "Two-hour exams")).toEqual(named(back!, "Two-hour exams"));
  });

  it("diffFacts reports added, reworded and removed facts by id; describeChange still does", async () => {
    const a = [{ id: "1", question: "", answer: "x" }, { id: "2", question: "", answer: "y" }];
    const b = [{ id: "1", question: "", answer: "x2" }, { id: "3", question: "q", answer: "z" }];
    expect(diffFacts(a, b)).toEqual([
      { question: "", from: "x", to: "x2" },
      { question: "q", from: null, to: "z" },
      { question: "", from: "y", to: null },
    ]);
    expect(diffFacts(a, a)).toEqual([]);
    const r0 = await accept("exam-length", "What if my exams were two hours long?");
    const { r, child } = await explore(r0, "Two-hour exams", { text: STATEMENT });
    expect(describeChange({ r, b: named(r, "Two-hour exams") }, { r, b: child }).facts).toEqual(changesFromParent(r, child).told);
  });
});

describe("RF-05: suggestions copied to another path are not presented as checked there", () => {
  it("an example suggestion without dependency information is carried over, not re-checked, wherever the path differs", async () => {
    const r = await buildFromTemplate(MOVE_CITY, counter("m"));
    const [stay, london, remote] = r.branches;
    expect(carriedOver(r, stay!)).toEqual([]);
    expect(carriedOver(r, london!).map((c) => [c.possibility.text, c.from.name, c.changed])).toEqual([["Close to family and friends", "Stay in Mumbai", []]]);
    // Named after the path it was first noted for, not the one in between.
    expect(carriedOver(r, remote!).map((c) => [c.possibility.text, c.from.name])).toEqual([
      ["Close to family and friends", "Stay in Mumbai"], ["Faster career growth", "Move to London"], ["Lonely for the first year", "Move to London"],
    ]);
    // Nothing is removed or rewritten.
    expect(london!.possibilities.find((p) => p.text === "Close to family and friends")).toEqual(stay!.possibilities[0]);
    const cmp = compareStory(r, london!.id, stay!.id);
    expect(cmp.unsorted.both.map((p) => p.text)).toEqual(["Close to family and friends"]);
    expect(cmp.carried.a.map((c) => c.possibility.text)).toEqual(["Close to family and friends"]);
    expect(cmp.carried.b).toEqual([]);
  });

  it("a copy on a path that does not differ from its origin is not tagged", async () => {
    const r0 = await buildFromTemplate(MOVE_CITY, counter("m"));
    const f = await forkBranch(r0, named(r0, "Stay in Mumbai").id, { name: "Same as Mumbai" }, counter("c"));
    expect(carriedOver(f.reality, f.branch)).toEqual([]);
  });

  it("dependency-linked suggestions are flagged only when what they depend on differs; about: [] never is", async () => {
    let r = await createReality({ question: "What if?" }, counter("d"));
    r = await addVariable(r, { key: "city", label: "City", kind: "category", options: ["Mumbai", "London"] }, "Mumbai", "user");
    r = await addVariable(r, { key: "car", label: "Own a car", kind: "boolean" }, false, "user");
    const root = r.branches[0]!;
    r = await updateBranch(r, root.id, {
      possibilities: [
        { id: "p-city", text: "Near the beach", likelihood: "not-judged", note: "", about: ["city"] },
        { id: "p-car", text: "Weekend trips are easy", likelihood: "not-judged", note: "", about: ["car"] },
        { id: "p-none", text: "Same favourite books", likelihood: "not-judged", note: "", about: [] },
        { id: "p-unknown", text: "Close to old friends", likelihood: "not-judged", note: "" },
      ],
    });
    const f = await forkBranch(r, root.id, { name: "London" }, counter("f"));
    r = await updateBranch(f.reality, f.branch.id, { values: { city: "London" }, sources: { city: "user" } });
    const london = r.branches.find((b) => b.id === f.branch.id)!;
    expect(carriedOver(r, london).map((c) => [c.possibility.id, c.changed])).toEqual([["p-city", ["City"]], ["p-unknown", []]]);
  });

  it("AI suggestions that record their basis are left to staleSuggestions (no second tag)", async () => {
    const r0 = await accept("exam-length", "What if my exams were two hours long?");
    const { r, child } = await explore(r0, "Two-hour exams", { key: "breaksAllowed", value: true });
    expect(carriedOver(r, child)).toEqual([]);
    expect(staleSuggestions(r, child)).toEqual([]);
    expect(branchStory(r, child).carried).toEqual([]);
  });
});

describe("RF-06: provenance of every value", () => {
  it("example figures are recorded as examples: never under Known, and named as example figures in what a result uses", async () => {
    const r = await buildFromTemplate(MOVE_CITY, counter("m"));
    const london = named(r, "Move to London");
    expect(knownView(r, london).values).toEqual([]);
    expect(valueOrigin(r, london, "rent")).toEqual({ origin: "example" });
    expect(valueOrigin(r, london, "movingCost")).toEqual({ origin: "unknown" });
    // A value the child kept from the start is named with the path it came from.
    expect(valueOrigin(r, london, "remoteWork")).toEqual({ origin: "example", from: named(r, "Stay in Mumbai") });
    expect(formulaUses(r, london, "monthlySavings").map((u) => [u.variable.key, u.provenance.origin])).toEqual([["netIncome", "example"], ["rent", "example"], ["livingCosts", "example"]]);
  });

  it("a starting value typed by the user is theirs; a child that inherits it says where it came from", async () => {
    let r = await createReality({ question: "What if I rented a bigger flat?" }, counter("u"));
    r = await addVariable(r, { label: "Monthly rent", kind: "number", unit: "£ per month" }, 1200, "user");
    r = await addVariable(r, { label: "Deposit", kind: "number", unit: "£" }, null, "user");
    const root = r.branches[0]!;
    expect(root.sources).toEqual({ monthlyRent: "user" });
    expect(knownView(r, root).values.map((x) => [x.variable.key, x.value, x.from])).toEqual([["monthlyRent", 1200, undefined]]);
    const f = await forkBranch(r, root.id, { name: "Bigger flat" }, counter("k"));
    expect(knownView(f.reality, f.branch).values.map((x) => [x.variable.key, x.from?.name])).toEqual([["monthlyRent", "Today"]]);
    expect(valueOrigin(f.reality, f.branch, "monthlyRent")).toEqual({ origin: "user", from: f.reality.branches[0] });
    const r2 = await updateBranch(f.reality, f.branch.id, { values: { monthlyRent: 1500 }, sources: { monthlyRent: "user" } });
    expect(knownView(r2, r2.branches[1]!).values.map((x) => [x.value, x.from])).toEqual([[1500, undefined]]);
  });

  it("inherited facts name the path they were told for", async () => {
    let r = await createReality({ question: "What if?" }, counter("t"));
    r = await updateBranch(r, r.branches[0]!.id, { facts: [{ id: "f1", question: "", answer: "My landlord allows pets" }] });
    const f = await forkBranch(r, r.branches[0]!.id, { name: "Copy" }, counter("tf"));
    expect(knownView(f.reality, f.branch).facts.map((x) => [x.answer, x.from?.name])).toEqual([["My landlord allows pets", "Today"]]);
    expect(knownView(f.reality, f.reality.branches[0]!).facts.map((x) => x.from)).toEqual([undefined]);
  });

  it("values from files without sources read 'origin not recorded'; the fixtures still import byte for byte", async () => {
    const seen = new Set<string>();
    for (const name of ["realities-6e4b8f2.json", "realities-5b17057.json", "realities-4e4bdfe.json"]) {
      const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
      const realities = await importRealities(text);
      expect(JSON.parse(exportRealities(realities))).toEqual(JSON.parse(text));
      for (const r of realities) for (const b of r.branches) for (const v of r.variables) {
        const p = valueOrigin(r, b, v.key);
        const value = b.values[v.key] ?? null;
        expect(p.origin).toBe(value === null ? "unknown" : (b.sources?.[v.key] ?? "unrecorded"));
        seen.add(p.origin);
      }
    }
    // Nothing is invented for older data: values saved without a source stay unrecorded, and none becomes an example.
    expect(seen.has("unrecorded")).toBe(true);
    expect(seen.has("example")).toBe(false);
  });

  it("an example figure is sent to the AI as 'unspecified', so the request schema is unchanged", async () => {
    const r = await buildFromTemplate(MOVE_CITY, counter("m"));
    const req = revisitRequest(r, named(r, "Move to London"), "Rent changed.");
    expect(req.assumptions.find((a) => a.key === "rent")!.source).toBe("unspecified");
    expect(checkRevisitRequest(req).ok).toBe(true);
  });

  it("only the known sources validate", async () => {
    const r = await createReality({ question: "What if?" }, counter("v"));
    const r1 = await addVariable(r, { label: "X", kind: "number" }, 1, "example");
    await expect(updateBranch(r1, r1.branches[0]!.id, { sources: { x: "guess" as never } })).rejects.toThrow(/unknown source "guess"/);
  });
});

describe("RF-07: currency, period and readable labels", () => {
  it("the bookstore's profit takes ₹ per month from the amounts it subtracts, and its code-name label becomes words", async () => {
    const c = validateProposal(structuredClone(audit.bookstore));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.proposal.formulas[0]!.label).toBe("Shop profit");
    expect(c.warnings).toContain("Wrote “shopProfit” as “Shop profit”.");
    let r = await accept("bookstore", "What if I opened a bookstore?");
    const shop = named(r, "Open the bookstore");
    r = await updateBranch(r, shop.id, { values: { monthlySales: 20000, rent: 8000, otherCosts: 4000 }, sources: { monthlySales: "user", rent: "user", otherCosts: "user" } });
    expect(r.formulas.map((f) => [f.key, f.label, f.unit])).toEqual([["shopProfit", "Shop profit", ""]]);
    expect(evaluateFormula(r, named(r, "Open the bookstore"), "shopProfit")).toEqual({ status: "ok", value: 8000 });
    expect(formulaUnit(r, "shopProfit")).toEqual({ status: "derived", unit: "₹ per month" });
    expect(formulaUses(r, named(r, "Open the bookstore"), "shopProfit").map((u) => u.provenance.origin)).toEqual(["user", "user", "user"]);
  });

  async function units(defs: { key: string; unit: string; kind?: "number" | "boolean" }[], expressions: Record<string, string>, declared: Record<string, string> = {}) {
    let r = await createReality({ question: "What if?" }, counter("x"));
    for (const d of defs) r = await addVariable(r, { key: d.key, label: d.key, kind: d.kind ?? "number", unit: d.unit }, null);
    for (const [key, expression] of Object.entries(expressions)) r = await addFormula(r, { key, label: key, expression, unit: declared[key] ?? "" });
    return r;
  }

  it("derives a unit only for sums and differences of one unit; mixed units are flagged; anything else stays unknown", async () => {
    const r = await units(
      [
        { key: "pay", unit: "€ per month" }, { key: "bonus", unit: "€ per Month" }, { key: "rent", unit: "£ per month" },
        { key: "study", unit: "hours per week" }, { key: "work", unit: "hours per week" }, { key: "commute", unit: "minutes" },
        { key: "people", unit: "" }, { key: "remote", unit: "", kind: "boolean" },
      ],
      {
        left: "pay + bonus - 100", total: "study + work", nested: "left - pay", rounded: "round(abs(left), 0)", either: "if(remote, study, work)",
        mixed: "rent + commute", mixedInside: "(rent + commute) * 2", yearly: "pay * 12", ratio: "study / work", noUnit: "people + 1",
        constant: "12 + 1", declared: "pay * 12", viaMixed: "mixed + 1",
      },
      { declared: "€ per year" },
    );
    const u = (k: string) => formulaUnit(r, k);
    expect(u("left")).toEqual({ status: "derived", unit: "€ per month" });
    expect(u("total")).toEqual({ status: "derived", unit: "hours per week" });
    expect(u("nested")).toEqual({ status: "derived", unit: "€ per month" });
    expect(u("rounded")).toEqual({ status: "derived", unit: "€ per month" });
    expect(u("either")).toEqual({ status: "derived", unit: "hours per week" });
    expect(u("mixed")).toEqual({ status: "mixed", unit: "", units: ["£ per month", "minutes"] });
    expect(u("mixedInside")).toEqual({ status: "mixed", unit: "", units: ["£ per month", "minutes"] });
    expect(u("viaMixed")).toEqual({ status: "mixed", unit: "", units: ["£ per month", "minutes"] });
    for (const k of ["yearly", "ratio", "noUnit", "constant"]) expect(u(k), k).toEqual({ status: "unknown", unit: "" });
    expect(u("declared")).toEqual({ status: "declared", unit: "€ per year" });
    // The arithmetic itself is untouched by any of this.
    expect(evaluateFormula(r, r.branches[0]!, "mixed")).toEqual({ status: "missing", missing: ["rent", "commute"] });
  });

  it("the café's wages keep their declared £; a currency is never invented for a unit without one", async () => {
    const r = await buildFromTemplate(CAFE_QUEUE, counter("c"));
    expect(formulaUnit(r, "wageCost")).toEqual({ status: "declared", unit: "£" });
    const plain = await units([{ key: "sales", unit: "per month" }, { key: "costs", unit: "per month" }], { profit: "sales - costs" });
    expect(formulaUnit(plain, "profit")).toEqual({ status: "derived", unit: "per month" });
  });

  it("code-name labels become words; other labels stay exactly as written", () => {
    expect(readableLabel("shopProfit")).toBe("Shop profit");
    expect(readableLabel("netIncomeAfterTax")).toBe("Net income after tax");
    expect(readableLabel("monthly_sales")).toBe("Monthly sales");
    for (const keep of ["Rent", "iPhone cost", "YouTube", "Profit per month", "macOS", "rent", "eBay"]) expect(readableLabel(keep)).toBe(keep);
  });

  it("the draft prompt keeps the user's currency and never guesses one", () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/include a currency in the unit only if the user wrote one/);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/never guess a currency, for example from a place/);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/never a code name/);
  });
});
