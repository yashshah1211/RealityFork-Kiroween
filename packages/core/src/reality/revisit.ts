/**
 * "Take another look": an AI re-evaluation of ONE path after the user told RealityFork something new.
 * The request carries only that path: the question, the approved context, the path's name, what the user said,
 * its assumptions (with who set each value) and its current suggestions. The reply is a structured suggestion,
 * validated here, previewed to the user, and applied only on approval. Nothing is overwritten: suggestions the
 * AI says may no longer hold are set aside (kept, with the reason), never deleted.
 * Pure module: no network. The server adapter lives in packages/web/server/.
 */
import { ASSERTION_RE, causeOf, consequenceErrors, FIGURE_RE, internalNames, MAX_QUESTION_LENGTH, shapeErrors, type ConsequenceParts, type ContextAnswer, type ProposalTone } from "./proposal";
import { basisFor, factKey, isIntervention, knownKeys, randomRealityId, updateBranch, type AssumptionValue, type Branch, type IdGen, type Possibility, type Reality, type ValueSource, type VariableKind } from "./reality";
import { carriedOver } from "./story";

export const REVISIT_SCHEMA_NAME = "realityfork_revisit";
export const AI_REVISIT_NOTE = "Suggested by the AI after you told RealityFork something new; speculative.";
const AI_NOTES = new Set(["Suggested by the AI planner; speculative.", AI_REVISIT_NOTE]);
export const isAiSuggestion = (p: Possibility) => AI_NOTES.has(p.note);

/**
 * Who a possibility came from, from what is recorded: "ai" (written by the AI, recognised by its note), "example" or
 * "user" (recorded when it was created, from R18.1 on), or "unrecorded" (saved earlier: nothing says who wrote it, and
 * nothing is guessed).
 */
export type PossibilityOrigin = "ai" | "example" | "user" | "unrecorded";
export const possibilityOrigin = (p: Possibility): PossibilityOrigin => (isAiSuggestion(p) ? "ai" : (p.source ?? "unrecorded"));

export interface RevisitSuggestion {
  summary: string;
  reconsider: { id: string; reason: string }[];
  /** New conditional consequences, each with its cause (see ConsequenceParts). */
  add: (ConsequenceParts & { tone: ProposalTone; about: string[] })[];
  questions: string[];
  evidence: string[];
}

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const REVISIT_JSON_SCHEMA = obj({
  summary: str,
  reconsider: { type: "array", items: obj({ id: str, reason: str }) },
  add: { type: "array", items: obj({ text: str, trigger: str, mechanism: str, downstream: str, uncertainty: str, tone: { type: "string", enum: ["upside", "challenge", "uncertain"] }, about: strArr }) },
  questions: strArr,
  evidence: strArr,
});
export const REVISIT_LIMITS = { reconsider: [0, 6], add: [0, 4], questions: [0, 4], evidence: [0, 3], text: 300 } as const;

