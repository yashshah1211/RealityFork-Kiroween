import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { figurePlan, MAX_CONTEXT_TEXT, MAX_QUESTION_LENGTH, usableFormulas, type FigureRow, type FigureTarget, type Proposal, type ProposalSelection, type StatedValue } from "@realityfork/core";
import { asWhatIf, contextFacts, type PlanState, type ReadyPlan, type RealityStore } from "./store";
import { futureHue, ROMAN, showNumber, showOption } from "./format";
import { JudgeAccessForm } from "./JudgeAccessForm";

type Ready = ReadyPlan;
type Asking = Extract<PlanState, { status: "context" }>;
type ListKey = keyof ProposalSelection;

const ERROR_TITLE: Record<string, string> = {
  "judge-required": "AI access for judges",
  "no-key": "The AI guide isn't switched on here",
  quota: "Today's free AI allowance is used up",
  "rate-limited": "The AI guide is busy for a moment",
  "local-limit": "One moment between drafts",
  "invalid-output": "The AI's draft didn't pass our checks",
  timeout: "The AI guide took too long",
};
const RETRYABLE = new Set(["rate-limited", "local-limit", "invalid-output", "timeout", "provider-error", "unavailable", "judge-unavailable"]);

const settingText = (p: Proposal, s: { variable: string; value: string }) => {
  const v = p.variables.find((x) => x.key === s.variable);
  return v ? `${v.label}: ${showOption(s.value)}` : showOption(s.value);
};

/** Faceted rock undersides for the engraved islands, so neighbouring futures do not look stamped from one mould. */
const ISLE_ROCKS = [
  "M12 31 L19 39 L27 41 L32 49 L41 52 L46 60 L53 62 L57 72 L63 63 L70 60 L74 51 L83 48 L89 41 L98 38 L108 31 Z",
  "M12 31 L17 37 L26 42 L34 45 L39 53 L48 56 L55 66 L60 62 L66 69 L71 58 L79 54 L86 45 L95 42 L108 31 Z",
  "M12 31 L20 40 L25 46 L35 48 L42 57 L50 59 L54 67 L61 74 L64 64 L72 57 L77 50 L87 46 L94 38 L108 31 Z",
];
const ISLE_FACETS = ["M32 49 L44 44 M53 62 L58 50 M74 51 L66 44", "M39 53 L50 46 M60 62 L61 49 M79 54 L70 45", "M42 57 L51 48 M61 74 L60 55 M77 50 L69 44"];
/**
 * A small engraved island: the sign the 3D view uses for a future it knows nothing about yet (grass, a lantern, an
 * autumn tree on a floating rock), drawn like a chart. It shows that a future exists, nothing about what is in it.
 */
export function Isle({ variant = 0, className = "" }: { variant?: number; className?: string }) {
  const v = variant % ISLE_ROCKS.length;
  // The tree and the lantern change sides from one island to the next.
  const tree = v === 1 ? 76 : 42;
  const lamp = v === 1 ? 46 : 72;
  return (
    <svg className={`isle ${className}`} viewBox="0 0 120 78" width="120" height="78" aria-hidden="true" focusable="false">
      <ellipse className="isle-glow" cx="60" cy="31" rx="58" ry="22" />
      <path className="isle-rock" d={ISLE_ROCKS[v]} />
      <path className="isle-hatch" d={ISLE_FACETS[v]} />
      <ellipse className="isle-top" cx="60" cy="31" rx="48" ry="9" />
      <path className="isle-tree" d={`M${tree} 31 V18 M${tree} 24 l-5 -5 M${tree} 21 l4 -5 M${tree} 26 l4 -3`} />
      <path className="isle-post" d={`M${lamp} 31 V15`} />
      <circle className="isle-light" cx={lamp} cy="13.5" r="2.7" />
    </svg>
  );
}

/** Waiting for the draft: the futures form where they will appear, so nothing jumps when they arrive. */
function Loading({ store, question, tailoring }: { store: RealityStore; question: string; tailoring: boolean }) {
  return (
    <div className="discover-loading" aria-busy="true">
      <p className="status" role="status" data-testid="plan-loading">{tailoring ? "Tailoring the futures to what you told us…" : "Imagining a few possible futures…"}</p>
      <p className="loading-note">The AI guide drafts a few possibilities for your question. Nothing is saved until you choose one, and every number will come from you.</p>
      <div className="trunk-tree forming" aria-hidden="true">
        <div className="trunk">As things are</div>
        <ol className="futures">
          {[0, 1, 2].map((i) => (
            <li key={i} className="future-card skeleton" style={{ ["--i" as string]: i, ["--hue" as string]: futureHue(i) }}>
              <Isle variant={i} className="forming-isle" />
              <span /><span /><span />
            </li>
          ))}
        </ol>
      </div>
      <p className="sr-only">Drafting possible futures for: {question}</p>
      <p className="loading-foot small">
        <button type="button" className="link-btn" onClick={store.rejectPlan} data-testid="cancel-plan">Cancel and change my question</button>
      </p>
    </div>
  );
}

