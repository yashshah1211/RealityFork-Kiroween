/**
 * Read-only views of a reality for the guided, visual journey: what changed, what could go well or be
 * hard, what is still unknown, what can be calculated, and which choices could start a new path.
 * Pure groupings of existing data: nothing here estimates, scores or predicts anything.
 */
import { parseExpression, type ExprNode, type ExprValue } from "./expr";
import { sameUnit } from "./units";
import {
  changesFromParent,
  compareBranches,
  diffFacts,
  evaluateFormula,
  formulaInputs,
  knownKeys,
  pathDifference,
  type AssumptionValue,
  type Branch,
  type CalculatedResult,
  type FactChange,
  type Formula,
  type KnownFact,
  type Possibility,
  type Reality,
  type StatedFigure,
  type ValueChange,
  type ValueSource,
  type Variable,
} from "./reality";

export interface UnknownAssumption {
  readonly variable: Variable;
  /** Labels of calculated outcomes that need this value. */
  readonly unlocks: readonly string[];
}

/** Known: what the user told RealityFork, never an AI guess. */
export interface KnownView {
  /** Answers to the context questions (apply to every path). */
  readonly context: readonly KnownFact[];
  /** Things the user told RealityFork about this path. `from`: the earlier path it was told for and copied from. */
  readonly facts: readonly (KnownFact & { readonly from?: Branch })[];
  /**
   * Values the user set themselves, in this path or (`from`) in the earlier path it came with. `stated`: the user's own
   * words from their question that gave this number, present only while the path still holds exactly that number.
   */
  readonly values: readonly { readonly variable: Variable; readonly value: AssumptionValue; readonly from?: Branch; readonly stated?: StatedFigure }[];
  /** Assumptions the user said do not apply to this path. */
  readonly notApplicable: readonly Variable[];
}

/** Where a value came from. "unrecorded": set before RealityFork recorded sources (older files); "unknown": no value. */
export type ValueOrigin = ValueSource | "unrecorded" | "unknown";
export interface ValueProvenance {
  readonly origin: ValueOrigin;
  /** The earlier path it was set in, when it came with this path unchanged (same value, same origin). */
  readonly from?: Branch;
  /** The user's own words from their question that gave this number, while the path still holds exactly that number. */
  readonly stated?: StatedFigure;
}

/** The words the user wrote in their question for this assumption, if the path still holds the number those words gave. */
const statedFor = (b: Branch, key: string, value: AssumptionValue): StatedFigure | undefined => {
  const s = b.stated?.[key];
  return s && value !== null && s.value === value ? s : undefined;
};

/** A suggestion copied from an earlier path without a record of what it was based on (see carriedOver). */
export interface CarriedOver {
  readonly possibility: Possibility;
  /** The path it was first noted for. */
  readonly from: Branch;
  /** Labels of the assumptions it is known to depend on whose value differs from that path ([] = its dependencies are unknown). */
  readonly changed: readonly string[];
}

/**
 * The unit of a calculated outcome. "declared": written with the formula; "derived": the formula only adds or subtracts
 * inputs that share one unit; "mixed": it adds or subtracts inputs with different units, so the result has no
 * meaningful unit; "unknown": anything else. Display only: the arithmetic is unchanged.
 */
export type OutcomeUnit =
  | { readonly status: "declared" | "derived"; readonly unit: string }
  | { readonly status: "unknown"; readonly unit: "" }
  | { readonly status: "mixed"; readonly unit: ""; readonly units: readonly string[] };

/**
 * An unknown assumption that something the user told RealityFork may answer. Only a pointer for the user: the value
 * stays unknown until the user answers it.
 */
export interface FactMatch {
  readonly variable: Variable;
  /** What the user said that shares words with the assumption, closest first. */
  readonly facts: readonly KnownFact[];
}

/** An AI suggestion that may need a fresh look: a value it depends on changed, or the user told us more since. */
export interface StaleSuggestion {
  readonly possibility: Possibility;
  /** Labels of assumptions it depends on whose value changed since it was suggested. */
  readonly changed: readonly string[];
  /** The user has told RealityFork something (context or this path) since it was suggested. */
  readonly madeBefore: boolean;
}

export interface BranchStory {
  readonly isStart: boolean;
  /** Assumptions that differ from the reality this one was branched from. */
  readonly changes: readonly ValueChange[];
  /** What the user told this path and not the one it came from (a change described in their own words, for example). */
  readonly told: readonly FactChange[];
  readonly known: KnownView;
  /** Suggestions copied from an earlier path that were not re-checked for this one. Kept, never removed. */
  readonly carried: readonly CarriedOver[];
  /** Active possibilities (set-aside ones are listed separately). */
  readonly upsides: readonly Possibility[];
  readonly challenges: readonly Possibility[];
  /** Possibilities nobody has sorted into upside or challenge. */
  readonly unsorted: readonly Possibility[];
  /** Suggestions the user set aside after a fresh look; kept with their reason. */
  readonly setAside: readonly Possibility[];
  readonly stale: readonly StaleSuggestion[];
  /** Unknown assumptions that something the user told us may answer (see factMatches). */
  readonly matches: readonly FactMatch[];
  /** Questions to verify in this path, from approved re-evaluations. */
  readonly toVerify: readonly string[];
  /** Kinds of evidence worth gathering for this path, from approved re-evaluations. */
  readonly toFindOut: readonly string[];
  /** Unknown values in this reality; those that unlock a calculation come first. */
  readonly unknowns: readonly UnknownAssumption[];
  readonly calculated: readonly { readonly formula: Formula; readonly value: ExprValue }[];
  readonly blocked: readonly { readonly formula: Formula; readonly missing: readonly string[] }[];
  readonly notApplicable: readonly { readonly formula: Formula; readonly reason: string }[];
  readonly failed: readonly { readonly formula: Formula; readonly message: string }[];
}