export const REVISIT_SYSTEM_PROMPT = [
  "You help a person take a fresh look at ONE path of a hypothetical situation in RealityFork, after they told it something new.",
  "Return ONLY JSON matching the schema, in plain English for a non-expert.",
  "- The JSON you receive lists: the question, what the user told us (context and known), the path, its assumptions (value null = still unknown; source says who set it) and the current suggestions (earlier guesses).",
  "- What the user told us comes from the user: never contradict it. When it is a guess or expectation (\"I expect…\", \"probably\"), treat it as an assumption to confirm, not a verified fact. If it conflicts with the path itself, say so in the summary and add nothing that assumes both.",
  "- summary: ONE sentence starting with \"Because\" that says what the new information could change in this path.",
  "- reconsider: ids of earlier suggestions (from the list, from: ai) that may no longer hold because of the new information, each with a short reason. Do not list suggestions that still hold.",
  "- Each current suggestion says who wrote it (from): ai = an earlier AI guess; user = written by the user; example = illustrative text from a built-in example, not the user's; unrecorded = nobody recorded who wrote it, so do not assume it came from the user. inherited: true means it was copied from an earlier path and was not re-checked for this one, so never treat it as confirmed for this path.",
  "- add: 0 to 4 NEW conditional consequences for this path that follow from the new information: things that could happen, never tasks, advice or research steps (not \"Investigate…\", \"Check…\", \"Consider…\", \"Assess…\", \"Compare…\", \"Plan…\"; those belong in questions or evidence). Each has:",
  "  text: the consequence itself, without an if-clause (e.g. \"Monthly savings could shrink\"). trigger: the decision or assumption that could set it off, written to follow \"if\", in lower case unless a name (e.g. \"living costs turn out higher while your salary stays the same\"); keep unknown assumptions conditional. mechanism: one short sentence on why. downstream: what it could change next as one short sentence, or \"\" when nothing clear follows; never invent a chain. uncertainty: what could confirm, weaken or reverse it. tone: upside, challenge or uncertain (mixed or unclear). about: the assumption keys involved.",
  "  Leave a consequence out rather than invent a cause. Do not repeat the current suggestions or give generic advice.",
  "  Write every part in plain words: never use assumption keys or option codes (write \"if you become a tax resident in Germany\", not \"if taxResident is true\"). Never explain a consequence with laws, tax rules or official requirements: if a rule matters, ask about it in questions.",
  "- questions: 0 to 4 questions the user should verify before relying on this path (for example legal permission, official requirements, practical constraints). Each must be a question ending with \"?\". Never answer them yourself.",
  "- evidence: 0 to 3 kinds of evidence worth gathering.",
  "- Do NOT state numbers, costs, salaries, percentages, probabilities or statistics. Never state that the person is eligible or qualifies, that a visa or permit is available, their tax residency, a medical outcome, or that something is legal, required by law or guaranteed. Ask it as a question instead.",
].join("\n");

export interface RevisitRequest {
  question: string;
  context: ContextAnswer[];
  path: { name: string; description: string };
  known: ContextAnswer[];
  assumptions: { key: string; label: string; kind: VariableKind; unit: string; options: string[]; value: AssumptionValue; source: "user" | "ai" | "unspecified" | "unset" }[];
  /**
   * `from` is who wrote it as far as that is RECORDED (see possibilityOrigin): never "user" for an example's text or for a
   * suggestion nobody recorded a source for. `inherited`: the path holds it only because it was copied from an earlier
   * path and nothing records it as re-checked for this one (see carriedOver); omitted otherwise.
   */
  suggestions: { id: string; text: string; tone: ProposalTone; from: PossibilityOrigin; inherited?: true }[];
  change: string;
}
const ORIGINS: readonly string[] = ["ai", "user", "example", "unrecorded"];
/** Upper bound for a request body in bytes (the largest request checkRevisitRequest accepts is about 31,000 characters). */
export const MAX_REVISIT_BODY = 64_000;
const NO_CHANGE = "The user asked for a fresh look at this path.";
/** How a change the user is exploring is labelled for the AI: a premise to reason from, not something verified. */
export const HYPOTHETICAL_QUESTION = "A change being explored on this path (a hypothetical, not a known fact):";
const KEY_OK = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const showValue = (x: AssumptionValue, unit: string) => (x === null ? "unknown" : typeof x === "boolean" ? (x ? "yes" : "no") : `${x}${unit && typeof x === "number" ? ` ${unit}` : ""}`);
const sourceForRequest = (s: ValueSource | undefined): "user" | "ai" | "unspecified" => (s === "user" || s === "ai" ? s : "unspecified");

/**
 * Only the chosen path goes to the AI: no other branches, ids or fingerprints. Texts are clipped to the limits
 * of checkRevisitRequest, so a request built here always passes that check.
 */
