/**
 * AI-drafted scenario proposals. A proposal is only a suggestion: it is validated here, shown to the
 * user, and turned into a Reality ONLY after the user accepts it, through the normal operations.
 *
 * Factual caution is enforced structurally, not just by prompt:
 *  - proposals contain NO numeric values: every number assumption starts unknown (null);
 *  - branch settings may only pick a choice or yes/no;
 *  - formula constants are limited to unit conversions (0, 1, 2, 7, 12, 24, 30, 52, 60, 100, 365);
 *  - text that states money amounts, percentages or probabilities is rejected;
 *  - speculative possibilities carry no likelihood (they start "not judged").
 * Pure module: no network. The server adapter lives in packages/web/server/.
 */
import { parseExpression, type ExprNode } from "./expr";
import {
  addFormula,
  addVariable,
  checkFormula,
  createReality,
  forkBranch,
  keyFromLabel,
  randomRealityId,
  knownKeys,
  updateBranch,
  updateRealityText,
  type AssumptionValue,
  type CausalLink,
  type IdGen,
  type KnownFact,
  type Reality,
  type StatedFigure,
  type VariableKind,
} from "./reality";

export const PROPOSAL_SCHEMA_NAME = "realityfork_proposal";
/** Note attached to every possibility that came from an accepted AI draft. */
export const AI_POSSIBILITY_NOTE = "Suggested by the AI planner; speculative.";

export interface ProposalVariable { key: string; label: string; kind: VariableKind; unit: string; options: string[]; why: string }
export interface ProposalFormula { label: string; expression: string; unit: string; condition: string; explanation: string }
export interface ProposalBranch { name: string; description: string; settings: { variable: string; value: string }[] }
/** tone frames a possibility as welcome or difficult; "uncertain" when it could go either way. Never a probability. */
export type ProposalTone = "upside" | "challenge" | "uncertain";
/**
 * The causal parts of an AI consequence (see CausalLink in reality.ts); `downstream` may be "". Used by "Ask AI to take
 * another look" (revisit.ts). First drafts keep the shorter possibility below: R16's live check showed a draft asked for
 * causes everywhere produced fewer, more jargon-laden possibilities (docs/validation/r16-quality-results.md).
 */
export interface ConsequenceParts { text: string; trigger: string; mechanism: string; downstream: string; uncertainty: string }
/** `about`: the variable keys a possibility mainly depends on, so a later answer can flag it for a fresh look. */
export interface ProposalPossibility { branch: string; text: string; tone: ProposalTone; about: string[] }
/** A question about the person's situation, asked before exploring (at most two). */
export interface ContextQuestion { question: string; why: string; examples: string[] }
export interface Proposal {
  interpretation: string;
  /** Empty when the futures are already tailored (the user answered or nothing more would help). */
  contextQuestions: ContextQuestion[];
  branches: ProposalBranch[];
  variables: ProposalVariable[];
  questions: string[];
  formulas: ProposalFormula[];
  possibilities: ProposalPossibility[];
  missingEvidence: string[];
  limitations: string[];
}

/** What the user told RealityFork before exploring, as sent to the planner. */
export interface ContextAnswer { question: string; answer: string }
export const MAX_CONTEXT_ANSWERS = 4;
export const MAX_CONTEXT_TEXT = 200;

/** Check context answers from an untrusted request body. Returns the cleaned list or an error message. */
export function checkContextAnswers(raw: unknown): ContextAnswer[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CONTEXT_ANSWERS) return `Send at most ${MAX_CONTEXT_ANSWERS} answers.`;
  const out: ContextAnswer[] = [];
  for (const a of raw) {
    const q = typeof a?.question === "string" ? a.question.trim() : "";
    const ans = typeof a?.answer === "string" ? a.answer.trim() : "";
    if (!q || !ans || q.length > MAX_QUESTION_LENGTH || ans.length > MAX_CONTEXT_TEXT) return `Each answer needs a question and 1–${MAX_CONTEXT_TEXT} characters.`;
    out.push({ question: q, answer: ans });
  }
  return out;
}

/** The planner's user message: the situation, plus what the user told us (as facts from the user). */
export function plannerMessage(question: string, context: readonly ContextAnswer[]): string {
  if (!context.length) return `Situation: ${question}`;
  return `Situation: ${question}\nWhat the user told us (facts from the user):\n${context.map((c) => `- ${c.question} ${c.answer}`).join("\n")}`;
}

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

