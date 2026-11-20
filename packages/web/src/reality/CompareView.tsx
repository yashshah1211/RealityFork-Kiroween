import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  changesFromParent,
  compareStory,
  formulaUnit,
  getModel,
  isIntervention,
  simulationInput,
  staleSuggestions,
  type Branch,
  type CarriedOver,
  type AssumptionValue,
  type CalculationNote,
  type Possibility,
  type Reality,
  type SettleItem,
  type SimulationLink,
  type TradeItem,
  type TradeOff,
} from "@realityfork/core";
import { simCompareKey, simKey, type RealityState, type RealityStore } from "./store";
import { ComparePanel, DifferenceStrip, IntervalStrip } from "./panels";
import { pathHues } from "./RealityMap";
import { changeCaption, parseNumberInput, showAssumption, signed, withUnit } from "./format";
import { showDiff, showValue } from "../format";
import { atlasRequested, webglAvailable } from "../atlas/flag";

const Pair = lazy(() => import("../atlas/AtlasPair"));

/** The two worlds side by side, when the 3D view is available; nothing otherwise (the headings below carry the names). */
function CompareWorlds({ store, r, a, b }: { store: RealityStore; r: Reality; a: Branch; b: Branch }) {
  const [want] = useState(() => typeof window !== "undefined" && atlasRequested(window.location.search) && webglAvailable());
  const [failed, setFailed] = useState(false);
  if (!want || failed) return null;
  return (
    <div className="cmp-worlds">
      <Suspense fallback={<div className="cmp-scene" aria-hidden="true" />}>
        <Pair r={r} aId={a.id} bId={b.id} onOpen={(id) => store.continueWith(id)} onFailed={() => setFailed(true)} />
      </Suspense>
    </div>
  );
}

const same = (p: Possibility, q: Possibility) => p.text.trim().toLowerCase() === q.text.trim().toLowerCase();

type Side = "a" | "b";
type Notes = { fresh: (p: Possibility) => string | null; note: (p: Possibility, where: "a" | "both" | "b") => string | null };

const GLYPH: Record<TradeItem["reason"], string> = { upside: "↗", challenge: "↘", uncertain: "↔" };
/** The possibility's own tone and the path it was written for: the column says which choice it favours, this says why. */
const reasonText = (item: TradeItem, names: { a: string; b: string }): string => {
  const what = item.reason === "upside" ? "could go well" : item.reason === "challenge" ? "could be hard" : "could go either way";
  // Listed for both paths is not the same as established in both (R18 RF-05): it is said as "listed".
  if (item.from === "both") return `Listed in both · ${what}`;
  return `${what[0]!.toUpperCase()}${what.slice(1)} on “${names[item.from]}”`;
};

function TradeEntry({ item, names, notes }: { item: TradeItem; names: { a: string; b: string }; notes: Notes }) {
  const p = item.possibility;
  const where = notes.fresh(p);
  const carried = where ? null : notes.note(p, item.from);
  // The text is exactly as it was written for its path; only its place in the trade-off is new.
  return (
    <li className={`trade-item ${item.reason}`} data-testid={`trade-${p.id}`}>
      <span className="trade-why"><span className="glyph" aria-hidden="true">{GLYPH[item.reason]}</span>{reasonText(item, names)}</span>
      <span className="trade-text">{p.text}</span>
      {where && <span className="tag fresh" data-testid={`cmp-stale-${p.id}`}>may need a fresh look in {where}</span>}
      {carried && <span className="tag fresh wrap" data-testid={`cmp-carried-${p.id}`}>{carried}</span>}
    </li>
  );
}

/**
 * The trade-off: what could favour each choice, side by side, from the paths' own possibilities. A difficulty of one
 * path is listed for the OTHER choice, which avoids it, and says where it was written. Nothing is scored or counted
 * as a winner; a side with no possibilities of its own says so instead of looking weaker.
 */
