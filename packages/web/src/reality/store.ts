/**
 * Browser state for universal realities. All modelling logic lives in @realityfork/core; this class
 * orchestrates it, persists a validated bundle to localStorage, and runs simulations through the
 * existing Engine (Web Worker in the browser).
 *
 * Journey stages are derived from this state: no active reality and no plan → Imagine; a plan being
 * drafted, asking its context questions, shown or failed → Discover; an active reality → Explore (view
 * "story") or Compare.
 *
 * AI requests (all user-initiated, all through the local server):
 *  1. POST /api/plan {question}: a draft plus up to two context questions, in one reply.
 *  2. POST /api/plan {question, context}: only if the user answered at least one of them.
 *  3. POST /api/revisit {one path}: only when the user asks for another look at a path.
 */
import {
  addFormula,
  addVariable,
  appliedFigures,
  applyRevisit,
  buildFromTemplate,
  carryFigureChoices,
  checkRevisitRequest,
  createBaseline,
  createReality,
  EXAMPLES,
  exportRealities,
  figurePlan,
  forkBranch,
  importRealities,
  INTERVENTION_QUESTION,
  MAX_CONTEXT_TEXT,
  MAX_QUESTION_LENGTH,
  MAX_REVISIT_BODY,
  mergeImported,
  proposalToReality,
  removeBranch,
  removeFormula,
  removeVariable,
  revisitCause,
  revisitRequest,
  sameTarget,
  selectAll,
  selectAllRevisit,
  setContext,
  simulationInput,
  updateBranch,
  updateFormula,
  updateRealityText,
  updateVariable,
  validateProposal,
  validateRevisit,
  type AssumptionValue,
  type Branch,
  type ContextAnswer,
  type AppliedFigure,
  type ContextQuestion,
  type FigureChoice,
  type FigurePlan,
  type KnownFact,
  type NewFormula,
  type NewVariable,
  type Possibility,
  type Proposal,
  type ProposalSelection,
  type Reality,
  type RevisitRequest,
  type RevisitSelection,
  type RevisitSuggestion,
  type OutcomeComparison,
  type Scenario,
} from "@realityfork/core";
import type { Engine } from "../engine";
import type { StorageLike } from "../state/workspace";
import { showSetting } from "./format";

export type ApiPath = "/api/plan" | "/api/revisit";
/** Calls the local server endpoints. The browser never sees the API key. */
export type ApiFetcher = (path: ApiPath, payload: unknown) => Promise<{ status: number; body: unknown }>;
export const httpApiFetcher: ApiFetcher = async (path, payload) => {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

export const REALITY_STORAGE_KEY = "realityfork.realities.v1";
/** Longest thing the user can tell RealityFork in one go (the core allows 500 characters). */
export const MAX_FACT_TEXT = 300;

/** "story": one future told as a story; "compare": two futures side by side. */
export type View = "story" | "compare";
/** Which advanced editor is open under "All details" (null = closed). */
export type Details = null | "branch" | "define";
export type SimEntry = { readonly status: "running" } | { readonly status: "done"; readonly scenario: Scenario } | { readonly status: "error"; readonly message: string };
/** Two finished runs of one simulation compared by the validated engine (paired when they share the seed). Session only. */
export type SimCompareEntry =
  | { readonly status: "running" }
  | { readonly status: "done"; readonly outcome: OutcomeComparison; readonly paired: boolean; readonly confidence: number }
  | { readonly status: "error"; readonly message: string };

/** A draft as received and checked: kept so skipping or changing the answers needs no new request. */
export interface Draft {
  readonly proposal: Proposal;
  readonly model: string;
  readonly warnings: readonly string[];
  /** The wording of the question this draft was requested for. The question on screen can be edited afterwards; this cannot. */
  readonly madeFor: string;
}
/** What the user decided about the figures read from their question (R19). Nothing is applied unless `confirmed`. */
export interface FigureState {
  readonly confirmed: boolean;
  /** Per figure (by its id in the question's wording). Once confirmed these hold every resolved choice, so a later rename cannot change them. */
  readonly choices: Readonly<Record<string, FigureChoice>>;
  /** After "Edit my question": what was kept for a changed figure and what could not be kept (R20A). Absent unless there is something to say. */
  readonly notes?: readonly string[];
}
/** The context questions asked before exploring and the user's answers ("" = skipped). */
export interface ContextRound {
  readonly asked: readonly ContextQuestion[];
  readonly answers: readonly string[];
}
export type ReadyPlan = {
  readonly status: "ready";
  /** The question as it reads now (the user can edit it while the draft is on screen). Figures are read from this wording. */
  readonly question: string;
  /** The wording the futures below were drafted for. Different from `question` after "Edit my question" until new ones are generated. */
  readonly madeFor: string;
  readonly proposal: Proposal;
  readonly selection: ProposalSelection;
  readonly model: string;
  readonly warnings: readonly string[];
  /** The first, general draft (the one that asked the questions). */
  readonly draft: Draft;
  readonly round: ContextRound;
  /** True when these futures were drafted with the user's answers. */
  readonly tailored: boolean;
  /** Why tailoring failed; the general futures are shown instead. */
  readonly tailorError: string | null;
  readonly figures: FigureState;
  /** A replacement draft was asked for. This draft stays on screen until it arrives. */
  readonly busy: boolean;
  /** Why the last replacement attempt did not give a new draft; this draft is still the one on screen. */
  readonly retryError: string | null;
};
export type PlanState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly question: string; readonly tailoring: boolean }
  | { readonly status: "context"; readonly question: string; readonly draft: Draft; readonly round: ContextRound; readonly step: number; readonly previous: ReadyPlan | null }
  | { readonly status: "error"; readonly question: string; readonly message: string; readonly code: string }
  | ReadyPlan;

