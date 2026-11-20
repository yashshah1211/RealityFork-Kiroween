import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  branchStory,
  changesFromParent,
  conditionalSentence,
  consequenceView,
  currencyHint,
  describeChange,
  formulaUnit,
  formulaUses,
  relatedAssumptions,
  whatIfView,
  factKey,
  forkChoices,
  forkIdeas,
  isIntervention,
  notApplicableHere,
  knownKeys,
  MAX_CONTEXT_TEXT,
  possibilityOrigin,
  type AssumptionValue,
  type Branch,
  type CarriedOver,
  type ChangeSummary,
  type ConsequenceView,
  type ForkChoice,
  type RelatedAssumption,
  type KnownFact,
  type KnownView,
  type Possibility,
  type ProposalTone,
  type Reality,
  type StaleSuggestion,
  type Tone,
  type UnknownAssumption,
} from "@realityfork/core";
import { MAX_FACT_TEXT, type RealityState, type RealityStore, type RevisitState } from "./store";
import { RealityMap, pathHues } from "./RealityMap";
import { BranchPanel, DefinePanel, SimulatedOutcome, newPossibilityId } from "./panels";
import { changeCaption, factChangeLine, originWords, parseNumberInput, possibilityCaption, possibilityTag, showAssumption, showOutcome, showSetting, toldLine, unitNote } from "./format";
import { SavedNote } from "./SavedNote";
import { JudgeAccessForm } from "./JudgeAccessForm";

const choiceText = (c: ForkChoice) => showSetting(c.variable.label, c.value);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The tag on a suggestion copied from an earlier path that was not re-checked for this one (see carriedOver). */
export function CarriedTag({ c }: { c: CarriedOver }) {
  const text = c.changed.length ? `may not hold here: depends on ${c.changed.join(", ")}` : `carried over from “${c.from.name}”, not re-checked`;
  const title = c.changed.length
    ? `Noted for “${c.from.name}”. ${c.changed.join(", ")} ${c.changed.length === 1 ? "is" : "are"} different on this path.`
    : `Noted for “${c.from.name}” and copied here. Nothing records what it depends on, and this path differs from “${c.from.name}”.`;
  return <span className="tag fresh wrap" title={title} data-testid={`carried-${c.possibility.id}`}>{text}</span>;
}

/**
 * Answer one unknown value: number field, or one tap for a choice or yes/no. `told`: what the user said that seems to
 * answer it (factMatches). It is quoted so the user can answer from it; nothing is filled in for them.
 */
export function QuestionCard({ store, b, u, remaining, told, hint, onSkip }: { store: RealityStore; b: Branch; u: UnknownAssumption; remaining: number; told: readonly KnownFact[]; hint: string | null; onSkip: () => void }) {
  const v = u.variable;
  const [text, setText] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  useEffect(() => {
    setText("");
    setBad(null);
  }, [v.key, b.id]);
  const save = (value: AssumptionValue) => void store.answer(b.id, v.key, value);
  const saveNumber = () => {
    const n = parseNumberInput(text, v.unit);
    if (!n.ok) return setBad(n.message);
    if (n.value === null) return setBad("Enter a number, like 1200 or 2.5");
    save(n.value);
  };
  const isStart = b.parentId === null;
  // A yes/no or a choice between two options can be explored both ways, as two new paths.
  const both = v.kind === "boolean" || (v.kind === "category" && v.options.length === 2);
  return (
    <div className="question-card" data-testid="question-card">
      <p className="eyebrow">One question at a time · {remaining} to go</p>
      <h3 className="q-prompt">
        Your best guess for <strong>{v.label}</strong> {isStart ? "today" : <>in <em>{b.name}</em></>}?
      </h3>
      {(v.uncertainty || u.unlocks.length > 0) && (
        <p className="q-why small">
          {v.uncertainty}
          {u.unlocks.length > 0 && <span className="unlocks"> Helps work out: {u.unlocks.join(", ")}.</span>}
        </p>
      )}
      {/* The question named a currency this field does not have: said, never guessed or converted. */}
      {hint && <p className="q-hint small" data-testid="question-currency-hint">{hint}</p>}
      {told.length > 0 && (
        <div className="q-told small" data-testid="question-told">
          <p><span className="muted">{isIntervention(told[0]!) ? "You are exploring:" : "You told us:"}</span> “{told[0]!.answer}”</p>
          <p className="muted">{v.kind === "number" ? "If it includes the number, enter it below." : "If that answers this, choose below."}</p>
        </div>
      )}
      {v.kind === "number" ? (
        <form className="q-answer" onSubmit={(e) => { e.preventDefault(); saveNumber(); }}>
          <label className="sr-only" htmlFor={`q-${v.key}`}>{v.label}</label>
          <input id={`q-${v.key}`} inputMode="decimal" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setBad(null); }} aria-invalid={bad !== null} placeholder="Your estimate" data-testid="question-input" />
          {v.unit && <span className="unit">{v.unit}</span>}
          <button type="submit" className="btn btn-primary" data-testid="save-answer">Save answer</button>
        </form>
      ) : (
        <div className="q-choices" role="group" aria-label={v.label}>
          {(v.kind === "boolean" ? [true, false] : v.options).map((o) => (
            <button key={String(o)} type="button" className="btn pill" onClick={() => save(o)} data-testid={`answer-${String(o)}`}>{showAssumption(o)}</button>
          ))}
        </div>
      )}
      {bad && <p className="field-error" role="alert">{bad}</p>}
      <p className="q-foot small">
        {both && <button type="button" className="link-btn" onClick={() => void store.exploreBoth(b.id, v.key)} data-testid="explore-both">Not sure? Explore both</button>}
        {/* Not the same as 0 or "not known": this path has no such thing (no café, no rent). It is not asked again here. */}
        {!isStart && <button type="button" className="link-btn" onClick={() => void store.markNotApplicable(b.id, [v.key])} title="Not the same as 0: nothing is worked out from it on this path" data-testid="not-applicable">Doesn't apply to {b.name}</button>}
        <button type="button" className="link-btn" onClick={onSkip} data-testid="skip-question">Skip for now</button>
        <span className="muted">Only you provide numbers. Change any answer later in All details.</span>
      </p>
    </div>
  );
}

/**
 * "Explore another path from here". Every way of stating a difference goes through the same operation as "What if this
 * changed?" (exploreChange), so the difference is recorded and shown the same way everywhere: a tap on another choice,
 * or the user's own words (saved as a change they are exploring). The only exception is an unchanged copy, which is
 * labelled as exactly that: its name is a label and records no change.
 */
