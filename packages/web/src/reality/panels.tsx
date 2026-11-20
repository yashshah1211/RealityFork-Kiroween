import { useEffect, useState, type ReactNode } from "react";
import {
  carriedOver,
  changesFromParent,
  checkFormula,
  compareBranches,
  evaluateBranch,
  formulaUnit,
  getModel,
  isIntervention,
  possibilityOrigin,
  simulationInput,
  valueOrigin,
  type AssumptionValue,
  type Branch,
  type Likelihood,
  type Possibility,
  type Reality,
  type Tone,
  type Variable,
  type VariableKind,
} from "@realityfork/core";
import type { RealityStore, RealityState } from "./store";
import { simKey } from "./store";
import { originWords, parseNumberInput, possibilityTag, showAssumption, showOption, showOutcome, signed } from "./format";
import { showDiff, showValue } from "../format";
import { useConfirm } from "./dialogs";

const LIKELIHOOD: Record<Likelihood, string> = { "not-judged": "not judged", unlikely: "unlikely", possible: "possible", likely: "likely" };
const TONE: Record<"" | Tone, string> = { "": "not sorted", upside: "could go well", challenge: "could be hard" };

/** Set or clear a tone without ever writing `tone: undefined` (canonical hashing rejects undefined). */
export function withTone(p: Possibility, tone: "" | Tone): Possibility {
  const { tone: _old, ...rest } = p;
  return tone ? { ...rest, tone } : rest;
}

export const newPossibilityId = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Parse a typed value for a variable. Returns undefined for invalid input. */
function parseTyped(v: Variable, raw: string): AssumptionValue | undefined {
  const t = raw.trim();
  if (t === "" || t === "unknown") return null;
  if (v.kind === "number") {
    const n = parseNumberInput(t, v.unit);
    return n.ok ? n.value : undefined;
  }
  if (v.kind === "boolean") return t === "yes" ? true : t === "no" ? false : undefined;
  return v.options.includes(t) ? t : undefined;
}

const numberProblem = (text: string, unit: string) => {
  const n = parseNumberInput(text, unit);
  return n.ok ? "Enter a number, or leave empty for unknown" : n.message;
};

/** Where a value came from, for the advanced editor (see valueOrigin). Nothing is shown for an unknown value. */
function sourceLine(r: Reality, b: Branch, key: string): string | null {
  const p = valueOrigin(r, b, key);
  const where = p.from ? ` in “${p.from.name}”` : "";
  switch (p.origin) {
    case "user": return p.stated ? `Set by you${where}, from your question: “${p.stated.text}” (a what-if figure, not checked)` : `Set by you${where}`;
    case "example": return "Example figure, not your number: replace it with your own";
    case "ai": return "Chosen by the AI draft to define this path";
    case "unrecorded": return "Origin not recorded (saved before RealityFork kept track)";
    default: return null;
  }
}

function ValueInput({ store, r, v, b, parentValue }: { store: RealityStore; r: Reality; v: Variable; b: Branch; parentValue: AssumptionValue | undefined }) {
  const value = b.values[v.key] ?? null;
  const [text, setText] = useState(value === null ? "" : String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value === null ? "" : String(value));
    setBad(false);
  }, [value, b.id]);
  const commit = (raw: string) => {
    const x = parseTyped(v, raw);
    if (x === undefined) return setBad(true);
    setBad(false);
    if (x !== value) void store.answer(b.id, v.key, x);
  };
  const changed = parentValue !== undefined && parentValue !== value;
  const source = sourceLine(r, b, v.key);
  const id = `v-${b.id}-${v.key}`;
  const toText = (x: AssumptionValue) => (x === null ? "unknown" : typeof x === "boolean" ? (x ? "yes" : "no") : String(x));
  return (
    <div className={`assump ${changed ? "changed" : ""} ${value === null ? "unknown" : ""}`}>
      <label htmlFor={id}>{v.label}</label>
      {v.kind === "number" ? (
        <div className="assump-input">
          <input id={id} data-testid={`value-${v.key}`} inputMode="decimal" value={text} placeholder="unknown" aria-invalid={bad} onChange={(e) => setText(e.target.value)} onBlur={() => commit(text)} onKeyDown={(e) => e.key === "Enter" && commit(text)} />
          {v.unit && <span className="unit">{v.unit}</span>}
        </div>
      ) : (
        <select id={id} data-testid={`value-${v.key}`} value={toText(value)} onChange={(e) => commit(e.target.value)}>
          <option value="unknown">unknown</option>
          {(v.kind === "boolean" ? ["yes", "no"] : v.options).map((o) => <option key={o} value={o}>{showOption(o)}</option>)}
        </select>
      )}
      {bad && <span className="field-error" role="alert">{v.kind === "number" ? numberProblem(text, v.unit) : "Choose a value"}</span>}
      {changed && <span className="was">was {showAssumption(parentValue ?? null, v.unit)}</span>}
      {source && <span className="assump-note" data-testid={`value-source-${v.key}`}>{source}</span>}
      {(v.source || v.uncertainty) && <span className="assump-note">{[v.source && `Source: ${v.source}`, v.uncertainty && `Uncertainty: ${v.uncertainty}`].filter(Boolean).join(" · ")}</span>}
    </div>
  );
}