export function revisitRequest(r: Reality, b: Branch, change: string): RevisitRequest {
  const answer = (f: { question: string; answer: string }) => ({ question: clip(f.question, 300), answer: clip(f.answer, 500) });
  // The request schema is unchanged: a change being explored goes in `known` under a question that says it is a hypothetical.
  const told = (f: { question: string; answer: string }) => (isIntervention(f) ? answer({ question: HYPOTHETICAL_QUESTION, answer: f.answer }) : answer(f));
  const inherited = new Set(carriedOver(r, b).map((c) => c.possibility.id));
  return {
    question: clip(r.question, MAX_QUESTION_LENGTH),
    context: (r.context ?? []).slice(0, 4).map(answer),
    path: { name: clip(b.name, 120), description: clip(b.description, 400) },
    known: (b.facts ?? []).slice(-10).map(told),
    assumptions: r.variables.filter((v) => KEY_OK.test(v.key)).slice(0, 12).map((v) => {
      const value = b.values[v.key] ?? null;
      return {
        key: v.key, label: clip(v.label, 120), kind: v.kind, unit: clip(v.unit, 60), options: v.options.slice(0, 10).map((o) => clip(o, 60)),
        // The request schema knows "user" and "ai"; an example's illustrative figure is sent as "unspecified".
        value: typeof value === "string" ? clip(value, 60) : value, source: value === null ? "unset" : sourceForRequest(b.sources?.[v.key]),
      };
    }),
    // Origin and inheritance are exactly what the screen shows (possibilityOrigin, carriedOver): the request never says more
    // than is recorded. Before R19 everything that was not an AI suggestion was sent as "user".
    suggestions: b.possibilities.filter((p) => !p.setAside && p.text.trim() && p.id.length <= 40).slice(0, 16)
      .map((p) => ({ id: p.id, text: clip(p.text, 400), tone: p.tone ?? "uncertain", from: possibilityOrigin(p), ...(inherited.has(p.id) ? { inherited: true as const } : {}) })),
    change: clip(change.trim(), 300) || NO_CHANGE,
  };
}

/**
 * What the user told RealityFork since this path's AI suggestions were made, in the user's own terms:
 * facts the suggestions did not know about and values that differ from what the suggestions were based on.
 * A template filled with the path's data (no inference).
 */
export function revisitCause(r: Reality, b: Branch): string {
  const based = b.possibilities.filter((p) => p.basis && !p.setAside);
  const facts = [...(r.context ?? []), ...(b.facts ?? [])].filter((f) => based.some((p) => !p.basis!.known.includes(factKey(f))));
  const keys = [...new Set(based.flatMap((p) => Object.entries(p.basis!.values).filter(([k, then]) => (b.values[k] ?? null) !== then).map(([k]) => k)))];
  const values = keys.flatMap((k) => {
    const v = r.variables.find((x) => x.key === k);
    return v ? [`${v.label}: ${showValue(b.values[k] ?? null, v.unit)}`] : [];
  });
  // A change the user is exploring is a hypothetical premise for this path, never reported to the AI as a known fact.
  const told = facts.filter((f) => !isIntervention(f));
  const exploring = facts.filter(isIntervention);
  const parts = [
    ...(told.length ? [`The user told us: ${told.map((f) => (f.question ? `${f.question} ${f.answer}` : f.answer)).join("; ")}.`] : []),
    ...(exploring.length ? [`The user is exploring this change on this path (a hypothetical, not a known fact): ${exploring.map((f) => f.answer).join("; ")}.`] : []),
    ...(values.length ? [`Now set in this path: ${values.join("; ")}.`] : []),
  ];
  return clip(parts.join(" ") || NO_CHANGE, 300);
}

