/**
 * Universal realities: "Git for reality".
 *
 * A Reality is a user-described situation ("What if I moved to London?") with:
 *  - variables (assumptions): numbers, choices (categories) or yes/no, each with source and uncertainty notes;
 *  - formulas: CALCULATED outcomes, plain arithmetic over variables the user wrote or reviewed;
 *  - simulations: SIMULATED outcomes from a registered, validated model, with an explicit parameter mapping;
 *  - branches: alternative realities. Each branch has its own assumption values and its own SPECULATIVE
 *    possibilities (user-authored hypotheses with the user's own likelihood judgement, never a number).
 *
 * Nothing is inferred from the question text. A value can be left unknown (null); outcomes that need it
 * report the missing assumption instead of inventing a result.
 *
 * Every operation returns new frozen objects. Each branch carries a SHA-256 fingerprint over the
 * definitions and its own content, plus the parent's fingerprint at the moment it was forked.
 */
import { getModel } from "../registry";
import { canonicalHash } from "../serialize/canonical";
import { deepFreeze } from "../util/freeze";
import { evaluateNode, ExprError, parseExpression, referencedNames, type ExprValue } from "./expr";

export const REALITY_SCHEMA = "realityfork.reality/1";
export const REALITY_BUNDLE_SCHEMA = "realityfork.realities/1";

export type VariableKind = "number" | "category" | "boolean";
export type AssumptionValue = number | string | boolean | null;

export interface Variable {
  readonly key: string;
  readonly label: string;
  readonly kind: VariableKind;
  readonly unit: string;
  /** Allowed values for categories. */
  readonly options: readonly string[];
  /** Where the value comes from (e.g. "my payslip", "illustrative guess"). */
  readonly source: string;
  /** How uncertain the value is, in the user's words. */
  readonly uncertainty: string;
}

export interface Formula {
  readonly key: string;
  readonly label: string;
  readonly expression: string;
  readonly unit: string;
  /** Optional yes/no expression; when false the outcome is "not applicable" (e.g. payback needs savings > 0). */
  readonly condition: string;
  readonly note: string;
  /** False for formulas that came with an example and have not been checked by the user yet. */
  readonly reviewed: boolean;
}

export interface SimulationLink {
  readonly key: string;
  readonly label: string;
  readonly modelId: string;
  readonly modelVersion: string;
  /** Model parameter → variable key (string) or a fixed number. */
  readonly params: Readonly<Record<string, string | number>>;
  readonly metric: string;
  readonly settings: { readonly warmup: number; readonly horizon: number };
  readonly masterSeed: number;
  readonly replications: number;
}

export type Likelihood = "not-judged" | "unlikely" | "possible" | "likely";

/** Whether a possibility would be welcome or difficult. A framing, never a probability. */
export type Tone = "upside" | "challenge";

/** What an AI suggestion was based on, so a later answer can flag it for a fresh look. */
export interface SuggestionBasis {
  /** Values of the assumptions it depends on when it was made (null = unknown then). */
  readonly values: Readonly<Record<string, AssumptionValue>>;
  /** Keys of what the user had told RealityFork at that time (see knownKeys and factKey below). */
  readonly known: readonly string[];
}

/**
 * Why a possibility could happen: a conditional hypothesis, never a prediction. The possibility's `text` is the
 * consequence itself; this records what could set it off, why, what it could change next and what would confirm,
 * weaken or reverse it.
 */
export interface CausalLink {
  /** The decision or assumption that could set it off, written to follow the word "if". */
  readonly trigger: string;
  /** Why the trigger could lead to the consequence. */
  readonly mechanism: string;
  /** What the consequence could change next; "" when nothing clear follows. */
  readonly downstream: string;
  /** What information could confirm, weaken or reverse it. */
  readonly uncertainty: string;
}

/**
 * Who wrote a possibility, when that is recorded: "user" (typed by the user) or "example" (came with an example map).
 * AI suggestions are recognised by their note (see isAiSuggestion). Possibilities saved before R18.1 record nothing,
 * and are never given a source after the fact.
 */
export type PossibilitySource = "user" | "example";

export interface Possibility {
  readonly id: string;
  readonly text: string;
  /** A judgement, never computed: the user's own, or the one an example came with. */
  readonly likelihood: Likelihood;
  readonly note: string;
  /** Optional; absent on older files, which keep their fingerprints. Hashed only when present. */
  readonly source?: PossibilitySource;
  /** Optional; absent means "not sorted". Older files have no tone and keep their fingerprints. */
  readonly tone?: Tone;
  /** Assumption keys this suggestion depends on (AI suggestions only). */
  readonly about?: readonly string[];
  /** Present on AI suggestions made since R15. */
  readonly basis?: SuggestionBasis;
  /** Why the user set it aside after a fresh look. Present = set aside; it is kept, never deleted. */
  readonly setAside?: string;
  /** Present on AI suggestions made since R16. Absent on older files and on the user's own notes. */
  readonly cause?: CausalLink;
}

/** Something the user told RealityFork. Known: it comes from the user, not from the AI. */
export interface KnownFact {
  readonly id: string;
  /** The question it answers, in plain words, or "" for something the user volunteered. */
  readonly question: string;
  readonly answer: string;
}

/**
 * The question stored with a change the user described to explore ("What if this changed?", "Explore another path").
 * It is how one canonical record of an intervention is told apart from a fact the user knows: the words are a
 * hypothetical premise for that path, never a verified fact, and are never turned into a value. Saved R17 and R18 maps
 * already use exactly this text, so the marker needs no migration.
 */
export const INTERVENTION_QUESTION = "What is different on this path?";
export const isIntervention = (f: { readonly question: string }): boolean => f.question === INTERVENTION_QUESTION;

/** Who set an assumption's value in a path. "example": an illustrative figure that came with an example map (R18). */
export type ValueSource = "user" | "ai" | "example";