/** One simulated result to draw: its average and its 95% interval, as the engine reported them. */
export interface IntervalRow {
  readonly key: string;
  readonly label: string;
  readonly hue?: number;
  readonly mean: number;
  readonly low: number;
  readonly high: number;
}
const finiteRow = (x: IntervalRow) => Number.isFinite(x.mean) && Number.isFinite(x.low) && Number.isFinite(x.high);

/**
 * The 95% interval of one or more simulated results on one axis that includes zero, so two futures can be read
 * side by side. Drawing only: the positions are the engine's own numbers scaled to the width; nothing is estimated
 * here. Rows that are not finite numbers are not drawn (their text says why).
 */
export function IntervalStrip({ rows, unit, caption }: { rows: readonly IntervalRow[]; unit: string; caption?: string }) {
  const drawn = rows.filter(finiteRow);
  if (!drawn.length) return null;
  const lo = Math.min(0, ...drawn.map((x) => x.low));
  const hi = Math.max(0, ...drawn.map((x) => x.high));
  const span = (hi - lo) * 1.12 || 1;
  const at = (v: number) => `${(((v - lo) / span) * 100).toFixed(2)}%`;
  return (
    <figure className="interval" aria-label={caption ?? "Simulated averages with their 95% intervals"}>
      <div className="interval-rows">
        {drawn.map((x) => (
          <div key={x.key} className="interval-row" style={x.hue === undefined ? undefined : { ["--hue" as string]: x.hue }}>
            {drawn.length > 1 && <span className="interval-name" aria-hidden="true">{x.label}</span>}
            <span className="interval-track" role="img" aria-label={`${x.label}: average ${showValue(x.mean, unit)}, 95% interval ${showValue(x.low, unit)} to ${showValue(x.high, unit)}`}>
              <span className="interval-zero" style={{ left: at(0) }} />
              <span className="interval-band" style={{ left: at(x.low), width: `calc(${at(x.high)} - ${at(x.low)})` }} />
              <span className="interval-mean" style={{ left: at(x.mean) }} />
            </span>
          </div>
        ))}
      </div>
      <figcaption className="interval-axis" aria-hidden="true">
        <span style={{ left: at(0) }}>0</span>
        <span className="interval-key"><span className="ik-band" /> 95% interval <span className="ik-mean" /> average</span>
      </figcaption>
    </figure>
  );
}

/**
 * A difference B − A with its interval, on an axis centred on zero: an interval that crosses the zero line is a
 * difference the runs cannot tell apart from noise. Drawing only, from the engine's comparison.
 */
export function DifferenceStrip({ diff, low, high, unit }: { diff: number; low: number; high: number; unit: string }) {
  if (![diff, low, high].every(Number.isFinite)) return null;
  const m = Math.max(Math.abs(low), Math.abs(high), Math.abs(diff)) * 1.25 || 1;
  const at = (v: number) => `${(((v + m) / (2 * m)) * 100).toFixed(2)}%`;
  const crosses = low <= 0 && high >= 0;
  return (
    <span className={`diff-strip ${crosses ? "crosses" : ""}`} role="img" aria-label={`B minus A: ${showDiff(diff, unit)}, 95% interval ${showDiff(low, unit)} to ${showDiff(high, unit)}${crosses ? ", which includes zero" : ""}`}>
      <span className="interval-track">
        <span className="interval-zero" style={{ left: "50%" }} />
        <span className="interval-band" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
        <span className="interval-mean" style={{ left: at(diff) }} />
      </span>
      <span className="diff-ends" aria-hidden="true"><span>A higher</span><span>0</span><span>B higher</span></span>
    </span>
  );
}

