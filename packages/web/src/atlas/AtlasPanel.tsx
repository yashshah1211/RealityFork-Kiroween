/**
 * The card beside the 3D scene: the selected future in words, kept compact so the world stays in view. By default it
 * tells the future's story in a few lines: its name and summary, what is different from the path it came from (in the
 * assumptions and in the picture), up to three outcomes backed by a calculation or a validated simulation, and the next
 * steps (another path, compare, details). "Details" opens everything else in the card (sources, every figure, what the
 * user told us, possibilities, another AI look) and "All details" the standard view. Everything here comes from core
 * views (branchStory, whatIfView, describeChange, formulaUses, consequenceView, possibilityOrigin) and the map's scenery
 * (environment/difference.ts) through the same formatters and the same components as the standard Explore view;
 * nothing is calculated or judged in this file. Branching, answering, simulating, comparing and another AI look use the
 * standard view's own sheets and cards, so they run exactly the same store operations, with the same checks.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  branchStory,
  consequenceView,
  currencyHint,
  describeChange,
  formulaUnit,
  formulaUses,
  getModel,
  isIntervention,
  MAX_CONTEXT_TEXT,
  notApplicableHere,
  possibilityOrigin,
  simulationInput,
  type AssumptionValue,
  type Branch,
  type BranchStory,
  type CalculatedResult,
  type CarriedOver,
  type Possibility,
  type Reality,
  type StaleSuggestion,
  type Tone,
  type ValueProvenance,
} from "@realityfork/core";
import { MAX_FACT_TEXT, simKey, type RealityState, type RealityStore } from "../reality/store";
import {
  CarriedTag,
  ChangeNote,
  ComparePicker,
  Consequence,
  FactItem,
  LOOK_BUSY,
  LOOK_SCOPE,
  PathSheet,
  QuestionCard,
  RevisitCard,
  staleTitle,
  staleWhy,
  WhatIfNote,
  WhatIfSheet,
} from "../reality/Explore";
import { newPossibilityId, SimulatedOutcome } from "../reality/panels";
import { originWords, possibilityCaption, possibilityTag, showAssumption, showOutcome, showSetting, toldLine, unitNote } from "../reality/format";
import { showValue } from "../format";
import { SavedNote } from "../reality/SavedNote";
import type { SceneView } from "./environment/difference";

export type Sheet =
  | null
  | "path"
  | "compare"
  | { readonly question: string }
  /** "What if this changed?" for one suggestion (its id) or one decision of this path (its assumption key). */
  | { readonly whatIf: string }
  | { readonly whatIfKey: string };

const sheetKeyOf = (s: Sheet) => (s === null ? "" : typeof s === "string" ? s : "question" in s ? `q:${s.question}` : "whatIf" in s ? `w:${s.whatIf}` : `k:${s.whatIfKey}`);

function Section({ title, badge, count, children, testid, open = true }: { title: string; badge?: { kind: string; text: string }; count?: number; children: ReactNode; testid: string; open?: boolean }) {
  return (
    <details className="ap-section" open={open} data-testid={testid}>
      <summary>
        {badge && <span className={`badge ${badge.kind}`}>{badge.text}</span>}
        <span className="ap-section-title">{title}</span>
        {count !== undefined && <span className="ap-count" aria-label={`${count}`}>{count}</span>}
      </summary>
      <div className="ap-section-body">{children}</div>
    </details>
  );
}

/**
 * One list of possibilities: each with its cause and "why" when the AI gave one, who wrote it when the list is mixed,
 * whether it may need a fresh look or was copied without a re-check, and a way to explore changing what it depends on.
 */