/**
 * A figure the user wrote in their question and confirmed for a path (R19): the exact words, kept beside the value so
 * the unit, the period and the wording are never reconstructed. The value is the user's own what-if figure, set with
 * source "user"; it is shown with these words only while the path still holds exactly this number.
 */
export interface StatedFigure {
  readonly text: string;
  readonly value: number;
}

/** An AI re-evaluation of one path that the user approved. */
export interface RevisitRecord {
  readonly model: string;
  readonly at: string;
  /** What prompted it, in the user's terms. */
  readonly cause: string;
  readonly summary: string;
  /** Things to verify before relying on this path (never answered by the AI). */
  readonly questions: readonly string[];
  readonly evidence: readonly string[];
}

/** Where an AI-drafted map came from. Optional; realities typed in by hand have none. */
export interface RealityOrigin {
  readonly kind: "ai";
  readonly model: string;
  /** ISO time the user accepted the draft. */
  readonly acceptedAt: string;
  /** Kinds of evidence the draft said are missing. */
  readonly evidence: readonly string[];
  /** Limits of the exploration, as stated in the draft. */
  readonly limitations: readonly string[];
}

export interface Branch {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly description: string;
  readonly values: Readonly<Record<string, AssumptionValue>>;
  readonly possibilities: readonly Possibility[];
  /** Parent's fingerprint when this branch was forked. */
  readonly parentFingerprint: string | null;
  readonly fingerprint: string;
  /** Things the user told RealityFork about this path (Known). Copied when branching. */
  readonly facts?: readonly KnownFact[];
  /** Who set each value; keys without an entry predate R15. Copied when branching. */
  readonly sources?: Readonly<Record<string, ValueSource>>;
  /** Figures taken from the user's own question and confirmed for this path, by assumption key (R19). Copied when branching. */
  readonly stated?: Readonly<Record<string, StatedFigure>>;
  /** Approved AI re-evaluations of this path, oldest first. */
  readonly revisits?: readonly RevisitRecord[];
  /**
   * Assumptions the user said do not apply to this path (QA fix): not zero and not unknown. Such an assumption has no
   * value here, is not asked for, and every calculation that uses it does not apply to this path. Sorted keys; hashed
   * only when present, so older files keep their fingerprints. Never copied when branching: whether it applies to a new
   * path is the user's call there. Known gap: the AI fresh-look request (revisitRequest in revisit.ts) does not carry
   * it yet, so such an assumption reaches the AI as an unset value ("value": null), the same as one not answered.
   */
  readonly notApplicable?: readonly string[];
}

export interface Reality {
  readonly schema: typeof REALITY_SCHEMA;
  readonly id: string;
  /** The user's "What if…?" text, kept verbatim. */
  readonly question: string;
  readonly description: string;
  /** Open questions the user wants to answer. */
  readonly questions: readonly string[];
  readonly variables: readonly Variable[];
  readonly formulas: readonly Formula[];
  readonly simulations: readonly SimulationLink[];
  readonly branches: readonly Branch[];
  /** Present only for maps drafted by the AI planner and accepted by the user. */
  readonly origin?: RealityOrigin;
  /** Answers to the context questions asked before exploring (Known; apply to every path). */
  readonly context?: readonly KnownFact[];
}

export type IdGen = () => string;
export const randomRealityId: IdGen = () => {
  const g = globalThis as unknown as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } };
  if (!g.crypto?.getRandomValues) throw new Error("crypto.getRandomValues is required for random ids");
  return "r_" + [...g.crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export class RealityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealityError";
  }
}

/** The longest stretch of the user's question kept as the words of one confirmed figure. */
/** A figure's words are part of the question, so this is never below MAX_QUESTION_LENGTH (proposal.ts); a test keeps them in step. */
export const MAX_STATED_TEXT = 500;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(["and", "or", "not", "true", "false", "min", "max", "abs", "round", "if"]);

