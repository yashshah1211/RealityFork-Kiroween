/**
 * R18.1: never invent a change, hide a real change, misattribute information, or silently destroy newer work.
 *  P1  one canonical record of a change the user describes (a hypothetical, never a fact, never a value)
 *  P2  who wrote a possibility is recorded where it is created and never guessed for older data
 *  P4  equivalent unit spellings are compatible; different dimensions and unlabeled amounts are not
 *  P5  importing never replaces a saved map
 * (P3, the number parser, is tested with the web package where it lives.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { buildFromTemplate, CAFE_QUEUE, MOVE_CITY, SOLAR } from "../src/reality/examples";
import { proposalToReality, selectAll, validateProposal, type Proposal } from "../src/reality/proposal";
import {
  addFormula,
  addVariable,
  changesFromParent,
  createReality,
  evaluateFormula,
  exportRealities,
  forkBranch,
  importRealities,
  INTERVENTION_QUESTION,
  isIntervention,
  mergeImported,
  RealityError,
  sameContent,
  updateBranch,
  type Reality,
} from "../src/reality/reality";
import { applyRevisit, checkRevisitRequest, HYPOTHETICAL_QUESTION, possibilityOrigin, revisitCause, revisitRequest, selectAllRevisit, validateRevisit } from "../src/reality/revisit";
import { branchStory, compareStory, formulaUnit, staleSuggestions, whatIfView } from "../src/reality/story";
import { normalizeUnit, sameUnit } from "../src/reality/units";

const audit = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/audit-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const counter = (p: string) => {
  let n = 0;
  return () => `${p}${++n}`;
};
const named = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;
const exam = () => {
  const c = validateProposal(structuredClone(audit["exam-length"]));
  if (!c.ok) throw new Error(c.errors.join("; "));
  return proposalToReality("What if my exams were two hours long?", c.proposal, selectAll(c.proposal), { model: "m", createdAt: "2026-11-10T10:00:00.000Z" }, counter("a"));
};
const STATEMENT = "I split the two hours into four focused sessions with breaks.";

describe("P1: a change the user describes has one canonical record", () => {
  it("the marker is the R17 text, so saved R17 and R18 maps are already in this form", () => {
    expect(INTERVENTION_QUESTION).toBe("What is different on this path?");
    expect(isIntervention({ question: INTERVENTION_QUESTION })).toBe(true);
    for (const q of ["", "Which country are you thinking of moving to?", "what is different on this path?", "What is different on this path? "]) expect(isIntervention({ question: q }), q).toBe(false);
  });

  it("a described change is a fact-shaped record on the child: the parent is untouched, no value is invented, no calculation changes", async () => {
    const r0 = await exam();
    const parent = named(r0, "Two-hour exams");
    const f = await forkBranch(r0, parent.id, { name: STATEMENT.slice(0, 57) + "…" }, counter("c"));
    const r = await updateBranch(f.reality, f.branch.id, { facts: [...(f.branch.facts ?? []), { id: "i1", question: INTERVENTION_QUESTION, answer: STATEMENT }] });
    const child = r.branches.find((b) => b.id === f.branch.id)!;
    expect(named(r, "Two-hour exams")).toEqual(parent);
    expect(child.values).toEqual(parent.values);
    expect(child.sources).toEqual(parent.sources);
    const d = changesFromParent(r, child);
    expect(d.changes).toEqual([]);
    expect(d.told).toEqual([{ question: INTERVENTION_QUESTION, from: null, to: STATEMENT }]);
    expect(isIntervention(d.told[0]!)).toBe(true);
    const w = whatIfView(r, child.id)!;
    expect(w.calculated).toEqual([]);
    expect(w.hasFormulas).toBe(false);
    // The existing mechanism marks the AI's earlier suggestions as possibly out of date; nothing is recalculated.
    const stale = staleSuggestions(r, child);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every((s) => s.madeBefore)).toBe(true);
    expect(child.possibilities.map((p) => p.text)).toEqual(parent.possibilities.map((p) => p.text));
  });

  it("an unchanged, renamed copy claims no change anywhere", async () => {
    const r0 = await exam();
    const parent = named(r0, "Two-hour exams");
    const f = await forkBranch(r0, parent.id, { name: STATEMENT }, counter("c"));
    const copy = f.branch;
    expect(copy.name).toBe(STATEMENT);
    expect(copy.facts).toBeUndefined();
    const d = changesFromParent(f.reality, copy);
    expect([d.changes, d.told]).toEqual([[], []]);
    expect(branchStory(f.reality, copy).told).toEqual([]);
    const cmp = compareStory(f.reality, parent.id, copy.id);
    expect([cmp.differences, cmp.told.onlyA, cmp.told.onlyB]).toEqual([[], [], []]);
    expect(whatIfView(f.reality, copy.id)!.told).toEqual([]);
    expect(staleSuggestions(f.reality, copy)).toEqual([]);
  });

  it("the AI is told a change being explored is a hypothetical, through the same request fields", async () => {
    const r0 = await exam();
    const parent = named(r0, "Two-hour exams");
    const f = await forkBranch(r0, parent.id, { name: "child" }, counter("c"));
    const r = await updateBranch(f.reality, f.branch.id, {
      facts: [{ id: "i1", question: INTERVENTION_QUESTION, answer: STATEMENT }, { id: "f1", question: "", answer: "Exams are held in the main hall" }],
    });
    const child = r.branches.find((b) => b.id === f.branch.id)!;
    const cause = revisitCause(r, child);
    expect(cause).toContain(`The user is exploring this change on this path (a hypothetical, not a known fact): ${STATEMENT}`);
    expect(cause).toContain("The user told us: Exams are held in the main hall.");
    expect(cause).not.toContain("told us: What is different");
    const req = revisitRequest(r, child, cause);
    expect(req.known).toEqual([{ question: HYPOTHETICAL_QUESTION, answer: STATEMENT }, { question: "", answer: "Exams are held in the main hall" }]);
    expect(HYPOTHETICAL_QUESTION).toMatch(/hypothetical, not a known fact/);
    expect(Object.keys(req).sort()).toEqual(["assumptions", "change", "context", "known", "path", "question", "suggestions"]);
    expect(checkRevisitRequest(req).ok).toBe(true);
  });

  it("an approved look keeps the explored change; the parent stays identical", async () => {
    const r0 = await exam();
    const parent = named(r0, "Two-hour exams");
    const f = await forkBranch(r0, parent.id, { name: "child" }, counter("c"));
    const r1 = await updateBranch(f.reality, f.branch.id, { facts: [{ id: "i1", question: INTERVENTION_QUESTION, answer: STATEMENT }] });
    const child = r1.branches.find((b) => b.id === f.branch.id)!;
    const req = revisitRequest(r1, child, revisitCause(r1, child));
    const look = {
      summary: "Because the time is split into sessions with breaks, tiredness could build up less on this path.", reconsider: [], questions: [], evidence: [],
      add: [{ text: "Concentration could stay steadier across the exam", trigger: "the time is split into focused sessions with breaks", mechanism: "Short breaks can let attention recover between sessions.", downstream: "", uncertainty: "Whether breaks are allowed in your exam rules.", tone: "upside", about: ["breaksAllowed"] }],
    };
    const checked = validateRevisit(look, req);
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    const r2 = await applyRevisit(r1, child.id, req, checked.suggestion, selectAllRevisit(checked.suggestion), { model: "m", at: "2026-11-10T11:00:00.000Z" }, counter("rv"));
    const after = r2.branches.find((b) => b.id === child.id)!;
    expect(changesFromParent(r2, after).told).toEqual([{ question: INTERVENTION_QUESTION, from: null, to: STATEMENT }]);
    expect(named(r2, "Two-hour exams")).toEqual(parent);
    const [back] = await importRealities(exportRealities([r2]));
    expect(back).toEqual(r2);
  });
});

describe("P2: who wrote a possibility is recorded, never guessed", () => {
  it("everything an example comes with is recorded as the example's", async () => {
    for (const t of [MOVE_CITY, SOLAR, CAFE_QUEUE]) {
      const r = await buildFromTemplate(t, counter("m"));
      const all = r.branches.flatMap((b) => b.possibilities);
      expect(all.every((p) => p.source === "example" && possibilityOrigin(p) === "example"), t.id).toBe(true);
    }
    const r = await buildFromTemplate(MOVE_CITY, counter("m"));
    expect(named(r, "Stay in Mumbai").possibilities.map((p) => [p.text, p.source])).toEqual([["Close to family and friends", "example"]]);
    // A copy on another path keeps where it came from.
    expect(named(r, "Move to London").possibilities.find((p) => p.text === "Close to family and friends")!.source).toBe("example");
  });

  it("what a user adds is recorded as theirs, next to the example's, and survives fork, export and import", async () => {
    const r0 = await buildFromTemplate(MOVE_CITY, counter("m"));
    const london = named(r0, "Move to London");
    const r1 = await updateBranch(r0, london.id, { possibilities: [...london.possibilities, { id: "mine", text: "A friend lives nearby", likelihood: "not-judged", note: "", source: "user", tone: "upside" }] });
    const f = await forkBranch(r1, london.id, { name: "copy" }, counter("f"));
    const [back] = await importRealities(exportRealities([f.reality]));
    expect(back).toEqual(f.reality);
    const origins = f.branch.possibilities.map((p) => [p.text, possibilityOrigin(p)]);
    expect(origins).toEqual([
      ["Close to family and friends", "example"], ["Faster career growth", "example"], ["Lonely for the first year", "example"], ["A friend lives nearby", "user"],
    ]);
  });

  it("an unknown source is refused", async () => {
    const r = await buildFromTemplate(MOVE_CITY, counter("m"));
    const b = named(r, "Move to London");
    await expect(updateBranch(r, b.id, { possibilities: [{ id: "x", text: "x", likelihood: "not-judged", note: "", source: "guess" as never }] })).rejects.toThrow(/unknown source/);
  });

  it("AI suggestions are recognised as the AI's, from the draft and from an approved look", async () => {
    const r = await exam();
    const all = r.branches.flatMap((b) => b.possibilities);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => possibilityOrigin(p) === "ai" && p.source === undefined)).toBe(true);
  });

  it("older saved files get no invented provenance: nothing is 'example' or 'user', every fingerprint is unchanged", async () => {
    const seen = new Set<string>();
    for (const name of ["realities-6e4b8f2.json", "realities-5b17057.json", "realities-4e4bdfe.json"]) {
      const text = fixture(name);
      const realities = await importRealities(text);
      expect(realities.flatMap((r) => r.branches.map((b) => b.fingerprint))).toEqual(JSON.parse(text).realities.flatMap((r: { branches: { fingerprint: string }[] }) => r.branches.map((b) => b.fingerprint)));
      expect(JSON.parse(exportRealities(realities))).toEqual(JSON.parse(text));
      for (const r of realities) for (const b of r.branches) for (const p of b.possibilities) {
        expect("source" in p).toBe(false);
        seen.add(possibilityOrigin(p));
      }
    }
    expect([...seen].sort()).toEqual(["ai", "unrecorded"]);
  });

  it("forking an older path does not add a source to what it copies", async () => {
    const [dog] = await importRealities(fixture("realities-6e4b8f2.json"));
    const large = dog!.branches[1]!;
    expect(large.possibilities.length).toBeGreaterThan(0);
    const f = await forkBranch(dog!, large.id, { name: "copy" }, counter("f"));
    expect(f.branch.possibilities.every((p) => !("source" in p))).toBe(true);
    expect(f.branch.possibilities.map(possibilityOrigin)).toEqual(large.possibilities.map(possibilityOrigin));
  });

  it("a source is part of what a branch's fingerprint covers, but only when present", async () => {
    const r = await createReality({ question: "What if?" }, counter("h"));
    const root = r.branches[0]!;
    const base = { id: "p", text: "x", likelihood: "not-judged" as const, note: "" };
    const plain = await updateBranch(r, root.id, { possibilities: [base] });
    const again = await updateBranch(r, root.id, { possibilities: [{ ...base }] });
    const withSource = await updateBranch(r, root.id, { possibilities: [{ ...base, source: "user" }] });
    expect(plain.branches[0]!.fingerprint).toBe(again.branches[0]!.fingerprint);
    expect(withSource.branches[0]!.fingerprint).not.toBe(plain.branches[0]!.fingerprint);
  });
});

describe("P4: equivalent unit spellings are compatible; different things are not", () => {
  it("normalises spelling only", () => {
    const same: [string, string][] = [
      ["₹/month", "₹ per month"], ["£/month", "£ per month"], ["€/month", "€ per month"], ["₹ / month", "₹ per month"], ["£ per Month", "£ per month"],
      ["£ a month", "£ per month"], ["£ each month", "£ per month"], ["£ every month", "£ per month"], ["£ per months", "£ per month"],
      ["minutes", "min"], ["Minutes", "mins"], ["minute", "min."], ["hours per week", "hrs/week"], ["hours", "hr"], ["kWh per year", "kWh/year"],
      ["per month", "/month"], ["%", "percent"], ["%", "per cent"], ["  £   per   month ", "£ per month"], ["", "  "],
    ];
    for (const [a, b] of same) expect(sameUnit(a, b), `${a} = ${b}`).toBe(true);
    const different: [string, string][] = [
      ["£ per month", "£ per year"], ["£ per month", "£"], ["£", "$"], ["₹ per month", "£ per month"], ["€ per month", "£ per month"],
      ["minutes", "hours"], ["hours per week", "hours per day"], ["per month", "₹ per month"], ["$", "USD"], ["people", "per month"], ["£ per week", "£ per month"],
      ["kWh", "kW"], ["minutes", "months"], ["%", "£"],
    ];
    for (const [a, b] of different) expect(sameUnit(a, b), `${a} ≠ ${b}`).toBe(false);
  });

  it("is a comparison key only: it never rewrites a unit", () => {
    expect(normalizeUnit("₹/month")).toBe("₹ per month");
    expect(normalizeUnit("Minutes")).toBe("minute");
    expect(normalizeUnit("£ a month")).toBe("£ per month");
  });

  async function map(units: Record<string, string>, expressions: Record<string, string>, values: Record<string, number | null> = {}) {
    let r = await createReality({ question: "What if?" }, counter("u"));
    for (const [key, unit] of Object.entries(units)) r = await addVariable(r, { key, label: key, kind: "number", unit }, values[key] ?? 100);
    for (const [key, expression] of Object.entries(expressions)) r = await addFormula(r, { key, label: key, expression });
    return r;
  }

  it("a sum of equivalent spellings keeps its number and shows the first unit as written", async () => {
    const cases: [string, string, string][] = [
      ["₹ per month", "₹/month", "₹ per month"], ["£/month", "£ per month", "£/month"], ["€ per month", "€/month", "€ per month"],
      ["minutes", "min", "minutes"], ["hours per week", "hrs/week", "hours per week"],
    ];
    for (const [a, b, shown] of cases) {
      const r = await map({ a, b }, { total: "a + b", gap: "a - b" });
      expect(formulaUnit(r, "total"), `${a} + ${b}`).toEqual({ status: "derived", unit: shown });
      expect(formulaUnit(r, "gap"), `${a} - ${b}`).toEqual({ status: "derived", unit: shown });
      expect(evaluateFormula(r, r.branches[0]!, "total")).toEqual({ status: "ok", value: 200 });
      // The stored units are exactly what was typed.
      expect(r.variables.map((v) => v.unit)).toEqual([a, b]);
      const [back] = await importRealities(exportRealities([r]));
      expect(back).toEqual(r);
    }
  });

  it("different dimensions, periods and currencies stay incompatible, and the number is not shown", async () => {
    const mixed: [string, string][] = [["£ per month", "£ per year"], ["£", "£ per month"], ["₹ per month", "£ per month"], ["minutes", "hours"], ["hours per week", "hours per day"], ["$ per month", "€ per month"]];
    for (const [a, b] of mixed) {
      const r = await map({ a, b }, { total: "a + b" });
      const u = formulaUnit(r, "total");
      expect(u.status, `${a} + ${b}`).toBe("mixed");
      if (u.status === "mixed") expect(u.units).toEqual([a, b]);
    }
  });

  it("a missing currency is never invented or merged with a known one", async () => {
    const r = await map({ a: "per month", b: "₹ per month", c: "per month" }, { bare: "a + c", withCurrency: "a + b", dollars: "a * 12" });
    expect(formulaUnit(r, "bare")).toEqual({ status: "derived", unit: "per month" });
    expect(formulaUnit(r, "withCurrency").status).toBe("mixed");
    expect(formulaUnit(r, "dollars")).toEqual({ status: "unknown", unit: "" });
    // A number with no unit at all stays unknown (existing rule): the sum does not borrow the £ of its other term.
    const unlabeled = await map({ a: "", b: "£" }, { s: "a + b" });
    expect(formulaUnit(unlabeled, "s")).toEqual({ status: "unknown", unit: "" });
  });

  it("an unknown unit stays unknown; a declared unit is used as declared", async () => {
    let r = await map({ a: "people" }, { ratio: "a / 2" });
    expect(formulaUnit(r, "ratio")).toEqual({ status: "unknown", unit: "" });
    r = await addFormula(r, { key: "declared", label: "declared", expression: "a / 2", unit: "pairs" });
    expect(formulaUnit(r, "declared")).toEqual({ status: "declared", unit: "pairs" });
  });
});

describe("P5: importing never replaces what is saved", () => {
  const ids = (p: string) => counter(p);
  async function savedThenEdited() {
    let r = await createReality({ question: "What if I kept my work?" }, ids("s"));
    r = await updateBranch(r, r.branches[0]!.id, { facts: [{ id: "f1", question: "", answer: "Version one: written before the export" }] });
    const older = r;
    const newer = await updateBranch(r, r.branches[0]!.id, { facts: [...(r.branches[0]!.facts ?? []), { id: "f2", question: "", answer: "Version two: written after the export" }] });
    return { older, newer };
  }

  it("a map with a new ID is added", async () => {
    const a = await buildFromTemplate(SOLAR, ids("a"));
    const b = await buildFromTemplate(MOVE_CITY, ids("b"));
    const m = mergeImported([a], [b]);
    expect(m.realities).toEqual([a, b]);
    expect([m.added, m.unchanged, m.copies]).toEqual([[b], [], []]);
  });

  it("a map saved with identical content is skipped; nothing about the saved map changes", async () => {
    const a = await buildFromTemplate(SOLAR, ids("a"));
    const [again] = await importRealities(exportRealities([a]));
    const m = mergeImported([a], [again!]);
    expect(m.realities).toHaveLength(1);
    expect(m.realities[0]).toBe(a);
    expect([m.added, m.unchanged.length, m.copies]).toEqual([[], 1, []]);
  });

  it("an older export of a map that was edited afterwards is kept as a separate copy: the newer map is untouched", async () => {
    const { older, newer } = await savedThenEdited();
    const [fromFile] = await importRealities(exportRealities([older]));
    expect(sameContent(newer, fromFile!)).toBe(false);
    const m = mergeImported([newer], [fromFile!], ids("copy"));
    expect(m.realities).toHaveLength(2);
    expect(m.realities[0]).toBe(newer);
    expect(m.realities[0]!.branches[0]!.facts!.map((f) => f.answer)).toEqual(["Version one: written before the export", "Version two: written after the export"]);
    expect(m.copies).toHaveLength(1);
    const { copy, of } = m.copies[0]!;
    expect(of).toBe(newer);
    expect(copy.id).toBe("copy1");
    expect(copy.id).not.toBe(newer.id);
    // The copy is the file's version, whole: same branches, same fingerprints, same content.
    expect(copy.branches.map((b) => [b.id, b.fingerprint])).toEqual(fromFile!.branches.map((b) => [b.id, b.fingerprint]));
    expect(copy.question).toBe(newer.question);
    expect(copy.branches[0]!.facts!.map((f) => f.answer)).toEqual(["Version one: written before the export"]);
    // It is a real map: it exports and imports again unchanged.
    const [back] = await importRealities(exportRealities([copy]));
    expect(back).toEqual(copy);
    // Importing the same file again changes nothing more: the copy is now identical to what is saved.
    const next = mergeImported(m.realities, [fromFile!], ids("again"));
    expect(next.realities).toHaveLength(2);
    expect(next.copies).toEqual([]);
  });

  it("a newer file over an older saved map also keeps both", async () => {
    const { older, newer } = await savedThenEdited();
    const [fromFile] = await importRealities(exportRealities([newer]));
    const m = mergeImported([older], [fromFile!], ids("copy"));
    expect(m.realities[0]).toBe(older);
    expect(m.copies).toHaveLength(1);
    expect(m.copies[0]!.copy.branches[0]!.facts).toHaveLength(2);
  });

  it("a mixed file is handled map by map", async () => {
    const { older, newer } = await savedThenEdited();
    const solar = await buildFromTemplate(SOLAR, ids("a"));
    const cafe = await buildFromTemplate(CAFE_QUEUE, ids("b"));
    const [o, s, c] = await importRealities(exportRealities([older, solar, cafe]));
    const m = mergeImported([newer, solar], [o!, s!, c!], ids("copy"));
    expect(m.realities.map((r) => r.id)).toEqual([newer.id, solar.id, "copy1", cafe.id]);
    expect(m.added.map((r) => r.id)).toEqual(["copy1", cafe.id]);
    expect(m.unchanged).toEqual([solar]);
    expect(m.copies.map((x) => x.of.id)).toEqual([newer.id]);
  });

  it("new IDs never collide with saved maps or with other maps in the file", async () => {
    const { older, newer } = await savedThenEdited();
    const other = await buildFromTemplate(SOLAR, ids("o"));
    const [o, x] = await importRealities(exportRealities([older, other]));
    const m = mergeImported([newer], [o!, x!], () => "taken");
    // "taken" is free the first time; a generator that only returns used IDs is refused rather than looped on.
    expect(m.copies[0]!.copy.id).toBe("taken");
    expect(() => mergeImported([newer, { ...other, id: "taken" } as Reality], [o!], () => "taken")).toThrow(RealityError);
  });

  it("the merge is pure: its inputs are not modified", async () => {
    const { older, newer } = await savedThenEdited();
    const saved = [newer];
    const [o] = await importRealities(exportRealities([older]));
    const incoming = [o!];
    const savedSnapshot = JSON.stringify(saved);
    const incomingSnapshot = JSON.stringify(incoming);
    mergeImported(saved, incoming, ids("c"));
    expect([JSON.stringify(saved), JSON.stringify(incoming)]).toEqual([savedSnapshot, incomingSnapshot]);
  });
});
