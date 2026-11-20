/**
 * Server-side GroqCloud adapter for the AI scenario planner (Node only; never bundled for the browser).
 *
 * - The API key is read from the server environment (GROQ_API_KEY, e.g. from an ignored .env.local).
 *   It is never sent to the browser, logged, or included in error messages.
 * - Only free-tier GPT-OSS models are allowed. No billing, no paid endpoints.
 * - Two request types share ONE limiter: drafts (`plan`, optionally with the user's context answers) and
 *   re-evaluations of one path (`revisit`). Every request is user-initiated in the UI.
 * - Limits: question ≤ MAX_QUESTION_LENGTH (500) characters; ≤ 1 generation per 10 s and ≤ 20 per hour per server process;
 *   max_completion_tokens 3000 (plan) / 2000 (revisit, whose consequences carry their causes since R16); 45 s timeout; at most ONE automatic retry, and only when
 *   the reply fails validation. Rate-limit (429) and quota errors are never retried; they are reported with the wait time.
 */
import {
  checkContextAnswers,
  checkRevisitRequest,
  MAX_QUESTION_LENGTH,
  MAX_REVISIT_BODY,
  PLANNER_SYSTEM_PROMPT,
  plannerMessage,
  PROPOSAL_JSON_SCHEMA,
  PROPOSAL_SCHEMA_NAME,
  REVISIT_JSON_SCHEMA,
  REVISIT_LIMITS,
  REVISIT_SCHEMA_NAME,
  REVISIT_SYSTEM_PROMPT,
  validateProposal,
  validateRevisit,
  type Proposal,
  type RevisitRequest,
  type RevisitSuggestion,
} from "@realityfork/core";

/** Request body limits in bytes for the two endpoints (checked before parsing). */
export const BODY_LIMITS = { "/api/plan": 8_000, "/api/revisit": MAX_REVISIT_BODY } as const;
export const ALLOWED_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] as const;
export const DEFAULT_MODEL = "openai/gpt-oss-120b";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type FailCode = "no-key" | "bad-input" | "local-limit" | "rate-limited" | "quota" | "provider-error" | "invalid-output" | "timeout"
  | "judge-required" | "judge-unavailable" | "judge-origin" | "judge-invite" | "judge-login-limit";
export type Failure = { readonly ok: false; readonly status: number; readonly code: FailCode; readonly message: string; readonly retryAfterSeconds?: number; readonly errors?: readonly string[]; readonly rateLimit?: Record<string, string> };
export type ReserveAttempt = (tokens: number) => Failure | null;
type Success<K extends string, T> = { readonly ok: true; readonly warnings: readonly string[]; readonly model: string; readonly attempts: number; readonly usage: unknown; readonly ms: number; readonly rateLimit: Record<string, string> } & { readonly [k in K]: T };
export type PlanResult = Success<"proposal", Proposal> | Failure;
export type RevisitResult = Success<"suggestion", RevisitSuggestion> | Failure;

export interface PlannerOptions {
  readonly apiKey: string | undefined;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly minIntervalMs?: number;
  readonly maxPerHour?: number;
  /** 2 = one retry on invalid output (default). The live smoke test uses 1. */
  readonly maxAttempts?: number;
}

const RL_HEADERS = ["x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens", "retry-after"];
const rateHeaders = (h: Headers) => Object.fromEntries(RL_HEADERS.flatMap((k) => (h.get(k) ? [[k, h.get(k)!]] : [])));
const record = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Preserve a useful draft when ONLY optional AI-suggested details failed validation.
 * Never synthesize figures, redirect a possibility to a different branch, or bypass
 * validateProposal. The final proposal still passes the exact browser-side validator.
 *
 * We may remove an invalid formula/setting/possibility/context question, or turn an invalid tone into
 * "uncertain" (which has no positive/negative judgement). Everything else is fatal.
 */