const byTone = (all: readonly Possibility[]) => {
  const ps = all.filter((p) => !p.setAside);
  return {
    upsides: ps.filter((p) => p.tone === "upside"),
    challenges: ps.filter((p) => p.tone === "challenge"),
    unsorted: ps.filter((p) => p.tone === undefined),
    setAside: all.filter((p) => p.setAside),
  };
};

const parentOf = (r: Reality, b: Branch) => (b.parentId ? r.branches.find((x) => x.id === b.parentId) : undefined);

/** The earliest path in `b`'s lineage that holds the same thing without a break: where it came from. Null = `b` itself. */
function firstHeldBy(r: Reality, b: Branch, holds: (x: Branch) => boolean): Branch | null {
  let from: Branch | null = null;
  for (let x = parentOf(r, b); x && holds(x); x = parentOf(r, x)) from = x;
  return from;
}

export function knownView(r: Reality, b: Branch): KnownView {
  return {
    context: r.context ?? [],
    facts: (b.facts ?? []).map((f) => {
      const from = firstHeldBy(r, b, (x) => (x.facts ?? []).some((g) => g.id === f.id && g.answer === f.answer));
      return from ? { ...f, from } : f;
    }),
    values: r.variables.flatMap((variable) => {
      const value = b.values[variable.key] ?? null;
      if (value === null || b.sources?.[variable.key] !== "user") return [];
      const from = firstHeldBy(r, b, (x) => x.values[variable.key] === value && x.sources?.[variable.key] === "user");
      const stated = statedFor(b, variable.key, value);
      return [{ variable, value, ...(from ? { from } : {}), ...(stated ? { stated } : {}) }];
    }),
    notApplicable: r.variables.filter((v) => b.notApplicable?.includes(v.key)),
  };
}

/** Who gave a value in this path, and the earlier path it came from if it was copied unchanged. */
export function valueOrigin(r: Reality, b: Branch, key: string): ValueProvenance {
  const value = b.values[key] ?? null;
  if (value === null) return { origin: "unknown" };
  const source = b.sources?.[key];
  const from = firstHeldBy(r, b, (x) => x.values[key] === value && x.sources?.[key] === source);
  const stated = source === "user" ? statedFor(b, key, value) : undefined;
  return { origin: source ?? "unrecorded", ...(from ? { from } : {}), ...(stated ? { stated } : {}) };
}

/** The assumptions a calculated outcome uses, each with where its value in this path came from. */
export function formulaUses(r: Reality, b: Branch, key: string): { readonly variable: Variable; readonly provenance: ValueProvenance }[] {
  return formulaInputs(r, key).flatMap((k) => {
    const variable = r.variables.find((v) => v.key === k);
    return variable ? [{ variable, provenance: valueOrigin(r, b, k) }] : [];
  });
}

/**
 * Suggestions `b` holds only because they were copied from an earlier path, and that nothing records as checked for
 * `b`: examples, the user's own notes and files from before R15. AI suggestions with a basis are left to
 * staleSuggestions. A suggestion with dependencies (`about`) is listed only if one of them differs from the path it was
 * noted for; one known to depend on nothing (`about: []`) never is; one without dependency information is listed
 * whenever `b` differs from that path. Read-only: nothing is removed or rewritten.
 */
export function carriedOver(r: Reality, b: Branch): CarriedOver[] {
  return b.possibilities.flatMap((p) => {
    if (p.setAside || p.basis || (p.about !== undefined && p.about.length === 0)) return [];
    const from = firstHeldBy(r, b, (x) => x.possibilities.some((q) => q.id === p.id));
    if (!from) return [];
    if (p.about !== undefined) {
      const changed = p.about.flatMap((k) => {
        const v = r.variables.find((x) => x.key === k);
        return v && (from.values[k] ?? null) !== (b.values[k] ?? null) ? [v.label] : [];
      });
      return changed.length ? [{ possibility: p, from, changed }] : [];
    }
    const d = pathDifference(r, from, b);
    return d.changes.length || d.told.length ? [{ possibility: p, from, changed: [] }] : [];
  });
}

type Inferred = { readonly k: "free" } | { readonly k: "unit"; readonly unit: string } | { readonly k: "unknown" } | { readonly k: "mixed"; readonly units: readonly string[] };
const UNKNOWN: Inferred = { k: "unknown" };

/** Sums and differences keep a shared unit; a plain number adopts it; different units are "mixed". */
function combine(xs: readonly Inferred[]): Inferred {
  const mixed = xs.filter((x): x is Extract<Inferred, { k: "mixed" }> => x.k === "mixed");
  const units = xs.flatMap((x) => (x.k === "unit" ? [x.unit] : []));
  const distinct = units.filter((u, i) => units.findIndex((v) => sameUnit(u, v)) === i);
  if (mixed.length || distinct.length > 1) {
    const all = [...mixed.flatMap((m) => m.units), ...distinct];
    return { k: "mixed", units: all.filter((u, i) => all.findIndex((v) => sameUnit(u, v)) === i) };
  }
  if (xs.some((x) => x.k === "unknown")) return UNKNOWN;
  return distinct.length ? { k: "unit", unit: distinct[0]! } : { k: "free" };
}