export function PathSheet({ store, r, b, onClose }: { store: RealityStore; r: Reality; b: Branch; onClose: () => void }) {
  const [described, setDescribed] = useState("");
  const [name, setName] = useState("");
  const choices = forkChoices(r, b).slice(0, 6);
  // Counts this map already varies (1 and 2 baristas): one more, or one fewer, than any path so far. Suggestions only.
  const ideas = forkIdeas(r, b);
  return (
    <div className="sheet" data-testid="fork-sheet">
      <h3>What's different on the new path?</h3>
      <p className="small muted">“{b.name}” stays exactly as it is. The new path starts as a copy of it.</p>
      {ideas.length > 0 && (
        <div className="fork-ideas" data-testid="fork-ideas">
          <p className="small muted">Suggested from this map's own figures. Nothing is created until you choose one.</p>
          <ul className="choice-list">
            {ideas.map((x) => (
              <li key={`${x.variable.key}-${x.direction}`}>
                <button type="button" className="choice idea" onClick={() => void store.exploreChange(b.id, { key: x.variable.key, value: x.value, name: x.name })} data-testid={`fork-idea-${x.variable.key}-${x.direction}`}>
                  <span className="choice-label">{x.name}</span>
                  <span className="small muted">{showSetting(x.variable.label, x.value, x.variable.unit)}, {x.direction === "up" ? "one more than on any path so far" : "one fewer than on any path so far"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {choices.length > 0 && (
        <ul className="choice-list">
          {choices.map((c) => (
            <li key={`${c.variable.key}-${String(c.value)}`}>
              <button type="button" className="choice" onClick={() => void store.exploreChange(b.id, { key: c.variable.key, value: c.value })} data-testid={`fork-choice-${c.variable.key}-${String(c.value)}`}>
                <span className="choice-label">{choiceText(c)}</span>
                <span className="small muted">{c.changesOwnDecision ? "a different choice here" : "decide this differently"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="name-path" onSubmit={(e) => { e.preventDefault(); if (described.trim()) void store.exploreChange(b.id, { text: described }); }}>
        <label htmlFor="fork-describe">{choices.length ? "Or describe what is different" : "Describe what is different"}</label>
        <div className="row">
          <input id="fork-describe" value={described} maxLength={MAX_FACT_TEXT} onChange={(e) => setDescribed(e.target.value)} placeholder="e.g. Open in a smaller town" data-testid="fork-describe" />
          <button type="submit" className="btn" disabled={!described.trim()} data-testid="fork-describe-create">Create path</button>
        </div>
        <p className="small muted">Saved on the new path as a change you are exploring, not as a known fact. Nothing is calculated from your words; suggestions there are marked for another look.</p>
      </form>
      <form className="name-path" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void store.forkWith(b.id, name); }}>
        <label htmlFor="fork-name">Or start an unchanged copy</label>
        <div className="row">
          <input id="fork-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the copy, e.g. Working draft" data-testid="fork-name" />
          <button type="submit" className="btn" disabled={!name.trim()} data-testid="fork-create">Create copy</button>
        </div>
        <p className="small muted">The name is only a label. Nothing is different on the copy until you change an assumption.</p>
      </form>
      <button type="button" className="link-btn" onClick={onClose}>Cancel</button>
    </div>
  );
}

export function ComparePicker({ store, r, b, onClose }: { store: RealityStore; r: Reality; b: Branch; onClose: () => void }) {
  const hues = pathHues(r);
  const others = r.branches.filter((x) => x.id !== b.id);
  return (
    <div className="sheet" data-testid="compare-sheet">
      <h3>Compare “{b.name}” with…</h3>
      <ul className="choice-list">
        {others.map((o) => (
          <li key={o.id}>
            <button type="button" className="choice" style={{ ["--hue" as string]: hues.get(o.id) }} onClick={() => store.openCompare(b.id, o.id)} data-testid={`compare-pick-${o.name}`}>
              <span className="choice-label"><span className="dot" aria-hidden="true" />{o.name}</span>
              <span className="small muted">{changeCaption(changesFromParent(r, o), o.parentId === null)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="link-btn" onClick={onClose}>Cancel</button>
    </div>
  );
}

/**
 * One AI consequence with its cause: "Y could happen if X." and what it could change next, with the reasoning, the
 * assumptions it depends on and what could change it behind "Why this might happen". Text exactly as stored.
 */
export function Consequence({ view, id, tag }: { view: ConsequenceView; id: string; tag: ReactNode }) {
  return (
    <>
      <span className="cons-text">{view.consequence}</span> <span className="cons-if">if {view.condition}.</span>{tag}
      {view.downstream && <span className="cons-then"><span className="cons-label">Then:</span> {view.downstream}</span>}
      <details className="cons-why" data-testid={`why-${id}`}>
        <summary>Why this might happen</summary>
        <p>{view.mechanism}</p>
        {view.dependsOn.length > 0 && (
          <p><span className="cons-label">Depends on:</span> {view.dependsOn.map((d) => (d.value === null ? `${d.variable.label} (not known yet)` : showSetting(d.variable.label, d.value, d.variable.unit))).join("; ")}</p>
        )}
        <p><span className="cons-label">What could change this:</span> {view.uncertainty}</p>
      </details>
    </>
  );
}

/** One assumption to change on the new path: the user's own number, or one tap on a different choice. */
function WhatIfRow({ store, b, a }: { store: RealityStore; b: Branch; a: RelatedAssumption }) {
  const v = a.variable;
  const [text, setText] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  const now = a.value === null ? "not known yet" : showAssumption(a.value, v.unit);
  const id = `whatif-${b.id}-${v.key}`;
  if (v.kind === "number") {
    const submit = () => {
      const n = parseNumberInput(text, v.unit);
      if (!n.ok) return setBad(n.message);
      if (n.value === null || n.value === a.value) return setBad("Enter a number that differs from the current one, like 1200 or 2.5");
      void store.exploreChange(b.id, { key: v.key, value: n.value });
    };
    return (
      <li className="whatif-row" data-testid={`whatif-row-${v.key}`}>
        <label htmlFor={id}><strong>{v.label}</strong> <span className="small muted">now: {now}</span></label>
        <form className="q-answer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input id={id} inputMode="decimal" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setBad(null); }} aria-invalid={bad !== null} placeholder="Your value" data-testid={`whatif-input-${v.key}`} />
          {v.unit && <span className="unit">{v.unit}</span>}
          <button type="submit" className="btn" data-testid={`whatif-create-${v.key}`}>Create path</button>
        </form>
        {bad && <p className="field-error" role="alert">{bad}</p>}
      </li>
    );
  }
  const options = (v.kind === "boolean" ? [true, false] : v.options).filter((o) => o !== a.value);
  return (
    <li className="whatif-row" data-testid={`whatif-row-${v.key}`}>
      <span><strong>{v.label}</strong> <span className="small muted">now: {now}</span></span>
      <div className="q-choices" role="group" aria-label={`Try a different value for ${v.label}`}>
        {options.map((o) => (
          <button key={String(o)} type="button" className="btn pill" onClick={() => void store.exploreChange(b.id, { key: v.key, value: o })} data-testid={`whatif-choice-${v.key}-${String(o)}`}>{showAssumption(o)}</button>
        ))}
      </div>
    </li>
  );
}

/** What "What if this changed?" was opened for: a suggestion, or one decision of this path (a chip in its header). */
type WhatIfTarget = { readonly kind: "suggestion"; readonly id: string } | { readonly kind: "assumption"; readonly key: string };

/**
 * "What if this changed?": change ONE assumption on a new path, or describe the change in your own words. From a
 * suggestion, the assumptions the AI linked to it come first; from a decision, that assumption alone comes first, with
 * its own editor (a number field with its current value and unit, or its other choices). Nothing is filled in for the
 * user, and the current path is not touched.
 */
export function WhatIfSheet({ store, r, b, p, focus, onClose }: { store: RealityStore; r: Reality; b: Branch; p?: Possibility; focus?: string; onClose: () => void }) {
  const related = relatedAssumptions(r, b, p ?? { about: focus ? [focus] : [] });
  const linked = related.filter((x) => x.linked);
  const others = related.filter((x) => !x.linked);
  const [text, setText] = useState("");
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus({ preventScroll: true }), [p?.id, focus]);
  const said = !p ? null : p.cause ? (({ consequence, condition }) => `${consequence} if ${condition}`)(conditionalSentence(p.text, p.cause.trigger)) : p.text;
  const target = !p ? linked[0]?.variable : undefined;
  return (
    <div className="sheet whatif" data-testid="whatif-sheet">
      <p className="eyebrow">What if this changed?</p>
      {said !== null
        ? <h3 ref={head} tabIndex={-1} className="whatif-quote">“{said}”</h3>
        : <h3 ref={head} tabIndex={-1} className="whatif-quote">{target ? `What if “${target.label}” were different?` : "What is different on the new path?"}</h3>}
      <p className="small muted">A new path starts as a copy of “{b.name}” with one change you choose. “{b.name}” stays exactly as it is.</p>
      {linked.length > 0 ? (
        <>
          <h4 className="whatif-h">{p ? "The AI linked it to" : "Change it on a new path"}</h4>
          <ul className="whatif-list">{linked.map((a) => <WhatIfRow key={a.variable.key} store={store} b={b} a={a} />)}</ul>
        </>
      ) : p ? (
        <p className="small" data-testid="whatif-unlinked">This suggestion is not linked to any assumption. Change one of the assumptions below, or describe the change in your own words.</p>
      ) : null}
      {others.length > 0 && (
        <details className="whatif-more" open={linked.length === 0} data-testid="whatif-others">
          <summary>{linked.length ? `Change something else (${others.length})` : `Assumptions on this path (${others.length})`}</summary>
          <ul className="whatif-list">{others.map((a) => <WhatIfRow key={a.variable.key} store={store} b={b} a={a} />)}</ul>
        </details>
      )}
      <form className="name-path" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void store.exploreChange(b.id, { text }); }}>
        <label htmlFor="whatif-text">Or describe a different change</label>
        <div className="row">
          <input id="whatif-text" value={text} maxLength={MAX_FACT_TEXT} onChange={(e) => setText(e.target.value)} placeholder="e.g. I negotiate a higher salary" data-testid="whatif-text" />
          <button type="submit" className="btn" disabled={!text.trim()} data-testid="whatif-text-create">Create path</button>
        </div>
        <p className="small muted">Saved on the new path as a change you are exploring, not as a known fact. Nothing is calculated from your words; suggestions there are marked for another look.</p>
      </form>
      <button type="button" className="link-btn" onClick={onClose} data-testid="whatif-cancel">Cancel</button>
    </div>
  );
}

/**
 * "What this change does": the new path compared with the one it came from, in three kinds: what the user changed,
 * what is calculated from formulas, and possibilities that may no longer hold (never recalculated).
 */
export function WhatIfNote({ r, b, onCompare }: { r: Reality; b: Branch; onCompare: (parentId: string) => void }) {
  const w = whatIfView(r, b.id);
  if (!w) return null;
  const calc = w.calculated.map(({ formula: f, from, to }) => {
    const u = formulaUnit(r, f.key);
    return to.status === "ok"
      ? from.status === "ok" ? `${f.label}: ${showOutcome(u, to)} (was ${showOutcome(u, from)})` : `${f.label}: ${showOutcome(u, to)} (could not be worked out before)`
      : to.status === "missing" ? `${f.label} still needs ${to.missing.join(", ")}`
      : to.status === "not-applicable" ? `${f.label} doesn't apply with these numbers` : `${f.label} can't be worked out: ${to.message}`;
  });
  const blocked = w.stillNeeds.map((x) => `${x.formula.label} needs ${x.missing.join(", ")}`);
  return (
    <div className="whatif-note" data-testid="whatif-note">
      <p className="eyebrow">What this change does</p>
      <p className="small muted">Compared with “{w.parent.name}”, which stays as it was. A possible future to think with, not a prediction.</p>
      <section className="whatif-part" data-testid="whatif-changed">
        <h4><span className="badge known">Changed by you</span></h4>
        <ul>
          {w.changed.map((v) => <li key={v.key}>{showSetting(v.label, v.to, v.unit)} <span className="muted">(was {v.from === null ? "not known" : showAssumption(v.from, v.unit)})</span></li>)}
          {w.told.map((f, i) => <li key={`t${i}`}>{toldLine(f)}</li>)}
        </ul>
      </section>
      <section className="whatif-part" data-testid="whatif-calculated">
        <h4><span className="badge calc">Calculated</span></h4>
        {calc.length > 0 ? <ul>{calc.map((l, i) => <li key={i}>{l}</li>)}</ul>
          : <p className="small">{w.hasFormulas ? `No calculated result changes.${blocked.length ? ` ${blocked.join("; ")}.` : ""}` : "This map has no calculations, so nothing here is worked out with numbers."}</p>}
        {calc.length > 0 && blocked.length > 0 && <p className="small muted">{blocked.join("; ")}.</p>}
      </section>
      <section className="whatif-part" data-testid="whatif-reconsider">
        <h4><span className="badge possible">Possible</span> May no longer hold</h4>
        {w.reconsider.length > 0 ? (
          <ul>{w.reconsider.map(({ possibility: p, because }) => <li key={p.id}>{p.text} <span className="muted">(depends on {because.join(", ")})</span></li>)}</ul>
        ) : (
          <p className="small">{w.madeBefore ? `${plural(w.madeBefore, "1 AI suggestion here was", `${w.madeBefore} AI suggestions here were`)} made before this change.` : "No AI suggestion here depends on what you changed."}</p>
        )}
        {(w.reconsider.length > 0 || w.madeBefore > 0) && <p className="small muted">Not recalculated: possibilities are kept as the AI wrote them until you ask for another look.</p>}
        {w.carried.length > 0 && (
          <p className="small" data-testid="whatif-carried">
            {plural(w.carried.length, "1 other possibility was", `${w.carried.length} other possibilities were`)} copied from an earlier path and not re-checked for this one: {w.carried.map((c) => c.possibility.text).join("; ")}.
          </p>
        )}
      </section>
      <button type="button" className="link-btn" onClick={() => onCompare(w.parent.id)} data-testid="whatif-compare">Compare with “{w.parent.name}” side by side</button>
    </div>
  );
}

/** One idea per list, with an inline way to add your own thought. */
function Thoughts({ store, r, b, tone, items, stale, carried, title, glyph, empty, onWhatIf }: { store: RealityStore; r: Reality; b: Branch; tone: Tone | null; items: readonly Possibility[]; stale: ReadonlyMap<string, StaleSuggestion>; carried: ReadonlyMap<string, CarriedOver>; title: string; glyph: string; empty: string; onWhatIf: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    // What the user types is recorded as theirs ("user"); nothing else is ever given that source.
    void store.updateBranch(b.id, { possibilities: [...b.possibilities, { id: newPossibilityId(), text: text.trim(), likelihood: "not-judged", note: "", source: "user", ...(tone ? { tone } : {}) }] });
    setText("");
    setAdding(false);
  };
  // The caption says who wrote these only as far as that is recorded; a list from several sources marks each item.
  const origins = items.map(possibilityOrigin);
  const caption = possibilityCaption(origins);
  const markEach = new Set(origins).size > 1;
  const id = tone ?? "either";
  return (
    <section className={`thoughts ${id}`} data-testid={`story-${tone === "upside" ? "upsides" : tone === "challenge" ? "challenges" : "either"}`}>
      <h3><span className="glyph" aria-hidden="true">{glyph}</span>{title}</h3>
      <p className="caption">{caption}</p>
      {items.length > 0 ? (
        <ul>
          {items.map((p) => {
            const s = stale.get(p.id);
            const c = carried.get(p.id);
            const state = s ? (
              <span className="tag fresh" data-testid={`stale-${p.id}`} title={[s.changed.length ? `${s.changed.join(", ")} changed since this was suggested.` : "", s.madeBefore ? "Suggested before you told us something new." : ""].filter(Boolean).join(" ")}>
                may need a fresh look
              </span>
            ) : c ? <CarriedTag c={c} /> : null;
            const origin = markEach ? <span className="tag origin" data-testid={`origin-${p.id}`}>{possibilityTag(possibilityOrigin(p))}</span> : null;
            const tag = <>{origin}{state}</>;
            const view = consequenceView(r, b, p);
            // One quiet entry point per suggestion: explore changing what it depends on, on a new path.
            const whatIf = (
              <button type="button" className="link-btn whatif-link" onClick={() => onWhatIf(p.id)} aria-label={`What if this changed? ${p.text}`} data-testid={`what-if-${p.id}`}>
                What if this changed?
              </button>
            );
            return view
              ? <li key={p.id} className="cons" data-testid={`cons-${p.id}`}><Consequence view={view} id={p.id} tag={tag} />{whatIf}</li>
              : <li key={p.id}>{p.text}{tag}{whatIf}</li>;
          })}
        </ul>
      ) : <p className="muted small">{empty}</p>}
      {tone && (adding ? (
        <form className="add-thought" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label className="sr-only" htmlFor={`add-${id}`}>{title}</label>
          <input id={`add-${id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={tone === "upside" ? "Something that could go well" : "Something that could be hard"} data-testid={`add-${id}-text`} />
          <button type="submit" className="btn" data-testid={`add-${id}-save`}>Add</button>
          <button type="button" className="link-btn" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <button type="button" className="link-btn add-link" onClick={() => setAdding(true)} data-testid={`add-${id}`}>＋ Add a thought</button>
      ))}
    </section>
  );
}

/**
 * One thing the user told us, editable in place. Saving an empty answer removes it. A change the user is exploring is
 * shown as exactly that: their premise for this path, not a fact they know.
 */
export function FactItem({ fact, scope, max, testid, onSave, onRemove }: { fact: KnownFact; scope: string; max: number; testid: string; onSave: (text: string) => Promise<unknown>; onRemove?: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.answer);
  const exploring = isIntervention(fact);
  useEffect(() => setText(fact.answer), [fact.answer]);
  if (editing) {
    return (
      <li className="known-item editing" data-testid={testid}>
        <form className="add-thought" onSubmit={(e) => { e.preventDefault(); setEditing(false); void onSave(text); }}>
          <label className="small known-q" htmlFor={`${testid}-input`}>{exploring ? "The change you are exploring" : fact.question || "Something you told us"}</label>
          <input id={`${testid}-input`} autoFocus value={text} maxLength={max} onChange={(e) => setText(e.target.value)} data-testid={`${testid}-input`} />
          <button type="submit" className="btn" data-testid={`${testid}-save`}>Save</button>
          <button type="button" className="link-btn" onClick={() => { setText(fact.answer); setEditing(false); }}>Cancel</button>
        </form>
      </li>
    );
  }
  return (
    <li className={`known-item ${exploring ? "hypothetical" : ""}`} data-testid={testid}>
      <span className="known-text">
        {exploring ? <span className="known-q">Change you are exploring (a what-if, not a known fact): </span> : fact.question && <span className="known-q">{fact.question} </span>}
        <strong>{fact.answer}</strong>
      </span>
      <span className="scope">{scope}</span>
      <span className="known-actions">
        <button type="button" className="link-btn" onClick={() => setEditing(true)} aria-label={`Change: ${fact.answer}`} data-testid={`${testid}-edit`}>Change</button>
        {onRemove && <button type="button" className="link-btn" onClick={() => void onRemove()} aria-label={`Remove: ${fact.answer}`} data-testid={`${testid}-remove`}>Remove</button>}
      </span>
    </li>
  );
}

/**
 * Known: what the user told RealityFork (context answers, facts about this path, values they set).
 * `onTold` runs after something was saved, so the next step can take focus when it has a follow-up.
 */
function KnownSection({ store, b, known, onTold }: { store: RealityStore; b: Branch; known: KnownView; onTold: () => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const told = async (saved: Promise<unknown>) => {
    if (await saved) onTold();
  };
  const add = () => {
    if (!text.trim()) return;
    void told(store.addFact(b.id, text));
    setText("");
    setAdding(false);
  };
  const empty = known.context.length + known.facts.length + known.values.length + known.notApplicable.length === 0;
  return (
    <section className="known-section" aria-labelledby="known-title" data-testid="story-known">
      <h3 id="known-title"><span className="badge known">Known</span> What you told us</h3>
      <p className="caption">From you, not from the AI.</p>
      {empty ? (
        <p className="muted small">Nothing yet. Tell RealityFork something you know about this path and it shows what that changes.</p>
      ) : (
        <ul className="known-list">
          {known.context.map((f, i) => (
            <FactItem key={f.id} fact={f} scope="every path" max={MAX_CONTEXT_TEXT} testid={`known-context-${i}`} onSave={(t) => told(store.editContextFact(b.id, f.id, t))} />
          ))}
          {known.facts.map((f, i) => (
            <FactItem key={f.id} fact={f} scope={f.from ? `from “${f.from.name}”` : "this path"} max={MAX_FACT_TEXT} testid={`known-fact-${i}`} onSave={(t) => told(store.editFact(b.id, f.id, t))} onRemove={() => told(store.removeFact(b.id, f.id))} />
          ))}
          {known.values.map(({ variable: v, value, from, stated }) => (
            <li key={v.key} className="known-item" data-testid={`known-value-${v.key}`}>
              <span className="known-text">{showSetting(v.label, value, v.unit, "exact")}</span>
              <span className="scope" title={from ? `You set this in “${from.name}”; it came with this path.` : undefined}>{from ? `from “${from.name}”` : "this path"}</span>
              {/* A figure from the question is the user's own what-if number, shown with their words. It is not verified. */}
              {stated && <span className="known-quote small muted" data-testid={`known-stated-${v.key}`}>From your question: “{stated.text}”. A what-if figure you wrote, not checked against anything.</span>}
            </li>
          ))}
          {/* What the user said does not apply here: shown as that (not 0, not unknown), and reversible. */}
          {known.notApplicable.map((v) => (
            <li key={`na-${v.key}`} className="known-item" data-testid={`known-na-${v.key}`}>
              <span className="known-text">{v.label}: doesn't apply to this path</span>
              <span className="known-actions">
                <button type="button" className="link-btn" onClick={() => void store.markApplicable(b.id, v.key)} data-testid={`known-na-undo-${v.key}`}>It applies</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form className="add-thought" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label className="sr-only" htmlFor="add-known">Something you know about this path</label>
          <input id="add-known" autoFocus maxLength={MAX_FACT_TEXT} value={text} onChange={(e) => setText(e.target.value)} placeholder="Something you know, in your own words" data-testid="add-known-text" />
          <button type="submit" className="btn" data-testid="add-known-save">Add</button>
          <button type="button" className="link-btn" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <button type="button" className="link-btn add-link" onClick={() => setAdding(true)} data-testid="add-known">＋ Add something you know</button>
      )}
    </section>
  );
}

/** Plain-language lines for a change, filled from computed values only. */
function changeLines(r: Reality, s: ChangeSummary): string[] {
  const out: string[] = [];
  for (const f of s.facts) out.push(factChangeLine(f));
  for (const v of s.values) out.push(v.from === null ? showSetting(v.label, v.to, v.unit) : `${showSetting(v.label, v.to, v.unit)} (was ${showAssumption(v.from, v.unit)})`);
  for (const { formula: f, from, to } of s.calculated) {
    const u = formulaUnit(r, f.key);
    if (to.status === "ok") out.push(from.status === "ok" ? `${f.label}: ${showOutcome(u, to)} (was ${showOutcome(u, from)})` : `${f.label} can now be worked out: ${showOutcome(u, to)}`);
    else if (to.status === "missing") out.push(`${f.label} still needs ${to.missing.join(", ")}`);
    else if (to.status === "not-applicable") out.push(`${f.label} doesn't apply ${to.reason.endsWith("not apply to this path") ? `here (${to.reason})` : "with these numbers"}`);
    else out.push(`${f.label} can't be worked out: ${to.message}`);
  }
  return out;
}

export function ChangeNote({ r, s }: { r: Reality; s: ChangeSummary }) {
  const lines = changeLines(r, s);
  if (!lines.length) return null;
  return (
    <div className="change-note" data-testid="what-changed">
      <p className="eyebrow">What changed</p>
      <ul>
        {lines.slice(0, 6).map((l, i) => <li key={i}>{l}</li>)}
        {lines.length > 6 && <li className="muted">and {lines.length - 6} more</li>}
      </ul>
    </div>
  );
}

export const staleTitle = (n: number) => (n === 1 ? "One AI suggestion may need a fresh look" : `${n} AI suggestions may need a fresh look`);
export function staleWhy(stale: readonly StaleSuggestion[]): string {
  const changed = [...new Set(stale.flatMap((s) => s.changed))];
  return [
    changed.length ? `${changed.join(", ")} changed since ${plural(stale.length, "it was", "they were")} suggested.` : "",
    stale.some((s) => s.madeBefore) ? `${plural(stale.length, "It was", "They were")} suggested before you told us something new.` : "",
  ].filter(Boolean).join(" ");
}
export const LOOK_SCOPE = "Sends only this path, your question and what you told us. Nothing changes until you approve.";
export const LOOK_BUSY = "Another look is in progress for a different path. Try again when it is done.";

/** The fresh-look offer when it is the next step: the stage's primary action. */
function FreshLookCard({ store, b, stale, busy, onNotNow }: { store: RealityStore; b: Branch; stale: readonly StaleSuggestion[]; busy: boolean; onNotNow: () => void }) {
  return (
    <div className="next-card" data-testid="fresh-look">
      <p className="eyebrow">Next step</p>
      <h3>{staleTitle(stale.length)}</h3>
      <p className="small muted">{staleWhy(stale)}</p>
      <button className="btn btn-primary" disabled={busy} onClick={() => void store.requestRevisit(b.id)} data-testid="ask-fresh-look">Ask AI to take another look</button>
      <p className="small muted">{busy ? LOOK_BUSY : LOOK_SCOPE}</p>
      <button type="button" className="link-btn" onClick={onNotNow} data-testid="continue-without-ai">Continue without AI</button>
    </div>
  );
}

/**
 * The same offer while another step is the primary one (an open question, choosing a future): compact, secondary,
 * directly under "What changed", so it is never hidden behind that step.
 */
function FreshLookPrompt({ store, b, stale, busy, onNotNow }: { store: RealityStore; b: Branch; stale: readonly StaleSuggestion[]; busy: boolean; onNotNow: () => void }) {
  return (
    <div className="fresh-prompt" data-testid="fresh-look-prompt">
      <p><strong>{staleTitle(stale.length)}.</strong> <span className="small muted">{staleWhy(stale)}</span></p>
      <div className="actions-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void store.requestRevisit(b.id)} data-testid="ask-fresh-look">Ask AI to take another look</button>
        <button type="button" className="link-btn small" onClick={onNotNow} data-testid="fresh-look-not-now">Not now</button>
      </div>
      <p className="small muted">{busy ? LOOK_BUSY : LOOK_SCOPE}</p>
    </div>
  );
}

const REVISIT_TITLE: Record<string, string> = {
  "judge-required": "AI access for judges",
  "no-key": "The AI guide isn't switched on here",
  quota: "Today's free AI allowance is used up",
  "rate-limited": "The AI guide is busy for a moment",
  "local-limit": "One moment between requests",
  "invalid-output": "The AI's suggestions didn't pass our checks",
  timeout: "The AI guide took too long",
  changed: "This path changed in the meantime",
};
const REVISIT_RETRY = new Set(["rate-limited", "local-limit", "invalid-output", "timeout", "provider-error", "unavailable", "changed", "judge-unavailable"]);
const TONE_GLYPH: Record<ProposalTone, string> = { upside: "↗", challenge: "↘", uncertain: "↔" };
const TONE_WORDS: Record<ProposalTone, string> = { upside: "Could go well", challenge: "Could be hard", uncertain: "Could go either way" };

/** The AI's fresh look at this path: loading, failed, or a preview the user approves item by item. */
export function RevisitCard({ store, rv, b }: { store: RealityStore; rv: Exclude<RevisitState, { status: "idle" }>; b: Branch }) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus({ preventScroll: true }), [rv.status]);
  if (rv.status === "loading") {
    return (
      <div className="next-card" aria-busy="true" data-testid="revisit-loading">
        <p className="eyebrow">Another look</p>
        <h3 ref={head} tabIndex={-1}>Taking another look at “{b.name}”…</h3>
        <p className="small muted">Only this path, your question and what you told us are sent.</p>
      </div>
    );
  }
  if (rv.status === "error") {
    return (
      <div className="next-card" role="alert" data-testid="revisit-error">
        <p className="eyebrow">Another look</p>
        <h3 ref={head} tabIndex={-1}>{REVISIT_TITLE[rv.code] ?? "The AI couldn't take another look"}</h3>
        <p className="small">{rv.message}</p>
        {rv.code === "judge-required" && <JudgeAccessForm onAccess={() => void store.requestRevisit(b.id)} />}
        <p className="small muted">Nothing in this path was changed.</p>
        {REVISIT_RETRY.has(rv.code) && <button type="button" className="btn" onClick={() => void store.requestRevisit(b.id)} data-testid="revisit-retry">Ask again</button>}
        <button type="button" className="link-btn" onClick={store.dismissRevisit} data-testid="revisit-dismiss">Continue without AI</button>
      </div>
    );
  }
  const s = rv.suggestion;
  const byId = new Map(b.possibilities.map((p) => [p.id, p]));
  return (
    <div className="next-card revisit" data-testid="revisit-preview">
      <p className="eyebrow"><span className="badge ai">AI-suggested</span> Another look at this path</p>
      <h3 ref={head} tabIndex={-1} data-testid="revisit-summary">{s.summary}</h3>
      {s.reconsider.length > 0 && (
        <fieldset className="rv-group" data-testid="revisit-reconsider">
          <legend>May no longer hold</legend>
          <p className="small muted">Ticked ones are set aside: kept with the reason, not deleted.</p>
          {s.reconsider.map((x, i) => (
            <label key={x.id} className="check">
              <input type="checkbox" checked={rv.selection.reconsider[i]} onChange={() => store.toggleRevisit("reconsider", i)} data-testid={`revisit-reconsider-${i}`} />
              <span>{byId.get(x.id)?.text ?? x.id}<span className="rv-reason small muted">Why: {x.reason}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {s.add.length > 0 && (
        <fieldset className="rv-group" data-testid="revisit-add">
          <legend>New possibilities for this path</legend>
          {s.add.map((x, i) => (
            <label key={i} className="check">
              <input type="checkbox" checked={rv.selection.add[i]} onChange={() => store.toggleRevisit("add", i)} data-testid={`revisit-add-${i}`} />
              <span>
                <span className={`tone-glyph ${x.tone}`} aria-hidden="true">{TONE_GLYPH[x.tone]}</span><span className="sr-only">{TONE_WORDS[x.tone]}: </span>
                {conditionalSentence(x.text, x.trigger).consequence} <span className="cons-if">if {conditionalSentence(x.text, x.trigger).condition}.</span>
                <span className="rv-reason small muted">Why: {x.mechanism}</span>
                {x.downstream && <span className="rv-reason small muted">Then: {x.downstream}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {(s.questions.length > 0 || s.evidence.length > 0) && (
        <div className="rv-verify" data-testid="revisit-verify">
          <h4>To verify before relying on this path</h4>
          <ul>
            {s.questions.map((q, i) => <li key={`q${i}`}>{q}</li>)}
            {s.evidence.map((q, i) => <li key={`e${i}`}>Find out: {q}</li>)}
          </ul>
        </div>
      )}
      <p className="small muted">Possibilities to think with, not predictions or advice. Nothing changes until you choose “Add to this path”. Drafted by {rv.model}.</p>
      {rv.warnings.length > 0 && <p className="small muted" data-testid="revisit-adjustments">Checks adjusted this reply: {rv.warnings.join(" ")}</p>}
      <div className="actions-row">
        <button type="button" className="btn btn-primary" onClick={() => void store.applyRevisit()} data-testid="revisit-apply">Add to this path</button>
        <button type="button" className="link-btn" onClick={store.dismissRevisit} data-testid="revisit-not-now">Not now</button>
      </div>
    </div>
  );
}

/** Stage 3–4: one future told as a story, the map of paths, and one clear next step. */
export function Explore({ store }: { store: RealityStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const r = store.active()!;
  const b = store.selected()!;
  return <ExploreFuture key={b.id} store={store} state={state} r={r} b={b} />;
}

function ExploreFuture({ store, state, r, b }: { store: RealityStore; state: RealityState; r: Reality; b: Branch }) {
  const story = branchStory(r, b);
  const hues = pathHues(r);
  const [sheet, setSheet] = useState<null | "path" | "compare" | "whatif">(null);
  /** The suggestion or decision "What if this changed?" was opened for. */
  const [whatIfFor, setWhatIfFor] = useState<WhatIfTarget | null>(null);
  /** Skipped questions, with what the user had told us at that moment. */
  const [skipped, setSkipped] = useState<readonly { key: string; known: readonly string[] }[]>([]);
  /** The path's fingerprint when the user chose "Continue without AI" (the prompt returns after a new change). */
  const [notNow, setNotNow] = useState<string | null>(null);
  const children = r.branches.filter((x) => x.parentId === b.id);
  // What the user said that may answer an open question (deterministic word match; nothing is filled in).
  const told = new Map(story.matches.map((m) => [m.variable.key, m.facts]));
  const rank = new Map(story.matches.map((m, i) => [m.variable.key, i]));
  // A skipped question comes back when the user later says something new that matches it.
  const isSkipped = (key: string) => {
    const s = skipped.find((x) => x.key === key);
    return s !== undefined && !(told.get(key) ?? []).some((f) => !s.known.includes(factKey(f)));
  };
  // Questions that something the user said may answer come first; the others keep their order.
  const pending = story.unknowns
    .filter((u) => !isSkipped(u.variable.key))
    .map((u, i) => ({ u, i }))
    .sort((x, y) => (rank.get(x.u.variable.key) ?? Infinity) - (rank.get(y.u.variable.key) ?? Infinity) || x.i - y.i)
    .map(({ u }) => u);
  const parent = b.parentId ? r.branches.find((x) => x.id === b.parentId) : undefined;
  const siblings = r.branches.filter((x) => x.parentId === b.parentId && x.id !== b.id);
  const suggestion = siblings[0] ?? parent ?? children[0];
  const ai = r.origin?.kind === "ai";
  // A map built from an example keeps the example's figures (marked "example figure") until the user replaces them.
  const examples = r.branches.some((x) => Object.values(x.sources ?? {}).includes("example"));
  const rv = state.revisit.status !== "idle" && state.revisit.realityId === r.id && state.revisit.branchId === b.id ? state.revisit : null;
  const mark = state.change && state.change.realityId === r.id && state.change.branchId === b.id ? state.change : null;
  const before = mark?.before.branches.find((x) => x.id === b.id);
  const summary = mark && before ? describeChange({ r: mark.before, b: before }, { r, b }) : null;
  const staleById = new Map(story.stale.map((s) => [s.possibility.id, s]));
  const carriedById = new Map(story.carried.map((c) => [c.possibility.id, c]));
  // The fresh-look offer depends only on flagged suggestions, never on which other step is showing.
  const offerLook = story.stale.length > 0 && notNow !== b.fingerprint && sheet === null && !rv;
  const lookBusy = state.revisit.status === "loading" && !rv;
  const lookNotNow = () => setNotNow(b.fingerprint);
  /** "What if this changed?" for a suggestion or a decision: the sheet opens in the next-step area, brought into view. */
  const openWhatIf = (target: WhatIfTarget) => {
    setWhatIfFor(target);
    setSheet("whatif");
    nextRef.current?.scrollIntoView({ block: "start" });
  };
  const onWhatIf = (id: string) => openWhatIf({ kind: "suggestion", id });
  /** This path was just created with "What if this changed?": show what the change does. */
  const whatIfActive = state.whatIf?.realityId === r.id && state.whatIf.branchId === b.id;

  // After a fresh look is applied or dismissed, keep keyboard focus in the next-step area.
  const nextRef = useRef<HTMLElement>(null);
  const hadRevisit = useRef(false);
  useEffect(() => {
    if (hadRevisit.current && !rv) nextRef.current?.focus({ preventScroll: true });
    hadRevisit.current = rv !== null;
  }, [rv]);
  // After the user tells us something, bring its follow-up (a matching question, a fresh-look offer) into view.
  // On phones the next step sits above "What you told us", out of sight without this.
  const [toldCount, setToldCount] = useState(0);
  const followUp = useRef(false);
  followUp.current = offerLook || (pending[0] !== undefined && told.has(pending[0].variable.key));
  useEffect(() => {
    if (toldCount && followUp.current) nextRef.current?.focus();
  }, [toldCount]);

  let next: ReactNode;
  let lookIsNext = false;
  let branchIsNext = false;
  // Questions and things to find out that no number can answer (from the draft, and from approved fresh looks).
  const openItems = r.questions.length + (r.origin?.evidence.length ?? 0) + story.toVerify.length + story.toFindOut.length;
  const whatIfP = sheet === "whatif" && whatIfFor?.kind === "suggestion" ? b.possibilities.find((p) => p.id === whatIfFor.id) : undefined;
  const whatIfKey = sheet === "whatif" && whatIfFor?.kind === "assumption" && r.variables.some((v) => v.key === whatIfFor.key) ? whatIfFor.key : undefined;
  if (whatIfP) next = <WhatIfSheet store={store} r={r} b={b} p={whatIfP} onClose={() => setSheet(null)} />;
  else if (whatIfKey) next = <WhatIfSheet store={store} r={r} b={b} focus={whatIfKey} onClose={() => setSheet(null)} />;
  else if (sheet === "path") next = <PathSheet store={store} r={r} b={b} onClose={() => setSheet(null)} />;
  else if (sheet === "compare") next = <ComparePicker store={store} r={r} b={b} onClose={() => setSheet(null)} />;
  else if (rv) next = <RevisitCard store={store} rv={rv} b={b} />;
  else if (r.variables.length === 0) {
    next = (
      <div className="next-card">
        <p className="eyebrow">Next step</p>
        <h3>What matters in this situation?</h3>
        <p className="small muted">Add the things you'd want to know or decide: a cost, a choice, a yes or no. Then branch into alternatives.</p>
        <button className="btn btn-primary" onClick={() => store.openDetails("define")} data-testid="add-what-matters">Add what matters</button>
      </div>
    );
  } else if (story.isStart && children.length > 0 && (ai || pending.length === 0)) {
    next = (
      <div className="next-card">
        <p className="eyebrow">Next step</p>
        <h3>Choose a future to explore</h3>
        <ul className="choice-list">
          {children.map((c) => (
            <li key={c.id}>
              <button type="button" className="choice" style={{ ["--hue" as string]: hues.get(c.id) }} onClick={() => store.select(c.id)} data-testid={`open-future-${c.name}`}>
                <span className="choice-label"><span className="dot" aria-hidden="true" />{c.name}</span>
                <span className="small muted">{c.description || changeCaption(changesFromParent(r, c), false)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (pending.length > 0) {
    const u = pending[0]!;
    const key = u.variable.key;
    next = (
      <QuestionCard
        key={key} store={store} b={b} u={u} remaining={pending.length} told={told.get(key) ?? []} hint={u.variable.kind === "number" ? currencyHint(r.question, u.variable.label, u.variable.unit) : null}
        onSkip={() => setSkipped((s) => [...s.filter((x) => x.key !== key), { key, known: knownKeys(r, b) }])}
      />
    );
  } else if (offerLook) {
    lookIsNext = true;
    next = <FreshLookCard store={store} b={b} stale={story.stale} busy={lookBusy} onNotNow={() => { lookNotNow(); store.dismissChange(); }} />;
  } else if (suggestion) {
    next = (
      <div className="next-card">
        <p className="eyebrow">Next step</p>
        {/* "Filled in" only says every number has a value. It never says the questions about this future are answered. */}
        <h3>{story.unknowns.length ? "You skipped a few questions" : openItems > 0 ? "Every number has a value" : "This future is filled in"}</h3>
        {story.unknowns.length === 0 && openItems > 0 && (
          <p className="small muted" data-testid="open-items-note">{openItems} {plural(openItems, "question or thing to find out is", "questions and things to find out are")} still open. Numbers cannot answer {plural(openItems, "it", "them")}; see “Still unknown” below.</p>
        )}
        <p className="small muted">See how it differs from another path.</p>
        <button className="btn btn-primary" onClick={() => store.openCompare(b.id, suggestion.id)} data-testid="compare-suggested">Compare with “{suggestion.name}”</button>
        {skipped.length > 0 && <button type="button" className="link-btn" onClick={() => setSkipped([])} data-testid="ask-again">Ask the skipped questions again</button>}
      </div>
    );
  } else {
    branchIsNext = true;
    // This is the one "Explore another path from here" on screen: the quiet link below is left out while it is the primary.
    next = (
      <div className="next-card">
        <p className="eyebrow">Next step</p>
        <h3>Explore an alternative</h3>
        <p className="small muted">Create a second path to compare with this one.</p>
        <button className="btn btn-primary" onClick={() => setSheet("path")} data-testid="branch-from-here">Explore another path from here</button>
      </div>
    );
  }
  const showChange = sheet === null && !rv && summary !== null;
  const hasUnknowns = story.unknowns.length > 0 || openItems > 0;

  return (
    <main className="stage explore" data-testid="story">
      <header className="stage-head explore-head">
        <p className="eyebrow" data-testid="map-kind">{ai ? <><span className="badge ai">AI-suggested map</span> accepted by you</> : examples ? "Your copy of an example: its figures are illustrative" : "Your map"}</p>
        <h1 className="question" tabIndex={-1} data-stage-focus data-testid="question">{r.question}</h1>
        <SavedNote state={state} r={r} />
        <details className="about">
          <summary>About this map</summary>
          <div className="about-body">
            {r.description && <p>{r.description}</p>}
            {r.origin && (
              <>
                <p className="small">Drafted by {r.origin.model} and accepted by you on {r.origin.acceptedAt.slice(0, 10)}. It contained no figures: every number comes from you.</p>
                {r.origin.limitations.length > 0 && <><h4>Limits</h4><ul>{r.origin.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
              </>
            )}
            {(b.revisits ?? []).length > 0 && (
              <p className="small" data-testid="revisit-log">
                Another look at this path, approved by you: {(b.revisits ?? []).map((x) => `${x.at.slice(0, 10)} (${x.model})`).join(", ")}.
              </p>
            )}
          </div>
        </details>
      </header>

      <RealityMap reality={r} selectedId={b.id} onSelect={store.select} />

      <div className="explore-grid" style={{ ["--hue" as string]: hues.get(b.id) }}>
          <section className="story-hero" aria-labelledby="story-title">
            <p className="eyebrow">{story.isStart ? "Where you start" : parent ? <>A path from <button type="button" className="link-btn" onClick={() => store.select(parent.id)} data-testid="story-parent">{parent.name}</button></> : "A possible future"}</p>
            <h2 id="story-title" className="story-title" data-testid="story-title">{b.name}</h2>
            {b.description && <p className="story-desc">{b.description}</p>}
            <div className="changes" data-testid="story-changes">
              {story.changes.length + story.told.length > 0 ? (
                <>
                  <h3 className="sr-only">What's different here</h3>
                  {story.changes.length > 0 && (
                    <ul className="decision-chips">
                      {story.changes.map((c) => (
                        <li key={c.key}>
                          <button type="button" className="decision" onClick={() => openWhatIf({ kind: "assumption", key: c.key })} title={`Try a different ${c.label.toLowerCase()} on a new path`} data-testid={`change-${c.key}`}>
                            {showSetting(c.label, c.to, c.unit)}
                            <span className="decision-try" aria-hidden="true">↺</span>
                            <span className="sr-only"> — try a different value on a new path</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {story.told.length > 0 && (
                    <ul className="decision-chips" data-testid="story-told">
                      {/* What the user told this path in their own words: kept as words, never turned into a value. */}
                      {story.told.map((f, i) => <li key={i}><span className={`told-chip ${isIntervention(f) ? "hypo" : ""}`} data-testid={isIntervention(f) ? "story-exploring" : "story-told-fact"}>{toldLine(f)}</span></li>)}
                    </ul>
                  )}
                </>
              ) : (
                <p className="muted small">{story.isStart ? "Nothing has changed yet: this is your starting point." : "Nothing is different yet. Answer a question or change a decision."}</p>
              )}
            </div>
          </section>

        <aside className={`next ${rv?.status === "ready" ? "unstick" : ""}`} aria-label="Next step" tabIndex={-1} ref={nextRef} data-testid="next-step">
          <div className="change-live" role="status" aria-live="polite">
            {whatIfActive && sheet === null && !rv
              ? <WhatIfNote r={r} b={b} onCompare={(parentId) => store.openCompare(parentId, b.id)} />
              : showChange && summary && <ChangeNote r={r} s={summary} />}
          </div>
          {offerLook && !lookIsNext && <FreshLookPrompt store={store} b={b} stale={story.stale} busy={lookBusy} onNotNow={lookNotNow} />}
          {next}
          {sheet === null && (
            <ul className="next-more">
              {!branchIsNext && <li><button type="button" className="link-btn" onClick={() => setSheet("path")} data-testid="branch-from-here">↳ Explore another path from here</button></li>}
              {/* Kept even when the primary is a comparison: the primary compares with one suggested path, this opens the picker. The labels differ and two earlier specs use the picker. */}
              {r.branches.length > 1 && <li><button type="button" className="link-btn" onClick={() => setSheet("compare")} data-testid="compare-with">⇄ Compare with another future</button></li>}
            </ul>
          )}
        </aside>

        <article className="story" aria-label={`What might happen in “${b.name}”`}>
          <KnownSection store={store} b={b} known={story.known} onTold={() => setToldCount((n) => n + 1)} />

          {(b.possibilities.length > 0 || !story.isStart || r.variables.length > 0) && (
            <section className="possible-section" aria-label="Possible">
              <p className="kind-line"><span className="badge possible">Possible</span> <span className="small muted">What might happen. Possibilities to think with, not predictions.</span></p>
              <div className="thought-grid">
                <Thoughts store={store} r={r} b={b} tone="upside" items={story.upsides} stale={staleById} carried={carriedById} title="Could go well" glyph="↗" empty="Nothing noted yet." onWhatIf={onWhatIf} />
                <Thoughts store={store} r={r} b={b} tone="challenge" items={story.challenges} stale={staleById} carried={carriedById} title="Could be hard" glyph="↘" empty="Nothing noted yet." onWhatIf={onWhatIf} />
                {story.unsorted.length > 0 && <Thoughts store={store} r={r} b={b} tone={null} items={story.unsorted} stale={staleById} carried={carriedById} title="Could go either way" glyph="↔" empty="" onWhatIf={onWhatIf} />}
              </div>
              {story.setAside.length > 0 && (
                <details className="set-aside small" data-testid="story-set-aside">
                  <summary>Set aside after another look ({story.setAside.length})</summary>
                  <ul>
                    {story.setAside.map((p) => (
                      <li key={p.id}>
                        <span className="set-aside-text">{p.text}</span>
                        <span className="rv-reason muted">Why: {p.setAside}</span>
                        <button type="button" className="link-btn" onClick={() => void store.restoreSuggestion(b.id, p.id)} data-testid={`restore-${p.id}`}>Put back</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          {r.formulas.length > 0 && (
            <section className="worked" data-testid="story-calculated">
              <h3><span className="badge calc">Calculated</span> Worked out from the figures on this path</h3>
              <ul className="worked-list">
                {story.calculated.map(({ formula: f, value }) => {
                  // Each result says which figures it uses and where each came from (you, an example, the AI draft).
                  const uses = formulaUses(r, b, f.key);
                  return (
                    <li key={f.key} className="worked-ok" data-testid={`story-calc-${f.key}`}>
                      <span className="worked-label">{f.label}{!f.reviewed && <span className="tag manual" title="This formula came with a draft or example. Check it in All details.">suggested formula</span>}</span>
                      <span className="worked-value">
                        {showOutcome(formulaUnit(r, f.key), { status: "ok", value })}
                        {typeof value === "number" && formulaUnit(r, f.key).status === "unknown" && <span className="small muted unit-unknown"> no unit given</span>}
                      </span>
                      {uses.length > 0 && <span className="worked-uses small muted">Uses: {uses.map((u) => `${u.variable.label} (${originWords(u.provenance)})`).join(" · ")}</span>}
                    </li>
                  );
                })}
                {story.blocked.map(({ formula: f, missing }) => (
                  <li key={f.key} className="worked-wait" data-testid={`story-calc-${f.key}`}>
                    <span className="worked-label">{f.label}</span>
                    <span className="small muted">needs {missing.join(", ")}</span>
                  </li>
                ))}
                {story.notApplicable.map(({ formula: f, reason }) => (
                  <li key={f.key} className="worked-wait" data-testid={`story-calc-${f.key}`}>
                    <span className="worked-label">{f.label}</span>
                    <span className="small muted">{notApplicableHere(r, b, f.key) ? `doesn't apply here: ${reason}` : `doesn't apply with these numbers${f.note ? `: ${f.note}` : ""}`}</span>
                  </li>
                ))}
                {story.failed.map(({ formula: f, message }) => (
                  <li key={f.key} className="worked-wait" data-testid={`story-calc-${f.key}`}>
                    <span className="worked-label">{f.label}</span>
                    <span className="small warn">can't be worked out: {message}</span>
                  </li>
                ))}
              </ul>
              <details className="small">
                <summary>How these are worked out</summary>
                <ul className="formula-list">{r.formulas.map((f) => <li key={f.key}><strong>{f.label}</strong> = <code>{f.expression}</code>{f.condition && <> (only when <code>{f.condition}</code>)</>} <span className="muted">({unitNote(formulaUnit(r, f.key))})</span></li>)}</ul>
              </details>
            </section>
          )}

          {r.simulations.length > 0 && (
            <section className="worked" data-testid="story-simulated">
              <h3><span className="badge sim">Simulated</span> with a validated model</h3>
              <ul className="outcomes-list">{r.simulations.map((s) => <SimulatedOutcome key={s.key} store={store} state={state} r={r} b={b} simKeyName={s.key} />)}</ul>
            </section>
          )}

          {hasUnknowns && (
            <section className="unknowns" data-testid="story-unknowns">
              <h3>Still unknown</h3>
              {story.unknowns.length > 0 && <ul className="unknown-chips">{story.unknowns.map((u) => <li key={u.variable.key}>{u.variable.label}</li>)}</ul>}
              {story.toVerify.length + story.toFindOut.length > 0 && (
                <div className="to-verify" data-testid="story-to-verify">
                  <h4>To verify before relying on this path</h4>
                  <ul>
                    {story.toVerify.map((q) => <li key={`q-${q}`}>{q}</li>)}
                    {story.toFindOut.map((q) => <li key={`e-${q}`}>Find out: {q}</li>)}
                  </ul>
                </div>
              )}
              {(r.questions.length > 0 || (r.origin?.evidence.length ?? 0) > 0) && (
                <details className="small">
                  <summary>Open questions and things worth finding out ({r.questions.length + (r.origin?.evidence.length ?? 0)})</summary>
                  <ul>{r.questions.map((q, i) => <li key={`q${i}`}>{q}</li>)}{r.origin?.evidence.map((q, i) => <li key={`e${i}`}>Find out: {q}</li>)}</ul>
                </details>
              )}
            </section>
          )}
        </article>
      </div>

      <AllDetails store={store} state={state} r={r} b={b} />
    </main>
  );
}

/** Secondary area: every assumption, formula and note, with the existing editors. */
function AllDetails({ store, state, r, b }: { store: RealityStore; state: RealityState; r: Reality; b: Branch }) {
  const open = state.details !== null;
  return (
    <section className="all-details" aria-label="All details">
      <button type="button" className="disclosure-btn" aria-expanded={open} aria-controls="all-details-body" onClick={() => (open ? store.closeDetails() : store.openDetails("branch"))} data-testid="all-details">
        {open ? "Hide details" : "All details: every assumption, formula and note"}
      </button>
      {open && (
        <div id="all-details-body" className="all-details-body">
          <div className="seg" role="tablist" aria-label="Detail sections">
            <button role="tab" aria-selected={state.details === "branch"} className={`seg-btn ${state.details === "branch" ? "on" : ""}`} onClick={() => store.openDetails("branch")} data-testid="tab-branch">This future: “{b.name}”</button>
            <button role="tab" aria-selected={state.details === "define"} className={`seg-btn ${state.details === "define" ? "on" : ""}`} onClick={() => store.openDetails("define")} data-testid="tab-define">What matters & formulas</button>
          </div>
          {state.details === "branch" ? <BranchPanel store={store} state={state} r={r} b={b} /> : <DefinePanel store={store} r={r} />}
        </div>
      )}
    </section>
  );
}