export function validateProviderProposal(raw: unknown): ReturnType<typeof validateProposal> {
  let current: unknown = raw;
  const adjustments: string[] = [];

  // The shape validator returns early on missing/invalid enum fields. Re-validate after
  // each strictly limited repair so later semantic errors cannot slip through unnoticed.
  for (let pass = 0; pass < 4; pass++) {
    const check = validateProposal(current);
    if (check.ok) return adjustments.length
      ? { ok: true, proposal: check.proposal, warnings: [...check.warnings, ...adjustments] }
      : check;
    if (!record(current) || !Array.isArray(current.branches) || !Array.isArray(current.formulas) || !Array.isArray(current.possibilities)) return check;

    const discardFormulas = new Set<number>();
    const discardPossibilities = new Set<number>();
    const why = new Map<number, DropReason>();
    const discardContext = new Set<number>();
    let truncateContext = false;
    const neutralTones = new Set<number>();
    const discardSettings = new Map<number, Set<number>>();
    for (const reported of check.errors) {
      // Structural errors have a "proposal." prefix; semantic errors do not.
      const error = reported.startsWith("proposal.") ? reported.slice("proposal.".length) : reported;
      let m: RegExpExecArray | null;
      if ((m = /^formulas\[(\d+)\](?:[.: ]|$)/.exec(error))) {
        discardFormulas.add(Number(m[1]));
      } else if ((m = /^branches\[(\d+)\]\.settings\[(\d+)\]/.exec(error))) {
        const branch = Number(m[1]);
        const drops = discardSettings.get(branch) ?? new Set<number>();
        drops.add(Number(m[2]));
        discardSettings.set(branch, drops);
      } else if ((m = /^possibilities\[(\d+)\]\.tone (?:must be one of|is missing|must be text)/.exec(error))) {
        neutralTones.add(Number(m[1]));
      } else if ((m = /^possibilities\[(\d+)\](?:[.: ]|$)/.exec(error))) {
        discardPossibilities.add(Number(m[1]));
        why.set(Number(m[1]), dropReason(error, why.get(Number(m[1]))));
      } else if ((m = /^contextQuestions\[(\d+)\](?:[.: ]|$)/.exec(error))) {
        discardContext.add(Number(m[1]));
      } else if (/^contextQuestions: expected/.test(error)) {
        truncateContext = true;
      } else {
        // Required fields, invented figures or eligibility claims in essential text, duplicate branch names,
        // and invalid assumption definitions remain hard failures.
        return check;
      }
    }
    if (!discardFormulas.size && !discardPossibilities.size && !neutralTones.size && !discardSettings.size && !discardContext.size && !truncateContext) return check;
    const context = Array.isArray(current.contextQuestions) ? current.contextQuestions.filter((_, i) => !discardContext.has(i)) : current.contextQuestions;
    current = {
      ...current,
      ...(Array.isArray(context) ? { contextQuestions: truncateContext ? context.slice(0, 2) : context } : {}),
      formulas: current.formulas.filter((_, i) => !discardFormulas.has(i)),
      possibilities: current.possibilities.flatMap((p, i) => {
        if (discardPossibilities.has(i)) return [];
        if (neutralTones.has(i)) return record(p) ? [{ ...p, tone: "uncertain" }] : [];
        return [p];
      }),
      branches: current.branches.map((b, i) => {
        const drops = discardSettings.get(i);
        if (!drops || !record(b) || !Array.isArray(b.settings)) return b;
        return { ...b, settings: b.settings.filter((_: unknown, j: number) => !drops.has(j)) };
      }),
    };
    if (discardFormulas.size) adjustments.push("Left out invalid AI-suggested formulas.");
    if (discardSettings.size) adjustments.push("Left out inconsistent AI-suggested branch choices.");
    adjustments.push(...dropNotes([...why.values()]));
    if (neutralTones.size) adjustments.push("Some unclear upsides/challenges were marked uncertain.");
    if (discardContext.size || truncateContext) adjustments.push("Left out context questions that failed checks.");
  }
  // Never accept a partial proposal if any errors remain after bounded repair.
  return validateProposal(current);
}

type DropReason = "task" | "claim" | "cause" | "name" | "other";
/** Why a suggestion was left out, most important reason first. */
function dropReason(error: string, previous?: DropReason): DropReason {
  const now: DropReason = /is a task or advice/.test(error) ? "task"
    : /states eligibility/.test(error) ? "claim"
    : /\.(?:trigger|mechanism|uncertainty)(?: is empty| is missing)|\.downstream is missing/.test(error) ? "cause"
    : /uses the internal name/.test(error) ? "name" : "other";
  const rank = { task: 0, claim: 1, cause: 2, name: 3, other: 4 } as const;
  return previous && rank[previous] < rank[now] ? previous : now;
}
/** Disclosed adjustments, by reason and count only: never the model's text or the user's input. */
function dropNotes(reasons: readonly DropReason[]): string[] {
  const n = (r: DropReason) => reasons.filter((x) => x === r).length;
  const s = (k: number) => (k === 1 ? "" : "s");
  return [
    ...(n("task") ? [`Left out ${n("task")} suggestion${s(n("task"))} that ${n("task") === 1 ? "was a research task" : "were research tasks"}, not a possible consequence. Things to find out stay in the questions.`] : []),
    ...(n("claim") ? [`Left out ${n("claim")} suggestion${s(n("claim"))} that stated a rule, eligibility or a guarantee as fact. Rules to check stay in the questions.`] : []),
    ...(n("cause") ? [`Left out ${n("cause")} suggestion${s(n("cause"))} without a clear cause.`] : []),
    ...(n("name") ? [`Left out ${n("name")} suggestion${s(n("name"))} written with internal names instead of plain words.`] : []),
    ...(n("other") ? ["Left out speculative claims that failed checks."] : []),
  ];
}