/** Server-side check of a request body before anything is sent to the provider. */
export function checkRevisitRequest(raw: unknown): { ok: true; request: RevisitRequest } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  const o = raw as Partial<RevisitRequest> | null;
  const text = (x: unknown, max: number, empty = false) => typeof x === "string" && x.length <= max && (empty || x.trim().length > 0);
  const answers = (x: unknown, max: number) => Array.isArray(x) && x.length <= max && x.every((a) => a && text(a.question, 300, true) && text(a.answer, 500));
  if (!o || typeof o !== "object") return bad("Send the path as JSON.");
  if (!text(o.question, MAX_QUESTION_LENGTH)) return bad("The question is missing or too long.");
  if (!answers(o.context, 4) || !answers(o.known, 10)) return bad("Too much context, or an answer is too long.");
  if (!o.path || !text(o.path.name, 120) || !text(o.path.description, 400, true)) return bad("The path is missing.");
  if (!text(o.change, 300)) return bad("Say what changed.");
  const kinds = ["number", "category", "boolean"];
  const sources = ["user", "ai", "unspecified", "unset"];
  if (!Array.isArray(o.assumptions) || o.assumptions.length > 12 || !o.assumptions.every((a) =>
    a && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(String(a.key)) && text(a.label, 120) && kinds.includes(a.kind) && text(a.unit, 60, true) &&
    Array.isArray(a.options) && a.options.length <= 10 && a.options.every((x: unknown) => text(x, 60)) && sources.includes(a.source) &&
    (a.value === null || typeof a.value === "boolean" || (typeof a.value === "number" && Number.isFinite(a.value)) || text(a.value, 60)))) return bad("The assumptions are malformed.");
  if (!Array.isArray(o.suggestions) || o.suggestions.length > 16 || !o.suggestions.every((s) =>
    s && text(s.id, 40) && text(s.text, 400) && ["upside", "challenge", "uncertain"].includes(s.tone) && ORIGINS.includes(s.from) &&
    (s.inherited === undefined || s.inherited === true))) return bad("The suggestions are malformed.");
  // Rebuild from the checked fields only, so nothing else in the body can reach the provider.
  const pair = (a: ContextAnswer) => ({ question: a.question, answer: a.answer });
  return {
    ok: true,
    request: {
      question: o.question!, context: o.context!.map(pair), path: { name: o.path.name, description: o.path.description }, known: o.known!.map(pair),
      assumptions: o.assumptions.map((a) => ({ key: a.key, label: a.label, kind: a.kind, unit: a.unit, options: [...a.options], value: a.value, source: a.source })),
      suggestions: o.suggestions.map((s) => ({ id: s.id, text: s.text, tone: s.tone, from: s.from, ...(s.inherited === true ? { inherited: true as const } : {}) })),
      change: o.change!,
    },
  };
}

export type RevisitCheck = { readonly ok: true; readonly suggestion: RevisitSuggestion; readonly warnings: readonly string[] } | { readonly ok: false; readonly errors: readonly string[] };