/**
 * One validated simulation on one path: what it needs, running, failed, out of date, or its result with the interval
 * and everything it was run with (model, inputs and where each came from, seed and repeats). Nothing is shown as zero
 * or filled in; a run is kept for the version of the path it ran on.
 */
export function SimulatedOutcome({ store, state, r, b, simKeyName, compact = false }: { store: RealityStore; state: RealityState; r: Reality; b: Branch; simKeyName: string; compact?: boolean }) {
  const s = r.simulations.find((x) => x.key === simKeyName)!;
  const input = simulationInput(r, b, s.key);
  const entry = state.sims[simKey(b, s.key)];
  const model = getModel(s.modelId, s.modelVersion);
  const unit = model.metrics[s.metric]?.unit ?? "";
  const run = () => void store.runSimulation(b.id, s.key);
  // The path's own figures the model reads, each with where it came from (the same words as everywhere else).
  const uses = Object.values(s.params).flatMap((src) => {
    if (typeof src !== "string") return [];
    const v = r.variables.find((x) => x.key === src);
    return v ? [`${v.label} ${showAssumption(b.values[src] ?? null, v.unit)} (${originWords(valueOrigin(r, b, src))})`] : [];
  });
  const about = <span className="sim-model">{model.title} · {s.modelId}@{s.modelVersion} · {s.replications} simulated repeats · seed {s.masterSeed}</span>;
  let body: ReactNode;
  if (!input.ok) {
    body = <p className="sim-state warn">Can't be simulated yet: {[...input.missing.map((m) => `needs ${m}`), ...input.problems].join("; ")}.</p>;
  } else if (entry?.status === "done") {
    const m = entry.scenario.result!.summary[s.metric]!;
    body = (
      <div className="sim-result">
        <p className="sim-value">
          <strong>{showValue(m.mean, unit)}</strong>{" "}
          {compact
            ? <span className="small muted">likely range {showValue(m.ciLow, unit)} to {showValue(m.ciHigh, unit)} (a 95% interval across {s.replications} simulated repeats)</span>
            : <span className="small muted">(likely range {showValue(m.ciLow, unit)} to {showValue(m.ciHigh, unit)}, a 95% interval across {s.replications} simulated repeats; {s.modelId}@{s.modelVersion}, seed {s.masterSeed})</span>}
        </p>
        <IntervalStrip rows={[{ key: b.id, label: b.name, mean: m.mean, low: m.ciLow, high: m.ciHigh }]} unit={unit} caption={`${s.label}: the average and its 95% interval`} />
        <p className="sim-note small muted">A model estimate under the assumptions on this path, not a prediction of what will happen.</p>
      </div>
    );
  } else if (entry?.status === "running") {
    body = (
      <div className="sim-running" role="status">
        <span className="skeleton-line" aria-hidden="true" />
        <span className="small muted">Simulating {s.replications} repeats with this path's figures…</span>
      </div>
    );
  } else if (entry?.status === "error") {
    body = (
      <div className="sim-state">
        <p className="warn" role="alert">The simulation failed: {entry.message}</p>
        <button type="button" className="btn pill" onClick={run} data-testid={`run-sim-${s.key}`}>Try again</button>
      </div>
    );
  } else {
    // Runs are kept per version of the path: after a change, the earlier result no longer applies and is not shown.
    const last = state.lastRun[`${b.id}|${s.key}`];
    body = (
      <div className="sim-state">
        <p className="small muted">{last && last !== b.fingerprint ? "This path changed since its last simulation, so the earlier result is not shown." : "Not simulated yet: no result is shown until it runs."}</p>
        <button type="button" className="btn pill" onClick={run} data-testid={`run-sim-${s.key}`}>Run the simulation</button>
      </div>
    );
  }
  return (
    <li className={`outcome-row sim-row ${compact ? "compact" : ""}`} data-testid={`sim-${s.key}`}>
      <span className="olabel">{s.label}</span>
      <div className="ovalue">{body}</div>
      <details className="sim-behind small">
        <summary>What this simulation uses</summary>
        <p>{about}</p>
        {uses.length > 0 && <p className="muted">From this path: {uses.join(" · ")}.</p>}
        <p className="muted">The same figures and seed give the same result in this browser. Averages and intervals come from the validated engine; nothing here is estimated by the page.</p>
      </details>
    </li>
  );
}