/** Same bounded repair for a re-evaluation: optional items may be dropped; a bad summary is fatal. */
export function validateProviderRevisit(raw: unknown, req: RevisitRequest): ReturnType<typeof validateRevisit> {
  let current: unknown = raw;
  const adjustments: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const check = validateRevisit(current, req);
    if (check.ok) return adjustments.length ? { ok: true, suggestion: check.suggestion, warnings: [...check.warnings, ...adjustments] } : check;
    if (!record(current)) return check;
    type Field = "add" | "reconsider" | "questions" | "evidence";
    const drop: Record<Field, Set<number>> = { add: new Set(), reconsider: new Set(), questions: new Set(), evidence: new Set() };
    const over = new Set<Field>();
    const whyAdd = new Map<number, DropReason>();
    for (const reported of check.errors) {
      const error = reported.startsWith("revisit.") ? reported.slice("revisit.".length) : reported;
      let m: RegExpExecArray | null;
      if ((m = /^(add|reconsider|questions|evidence)\[(\d+)\]/.exec(error))) {
        drop[m[1] as Field].add(Number(m[2]));
        if (m[1] === "add") whyAdd.set(Number(m[2]), dropReason(error, whyAdd.get(Number(m[2]))));
      } else if ((m = /^(add|reconsider|questions|evidence): expected/.exec(error))) over.add(m[1] as Field);
      else return check;
    }
    const next: Record<string, unknown> = { ...current };
    for (const k of Object.keys(drop) as Field[]) {
      const list = Array.isArray(current[k]) ? (current[k] as unknown[]).filter((_, i) => !drop[k].has(i)) : current[k];
      next[k] = over.has(k) && Array.isArray(list) ? list.slice(0, REVISIT_LIMITS[k][1]) : list;
    }
    current = next;
    adjustments.push(...dropNotes([...whyAdd.values()]));
    if (drop.reconsider.size + drop.questions.size + drop.evidence.size + over.size) adjustments.push("Left out AI suggestions that failed checks.");
  }
  return validateRevisit(current, req);
}