/** JSON Schema sent to the model (strict mode: every field required, no extra properties). */
export const PROPOSAL_JSON_SCHEMA = obj({
  interpretation: str,
  contextQuestions: { type: "array", items: obj({ question: str, why: str, examples: strArr }) },
  branches: { type: "array", items: obj({ name: str, description: str, settings: { type: "array", items: obj({ variable: str, value: str }) } }) },
  variables: { type: "array", items: obj({ key: str, label: str, kind: { type: "string", enum: ["number", "category", "boolean"] }, unit: str, options: strArr, why: str }) },
  questions: strArr,
  formulas: { type: "array", items: obj({ label: str, expression: str, unit: str, condition: str, explanation: str }) },
  possibilities: { type: "array", items: obj({ branch: str, text: str, tone: { type: "string", enum: ["upside", "challenge", "uncertain"] }, about: strArr }) },
  missingEvidence: strArr,
  limitations: strArr,
});

/** Extra limits checked locally (not all JSON Schema keywords are supported by strict decoding). */
export const PROPOSAL_LIMITS = { contextQuestions: [0, 2], branches: [2, 3], variables: [2, 10], questions: [1, 8], formulas: [0, 6], possibilities: [0, 12], missingEvidence: [1, 8], limitations: [1, 6], text: 400 } as const;
/**
 * The longest "What if…?" question, in characters, everywhere: the form, the server, a fresh look and stored figures.
 * 500 leaves room for a situation with its figures (QA: 300 cut off real decisions) at about 125 more tokens per draft.
 */
export const MAX_QUESTION_LENGTH = 500;
const ALLOWED_CONSTANTS = new Set([0, 1, 2, 7, 12, 24, 30, 52, 60, 100, 365]);
const KEY_RE = /^[a-z][A-Za-z0-9]{0,39}$/;
/** Money amounts, percentages and probability statements. */
export const FIGURE_RE = /([$£€₹¥]\s?\d)|(\d\s?(%|percent\b))|(\b\d[\d,.]*\s?(k|m|bn|million|billion|thousand|usd|eur|gbp|inr|dollars|pounds|euros|rupees)\b)|(\b(probability|chance|odds|likelihood) of \d)/i;
/**
 * Statements of eligibility, legal status or guaranteed outcomes. AI text may ASK about these (as questions to
 * verify) but must never assert them: RealityFork has no evidence to back such a claim.
 */