/** "Monthly food cost (£)" → "monthlyFoodCost", made unique against `taken`. */
export function keyFromLabel(label: string, taken: readonly string[]): string {
  const words = label.normalize("NFKD").replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("").slice(0, 40) || "value";
  if (/^[0-9]/.test(base)) base = `v${base}`;
  if (RESERVED.has(base)) base = `${base}Value`;
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}${i}`;
  return k;
}

// ---------- fingerprints ----------

function definitions(r: Omit<Reality, "branches">) {
  // `origin` is included only when present, so realities without it keep the fingerprints they had before it existed.
  return {
    question: r.question, description: r.description, questions: r.questions, variables: r.variables, formulas: r.formulas, simulations: r.simulations,
    ...(r.origin ? { origin: r.origin } : {}),
    ...(r.context?.length ? { context: r.context } : {}),
  };
}

export function branchFingerprint(r: Omit<Reality, "branches">, b: Omit<Branch, "fingerprint">): Promise<string> {
  return canonicalHash({
    schema: REALITY_SCHEMA,
    definitions: definitions(r),
    branch: {
      id: b.id, parentId: b.parentId, name: b.name, description: b.description, values: b.values, possibilities: b.possibilities, parentFingerprint: b.parentFingerprint,
      // R15 fields are hashed only when they hold something, so earlier files keep their fingerprints.
      ...(b.facts?.length ? { facts: b.facts } : {}),
      ...(b.sources && Object.keys(b.sources).length ? { sources: b.sources } : {}),
      // R19: hashed only when present, so every file saved before it keeps its fingerprints.
      ...(b.stated && Object.keys(b.stated).length ? { stated: b.stated } : {}),
      ...(b.revisits?.length ? { revisits: b.revisits } : {}),
      ...(b.notApplicable?.length ? { notApplicable: b.notApplicable } : {}),
    },
  });
}

async function seal(r: Omit<Reality, "branches"> & { branches: readonly Omit<Branch, "fingerprint">[] }): Promise<Reality> {
  const branches: Branch[] = [];
  for (const b of r.branches) branches.push({ ...b, fingerprint: await branchFingerprint(r, b) });
  return deepFreeze({ ...r, branches }) as Reality;
}

const strip = (b: Branch): Omit<Branch, "fingerprint"> => {
  const { fingerprint: _f, ...rest } = b;
  return rest;
};

// ---------- validation ----------

function checkValue(v: Variable, x: AssumptionValue): void {
  if (x === null) return;
  if (v.kind === "number" && !(typeof x === "number" && Number.isFinite(x))) throw new RealityError(`"${v.label}" must be a number`);
  if (v.kind === "boolean" && typeof x !== "boolean") throw new RealityError(`"${v.label}" must be yes or no`);
  if (v.kind === "category" && !(typeof x === "string" && v.options.includes(x))) throw new RealityError(`"${v.label}" must be one of: ${v.options.join(", ")}`);
}

function checkVariable(v: Variable): void {
  if (!NAME_RE.test(v.key) || RESERVED.has(v.key)) throw new RealityError(`"${v.key}" is not a usable name`);
  if (!v.label.trim()) throw new RealityError("every assumption needs a name");
  if (v.kind === "category" && (v.options.length < 1 || new Set(v.options).size !== v.options.length || v.options.some((o) => !o.trim())))
    throw new RealityError(`"${v.label}": list at least one choice, without duplicates`);
}

/** Parse a formula and check every name it uses exists. Returns the error message, or null. */
export function checkFormula(r: Pick<Reality, "variables" | "formulas">, expression: string, selfKey?: string): string | null {
  try {
    const names = referencedNames(parseExpression(expression));
    const known = new Set([...r.variables.map((v) => v.key), ...r.formulas.filter((f) => f.key !== selfKey).map((f) => f.key)]);
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length) return `unknown name${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`;
    if (selfKey && names.includes(selfKey)) return "a formula cannot use itself";
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function validate(r: Reality): void {
  const keys = [...r.variables.map((v) => v.key), ...r.formulas.map((f) => f.key), ...r.simulations.map((s) => s.key)];
  if (new Set(keys).size !== keys.length) throw new RealityError("assumption and outcome names must be unique");
  r.variables.forEach(checkVariable);
  for (const f of r.formulas) {
    if (!NAME_RE.test(f.key) || RESERVED.has(f.key)) throw new RealityError(`"${f.key}" is not a usable name`);
    const err = checkFormula(r, f.expression, f.key) ?? (f.condition.trim() ? checkFormula(r, f.condition, f.key) : null);
    if (err) throw new RealityError(`formula "${f.label}": ${err}`);
  }
  if (r.origin !== undefined) {
    const o = r.origin;
    const texts = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
    if (o.kind !== "ai" || typeof o.model !== "string" || typeof o.acceptedAt !== "string" || !texts(o.evidence) || !texts(o.limitations)) throw new RealityError("the map's origin record is malformed");
  }
  const ids = new Set<string>();
  const roots = r.branches.filter((b) => b.parentId === null);
  if (roots.length !== 1) throw new RealityError("a reality needs exactly one starting branch");
  for (const b of r.branches) {
    if (ids.has(b.id)) throw new RealityError(`duplicate branch id "${b.id}"`);
    if (b.parentId !== null && !ids.has(b.parentId)) throw new RealityError(`branch "${b.name}" refers to a parent that is missing or listed after it`);
    ids.add(b.id);
    if (!b.name.trim()) throw new RealityError("every branch needs a name");
    for (const v of r.variables) {
      if (!(v.key in b.values)) throw new RealityError(`branch "${b.name}" has no value for "${v.label}"`);
      checkValue(v, b.values[v.key]!);
    }
    for (const k of Object.keys(b.values)) if (!r.variables.some((v) => v.key === k)) throw new RealityError(`branch "${b.name}" has a value for unknown assumption "${k}"`);
    for (const p of b.possibilities) {
      if (p.tone !== undefined && p.tone !== "upside" && p.tone !== "challenge") throw new RealityError(`branch "${b.name}": "${p.text}" has an unknown tone`);
      if (p.source !== undefined && p.source !== "user" && p.source !== "example") throw new RealityError(`branch "${b.name}": "${p.text}" has an unknown source`);
      if (p.about !== undefined && !texts(p.about)) throw new RealityError(`branch "${b.name}": "${p.text}" has a malformed dependency list`);
      if (p.setAside !== undefined && (typeof p.setAside !== "string" || !p.setAside.trim())) throw new RealityError(`branch "${b.name}": "${p.text}" needs a reason for being set aside`);
      if (p.basis !== undefined && !(isRecord(p.basis.values) && texts(p.basis.known))) throw new RealityError(`branch "${b.name}": "${p.text}" has a malformed basis`);
      if (p.cause !== undefined) {
        const c = p.cause;
        const parts = isRecord(c) ? [c.trigger, c.mechanism, c.downstream, c.uncertainty] : [];
        if (parts.length !== 4 || !texts(parts) || !c.trigger.trim() || !c.mechanism.trim() || parts.some((s) => s.length > 400))
          throw new RealityError(`branch "${b.name}": "${p.text}" has a malformed explanation`);
      }
    }
    for (const f of b.facts ?? []) checkFact(f, `branch "${b.name}"`);
    for (const [k, s] of Object.entries(b.sources ?? {})) {
      if (!r.variables.some((v) => v.key === k)) throw new RealityError(`branch "${b.name}" records a source for unknown assumption "${k}"`);
      if (s !== "user" && s !== "ai" && s !== "example") throw new RealityError(`branch "${b.name}": unknown source "${String(s)}"`);
    }
    for (const [k, f] of Object.entries(b.stated ?? {})) {
      const v = r.variables.find((x) => x.key === k);
      if (!v) throw new RealityError(`branch "${b.name}" records a figure from the question for unknown assumption "${k}"`);
      if (v.kind !== "number") throw new RealityError(`branch "${b.name}": "${v.label}" is not a number, so it cannot hold a figure from the question`);
      if (!isRecord(f) || typeof f.text !== "string" || !f.text.trim() || f.text.length > MAX_STATED_TEXT || typeof f.value !== "number" || !Number.isFinite(f.value))
        throw new RealityError(`branch "${b.name}": the figure from the question for "${v.label}" is malformed`);
    }
    for (const x of b.revisits ?? []) {
      if (![x.model, x.at, x.cause, x.summary].every((s) => typeof s === "string") || !texts(x.questions) || !texts(x.evidence)) throw new RealityError(`branch "${b.name}" has a malformed re-evaluation record`);
    }
    if (b.notApplicable !== undefined) {
      const na = b.notApplicable;
      if (!texts(na) || new Set(na).size !== na.length) throw new RealityError(`branch "${b.name}" has a malformed list of what does not apply`);
      for (const k of na) {
        const v = r.variables.find((x) => x.key === k);
        if (!v) throw new RealityError(`branch "${b.name}" says an unknown assumption "${k}" does not apply`);
        // Not applying and having a value are exclusive: a value means it applies.
        if ((b.values[k] ?? null) !== null) throw new RealityError(`branch "${b.name}": "${v.label}" has a value, so it cannot also be marked as not applying`);
      }
    }
  }
  for (const f of r.context ?? []) checkFact(f, "the map's context");
}

const texts = (x: unknown): x is readonly string[] => Array.isArray(x) && x.every((s) => typeof s === "string");
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function checkFact(f: KnownFact, where: string): void {
  if (!isRecord(f) || typeof f.id !== "string" || !f.id || typeof f.question !== "string" || typeof f.answer !== "string") throw new RealityError(`${where}: something you told us is malformed`);
  if (!f.answer.trim()) throw new RealityError(`${where}: an answer cannot be empty`);
  if (f.answer.length > 500 || f.question.length > 300) throw new RealityError(`${where}: keep what you tell us under 500 characters`);
}

async function rebuild(r: Reality, patch: Partial<Omit<Reality, "schema" | "id" | "branches">> & { branches?: readonly Omit<Branch, "fingerprint">[] }): Promise<Reality> {
  const next = await seal({ ...r, ...patch, branches: patch.branches ?? r.branches.map(strip) });
  validate(next);
  return next;
}

// ---------- operations ----------

export async function createReality(input: { question: string; description?: string; startName?: string; origin?: RealityOrigin; context?: readonly KnownFact[] }, idGen: IdGen = randomRealityId): Promise<Reality> {
  const question = input.question.trim();
  if (!question) throw new RealityError("Describe the situation first");
  const r = await seal({
    schema: REALITY_SCHEMA, id: idGen(), question, description: input.description?.trim() ?? "", questions: [],
    variables: [], formulas: [], simulations: [], ...(input.origin ? { origin: input.origin } : {}),
    ...(input.context?.length ? { context: input.context } : {}),
    branches: [{ id: idGen(), parentId: null, name: input.startName?.trim() || "Today", description: "The starting reality, as things are now.", values: {}, possibilities: [], parentFingerprint: null }],
  });
  validate(r);
  return r;
}

export async function updateRealityText(r: Reality, patch: { question?: string; description?: string; questions?: readonly string[] }): Promise<Reality> {
  if (patch.question !== undefined && !patch.question.trim()) throw new RealityError("The question cannot be empty");
  return rebuild(r, { ...patch, ...(patch.questions ? { questions: patch.questions.map((q) => q.trim()).filter(Boolean) } : {}) });
}

export interface NewVariable {
  readonly label: string;
  readonly kind: VariableKind;
  readonly unit?: string;
  readonly options?: readonly string[];
  readonly source?: string;
  readonly uncertainty?: string;
  readonly key?: string;
}

/**
 * Add an assumption. Every existing branch gets `initial` (null = not known yet). `source` records who gave that value
 * (the user typing a starting value, an example's illustrative figure); it is ignored for an unknown value.
 */
export async function addVariable(r: Reality, v: NewVariable, initial: AssumptionValue = null, source?: ValueSource): Promise<Reality> {
  const taken = [...r.variables.map((x) => x.key), ...r.formulas.map((x) => x.key), ...r.simulations.map((x) => x.key)];
  const variable: Variable = {
    key: v.key ?? keyFromLabel(v.label, taken), label: v.label.trim(), kind: v.kind, unit: v.unit?.trim() ?? "",
    options: v.kind === "category" ? (v.options ?? []).map((o) => o.trim()).filter(Boolean) : [], source: v.source?.trim() ?? "", uncertainty: v.uncertainty?.trim() ?? "",
  };
  checkVariable(variable);
  checkValue(variable, initial);
  const sourced = initial !== null && source !== undefined;
  return rebuild(r, {
    variables: [...r.variables, variable],
    branches: r.branches.map((b) => ({ ...strip(b), values: { ...b.values, [variable.key]: initial }, ...(sourced ? { sources: { ...b.sources, [variable.key]: source } } : {}) })),
  });
}

export async function updateVariable(r: Reality, key: string, patch: Partial<Pick<Variable, "label" | "unit" | "source" | "uncertainty" | "options">>): Promise<Reality> {
  if (!r.variables.some((v) => v.key === key)) throw new RealityError(`no assumption "${key}"`);
  return rebuild(r, { variables: r.variables.map((v) => (v.key === key ? { ...v, ...patch } : v)) });
}

export async function removeVariable(r: Reality, key: string): Promise<Reality> {
  const users = r.formulas.filter((f) => [f.expression, f.condition].some((e) => e.trim() && referencedNames(parseExpression(e)).includes(key)));
  if (users.length) throw new RealityError(`still used by: ${users.map((f) => f.label).join(", ")}`);
  if (r.simulations.some((s) => Object.values(s.params).includes(key))) throw new RealityError("still used by a simulation");
  return rebuild(r, {
    variables: r.variables.filter((v) => v.key !== key),
    branches: r.branches.map((b) => {
      const { [key]: _drop, ...values } = b.values;
      // The value's source and its words from the question go with it.
      const without = <T,>(rec: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));
      const { stated: before, ...rest } = strip(b);
      const stated = before && key in before ? without(before) : before;
      return {
        ...rest, values,
        ...(b.sources && key in b.sources ? { sources: without(b.sources) } : {}),
        // An empty record is dropped, so a path without figures looks exactly like one that never had any.
        ...(stated && Object.keys(stated).length ? { stated } : {}),
      };
    }),
  });
}

export interface NewFormula {
  readonly label: string;
  readonly expression: string;
  readonly unit?: string;
  readonly condition?: string;
  readonly note?: string;
  readonly reviewed?: boolean;
  readonly key?: string;
}

export async function addFormula(r: Reality, f: NewFormula): Promise<Reality> {
  const taken = [...r.variables.map((x) => x.key), ...r.formulas.map((x) => x.key), ...r.simulations.map((x) => x.key)];
  const formula: Formula = {
    key: f.key ?? keyFromLabel(f.label, taken), label: f.label.trim(), expression: f.expression.trim(), unit: f.unit?.trim() ?? "",
    condition: f.condition?.trim() ?? "", note: f.note?.trim() ?? "", reviewed: f.reviewed ?? true,
  };
  if (!formula.label) throw new RealityError("Give the outcome a name");
  return rebuild(r, { formulas: [...r.formulas, formula] });
}

export async function updateFormula(r: Reality, key: string, patch: Partial<Omit<Formula, "key">>): Promise<Reality> {
  if (!r.formulas.some((f) => f.key === key)) throw new RealityError(`no outcome "${key}"`);
  return rebuild(r, { formulas: r.formulas.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
}

export async function removeFormula(r: Reality, key: string): Promise<Reality> {
  const users = r.formulas.filter((f) => f.key !== key && [f.expression, f.condition].some((e) => e.trim() && referencedNames(parseExpression(e)).includes(key)));
  if (users.length) throw new RealityError(`still used by: ${users.map((f) => f.label).join(", ")}`);
  return rebuild(r, { formulas: r.formulas.filter((f) => f.key !== key) });
}

export async function addSimulation(r: Reality, s: Omit<SimulationLink, "key"> & { key?: string }): Promise<Reality> {
  const taken = [...r.variables.map((x) => x.key), ...r.formulas.map((x) => x.key), ...r.simulations.map((x) => x.key)];
  const model = getModel(s.modelId, s.modelVersion);
  for (const p of Object.keys(model.parameters)) if (!(p in s.params)) throw new RealityError(`simulation "${s.label}": model parameter "${p}" is not mapped`);
  if (!(s.metric in model.metrics)) throw new RealityError(`simulation "${s.label}": unknown metric "${s.metric}"`);
  return rebuild(r, { simulations: [...r.simulations, { ...s, key: s.key ?? keyFromLabel(s.label, taken) }] });
}

/**
 * Fork: a new branch whose values, possibilities, known facts and value sources start as copies of the parent's.
 * What the user said does not apply to the parent is not copied: on the new path those assumptions start unknown,
 * because the change being explored may make them apply.
 */
export async function forkBranch(r: Reality, parentId: string, input: { name: string; description?: string }, idGen: IdGen = randomRealityId): Promise<{ reality: Reality; branch: Branch }> {
  const parent = r.branches.find((b) => b.id === parentId);
  if (!parent) throw new RealityError(`no branch "${parentId}"`);
  if (!input.name.trim()) throw new RealityError("Give the new reality a name");
  const id = idGen();
  const reality = await rebuild(r, {
    branches: [...r.branches.map(strip), {
      id, parentId, name: input.name.trim(), description: input.description?.trim() ?? "", values: { ...parent.values },
      possibilities: parent.possibilities.map((p) => ({ ...p })), parentFingerprint: parent.fingerprint,
      ...(parent.facts?.length ? { facts: parent.facts.map((f) => ({ ...f })) } : {}),
      ...(parent.sources && Object.keys(parent.sources).length ? { sources: { ...parent.sources } } : {}),
      ...(parent.stated && Object.keys(parent.stated).length ? { stated: Object.fromEntries(Object.entries(parent.stated).map(([k, f]) => [k, { ...f }])) } : {}),
      ...(parent.revisits?.length ? { revisits: parent.revisits.map((x) => ({ ...x })) } : {}),
    }],
  });
  return { reality, branch: reality.branches.find((b) => b.id === id)! };
}

export interface BranchPatch {
  readonly name?: string;
  readonly description?: string;
  readonly values?: Readonly<Record<string, AssumptionValue>>;
  readonly possibilities?: readonly Possibility[];
  /** Merged into the existing sources, like values. */
  readonly sources?: Readonly<Record<string, ValueSource>>;
  /** Merged into the existing figures from the question, like sources. */
  readonly stated?: Readonly<Record<string, StatedFigure>>;
  readonly facts?: readonly KnownFact[];
  readonly revisits?: readonly RevisitRecord[];
  /** Replaces the list of assumptions that do not apply to this path. A key that gets a value stops being on it. */
  readonly notApplicable?: readonly string[];
}

export async function updateBranch(r: Reality, id: string, patch: BranchPatch): Promise<Reality> {
  const b = r.branches.find((x) => x.id === id);
  if (!b) throw new RealityError(`no branch "${id}"`);
  if (patch.values) for (const k of Object.keys(patch.values)) if (!r.variables.some((v) => v.key === k)) throw new RealityError(`unknown assumption "${k}"`);
  for (const k of patch.notApplicable ?? []) if (!r.variables.some((v) => v.key === k)) throw new RealityError(`unknown assumption "${k}"`);
  return rebuild(r, {
    branches: r.branches.map((x) => {
      if (x.id !== id) return strip(x);
      const { notApplicable: _na, ...rest } = strip(x);
      const values = { ...x.values, ...patch.values };
      // A value means it applies; "does not apply" is kept only for assumptions that have none.
      const na = [...new Set(patch.notApplicable ?? x.notApplicable ?? [])].filter((k) => (values[k] ?? null) === null).sort();
      return {
        ...rest, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}),
        values, possibilities: patch.possibilities ?? x.possibilities,
        ...(patch.sources ? { sources: { ...x.sources, ...patch.sources } } : {}),
        ...(patch.stated ? { stated: { ...x.stated, ...patch.stated } } : {}),
        ...(patch.facts ? { facts: patch.facts } : {}),
        ...(patch.revisits ? { revisits: patch.revisits } : {}),
        ...(na.length ? { notApplicable: na } : {}),
      };
    }),
  });
}

/** Identity of one thing the user told RealityFork, including its current wording (an edit is new information). */
export const factKey = (f: KnownFact) => `${f.id}=${f.answer}`;

/** What the user has told RealityFork, as seen from one path: context answers plus the path's own facts. */
export function knownKeys(r: Pick<Reality, "context">, b: Pick<Branch, "facts">): string[] {
  return [...(r.context ?? []), ...(b.facts ?? [])].map(factKey);
}

/** The basis of a new AI suggestion in `b`: its dependencies' current values and what is known now. */
export function basisFor(r: Reality, b: Branch, about: readonly string[]): SuggestionBasis {
  const keys = about.filter((k) => r.variables.some((v) => v.key === k));
  return { values: Object.fromEntries(keys.map((k) => [k, b.values[k] ?? null])), known: knownKeys(r, b) };
}

/** Replace the answers to the context questions (they apply to every path). */
export async function setContext(r: Reality, context: readonly KnownFact[]): Promise<Reality> {
  const { context: _old, ...rest } = r;
  return rebuild(rest as Reality, context.length ? { context } : {});
}

/** Remove a branch and everything forked from it. The starting branch cannot be removed. */
export async function removeBranch(r: Reality, id: string): Promise<Reality> {
  const b = r.branches.find((x) => x.id === id);
  if (!b) throw new RealityError(`no branch "${id}"`);
  if (b.parentId === null) throw new RealityError("The starting reality cannot be removed");
  const gone = new Set([id]);
  for (const x of r.branches) if (x.parentId !== null && gone.has(x.parentId)) gone.add(x.id);
  return rebuild(r, { branches: r.branches.filter((x) => !gone.has(x.id)).map(strip) });
}

// ---------- outcomes ----------

export type CalculatedResult =
  | { readonly status: "ok"; readonly value: ExprValue }
  | { readonly status: "missing"; readonly missing: readonly string[] }
  | { readonly status: "not-applicable"; readonly reason: string }
  | { readonly status: "error"; readonly message: string };

/** All variables a formula needs, following references through other formulas. */
function dependencies(r: Reality, expressions: readonly string[], seen = new Set<string>()): string[] {
  const vars: string[] = [];
  for (const e of expressions) {
    if (!e.trim()) continue;
    for (const n of referencedNames(parseExpression(e))) {
      if (seen.has(n)) continue;
      seen.add(n);
      const f = r.formulas.find((x) => x.key === n);
      if (f) vars.push(...dependencies(r, [f.expression, f.condition], seen));
      else vars.push(n);
    }
  }
  return [...new Set(vars)];
}

/** Variable keys a formula needs, following references through other formulas. Empty if unknown or unparsable. */
export function formulaInputs(r: Reality, key: string): string[] {
  const f = r.formulas.find((x) => x.key === key);
  if (!f) return [];
  try {
    return dependencies(r, [f.expression, f.condition]).filter((k) => r.variables.some((v) => v.key === k));
  } catch {
    return [];
  }
}

/** True when an outcome does not apply on `b` because the user said one of its inputs does not apply there (not because a condition is unmet). */
export function notApplicableHere(r: Reality, b: Branch, key: string): boolean {
  const f = r.formulas.find((x) => x.key === key);
  if (!f || !b.notApplicable?.length) return false;
  try {
    return dependencies(r, [f.expression, f.condition]).some((k) => b.notApplicable!.includes(k));
  } catch {
    return false;
  }
}
export function evaluateFormula(r: Reality, b: Branch, key: string): CalculatedResult {
  const f = r.formulas.find((x) => x.key === key);
  if (!f) return { status: "error", message: `no outcome "${key}"` };
  try {
    const needs = dependencies(r, [f.expression, f.condition]);
    // An input the user said does not apply to this path makes the outcome not apply here: never read as zero, never asked.
    const notHere = needs.filter((k) => b.notApplicable?.includes(k));
    if (notHere.length) {
      const labels = notHere.map((k) => r.variables.find((v) => v.key === k)?.label ?? k);
      return { status: "not-applicable", reason: `${labels.join(", ")} ${labels.length === 1 ? "does" : "do"} not apply to this path` };
    }
    const missing = needs.filter((k) => b.values[k] === null || b.values[k] === undefined);
    if (missing.length) return { status: "missing", missing: missing.map((k) => r.variables.find((v) => v.key === k)?.label ?? k) };
    const stack: string[] = [];
    const resolve = (name: string): ExprValue => {
      const v = r.variables.find((x) => x.key === name);
      if (v) return b.values[name] as ExprValue;
      const g = r.formulas.find((x) => x.key === name);
      if (!g) throw new ExprError(`unknown name "${name}"`);
      if (stack.includes(name)) throw new ExprError(`formulas refer to each other in a loop (${[...stack, name].join(" → ")})`);
      stack.push(name);
      if (g.condition.trim() && evaluateNode(parseExpression(g.condition), resolve) !== true) throw new ExprError(`"${g.label}" is not applicable here`);
      const out = evaluateNode(parseExpression(g.expression), resolve);
      stack.pop();
      return out;
    };
    stack.push(key);
    if (f.condition.trim()) {
      const c = evaluateNode(parseExpression(f.condition), resolve);
      if (typeof c !== "boolean") return { status: "error", message: "the condition must be a yes/no expression" };
      if (!c) return { status: "not-applicable", reason: `the condition "${f.condition}" is not met in this reality` };
    }
    return { status: "ok", value: evaluateNode(parseExpression(f.expression), resolve) };
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
}

export interface BranchOutcomes {
  readonly calculated: readonly { readonly formula: Formula; readonly result: CalculatedResult }[];
  /** Labels of unknown assumptions that block at least one calculated outcome. */
  readonly missingAssumptions: readonly string[];
}

export function evaluateBranch(r: Reality, b: Branch): BranchOutcomes {
  const calculated = r.formulas.map((formula) => ({ formula, result: evaluateFormula(r, b, formula.key) }));
  const missing = new Set<string>();
  for (const c of calculated) if (c.result.status === "missing") c.result.missing.forEach((m) => missing.add(m));
  return { calculated, missingAssumptions: [...missing] };
}

export interface ValueChange {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly from: AssumptionValue;
  readonly to: AssumptionValue;
}

export function diffValues(r: Reality, a: Branch, b: Branch): ValueChange[] {
  return r.variables.filter((v) => a.values[v.key] !== b.values[v.key]).map((v) => ({ key: v.key, label: v.label, unit: v.unit, from: a.values[v.key] ?? null, to: b.values[v.key] ?? null }));
}

/** Something the user told RealityFork that was added, reworded or removed (null = absent on that side). */
export interface FactChange {
  readonly question: string;
  readonly from: string | null;
  readonly to: string | null;
}

/** What the user told RealityFork that differs going from `before` to `after` (matched by id). */
export function diffFacts(before: readonly KnownFact[], after: readonly KnownFact[]): FactChange[] {
  const was = new Map(before.map((f) => [f.id, f]));
  const now = new Set(after.map((f) => f.id));
  return [
    ...after.flatMap((f) => (was.get(f.id)?.answer === f.answer ? [] : [{ question: f.question, from: was.get(f.id)?.answer ?? null, to: f.answer }])),
    ...before.flatMap((f) => (now.has(f.id) ? [] : [{ question: f.question, from: f.answer, to: null }])),
  ];
}

/**
 * How path `b` differs from path `a`: assumption values, and what the user told one path but not the other (a change
 * described in the user's own words is a path fact). The one definition of "changed" used by every view.
 */
export function pathDifference(r: Reality, a: Branch, b: Branch): { readonly changes: readonly ValueChange[]; readonly told: readonly FactChange[] } {
  return { changes: diffValues(r, a, b), told: diffFacts(a.facts ?? [], b.facts ?? []) };
}

/** What differs from the parent now (values and what the user told this path), and whether the parent changed after the fork. */
export function changesFromParent(r: Reality, b: Branch): { readonly changes: readonly ValueChange[]; readonly told: readonly FactChange[]; readonly parentChangedSinceFork: boolean } {
  const parent = b.parentId ? r.branches.find((x) => x.id === b.parentId) : undefined;
  if (!parent) return { changes: [], told: [], parentChangedSinceFork: false };
  return { ...pathDifference(r, parent, b), parentChangedSinceFork: b.parentFingerprint !== null && parent.fingerprint !== b.parentFingerprint };
}

export interface RealityComparison {
  readonly a: Branch;
  readonly b: Branch;
  readonly assumptions: readonly { readonly variable: Variable; readonly a: AssumptionValue; readonly b: AssumptionValue; readonly changed: boolean }[];
  /** Direct arithmetic difference b − a when both are numbers; otherwise null. */
  readonly calculated: readonly { readonly formula: Formula; readonly a: CalculatedResult; readonly b: CalculatedResult; readonly difference: number | null }[];
  readonly possibilities: { readonly onlyA: readonly Possibility[]; readonly onlyB: readonly Possibility[]; readonly both: readonly Possibility[] };
}

export function compareBranches(r: Reality, aId: string, bId: string): RealityComparison {
  const a = r.branches.find((x) => x.id === aId);
  const b = r.branches.find((x) => x.id === bId);
  if (!a || !b) throw new RealityError("choose two branches to compare");
  const calculated = r.formulas.map((formula) => {
    const ra = evaluateFormula(r, a, formula.key);
    const rb = evaluateFormula(r, b, formula.key);
    const difference = ra.status === "ok" && rb.status === "ok" && typeof ra.value === "number" && typeof rb.value === "number" ? rb.value - ra.value : null;
    return { formula, a: ra, b: rb, difference };
  });
  const same = (p: Possibility, q: Possibility) => p.text.trim().toLowerCase() === q.text.trim().toLowerCase();
  return {
    a, b,
    assumptions: r.variables.map((variable) => ({ variable, a: a.values[variable.key] ?? null, b: b.values[variable.key] ?? null, changed: a.values[variable.key] !== b.values[variable.key] })),
    calculated,
    possibilities: {
      onlyA: a.possibilities.filter((p) => !b.possibilities.some((q) => same(p, q))),
      onlyB: b.possibilities.filter((p) => !a.possibilities.some((q) => same(p, q))),
      both: b.possibilities.filter((p) => a.possibilities.some((q) => same(p, q))),
    },
  };
}

/**
 * Adapter to the validated simulators: the scenario input for a branch, or the missing/invalid
 * assumptions. The caller runs it through the normal scenario engine, so it is reproducible.
 */
export function simulationInput(r: Reality, b: Branch, key: string):
  | { readonly ok: true; readonly input: { name: string; modelId: string; modelVersion: string; params: Record<string, number>; settings: { warmup: number; horizon: number }; masterSeed: number; replications: number } }
  | { readonly ok: false; readonly missing: readonly string[]; readonly problems: readonly string[] } {
  const s = r.simulations.find((x) => x.key === key);
  if (!s) return { ok: false, missing: [], problems: [`no simulation "${key}"`] };
  const model = getModel(s.modelId, s.modelVersion);
  const params: Record<string, number> = {};
  const missing: string[] = [];
  const problems: string[] = [];
  for (const [p, src] of Object.entries(s.params)) {
    const spec = model.parameters[p];
    if (!spec) { problems.push(`unknown model parameter "${p}"`); continue; }
    let v: AssumptionValue;
    let label = spec.label;
    if (typeof src === "number") v = src;
    else {
      const variable = r.variables.find((x) => x.key === src);
      if (!variable) { problems.push(`"${src}" is not an assumption`); continue; }
      label = variable.label;
      v = b.values[src] ?? null;
    }
    if (v === null) { missing.push(label); continue; }
    if (typeof v !== "number") { problems.push(`"${label}" must be a number for the simulation`); continue; }
    if (v < spec.min || v > spec.max || (spec.integer && !Number.isInteger(v))) { problems.push(`"${label}" = ${v} is outside what the model accepts (${spec.integer ? "whole number, " : ""}${spec.min}–${spec.max})`); continue; }
    params[p] = v;
  }
  if (missing.length || problems.length) return { ok: false, missing, problems };
  return { ok: true, input: { name: `${b.name}: ${s.label}`, modelId: s.modelId, modelVersion: s.modelVersion, params, settings: { ...s.settings }, masterSeed: s.masterSeed, replications: s.replications } };
}

// ---------- export / import ----------

export function exportRealities(realities: readonly Reality[]): string {
  return JSON.stringify({ schema: REALITY_BUNDLE_SCHEMA, realities }, null, 2);
}

/** Two copies of a map hold the same content when every branch has the same id and fingerprint. */
export function sameContent(a: Reality, b: Reality): boolean {
  return a.branches.length === b.branches.length && a.branches.every((x) => b.branches.some((y) => y.id === x.id && y.fingerprint === x.fingerprint));
}

/** What importing a file does to the maps already saved. Nothing saved is ever replaced or dropped. */
export interface ImportMerge {
  /** Every map afterwards: the saved ones first, exactly as they were, then the added ones. */
  readonly realities: readonly Reality[];
  /** Maps from the file that were not saved before: new ones, and the copies below. */
  readonly added: readonly Reality[];
  /** Maps from the file already saved with exactly this content; they are left as they are. */
  readonly unchanged: readonly Reality[];
  /** Maps from the file whose ID is saved with DIFFERENT content: kept as separate copies under a new ID, beside `of`. */
  readonly copies: readonly { readonly copy: Reality; readonly of: Reality }[];
}

/**
 * Non-destructive import. A map with an unused ID is added. A map whose ID is saved with identical content is skipped.
 * A map whose ID is saved with different content is added as a separate copy under a new ID: nothing is merged and
 * nothing is overwritten, so newer work can never be replaced by an older file. A map's ID is not part of its
 * fingerprints, so the copy keeps every branch, parent reference and fingerprint intact.
 *
 * Importing the same file twice must not pile up copies: when the ID is taken by a different version, a saved map
 * with exactly the file's content (the copy made the first time) counts as "already saved" and is left alone. Only
 * the maps that were saved before this import are compared; two look-alike maps inside one file are both kept.
 */
export function mergeImported(saved: readonly Reality[], incoming: readonly Reality[], newId: IdGen = randomRealityId): ImportMerge {
  const used = new Set([...saved.map((r) => r.id), ...incoming.map((r) => r.id)]);
  const fresh = (): string => {
    for (let i = 0; i < 100; i++) {
      const id = newId();
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new RealityError("Could not find a free ID for an imported copy");
  };
  const added: Reality[] = [];
  const unchanged: Reality[] = [];
  const copies: { copy: Reality; of: Reality }[] = [];
  for (const r of incoming) {
    const there = saved.find((x) => x.id === r.id);
    if (!there) {
      added.push(r);
      continue;
    }
    // The ID is taken. Identical content, or an earlier import of exactly this version, needs nothing more.
    const alreadySaved = sameContent(there, r) ? there : saved.find((x) => sameContent(x, r));
    if (alreadySaved) {
      unchanged.push(alreadySaved);
      continue;
    }
    const copy = deepFreeze({ ...r, id: fresh() }) as Reality;
    added.push(copy);
    copies.push({ copy, of: there });
  }
  return { realities: [...saved, ...added], added, unchanged, copies };
}

/** Validate and restore. Any branch whose fingerprint does not match its content is rejected. */
export async function importRealities(text: string): Promise<Reality[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RealityError("The file is not valid JSON");
  }
  const o = parsed as { schema?: unknown; realities?: unknown };
  if (!o || o.schema !== REALITY_BUNDLE_SCHEMA || !Array.isArray(o.realities)) throw new RealityError(`The file is not a RealityFork realities file (${REALITY_BUNDLE_SCHEMA})`);
  const out: Reality[] = [];
  const ids = new Set<string>();
  for (const raw of o.realities as Reality[]) {
    if (!raw || raw.schema !== REALITY_SCHEMA || typeof raw.id !== "string" || typeof raw.question !== "string" || !Array.isArray(raw.branches)) throw new RealityError("A reality in the file is malformed");
    if (ids.has(raw.id)) throw new RealityError(`duplicate reality id "${raw.id}"`);
    ids.add(raw.id);
    const r = await seal({
      schema: REALITY_SCHEMA, id: raw.id, question: raw.question, description: raw.description ?? "", questions: raw.questions ?? [],
      variables: raw.variables ?? [], formulas: raw.formulas ?? [], simulations: raw.simulations ?? [], branches: raw.branches.map(strip),
      ...(raw.origin !== undefined ? { origin: raw.origin } : {}),
      ...(raw.context !== undefined ? { context: raw.context } : {}),
    });
    r.branches.forEach((b, i) => {
      if (raw.branches[i]!.fingerprint !== b.fingerprint) throw new RealityError(`"${raw.question}" › "${b.name}": its fingerprint does not match its content (the file was modified)`);
    });
    validate(r);
    out.push(r);
  }
  return out;
}