function PossibleList({ r, b, items, title, glyph, stale, carried, onWhatIf }: {
  r: Reality; b: Branch; items: readonly Possibility[]; title: string; glyph: string;
  stale: ReadonlyMap<string, StaleSuggestion>; carried: ReadonlyMap<string, CarriedOver>; onWhatIf: (id: string) => void;
}) {
  if (!items.length) return null;
  const origins = items.map(possibilityOrigin);
  const mixed = new Set(origins).size > 1;
  return (
    <div className="ap-poss">
      <h4><span aria-hidden="true">{glyph}</span> {title}</h4>
      <p className="ap-caption">{possibilityCaption(origins)}</p>
      <ul>
        {items.map((p) => {
          const s = stale.get(p.id);
          const c = carried.get(p.id);
          const tag = (
            <>
              {mixed && <span className="ap-tag">{possibilityTag(possibilityOrigin(p))}</span>}
              {s ? <span className="tag fresh" title={s.changed.length ? `${s.changed.join(", ")} changed since this was suggested.` : "Suggested before you told us something new."}>may need a fresh look</span> : c ? <CarriedTag c={c} /> : null}
            </>
          );
          const view = consequenceView(r, b, p);
          return (
            <li key={p.id} className={view ? "cons" : ""} data-testid={`atlas-poss-${p.id}`}>
              {view ? <Consequence view={view} id={p.id} tag={tag} /> : <>{p.text}{tag}</>}
              <button type="button" className="link-btn whatif-link" onClick={() => onWhatIf(p.id)} aria-label={`What if this changed? ${p.text}`} data-testid={`atlas-what-if-${p.id}`}>What if this changed?</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Add a thought of your own to this path: recorded as yours ("user"), sorted the way you choose. */
function AddThought({ store, b }: { store: RealityStore; b: Branch }) {
  const [tone, setTone] = useState<Tone | null>(null);
  const [text, setText] = useState("");
  if (!tone) {
    return (
      <p className="ap-add">
        <span className="ap-muted">Add your own:</span>
        <button type="button" className="link-btn" onClick={() => setTone("upside")} data-testid="atlas-add-upside">↗ could go well</button>
        <button type="button" className="link-btn" onClick={() => setTone("challenge")} data-testid="atlas-add-challenge">↘ could be hard</button>
      </p>
    );
  }
  const save = () => {
    if (!text.trim()) return;
    void store.updateBranch(b.id, { possibilities: [...b.possibilities, { id: newPossibilityId(), text: text.trim(), likelihood: "not-judged", note: "", source: "user", tone }] });
    setText("");
    setTone(null);
  };
  return (
    <form className="ap-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label className="sr-only" htmlFor="atlas-thought">{tone === "upside" ? "Something that could go well" : "Something that could be hard"}</label>
      <input id="atlas-thought" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={tone === "upside" ? "Something that could go well" : "Something that could be hard"} data-testid="atlas-thought-text" />
      <div className="ap-form-row">
        <button type="submit" className="btn pill" disabled={!text.trim()} data-testid="atlas-thought-save">Add</button>
        <button type="button" className="link-btn" onClick={() => setTone(null)}>Cancel</button>
      </div>
    </form>
  );
}

/** Something the user knows about this path, in their own words (the same operation as the standard view). */
function AddKnown({ store, b }: { store: RealityStore; b: Branch }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) return <button type="button" className="link-btn ap-add-link" onClick={() => setOpen(true)} data-testid="atlas-add-known">＋ Add something you know</button>;
  return (
    <form className="ap-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void store.addFact(b.id, text); setText(""); setOpen(false); } }}>
      <label className="sr-only" htmlFor="atlas-known-text">Something you know about this path</label>
      <input id="atlas-known-text" autoFocus maxLength={MAX_FACT_TEXT} value={text} onChange={(e) => setText(e.target.value)} placeholder="Something you know, in your own words" data-testid="atlas-known-text" />
      <div className="ap-form-row">
        <button type="submit" className="btn pill" disabled={!text.trim()} data-testid="atlas-known-save">Add</button>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** Where a calculation's inputs came from, in a few words ("from example figures", "from your figures"). */
const ORIGIN_PHRASE: Readonly<Record<string, string>> = { user: "your figures", example: "example figures", ai: "figures the AI draft chose", unrecorded: "figures of unrecorded origin" };
function fromWords(uses: readonly { readonly provenance: ValueProvenance }[]): string {
  const phrases = [...new Set(uses.flatMap((u) => (ORIGIN_PHRASE[u.provenance.origin] ? [ORIGIN_PHRASE[u.provenance.origin]!] : [])))];
  return phrases.join(" and ");
}

/** The parent's value beside a change: "was 1" (a unit written after the number is not repeated), "was £900". */
function wasValue(v: AssumptionValue, unit: string): string {
  const full = showAssumption(v, unit);
  return typeof v === "number" && unit && full.endsWith(` ${unit}`) ? full.slice(0, -unit.length - 1) : full;
}

/** One line for the calculated outcomes on the card: where their inputs came from and whether the formulas were checked. */
function sourceLine(r: Reality, b: Branch, formulas: readonly { readonly key: string; readonly reviewed: boolean }[]): string {
  const from = fromWords(formulas.flatMap((f) => formulaUses(r, b, f.key)));
  const suggested = formulas.filter((f) => !f.reviewed).length;
  const how = suggested === 0 ? "" : suggested === formulas.length ? (formulas.length === 1 ? " with a suggested formula" : " with suggested formulas") : " (some formulas are suggestions)";
  return `Calculated${from ? ` from ${from}` : ""}${how} (see Details).`;
}

/** What the picture shows differently from the path this one came from (or, for a start, what it shows at all). */
function SceneNote({ scene, parent }: { scene: SceneView; parent: Branch | undefined }) {
  if (parent && !scene.changes.length) {
    return <p className="ap-scene ap-scene-same" data-testid="atlas-scene">The picture looks the same as “{parent.name}”: nothing this path records changes what is drawn.</p>;
  }
  const rows = parent
    ? scene.changes.map((c) => <li key={c.key} data-testid={`atlas-scene-${c.key}`}>{c.now} <span className="ap-was">(was {c.before})</span></li>)
    : scene.items.map((t) => <li key={t}>{t}</li>);
  if (!rows.length) return null;
  return (
    <div className="ap-scene" data-testid="atlas-scene" title="Illustrative: drawn from this path's own figures, not a prediction.">
      <p className="ap-scene-title">In the picture <span className="ap-muted">· illustrative</span></p>
      <ul>{rows}</ul>
    </div>
  );
}

/** One validated simulation in one line: run it, wait for it, or its average with the likely range. */
function CompactSim({ store, state, r, b, simKeyName }: { store: RealityStore; state: RealityState; r: Reality; b: Branch; simKeyName: string }) {
  const s = r.simulations.find((x) => x.key === simKeyName)!;
  const input = simulationInput(r, b, s.key);
  const entry = state.sims[simKey(b, s.key)];
  const unit = getModel(s.modelId, s.modelVersion).metrics[s.metric]?.unit ?? "";
  const run = () => void store.runSimulation(b.id, s.key);
  const last = state.lastRun[`${b.id}|${s.key}`];
  let value: ReactNode = null;
  let note: ReactNode;
  if (!input.ok) {
    note = <>Can't run yet: {[...input.missing.map((m) => `needs ${m}`), ...input.problems].join("; ")}.</>;
  } else if (entry?.status === "done") {
    const m = entry.scenario.result!.summary[s.metric]!;
    value = showValue(m.mean, unit);
    note = <>Likely {showValue(m.ciLow, unit)} to {showValue(m.ciHigh, unit)} (95% interval, {s.replications} repeats). A model estimate, not a prediction.</>;
  } else if (entry?.status === "running") {
    note = <span role="status">Simulating {s.replications} repeats with this path's figures…</span>;
  } else if (entry?.status === "error") {
    value = <button type="button" className="btn pill ap-run" onClick={run} data-testid={`atlas-outcome-run-${s.key}`}>Try again</button>;
    note = <span role="alert">The simulation failed: {entry.message}</span>;
  } else {
    value = <button type="button" className="btn pill ap-run" onClick={run} data-testid={`atlas-outcome-run-${s.key}`}>Run the simulation</button>;
    note = last && last !== b.fingerprint ? "This path changed since its last run, so that result is not shown." : "A validated model. No result is shown until it runs.";
  }
  return (
    <li className="ap-o" data-testid={`atlas-outcome-${s.key}`}>
      <span className="ap-o-label">{s.label}</span>
      {value !== null && <span className="ap-o-value">{value}</span>}
      <span className="ap-o-note"><span className="badge sim">Simulated</span> {note}</span>
    </li>
  );
}

const OUTCOMES = 3;

/**
 * Up to three outcomes for the compact card, each backed by a calculation from this path's figures or a validated
 * simulation: calculations that differ from the parent first (with the parent's value: a direct calculation), then the
 * simulations, then the other calculations. Everything else waits in Details.
 */
function CompactOutcomes({ store, state, r, b, story, parent, onDetails }: {
  store: RealityStore; state: RealityState; r: Reality; b: Branch; story: BranchStory; parent: Branch | undefined; onDetails: () => void;
}) {
  const was = new Map<string, CalculatedResult>();
  if (parent) for (const c of describeChange({ r, b: parent }, { r, b }).calculated) was.set(c.formula.key, c.from);
  const sims = r.simulations.slice(0, OUTCOMES);
  const calc = [...story.calculated].sort((x, y) => Number(was.has(y.formula.key)) - Number(was.has(x.formula.key)));
  const shownCalc = calc.slice(0, Math.max(OUTCOMES - sims.length, Math.min(calc.length, 1)));
  const shownSims = sims.slice(0, OUTCOMES - shownCalc.length);
  const hidden = story.calculated.length - shownCalc.length + story.blocked.length + story.notApplicable.length + story.failed.length + r.simulations.length - shownSims.length;
  if (!shownCalc.length && !shownSims.length) {
    if (!r.formulas.length) return null;
    return (
      <div className="ap-outcomes-wrap" data-testid="atlas-outcomes">
        <p className="ap-muted">Nothing can be calculated on this path yet: its figures need numbers only you can give.</p>
      </div>
    );
  }
  return (
    <div className="ap-outcomes-wrap">
      <ul className="ap-outcomes" data-testid="atlas-outcomes">
        {shownCalc.map(({ formula: f, value }) => {
          const u = formulaUnit(r, f.key);
          const before = was.get(f.key);
          return (
            <li key={f.key} className="ap-o" data-testid={`atlas-outcome-${f.key}`}>
              <span className="ap-o-label">{f.label}</span>
              <span className="ap-o-value">{showOutcome(u, { status: "ok", value })}</span>
              <span className="ap-o-note">
                <span className="badge calc">Calculated</span>{before && parent ? <> was {showOutcome(u, before, true)} on “{parent.name}”</> : null}
              </span>
            </li>
          );
        })}
        {shownSims.map((x) => <CompactSim key={x.key} store={store} state={state} r={r} b={b} simKeyName={x.key} />)}
      </ul>
      {shownCalc.length > 0 && <p className="ap-caption" data-testid="atlas-outcomes-source">{sourceLine(r, b, shownCalc.map((c) => c.formula))}</p>}
      {hidden > 0 && <button type="button" className="link-btn ap-more" onClick={onDetails} data-testid="atlas-outcomes-more">{hidden} more {hidden === 1 ? "figure" : "figures"} in Details</button>}
    </div>
  );
}

export function AtlasPanel({ store, state, r, b, sheet, setSheet, onClassic, headingId, scene }: {
  store: RealityStore; state: RealityState; r: Reality; b: Branch; sheet: Sheet; setSheet: (s: Sheet) => void; onClassic: () => void; headingId: string; scene?: SceneView;
}) {
  const story = branchStory(r, b);
  const parent = b.parentId ? r.branches.find((x) => x.id === b.parentId) : undefined;
  const whatIfActive = state.whatIf?.realityId === r.id && state.whatIf.branchId === b.id;
  const mark = state.change && state.change.realityId === r.id && state.change.branchId === b.id ? state.change : null;
  const before = mark?.before.branches.find((x) => x.id === b.id);
  const summary = mark && before ? describeChange({ r: mark.before, b: before }, { r, b }) : null;
  const told = new Map(story.matches.map((m) => [m.variable.key, m.facts]));
  const staleById = new Map(story.stale.map((s) => [s.possibility.id, s]));
  const carriedById = new Map(story.carried.map((c) => [c.possibility.id, c]));
  const knownCount = story.known.context.length + story.known.facts.length + story.known.values.length + story.known.notApplicable.length;
  const possibleCount = story.upsides.length + story.challenges.length + story.unsorted.length;
  const openItems = r.questions.length + (r.origin?.evidence.length ?? 0) + story.toVerify.length + story.toFindOut.length;
  const body = useRef<HTMLDivElement>(null);
  // Compact by default: the first changes, and the figures without their sources until asked for.
  const [allChanges, setAllChanges] = useState(false);
  const [allFigures, setAllFigures] = useState(false);
  const [sources, setSources] = useState(false);
  /** The path's fingerprint when the user chose "Not now" for another look (offered again after a new change). */
  const [notNow, setNotNow] = useState<string | null>(null);
  /** Everything about this future in the card (kept while moving between futures), or the compact story (the default). */
  const [details, setDetails] = useState(false);
  useEffect(() => {
    setAllChanges(false);
    setAllFigures(false);
  }, [b.id]);
  const chips = [
    ...story.changes.map((c) => ({ key: c.key, text: showSetting(c.label, c.to, c.unit), was: parent ? wasValue(c.from, c.unit) : null, hypo: false, decision: true })),
    ...story.told.map((f, i) => ({ key: `t${i}`, text: toldLine(f), was: null, hypo: isIntervention(f), decision: false })),
  ];
  const CHIPS = 2;
  const FIGURES = 3;
  const figureCount = story.calculated.length + story.blocked.length + story.notApplicable.length + story.failed.length;
  let figureIndex = 0;
  const fold = () => (!allFigures && figureIndex++ >= FIGURES ? "folded" : "");

  // Another AI look at this path: the store's state for it, and whether to offer it (only when suggestions may no longer hold).
  const rv = state.revisit.status !== "idle" && state.revisit.realityId === r.id && state.revisit.branchId === b.id ? state.revisit : null;
  const lookBusy = state.revisit.status === "loading" && !rv;

  const question = sheet && typeof sheet === "object" && "question" in sheet ? story.unknowns.find((u) => u.variable.key === sheet.question) : undefined;
  const whatIfP = sheet && typeof sheet === "object" && "whatIf" in sheet ? b.possibilities.find((p) => p.id === sheet.whatIf) : undefined;
  const whatIfKey = sheet && typeof sheet === "object" && "whatIfKey" in sheet && r.variables.some((v) => v.key === sheet.whatIfKey) ? sheet.whatIfKey : undefined;
  const close = () => setSheet(null);
  let sheetView: ReactNode = null;
  if (sheet === "path") sheetView = <PathSheet store={store} r={r} b={b} onClose={close} />;
  else if (sheet === "compare") sheetView = <ComparePicker store={store} r={r} b={b} onClose={close} />;
  else if (whatIfP) sheetView = <WhatIfSheet store={store} r={r} b={b} p={whatIfP} onClose={close} />;
  else if (whatIfKey) sheetView = <WhatIfSheet store={store} r={r} b={b} focus={whatIfKey} onClose={close} />;
  else if (question) {
    const v = question.variable;
    sheetView = <QuestionCard key={v.key} store={store} b={b} u={question} remaining={story.unknowns.length} told={told.get(v.key) ?? []} hint={v.kind === "number" ? currencyHint(r.question, v.label, v.unit) : null} onSkip={close} />;
  } else if (rv) sheetView = <RevisitCard store={store} rv={rv} b={b} />;
  const sheetKey = sheetView ? (rv && sheet === null ? `rv:${rv.status}` : sheetKeyOf(sheet)) : "";
  // Offered only when no sheet is on screen (a question the user has just answered draws none).
  const offerLook = story.stale.length > 0 && notNow !== b.fingerprint && sheetView === null && !rv;

  // Opening or closing a sheet starts the card at its top. Keyboard focus follows: into the sheet's heading when one
  // opens (another look focuses its own heading), back to this future's name when it closes.
  const hadSheet = useRef(false);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    const panel = body.current;
    if (sheetKey && !sheetKey.startsWith("rv:") && !sheetKey.startsWith("w:") && !sheetKey.startsWith("k:")) {
      const h = panel?.querySelector<HTMLElement>(".ap-sheet h3");
      if (h) {
        h.tabIndex = -1;
        h.focus({ preventScroll: true });
      }
    } else if (!sheetKey && hadSheet.current) panel?.querySelector<HTMLElement>("[data-stage-focus]")?.focus({ preventScroll: true });
    hadSheet.current = sheetKey !== "";
  }, [sheetKey, b.id]);

  return (
    <aside className={`atlas-panel ${sheetView ? "has-sheet" : ""} ${details ? "with-details" : "compact"}`} aria-labelledby={headingId} data-testid="atlas-panel">
      <div className="ap-scroll" ref={body}>
        <header className="ap-head">
          <p className="ap-kicker">
            {story.isStart ? "Where you start" : parent ? <>A path from <button type="button" className="link-btn" onClick={() => store.select(parent.id)} data-testid="atlas-parent">{parent.name}</button></> : "A possible future"}
          </p>
          <h2 id={headingId} className="ap-title" tabIndex={-1} data-stage-focus data-testid="atlas-title">{b.name}</h2>
          {b.description && !sheetView && <p className="ap-desc" data-testid="atlas-summary">{b.description}</p>}
          {!sheetView && (chips.length > 0 ? (
            <div className="ap-changes">
              <ul className="ap-chips" aria-label={parent ? `Different from “${parent.name}”` : "This path"} data-testid="atlas-changes">
                {chips.map((c, i) => (
                  <li key={c.key} className={`${c.hypo ? "hypo" : ""} ${!allChanges && i >= CHIPS ? "folded" : ""}`}>
                    {c.decision ? (
                      <button type="button" className="ap-chip" onClick={() => setSheet({ whatIfKey: c.key })} title="Try a different value on a new path" data-testid={`atlas-change-${c.key}`}>
                        {c.text}{c.was !== null && <span className="ap-was"> (was {c.was})</span>}<span className="decision-try" aria-hidden="true">↺</span><span className="sr-only"> — try a different value on a new path</span>
                      </button>
                    ) : c.text}
                  </li>
                ))}
              </ul>
              {chips.length > CHIPS && (
                <button type="button" className="link-btn ap-more" aria-expanded={allChanges} onClick={() => setAllChanges((x) => !x)} data-testid="atlas-changes-more">
                  {allChanges ? "Show fewer" : `${chips.length - CHIPS} more ${chips.length - CHIPS === 1 ? "difference" : "differences"}`}
                </button>
              )}
            </div>
          ) : (
            <p className="ap-muted" data-testid="atlas-changes">{story.isStart ? "Nothing has changed yet: every path starts here." : "Nothing is different from where it came from yet."}</p>
          ))}
          {!sheetView && scene && <SceneNote scene={scene} parent={parent} />}
        </header>

        {sheetView ? (
          <div className="ap-sheet" data-testid="atlas-sheet">
            {sheetView}
            {/* Another look has its own choices once it answers; while it is on its way, going back stops waiting for it. */}
            {!rv || sheet !== null
              ? <button type="button" className="link-btn ap-back" onClick={close} data-testid="atlas-sheet-back">← Back to “{b.name}”</button>
              : rv.status === "loading" ? <button type="button" className="link-btn ap-back" onClick={store.dismissRevisit} data-testid="atlas-revisit-cancel">Stop waiting and go back</button> : null}
          </div>
        ) : (
          <>
            <div className="change-live" role="status" aria-live="polite">
              {whatIfActive ? (
                // The full comparison with the parent (changed, calculated, may no longer hold) on request: the card's
                // header already names the change. Open with the rest of Details.
                <details className="ap-whatif" open={details} data-testid="atlas-whatif">
                  <summary>What this change does{parent && <span className="ap-muted"> · compared with “{parent.name}”</span>}</summary>
                  <WhatIfNote r={r} b={b} onCompare={(parentId) => store.openCompare(parentId, b.id)} />
                </details>
              ) : summary && !summary.empty ? <ChangeNote r={r} s={summary} /> : null}
            </div>

            {!details ? (
              <div className="ap-compact" data-testid="atlas-compact">
                <CompactOutcomes store={store} state={state} r={r} b={b} story={story} parent={parent} onDetails={() => setDetails(true)} />
                {story.unknowns.length > 0 && (
                  <p className="ap-next" data-testid="atlas-next-unknown">
                    <span className="ap-muted">{story.unknowns.length === 1 ? "One thing only you can tell us:" : `${story.unknowns.length} things only you can tell us. Next:`}</span>{" "}
                    <button type="button" className="ap-ask" onClick={() => setSheet({ question: story.unknowns[0]!.variable.key })} data-testid="atlas-next-question">{story.unknowns[0]!.variable.label}<span className="sr-only">: answer this</span></button>
                  </p>
                )}
                {r.formulas.length === 0 && r.simulations.length === 0 && possibleCount > 0 && (
                  <p className="ap-next" data-testid="atlas-possible-summary">
                    <span className="badge possible">Possible</span>{" "}
                    <span className="ap-muted">{possibleCount === 1 ? "One possibility" : `${possibleCount} possibilities`} to think with, not predictions.</span>{" "}
                    <button type="button" className="link-btn" onClick={() => setDetails(true)} data-testid="atlas-possible-open">See {possibleCount === 1 ? "it" : "them"}</button>
                  </p>
                )}
                {story.stale.length > 0 && (
                  <p className="ap-next ap-muted" data-testid="atlas-stale-note">{staleTitle(story.stale.length)}. <button type="button" className="link-btn" onClick={() => setDetails(true)}>See which</button></p>
                )}
              </div>
            ) : (
            <div className="ap-details" id="atlas-details-body" data-testid="atlas-details-body">
            {offerLook && (
              <div className="ap-look" data-testid="atlas-fresh-look">
                <p className="ap-look-title">{staleTitle(story.stale.length)}</p>
                <p className="ap-muted">{staleWhy(story.stale)}</p>
                <div className="ap-form-row">
                  <button type="button" className="btn pill accent" disabled={lookBusy} onClick={() => void store.requestRevisit(b.id)} data-testid="atlas-ask-fresh-look">Ask AI to take another look</button>
                  <button type="button" className="link-btn" onClick={() => setNotNow(b.fingerprint)} data-testid="atlas-fresh-look-not-now">Not now</button>
                </div>
                <p className="ap-caption">{lookBusy ? LOOK_BUSY : LOOK_SCOPE}</p>
              </div>
            )}

            {r.formulas.length > 0 && (
              <Section title="from this path's figures" testid="atlas-calculated" badge={{ kind: "calc", text: "Calculated" }} count={story.calculated.length}>
                <ul className={`ap-calc ${sources ? "with-sources" : ""}`} id="atlas-calc-list">
                  {story.calculated.map(({ formula: f, value }) => {
                    const uses = formulaUses(r, b, f.key);
                    return (
                      <li key={f.key} className={fold()} data-testid={`atlas-calc-${f.key}`}>
                        <span className="ap-calc-label">{f.label}{!f.reviewed && <span className="ap-tag" title="This formula came with a draft or example. Check it in All details.">suggested formula</span>}</span>
                        <span className="ap-calc-value">{showOutcome(formulaUnit(r, f.key), { status: "ok", value })}</span>
                        {uses.length > 0 && <span className="ap-uses">Uses {uses.map((u) => `${u.variable.label} (${originWords(u.provenance)})`).join(", ")}</span>}
                        <span className="ap-uses ap-formula"><code>{f.expression}</code>{f.condition && <> only when <code>{f.condition}</code></>} · {unitNote(formulaUnit(r, f.key))}</span>
                      </li>
                    );
                  })}
                  {story.blocked.map(({ formula: f, missing }) => (
                    <li key={f.key} className={`wait ${fold()}`} data-testid={`atlas-calc-${f.key}`}><span className="ap-calc-label">{f.label}</span><span className="ap-muted">needs {missing.join(", ")}</span></li>
                  ))}
                  {story.notApplicable.map(({ formula: f, reason }) => (
                    <li key={f.key} className={`wait na ${fold()}`} data-testid={`atlas-calc-${f.key}`}><span className="ap-calc-label">{f.label}</span><span className="ap-muted">{notApplicableHere(r, b, f.key) ? `doesn't apply here: ${reason}` : "doesn't apply with these numbers"}</span></li>
                  ))}
                  {story.failed.map(({ formula: f, message }) => (
                    <li key={f.key} className={`wait ${fold()}`} data-testid={`atlas-calc-${f.key}`}><span className="ap-calc-label">{f.label}</span><span className="ap-muted">can't be worked out: {message}</span></li>
                  ))}
                </ul>
                <div className="ap-links">
                  {figureCount > FIGURES && (
                    <button type="button" className="link-btn ap-more" aria-expanded={allFigures} aria-controls="atlas-calc-list" onClick={() => setAllFigures((x) => !x)} data-testid="atlas-calc-more">
                      {allFigures ? "Show fewer" : `${figureCount - FIGURES} more`}
                    </button>
                  )}
                  {story.calculated.length > 0 && (
                    <button type="button" className="link-btn ap-more" aria-expanded={sources} aria-controls="atlas-calc-list" onClick={() => setSources((x) => !x)} data-testid="atlas-calc-sources">
                      {sources ? "Hide where they come from" : "Where these come from"}
                    </button>
                  )}
                </div>
              </Section>
            )}

            {r.simulations.length > 0 && (
              <Section title="by a validated model" testid="atlas-simulated" badge={{ kind: "sim", text: "Simulated" }}>
                <ul className="outcomes-list ap-sims">
                  {r.simulations.map((s) => <SimulatedOutcome key={s.key} store={store} state={state} r={r} b={b} simKeyName={s.key} compact />)}
                </ul>
              </Section>
            )}

            {(story.unknowns.length > 0 || openItems > 0) && (
              <section className="ap-unknowns" aria-labelledby="atlas-unknown-title" data-testid="atlas-unknown">
                <h3 id="atlas-unknown-title" className="ap-unknowns-title">Still unknown {story.unknowns.length > 0 && <span className="ap-count">{story.unknowns.length}</span>} <span className="ap-muted">only you provide numbers</span></h3>
                {story.unknowns.length > 0 && (
                  <ul className="ap-unknown">
                    {story.unknowns.map((u) => (
                      <li key={u.variable.key}>
                        <button type="button" className="ap-ask" onClick={() => setSheet({ question: u.variable.key })} data-testid={`atlas-ask-${u.variable.key}`}>
                          {u.variable.label}<span className="sr-only">: answer this</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {openItems > 0 && (
                  <details className="ap-verify" data-testid="atlas-to-verify">
                    <summary>{openItems} {openItems === 1 ? "question or thing to find out" : "questions and things to find out"}</summary>
                    <ul className="ap-list">
                      {story.toVerify.map((q) => <li key={`v-${q}`}>{q}</li>)}
                      {story.toFindOut.map((q) => <li key={`f-${q}`}>Find out: {q}</li>)}
                      {r.questions.map((q, i) => <li key={`q${i}`}>{q}</li>)}
                      {r.origin?.evidence.map((q, i) => <li key={`e${i}`}>Find out: {q}</li>)}
                    </ul>
                    <p className="ap-caption">Numbers cannot answer these. They are things to check before relying on this path.</p>
                  </details>
                )}
              </section>
            )}

            <Section title="what you told us" testid="atlas-known" badge={{ kind: "known", text: "Known" }} count={knownCount} open={false}>
              {knownCount === 0 ? (
                <p className="ap-muted">Nothing yet. From you, not from the AI.</p>
              ) : (
                <ul className="known-list ap-known">
                  {story.known.context.map((f, i) => (
                    <FactItem key={f.id} fact={f} scope="every path" max={MAX_CONTEXT_TEXT} testid={`atlas-known-context-${i}`} onSave={(t) => store.editContextFact(b.id, f.id, t)} />
                  ))}
                  {story.known.facts.map((f, i) => (
                    <FactItem key={f.id} fact={f} scope={f.from ? `from “${f.from.name}”` : "this path"} max={MAX_FACT_TEXT} testid={`atlas-known-fact-${i}`} onSave={(t) => store.editFact(b.id, f.id, t)} onRemove={() => store.removeFact(b.id, f.id)} />
                  ))}
                  {story.known.values.map(({ variable: v, value, from, stated }) => (
                    <li key={v.key} className="known-item" data-testid={`atlas-known-value-${v.key}`}>
                      <span className="known-text">{showSetting(v.label, value, v.unit)}</span>
                      <span className="scope">{from ? `from “${from.name}”` : "this path"}</span>
                      {stated && <span className="known-quote small muted">From your question: “{stated.text}”. A what-if figure you wrote, not checked against anything.</span>}
                    </li>
                  ))}
                  {story.known.notApplicable.map((v) => (
                    <li key={`na-${v.key}`} className="known-item na" data-testid={`atlas-known-na-${v.key}`}>
                      <span className="known-text">{v.label}: doesn't apply to this path</span>
                      <span className="known-actions"><button type="button" className="link-btn" onClick={() => void store.markApplicable(b.id, v.key)}>It applies</button></span>
                    </li>
                  ))}
                </ul>
              )}
              <AddKnown store={store} b={b} />
            </Section>

            <p className="ap-illustrative">The scenery is illustrative: nothing in the picture is a fact about this future.</p>

            <Section title="what might happen" testid="atlas-possible" badge={{ kind: "possible", text: "Possible" }} count={possibleCount} open={false}>
              <p className="ap-muted">Possibilities to think with, not predictions.</p>
              <PossibleList r={r} b={b} items={story.upsides} title="Could go well" glyph="↗" stale={staleById} carried={carriedById} onWhatIf={(id) => setSheet({ whatIf: id })} />
              <PossibleList r={r} b={b} items={story.challenges} title="Could be hard" glyph="↘" stale={staleById} carried={carriedById} onWhatIf={(id) => setSheet({ whatIf: id })} />
              <PossibleList r={r} b={b} items={story.unsorted} title="Could go either way" glyph="↔" stale={staleById} carried={carriedById} onWhatIf={(id) => setSheet({ whatIf: id })} />
              {possibleCount === 0 && <p className="ap-muted">Nothing noted yet.</p>}
              {story.stale.length > 0 && !offerLook && <p className="ap-muted" data-testid="atlas-stale">{staleTitle(story.stale.length)}.</p>}
              {story.setAside.length > 0 && (
                <details className="ap-verify" data-testid="atlas-set-aside">
                  <summary>Set aside after another look ({story.setAside.length})</summary>
                  <ul className="ap-list">
                    {story.setAside.map((p) => (
                      <li key={p.id}>
                        <span className="set-aside-text">{p.text}</span> <span className="ap-muted">Why: {p.setAside}</span>{" "}
                        <button type="button" className="link-btn" onClick={() => void store.restoreSuggestion(b.id, p.id)} data-testid={`atlas-restore-${p.id}`}>Put back</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <AddThought store={store} b={b} />
            </Section>
            <p className="ap-classic">
              <button type="button" className="link-btn" onClick={onClassic} data-testid="atlas-classic">All details</button>{" "}
              <span className="ap-muted">every editor for this map, on one page</span>
            </p>
            </div>
            )}
          </>
        )}
      </div>

      {!sheetView && (
        <div className="ap-actions">
          <button type="button" className="btn btn-primary ap-branch" onClick={() => setSheet("path")} data-testid="atlas-branch">Explore another path from here</button>
          <div className="ap-actions-row">
            {r.branches.length > 1 && <button type="button" className="btn ap-compare" onClick={() => setSheet("compare")} data-testid="atlas-compare">Compare</button>}
            <button type="button" className="btn ap-details-toggle" aria-expanded={details} aria-controls={details ? "atlas-details-body" : undefined} onClick={() => setDetails((x) => !x)} data-testid="atlas-details">{details ? "Fewer details" : "Details"}</button>
          </div>
          <SavedNote state={state} r={r} />
        </div>
      )}
    </aside>
  );
}