function TradeOffView({ t, a, b, hues, notes }: { t: TradeOff; a: { id: string; name: string }; b: { id: string; name: string }; hues: Map<string, number>; notes: Notes }) {
  if (t.forA.length + t.forB.length + t.eitherWay.length === 0) return null;
  const names = { a: a.name, b: b.name };
  const column = (side: Side, items: readonly TradeItem[], own: number) => {
    const x = side === "a" ? a : b;
    return (
      <div className={`trade-col ${side}`} style={{ ["--hue" as string]: hues.get(x.id) }} data-testid={`trade-for-${side}`}>
        <h4><span className="cmp-side" aria-hidden="true">{side.toUpperCase()}</span>What could favour “{x.name}”</h4>
        {items.length > 0 && <ul>{items.map((i) => <TradeEntry key={`${i.from}-${i.possibility.id}`} item={i} names={names} notes={notes} />)}</ul>}
        {/* A path with nothing of its own is said, so a thin draft never passes for a weighed judgement. */}
        {own === 0 ? (
          <p className="small muted" data-testid={`trade-none-own-${side}`}>
            No possibilities were noted for “{x.name}” on its own{items.length > 0 ? ", so what is here comes from the other path" : ""}. Open it to add a thought.
          </p>
        ) : items.length === 0 ? (
          <p className="small muted" data-testid={`trade-empty-${side}`}>Nothing noted yet that favours this choice.</p>
        ) : null}
      </div>
    );
  };
  // The summary is the core's one reading of the same lists (t.kind), so it cannot contradict them. Two empty columns
  // would only look like a verdict, so a summary sentence replaces them when nothing favours a side.
  return (
    <section className="cmp-section trade" aria-labelledby="trade-title" data-testid="cmp-tradeoff">
      <h3 id="trade-title">The trade-off</h3>
      <p className="small muted">Possibilities to think with, not predictions. A difficulty on one path counts for the other choice. Nothing is scored.</p>
      {t.kind === "split" ? (
        <div className="trade-cols">
          {column("a", t.forA, t.ownA)}
          {column("b", t.forB, t.ownB)}
        </div>
      ) : t.kind === "same" ? (
        <p className="small" data-testid="trade-same">Both paths list the same possibilities, so none of them favours one choice. What differs is in the choices above and the figures below.</p>
      ) : (
        <p className="small" data-testid="trade-unsorted">None of these possibilities says it would go well or be hard, so none favours one choice. Some are listed for one path only: they are marked below.</p>
      )}
      {t.eitherWay.length > 0 && (
        <div className="trade-either" data-testid="cmp-either">
          <h4>Could matter either way</h4>
          <ul>{t.eitherWay.map((i) => <TradeEntry key={`${i.from}-${i.possibility.id}`} item={i} names={names} notes={notes} />)}</ul>
        </div>
      )}
    </section>
  );
}

/**
 * What a compared number is made of, said beside it, so a partial sum never reads as the whole picture: the inputs it
 * uses, figures the paths hold that it leaves out, and a side whose every input is 0 (a sign it may not apply there).
 */
function CalcNote({ store, note, ids, nameOf }: { store: RealityStore; note: CalculationNote | undefined; ids: { a: string; b: string }; nameOf: (s: Side) => string }) {
  if (!note) return null;
  const left = note.leftOut.slice(0, 4);
  return (
    <div className="calc-note small" data-testid={`cmp-calc-note-${note.formula.key}`}>
      {note.uses.length > 0 && <p className="muted">Worked out from: {note.uses.map((v) => v.label).join(", ")}. Nothing else is included.</p>}
      {left.length > 0 && (
        <p className="muted" data-testid={`cmp-left-out-${note.formula.key}`}>
          Not part of this calculation: {left.map((x) => `${x.variable.label} (A ${x.a === null ? "not given" : showAssumption(x.a, x.variable.unit, "exact")}, B ${x.b === null ? "not given" : showAssumption(x.b, x.variable.unit, "exact")})`).join("; ")}.
        </p>
      )}
      {note.allZero && (
        <p className="warn" data-testid={`cmp-all-zero-${note.formula.key}`}>
          Every figure behind this is 0 on “{nameOf(note.allZero)}”, so this shows only that, not what that path is like, and the two are not compared.{" "}
          <button type="button" className="link-btn" onClick={() => void store.markNotApplicable(ids[note.allZero!], note.uses.map((v) => v.key))} data-testid={`cmp-mark-na-${note.formula.key}`}>
            These don't apply to “{nameOf(note.allZero)}”
          </button>
        </p>
      )}
    </div>
  );
}