function inferUnit(r: Pick<Reality, "variables" | "formulas">, n: ExprNode, seen: ReadonlySet<string>): Inferred {
  switch (n.t) {
    case "num":
      return { k: "free" };
    case "name": {
      const v = r.variables.find((x) => x.key === n.v);
      if (v) return v.kind === "number" && v.unit.trim() ? { k: "unit", unit: v.unit.trim() } : UNKNOWN;
      const u = r.formulas.some((f) => f.key === n.v) && !seen.has(n.v) ? unitOf(r, n.v, seen) : null;
      return !u ? UNKNOWN : u.status === "mixed" ? { k: "mixed", units: u.units } : u.status === "unknown" ? UNKNOWN : { k: "unit", unit: u.unit };
    }
    case "un":
      return n.op === "-" ? inferUnit(r, n.a, seen) : UNKNOWN;
    case "bin":
      if (n.op === "+" || n.op === "-") return combine([inferUnit(r, n.a, seen), inferUnit(r, n.b, seen)]);
      if (n.op === "*" || n.op === "/" || n.op === "^") {
        // Products, ratios and powers change the unit in ways a label cannot show ("per month" × 12): unknown, unless
        // every part is a plain number. A mismatched sum inside stays flagged.
        const parts = [inferUnit(r, n.a, seen), inferUnit(r, n.b, seen)];
        if (parts.some((x) => x.k === "mixed")) return combine(parts.filter((x) => x.k === "mixed"));
        return parts.every((x) => x.k === "free") ? { k: "free" } : UNKNOWN;
      }
      return UNKNOWN;
    case "call":
      if (n.fn === "abs" || n.fn === "round") return inferUnit(r, n.args[0]!, seen);
      if (n.fn === "min" || n.fn === "max") return combine(n.args.map((a) => inferUnit(r, a, seen)));
      if (n.fn === "if") return combine([inferUnit(r, n.args[1]!, seen), inferUnit(r, n.args[2]!, seen)]);
      return UNKNOWN;
    default:
      return UNKNOWN;
  }
}

function unitOf(r: Pick<Reality, "variables" | "formulas">, key: string, seen: ReadonlySet<string> = new Set()): OutcomeUnit {
  const f = r.formulas.find((x) => x.key === key);
  if (!f) return { status: "unknown", unit: "" };
  if (f.unit.trim()) return { status: "declared", unit: f.unit.trim() };
  let x: Inferred;
  try {
    x = inferUnit(r, parseExpression(f.expression), new Set([...seen, key]));
  } catch {
    x = UNKNOWN;
  }
  return x.k === "unit" ? { status: "derived", unit: x.unit } : x.k === "mixed" ? { status: "mixed", unit: "", units: x.units } : { status: "unknown", unit: "" };
}

/** The unit to show with a calculated outcome (see OutcomeUnit). Nothing is guessed: unknown stays unknown. */
export function formulaUnit(r: Pick<Reality, "variables" | "formulas">, key: string): OutcomeUnit {
  return unitOf(r, key);
}

/** AI suggestions in `b` whose basis no longer matches. Older suggestions without a basis are never flagged. */
export function staleSuggestions(r: Reality, b: Branch): StaleSuggestion[] {
  const known = knownKeys(r, b);
  return b.possibilities.flatMap((p) => {
    if (!p.basis || p.setAside) return [];
    const changed = Object.entries(p.basis.values).flatMap(([k, then]) => {
      const v = r.variables.find((x) => x.key === k);
      return v && (b.values[k] ?? null) !== then ? [v.label] : [];
    });
    const madeBefore = known.some((k) => !p.basis!.known.includes(k));
    return changed.length || madeBefore ? [{ possibility: p, changed, madeBefore }] : [];
  });
}

// Plain word matching, no inference: lower case, Unicode letters and digits, common English function words dropped,
// and a few regular endings removed, so "working" meets "work" and "employers" meets "employer".
export const FUNCTION_WORDS = new Set(("a about an and are as at be been but by can could did do does for from had has have he her his i if in into is it " +
  "its may me might must my no not of on or our she so than that the their them then there these they this those to up us very was we were what when " +
  "where which who why will with would you your").split(" "));
function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || FUNCTION_WORDS.has(raw) || !/\p{L}/u.test(raw)) continue;
    let w = raw;
    for (const end of ["ing", "ed", "ly", "s"]) if (w.length - end.length >= 3 && w.endsWith(end)) { w = w.slice(0, -end.length); break; }
    if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

/**
 * Unknown assumptions in `b` that a context answer or a fact about this path may answer, because they share words with
 * the assumption's name (at least two, or at least half of its words). Strongest first. Deterministic and read-only:
 * it never sets a value, and no AI is involved. The user decides whether a fact answers a question, and what the answer is.
 */
export function factMatches(r: Reality, b: Branch): FactMatch[] {
  const told = [...(r.context ?? []), ...(b.facts ?? [])].map((fact, at) => ({ fact, at, words: words(fact.answer) }));
  const found: { variable: Variable; facts: KnownFact[]; best: number; order: number }[] = [];
  r.variables.forEach((variable, order) => {
    if ((b.values[variable.key] ?? null) !== null) return;
    const name = [...words(variable.label)];
    if (!name.length) return;
    const hits = told.flatMap((t) => {
      const shared = name.filter((w) => t.words.has(w)).length;
      return shared >= 2 || (shared > 0 && shared * 2 >= name.length) ? [{ ...t, shared }] : [];
    });
    if (!hits.length) return;
    hits.sort((x, y) => y.shared - x.shared || y.at - x.at); // more shared words first, then the most recent
    found.push({ variable, facts: hits.map((h) => h.fact), best: hits[0]!.shared, order });
  });
  return found.sort((x, y) => y.best - x.best || x.order - y.order).map(({ variable, facts }) => ({ variable, facts }));
}