/** An AI re-evaluation of one path: requested, previewed, and applied only on approval. Session only. */
export type RevisitState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly realityId: string; readonly branchId: string }
  | { readonly status: "error"; readonly realityId: string; readonly branchId: string; readonly code: string; readonly message: string }
  | {
    readonly status: "ready"; readonly realityId: string; readonly branchId: string;
    /** The path's fingerprint when the request was made: applying is refused if the path changed since. */
    readonly fingerprint: string;
    readonly request: RevisitRequest; readonly suggestion: RevisitSuggestion; readonly selection: RevisitSelection;
    readonly model: string; readonly warnings: readonly string[];
  };

/** The map as it was before the latest answers in one path, to show what they changed. Session only. */
export interface ChangeMark {
  readonly realityId: string;
  readonly branchId: string;
  readonly before: Reality;
}

export interface RealityState {
  /** AI planner proposal awaiting the user's decision. Nothing is created until it is accepted. */
  readonly plan: PlanState;
  readonly revisit: RevisitState;
  readonly change: ChangeMark | null;
  /** The path just created with "What if this changed?": it shows what the change does compared with its parent. Session only. */
  readonly whatIf: { readonly realityId: string; readonly branchId: string } | null;
  /** The last question typed on the first screen, so going back keeps it. */
  readonly lastQuestion: string;
  readonly realities: readonly Reality[];
  readonly activeId: string | null;
  readonly selectedId: string | null;
  readonly compare: readonly [string | null, string | null];
  readonly view: View;
  readonly details: Details;
  readonly error: string | null;
  readonly notice: string | null;
  readonly loadError: string | null;
  /** Simulation results keyed by `${branch fingerprint}|${simulation key}`. Recomputed on demand, not exported. */
  readonly sims: Readonly<Record<string, SimEntry>>;
  /** The fingerprint a path had when it was last simulated, by `${branch id}|${simulation key}`, to say a run is out of date. */
  readonly lastRun: Readonly<Record<string, string>>;
  /** Simulation comparisons keyed by simCompareKey. Session only, like the runs they compare. */
  readonly simCompare: Readonly<Record<string, SimCompareEntry>>;
  /** When each saved map was last changed (ISO time), by map id. Recorded from R18 on, in this browser only; not exported. */
  readonly edited: Readonly<Record<string, string>>;
}

const empty: RealityState = {
  plan: { status: "idle" }, revisit: { status: "idle" }, change: null, whatIf: null, lastQuestion: "", realities: [], activeId: null, selectedId: null, compare: [null, null],
  view: "story", details: null, error: null, notice: null, loadError: null, sims: {}, lastRun: {}, simCompare: {}, edited: {},
};

export const simKey = (b: Branch, key: string) => `${b.fingerprint}|${key}`;
export const simCompareKey = (a: Branch, b: Branch, key: string) => `${a.fingerprint}|${b.fingerprint}|${key}`;

/**
 * Every saved map, most recently edited first; maps saved before edit times were recorded follow, newest first.
 * Ordering is for display only: nothing is dropped.
 */
export function savedMaps(state: Pick<RealityState, "realities" | "edited">): { readonly reality: Reality; readonly edited: string | null }[] {
  return state.realities
    .map((reality, i) => ({ reality, edited: state.edited[reality.id] ?? null, i }))
    .sort((x, y) => (y.edited ?? "").localeCompare(x.edited ?? "") || y.i - x.i)
    .map(({ reality, edited }) => ({ reality, edited }));
}
export const asWhatIf = (q: string) => (/^what if/i.test(q) ? q : `What if ${q.replace(/^(\.\.\.|…)\s*/, "")}`);
/** The answered context questions as Known facts (ids follow the question order, so edits keep them). */
export const contextFacts = (round: ContextRound): KnownFact[] =>
  round.asked.flatMap((q, i) => {
    const answer = round.answers[i]?.trim() ?? "";
    return answer ? [{ id: `context-${i + 1}`, question: q.question, answer }] : [];
  });