/** One missing figure, entered for one path right here. The same parser and the same store operation as the question card. */
function SettleInput({ store, branchId, branchName, side, s }: { store: RealityStore; branchId: string; branchName: string; side: Side; s: SettleItem }) {
  const v = s.variable;
  const [text, setText] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  const id = `settle-${side}-${v.key}`;
  const save = (value: AssumptionValue) => void store.answer(branchId, v.key, value);
  if (v.kind !== "number") {
    return (
      <div className={`settle-input ${side}`} role="group" aria-label={`${v.label} in “${branchName}”`}>
        <span className="cmp-side" aria-hidden="true">{side.toUpperCase()}</span>
        {(v.kind === "boolean" ? [true, false] : v.options).map((o) => (
          <button key={String(o)} type="button" className="btn pill" onClick={() => save(o)} data-testid={`${id}-${String(o)}`}>{showAssumption(o)}</button>
        ))}
      </div>
    );
  }
  const submit = () => {
    const n = parseNumberInput(text, v.unit);
    if (!n.ok) return setBad(n.message);
    if (n.value === null) return setBad("Enter a number, like 1200 or 2.5");
    save(n.value);
  };
  return (
    <form className={`settle-input ${side}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="cmp-side" aria-hidden="true">{side.toUpperCase()}</span>
      <label className="sr-only" htmlFor={id}>{v.label} in “{branchName}”</label>
      <input id={id} inputMode="decimal" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setBad(null); }} aria-invalid={bad !== null} aria-describedby={bad ? `${id}-bad` : undefined} placeholder="Your estimate" data-testid={`${id}-input`} />
      {v.unit && <span className="unit small muted">{v.unit}</span>}
      <button type="submit" className="btn" data-testid={`${id}-save`}>Save</button>
      {/* Not 0: this path has no such thing, so what it is needed for does not apply here and is not compared. */}
      <button type="button" className="link-btn small" onClick={() => void store.markNotApplicable(branchId, [v.key])} title={`Not the same as 0: nothing is worked out from it on “${branchName}”`} data-testid={`${id}-na`}>Doesn't apply</button>
      {bad && <span id={`${id}-bad`} className="small warn" role="alert">{bad}</span>}
    </form>
  );
}

/**
 * What would settle the comparison: the figures a calculated outcome needs, per path, entered here. Nothing is filled
 * in for the user; each answer is theirs, saved on that path only, and the outcome appears above once both sides have it.
 */
function SettleIt({ store, items, a, b }: { store: RealityStore; items: readonly SettleItem[]; a: { id: string; name: string }; b: { id: string; name: string } }) {
  if (items.length === 0) return null;
  return (
    <div className="settle" data-testid="cmp-settle">
      <p className="small muted">Add them here. Only you provide numbers; each is saved on its own path as your estimate, and the result appears above once both paths have it.</p>
      <ul className="settle-list">
        {items.map((s) => (
          <li key={s.variable.key} data-testid={`settle-${s.variable.key}`}>
            <span className="settle-label">
              <strong>{s.variable.label}</strong>
              <span className="small muted"> for {s.outcomes.join(", ")}</span>
            </span>
            <span className="settle-sides">
              {s.missingA && <SettleInput store={store} branchId={a.id} branchName={a.name} side="a" s={s} />}
              {s.missingB && <SettleInput store={store} branchId={b.id} branchName={b.name} side="b" s={s} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One validated simulation on both paths: each side's result with its interval, or what it still needs; and, when both
 * are done, the difference from the engine's paired comparison. Nothing is shown as zero or filled in.
 */
function SimulatedRow({ store, state, r, a, b, s, hues }: { store: RealityStore; state: RealityState; r: Reality; a: Branch; b: Branch; s: SimulationLink; hues: Map<string, number> }) {
  const unit = getModel(s.modelId, s.modelVersion).metrics[s.metric]?.unit ?? "";
  const done = (x: Branch) => {
    const e = state.sims[simKey(x, s.key)];
    return e?.status === "done" ? e : null;
  };
  const da = done(a);
  const db = done(b);
  useEffect(() => {
    if (da && db) void store.compareSimulations(a.id, b.id, s.key);
  }, [da, db, a.id, b.id, s.key, store]);
  const side = (x: Branch, which: "a" | "b") => {
    const input = simulationInput(r, x, s.key);
    const e = state.sims[simKey(x, s.key)];
    let body: ReactNode;
    if (!input.ok) body = <span className="warn">Can't be simulated yet: {[...input.missing.map((m) => `needs ${m}`), ...input.problems].join("; ")}</span>;
    else if (e?.status === "done") {
      const m = e.scenario.result!.summary[s.metric]!;
      body = <><strong>{showValue(m.mean, unit)}</strong> <span className="small muted">(95% interval {showValue(m.ciLow, unit)} to {showValue(m.ciHigh, unit)})</span></>;
    } else if (e?.status === "running") body = <span className="muted">Simulating…</span>;
    else if (e?.status === "error") body = <span className="warn">The simulation failed: {e.message}</span>;
    else {
      const last = state.lastRun[`${x.id}|${s.key}`];
      body = (
        <>
          <span className="muted">{last && last !== x.fingerprint ? "Not simulated since this path changed" : "Not simulated yet"}</span>{" "}
          <button type="button" className="btn" onClick={() => void store.runSimulation(x.id, s.key)} data-testid={`cmp-run-${which}-${s.key}`}>Run the simulation</button>
        </>
      );
    }
    return (
      <span className={`cmp-sim-side ${which}`} data-testid={`cmp-sim-${which}-${s.key}`}>
        <span className="cmp-side" aria-hidden="true">{which.toUpperCase()}</span>
        <span className="sr-only">{which === "a" ? a.name : b.name}: </span>
        <span>{body}</span>
      </span>
    );
  };
  const c = da && db ? state.simCompare[simCompareKey(a, b, s.key)] : undefined;
  let diff: ReactNode = null;
  if (c?.status === "running") diff = <span className="cmp-diff muted" data-testid={`cmp-sim-diff-${s.key}`}>Working out the difference…</span>;
  else if (c?.status === "error") diff = <span className="cmp-diff warn" data-testid={`cmp-sim-diff-${s.key}`}>The difference could not be worked out: {c.message}</span>;
  else if (c?.status === "done") {
    const d = c.outcome.difference;
    const noise = c.outcome.conclusion === "inconclusive";
    diff = (
      <span className="cmp-diff" data-testid={`cmp-sim-diff-${s.key}`}>
        B − A: <strong>{showDiff(c.outcome.directDifference, unit)}</strong>{" "}
        {Number.isFinite(d.ciLow) && Number.isFinite(d.ciHigh) && <span className="small muted">({Math.round(c.confidence * 100)}% interval {showDiff(d.ciLow, unit)} to {showDiff(d.ciHigh, unit)})</span>}
        {noise && <span className="small"> · not distinguishable from noise</span>}
        {c.outcome.conclusion === "identical-in-every-replication" && <span className="small"> · identical in every simulated repeat</span>}
        {c.outcome.conclusion === "not-computable" && <span className="small warn"> · cannot be computed from these runs</span>}
        <span className="small muted"> · {c.paired ? "compared repeat by repeat, with the same random inputs on both paths (same seed)" : "independent runs (different seeds or repeat counts)"}</span>
        <DifferenceStrip diff={c.outcome.directDifference} low={d.ciLow} high={d.ciHigh} unit={unit} />
      </span>
    );
  }
  // Both results on one axis, once both have run: the averages and their intervals, as the engine reported them.
  const summaryOf = (e: typeof da) => (e ? e.scenario.result!.summary[s.metric] : undefined);
  const ma = summaryOf(da);
  const mb = summaryOf(db);
  return (
    <li data-testid={`cmp-sim-${s.key}`}>
      <span className="cmp-worked-label">{s.label}</span>
      {side(a, "a")}
      {side(b, "b")}
      {ma && mb && (
        <span className="cmp-sim-chart">
          <IntervalStrip
            rows={[{ key: "a", label: `A · ${a.name}`, hue: hues.get(a.id), mean: ma.mean, low: ma.ciLow, high: ma.ciHigh }, { key: "b", label: `B · ${b.name}`, hue: hues.get(b.id), mean: mb.mean, low: mb.ciLow, high: mb.ciHigh }]}
            unit={unit}
            caption={`${s.label} on both paths: averages and 95% intervals on one axis`}
          />
        </span>
      )}
      {diff}
    </li>
  );
}

/** Stage 5: two futures side by side, leading with what actually differs. */
export function CompareView({ store }: { store: RealityStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const r = store.active()! as Reality;
  const [aId, bId] = state.compare;
  const a = r.branches.find((x) => x.id === aId);
  const b = r.branches.find((x) => x.id === bId);
  if (!a || !b || a.id === b.id) {
    return (
      <main className="stage compare" data-testid="compare-view">
        <p>Choose two different futures to compare.</p>
        <button className="btn btn-primary" onClick={() => store.continueWith(a?.id ?? r.branches[0]!.id)}>Back to exploring</button>
      </main>
    );
  }
  const c = compareStory(r, a.id, b.id);
  const hues = pathHues(r);
  // Copied suggestions keep their id on both paths; mark where one may no longer hold (it is never recalculated).
  const staleA = new Set(staleSuggestions(r, a).map((s) => s.possibility.id));
  const staleB = new Set(staleSuggestions(r, b).map((s) => s.possibility.id));
  const fresh = (p: Possibility) => (staleA.has(p.id) && staleB.has(p.id) ? "A and B" : staleA.has(p.id) ? "A" : staleB.has(p.id) ? "B" : null);
  // Suggestions a side holds only as an unchecked copy from an earlier path (see carriedOver): never shown as established.
  const carriedA = new Map(c.carried.a.map((x) => [x.possibility.id, x]));
  const carriedB = new Map(c.carried.b.map((x) => [x.possibility.id, x]));
  const why = (x: CarriedOver) => (x.changed.length ? `it depends on ${x.changed.join(", ")}` : `copied from “${x.from.name}”`);
  const note = (p: Possibility, where: "a" | "both" | "b"): string | null => {
    const inA = where === "a" ? carriedA.get(p.id) : where === "both" ? carriedA.get(a.possibilities.find((q) => same(p, q))?.id ?? "") : undefined;
    const inB = where === "b" || where === "both" ? carriedB.get(p.id) : undefined;
    if (inA && inB) return `not re-checked for A or B (${why(inB)})`;
    if (inA) return `not re-checked for A (${why(inA)})`;
    if (inB) return `not re-checked for B (${why(inB)})`;
    return null;
  };
  // Outcomes whose inputs have different units have no meaningful number to set side by side.
  const units = new Map(r.formulas.map((f) => [f.key, formulaUnit(r, f.key)]));
  const shown = c.calculated.filter((x) => units.get(x.formula.key)?.status !== "mixed");
  const mixed = c.calculated.filter((x) => units.get(x.formula.key)?.status === "mixed");
  const max = Math.max(...shown.flatMap((x) => [Math.abs(x.a), Math.abs(x.b)]), 1e-12);
  const head = (x: typeof a, side: "a" | "b") => (
    <div className={`cmp-head ${side}`} style={{ ["--hue" as string]: hues.get(x.id) }} data-testid={`cmp-head-${side}`}>
      <span className="cmp-side" aria-hidden="true">{side.toUpperCase()}</span>
      <h2><span className="sr-only">Future {side.toUpperCase()}: </span>{x.name}</h2>
      <p className="small">{x.description || changeCaption(changesFromParent(r, x), x.parentId === null, "exact")}</p>
    </div>
  );
  const sims = r.simulations;
  /** One side of a difference: its value, "doesn't apply" (the user said so; not 0), or "not decided yet". */
  const side = (v: AssumptionValue, unit: string, na: boolean) =>
    na ? <span className="muted">doesn't apply</span> : v === null ? <span className="muted">not decided yet</span> : showAssumption(v, unit, "exact");
  const nameOf = (s: "a" | "b") => (s === "a" ? a.name : b.name);
  const notes = new Map(c.notes.map((n) => [n.formula.key, n]));
  return (
    <main className="stage compare" style={{ ["--hue-a" as string]: hues.get(a.id), ["--hue-b" as string]: hues.get(b.id) }} data-testid="compare-view">
      <header className="stage-head cmp-top">
        <button type="button" className="link-btn cmp-back" onClick={() => store.continueWith(a.id)} data-testid="compare-back">Back to the map</button>
        <p className="cmp-caption">Comparing two futures of</p>
        <h1 className="question" tabIndex={-1} data-stage-focus>{r.question}</h1>
      </header>
      <CompareWorlds store={store} r={r} a={a} b={b} />
      <div className="cmp-heads">
        {head(a, "a")}
        <span className="vs" aria-hidden="true">and</span>
        {head(b, "b")}
      </div>

      <section className="cmp-section" data-testid="cmp-differ">
        <h3>Where they differ</h3>
        {c.differences.length + c.told.onlyA.length + c.told.onlyB.length === 0 ? (
          <p className="muted">They make the same choices so far. Their differences are in what might happen, below.</p>
        ) : (
          <>
            {c.differences.length > 0 && (
              <ul className="differ-list">
                <li className="differ-head" aria-hidden="true">
                  <span className="differ-label" />
                  <span className="differ-col a" style={{ ["--hue" as string]: hues.get(a.id) }}><span className="cmp-side">A</span>{a.name}</span>
                  <span className="differ-col b" style={{ ["--hue" as string]: hues.get(b.id) }}><span className="cmp-side">B</span>{b.name}</span>
                </li>
                {c.differences.map((d) => (
                  <li key={d.variable.key}>
                    <span className="differ-label">{d.variable.label}</span>
                    <span className="differ-a">{side(d.a, d.variable.unit, c.notApplicable.a.includes(d.variable.key))}</span>
                    <span className="differ-b">{side(d.b, d.variable.unit, c.notApplicable.b.includes(d.variable.key))}</span>
                  </li>
                ))}
              </ul>
            )}
            {c.told.onlyA.length + c.told.onlyB.length > 0 && (
              <ul className="differ-told" data-testid="cmp-told">
                {/* Told in the user's own words: kept as words, not turned into values, so nothing is recalculated from them. */}
                {/* A change being explored is a what-if, worded apart from a fact the user told us. */}
                {c.told.onlyA.map((f) => <li key={`a-${f.id}`}><span className="muted">Only in “{a.name}”:</span> {isIntervention(f) ? "Exploring" : "You told us"} “{f.answer}”</li>)}
                {c.told.onlyB.map((f) => <li key={`b-${f.id}`}><span className="muted">Only in “{b.name}”:</span> {isIntervention(f) ? "Exploring" : "You told us"} “{f.answer}”</li>)}
              </ul>
            )}
          </>
        )}
      </section>

      {/* What the user said once and both paths hold: not a difference, but never invisible either (R20A). */}
      {c.sameInBoth.length > 0 && (
        <p className="same-line small" data-testid="cmp-same">
          <span className="muted">The same in both, from you:</span>{" "}
          {c.sameInBoth.map((s, i) => <span key={s.variable.key}>{i > 0 ? " · " : ""}{s.variable.label} {showAssumption(s.value, s.variable.unit, "exact")}</span>)}
        </p>
      )}

      <TradeOffView t={c.tradeOff} a={a} b={b} hues={hues} notes={{ fresh, note }} />
      {(staleA.size > 0 || staleB.size > 0 || carriedA.size > 0 || carriedB.size > 0) && (
        <p className="small muted" data-testid="cmp-not-recalculated">Possibilities are not recalculated. Those marked may no longer hold where their assumptions changed, or were copied from another path without being re-checked; ask for another look on that path.</p>
      )}

      {r.formulas.length > 0 && (
        <section className="cmp-section" data-testid="cmp-worked">
          <h3><span className="badge calc">Calculated</span> Worked out from the figures on each path</h3>
          {shown.length > 0 && (
            <ul className="cmp-worked">
              {shown.map((x) => {
                const unit = units.get(x.formula.key)?.unit ?? "";
                return (
                  <li key={x.formula.key} data-testid={`cmp-calc-${x.formula.key}`}>
                    <span className="cmp-worked-label">{x.formula.label}{units.get(x.formula.key)?.status === "unknown" && <span className="small muted"> (no unit given)</span>}</span>
                    {(["a", "b"] as const).map((side) => (
                      <span key={side} className={`cmp-worked-bar ${side}`}>
                        <span className="cmp-side" aria-hidden="true">{side.toUpperCase()}</span>
                        <span className="bar-track"><span className={`bar ${x[side] < 0 ? "neg" : ""}`} style={{ width: `${(Math.abs(x[side]) / max) * 100}%` }} /></span>
                        <span className="bar-value">{withUnit(x[side], unit)}</span>
                      </span>
                    ))}
                    {/* One side all zeros is not a result about that path, so no difference is offered as a gain. */}
                    {notes.get(x.formula.key)?.allZero ? null : <span className="cmp-diff">B − A: <strong>{signed(x.difference, unit)}</strong></span>}
                    <CalcNote store={store} note={notes.get(x.formula.key)} ids={{ a: a.id, b: b.id }} nameOf={nameOf} />
                  </li>
                );
              })}
            </ul>
          )}
          {c.notApplicableIn.length > 0 && (
            <ul className="cmp-na" data-testid="cmp-not-applicable">
              {/* Does not apply on a path: not compared, and nothing is asked for it. Never shown as 0 or as a winner. */}
              {c.notApplicableIn.map((x) => (
                <li key={x.formula.key} className="small">
                  <strong>{x.formula.label}</strong>{" "}
                  {x.side === "both" ? "doesn't apply to either path" : `doesn't apply to “${nameOf(x.side)}”`} ({x.reason}), so it is not compared.
                </li>
              ))}
            </ul>
          )}
          {mixed.length > 0 && (
            <p className="small warn" data-testid="cmp-mixed-units">{mixed.map((x) => x.formula.label).join(", ")}: adds or subtracts amounts in different units, so no result is compared.</p>
          )}
          {c.waiting.length > 0 && (
            <p className="small muted" data-testid="cmp-not-comparable">
              To compare {c.waiting.map((x) => x.label).join(", ")}, add your numbers for: {c.missingForCalculation.join(", ")}.
            </p>
          )}
          {(() => {
            // Neither waiting for figures nor "does not apply": a yes/no result or an error. Said, never shown as a number.
            const other = c.notComparable.filter((x) => !c.waiting.includes(x.formula) && !c.notApplicableIn.some((n) => n.formula === x.formula));
            return other.length > 0 ? <p className="small muted" data-testid="cmp-not-comparable-other">{other.map((x) => x.formula.label).join(", ")}: can't be set side by side with these numbers.</p> : null;
          })()}
          <SettleIt store={store} items={c.toSettle} a={a} b={b} />
        </section>
      )}

      {sims.length > 0 && (
        <section className="cmp-section" data-testid="cmp-simulated">
          <h3><span className="badge sim">Simulated</span> with a validated model</h3>
          <ul className="cmp-sims">
            {sims.map((s) => <SimulatedRow key={s.key} store={store} state={state} r={r} a={a} b={b} s={s} hues={hues} />)}
          </ul>
          <p className="small muted">
            These are model estimates under the assumptions on each path, not predictions of what will happen. {sims.map((s) => `${s.label}: ${s.modelId}@${s.modelVersion}, seed ${s.masterSeed}, ${s.replications} simulated repeats per path`).join("; ")}.
            {" "}A path that has not been simulated shows no number.
          </p>
        </section>
      )}

      {c.unknownInBoth.length > 0 && (
        <p className="unknown-line small"><span className="muted">Still unknown in both:</span> {c.unknownInBoth.map((v) => v.label).join(" · ")}</p>
      )}

      <details className="disclosure" data-testid="cmp-technical">
        <summary>Technical comparison: every assumption side by side</summary>
        <ComparePanel store={store} r={r} compare={state.compare} />
      </details>

      <div className="actions-row compare-actions">
        <button className="btn btn-primary" onClick={() => store.continueWith(a.id)} data-testid="continue-a">Continue with “{a.name}”</button>
        <button className="btn" onClick={() => store.continueWith(b.id)} data-testid="continue-b">Continue with “{b.name}”</button>
      </div>
    </main>
  );
}