/** Words that can start a trigger and are never names, so they may be lower-cased after "if". */
const COMMON_START = /^(?:The|A|An|Your|You|You're|My|Our|Their|His|Her|This|That|These|Those|It|Its|There|Some|Most|More|Less|Fewer|Each|Every|Any|No|Both|All|Other|Others|People|Living|Costs?|Rents?|Prices?|Demand|Customers?|Students?|Staff|Income|Pay|Salary|Savings)\b/;

/**
 * A consequence and its condition, ready to read as one sentence: "Monthly savings could shrink" + "if living costs
 * turn out higher…". Only wording is normalised (trailing punctuation, a repeated "if", the first letter); the text
 * is otherwise shown exactly as stored.
 */
export function conditionalSentence(text: string, trigger: string): { readonly consequence: string; readonly condition: string } {
  const consequence = text.trim().replace(/[.!;:\s]+$/, "");
  let condition = trigger.trim().replace(/[.!;:\s]+$/, "").replace(/^(?:if|when|once)\s+/i, "");
  if (COMMON_START.test(condition)) condition = condition[0]!.toLowerCase() + condition.slice(1);
  return { consequence, condition };
}

/** Why a possibility could happen, as seen from one path: its causal parts and the assumptions it depends on there. */
export interface ConsequenceView {
  readonly consequence: string;
  readonly condition: string;
  readonly mechanism: string;
  readonly downstream: string;
  readonly uncertainty: string;
  /** Its assumptions with their value in this path (null = still unknown: the condition is unresolved). */
  readonly dependsOn: readonly { readonly variable: Variable; readonly value: AssumptionValue }[];
}

/** Null for possibilities without an explanation (older files, the user's own notes). */
export function consequenceView(r: Reality, b: Branch, p: Possibility): ConsequenceView | null {
  if (!p.cause) return null;
  const dependsOn = (p.about ?? []).flatMap((k) => {
    const variable = r.variables.find((v) => v.key === k);
    return variable ? [{ variable, value: b.values[k] ?? null }] : [];
  });
  return { ...conditionalSentence(p.text, p.cause.trigger), mechanism: p.cause.mechanism, downstream: p.cause.downstream, uncertainty: p.cause.uncertainty, dependsOn };
}

export function branchStory(r: Reality, b: Branch): BranchStory {
  const unlocks = new Map<string, string[]>();
  const calculated: { formula: Formula; value: ExprValue }[] = [];
  const blocked: { formula: Formula; missing: string[] }[] = [];
  const notApplicable: { formula: Formula; reason: string }[] = [];
  const failed: { formula: Formula; message: string }[] = [];
  for (const formula of r.formulas) {
    const res = evaluateFormula(r, b, formula.key);
    if (res.status === "ok") calculated.push({ formula, value: res.value });
    else if (res.status === "missing") {
      blocked.push({ formula, missing: [...res.missing] });
      for (const k of formulaInputs(r, formula.key)) if (b.values[k] === null) unlocks.set(k, [...(unlocks.get(k) ?? []), formula.label]);
    } else if (res.status === "not-applicable") notApplicable.push({ formula, reason: res.reason });
    else failed.push({ formula, message: res.message });
  }
  // What the user said does not apply here is not unknown: it is never asked for.
  const unknowns = r.variables
    .filter((v) => (b.values[v.key] ?? null) === null && !b.notApplicable?.includes(v.key))
    .map((variable) => ({ variable, unlocks: unlocks.get(variable.key) ?? [] }));
  unknowns.sort((x, y) => Number(y.unlocks.length > 0) - Number(x.unlocks.length > 0));
  const toVerify = [...new Set((b.revisits ?? []).flatMap((x) => x.questions))];
  const toFindOut = [...new Set((b.revisits ?? []).flatMap((x) => x.evidence))];
  const { changes, told } = changesFromParent(r, b);
  return {
    isStart: b.parentId === null, changes, told, known: knownView(r, b), carried: carriedOver(r, b), ...byTone(b.possibilities),
    stale: staleSuggestions(r, b), matches: factMatches(r, b), toVerify, toFindOut, unknowns, calculated, blocked, notApplicable, failed,
  };
}

/** What changed between two versions of a path (after an answer, a new fact or a context edit). Deterministic only. */
export interface ChangeSummary {
  readonly values: readonly { readonly key: string; readonly label: string; readonly unit: string; readonly from: AssumptionValue; readonly to: AssumptionValue }[];
  /** Context answers or path facts added, edited or removed (null = absent). */
  readonly facts: readonly { readonly question: string; readonly from: string | null; readonly to: string | null }[];
  /** Calculated outcomes whose result changed. Qualitative suggestions are never "recalculated". */
  readonly calculated: readonly { readonly formula: Formula; readonly from: CalculatedResult; readonly to: CalculatedResult }[];
  /** Active AI suggestions that depend on a changed value. */
  readonly dependent: readonly Possibility[];
  /** Active AI suggestions made before a fact the user just added or edited. */
  readonly madeBefore: number;
  readonly empty: boolean;
}

export function describeChange(before: { r: Reality; b: Branch }, after: { r: Reality; b: Branch }): ChangeSummary {
  const values = after.r.variables.flatMap((v) => {
    const from = before.b.values[v.key] ?? null;
    const to = after.b.values[v.key] ?? null;
    return from !== to ? [{ key: v.key, label: v.label, unit: v.unit, from, to }] : [];
  });
  const factsOf = (r: Reality, b: Branch) => [...(r.context ?? []), ...(b.facts ?? [])];
  const facts = diffFacts(factsOf(before.r, before.b), factsOf(after.r, after.b));
  const same = (x: CalculatedResult, y: CalculatedResult) => JSON.stringify(x) === JSON.stringify(y);
  const calculated = after.r.formulas.flatMap((formula) => {
    const from = evaluateFormula(before.r, before.b, formula.key);
    const to = evaluateFormula(after.r, after.b, formula.key);
    return same(from, to) ? [] : [{ formula, from, to }];
  });
  const changedKeys = new Set(values.map((x) => x.key));
  const active = after.b.possibilities.filter((p) => p.basis && !p.setAside);
  const dependent = active.filter((p) => (p.about ?? []).some((k) => changedKeys.has(k)));
  const newKnown = knownKeys(after.r, after.b).filter((k) => !knownKeys(before.r, before.b).includes(k));
  const madeBefore = newKnown.length ? active.filter((p) => newKnown.some((k) => !p.basis!.known.includes(k))).length : 0;
  return { values, facts, calculated, dependent, madeBefore, empty: !values.length && !facts.length && !calculated.length };
}

/** An assumption a suggestion could be explored through. `linked`: the AI listed it as a dependency (`about`). */
export interface RelatedAssumption {
  readonly variable: Variable;
  readonly value: AssumptionValue;
  readonly linked: boolean;
}

/** Every assumption of the map, those the suggestion is linked to first. Nothing is inferred from the text. */
export function relatedAssumptions(r: Reality, b: Branch, p: Pick<Possibility, "about">): RelatedAssumption[] {
  const linked = new Set(p.about ?? []);
  const all = r.variables.map((variable) => ({ variable, value: b.values[variable.key] ?? null, linked: linked.has(variable.key) }));
  return [...all.filter((x) => x.linked), ...all.filter((x) => !x.linked)];
}

/** What a path changes compared with the path it came from. Deterministic: nothing qualitative is recalculated. */
export interface WhatIfView {
  readonly parent: Branch;
  readonly child: Branch;
  /** Values that differ from the parent. */
  readonly changed: ChangeSummary["values"];
  /** Things the user told this path but not its parent (or told differently). */
  readonly told: ChangeSummary["facts"];
  /** Calculated outcomes whose result differs from the parent's. */
  readonly calculated: ChangeSummary["calculated"];
  /** Calculated outcomes that still cannot be worked out on the new path, and what they need. */
  readonly stillNeeds: readonly { readonly formula: Formula; readonly missing: readonly string[] }[];
  readonly hasFormulas: boolean;
  /** AI suggestions on the new path that depend on a changed value: they may no longer hold and were NOT recalculated. */
  readonly reconsider: readonly { readonly possibility: Possibility; readonly because: readonly string[] }[];
  /** AI suggestions on the new path that were made before something the user told only this path. */
  readonly madeBefore: number;
  /** Other suggestions copied to the new path without a record of what they depend on: not re-checked (see carriedOver). */
  readonly carried: readonly CarriedOver[];
}

export function whatIfView(r: Reality, childId: string): WhatIfView | null {
  const child = r.branches.find((x) => x.id === childId);
  const parent = child?.parentId ? r.branches.find((x) => x.id === child.parentId) : undefined;
  if (!child || !parent) return null;
  const s = describeChange({ r, b: parent }, { r, b: child });
  const changedKeys = new Map(s.values.map((v) => [v.key, v.label]));
  const shown = new Set(s.calculated.map((c) => c.formula.key));
  const stillNeeds = r.formulas.flatMap((formula) => {
    const res = evaluateFormula(r, child, formula.key);
    return res.status === "missing" && !shown.has(formula.key) ? [{ formula, missing: res.missing }] : [];
  });
  return {
    parent, child, changed: s.values, told: s.facts, calculated: s.calculated, stillNeeds, hasFormulas: r.formulas.length > 0,
    reconsider: s.dependent.map((possibility) => ({ possibility, because: (possibility.about ?? []).flatMap((k) => (changedKeys.has(k) ? [changedKeys.get(k)!] : [])) })),
    madeBefore: s.madeBefore, carried: carriedOver(r, child),
  };
}

export interface ForkChoice {
  readonly variable: Variable;
  readonly value: string | boolean;
  /** True when this choice reverses a decision made in this reality itself. */
  readonly changesOwnDecision: boolean;
}

/** Alternative choices (for choice and yes/no assumptions) that could start a new path from `b`. */
export function forkChoices(r: Reality, b: Branch): ForkChoice[] {
  const own = new Set(changesFromParent(r, b).changes.map((c) => c.key));
  const out: ForkChoice[] = [];
  for (const variable of r.variables) {
    const current = b.values[variable.key] ?? null;
    const values: (string | boolean)[] = variable.kind === "boolean" ? [true, false] : variable.kind === "category" ? [...variable.options] : [];
    for (const value of values) if (value !== current) out.push({ variable, value, changesOwnDecision: own.has(variable.key) });
  }
  return out.sort((x, y) => Number(y.changesOwnDecision) - Number(x.changesOwnDecision));
}

export interface ForkIdea {
  readonly variable: Variable;
  readonly value: number;
  /** "up": one more than the highest value on the map; "down": one fewer than the lowest (never zero or less). */
  readonly direction: "up" | "down";
  /** The new path's name: what it has, never the parent's name ("Three baristas", not "One barista · …"). */
  readonly name: string;
}

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** Words that end the name of the counted thing in a label: "Baristas | on duty", "Days | per week". */
const QUALIFIER = new Set(["on", "per", "in", "at", "for", "during", "working", "employed", "needed", "hired", "available", "each", "a", "an", "the", "to", "from", "of", "with", "used"]);
const IRREGULAR: Readonly<Record<string, string>> = { people: "person", children: "child", men: "man", women: "woman", staff: "staff", crew: "crew" };
const singular = (w: string) =>
  IRREGULAR[w] ?? (/ies$/.test(w) ? `${w.slice(0, -3)}y` : /(?:s|x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.slice(0, -1));

/**
 * A short, accurate name for a path with `value` of a count: "Three baristas" for "Baristas on duty", "One room" for
 * "Rooms", "Four days per week" for "Days per week at the office". The counted thing is the label's first one or two
 * words before a qualifier, when they end in a plural; a rate ("per week") is kept with it. Any other label keeps its
 * own words ("Team size: 3 people"). The parent's name is never part of it, so the name cannot contradict the value.
 */
export function countName(variable: Variable, value: number): string {
  const words = variable.label.trim().toLowerCase().replace(/^(?:number of|how many)\s+/, "").split(/\s+/);
  const end = words.findIndex((w) => QUALIFIER.has(w));
  const thing = end === -1 ? words : words.slice(0, end);
  const last = thing[thing.length - 1] ?? "";
  const plural = /^[\p{L}'-]+$/u.test(last) && (last in IRREGULAR || (/s$/.test(last) && !/ss$/.test(last)));
  if (!Number.isInteger(value) || value < 0 || thing.length === 0 || thing.length > 2 || !plural) {
    return `${variable.label.trim()}: ${value}${variable.unit.trim() ? ` ${variable.unit.trim()}` : ""}`;
  }
  const counted = value === 1 ? [...thing.slice(0, -1), singular(last)] : thing;
  const rate = end !== -1 && words[end] === "per" && words[end + 1] ? ` per ${words[end + 1]}` : "";
  return `${NUMBER_WORDS[value] ?? String(value)} ${counted.join(" ")}${rate}`;
}

/**
 * Next numbers to try from `b` for a count the map already varies: a whole-number assumption whose values on the map's
 * paths differ, the closest two by one (1 and 2 baristas, 3 and 4 rooms). One more than the highest value on the map,
 * and one fewer than the lowest while that stays above zero; never a value a path from `b` already has. Suggestions
 * only, from the map's own figures: nothing is created until the user picks one (through exploreChange).
 */
export function forkIdeas(r: Reality, b: Branch): ForkIdea[] {
  const out: ForkIdea[] = [];
  const known = (x: Branch, key: string) => {
    const v = x.values[key];
    return typeof v === "number" && !(x.notApplicable ?? []).includes(key) ? v : null;
  };
  for (const variable of r.variables) {
    if (variable.kind !== "number" || known(b, variable.key) === null) continue;
    const values = [...new Set(r.branches.flatMap((x) => { const v = known(x, variable.key); return v === null ? [] : [v]; }))].sort((p, q) => p - q);
    if (values.length < 2 || !values.every(Number.isInteger)) continue;
    if (Math.min(...values.slice(1).map((v, i) => v - values[i]!)) !== 1) continue;
    const taken = new Set(r.branches.filter((x) => x.parentId === b.id).map((x) => known(x, variable.key)));
    const up = values[values.length - 1]! + 1;
    const down = values[0]! - 1;
    if (!taken.has(up)) out.push({ variable, value: up, direction: "up", name: countName(variable, up) });
    if (down > 0 && !taken.has(down)) out.push({ variable, value: down, direction: "down", name: countName(variable, down) });
  }
  return out;
}

export interface PossibilitySplit {
  readonly onlyA: readonly Possibility[];
  readonly both: readonly Possibility[];
  readonly onlyB: readonly Possibility[];
}

export interface CompareStory {
  readonly a: Branch;
  readonly b: Branch;
  /** Assumptions that differ, where at least one side is known, or that do not apply on one side only. */
  readonly differences: readonly { readonly variable: Variable; readonly a: AssumptionValue; readonly b: AssumptionValue }[];
  /** Keys of the assumptions the user said do not apply on each path ("does not apply" is neither a value nor unknown). */
  readonly notApplicable: { readonly a: readonly string[]; readonly b: readonly string[] };
  readonly upsides: PossibilitySplit;
  readonly challenges: PossibilitySplit;
  readonly unsorted: PossibilitySplit;
  /** Calculated outcomes that are numbers on both sides, with the direct difference b − a. */
  readonly calculated: readonly { readonly formula: Formula; readonly a: number; readonly b: number; readonly difference: number }[];
  /** Calculated outcomes that cannot be set side by side as numbers (unknown input, not applicable, yes/no). */
  readonly notComparable: readonly { readonly formula: Formula; readonly a: CalculatedResult; readonly b: CalculatedResult }[];
  /** Labels of unknown assumptions that keep a calculated outcome from being compared. */
  readonly missingForCalculation: readonly string[];
  readonly unknownInBoth: readonly Variable[];
  /** Assumptions the user gave on both paths, with the same value: what they said once and both paths hold (R20A). Not a difference. */
  readonly sameInBoth: readonly { readonly variable: Variable; readonly value: AssumptionValue }[];
  /** What the user told one path and not the other (or told differently). Never turned into values. */
  readonly told: { readonly onlyA: readonly KnownFact[]; readonly onlyB: readonly KnownFact[] };
  /** Suggestions each side holds only as copies from an earlier path, not re-checked there (see carriedOver). */
  readonly carried: { readonly a: readonly CarriedOver[]; readonly b: readonly CarriedOver[] };
  /** The same possibilities grouped by the choice they speak for (see TradeOff). */
  readonly tradeOff: TradeOff;
  /** The assumptions that would let the calculated outcomes be set side by side, and which path still lacks each. */
  readonly toSettle: readonly SettleItem[];
  /** Outcomes that are not compared because they do not apply on one or both paths (an input does not apply there, or a condition is not met). */
  readonly notApplicableIn: readonly { readonly formula: Formula; readonly side: "a" | "b" | "both"; readonly reason: string }[];
  /** Outcomes that could be compared once figures are added (neither side is "does not apply"). */
  readonly waiting: readonly Formula[];
  /** For each outcome set side by side: what it uses, what it leaves out, and whether one side is all zeros. */
  readonly notes: readonly CalculationNote[];
}

/**
 * One possibility as a point in a trade-off: why it speaks for a choice ("upside": it could go well on that path;
 * "challenge": it could be hard on the OTHER path, which this choice leaves behind), and which path lists it.
 */
export interface TradeItem {
  readonly possibility: Possibility;
  readonly reason: "upside" | "challenge" | "uncertain";
  readonly from: "a" | "b" | "both";
}
/**
 * The trade-off between two paths, built only from their own possibilities: nothing is added, weighed or counted as a
 * score. `forA` is what could favour choosing A (A's upsides, then the challenges listed only for B); `forB` the
 * reverse; `eitherWay` what does not favour one side (listed for both, or could go either way). `ownA`/`ownB` count
 * the possibilities listed only for that path (not shared with the other), so a side with nothing of its own is said
 * instead of looking like a judgement.
 */
export interface TradeOff {
  readonly forA: readonly TradeItem[];
  readonly forB: readonly TradeItem[];
  readonly eitherWay: readonly TradeItem[];
  readonly ownA: number;
  readonly ownB: number;
  /**
   * The one summary of these lists, so a sentence can never contradict them: "split" when something favours a choice;
   * "same" when every possibility is listed for both paths; "unsorted" when some are listed for one path only but none
   * of those says whether it would go well or be hard (they could go either way).
   */
  readonly kind: "split" | "same" | "unsorted";
}
/** Why a calculated outcome can or cannot be read as a comparison of the two paths. */
export interface CalculationNote {
  readonly formula: Formula;
  /** The assumptions it is worked out from. */
  readonly uses: readonly Variable[];
  /** Number assumptions it leaves out whose values differ between the two paths (at least one known). */
  readonly leftOut: readonly { readonly variable: Variable; readonly a: AssumptionValue; readonly b: AssumptionValue }[];
  /** A side whose every input to it is 0 while the other side's are not: its result says only that, not what that path is like. */
  readonly allZero: "a" | "b" | null;
}
/** An assumption a calculated outcome needs before it can be compared, the paths still missing it, and what it would let be worked out. */
export interface SettleItem {
  readonly variable: Variable;
  readonly missingA: boolean;
  readonly missingB: boolean;
  /** Labels of the outcomes it is needed for. */
  readonly outcomes: readonly string[];
}

export function compareStory(r: Reality, aId: string, bId: string): CompareStory {
  const c = compareBranches(r, aId, bId);
  // Suggestions set aside after a fresh look stay in their path but are not part of the comparison.
  const same = (p: Possibility, q: Possibility) => p.text.trim().toLowerCase() === q.text.trim().toLowerCase();
  const inA = c.a.possibilities.filter((p) => !p.setAside);
  const inB = c.b.possibilities.filter((p) => !p.setAside);
  const split = (tone: Possibility["tone"]): PossibilitySplit => ({
    onlyA: inA.filter((p) => p.tone === tone && !inB.some((q) => same(p, q))),
    both: inB.filter((p) => p.tone === tone && inA.some((q) => same(p, q))),
    onlyB: inB.filter((p) => p.tone === tone && !inA.some((q) => same(p, q))),
  });
  const calculated: CompareStory["calculated"][number][] = [];
  const notComparable: CompareStory["notComparable"][number][] = [];
  const notApplicableIn: { formula: Formula; side: "a" | "b" | "both"; reason: string }[] = [];
  const waiting: Formula[] = [];
  const notes: CalculationNote[] = [];
  const missing = new Set<string>();
  // Per assumption: which side still lacks it, for which outcomes. Taken from the evaluation's own missing list, keyed by
  // the formula's inputs, so it never asks for something the calculation does not need on that side.
  const settle = new Map<string, { variable: Variable; missingA: boolean; missingB: boolean; outcomes: string[] }>();
  const valueOf = (branch: Branch, key: string) => branch.values[key] ?? null;
  for (const x of c.calculated) {
    if (x.difference !== null && x.a.status === "ok" && x.b.status === "ok") {
      calculated.push({ formula: x.formula, a: x.a.value as number, b: x.b.value as number, difference: x.difference });
      // What the number is made of, said beside it: a partial sum must not read as the whole picture.
      const inputs = formulaInputs(r, x.formula.key);
      const uses = inputs.flatMap((k) => r.variables.filter((v) => v.key === k));
      const leftOut = r.variables
        .filter((v) => v.kind === "number" && !inputs.includes(v.key) && valueOf(c.a, v.key) !== valueOf(c.b, v.key) && (valueOf(c.a, v.key) !== null || valueOf(c.b, v.key) !== null))
        .map((variable) => ({ variable, a: valueOf(c.a, variable.key), b: valueOf(c.b, variable.key) }));
      const zeros = (branch: Branch) => uses.length > 0 && uses.every((v) => valueOf(branch, v.key) === 0);
      const allZero = zeros(c.b) && !zeros(c.a) ? "b" : zeros(c.a) && !zeros(c.b) ? "a" : null;
      notes.push({ formula: x.formula, uses, leftOut, allZero });
      continue;
    }
    notComparable.push({ formula: x.formula, a: x.a, b: x.b });
    // Does not apply on a side: it is not compared, and nothing is asked for it.
    const naA = x.a.status === "not-applicable";
    const naB = x.b.status === "not-applicable";
    if (naA || naB) {
      const reason = (naB ? x.b : x.a) as { reason: string };
      notApplicableIn.push({ formula: x.formula, side: naA && naB ? "both" : naA ? "a" : "b", reason: reason.reason });
      continue;
    }
    if (x.a.status === "missing" || x.b.status === "missing") waiting.push(x.formula);
    for (const res of [x.a, x.b]) if (res.status === "missing") res.missing.forEach((m) => missing.add(m));
    for (const key of formulaInputs(r, x.formula.key)) {
      const variable = r.variables.find((v) => v.key === key);
      if (!variable) continue;
      const lacks = (res: CalculatedResult, branch: Branch) => res.status === "missing" && res.missing.includes(variable.label) && (branch.values[key] ?? null) === null;
      const inA = lacks(x.a, c.a);
      const inB = lacks(x.b, c.b);
      if (!inA && !inB) continue;
      const s = settle.get(key) ?? { variable, missingA: false, missingB: false, outcomes: [] };
      s.missingA ||= inA;
      s.missingB ||= inB;
      if (!s.outcomes.includes(x.formula.label)) s.outcomes.push(x.formula.label);
      settle.set(key, s);
    }
  }
  const upsides = split("upside");
  const challenges = split("challenge");
  const unsorted = split(undefined);
  const item = (from: TradeItem["from"], reason: TradeItem["reason"]) => (possibility: Possibility): TradeItem => ({ possibility, reason, from });
  const tradeOff: TradeOff = {
    forA: [...upsides.onlyA.map(item("a", "upside")), ...challenges.onlyB.map(item("b", "challenge"))],
    forB: [...upsides.onlyB.map(item("b", "upside")), ...challenges.onlyA.map(item("a", "challenge"))],
    eitherWay: [
      ...upsides.both.map(item("both", "upside")), ...challenges.both.map(item("both", "challenge")), ...unsorted.both.map(item("both", "uncertain")),
      ...unsorted.onlyA.map(item("a", "uncertain")), ...unsorted.onlyB.map(item("b", "uncertain")),
    ],
    ownA: upsides.onlyA.length + challenges.onlyA.length + unsorted.onlyA.length,
    ownB: upsides.onlyB.length + challenges.onlyB.length + unsorted.onlyB.length,
    kind: "same",
  };
  // One reading of the lists above, never a separate guess: something favours a side, or one-path possibilities have no
  // tone, or everything is listed for both.
  const kind: TradeOff["kind"] = tradeOff.forA.length + tradeOff.forB.length > 0 ? "split" : tradeOff.ownA + tradeOff.ownB > 0 ? "unsorted" : "same";
  const naA = new Set(c.a.notApplicable ?? []);
  const naB = new Set(c.b.notApplicable ?? []);
  return {
    a: c.a, b: c.b,
    differences: c.assumptions
      .filter((x) => (x.changed && (x.a !== null || x.b !== null)) || naA.has(x.variable.key) !== naB.has(x.variable.key))
      .map((x) => ({ variable: x.variable, a: x.a, b: x.b })),
    notApplicable: { a: [...naA], b: [...naB] },
    upsides, challenges, unsorted,
    calculated, notComparable, missingForCalculation: [...missing],
    notApplicableIn, waiting, notes,
    unknownInBoth: c.assumptions.filter((x) => x.a === null && x.b === null && !naA.has(x.variable.key) && !naB.has(x.variable.key)).map((x) => x.variable),
    sameInBoth: c.assumptions
      .filter((x) => !x.changed && x.a !== null && c.a.sources?.[x.variable.key] === "user" && c.b.sources?.[x.variable.key] === "user")
      .map((x) => ({ variable: x.variable, value: x.a })),
    told: {
      onlyA: (c.a.facts ?? []).filter((f) => !(c.b.facts ?? []).some((g) => g.id === f.id && g.answer === f.answer)),
      onlyB: (c.b.facts ?? []).filter((f) => !(c.a.facts ?? []).some((g) => g.id === f.id && g.answer === f.answer)),
    },
    carried: { a: carriedOver(r, c.a), b: carriedOver(r, c.b) },
    tradeOff: { ...tradeOff, kind },
    toSettle: [...settle.values()],
  };
}