export const ASSERTION_RE = /\b(you(?:'re| are)? (?:eligible|entitled|qualified)|you qualify|(?:may|might|could|should|would|will) (?:be )?(?:eligible|qualif(?:y|ied))|qualif(?:y|ies) for|(?:visas?|permits?|residency) (?:is|are|will be) (?:available|granted|approved|guaranteed|easy to get)|(?:is|are) (?:legal|legally allowed|legally permitted|permitted|allowed) (?:to|in|for)|(?:is|are|will be) guaranteed|guaranteed to|definitely will|will certainly|(?:you(?:'re| are| will be|'ll be| would be| become| will become)|counts? as) (?:a )?tax[- ]resident|(?:is|are) required by law|the law requires|legally required|you (?:are|will be) legally required)\b/i;

// Research tasks and advice in the place of a consequence ("Investigate…", "You should check…"). A heuristic on how a
// sentence starts, not a semantic check: it catches the common phrasings, not every one.
const ADVICE_RE = /^(?:you\s+(?:should|ought\s+to|need\s+to|must|have\s+to|will\s+need\s+to|'ll\s+need\s+to|may\s+want\s+to|might\s+want\s+to|could\s+(?:investigate|check|consider|research|look\s+into|compare|assess|explore|try|ask|contact|consult|plan))|it(?:'s|\s+is)\s+(?:worth|important|wise|best|advisable|essential|crucial|recommended|a\s+good\s+idea)|be\s+sure\s+to|don't\s+forget|do\s+not\s+forget|remember\s+to|make\s+sure)\b/i;
/** Verbs that open an instruction, never a consequence. */
const ORDER_RE = /^(?:please\s+)?(?:investigate|check|consider|assess|compare|verify|confirm|determine|evaluate|explore|ensure|look\s+(?:into|up|for)|find\s+out|figure\s+out|work\s+out|reach\s+out|talk\s+to|speak\s+(?:to|with)|ask|consult|calculate|gather|collect|decide|prepare|seek|identify|clarify|apply\s+for|register|sign\s+up|enrol+|negotiate|discuss|learn|think\s+about|weigh|prioriti[sz]e|monitor|arrange|request|obtain|secure|create|join|find|get|try|begin|set\s+up|keep\s+track)\b(?!-)/i;
/** Words that open an instruction but can also start a noun phrase ("Budget pressure could…"): instructions only without a hedge. */
const ORDER_OR_NOUN_RE = /^(?:research|review|contact|study|estimate|plan|schedule|budget|start|track|document|list|search|visit|book|build|test|practi[cs]e|survey|map)\b(?!-)/i;
const HEDGE_RE = /\b(?:could|may|might|can|would)\b/i;

/** The stored explanation of a validated AI consequence. */
export const causeOf = (c: ConsequenceParts): CausalLink => ({ trigger: c.trigger.trim(), mechanism: c.mechanism.trim(), downstream: c.downstream.trim(), uncertainty: c.uncertainty.trim() });

/** True when `text` reads as a task or advice ("Investigate…", "You should…") rather than something that could happen. */
export function isTaskLike(text: string): boolean {
  const t = text.trim().replace(/^["'“‘]+/, "");
  return ADVICE_RE.test(t) || ORDER_RE.test(t) || (ORDER_OR_NOUN_RE.test(t) && !HEDGE_RE.test(t));
}

/**
 * Problems in one AI consequence, each prefixed with `path` so a bounded repair can drop that item:
 * a missing trigger, mechanism or uncertainty; a task or advice instead of a consequence; figures anywhere; and
 * eligibility, legal or guarantee claims in what it asserts. The trigger is always shown after "if", and the
 * uncertainty is a list of things to find out, so both may mention regulated topics conditionally.
 */
export function consequenceErrors(path: string, c: ConsequenceParts, names: readonly string[] = []): string[] {
  const errors = statementErrors(path, c.text, names);
  if (/\bif\b/i.test(c.text)) errors.push(`${path} has its own if-clause ${quote(c.text)}; the condition belongs in the trigger`);
  for (const k of ["trigger", "mechanism", "uncertainty"] as const) if (!c[k].trim()) errors.push(`${path}.${k} is empty: every consequence needs a cause; leave it out if there is none`);
  for (const k of ["trigger", "mechanism", "downstream", "uncertainty"] as const) {
    if (FIGURE_RE.test(c[k])) errors.push(`${path}.${k} states a figure ${quote(c[k])}`);
    const name = usesName(c[k], names);
    if (name) errors.push(`${path}.${k} uses the internal name "${name}"; write it in plain words`);
  }
  for (const k of ["mechanism", "downstream"] as const) if (ASSERTION_RE.test(c[k]) || RULE_RE.test(c[k])) errors.push(`${path}.${k} states eligibility, legal status or a guaranteed outcome ${quote(c[k])}; make it conditional or ask it as a question`);
  if (c.downstream.trim() && isTaskLike(c.downstream)) errors.push(`${path}.downstream is a task or advice ${quote(c.downstream)}; say what could change next, or leave it empty`);
  return errors;
}

const quote = (t: string) => `("${t.slice(0, 60)}")`;
/** Laws and official rules stated as facts ("German tax law taxes residents on worldwide income"). A phrase list. */
export const RULE_RE = /\b(?:(?:tax|immigration|employment|labou?r|residency|visa|social[- ]security|pension)\s+(?:law|laws|rules?|rates?|regulations?|treat(?:y|ies)|thresholds?)\s+(?:tax(?:es)?|apply|applies|require|requires|allow|allows|keep|keeps|make|makes|mean|means|treat|treats)|(?:keeps?|makes?) you (?:a )?non[- ]?resident|taxes residents on|taxed on (?:your |their )?worldwide income|(?:applies|apply) to (?:your |their )?worldwide income)\b/i;
const CAMEL_RE = /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/;
/** Assumption keys and choice values written as code names (camelCase); they must not appear in text shown to people. */
export function internalNames(vars: readonly { key: string; options: readonly string[] }[]): string[] {
  return [...new Set(vars.flatMap((v) => [v.key, ...v.options]).filter((n) => CAMEL_RE.test(n)))];
}
const usesName = (t: string, names: readonly string[]) => names.find((n) => new RegExp(`(^|[^A-Za-z0-9_])${n}($|[^A-Za-z0-9_])`).test(t));

/**
 * Problems in one AI statement of what could happen, prefixed with `path` so a bounded repair can drop it: empty, a
 * figure, a regulated claim or law stated as fact, a task or advice, or an internal assumption name.
 */
export function statementErrors(path: string, text: string, names: readonly string[] = []): string[] {
  const errors: string[] = [];
  if (!text.trim()) errors.push(`${path} is empty`);
  if (FIGURE_RE.test(text)) errors.push(`${path} states a figure ${quote(text)}`);
  if (ASSERTION_RE.test(text) || RULE_RE.test(text)) errors.push(`${path} states eligibility, legal status or a guaranteed outcome ${quote(text)}; make it conditional or ask it as a question`);
  if (isTaskLike(text)) errors.push(`${path} is a task or advice, not a consequence ${quote(text)}; things to find out belong in the questions`);
  const name = usesName(text, names);
  if (name) errors.push(`${path} uses the internal name "${name}"; write it in plain words`);
  return errors;
}

export const PLANNER_SYSTEM_PROMPT = [
  "You help people start exploring a hypothetical situation in RealityFork, a tool where the user branches a situation into alternative realities and compares them.",
  "Return ONLY JSON matching the schema. Write for a non-expert, in plain English.",
  "Rules you must follow:",
  "- Do NOT state any numbers, prices, salaries, costs, percentages, probabilities, statistics, dates or predictions. Never cite sources or studies. The user will supply all numbers.",
  "- In all AI-authored prose, including generated questions, never repeat, convert, or restate a user-supplied amount numerically, and never invent amounts. Use wording like \"your savings\" or \"the amount you mentioned\".",
  "- interpretation: one or two sentences restating the situation and its assumed scope. Say what you assumed.",
  "- branches: 2 or 3 materially different alternative realities to compare (for example different ways of doing it, or not doing it). They must differ in what the person decides or does, not just in wording or degree. Each has a short name (max 6 words), a one-sentence description, and settings that ONLY set category or boolean variables (value is one of that variable's options, or \"yes\"/\"no\"). Set each variable at most once per branch. Use an empty settings list if none apply.",
  "- variables: 3 to 8 assumptions that matter. key is camelCase letters and digits only. kind is number, category or boolean. unit is a plain unit like \"per month\" or \"hours per week\" (no amounts) or empty. For money, include a currency in the unit only if the user wrote one, and then exactly that currency (for example \"₹ per month\" when the user wrote ₹ or rupees); never guess a currency, for example from a place. label: plain words, never a code name like \"monthlyRent\". options: choices for category variables, otherwise empty. why: one short sentence. When amounts of money or time drive the outcome, include them as number variables (no values) so the user can enter them.",
  "- Consistency: every setting.variable must be an exact key from variables, every category setting must be one of its options, and a number variable must NEVER have a setting. If unsure, leave that branch settings list empty.",
  "- Each nonempty set of structured settings must be unique across branches, regardless of the descriptions. Use category or boolean settings to reflect genuinely distinct decisions whenever the defined variables support them. Never invent facts, amounts or arbitrary choices to make settings different.",
  "- Each possibility.branch must exactly match a branch name or be the lowercase word \"all\". Every possibility.tone must be exactly upside, challenge, or uncertain; use uncertain if its effect is mixed or unclear.",
  "- questions: 2 to 6 questions the user must answer before anything can be calculated.",
  "- formulas: 0 to 4 simple arithmetic relationships using ONLY the variable keys with + - * / and brackets, e.g. \"monthlyIncome - monthlyCosts\". You may use only the constants 12, 52, 100 or 365 for unit conversions. label: plain words like \"Profit per month\", never a code name. unit: the unit of the result when it is clear from its inputs (for example the same unit as the amounts it adds or subtracts), otherwise empty. condition is an optional yes/no expression like \"monthlyIncome > 0\" or empty. If no arithmetic is appropriate, return an empty list.",
  "- If you are not certain a formula can use only defined number keys and allowed constants, omit that formula entirely. An empty formulas list is better than an invalid calculation.",
  "- possibilities: 3 to 9 qualitative things that might happen, each linked to a branch name, or \"all\". Give each branch at least one upside and one challenge. tone is \"upside\" (would be welcome), \"challenge\" (would be difficult) or \"uncertain\" (could go either way). They are speculative; do not say how likely they are.",
  "- missingEvidence: 2 to 5 kinds of evidence the user should gather. limitations: 1 to 4 important limits of this exploration.",
  "- possibility.about: the variable keys the possibility mainly depends on (often one or two; may be empty).",
  "- Never state eligibility, legal status, visa or permit availability, tax residency, medical outcomes, official requirements or guaranteed outcomes as facts. Put them in questions or missingEvidence as things to verify.",
  "- contextQuestions: ask 0 to 2 short, natural questions about the person's own situation ONLY when the answer would clearly change which futures are worth exploring (for example where, why, or a key constraint). Give 2 to 4 short example answers each and a short why. Never ask for numbers here; numbers come later as assumptions. Still return a complete first draft in the other fields.",
  "- If the message includes 'What the user told us', those answers come from the user: tailor the interpretation, futures, assumptions and possibilities to them, never contradict them, do not invent anything beyond them, and return an empty contextQuestions list. When an answer is a guess or expectation (e.g. \"I expect…\", \"probably\"), treat it as an assumption to confirm: use it as a trigger, not as a verified fact.",
  "If the input is not a situation that can be explored, return an interpretation explaining that, two generic branches named \"As it is\" and \"Changed\", and no formulas.",
].join("\n");

export type ProposalCheck = { readonly ok: true; readonly proposal: Proposal; readonly warnings: readonly string[] } | { readonly ok: false; readonly errors: readonly string[] };

function constants(n: ExprNode, out: number[] = []): number[] {
  if (n.t === "num") out.push(n.v);
  else if (n.t === "un") constants(n.a, out);
  else if (n.t === "bin") { constants(n.a, out); constants(n.b, out); }
  else if (n.t === "call") n.args.forEach((a) => constants(a, out));
  return out;
}

/** Structural check of untrusted JSON against one of our strict schemas (strings, enums, lists, closed objects). */
export function shapeErrors(raw: unknown, schema: Record<string, unknown>, root: string, maxText: number): string[] {
  const errors: string[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  const shape = (x: unknown, s: Record<string, unknown>, path: string): void => {
    const t = s.type;
    if (t === "string") {
      if (typeof x !== "string") return void errors.push(`${path} must be text`);
      if (x.length > maxText) errors.push(`${path} is longer than ${maxText} characters`);
      if (s.enum && !(s.enum as string[]).includes(x)) errors.push(`${path} must be one of ${(s.enum as string[]).join(", ")}`);
      return;
    }
    if (t === "array") {
      if (!Array.isArray(x)) return void errors.push(`${path} must be a list`);
      x.forEach((y, i) => shape(y, s.items as Record<string, unknown>, `${path}[${i}]`));
      return;
    }
    if (!isObj(x)) return void errors.push(`${path} must be an object`);
    const props = s.properties as Record<string, Record<string, unknown>>;
    for (const k of Object.keys(x)) if (!(k in props)) errors.push(`${path}.${k} is not allowed`);
    for (const [k, sub] of Object.entries(props)) {
      if (!(k in x)) errors.push(`${path}.${k} is missing`);
      else shape(x[k], sub, `${path}.${k}`);
    }
  };
  shape(raw, schema, root);
  return errors;
}

/** Validate untrusted model output against the schema, the limits and the factual-caution rules. */
export function validateProposal(raw: unknown): ProposalCheck {
  const errors: string[] = shapeErrors(raw, PROPOSAL_JSON_SCHEMA, "proposal", PROPOSAL_LIMITS.text);
  const warnings: string[] = [];
  if (errors.length) return { ok: false, errors };
  const p = raw as unknown as Proposal;

  for (const [field, [lo, hi]] of Object.entries(PROPOSAL_LIMITS).filter(([k]) => k !== "text") as [keyof Proposal, readonly [number, number]][]) {
    const n = (p[field] as unknown[]).length;
    if (n < lo || n > hi) errors.push(`${field}: expected ${lo}–${hi} items, got ${n}`);
  }
  // Factual caution: no stated figures in any text the model wrote (formula expressions are checked separately).
  const texts: [string, string][] = [
    ["interpretation", p.interpretation],
    ...p.branches.flatMap((b, i) => [[`branches[${i}].name`, b.name], [`branches[${i}].description`, b.description]] as [string, string][]),
    ...p.variables.flatMap((v, i) => [[`variables[${i}].label`, v.label], [`variables[${i}].unit`, v.unit], [`variables[${i}].why`, v.why]] as [string, string][]),
    ...p.questions.map((q, i) => [`questions[${i}]`, q] as [string, string]),
    ...p.formulas.map((f, i) => [`formulas[${i}].explanation`, f.explanation] as [string, string]),
    ...p.missingEvidence.map((x, i) => [`missingEvidence[${i}]`, x] as [string, string]),
    ...p.limitations.map((x, i) => [`limitations[${i}]`, x] as [string, string]),
  ];
  const contextTexts: [string, string][] = p.contextQuestions.flatMap((c, i) => [
    [`contextQuestions[${i}].question`, c.question] as [string, string],
    ...c.examples.map((e, j) => [`contextQuestions[${i}].examples[${j}]`, e] as [string, string]),
  ]);
  for (const [path, t] of [...texts, ...contextTexts]) if (FIGURE_RE.test(t)) errors.push(`${path} states a figure ("${t.slice(0, 60)}"); proposals must not invent numbers`);
  for (const [path, t] of texts) if (!t.trim() && !path.endsWith(".unit")) errors.push(`${path} is empty`);
  // Assertions of eligibility or legal status are allowed only as questions or evidence to gather.
  for (const [path, t] of texts.filter(([k]) => !k.startsWith("questions") && !k.startsWith("missingEvidence")))
    if (ASSERTION_RE.test(t)) errors.push(`${path} states eligibility, legal status or a guaranteed outcome ("${t.slice(0, 60)}"); ask it as something to verify instead`);
  p.contextQuestions.forEach((c, i) => {
    if (!c.question.trim()) errors.push(`contextQuestions[${i}].question is empty`);
    if (c.examples.length > 4 || c.examples.some((e) => !e.trim() || e.length > 60)) errors.push(`contextQuestions[${i}].examples: up to 4 short examples`);
  });

  const keys = p.variables.map((v) => v.key);
  if (new Set(keys).size !== keys.length) errors.push("variable keys must be unique");
  p.variables.forEach((v, i) => {
    if (!KEY_RE.test(v.key) || ["and", "or", "not", "true", "false", "min", "max", "abs", "round", "if"].includes(v.key)) errors.push(`variables[${i}].key "${v.key}" must be camelCase letters and digits, not a reserved word`);
    if (v.kind === "category" && (v.options.length < 2 || new Set(v.options).size !== v.options.length)) errors.push(`variables[${i}] "${v.label}" needs at least two different options`);
    if (v.kind !== "category" && v.options.length) warnings.push(`options ignored for "${v.label}" (not a choice)`);
  });
  const names = p.branches.map((b) => b.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) errors.push("branch names must be different");
  p.branches.forEach((b, i) => b.settings.forEach((s, j) => {
    const v = p.variables.find((x) => x.key === s.variable);
    const at = `branches[${i}].settings[${j}]`;
    if (!v) errors.push(`${at}: unknown variable "${s.variable}"`);
    else if (v.kind === "number") errors.push(`${at}: number assumptions cannot be set by a proposal; the user enters numbers`);
    else if (v.kind === "boolean" && !["yes", "no"].includes(s.value)) errors.push(`${at}: "${v.label}" must be yes or no`);
    else if (v.kind === "category" && !v.options.includes(s.value)) errors.push(`${at}: "${s.value}" is not an option of "${v.label}"`);
    // A future cannot decide the same thing two ways. Every conflicting setting is reported, so a repair drops them all
    // instead of choosing one.
    if (b.settings.some((t, k) => k !== j && t.variable === s.variable && t.value !== s.value)) errors.push(`${at}: "${s.variable}" is set more than once with different values`);
  }));
  // Futures that make exactly the same decisions differ only in wording.
  const decisions = p.branches.map((b) => [...new Set(b.settings.map((s) => `${s.variable}=${s.value}`))].sort().join("&"));
  decisions.forEach((d, i) => {
    const first = decisions.indexOf(d);
    if (d && first < i) errors.push(`branches[${i}] makes the same decisions as branches[${first}]; futures must differ in what is decided`);
  });
  const fake = { variables: p.variables.map((v) => ({ key: v.key })), formulas: [] as { key: string }[] } as unknown as Parameters<typeof checkFormula>[0];
  p.formulas.forEach((f, i) => {
    for (const [what, e] of [["expression", f.expression], ["condition", f.condition]] as const) {
      if (what === "condition" && !e.trim()) continue;
      const err = checkFormula(fake, e);
      if (err) { errors.push(`formulas[${i}].${what}: ${err}`); continue; }
      const bad = constants(parseExpression(e)).filter((c) => !ALLOWED_CONSTANTS.has(c));
      if (bad.length) errors.push(`formulas[${i}].${what} uses the number ${bad[0]}; only unit-conversion constants are allowed`);
    }
    const used = (f.expression + " " + f.condition).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    for (const k of used) if (p.variables.find((v) => v.key === k)?.kind === "category") errors.push(`formulas[${i}] uses the choice "${k}" in arithmetic`);
  });
  const internal = internalNames(p.variables);
  const seen = new Map<string, number>();
  p.possibilities.forEach((x, i) => {
    if (x.branch !== "all" && !names.includes(x.branch.trim().toLowerCase())) errors.push(`possibilities[${i}]: unknown branch "${x.branch}"`);
    errors.push(...statementErrors(`possibilities[${i}]`, x.text, internal));
    const same = `${x.branch.trim().toLowerCase()}|${x.text.trim().toLowerCase().replace(/[.!\s]+$/, "")}`;
    if (seen.has(same)) errors.push(`possibilities[${i}] repeats possibilities[${seen.get(same)}]`);
    else seen.set(same, i);
  });
  if (errors.length) return { ok: false, errors };
  // Dependencies on unknown keys are dropped (they only mean "flag less"), not fatal.
  const dropped = p.possibilities.reduce((n, x) => n + x.about.filter((k) => !keys.includes(k)).length, 0);
  if (dropped) warnings.push(`Ignored ${dropped} dependency reference(s) to unknown assumptions.`);
  // Names written as code ("shopProfit") are shown to people, so they are turned into words ("Shop profit").
  const renamed = [...p.variables.map((v) => v.label), ...p.formulas.map((f) => f.label)].filter((l) => readableLabel(l) !== l);
  if (renamed.length) warnings.push(`Wrote ${renamed.map((l) => `“${l}” as “${readableLabel(l)}”`).join(", ")}.`);
  let proposal: Proposal = dropped ? { ...p, possibilities: p.possibilities.map((x) => ({ ...x, about: x.about.filter((k) => keys.includes(k)) })) } : p;
  if (renamed.length) {
    proposal = { ...proposal, variables: proposal.variables.map((v) => ({ ...v, label: readableLabel(v.label) })), formulas: proposal.formulas.map((f) => ({ ...f, label: readableLabel(f.label) })) };
  }
  return { ok: true, proposal, warnings };
}

/**
 * A label written as a code name, in words: "shopProfit" → "Shop profit", "monthly_sales" → "Monthly sales". Only
 * a single camelCase or snake_case word is changed (so "iPhone cost" or "YouTube" stay as they are).
 */
export function readableLabel(label: string): string {
  const t = label.trim();
  if (!/^[a-z]{2,}(?:[A-Z][a-z0-9]+)+$/.test(t) && !/^[a-z]+(?:_[a-z0-9]+)+$/.test(t)) return label;
  const words = t.split(/_|(?=[A-Z])/).map((w) => w.toLowerCase()).join(" ");
  return words[0]!.toUpperCase() + words.slice(1);
}

/** Which parts the user kept in the preview. Indexes refer to the proposal's lists. */
export interface ProposalSelection {
  readonly branches: readonly boolean[];
  readonly variables: readonly boolean[];
  readonly formulas: readonly boolean[];
  readonly possibilities: readonly boolean[];
  readonly questions: readonly boolean[];
}

export const selectAll = (p: Proposal): ProposalSelection => ({
  branches: p.branches.map(() => true), variables: p.variables.map(() => true), formulas: p.formulas.map(() => true),
  possibilities: p.possibilities.map(() => true), questions: p.questions.map(() => true),
});

/** Formulas whose variables were all kept. */
export function usableFormulas(p: Proposal, sel: ProposalSelection): boolean[] {
  const kept = new Set(p.variables.filter((_, i) => sel.variables[i]).map((v) => v.key));
  return p.formulas.map((f) => (f.expression + " " + f.condition).match(/[A-Za-z_][A-Za-z0-9_]*/g)?.filter((k) => !["if", "min", "max", "abs", "round", "and", "or", "not", "true", "false"].includes(k)).every((k) => kept.has(k)) ?? true);
}

/**
 * A figure the user wrote in their own question and then confirmed (R19), to be set on ONE of the draft's futures.
 * The AI never produces these: they come from `figurePlan` (stated.ts), which reads the question locally.
 */
export interface AppliedFigure {
  /** The draft's key for the assumption (not the key it may get in the map). */
  readonly variable: string;
  readonly value: number;
  /** The user's own words that state it, kept exactly. */
  readonly text: string;
  /** Index of the future, in the draft's list of futures. */
  readonly future: number;
}

/**
 * Convert an ACCEPTED proposal into a reality with the existing operations. Every number starts unknown, except the
 * figures the user wrote in their question and confirmed (`meta.figures`), which are set only on the futures they were
 * confirmed for, with source "user" and their own words recorded; the root and the other futures are untouched.
 * Formulas are marked "not reviewed"; possibilities start "not judged" and keep the draft's tone.
 * The draft's provenance (model, acceptance time, missing evidence, limitations) is kept in `origin`.
 */
export async function proposalToReality(
  question: string, p: Proposal, sel: ProposalSelection,
  /**
   * contextUsed: false when the draft was made WITHOUT the context answers (e.g. tailoring failed): its suggestions are then flagged for a fresh look.
   * figures: confirmed figures from the question; one that names an unknown, unkept or non-number assumption, or a future that is not kept, is dropped.
   */
  meta: { model: string; createdAt: string; context?: readonly KnownFact[]; contextUsed?: boolean; figures?: readonly AppliedFigure[] },
  idGen: IdGen = randomRealityId,
): Promise<Reality> {
  let r = await createReality({
    question, description: p.interpretation, startName: "As things are",
    origin: { kind: "ai", model: meta.model, acceptedAt: meta.createdAt, evidence: [...p.missingEvidence], limitations: [...p.limitations] },
    ...(meta.context?.length ? { context: meta.context } : {}),
  }, idGen);
  r = await updateRealityText(r, { questions: p.questions.filter((_, i) => sel.questions[i]) });
  const keyMap = new Map<string, string>();
  for (const [i, v] of p.variables.entries()) {
    if (!sel.variables[i]) continue;
    const taken = r.variables.map((x) => x.key);
    const key = taken.includes(v.key) ? keyFromLabel(v.label, taken) : v.key;
    keyMap.set(v.key, key);
    r = await addVariable(r, { key, label: v.label, kind: v.kind, unit: v.unit, options: v.kind === "category" ? v.options : [], source: "Not yet known: enter your own value.", uncertainty: v.why }, null);
  }
  const usable = usableFormulas(p, sel);
  for (const [i, f] of p.formulas.entries()) {
    if (!sel.formulas[i] || !usable[i]) continue;
    r = await addFormula(r, { label: f.label, expression: f.expression, unit: f.unit, condition: f.condition, note: f.explanation, reviewed: false });
  }
  const root = r.branches[0]!;
  const known = meta.contextUsed === false ? [] : knownKeys(r, root);
  // Each suggestion records what it depends on and what was known, as seen from the path it belongs to.
  const poss = (branch: string, values: Readonly<Record<string, AssumptionValue>>) =>
    p.possibilities.flatMap((x, i) => {
      if (!sel.possibilities[i] || x.branch.trim().toLowerCase() !== branch.trim().toLowerCase()) return [];
      const about = [...new Set(x.about.flatMap((k) => (keyMap.has(k) ? [keyMap.get(k)!] : [])))];
      return [{
        id: idGen(), text: x.text, likelihood: "not-judged" as const, note: AI_POSSIBILITY_NOTE, ...(x.tone === "uncertain" ? {} : { tone: x.tone }),
        about, basis: { values: Object.fromEntries(about.map((k) => [k, values[k] ?? null])), known },
      }];
    });
  r = await updateBranch(r, root.id, { possibilities: poss("all", root.values) });
  for (const [i, b] of p.branches.entries()) {
    if (!sel.branches[i]) continue;
    const f = await forkBranch(r, root.id, { name: b.name, description: b.description }, idGen);
    const values: Record<string, AssumptionValue> = {};
    for (const s of b.settings) {
      const k = keyMap.get(s.variable);
      const v = p.variables.find((x) => x.key === s.variable);
      if (!k || !v) continue;
      values[k] = v.kind === "boolean" ? s.value === "yes" : s.value;
    }
    // Confirmed figures from the question for THIS future only. They are set before the suggestions' basis is computed,
    // so a suggestion made when the figure was already known is not later flagged as made before it was.
    const stated: Record<string, StatedFigure> = {};
    for (const g of meta.figures ?? []) {
      if (g.future !== i || !Number.isFinite(g.value)) continue;
      const k = keyMap.get(g.variable);
      const v = p.variables.find((x) => x.key === g.variable);
      if (!k || !v || v.kind !== "number" || !g.text.trim()) continue;
      values[k] = g.value;
      stated[k] = { text: g.text, value: g.value };
    }
    const all = { ...f.branch.values, ...values };
    // Shared suggestions keep their ids; their basis is re-based on this path's own values.
    const shared = f.branch.possibilities.map((q) => (q.basis
      ? { ...q, basis: { ...q.basis, values: Object.fromEntries(Object.keys(q.basis.values).map((k) => [k, all[k] ?? null])) } }
      : q));
    r = await updateBranch(f.reality, f.branch.id, {
      values,
      // The draft chose its values to define the path: they are AI-suggested, not something the user said. The figures
      // the user wrote in their question and confirmed are the user's own.
      sources: Object.fromEntries(Object.keys(values).map((k) => [k, k in stated ? ("user" as const) : ("ai" as const)])),
      ...(Object.keys(stated).length ? { stated } : {}),
      possibilities: [...shared, ...poss(b.name, all)],
    });
  }
  return r;
}