/** A lantern that has gone out: the AI guide did not answer. Decorative. */
function LanternOut() {
  return (
    <svg className="lantern-out" viewBox="0 0 64 84" width="64" height="84" aria-hidden="true" focusable="false">
      <path className="lo-hook" d="M32 4 C 26 4, 26 12, 32 12 C 38 12, 38 4, 32 4" />
      <path className="lo-cap" d="M20 18 L 44 18 L 40 12 L 24 12 Z" />
      <path className="lo-glass" d="M21 19 C 16 34, 16 52, 21 66 L 43 66 C 48 52, 48 34, 43 19 Z" />
      <path className="lo-smoke" d="M32 52 C 28 44, 36 40, 32 32 C 29 27, 33 24, 32 22" />
      <path className="lo-base" d="M18 66 L 46 66 L 42 74 L 22 74 Z" />
    </svg>
  );
}

/** No draft this time: what happened, in the AI guide's own words, and the ways to continue (always including by hand). */
function Failed({ store, plan }: { store: RealityStore; plan: Extract<PlanState, { status: "error" }> }) {
  return (
    <section className="discover-error" role="alert" data-testid="plan-error">
      <LanternOut />
      <div className="err-body">
        <h2>{ERROR_TITLE[plan.code] ?? "We couldn't reach the AI guide"}</h2>
        <p className="err-message">{plan.message}</p>
        {plan.code === "judge-required" && <JudgeAccessForm onAccess={() => void store.requestPlan(plan.question)} />}
        <p className="muted">You can still map this out yourself: you add what matters, and RealityFork keeps track of every path.</p>
        <div className="actions-row">
          <button className="btn btn-primary" onClick={() => void store.create(plan.question)} data-testid="map-it-myself">Map it out myself</button>
          {RETRYABLE.has(plan.code) && <button className="btn" onClick={() => void store.requestPlan(plan.question)} data-testid="retry-plan">Try again</button>}
          <button className="link-btn" onClick={store.rejectPlan} data-testid="change-question">Change the question</button>
        </div>
      </div>
    </section>
  );
}

function FutureCard({ store, plan, i }: { store: RealityStore; plan: Ready; i: number }) {
  const p = plan.proposal;
  const b = p.branches[i]!;
  const kept = plan.selection.branches[i]!;
  // The button says what the click will do: it only mentions figures when confirmed figures will really be filled in here.
  const filled = store.figuresOn(i);
  const own = p.possibilities.filter((x) => x.branch.trim().toLowerCase() === b.name.trim().toLowerCase());
  const up = own.find((x) => x.tone === "upside");
  const down = own.find((x) => x.tone === "challenge");
  const toggle = () => store.editPlan((pp, s) => ({ proposal: pp, selection: { ...s, branches: s.branches.map((x, j) => (j === i ? !x : x)) } }));
  return (
    <li className={`future-card ${kept ? "" : "skipped"}`} style={{ ["--hue" as string]: futureHue(i), ["--i" as string]: i }} data-testid={`future-card-${i}`}>
      <Isle variant={i} className="future-isle" />
      <div className="future-top">
        <span className="numeral" aria-hidden="true">{ROMAN[i]}</span>
        <button type="button" className={`keep ${kept ? "on" : ""}`} aria-pressed={kept} disabled={plan.busy} onClick={toggle} data-testid={`include-future-${i}`} title={kept ? "Leave this future out of the draft" : "Include this future in the draft"}>
          {kept ? "✓ Included in draft" : "Left out"}
        </button>
      </div>
      <h2 className="future-name" data-testid={`future-name-${i}`}>{b.name}</h2>
      <p className="future-desc">{b.description}</p>
      {b.settings.length > 0 && (
        <div className="future-part">
          <p className="future-label" aria-hidden="true">Decided in this future</p>
          <ul className="decisions" aria-label="What is decided in this future">
            {b.settings.map((s) => <li key={s.variable}>{settingText(p, s)}</li>)}
          </ul>
        </div>
      )}
      {(up || down) && (
        <div className="future-part">
          <p className="future-label" aria-hidden="true">Possibilities</p>
          <ul className="teasers">
            {up && <li className="up"><span aria-hidden="true">↗</span><span className="sr-only">Could go well:</span> {up.text}</li>}
            {down && <li className="down"><span aria-hidden="true">↘</span><span className="sr-only">Could be hard:</span> {down.text}</li>}
          </ul>
        </div>
      )}
      <button className="btn btn-primary explore-btn" disabled={plan.busy} onClick={() => void store.acceptPlan(i)} data-testid={`explore-future-${i}`}>
        {filled > 0 ? "Save and explore with your figures" : "Save and explore this future"} <span aria-hidden="true">→</span>
      </button>
    </li>
  );
}