export function BranchPanel({ store, state, r, b }: { store: RealityStore; state: RealityState; r: Reality; b: Branch }) {
  const parent = b.parentId ? r.branches.find((x) => x.id === b.parentId) : undefined;
  const { changes, told, parentChangedSinceFork } = changesFromParent(r, b);
  const exploring = told.filter(isIntervention).length;
  const toldFacts = told.length - exploring;
  const differs = [
    changes.length ? `${changes.length} assumption${changes.length > 1 ? "s" : ""} changed` : "",
    exploring ? `${exploring} change${exploring > 1 ? "s" : ""} you are exploring` : "",
    toldFacts ? `${toldFacts} thing${toldFacts > 1 ? "s" : ""} you told us ${toldFacts > 1 ? "differ" : "differs"}` : "",
  ].filter(Boolean);
  const out = evaluateBranch(r, b);
  const confirmRemove = useConfirm();
  const descendants = (() => {
    const ids = new Set([b.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of r.branches) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
    }
    return ids.size - 1;
  })();
  const remove = async () => {
    const ok = await confirmRemove({
      title: `Remove “${b.name}”?`,
      body: <p>{descendants ? `This path and the ${descendants} ${descendants === 1 ? "path" : "paths"} made from it are removed from this map.` : "This path is removed from this map."} The paths it came from stay as they are. This cannot be undone, unless you saved the map to a file first.</p>,
      confirm: descendants ? `Remove ${descendants + 1} paths` : "Remove this path",
      cancel: "Keep it",
    });
    if (ok) void store.removeBranch(b.id);
  };
  const [name, setName] = useState(b.name);
  const [desc, setDesc] = useState(b.description);
  const [pText, setPText] = useState("");
  const [pLike, setPLike] = useState<Likelihood>("not-judged");
  const [pTone, setPTone] = useState<"" | Tone>("");
  useEffect(() => {
    setName(b.name);
    setDesc(b.description);
  }, [b.id, b.name, b.description]);
  const addPossibility = () => {
    if (!pText.trim()) return;
    void store.updateBranch(b.id, { possibilities: [...b.possibilities, { id: newPossibilityId(), text: pText.trim(), likelihood: pLike, note: "", source: "user", ...(pTone ? { tone: pTone } : {}) }] });
    setPText("");
    setPLike("not-judged");
    setPTone("");
  };
  return (
    <div className="panel branch-panel" data-testid="branch-panel">
      <div className="bp-head">
        <input className="bp-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== b.name && void store.updateBranch(b.id, { name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Name of this reality" data-testid="branch-name" />
        <textarea className="bp-desc" value={desc} rows={2} placeholder="Describe this reality in a sentence" onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== b.description && void store.updateBranch(b.id, { description: desc })} aria-label="Description of this reality" data-testid="branch-description" />
        <p className="small muted">
          {parent ? <>Branched from <button className="link-btn" onClick={() => store.select(parent.id)}>{parent.name}</button>{differs.length ? ` · ${differs.join(" · ")}` : " · nothing changed yet"}</> : "This is the starting reality. Branch it to explore alternatives."}
          {parentChangedSinceFork && <span className="warn"> · "{parent?.name}" was edited after this branch was made; this branch kept its own values.</span>}
        </p>
      </div>

      <section>
        <h3>Assumptions in this reality</h3>
        {r.variables.length === 0 ? (
          <p className="empty-hint">No assumptions yet. <button className="link-btn" onClick={() => store.openDetails("define")}>Add the things that matter</button>, such as a cost, a choice or a yes/no.</p>
        ) : (
          <div className="assumps">{r.variables.map((v) => <ValueInput key={v.key} store={store} r={r} v={v} b={b} parentValue={parent?.values[v.key]} />)}</div>
        )}
        {out.missingAssumptions.length > 0 && <p className="small warn" data-testid="missing">Unknown, so some outcomes cannot be calculated: {out.missingAssumptions.join(", ")}.</p>}
      </section>

      <section>
        <h3>Consequences</h3>
        <div className="kinds">
          <div className="kind calc" data-testid="calculated">
            <h4><span className="badge calc">Calculated</span> from your assumptions and formulas</h4>
            {r.formulas.length === 0 ? <p className="small muted">No formulas yet. <button className="link-btn" onClick={() => store.openDetails("define")}>Add one</button> if a consequence can be worked out with arithmetic.</p> : (
              <ul className="outcomes-list">
                {out.calculated.map(({ formula: f, result }) => (
                  <li key={f.key} className={`outcome-row ${result.status}`} data-testid={`calc-${f.key}`}>
                    <span className="olabel">{f.label}{!f.reviewed && <span className="tag manual" title="Came with the example. Check the formula before relying on it.">example formula</span>}</span>
                    <span className="ovalue">{result.status === "ok" ? <strong>{showOutcome(formulaUnit(r, f.key), result)}</strong> : <span className="warn">{showOutcome(formulaUnit(r, f.key), result)}</span>}</span>
                    <code className="oformula">{f.expression}{f.condition && ` (only when ${f.condition})`}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {r.simulations.length > 0 && (
            <div className="kind sim" data-testid="simulated">
              <h4><span className="badge sim">Simulated</span> by a validated model</h4>
              <ul className="outcomes-list">{r.simulations.map((s) => <SimulatedOutcome key={s.key} store={store} state={state} r={r} b={b} simKeyName={s.key} />)}</ul>
            </div>
          )}
          <div className="kind spec" data-testid="speculative">
            <h4><span className="badge spec">Speculative</span> possibilities to think with, not calculated</h4>
            <ul className="poss-list">
              {b.possibilities.map((p) => (
                <li key={p.id}>
                  <span>{p.text}<span className="tag origin" data-testid={`origin-${p.id}`}>{possibilityTag(possibilityOrigin(p))}</span>{p.setAside && <span className="tag" title={p.setAside}>set aside</span>}</span>
                  <select value={p.tone ?? ""} aria-label={`Upside or challenge: ${p.text}`} onChange={(e) => void store.updateBranch(b.id, { possibilities: b.possibilities.map((q) => (q.id === p.id ? withTone(q, e.target.value as "" | Tone) : q)) })}>
                    {Object.entries(TONE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <select value={p.likelihood} aria-label={`How likely: ${p.text}`} onChange={(e) => void store.updateBranch(b.id, { possibilities: b.possibilities.map((q) => (q.id === p.id ? { ...q, likelihood: e.target.value as Likelihood } : q)) })}>
                    {Object.entries(LIKELIHOOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button className="mini ghost" aria-label={`Remove ${p.text}`} onClick={() => void store.updateBranch(b.id, { possibilities: b.possibilities.filter((q) => q.id !== p.id) })}>✕</button>
                </li>
              ))}
            </ul>
            <form className="poss-add" onSubmit={(e) => { e.preventDefault(); addPossibility(); }}>
              <input value={pText} onChange={(e) => setPText(e.target.value)} placeholder="Something that might happen in this reality" aria-label="New possibility" data-testid="possibility-text" />
              <select value={pTone} onChange={(e) => setPTone(e.target.value as "" | Tone)} aria-label="Upside or challenge" data-testid="possibility-tone">
                {Object.entries(TONE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select value={pLike} onChange={(e) => setPLike(e.target.value as Likelihood)} aria-label="Your judgement of how likely" data-testid="possibility-likelihood">
                {Object.entries(LIKELIHOOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="submit" className="btn pill" data-testid="add-possibility">Add</button>
            </form>
            <p className="small muted">Likelihood is a judgement, not a calculation: the one you set, or the one an example came with. RealityFork does not estimate it.</p>
          </div>
        </div>
      </section>

      <div className="bp-foot">
        <button className="btn pill" onClick={() => void store.fork(b.id)} data-testid="fork-selected">＋ Branch this reality</button>
        {b.parentId && <button className="btn pill btn-quiet-danger" onClick={() => void remove()} data-testid="remove-branch">Remove branch</button>}
        <details className="small">
          <summary>Behind this reality</summary>
          <dl className="facts">
            <dt>Fingerprint</dt><dd><code>{b.fingerprint}</code></dd>
            <dt>Parent fingerprint at fork</dt><dd><code>{b.parentFingerprint ?? "none (starting reality)"}</code></dd>
            <dt>Lineage</dt><dd>{lineage(r, b).map((x) => x.name).join(" › ")}</dd>
          </dl>
        </details>
      </div>
    </div>
  );
}

function lineage(r: Reality, b: Branch): Branch[] {
  const out: Branch[] = [];
  let cur: Branch | undefined = b;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? r.branches.find((x) => x.id === cur!.parentId) : undefined;
  }
  return out;
}

export function DefinePanel({ store, r }: { store: RealityStore; r: Reality }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<VariableKind>("number");
  const [unit, setUnit] = useState("");
  const [options, setOptions] = useState("");
  const [start, setStart] = useState("");
  const [source, setSource] = useState("");
  const [uncertainty, setUncertainty] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fExpr, setFExpr] = useState("");
  const [fUnit, setFUnit] = useState("");
  const [fCond, setFCond] = useState("");
  const [question, setQuestion] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const fCheck = fExpr.trim() ? checkFormula(r, fExpr) ?? (fCond.trim() ? checkFormula(r, fCond) : null) : null;

  const addVar = async () => {
    const opts = options.split(",").map((o) => o.trim()).filter(Boolean);
    const t = start.trim();
    let initial: AssumptionValue = t === "" ? null : kind === "boolean" ? t === "yes" : t;
    if (kind === "number") {
      const n = parseNumberInput(t, unit);
      if (!n.ok) return setStartError(n.message);
      initial = n.value;
    }
    setStartError(null);
    const done = await store.addVariable({ label, kind, unit, options: opts, source, uncertainty }, initial);
    if (done) {
      setLabel(""); setUnit(""); setOptions(""); setStart(""); setSource(""); setUncertainty("");
    }
  };
  const addF = async () => {
    const done = await store.addFormula({ label: fLabel, expression: fExpr, unit: fUnit, condition: fCond, reviewed: true });
    if (done) { setFLabel(""); setFExpr(""); setFUnit(""); setFCond(""); }
  };

  return (
    <div className="panel define-panel" data-testid="define-panel">
      <p className="small muted">These definitions are shared by every reality in this tree, so they can be compared. Each reality sets its own values.</p>

      <section>
        <h3>What matters? <span className="muted small">assumptions</span></h3>
        {r.variables.length > 0 && (
          <ul className="def-list">
            {r.variables.map((v) => (
              <li key={v.key} data-testid={`var-${v.key}`}>
                <div><strong>{v.label}</strong> <code className="key">{v.key}</code> <span className="muted small">{v.kind === "number" ? v.unit || "number" : v.kind === "boolean" ? "yes / no" : `one of: ${v.options.join(", ")}`}</span></div>
                <div className="def-notes">
                  <input aria-label={`Source for ${v.label}`} placeholder="Source (where does this come from?)" defaultValue={v.source} onBlur={(e) => e.target.value !== v.source && void store.updateVariable(v.key, { source: e.target.value })} />
                  <input aria-label={`Uncertainty for ${v.label}`} placeholder="How uncertain is it?" defaultValue={v.uncertainty} onBlur={(e) => e.target.value !== v.uncertainty && void store.updateVariable(v.key, { uncertainty: e.target.value })} />
                  <button className="mini ghost" aria-label={`Remove ${v.label}`} onClick={() => void store.removeVariable(v.key)}>✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form className="def-form" onSubmit={(e) => { e.preventDefault(); void addVar(); }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Monthly rent" aria-label="Assumption name" data-testid="var-label" required />
          <select value={kind} onChange={(e) => setKind(e.target.value as VariableKind)} aria-label="Kind" data-testid="var-kind">
            <option value="number">a number</option>
            <option value="category">a choice</option>
            <option value="boolean">yes / no</option>
          </select>
          {kind === "number" && <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit, e.g. £ per month" aria-label="Unit" data-testid="var-unit" />}
          {kind === "category" && <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Choices, comma-separated" aria-label="Choices" data-testid="var-options" />}
          {kind === "boolean" ? (
            <select value={start} onChange={(e) => setStart(e.target.value)} aria-label="Starting value" data-testid="var-start">
              <option value="">unknown</option><option value="yes">yes</option><option value="no">no</option>
            </select>
          ) : (
            <input value={start} onChange={(e) => { setStart(e.target.value); setStartError(null); }} placeholder="Value today (blank = unknown)" aria-label="Starting value" aria-invalid={startError !== null} data-testid="var-start" />
          )}
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (optional)" aria-label="Source" data-testid="var-source" />
          <input value={uncertainty} onChange={(e) => setUncertainty(e.target.value)} placeholder="Uncertainty (optional)" aria-label="Uncertainty" data-testid="var-uncertainty" />
          <button className="btn pill accent" type="submit" data-testid="add-variable">Add assumption</button>
        </form>
        {startError && <p className="field-error" role="alert" data-testid="var-start-error">{startError}</p>}
        <p className="small muted">The value you enter is used in every reality that already exists, recorded as yours; change it per reality afterwards.</p>
      </section>

      <section>
        <h3>What can be calculated? <span className="muted small">formulas</span></h3>
        {r.formulas.length > 0 && (
          <ul className="def-list">
            {r.formulas.map((f) => (
              <li key={f.key} data-testid={`formula-${f.key}`}>
                <div><strong>{f.label}</strong> = <code>{f.expression}</code> {f.unit && <span className="muted small">{f.unit}</span>}{f.condition && <span className="muted small"> · only when <code>{f.condition}</code></span>}</div>
                <div className="def-notes">
                  {!f.reviewed && <button className="mini" onClick={() => void store.reviewFormula(f.key)} data-testid={`review-formula-${f.key}`}>I checked this formula</button>}
                  <button className="mini ghost" aria-label={`Remove ${f.label}`} onClick={() => void store.removeFormula(f.key)}>✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form className="def-form" onSubmit={(e) => { e.preventDefault(); void addF(); }}>
          <input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="Outcome name, e.g. Yearly cost" aria-label="Outcome name" data-testid="f-label" required />
          <input className="wide" value={fExpr} onChange={(e) => setFExpr(e.target.value)} placeholder="Formula, e.g. monthlyRent * 12" aria-label="Formula" data-testid="f-expr" required />
          <input value={fUnit} onChange={(e) => setFUnit(e.target.value)} placeholder="Unit" aria-label="Outcome unit" data-testid="f-unit" />
          <input value={fCond} onChange={(e) => setFCond(e.target.value)} placeholder="Only when… (optional), e.g. savings > 0" aria-label="Condition" data-testid="f-condition" />
          <button className="btn pill accent" type="submit" disabled={!fExpr.trim() || fCheck !== null} data-testid="add-formula">Add calculated outcome</button>
        </form>
        <p className={`small ${fCheck ? "field-error" : "muted"}`} data-testid="f-check">
          {fCheck ?? "Use + − * / ^, brackets, min(), max(), abs(), round(x, digits) and if(condition, then, else). Click a name to insert it:"}
        </p>
        <div className="chips">
          {[...r.variables.map((v) => v.key), ...r.formulas.map((f) => f.key)].map((k) => <button key={k} type="button" className="chip" onClick={() => setFExpr((e) => `${e}${e && !e.endsWith(" ") ? " " : ""}${k}`)}>{k}</button>)}
        </div>
      </section>

      <section>
        <h3>Open questions</h3>
        <ul className="q-list">
          {r.questions.map((q, i) => (
            <li key={`${i}-${q}`}>{q} <button className="mini ghost" aria-label={`Remove question ${q}`} onClick={() => void store.updateText({ questions: r.questions.filter((_, j) => j !== i) })}>✕</button></li>
          ))}
        </ul>
        <form className="poss-add" onSubmit={(e) => { e.preventDefault(); if (question.trim()) { void store.updateText({ questions: [...r.questions, question] }); setQuestion(""); } }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What do you want to find out?" aria-label="New question" data-testid="question-text" />
          <button type="submit" className="btn pill">Add</button>
        </form>
      </section>
    </div>
  );
}

export function ComparePanel({ store, r, compare }: { store: RealityStore; r: Reality; compare: readonly [string | null, string | null] }) {
  const [aId, bId] = compare;
  const pick = (which: 0 | 1, id: string) => store.setCompare(which === 0 ? id || null : aId, which === 1 ? id || null : bId);
  const selects = (
    <div className="cmp-pick">
      {[0, 1].map((w) => (
        <label key={w}>
          <span className={`cmp-tag ${w ? "b" : "a"}`}>{w ? "B" : "A"}</span>
          <select value={(w ? bId : aId) ?? ""} onChange={(e) => pick(w as 0 | 1, e.target.value)} data-testid={`compare-select-${w ? "b" : "a"}`} aria-label={`Reality ${w ? "B" : "A"}`}>
            <option value="">choose a reality…</option>
            {r.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
  if (!aId || !bId || aId === bId) return <div className="panel" data-testid="compare-panel">{selects}<p className="muted">Choose two different realities, here or with “Compare” on the cards.</p></div>;
  const c = compareBranches(r, aId, bId);
  const maxAbs = Math.max(...c.calculated.flatMap((x) => [x.a, x.b].map((y) => (y.status === "ok" && typeof y.value === "number" ? Math.abs(y.value) : 0))), 1e-12);
  // A copy carried over from an earlier path is listed, never presented as checked for both (see carriedOver).
  const carried = new Set([...carriedOver(r, c.a), ...carriedOver(r, c.b)].map((x) => x.possibility.text.trim().toLowerCase()));
  const unchecked = (p: Possibility) => carried.has(p.text.trim().toLowerCase()) && <span className="muted small"> (copied from an earlier path, not re-checked)</span>;
  return (
    <div className="panel compare-panel" data-testid="compare-panel">
      {selects}
      <section>
        <h3>Calculated consequences</h3>
        {c.calculated.length === 0 && <p className="small muted">No calculated outcomes defined.</p>}
        <ul className="cmp-bars">
          {c.calculated.map((x) => (
            <li key={x.formula.key} data-testid={`cmp-${x.formula.key}`}>
              <div className="cmp-label">{x.formula.label}</div>
              {(["a", "b"] as const).map((w) => {
                const res = x[w];
                const v = res.status === "ok" && typeof res.value === "number" ? res.value : null;
                return (
                  <div key={w} className="cmp-bar-row">
                    <span className={`cmp-tag ${w}`}>{w.toUpperCase()}</span>
                    <span className="cmp-track">{v !== null && <span className={`cmp-bar ${w} ${v < 0 ? "neg" : ""}`} style={{ width: `${(Math.abs(v) / maxAbs) * 100}%` }} />}</span>
                    <span className="cmp-val">{showOutcome(formulaUnit(r, x.formula.key), res)}</span>
                  </div>
                );
              })}
              <div className="cmp-diff small">{x.difference !== null && formulaUnit(r, x.formula.key).status !== "mixed" ? <>B − A: <strong>{signed(x.difference, formulaUnit(r, x.formula.key).unit)}</strong> (direct calculation)</> : <span className="muted">No difference can be calculated: {[x.a, x.b].some((y) => y.status === "missing") ? "an assumption is unknown" : formulaUnit(r, x.formula.key).status === "mixed" ? "it adds or subtracts amounts in different units" : "an outcome is not applicable or not a number"}.</span>}</div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Assumptions</h3>
        <div className="table-wrap">
          <table className="cmp-table">
            <thead><tr><th>Assumption</th><th><span className="cmp-tag a">A</span> {c.a.name}</th><th><span className="cmp-tag b">B</span> {c.b.name}</th></tr></thead>
            <tbody>
              {c.assumptions.map((x) => (
                <tr key={x.variable.key} className={x.changed ? "changed" : ""}>
                  <td>{x.variable.label}</td><td>{showAssumption(x.a, x.variable.unit, "exact")}</td><td>{showAssumption(x.b, x.variable.unit, "exact")}{x.changed && typeof x.a === "number" && typeof x.b === "number" && <span className="small muted"> ({signed(x.b - x.a, "")})</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3>Speculative possibilities</h3>
        <div className="poss-cols">
          <div><h4><span className="cmp-tag a">A</span> only</h4><ul>{c.possibilities.onlyA.map((p) => <li key={p.id}>{p.text} <span className="muted small">({LIKELIHOOD[p.likelihood]})</span>{unchecked(p)}</li>)}{c.possibilities.onlyA.length === 0 && <li className="muted">none</li>}</ul></div>
          <div><h4>Listed in both</h4><ul>{c.possibilities.both.map((p) => <li key={p.id}>{p.text}{unchecked(p)}</li>)}{c.possibilities.both.length === 0 && <li className="muted">none</li>}</ul></div>
          <div><h4><span className="cmp-tag b">B</span> only</h4><ul>{c.possibilities.onlyB.map((p) => <li key={p.id}>{p.text} <span className="muted small">({LIKELIHOOD[p.likelihood]})</span>{unchecked(p)}</li>)}{c.possibilities.onlyB.length === 0 && <li className="muted">none</li>}</ul></div>
        </div>
      </section>
      <p className="disclaimer">Calculated differences are arithmetic on the assumptions in each path. They are not predictions, and possibilities are judgements, not calculations.</p>
    </div>
  );
}