/** Validate untrusted model output for a request: structure, limits, no figures, no eligibility or legal claims. */
export function validateRevisit(raw: unknown, req: RevisitRequest): RevisitCheck {
  const errors = shapeErrors(raw, REVISIT_JSON_SCHEMA, "revisit", REVISIT_LIMITS.text);
  if (errors.length) return { ok: false, errors };
  const s = raw as RevisitSuggestion;
  const warnings: string[] = [];
  for (const [field, [lo, hi]] of Object.entries(REVISIT_LIMITS).filter(([k]) => k !== "text") as [keyof RevisitSuggestion, readonly [number, number]][]) {
    const n = (s[field] as unknown[]).length;
    if (n < lo || n > hi) errors.push(`${field}: expected ${lo}–${hi} items, got ${n}`);
  }
  if (!s.summary.trim()) errors.push("summary is empty");
  // Added consequences: cause, no tasks, no figures, no claims; no repeats of what the path already holds.
  const norm = (t: string) => t.trim().toLowerCase().replace(/[.!\s]+$/, "");
  const current = new Set(req.suggestions.map((x) => norm(x.text)));
  const added = new Map<string, number>();
  const internal = internalNames(req.assumptions);
  s.add.forEach((x, i) => {
    errors.push(...consequenceErrors(`add[${i}]`, x, internal));
    if (current.has(norm(x.text))) errors.push(`add[${i}] repeats a current suggestion of this path`);
    else if (added.has(norm(x.text))) errors.push(`add[${i}] repeats add[${added.get(norm(x.text))}]`);
    else added.set(norm(x.text), i);
  });
  const asserting: [string, string][] = [["summary", s.summary], ...s.reconsider.map((x, i) => [`reconsider[${i}]`, x.reason] as [string, string])];
  const asking: [string, string][] = [...s.questions.map((q, i) => [`questions[${i}]`, q] as [string, string]), ...s.evidence.map((q, i) => [`evidence[${i}]`, q] as [string, string])];
  for (const [path, t] of [...asserting, ...asking]) if (FIGURE_RE.test(t)) errors.push(`${path} states a figure ("${t.slice(0, 60)}")`);
  for (const [path, t] of asserting) if (ASSERTION_RE.test(t)) errors.push(`${path} states eligibility, legal status or a guaranteed outcome ("${t.slice(0, 60)}"); ask it as a question instead`);
  for (const [path, t] of [...asserting, ...asking]) if (!t.trim()) errors.push(`${path} is empty`);
  s.questions.forEach((q, i) => { if (!q.trim().endsWith("?")) errors.push(`questions[${i}] must be a question ending with "?"`); });
  const aiIds = new Set(req.suggestions.filter((x) => x.from === "ai").map((x) => x.id));
  s.reconsider.forEach((x, i) => { if (!aiIds.has(x.id)) errors.push(`reconsider[${i}]: "${x.id}" is not one of this path's AI suggestions`); });
  if (errors.length) return { ok: false, errors };
  const keys = new Set(req.assumptions.map((a) => a.key));
  const dropped = s.add.reduce((n, x) => n + x.about.filter((k) => !keys.has(k)).length, 0);
  if (dropped) warnings.push(`Ignored ${dropped} dependency reference(s) to unknown assumptions.`);
  return { ok: true, suggestion: dropped ? { ...s, add: s.add.map((x) => ({ ...x, about: x.about.filter((k) => keys.has(k)) })) } : s, warnings };
}

export interface RevisitSelection { readonly add: readonly boolean[]; readonly reconsider: readonly boolean[] }
export const selectAllRevisit = (s: RevisitSuggestion): RevisitSelection => ({ add: s.add.map(() => true), reconsider: s.reconsider.map(() => true) });

/**
 * Apply an APPROVED re-evaluation to one path through the normal operations: chosen additions are added,
 * chosen reconsiderations are set aside with their reason, AI suggestions the AI saw and kept are re-based on
 * what is known now, and the re-evaluation is recorded on the path. Other paths are untouched.
 */
export async function applyRevisit(r: Reality, branchId: string, req: RevisitRequest, s: RevisitSuggestion, sel: RevisitSelection, meta: { model: string; at: string }, idGen: IdGen = randomRealityId): Promise<Reality> {
  const b = r.branches.find((x) => x.id === branchId);
  if (!b) throw new Error("That path no longer exists.");
  const reasons = new Map(s.reconsider.filter((_, i) => sel.reconsider[i]).map((x) => [x.id, x.reason]));
  const reviewed = new Set(req.suggestions.map((x) => x.id));
  const current = knownKeys(r, b);
  const kept: Possibility[] = b.possibilities.map((p) => {
    if (reasons.has(p.id) && !p.setAside) return { ...p, setAside: reasons.get(p.id)! };
    if (reviewed.has(p.id) && p.basis && !p.setAside) return { ...p, basis: { ...basisFor(r, b, p.about ?? []), known: current } }; // seen by the AI with what is known now
    return p;
  });
  const added: Possibility[] = s.add.filter((_, i) => sel.add[i]).map((x) => {
    const about = x.about.filter((k) => r.variables.some((v) => v.key === k));
    return { id: idGen(), text: x.text, likelihood: "not-judged", note: AI_REVISIT_NOTE, ...(x.tone === "uncertain" ? {} : { tone: x.tone }), about, basis: basisFor(r, b, about), cause: causeOf(x) };
  });
  return updateBranch(r, branchId, {
    possibilities: [...kept, ...added],
    revisits: [...(b.revisits ?? []), { model: meta.model, at: meta.at, cause: req.change, summary: s.summary, questions: [...s.questions], evidence: [...s.evidence] }],
  });
}