/** One optional question about the person's situation, before the futures. Free text; examples only fill the field. */
function ContextStep({ store, plan }: { store: RealityStore; plan: Asking }) {
  const { asked, answers } = plan.round;
  const q = asked[plan.step]!;
  const last = plan.step === asked.length - 1;
  const [text, setText] = useState(answers[plan.step] ?? "");
  const input = useRef<HTMLInputElement>(null);
  const id = `context-answer-${plan.step}`;
  return (
    <section className="context-step" aria-labelledby={`${id}-q`} data-testid="context-step">
      <div className="context-head">
        <p className="eyebrow">{asked.length > 1 ? `Question ${plan.step + 1} of ${asked.length}` : "One quick question"} · optional</p>
        {asked.length > 1 && (
          <ol className="context-steps" aria-hidden="true">
            {asked.map((_, i) => <li key={i} className={i < plan.step ? "done" : i === plan.step ? "now" : ""} />)}
          </ol>
        )}
      </div>
      <h2 id={`${id}-q`} className="context-q" tabIndex={-1} data-step-focus data-testid="context-question">{q.question}</h2>
      {q.why && <p className="q-why small"><span className="badge ai">AI-suggested</span> {q.why}</p>}
      <form className="context-answer" onSubmit={(e) => { e.preventDefault(); if (text.trim()) store.answerContext(text); }}>
        <label className="sr-only" htmlFor={id}>{q.question}</label>
        <input ref={input} id={id} value={text} maxLength={MAX_CONTEXT_TEXT} autoComplete="off" onChange={(e) => setText(e.target.value)} placeholder="Your answer, in your own words" data-testid="context-input" />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()} data-testid="context-continue">{last ? "Show possible futures" : "Continue"}</button>
      </form>
      {q.examples.length > 0 && (
        <div className="context-examples">
          <span className="small muted" id={`${id}-ex`}>For example:</span>
          <ul className="example-chips" aria-labelledby={`${id}-ex`}>
            {q.examples.map((x) => (
              <li key={x}><button type="button" className="chip-btn" onClick={() => { setText(x); input.current?.focus(); }} data-testid={`context-example-${x}`}>{x}</button></li>
            ))}
          </ul>
        </div>
      )}
      <p className="q-foot small">
        <button type="button" className="link-btn" onClick={store.skipContext} data-testid="context-skip">{last ? "Skip and show the futures" : "Skip this question"}</button>
        <span className="muted">Answers shape the futures and are saved with your map as things you told us. You can change them later.</span>
      </p>
    </section>
  );
}

/** "Based on what you told us": the answers behind these futures, with a way to change them. */
function ContextLine({ store, plan }: { store: RealityStore; plan: Ready }) {
  if (!plan.round.asked.length) return null;
  const told = contextFacts(plan.round);
  return (
    <>
      <p className="context-line" data-testid="context-summary">
        {told.length > 0 ? (
          <>
            <span className="muted">{plan.tailored ? "Based on what you told us:" : "What you told us:"}</span>
            {told.map((f) => <span key={f.id} className="told-chip" title={f.question}><span className="sr-only">{f.question} </span>{f.answer}</span>)}
            <button type="button" className="link-btn" onClick={store.editContext} data-testid="edit-context">Change</button>
          </>
        ) : (
          <>
            <span className="muted">These futures are general.</span>
            <button type="button" className="link-btn" onClick={store.editContext} data-testid="tailor-futures">Answer a question to tailor them</button>
          </>
        )}
      </p>
      {plan.tailorError && (
        <p className="small warn" role="status" data-testid="tailor-error">
          These are the general futures: tailoring them to your answers didn't work. {plan.tailorError}{" "}
          <button type="button" className="link-btn" onClick={store.retryPlan} data-testid="retry-tailor">Try again</button>
        </p>
      )}
    </>
  );
}