export function createPlanner(o: PlannerOptions) {
  const model = o.model ?? DEFAULT_MODEL;
  if (!(ALLOWED_MODELS as readonly string[]).includes(model)) throw new Error(`model "${model}" is not an allowed free-tier GPT-OSS model`);
  const doFetch = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const minInterval = o.minIntervalMs ?? 10_000;
  const maxPerHour = o.maxPerHour ?? 20;
  const maxAttempts = Math.min(Math.max(o.maxAttempts ?? 2, 1), 2);
  const history: number[] = [];

  const admit = (): Failure | null => {
    if (!o.apiKey) return { ok: false, status: 503, code: "no-key", message: "The AI planner is not configured on this computer (GROQ_API_KEY is not set). You can still build the reality by hand." };
    const t = now();
    while (history.length && t - history[0]! > 3_600_000) history.shift();
    const last = history[history.length - 1];
    if (last !== undefined && t - last < minInterval) return { ok: false, status: 429, code: "local-limit", message: "Please wait a few seconds between suggestions.", retryAfterSeconds: Math.ceil((minInterval - (t - last)) / 1000) };
    if (history.length >= maxPerHour) return { ok: false, status: 429, code: "local-limit", message: `This prototype allows ${maxPerHour} suggestions per hour. Try again later or continue by hand.`, retryAfterSeconds: Math.ceil((3_600_000 - (t - history[0]!)) / 1000) };
    history.push(t);
    return null;
  };

  /** One generation: at most `maxAttempts` provider calls, retrying only for output that fails validation. */
  async function generate<T>(
    messages: { role: string; content: string }[],
    schema: { name: string; schema: unknown; maxTokens: number },
    check: (parsed: unknown) => { ok: true; value: T; warnings: readonly string[] } | { ok: false; errors: readonly string[] },
    reserve?: ReserveAttempt,
  ): Promise<{ ok: true; value: T; warnings: readonly string[]; attempts: number; usage: unknown; ms: number; rateLimit: Record<string, string> } | Failure> {
    const t = now();
    let feedback: string | null = null;
    let lastErrors: readonly string[] = [];
    let lastRate: Record<string, string> = {};
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const body = JSON.stringify({
        model,
        messages: [...messages, ...(feedback ? [{ role: "user", content: `Your previous answer broke these rules; answer again and fix them:\n${feedback}` }] : [])],
        response_format: { type: "json_schema", json_schema: { name: schema.name, strict: true, schema: schema.schema } },
        temperature: 0.4,
        max_completion_tokens: schema.maxTokens,
        reasoning_effort: "low",
      });
      // Budget the full wire payload as UTF-8 bytes plus template overhead and the full completion cap.
      const blocked = reserve?.(Buffer.byteLength(body) + 512 + schema.maxTokens);
      if (blocked) return blocked;
      let res: Response;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 45_000);
      try {
        res = await doFetch(ENDPOINT, {
          method: "POST",
          signal: ctl.signal,
          headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
          body,
        });
      } catch (e) {
        const aborted = (e as Error).name === "AbortError";
        return { ok: false, status: aborted ? 504 : 502, code: aborted ? "timeout" : "provider-error", message: aborted ? "The AI provider did not answer in time." : "Could not reach the AI provider." };
      } finally {
        clearTimeout(timer);
      }
      lastRate = rateHeaders(res.headers);
      if (res.status === 429) {
        const body = await res.text().catch(() => "");
        const retry = Number(res.headers.get("retry-after") ?? "") || undefined;
        const daily = /per day|TPD|RPD/i.test(body);
        return {
          ok: false, status: 429, code: daily ? "quota" : "rate-limited", rateLimit: lastRate, ...(retry ? { retryAfterSeconds: retry } : {}),
          message: daily ? "The free daily allowance for the AI planner is used up. It resets automatically; you can keep working by hand meanwhile." : `The free tier is busy for this account. Try again${retry ? ` in about ${retry} s` : " shortly"}, or continue by hand.`,
        };
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).split(o.apiKey!).join("[redacted]").replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300);
        return { ok: false, status: 502, code: "provider-error", message: `The AI provider returned an error (HTTP ${res.status}). ${body}`, rateLimit: lastRate };
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "");
      } catch {
        parsed = null;
      }
      const c = check(parsed);
      if (c.ok) return { ok: true, value: c.value, warnings: c.warnings, attempts: attempt, usage: data.usage ?? null, ms: now() - t, rateLimit: lastRate };
      lastErrors = c.errors;
      feedback = c.errors.slice(0, 12).join("\n");
    }
    return { ok: false, status: 422, code: "invalid-output", message: "The AI suggestion did not pass RealityFork's checks, so nothing was applied. Try rephrasing, or continue by hand.", errors: lastErrors, rateLimit: lastRate };
  }

  return {
    model,
    /** A draft for the question; with context answers it is tailored to them and asks no further context questions. */
    async plan(rawQuestion: unknown, rawContext?: unknown, reserve?: ReserveAttempt): Promise<PlanResult> {
      const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
      if (!question || question.length > MAX_QUESTION_LENGTH) return { ok: false, status: 400, code: "bad-input", message: `Describe the situation in 1–${MAX_QUESTION_LENGTH} characters.` };
      const context = checkContextAnswers(rawContext);
      if (typeof context === "string") return { ok: false, status: 400, code: "bad-input", message: context };
      const blocked = admit();
      if (blocked) return blocked;
      const r = await generate(
        [{ role: "system", content: PLANNER_SYSTEM_PROMPT }, { role: "user", content: plannerMessage(question, context) }],
        { name: PROPOSAL_SCHEMA_NAME, schema: PROPOSAL_JSON_SCHEMA, maxTokens: 3000 },
        (parsed) => {
          const c = validateProviderProposal(parsed);
          if (!c.ok) return c;
          // Once the user has answered, never ask again before exploring.
          const proposal = context.length && c.proposal.contextQuestions.length ? { ...c.proposal, contextQuestions: [] } : c.proposal;
          return { ok: true, value: proposal, warnings: c.warnings };
        },
        reserve,
      );
      return r.ok ? { ok: true, proposal: r.value, warnings: r.warnings, model, attempts: r.attempts, usage: r.usage, ms: r.ms, rateLimit: r.rateLimit } : r;
    },
    /** A fresh look at one path after the user told RealityFork something new. */
    async revisit(rawRequest: unknown, reserve?: ReserveAttempt): Promise<RevisitResult> {
      const req = checkRevisitRequest(rawRequest);
      if (!req.ok) return { ok: false, status: 400, code: "bad-input", message: req.message };
      const blocked = admit();
      if (blocked) return blocked;
      const r = await generate(
        [{ role: "system", content: REVISIT_SYSTEM_PROMPT }, { role: "user", content: `One path, as JSON:\n${JSON.stringify(req.request)}` }],
        { name: REVISIT_SCHEMA_NAME, schema: REVISIT_JSON_SCHEMA, maxTokens: 2000 },
        (parsed) => {
          const c = validateProviderRevisit(parsed, req.request);
          return c.ok ? { ok: true, value: c.suggestion, warnings: c.warnings } : c;
        },
        reserve,
      );
      return r.ok ? { ok: true, suggestion: r.value, warnings: r.warnings, model, attempts: r.attempts, usage: r.usage, ms: r.ms, rateLimit: r.rateLimit } : r;
    },
  };
}