const sameAnswers = (a: ContextRound, b: ContextRound) => a.asked.length === b.asked.length && a.answers.every((x, i) => x.trim() === (b.answers[i] ?? "").trim());
export const newFactId = () => `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** One change for "What if this changed?": a value for an assumption, or a change in the user's own words. */
/** One change for a new path. `name` (a suggestion's own name, e.g. "Three baristas") replaces the default "Parent · Setting". */
export type WhatIfChange = { readonly key: string; readonly value: AssumptionValue; readonly name?: string } | { readonly text: string };
/** The marker of a change the user described to explore: a hypothetical for that path, never a known fact (see isIntervention). */
export const WHAT_IF_QUESTION = INTERVENTION_QUESTION;

type Sent = { readonly ok: true; readonly body: Record<string, unknown> } | { readonly ok: false; readonly code: string; readonly message: string };
const serverWarnings = (x: unknown) => (Array.isArray(x) ? x.filter((w): w is string => typeof w === "string" && w.length <= 200).slice(0, 8) : []);
/** Validation problems for display, WITHOUT the quoted model text: a rejected claim is never shown to the user. */
const problems = (errors: readonly string[]) => errors.slice(0, 3).map((e) => e.replace(/\s*\("[\s\S]*"\)/, "")).join("; ");

export class RealityStore {
  private state: RealityState = empty;
  private listeners = new Set<() => void>();
  /** Bumped whenever a pending draft or re-evaluation should be ignored (new request, discard, home). */
  private planSeq = 0;
  private revisitSeq = 0;
  constructor(
    private readonly engine: Engine,
    private readonly storage: StorageLike | null = null,
    private readonly fetcher: ApiFetcher = httpApiFetcher,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  getState = (): RealityState => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<RealityState>, persist = false) {
    this.state = { ...this.state, ...patch };
    // The bundle is the exported format, unchanged; edit times sit beside it in the browser's copy only.
    if (persist && this.storage) this.storage.setItem(REALITY_STORAGE_KEY, JSON.stringify({ activeId: this.state.activeId, bundle: exportRealities(this.state.realities), edited: this.state.edited }));
    for (const l of this.listeners) l();
  }

  active(): Reality | null {
    return this.state.realities.find((r) => r.id === this.state.activeId) ?? null;
  }

  selected(): Branch | null {
    const r = this.active();
    return r?.branches.find((b) => b.id === this.state.selectedId) ?? r?.branches[0] ?? null;
  }

  async restore(): Promise<void> {
    const raw = this.storage?.getItem(REALITY_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { activeId: string | null; bundle: string; edited?: unknown };
      const realities = await importRealities(saved.bundle);
      const active = realities.find((r) => r.id === saved.activeId) ?? null;
      // Edit times exist only for maps changed since R18; anything else in this optional field is ignored.
      const ids = new Set(realities.map((r) => r.id));
      const times = typeof saved.edited === "object" && saved.edited !== null && !Array.isArray(saved.edited) ? Object.entries(saved.edited as Record<string, unknown>) : [];
      const edited = Object.fromEntries(times.filter((e): e is [string, string] => ids.has(e[0]) && typeof e[1] === "string" && !Number.isNaN(Date.parse(e[1]))));
      this.set({ realities, edited, activeId: active?.id ?? null, selectedId: active?.branches[0]?.id ?? null });
    } catch (e) {
      this.set({ loadError: `Your saved maps could not be checked, so they were not loaded. ${(e as Error).message}` });
    }
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      this.set({ error: null });
      return await fn();
    } catch (e) {
      this.set({ error: (e as Error).message });
      return undefined;
    }
  }

  /** Save a created or changed map. The only place an edit time is recorded: opening or viewing a map never changes it. */
  private put(r: Reality, extra: Partial<RealityState> = {}) {
    const prev = this.state.realities.find((x) => x.id === r.id);
    const realities = prev ? this.state.realities.map((x) => (x.id === r.id ? r : x)) : [...this.state.realities, r];
    // Reusing an existing path returns the same map object: that is not an edit.
    const edited = prev === r ? this.state.edited : { ...this.state.edited, [r.id]: this.now() };
    this.set({ realities, edited, ...extra }, true);
  }

  /** Apply an operation to the active reality. */
  private edit(fn: (r: Reality) => Promise<Reality>, extra: Partial<RealityState> = {}) {
    return this.guard(async () => {
      const r = this.active();
      if (!r) throw new Error("Open a map first");
      const next = await fn(r);
      this.put(next, extra);
      return next;
    });
  }

  /**
   * An edit that tells RealityFork something about a path (an answer, a fact, a context answer). Remembers the
   * map from before the first such edit, so the path can show everything that changed since.
   */
  private track(branchId: string, fn: (r: Reality) => Promise<Reality>) {
    const r = this.active();
    if (!r) return this.edit(fn);
    const mark = this.state.change;
    const before = mark && mark.realityId === r.id && mark.branchId === branchId ? mark.before : r;
    return this.edit(fn, { change: { realityId: r.id, branchId, before } });
  }

  private branch(r: Reality, id: string): Branch {
    const b = r.branches.find((x) => x.id === id);
    if (!b) throw new Error("That path no longer exists.");
    return b;
  }

  // ---------- AI requests ----------

  /**
   * POST to the local server. The server spaces requests a few seconds apart and refuses early ones BEFORE
   * contacting the provider ("local-limit"); in that case only, wait the stated time once and resend.
   * Provider rate limits and quota errors are never retried.
   */
  private async send(path: ApiPath, payload: unknown): Promise<Sent> {
    for (let attempt = 1; ; attempt++) {
      let res: { status: number; body: unknown };
      try {
        res = await this.fetcher(path, payload);
      } catch {
        return { ok: false, code: "unavailable", message: "Could not reach the AI guide." };
      }
      const b = (typeof res.body === "object" && res.body !== null ? res.body : null) as { ok?: unknown; code?: unknown; message?: unknown; retryAfterSeconds?: unknown } | null;
      if (b?.ok === true) return { ok: true, body: b as Record<string, unknown> };
      const code = typeof b?.code === "string" ? b.code : "unavailable";
      const wait = typeof b?.retryAfterSeconds === "number" ? b.retryAfterSeconds : 0;
      if (attempt === 1 && code === "local-limit" && wait > 0 && wait <= 12) {
        await this.sleep(wait * 1000 + 250);
        continue;
      }
      const message = typeof b?.message === "string" ? b.message : res.status === 404 ? "The AI guide is not part of this build of RealityFork." : `The AI guide did not answer (HTTP ${res.status}).`;
      return { ok: false, code, message };
    }
  }

  /** One draft request, validated again in the browser: never trust the transport. */
  private async draft(question: string, context: readonly ContextAnswer[]): Promise<({ ok: true } & Draft) | { ok: false; code: string; message: string }> {
    const sent = await this.send("/api/plan", context.length ? { question, context } : { question });
    if (!sent.ok) return sent;
    const check = validateProposal(sent.body.proposal);
    if (!check.ok) return { ok: false, code: "invalid-output", message: `The draft failed RealityFork's checks: ${problems(check.errors)}` };
    // Once the user has answered, the futures are tailored: nothing more is asked before exploring.
    const proposal = context.length ? { ...check.proposal, contextQuestions: [] } : check.proposal;
    // Preserve the server's checked adjustment notes, not just browser-local validator warnings.
    return { ok: true, proposal, model: typeof sent.body.model === "string" ? sent.body.model : "unknown model", warnings: [...serverWarnings(sent.body.warnings), ...check.warnings], madeFor: question };
  }

  private ready(question: string, shown: Draft, draft: Draft, round: ContextRound, tailored: boolean, tailorError: string | null): ReadyPlan {
    return {
      status: "ready", question, madeFor: shown.madeFor, proposal: shown.proposal, selection: selectAll(shown.proposal), model: shown.model, warnings: shown.warnings,
      draft, round, tailored, tailorError, figures: { confirmed: false, choices: {} }, busy: false, retryError: null,
    };
  }

  /**
   * The same plan under the question as it reads now. Figures confirmed for other wording are no longer confirmed (the
   * number may have changed, so the user confirms again), but the user's choices follow a figure whose meaning did not
   * change; what could not be kept is said (R20A, carryFigureChoices).
   */
  private reworded(plan: ReadyPlan, question: string): ReadyPlan {
    if (question === plan.question) return plan;
    const carried = carryFigureChoices(plan.question, question, plan.proposal, plan.selection, plan.figures.choices);
    return { ...plan, question, retryError: null, figures: { confirmed: false, choices: carried.choices, ...(carried.notes.length ? { notes: carried.notes } : {}) } };
  }

  // ---------- AI draft ----------

  /** Ask the server-side planner for a draft. One request at a time. */
  requestPlan = async (question: string) => {
    const typed = question.trim();
    if (!typed || this.state.plan.status === "loading") return;
    // "…I opened a café?" (as in the placeholder) becomes "What if I opened a café?" everywhere.
    const q = asWhatIf(typed);
    // Too long for the AI: the form says so before this is called; nothing is sent and the screen does not change.
    if (q.length > MAX_QUESTION_LENGTH) return;
    const seq = ++this.planSeq;
    this.set({ plan: { status: "loading", question: q, tailoring: false }, lastQuestion: typed, error: null });
    const got = await this.draft(q, []);
    if (seq !== this.planSeq) return;
    if (!got.ok) return this.set({ plan: { status: "error", question: q, message: got.message, code: got.code } });
    const draft: Draft = { proposal: got.proposal, model: got.model, warnings: got.warnings, madeFor: got.madeFor };
    const asked = got.proposal.contextQuestions.slice(0, 2);
    const round: ContextRound = { asked, answers: asked.map(() => "") };
    this.set({ plan: asked.length ? { status: "context", question: q, draft, round, step: 0, previous: null } : this.ready(q, draft, draft, round, false, null) });
  };

  /** Answer the current context question (free text) and move on. */
  answerContext = (text: string) => this.stepContext(text.trim().slice(0, MAX_CONTEXT_TEXT));
  /** Skip the current context question. Skipping every question shows the first draft without another request. */
  skipContext = () => this.stepContext("");

  private stepContext(answer: string) {
    const plan = this.state.plan;
    if (plan.status !== "context") return;
    const round: ContextRound = { ...plan.round, answers: plan.round.answers.map((a, i) => (i === plan.step ? answer : a)) };
    if (plan.step + 1 < round.asked.length) return this.set({ plan: { ...plan, round, step: plan.step + 1 } });
    void this.finishContext(plan.question, plan.draft, round, plan.previous);
  }

  private async finishContext(question: string, draft: Draft, round: ContextRound, previous: ReadyPlan | null) {
    const context = contextFacts(round);
    if (!context.length) return this.set({ plan: this.ready(question, draft, draft, round, false, null) });
    // Same answers as the futures already tailored to them: show those again, no new request. The question keeps any edit made since.
    if (previous?.tailored && sameAnswers(previous.round, round)) return this.set({ plan: this.reworded(previous, question) });
    const seq = ++this.planSeq;
    this.set({ plan: { status: "loading", question, tailoring: true } });
    const got = await this.draft(question, context.map(({ question: q, answer }) => ({ question: q, answer })));
    if (seq !== this.planSeq) return;
    // If tailoring fails, keep the answers and fall back to the general futures, saying so.
    this.set({ plan: got.ok ? this.ready(question, got, draft, round, true, null) : this.ready(question, draft, draft, round, false, got.message) });
  }

  /** Change the answers to the context questions (from the futures screen). */
  editContext = () => {
    const plan = this.state.plan;
    if (plan.status !== "ready" || !plan.round.asked.length) return;
    this.set({ plan: { status: "context", question: plan.question, draft: plan.draft, round: plan.round, step: 0, previous: plan } });
  };

  /** "Ask again": a new tailored draft when the user answered, otherwise a new first draft. */
  retryPlan = () => {
    const plan = this.state.plan;
    if (plan.status === "ready" && contextFacts(plan.round).length) return void this.finishContext(plan.question, plan.draft, plan.round, null);
    if (plan.status !== "idle" && plan.status !== "loading") void this.requestPlan(plan.question);
  };

  /**
   * "Generate different possibilities": ask the AI again with the question as it reads now and the answers the user
   * already gave. It is only a retry: the context questions are not asked again, and the new draft is reviewed like the
   * first one (nothing is created until the user chooses a future). The current draft stays on screen until the new one
   * arrives, and stays (with the reason) if the request fails. Figures are read again and must be confirmed again.
   */
  regenerate = async () => {
    const plan = this.state.plan;
    if (plan.status !== "ready" || plan.busy) return;
    const seq = ++this.planSeq;
    this.set({ plan: { ...plan, busy: true, retryError: null } });
    const context = contextFacts(plan.round);
    const got = await this.draft(plan.question, context.map(({ question, answer }) => ({ question, answer })));
    if (seq !== this.planSeq) return;
    const current = this.state.plan;
    if (current.status !== "ready") return;
    if (!got.ok) return this.set({ plan: { ...current, busy: false, retryError: got.message } });
    const fresh: Draft = { proposal: { ...got.proposal, contextQuestions: [] }, model: got.model, warnings: got.warnings, madeFor: got.madeFor };
    this.set({ plan: this.ready(plan.question, fresh, fresh, plan.round, context.length > 0, null) });
  };

  /**
   * "Edit my question": change the wording while the draft stays on screen. Nothing is requested and nothing is
   * discarded. The figures are read again from the new wording and must be confirmed again; the futures keep the
   * wording they were drafted for (`madeFor`) so the screen can say when they may no longer fit. Returns false when the
   * wording is empty or too long (nothing changes).
   */
  editQuestion = (text: string): boolean => {
    const plan = this.state.plan;
    if (plan.status !== "ready" || plan.busy) return false;
    const typed = text.trim();
    if (!typed) return false;
    const q = asWhatIf(typed);
    if (q.length > MAX_QUESTION_LENGTH) return false;
    if (q !== plan.question) this.set({ plan: this.reworded(plan, q), lastQuestion: typed });
    return true;
  };

  /** Change what is done with one figure read from the question. Any change re-opens the confirmation. */
  setFigureChoice = (id: string, patch: FigureChoice) => {
    const plan = this.state.plan;
    if (plan.status !== "ready" || plan.busy) return;
    const notes = plan.figures.notes;
    this.set({ plan: { ...plan, figures: { confirmed: false, choices: { ...plan.figures.choices, [id]: { ...plan.figures.choices[id], ...patch } }, ...(notes ? { notes } : {}) } } });
  };

  /** The figures as the panel shows them now, with the user's choices applied. */
  figurePlan = (): FigurePlan | null => {
    const plan = this.state.plan;
    return plan.status === "ready" ? figurePlan(plan.question, plan.proposal, plan.selection, plan.figures.choices) : null;
  };

  /** The user confirms the figures as shown. Every resolved choice is stored, so what was confirmed is exactly what is applied. */
  confirmFigures = () => {
    const plan = this.state.plan;
    if (plan.status !== "ready" || plan.busy) return;
    const fp = figurePlan(plan.question, plan.proposal, plan.selection, plan.figures.choices);
    if (!fp.ready) return;
    const choices = Object.fromEntries(fp.rows.map((r) => [r.stated.id, { use: r.use, variable: r.chosenVariable, target: r.target }]));
    this.set({ plan: { ...plan, figures: { confirmed: true, choices } } });
  };

  /** The confirmed figures that land on the futures of `selection`, for the future opened (`focus`). Empty unless the user confirmed. */
  private confirmedFigures(plan: ReadyPlan, proposal: Proposal, selection: ProposalSelection, focus: number | undefined): AppliedFigure[] {
    if (!plan.figures.confirmed) return [];
    return appliedFigures(figurePlan(plan.question, proposal, selection, plan.figures.choices), focus, selection.branches);
  }

  /** How many confirmed figures choosing future `i` would fill in on it. The button on its card says so. */
  figuresOn = (i: number): number => {
    const plan = this.state.plan;
    if (plan.status !== "ready") return 0;
    const selection = { ...plan.selection, branches: plan.selection.branches.map((k, j) => k || j === i) };
    return this.confirmedFigures(plan, plan.proposal, selection, i).filter((f) => f.future === i).length;
  };

  /** Re-open the figures to change them. */
  changeFigures = () => {
    const plan = this.state.plan;
    if (plan.status === "ready" && plan.figures.confirmed) this.set({ plan: { ...plan, figures: { ...plan.figures, confirmed: false } } });
  };

  /**
   * Edit the pending proposal (names, which items to keep). Only the draft changes. Confirmed figures stay confirmed
   * only if every one of them is still there, for the same assumption and the same place: otherwise the user is shown
   * the figures again instead of getting fewer than they approved.
   */
  editPlan = (fn: (p: Proposal, s: ProposalSelection) => { proposal: Proposal; selection: ProposalSelection }) => {
    const plan = this.state.plan;
    if (plan.status !== "ready" || plan.busy) return;
    const next: ReadyPlan = { ...plan, ...fn(plan.proposal, plan.selection) };
    let fits = true;
    if (plan.figures.confirmed) {
      const now = figurePlan(next.question, next.proposal, next.selection, next.figures.choices);
      const confirmedIds = Object.entries(plan.figures.choices).filter(([, c]) => c.use);
      fits = now.ready && confirmedIds.every(([id, c]) => now.rows.some((r) => r.stated.id === id && r.use && r.chosenVariable === (c.variable ?? null) && sameTarget(r.target, c.target)));
    }
    this.set({ plan: fits ? next : { ...next, figures: { ...next.figures, confirmed: false } } });
  };

  /** Discard the draft (or a failed attempt) and go back to the question. */
  rejectPlan = () => {
    this.planSeq++;
    this.set({ plan: { status: "idle" } });
  };

  /**
   * The user approved by choosing a future to explore: build the map with the futures they kept, through the
   * normal operations, and open `focus` (an index into the proposal's futures; it is kept even if it was skipped).
   * The answers to the context questions are saved with the map as Known facts.
   */
  acceptPlan = (focus?: number) =>
    this.guard(async () => {
      const plan = this.state.plan;
      if (plan.status !== "ready") return;
      const selection = focus === undefined ? plan.selection : { ...plan.selection, branches: plan.selection.branches.map((k, i) => k || i === focus) };
      const check = validateProposal(plan.proposal);
      if (!check.ok) throw new Error(`Your edits made the draft invalid: ${check.errors.slice(0, 3).join("; ")}`);
      const context = contextFacts(plan.round);
      // Only figures the user confirmed, only for the futures they were confirmed for. Nothing is applied otherwise.
      const figures = this.confirmedFigures(plan, check.proposal, selection, focus);
      const r = await proposalToReality(asWhatIf(plan.question), check.proposal, selection, {
        model: plan.model, createdAt: new Date().toISOString(),
        ...(context.length ? { context, contextUsed: plan.tailored } : {}),
        ...(figures.length ? { figures } : {}),
      });
      const root = r.branches[0]!;
      const name = focus === undefined ? undefined : check.proposal.branches[focus]?.name;
      const target = r.branches.find((b) => b.parentId === root.id && b.name === name) ?? root;
      this.put(r, { plan: { status: "idle" }, activeId: r.id, selectedId: target.id, compare: [null, null], view: "story", details: null, notice: null, change: null, whatIf: null, revisit: { status: "idle" } });
      return r;
    });

  // ---------- answers and what the user tells us ----------

  /** The user's answer for one assumption in one path (from a question card or All details). An answer means it applies. */
  answer = (branchId: string, key: string, value: AssumptionValue) =>
    this.track(branchId, (r) => updateBranch(r, branchId, { values: { [key]: value }, sources: { [key]: "user" } }));
  /**
   * The user says these assumptions do not apply to this path: not zero and not unknown. Any value they had here is
   * cleared, they are no longer asked for, and every calculation that uses them does not apply here (never read as 0).
   */
  markNotApplicable = (branchId: string, keys: readonly string[]) =>
    this.track(branchId, (r) => {
      const b = this.branch(r, branchId);
      return updateBranch(r, branchId, { values: Object.fromEntries(keys.map((k) => [k, null])), notApplicable: [...(b.notApplicable ?? []), ...keys] });
    });
  /** Undo: the assumption applies to this path after all, and is unknown again until the user answers it. */
  markApplicable = (branchId: string, key: string) =>
    this.track(branchId, (r) => updateBranch(r, branchId, { notApplicable: (this.branch(r, branchId).notApplicable ?? []).filter((k) => k !== key) }));

  /** Something the user knows about this path, in their own words. */
  addFact = (branchId: string, text: string) => {
    const answer = text.trim().slice(0, MAX_FACT_TEXT);
    if (!answer) return Promise.resolve(undefined);
    return this.track(branchId, async (r) => updateBranch(r, branchId, { facts: [...(this.branch(r, branchId).facts ?? []), { id: newFactId(), question: "", answer }] }));
  };

  /** Change or (with empty text) remove something the user told us about this path. */
  editFact = (branchId: string, id: string, text: string) =>
    this.track(branchId, async (r) => {
      const answer = text.trim().slice(0, MAX_FACT_TEXT);
      const facts = this.branch(r, branchId).facts ?? [];
      return updateBranch(r, branchId, { facts: answer ? facts.map((f) => (f.id === id ? { ...f, answer } : f)) : facts.filter((f) => f.id !== id) });
    });

  removeFact = (branchId: string, id: string) => this.editFact(branchId, id, "");

  /** Change or (with empty text) remove a context answer. It applies to every path; `branchId` is the path being viewed. */
  editContextFact = (branchId: string, id: string, text: string) =>
    this.track(branchId, (r) => {
      const answer = text.trim().slice(0, MAX_CONTEXT_TEXT);
      const context = r.context ?? [];
      return setContext(r, answer ? context.map((f) => (f.id === id ? { ...f, answer } : f)) : context.filter((f) => f.id !== id));
    });

  /** Hide the "what changed" summary. */
  dismissChange = () => this.set({ change: null });

  /**
   * "Not sure? Explore both": one new path per answer of a yes/no or two-way choice, branched from `branchId`,
   * which stays as it is. Only on this explicit action; a path that already has that answer is reused.
   */
  exploreBoth = (branchId: string, key: string) =>
    this.guard(async () => {
      let r = this.active();
      if (!r) throw new Error("Open a map first");
      const b = this.branch(r, branchId);
      const v = r.variables.find((x) => x.key === key);
      const options: (string | boolean)[] = v?.kind === "boolean" ? [true, false] : v?.kind === "category" && v.options.length === 2 ? [...v.options] : [];
      if (!v || !options.length) throw new Error("Only a yes/no question or a choice between two options can be explored both ways.");
      let first: string | null = null;
      for (const value of options) {
        const existing = r.branches.find((x) => x.parentId === b.id && x.values[key] === value);
        if (existing) {
          first ??= existing.id;
          continue;
        }
        const f = await forkBranch(r, b.id, { name: `${b.name} · ${showSetting(v.label, value, v.unit)}` });
        r = await updateBranch(f.reality, f.branch.id, { values: { [key]: value }, sources: { [key]: "user" } });
        first ??= f.branch.id;
      }
      this.put(r, { selectedId: first, view: "story", change: null });
      return r;
    });

  /**
   * "What if this changed?": a new path from `fromId` with ONE change the user chose: a value they entered, a different
   * choice, or a change described in their own words. Words are saved on the new path as a change being explored (a
   * hypothetical, see isIntervention): never as a known fact, and RealityFork does not turn them into a value. Every way
   * of describing a path ("What if this changed?", "Explore another path from here") ends here. The original path is not
   * touched. A sibling with exactly this change is reused.
   */
  exploreChange = (fromId: string, change: WhatIfChange) =>
    this.guard(async () => {
      let r = this.active();
      if (!r) throw new Error("Open a map first");
      const from = this.branch(r, fromId);
      let id: string;
      if ("key" in change) {
        const v = r.variables.find((x) => x.key === change.key);
        if (!v) throw new Error("That assumption no longer exists.");
        if (change.value === null) throw new Error("Enter the value you want to explore.");
        if ((from.values[v.key] ?? null) === change.value) throw new Error(`“${from.name}” already has ${showSetting(v.label, change.value, v.unit)}.`);
        const same = r.branches.find((x) => x.parentId === from.id && r!.variables.every((w) => x.values[w.key] === (w.key === v.key ? change.value : from.values[w.key])));
        if (same) id = same.id;
        else {
          const f = await forkBranch(r, from.id, { name: change.name?.trim() || `${from.name} · ${showSetting(v.label, change.value, v.unit)}` });
          r = await updateBranch(f.reality, f.branch.id, { values: { [v.key]: change.value }, sources: { [v.key]: "user" } });
          id = f.branch.id;
        }
      } else {
        const text = change.text.trim().slice(0, MAX_FACT_TEXT);
        if (!text) throw new Error("Describe the change first.");
        const same = r.branches.find((x) => x.parentId === from.id && (x.facts ?? []).some((f) => f.question === WHAT_IF_QUESTION && f.answer === text));
        if (same) id = same.id;
        else {
          const f = await forkBranch(r, from.id, { name: text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text });
          r = await updateBranch(f.reality, f.branch.id, { facts: [...(f.branch.facts ?? []), { id: newFactId(), question: WHAT_IF_QUESTION, answer: text }] });
          id = f.branch.id;
        }
      }
      this.put(r, { selectedId: id, view: "story", change: null, whatIf: { realityId: r.id, branchId: id } });
      return r.branches.find((x) => x.id === id)!;
    });

  // ---------- another look (AI re-evaluation of one path) ----------

  /** Ask the AI to take another look at ONE path. Sends only that path, the question and what the user told us. */
  requestRevisit = async (branchId: string) => {
    const r = this.active();
    const b = r?.branches.find((x) => x.id === branchId);
    if (!r || !b || this.state.revisit.status === "loading") return;
    const fail = (code: string, message: string) => this.set({ revisit: { status: "error", realityId: r.id, branchId, code, message } });
    const request = revisitRequest(r, b, revisitCause(r, b));
    const local = checkRevisitRequest(request);
    if (!local.ok) return fail("bad-input", local.message);
    if (new TextEncoder().encode(JSON.stringify(local.request)).length > MAX_REVISIT_BODY) return fail("bad-input", "This path holds too much text to send. Shorten some notes and try again.");
    const seq = ++this.revisitSeq;
    this.set({ revisit: { status: "loading", realityId: r.id, branchId }, error: null });
    const sent = await this.send("/api/revisit", local.request);
    if (seq !== this.revisitSeq) return;
    if (!sent.ok) return fail(sent.code, sent.message);
    // Validate again in the browser, against the exact request that was sent.
    const check = validateRevisit(sent.body.suggestion, local.request);
    if (!check.ok) return fail("invalid-output", `The AI's suggestions failed RealityFork's checks, so nothing was shown or applied: ${problems(check.errors)}`);
    this.set({
      revisit: {
        status: "ready", realityId: r.id, branchId, fingerprint: b.fingerprint, request: local.request, suggestion: check.suggestion,
        selection: selectAllRevisit(check.suggestion), model: typeof sent.body.model === "string" ? sent.body.model : "unknown model",
        warnings: [...serverWarnings(sent.body.warnings), ...check.warnings],
      },
    });
  };

  /** Keep or leave out one item of the previewed re-evaluation. */
  toggleRevisit = (kind: keyof RevisitSelection, i: number) => {
    const rv = this.state.revisit;
    if (rv.status !== "ready") return;
    this.set({ revisit: { ...rv, selection: { ...rv.selection, [kind]: rv.selection[kind].map((x, j) => (j === i ? !x : x)) } } });
  };

  /** Apply the approved items to that path only. Refused if the path changed after the request. */
  applyRevisit = () =>
    this.guard(async () => {
      const rv = this.state.revisit;
      if (rv.status !== "ready") return;
      const r = this.active();
      const b = r?.id === rv.realityId ? r.branches.find((x) => x.id === rv.branchId) : undefined;
      if (!r || !b || b.fingerprint !== rv.fingerprint) {
        this.set({ revisit: { status: "error", realityId: rv.realityId, branchId: rv.branchId, code: "changed", message: "This path changed after the AI looked at it, so nothing was added. Ask again to include your latest changes." } });
        return;
      }
      const next = await applyRevisit(r, b.id, rv.request, rv.suggestion, rv.selection, { model: rv.model, at: new Date().toISOString() });
      this.put(next, { revisit: { status: "idle" }, change: null });
      return next;
    });

  dismissRevisit = () => {
    this.revisitSeq++;
    this.set({ revisit: { status: "idle" } });
  };

  /** Put a set-aside suggestion back among the active ones. */
  restoreSuggestion = (branchId: string, id: string) =>
    this.edit(async (r) => updateBranch(r, branchId, {
      possibilities: this.branch(r, branchId).possibilities.map((p) => {
        if (p.id !== id) return p;
        const { setAside: _reason, ...rest } = p;
        return rest;
      }),
    }));

  // ---------- maps ----------

  /** Start an empty map by hand; the assumption editor opens straight away. */
  create = (question: string) =>
    this.guard(async () => {
      const r = await createReality({ question: asWhatIf(question.trim()) });
      this.put(r, { plan: { status: "idle" }, lastQuestion: question.trim(), activeId: r.id, selectedId: r.branches[0]!.id, compare: [null, null], view: "story", details: "define", notice: null, change: null, whatIf: null });
      return r;
    });

  loadExample = (templateId: string) =>
    this.guard(async () => {
      const t = EXAMPLES.find((x) => x.id === templateId);
      if (!t) throw new Error(`unknown example "${templateId}"`);
      const r = await buildFromTemplate(t);
      this.put(r, { plan: { status: "idle" }, activeId: r.id, selectedId: r.branches[0]!.id, compare: [null, null], view: "story", details: null, notice: null, change: null, whatIf: null });
      return r;
    });

  open = (id: string) => {
    const r = this.state.realities.find((x) => x.id === id);
    if (!r) return;
    this.set({ activeId: id, selectedId: r.branches[0]!.id, compare: [null, null], view: "story", details: null, error: null, change: null, whatIf: null }, true);
  };

  home = () => {
    this.planSeq++;
    this.set({ activeId: null, selectedId: null, plan: { status: "idle" }, view: "story", details: null, error: null, notice: null, change: null, whatIf: null }, true);
  };
  select = (id: string) => this.set({ selectedId: id, view: "story", error: null, change: null, ...(this.state.whatIf?.branchId === id ? {} : { whatIf: null }) });

  openDetails = (details: Exclude<Details, null>) => this.set({ details });
  closeDetails = () => this.set({ details: null });

  openCompare = (a: string, b: string) => this.set({ compare: [a, b], view: "compare", details: null, change: null });
  setCompare = (a: string | null, b: string | null) => this.set({ compare: [a, b] });
  /** Leave the comparison and continue with one of the two futures. */
  continueWith = (id: string) => this.set({ selectedId: id, view: "story" });

  /** A new path from `fromId`, optionally with some values chosen by the user straight away. */
  forkWith = (fromId: string, name: string, values?: Record<string, AssumptionValue>) =>
    this.guard(async () => {
      const r = this.active();
      if (!r) throw new Error("Open a map first");
      const f = await forkBranch(r, fromId, { name: name.trim() || `Another path ${r.branches.length}` });
      const reality = values && Object.keys(values).length
        ? await updateBranch(f.reality, f.branch.id, { values, sources: Object.fromEntries(Object.keys(values).map((k) => [k, "user" as const])) })
        : f.reality;
      this.put(reality, { selectedId: f.branch.id, view: "story", change: null });
      return reality.branches.find((b) => b.id === f.branch.id)!;
    });

  fork = (parentId: string, name?: string) => this.forkWith(parentId, name ?? "");

  /** Names, descriptions and possibilities. Values go through `answer`, so their source is recorded. */
  updateBranch = (id: string, patch: { name?: string; description?: string; possibilities?: readonly Possibility[] }) => this.edit((r) => updateBranch(r, id, patch));
  removeBranch = (id: string) =>
    this.edit((r) => removeBranch(r, id), {
      selectedId: this.active()?.branches.find((b) => b.id === id)?.parentId ?? null,
      compare: [null, null],
      view: "story",
      change: null,
      whatIf: null,
    });
  updateText = (patch: { question?: string; description?: string; questions?: readonly string[] }) => this.edit((r) => updateRealityText(r, patch));
  /** A starting value typed here is the user's own, so it is recorded as such (and shown under Known). */
  addVariable = (v: NewVariable, initial: AssumptionValue) => this.edit((r) => addVariable(r, v, initial, "user"));
  updateVariable = (key: string, patch: Parameters<typeof updateVariable>[2]) => this.edit((r) => updateVariable(r, key, patch));
  removeVariable = (key: string) => this.edit((r) => removeVariable(r, key));
  addFormula = (f: NewFormula) => this.edit((r) => addFormula(r, f));
  reviewFormula = (key: string) => this.edit((r) => updateFormula(r, key, { reviewed: true }));
  removeFormula = (key: string) => this.edit((r) => removeFormula(r, key));

  removeReality = (id: string) => {
    const { [id]: _gone, ...edited } = this.state.edited;
    this.set({ realities: this.state.realities.filter((r) => r.id !== id), edited, ...(this.state.activeId === id ? { activeId: null, selectedId: null } : {}) }, true);
  };

  /** Run a linked validated simulation for one branch through the engine. */
  runSimulation = (branchId: string, key: string) =>
    this.guard(async () => {
      const r = this.active();
      const b = r?.branches.find((x) => x.id === branchId);
      if (!r || !b) throw new Error("Choose a future first");
      const s = simulationInput(r, b, key);
      if (!s.ok) throw new Error([...s.missing.map((m) => `missing: ${m}`), ...s.problems].join("; "));
      const k = simKey(b, key);
      this.set({ sims: { ...this.state.sims, [k]: { status: "running" } }, lastRun: { ...this.state.lastRun, [`${b.id}|${key}`]: b.fingerprint } });
      try {
        const scenario = await this.engine.run(await createBaseline(s.input));
        this.set({ sims: { ...this.state.sims, [k]: { status: "done", scenario } } });
      } catch (e) {
        this.set({ sims: { ...this.state.sims, [k]: { status: "error", message: (e as Error).message } } });
      }
    });

  /**
   * Compare one simulation's finished runs on two paths with the validated engine (paired when they share the seed and
   * replication count; sensitivity off): the difference B − A with its interval. Does nothing unless both runs exist
   * for the paths as they are now, so a missing or out-of-date run is never filled in.
   */
  compareSimulations = async (aId: string, bId: string, key: string) => {
    const r = this.active();
    const a = r?.branches.find((x) => x.id === aId);
    const b = r?.branches.find((x) => x.id === bId);
    const link = r?.simulations.find((x) => x.key === key);
    if (!r || !a || !b || !link) return;
    const ea = this.state.sims[simKey(a, key)];
    const eb = this.state.sims[simKey(b, key)];
    if (ea?.status !== "done" || eb?.status !== "done") return;
    const k = simCompareKey(a, b, key);
    if (this.state.simCompare[k]) return;
    this.set({ simCompare: { ...this.state.simCompare, [k]: { status: "running" } } });
    try {
      const cmp = await this.engine.compare(ea.scenario, eb.scenario, { sensitivity: false });
      const outcome = cmp.outcomes.find((o) => o.metric === link.metric);
      if (!outcome) throw new Error(`The model has no outcome “${link.metric}”.`);
      this.set({ simCompare: { ...this.state.simCompare, [k]: { status: "done", outcome, paired: cmp.pairing.mode === "paired", confidence: cmp.confidence } } });
    } catch (e) {
      this.set({ simCompare: { ...this.state.simCompare, [k]: { status: "error", message: (e as Error).message } } });
    }
  };

  exportText = () => exportRealities(this.state.realities);

  /**
   * Add the maps in a file to the saved ones without ever replacing or dropping anything saved. A map whose ID is
   * already saved with identical content is skipped; one whose ID is saved with DIFFERENT content (an older or newer
   * version of the same map) is added as a separate copy under a new ID, and the notice says so. A file does not say
   * when its maps were last edited, so added maps have no edit time and saved maps keep theirs.
   */
  importText = (text: string) =>
    this.guard(async () => {
      const incoming = await importRealities(text);
      if (incoming.length === 0) throw new Error("The file contains no maps");
      const plan = mergeImported(this.state.realities, incoming);
      const n = plan.added.length;
      const parts = [
        n > 0 ? `Restored ${n} ${n === 1 ? "reality" : "realities"} from the file.` : "Nothing new: every map in the file is already saved exactly as it is.",
        n > 0 && plan.unchanged.length > 0 ? `${plan.unchanged.length} already saved ${plan.unchanged.length === 1 ? "was" : "were"} left as ${plan.unchanged.length === 1 ? "it is" : "they are"}.` : "",
        plan.copies.length > 0
          ? `${plan.copies.length} ${plan.copies.length === 1 ? "map differs" : "maps differ"} from the saved map with the same ID, so ${plan.copies.length === 1 ? "it was" : "they were"} added as ${plan.copies.length === 1 ? "a separate copy" : "separate copies"} (map ${plan.copies.map((c) => c.copy.id.slice(-6)).join(", ")}). Nothing you saved was changed.`
          : "",
      ];
      this.set({ realities: [...plan.realities], activeId: null, selectedId: null, plan: { status: "idle" }, compare: [null, null], view: "story", details: null, loadError: null, change: null, whatIf: null, revisit: { status: "idle" }, notice: parts.filter(Boolean).join(" ") }, true);
      return incoming;
    });

  reset = () => {
    this.storage?.removeItem(REALITY_STORAGE_KEY);
    this.planSeq++;
    this.revisitSeq++;
    this.state = empty;
    for (const l of this.listeners) l();
  };

  dismiss = () => this.set({ error: null, notice: null, loadError: null });
}