/** Small, optional edits to the draft before anything is created. */
function AdjustDraft({ store, plan }: { store: RealityStore; plan: Ready }) {
  const p = plan.proposal;
  const sel = plan.selection;
  const usable = usableFormulas(p, sel);
  const toggle = (k: ListKey, i: number) => store.editPlan((pp, s) => ({ proposal: pp, selection: { ...s, [k]: s[k].map((x, j) => (j === i ? !x : x)) } }));
  const rename = (i: number, name: string) =>
    store.editPlan((pp, s) => {
      const old = pp.branches[i]!.name;
      return {
        proposal: {
          ...pp,
          branches: pp.branches.map((b, j) => (j === i ? { ...b, name } : b)),
          // Possibilities stay attached to the renamed future.
          possibilities: pp.possibilities.map((x) => (x.branch === old ? { ...x, branch: name } : x)),
        },
        selection: s,
      };
    });
  return (
    <details className="disclosure" data-testid="discover-adjust">
      <summary>Adjust the draft</summary>
      <div className="adjust">
        <fieldset>
          <legend>Names of the futures</legend>
          {p.branches.map((b, i) => (
            <input key={i} value={b.name} onChange={(e) => rename(i, e.target.value)} aria-label={`Name of future ${i + 1}`} data-testid={`plan-rename-${i}`} />
          ))}
        </fieldset>
        <fieldset>
          <legend>Things that matter (you fill in every number later)</legend>
          {p.variables.map((v, i) => (
            <label key={v.key} className="check">
              <input type="checkbox" checked={sel.variables[i]} onChange={() => toggle("variables", i)} data-testid={`keep-variables-${i}`} />
              <span><strong>{v.label}</strong> <span className="muted small">{v.why}</span></span>
            </label>
          ))}
        </fieldset>
        {p.formulas.length > 0 && (
          <fieldset>
            <legend>What can be worked out once you add numbers</legend>
            {p.formulas.map((f, i) => (
              <label key={i} className={`check ${usable[i] ? "" : "dimmed"}`}>
                <input type="checkbox" checked={sel.formulas[i] && usable[i]} disabled={!usable[i]} onChange={() => toggle("formulas", i)} data-testid={`keep-formulas-${i}`} />
                <span><strong>{f.label}</strong> <span className="muted small">{f.explanation}</span>{!usable[i] && <span className="warn small" data-testid={`formula-dropped-${i}`}> Needs something you left out.</span>}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset>
          <legend>Things that might happen</legend>
          {p.possibilities.map((x, i) => (
            <label key={i} className="check">
              <input type="checkbox" checked={sel.possibilities[i]} onChange={() => toggle("possibilities", i)} data-testid={`keep-possibilities-${i}`} />
              <span>{x.text} <span className="muted small">({x.branch === "all" ? "every future" : x.branch})</span></span>
            </label>
          ))}
        </fieldset>
      </div>
    </details>
  );
}

/**
 * What the user's own words say, as a number with the unit THEY wrote: "₹20,000 per month", "2 hours per day", "4 weeks".
 * It never adds a currency or a period the question did not give (the field's unit is shown on the other side, "goes to").
 */
function readAs(s: StatedValue, withHedge = true): string {
  const unit = s.base ? ` ${s.value === 1 ? s.base : `${s.base}s`}` : "";
  const amount = `${s.currency ?? ""}${showNumber(s.value)}${unit}${s.period ? ` per ${s.period}` : ""}`;
  // A hedge stays with the amount, where the user put it: "at least ₹35,000 per month", "₹35,000 per month or more".
  if (!withHedge || !s.qualifier) return amount;
  return s.qualifier.after ? `${amount} ${s.qualifier.word}` : `${s.qualifier.word} ${amount}`;
}
/** Whether two ascending lists of future indexes are the same set. */
const sameSet = (a: readonly number[], b: readonly number[] | null): boolean => b !== null && a.length === b.length && a.every((x, i) => x === b[i]);
/** A target as an option value: "f1" is one future, "s0,2" several, and "open", "all" and "none" are themselves. */
const encodeTarget = (t: FigureTarget): string => (typeof t === "number" ? `f${t}` : Array.isArray(t) ? `s${(t as readonly number[]).join(",")}` : (t as string));
const decodeTarget = (v: string): FigureTarget => (v.startsWith("f") ? Number(v.slice(1)) : v.startsWith("s") ? v.slice(1).split(",").map(Number) : (v as "open" | "all" | "none"));

/** One figure the user wrote in the question: tick to use, check where it goes, choose another place if it is wrong. */
function FigureRowView({ store, plan, row, k, futures }: { store: RealityStore; plan: Ready; row: FigureRow; k: number; futures: readonly { i: number; name: string }[] }) {
  const vars = plan.proposal.variables;
  const label = (key: string) => vars.find((v) => v.key === key)?.label ?? key;
  const chosen = row.chosenVariable ? vars.find((v) => v.key === row.chosenVariable) : undefined;
  // How the number was read, from the user's words alone. The unit of the assumption it goes to is shown beside that assumption.
  const read = readAs(row.stated);
  const fieldUnit = chosen?.unit.trim() ? <span className="figure-unit small muted" data-testid={`figure-unit-${k}`}>{chosen.unit.trim()}</span> : null;
  const quote = `“${row.stated.text}”`;
  // Several futures at once (not all of them, not one): the set the draft suggests, and the one the row has now. Named by what is left out when that is how it was found.
  const nameOfFuture = (i: number) => futures.find((f) => f.i === i)?.name ?? `future ${i + 1}`;
  const setOption = (idx: readonly number[]) => ({
    value: encodeTarget([...idx]),
    label: row.placement.except.length > 0 && sameSet(idx, row.placement.futures) ? `every future except ${row.placement.except.map((n) => `“${n}”`).join(" and ")}` : idx.map(nameOfFuture).join(" and "),
  });
  const sets: { value: string; label: string }[] = [];
  const addSet = (idx: readonly number[]) => { if (!sets.some((o) => o.value === encodeTarget([...idx]))) sets.push(setOption(idx)); };
  const suggested = row.placement.futures;
  if (suggested && suggested.length > 1 && suggested.length < futures.length) addSet(suggested);
  if (Array.isArray(row.target)) addSet(row.target as readonly number[]);
  // With three futures every pair is offered too (three options), so a figure the draft could not place can go to the two it holds in.
  if (futures.length === 3) for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) addSet([futures[a]!.i, futures[b]!.i]);
  // The notes that explain a row are tied to its checkbox, so a screen reader hears why it is not ticked.
  const noteIds = row.notes.map((_, j) => `figure-note-${k}-${j}`).join(" ");
  return (
    <li className={`figure-row ${row.use ? "on" : ""}`} data-testid={`figure-row-${k}`}>
      <label className="figure-pick">
        <input type="checkbox" checked={row.use} disabled={plan.busy} aria-describedby={noteIds || undefined} onChange={(e) => store.setFigureChoice(row.stated.id, { use: e.target.checked })} data-testid={`figure-use-${k}`} />
        <span className="figure-quote">{quote}</span>
        {/* A hedged amount is used only if the user says it is exact: ticking is that statement, so the label says it. */}
        {row.stated.qualifier && <span className="figure-exact small" data-testid={`figure-exact-${k}`}>Tick to use {readAs(row.stated, false)} as an exact value</span>}
      </label>
      <div className="figure-maps">
        <span className="figure-read small"><span className="muted">read as</span> <strong data-testid={`figure-read-${k}`}>{read}</strong></span>
        <span className="figure-pair">
          {row.candidates.length > 1 || !row.chosenVariable ? (
            <>
              <label className="small muted" htmlFor={`figure-variable-${k}`}>goes to</label>
              <select id={`figure-variable-${k}`} value={row.chosenVariable ?? ""} disabled={plan.busy} onChange={(e) => store.setFigureChoice(row.stated.id, { variable: e.target.value || null })} aria-label={`Which assumption ${quote} is`} data-testid={`figure-variable-${k}`}>
                {!row.chosenVariable && <option value="">Choose…</option>}
                {row.candidates.map((key) => <option key={key} value={key}>{label(key)}</option>)}
              </select>
            </>
          ) : (
            <>
              <span className="small muted">goes to</span>
              <strong data-testid={`figure-variable-${k}`}>{label(row.chosenVariable)}</strong>
            </>
          )}
          {fieldUnit}
        </span>
        {futures.length > 1 && (
          <span className="figure-pair">
            <label className="small muted" htmlFor={`figure-target-${k}`}>in</label>
            <select id={`figure-target-${k}`} value={encodeTarget(row.target)} disabled={plan.busy} onChange={(e) => store.setFigureChoice(row.stated.id, { target: decodeTarget(e.target.value) })} aria-label={`Where to use ${quote}`} data-testid={`figure-target-${k}`}>
              {row.target === "none" && <option value="none">Choose a future…</option>}
              <option value="open">the future I open</option>
              <option value="all">every future in the draft</option>
              {sets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {futures.map((f) => <option key={f.i} value={`f${f.i}`}>{f.name}</option>)}
            </select>
          </span>
        )}
      </div>
      {/* Where it goes, in words, and why it was proposed there (nothing is said when there is only one future to choose from). */}
      {(row.scopeText || row.scopeWhy) && (
        <p className="figure-scope small" data-testid={`figure-scope-${k}`}>
          {row.scopeText}
          {row.scopeWhy && <span className="muted" data-testid={`figure-scope-why-${k}`}>{row.scopeText ? " " : ""}{row.scopeWhy}</span>}
        </p>
      )}
      {row.notes.map((n, j) => <p key={j} id={`figure-note-${k}-${j}`} className="figure-note small muted">{n}</p>)}
      {row.unplaced && <p className="figure-note small warn" data-testid={`figure-unplaced-${k}`}>No future chosen yet: this figure will not be used unless you choose one.</p>}
      {row.use && row.blocked && <p className="figure-note small warn" data-testid={`figure-blocked-${k}`}>{row.blocked}</p>}
    </li>
  );
}

/**
 * Numbers the user already wrote in the question. Offered for confirmation when at least one fits an assumption in the
 * draft; when none does, the numbers are still listed with the reason each is not used (no step to confirm). A question
 * without figures shows nothing. Nothing is applied until the user confirms, and no AI request is made.
 */
function Figures({ store, plan }: { store: RealityStore; plan: Ready }) {
  const fp = figurePlan(plan.question, plan.proposal, plan.selection, plan.figures.choices);
  const confirmed = plan.figures.confirmed;
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  // Keep the keyboard where the user was, but only after the user's own action here: on the summary after confirming,
  // on the panel after choosing Change. A confirmation undone by something else (editing the question) moves nothing.
  const [moveTo, setMoveTo] = useState<"summary" | "panel" | null>(null);
  useEffect(() => {
    if (moveTo === "summary" && confirmed) summary.current?.focus();
    else if (moveTo === "panel" && !confirmed) heading.current?.focus();
    if (moveTo !== null) setMoveTo(null);
  }, [moveTo, confirmed]);
  if (!fp.offer) {
    // No figure fits an assumption in this draft: the numbers the question has are still named, each with the reason it
    // is not used, so none disappears unnoticed. Nothing to tick or confirm, and nothing is filled in.
    if (fp.unused.length === 0) return null;
    return (
      <section className="figures" aria-labelledby="figures-title" data-testid="figures-not-used">
        <h2 id="figures-title" className="figures-title">Figures from your question</h2>
        <div className="figures-unused small muted" data-testid="figures-unused">
          <p>Not used in this draft, so nothing is filled in from them. You can enter a figure yourself after you open a future.</p>
          <ul>{fp.unused.map((u, i) => <li key={i}>“{u.text}”: {u.why}.</li>)}</ul>
        </div>
      </section>
    );
  }
  const futures = plan.proposal.branches.flatMap((b, i) => (plan.selection.branches[i] ? [{ i, name: b.name }] : []));
  const used = fp.rows.filter((r) => r.use);
  if (confirmed) {
    // Said where the choice is made. Figures without a future of their own are filled in on whichever card the user presses;
    // shared ones on every future. Anything offered and not used is named, so a figure is never left out unnoticed.
    const everywhere = used.filter((r) => r.target === "all").length;
    const opened = used.filter((r) => r.target === "open").length;
    const chosen = used.filter((r) => typeof r.target === "number").length;
    const several = used.filter((r) => Array.isArray(r.target)).length;
    const where = futures.length > 1
      ? [
          everywhere && `${everywhere} in every future`,
          opened && `${opened} in the future you open`,
          chosen && `${chosen} in the future ${chosen === 1 ? "it was" : "they were"} placed in`,
          several && `${several} in the futures ${several === 1 ? "it was" : "they were"} placed in`,
        ].filter(Boolean).join(", ")
      : "";
    const left = fp.rows.filter((r) => !r.use);
    return (
      <p className="figures-done" ref={summary} tabIndex={-1} role="status" data-testid="figures-summary">
        <span aria-hidden="true">✓</span>
        <span>
          Using {used.length} {used.length === 1 ? "figure" : "figures"} from your question
          {where && <span className="figures-where" data-testid="figures-where">: {where}</span>}
          {left.length > 0 && <span className="figures-left" data-testid="figures-left-out">. Left out: {left.map((r) => `“${r.stated.text}”`).join(", ")}</span>}
        </span>
        <button type="button" className="link-btn" disabled={plan.busy} onClick={() => { store.changeFigures(); setMoveTo("panel"); }} data-testid="figures-change">Change</button>
      </p>
    );
  }
  return (
    <section className="figures" aria-labelledby="figures-title" data-testid="figures-panel">
      <h2 id="figures-title" className="figures-title" ref={heading} tabIndex={-1} data-testid="figures-title">Figures from your question</h2>
      <p className="small muted">Numbers you wrote, used as your own what-if figures. Tick the ones to fill in. Each line says which futures it goes to, and you can change that. Only what you wrote beside a figure is ticked for you. Nothing changes until you confirm.</p>
      {plan.figures.notes && plan.figures.notes.length > 0 && (
        <div className="figures-edit-note small" role="status" data-testid="figures-edit-note">
          <strong>Your figure choices after the change</strong>
          <ul>{plan.figures.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <p className="muted">Check the new figures below, then confirm again.</p>
        </div>
      )}
      <ul className="figure-rows">
        {fp.rows.map((row, k) => <FigureRowView key={row.stated.id} store={store} plan={plan} row={row} k={k} futures={futures} />)}
      </ul>
      {fp.unused.length > 0 && (
        <div className="figures-unused small muted" data-testid="figures-unused">
          <p>Not used:</p>
          <ul>{fp.unused.map((u, i) => <li key={i}>“{u.text}”: {u.why}.</li>)}</ul>
        </div>
      )}
      {fp.problem && <p className="small warn" role="alert" data-testid="figures-problem">{fp.problem}</p>}
      {/* An offered figure with no future is left out when the user confirms. Said here, before the button, not found out afterwards. */}
      {fp.warning && <p className="small warn" role="status" data-testid="figures-unplaced">{fp.warning}</p>}
      <div className="actions-row">
        <button type="button" className="btn" disabled={!fp.ready || plan.busy} onClick={() => { store.confirmFigures(); setMoveTo("summary"); }} data-testid="figures-confirm">Use these figures</button>
        {!fp.ready && !fp.problem && <span className="small muted">{used.length === 0 ? "Tick a figure to use it." : "Finish the choices marked above."}</span>}
      </div>
    </section>
  );
}

/** "Edit my question": change the wording without losing the draft. The new wording applies on this screen at once. */
function QuestionEditor({ store, plan }: { store: RealityStore; plan: Ready }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(plan.question);
  const opener = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const wasOpen = useRef(false);
  const next = asWhatIf(text.trim());
  const tooLong = next.length > MAX_QUESTION_LENGTH;
  const unchanged = next === plan.question;
  // Focus follows the control the user just used: into the field when it opens, back to "Edit my question" when it closes.
  useEffect(() => {
    if (open) field.current?.focus();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const close = () => setOpen(false);
  if (!open) {
    return (
      <p className="edit-question-row small">
        <button type="button" ref={opener} className="link-btn" disabled={plan.busy} onClick={() => { setText(plan.question); setOpen(true); }} data-testid="edit-question">Edit my question</button>
        <span className="muted"> if this is not what you meant, or to fix a number.</span>
      </p>
    );
  }
  return (
    <form className="question-edit" onSubmit={(e) => { e.preventDefault(); if (!unchanged && !tooLong && store.editQuestion(text)) close(); }} onKeyDown={(e) => { if (e.key === "Escape") close(); }} data-testid="question-edit">
      <label htmlFor="question-edit-input">Your question</label>
      <textarea id="question-edit-input" ref={field} rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={tooLong || undefined} data-testid="question-edit-input" />
      <div className="actions-row">
        <button type="submit" className="btn" disabled={!text.trim() || unchanged || tooLong} data-testid="question-edit-apply">Use this wording</button>
        <button type="button" className="link-btn" onClick={close} data-testid="question-edit-cancel">Cancel</button>
      </div>
      <p className="small muted">The possibilities below stay as they are. The figures are read again from your new wording; your choices for a figure that only changed in number are kept, and you confirm again.</p>
      <p className={`small ${tooLong ? "warn" : "muted"}`} role={tooLong ? "alert" : undefined} data-testid="question-edit-count">
        {tooLong ? `That is ${next.length} characters; questions can be up to ${MAX_QUESTION_LENGTH}. Shorten it by ${next.length - MAX_QUESTION_LENGTH}.` : `${next.length} of ${MAX_QUESTION_LENGTH} characters`}
      </p>
    </form>
  );
}

/** Says when the futures on screen were drafted for other wording than the question now reads. */
function WordingNote({ store, plan }: { store: RealityStore; plan: Ready }) {
  if (plan.question === plan.madeFor) return null;
  return (
    <div className="wording-note" role="status" data-testid="question-changed-note">
      <p className="small">
        <strong>You changed your question.</strong> The possibilities below were drafted for “{plan.madeFor}”. Figures are read from your new wording. If the change affects what could happen, ask for possibilities that fit it.
      </p>
      <button type="button" className="btn" disabled={plan.busy} onClick={() => void store.regenerate()} data-testid="generate-for-wording">Generate possibilities for this wording</button>
    </div>
  );
}

/**
 * What the map will keep track of once it is saved: the things that matter and what can be worked out from them, as
 * the draft has them now (with what "Adjust the draft" left out removed). Read-only, and no number: every value starts
 * unknown and comes from the user, except the decisions each future card shows.
 */
function DraftContents({ plan }: { plan: Ready }) {
  const p = plan.proposal;
  const sel = plan.selection;
  const usable = usableFormulas(p, sel);
  const vars = p.variables.filter((_, i) => sel.variables[i]);
  const formulas = p.formulas.filter((_, i) => sel.formulas[i] && usable[i]);
  if (vars.length + formulas.length === 0) return null;
  return (
    <section className="draft-contents" aria-labelledby="draft-contents-title" data-testid="draft-contents">
      <h2 id="draft-contents-title" className="dc-title">What this map will keep track of</h2>
      <div className="dc-cols">
        {vars.length > 0 && (
          <div className="dc-col">
            <h3><span className="badge ai">AI-suggested</span> Things that matter</h3>
            <ul className="dc-chips">
              {vars.map((v) => <li key={v.key} className={v.kind === "number" ? "open" : ""} title={v.why}>{v.label}</li>)}
            </ul>
            <p className="small muted">The decisions on each card come from the draft. Everything else starts unknown: you are asked one question at a time as you explore, and only you provide numbers.</p>
          </div>
        )}
        {formulas.length > 0 && (
          <div className="dc-col">
            <h3><span className="badge calc">Calculated</span> once you add numbers</h3>
            <ul className="dc-list">
              {formulas.map((f, i) => <li key={i}><strong>{f.label}</strong> <span className="small muted">{f.explanation}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** The draft on screen: how the question was read, the futures to choose from, and everything to check before relying on it. */
function ReadyDraft({ store, plan }: { store: RealityStore; plan: Ready }) {
  const q = plan.proposal.questions.length;
  const e = plan.proposal.missingEvidence.length;
  return (
    <>
      <div className="discover-intro">
        <div className="reading">
          <p className="lede">Here are {plan.proposal.branches.length} ways this could go. Choose one to start exploring.</p>
          <p className="read-as" data-testid="plan-interpretation"><span className="muted">Read as:</span> {plan.proposal.interpretation}</p>
          <ContextLine store={store} plan={plan} />
          <QuestionEditor store={store} plan={plan} />
        </div>
        <aside className="draft-note" aria-label="About this draft">
          <p className="ai-note"><span className="badge ai">AI-suggested</span> Possibilities to think with, not predictions. Every number will come from you.</p>
          <p className="draft-model small muted">Drafted by {plan.model}</p>
        </aside>
      </div>
      <WordingNote store={store} plan={plan} />
      {plan.busy && (
        <p className="busy-note" role="status" data-testid="plan-busy">Asking again with your question… the possibilities below stay here until the new ones arrive.</p>
      )}
      {plan.retryError && !plan.busy && (
        <p className="notice-line warn" role="alert" data-testid="retry-error">No new possibilities this time: {plan.retryError} The ones below are still here, and you can try again.</p>
      )}
      <div className={plan.busy ? "is-busy" : undefined} aria-busy={plan.busy}>
        <Figures store={store} plan={plan} />
        <div className="trunk-tree">
          <div className="trunk" title="Your starting point is always kept">As things are</div>
          <ol className="futures">
            {plan.proposal.branches.map((_, i) => <FutureCard key={i} store={store} plan={plan} i={i} />)}
          </ol>
        </div>
      </div>
      <p className="approval-note small muted" data-testid="approval-note">
        Nothing is saved yet. Choosing a future saves it, and the others you included, as a map in this browser. You can change anything later.
      </p>
      <div className="draft-review">
        <DraftContents plan={plan} />
        <details className="disclosure rely" data-testid="discover-uncertainties">
          <summary>Before you rely on this: {q} open {q === 1 ? "question" : "questions"}, {e} {e === 1 ? "thing" : "things"} to find out</summary>
          {plan.warnings.length > 0 && (
            <div className="draft-checks" data-testid="draft-adjustments">
              <h3>What the draft checks adjusted</h3>
              <ul>{plan.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
            </div>
          )}
          <div className="uncertain-cols">
            <div><h3>Questions to answer</h3><ul>{plan.proposal.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><h3>Worth finding out</h3><ul>{plan.proposal.missingEvidence.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><h3>Limits of this draft</h3><ul>{plan.proposal.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          </div>
          <p className="small muted">Drafted by {plan.model}. AI suggestions can be wrong or one-sided.</p>
        </details>
        <AdjustDraft store={store} plan={plan} />
      </div>
      <p className="discover-foot small">
        <span className="muted">Not what you meant?</span>
        <button className="link-btn" disabled={plan.busy} onClick={() => void store.regenerate()} title="Asks the AI again with your question as it reads above; the new possibilities are shown for review" data-testid="retry-plan">Generate different possibilities</button>
        <span className="muted" aria-hidden="true">·</span>
        <button className="link-btn" onClick={store.rejectPlan} data-testid="discard-plan">Discard this draft</button>
      </p>
    </>
  );
}

/** Stage 2: a few possible futures, shown as a branching set of cards. Choosing one is the approval. */
export function Discover({ store }: { store: RealityStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const plan = state.plan;
  if (plan.status === "idle") return null;
  const question = plan.question;
  return (
    <main className={`stage discover is-${plan.status}`} data-testid="discover">
      <header className="stage-head discover-head">
        <p className="eyebrow">Possible futures</p>
        <h1 className="question" tabIndex={-1} data-stage-focus>{question}</h1>
      </header>
      {plan.status === "loading" && <Loading store={store} question={question} tailoring={plan.tailoring} />}
      {plan.status === "context" && <ContextStep key={plan.step} store={store} plan={plan} />}
      {plan.status === "error" && <Failed store={store} plan={plan} />}
      {plan.status === "ready" && <ReadyDraft store={store} plan={plan} />}
    </main>
  );
}
