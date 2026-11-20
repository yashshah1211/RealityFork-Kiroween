import { useEffect, useState } from "react";
import { formatNumber, readBlockProvenance, type Scenario } from "@realityfork/core";
import type { Workspace } from "../state/workspace";
import { checkParam } from "../state/workspace";
import { useWorkspace } from "../state/useWorkspace";
import { keyMetrics, PLAIN_HELP, shortHash, showMoney, showValue } from "../format";
import { ScheduleChart } from "./ScheduleChart";
import { FuturesComparison } from "./FuturesComparison";
import { Comparison } from "./Comparison";

function useElapsed(active: boolean, startedAt: number | undefined) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [active]);
  return active && startedAt ? ((Date.now() - startedAt) / 1000).toFixed(1) : null;
}

function ParamRow({ ws, s, k }: { ws: Workspace; s: Scenario; k: string }) {
  const model = ws.model(s);
  const spec = model.parameters[k]!;
  const value = s.spec.params[k]!;
  const [text, setText] = useState(String(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(String(value));
    setErr(null);
  }, [value, s.id]);
  const change = s.changesFromParent.find((c) => c.path === `params.${k}`);
  const locked = s.status === "completed";
  const commit = () => {
    const c = checkParam(model, k, text);
    if (!c.ok) return setErr(c.message);
    setErr(null);
    if (c.value !== value) void ws.editParam(s.id, k, c.value);
  };
  const id = `p-${s.id}-${k}`;
  return (
    <div className={`param ${change ? "changed" : ""}`}>
      <label htmlFor={id}>
        {spec.label}
        <span className="help">{PLAIN_HELP[s.spec.modelId]?.[k] ?? spec.description}</span>
      </label>
      <div className="param-input">
        <input
          id={id}
          data-testid={`param-${k}`}
          inputMode="decimal"
          value={text}
          disabled={locked}
          aria-invalid={err !== null}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <span className="unit">{spec.unit}</span>
      </div>
      {change && <span className="was">was {formatNumber(change.from as number)}</span>}
      {err && <span className="field-error" role="alert">{err}</span>}
    </div>
  );
}

function ForkBox({ ws, s }: { ws: Workspace; s: Scenario }) {
  const [name, setName] = useState("");
  const n = ws.getState().scenarios.length;
  return (
    <form
      className="fork-box"
      onSubmit={(e) => {
        e.preventDefault();
        void ws.fork(s.id, name || `Alternative ${n}`);
        setName("");
      }}
    >
      <input data-testid="fork-name" placeholder={`Name the alternative, e.g. "Add one staff member"`} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of the new alternative" />
      <button className="primary" type="submit" data-testid="fork">Fork this scenario</button>
    </form>
  );
}

/** Where the demand numbers come from: counts, exposure, intervals and warnings from the provenance record. */
function DemandSource({ s }: { s: Scenario }) {
  const p = readBlockProvenance(s.spec.dataProvenance);
  if (!p) return <p className="small muted" data-testid="demand-source">All demand values were entered by hand.</p>;
  return (
    <details className="data-source" data-testid="demand-source">
      <summary>
        Demand estimated from <strong>{p.fileName}</strong> {p.synthetic && <span className="tag">synthetic data</span>}; staffing, service speed and costs are entered by hand.
      </summary>
      <div className="table-wrap">
        <table className="cost-table" data-testid="demand-table">
          <thead><tr><th>Time</th><th>Arrivals counted</th><th>Hours observed</th><th>Estimate per hour</th><th>95% range</th><th>Used in this scenario</th></tr></thead>
          <tbody>
            {p.blocks.map((b, i) => {
              const used = s.spec.params[`rate${i + 1}`]!;
              return (
                <tr key={b.label}>
                  <td>{b.label}</td><td className="num">{b.arrivals}</td><td className="num">{formatNumber(b.exposureHours)}</td>
                  <td className="num">{formatNumber(b.rate)}</td><td className="num">{formatNumber(b.ciLow)}–{formatNumber(b.ciHigh)}</td>
                  <td className="num">{used === b.rate ? "from data" : `${formatNumber(used)} (edited by hand)`}{b.sparse ? " · few arrivals, very uncertain" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Estimate = arrivals counted ÷ hours observed in that block ({p.estimator}). Observed {p.windowStartLocal} to {p.windowEndLocal}, one fixed local UTC offset (no daylight-saving changes).
        Warnings: {p.warnings.length ? p.warnings.join(", ") : "none"}. The model assumes random arrivals at a steady rate within each block; a synthetic log cannot show whether a real site behaves like that.
      </p>
    </details>
  );
}

export function ScenarioDetail({ ws, scenario: s }: { ws: Workspace; scenario: Scenario }) {
  const state = useWorkspace(ws);
  const model = ws.model(s);
  const busy = state.busy;
  const running = busy?.kind === "run" && busy.scenarioId === s.id;
  const elapsed = useElapsed(running, busy?.startedAt);
  const lineage = ws.lineage(s.id);
  const parent = s.parentId ? state.scenarios.find((x) => x.id === s.parentId) ?? null : null;
  const completedOthers = state.scenarios.filter((x) => x.id !== s.id && x.status === "completed" && x.spec.modelId === s.spec.modelId && x.spec.modelVersion === s.spec.modelVersion);
  const refId = state.referenceId ?? (parent?.status === "completed" ? parent.id : null);
  const repro = state.reproductions[s.id];
  const measured = s.spec.settings.horizon - s.spec.settings.warmup;
  const isSchedule = s.spec.modelId === "queue.daypart";
  const familyDrafts = isSchedule ? ws.family(s.id).filter((x) => x.status === "draft") : [];
  const lockNote = s.status === "completed"
    ? <span className="lock">Locked: these results were simulated. Fork to try a change.</span>
    : <span className="muted small">{isSchedule ? "Use − and + to change who is on duty." : "Edit any value; changes apply when you leave the field."}</span>;

  const actions = (
    <>
      <div className="actions">
        {s.status === "draft" && (
          <button className="primary" data-testid="run" disabled={busy !== null} onClick={() => void ws.run(s.id)}>
            {running ? `Simulating… ${elapsed}s` : "Run simulation"}
          </button>
        )}
        {isSchedule && familyDrafts.length > 1 && (
          <button data-testid="run-all-top" disabled={busy !== null} onClick={() => void ws.runMany(familyDrafts.map((d) => d.id))}>
            Simulate all {familyDrafts.length} drafts and compare
          </button>
        )}
        <ForkBox ws={ws} s={s} />
      </div>
      {running && <p className="muted small" role="status">Running {s.spec.replications} simulated repeats of {isSchedule ? `${formatNumber(measured / 24)} days` : `${formatNumber(measured)} hours`} each…</p>}
    </>
  );

  const paramGrid = (keys: readonly string[]) => (
    <div className="params">
      {keys.map((k) => <ParamRow key={k} ws={ws} s={s} k={k} />)}
    </div>
  );

  const outcomesCard = s.status === "completed" && s.result && (
    <div className="card">
      <div className="card-head">
        <h3>Simulated outcomes</h3>
        <span className="muted small">Averages over {s.spec.replications} simulated repeats. "Likely range" is a 95% confidence interval across repeats.</span>
      </div>
      <div className="outcomes">
        {keyMetrics(s.spec.modelId).map((m) => {
          const sm = s.result!.summary[m]!;
          const spec = model.metrics[m]!;
          return (
            <div className="outcome" key={m} data-testid={`outcome-${m}`}>
              <div className="outcome-label">{spec.label}</div>
              <div className="outcome-value">{showValue(sm.mean, spec.unit)}</div>
              <div className="outcome-ci">likely range {showValue(sm.ciLow, spec.unit)} to {showValue(sm.ciHigh, spec.unit)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const comparedCard = s.status === "completed" && (
    <div className="card">
      <div className="card-head">
        <h3>Compared with</h3>
        {(parent || completedOthers.length > 0) && <select data-testid="reference" value={refId ?? ""} onChange={(e) => ws.setReference(e.target.value || null)} aria-label="Scenario to compare with">
          <option value="">{parent ? (parent.status === "completed" ? `${parent.name} (parent)` : "Parent not simulated yet") : "Choose a scenario"}</option>
          {completedOthers.filter((x) => x.id !== parent?.id).map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>}
      </div>
      {refId ? (
        <Comparison ws={ws} variant={s} referenceId={refId} />
      ) : parent ? (
        <p className="muted">Run "{parent.name}" too, or pick another simulated scenario, to see what changed.</p>
      ) : (
        <p className="muted">This is a starting point. Fork it to try an alternative; each alternative is compared with it automatically.</p>
      )}
    </div>
  );

  return (
    <section className="detail" data-testid="detail">
      <nav className="crumbs" aria-label="Lineage">
        {lineage.map((x, i) => (
          <span key={x.id}>
            {i > 0 && " › "}
            {x.id === s.id ? <strong>{x.name}</strong> : <button className="link" onClick={() => ws.select(x.id)}>{x.name}</button>}
          </span>
        ))}
      </nav>
      <div className="model-line">
        <p>
          {isSchedule
            ? "Customers arrive at random, more at some times of day than others, and wait in one line. Whoever is on duty serves the person who has waited longest."
            : "Customers arrive at random and wait in one line. The next free staff member serves whoever has waited longest."}
        </p>
        <details className="small">
          <summary>Technical detail</summary>
          <p>
            Model: {model.title} ({s.spec.modelId}@{s.spec.modelVersion}). Arrivals follow a Poisson process{isSchedule ? " with a constant rate within each 2-hour block (exact time-change generation)" : ""} and service times are
            exponential.{isSchedule && " Staff decreases never interrupt a customer; after 20:00 staff finish everyone still waiting and leave once no one is waiting for them. All such time is paid at the same hourly rate."} Settings:
          </p>
          <ul>
            {Object.entries(model.parameters).map(([k, p]) => <li key={k}>{p.label}: {p.description}</li>)}
          </ul>
        </details>
      </div>

      {isSchedule ? (
        <div className="card" data-testid="schedule-card">
          <div className="card-head">
            <h3>When do customers arrive, and who is on duty?</h3>
            {lockNote}
          </div>
          <ScheduleChart ws={ws} s={s} busy={busy !== null} />
          <DemandSource s={s} />
          <p className="small manual-line" data-testid="manual-line">
            Entered by hand: each person serves {formatNumber(s.spec.params.serviceRatePerHour!)} customers an hour on average and costs {showMoney(s.spec.params.staffCostPerHour!)} an hour;
            one hour of a customer's waiting is valued at {showMoney(s.spec.params.waitingCostPerHour!)} <em>(an assumption, not cash)</em>.
          </p>
          <details className="all-assumptions">
            <summary>All assumptions</summary>
            {paramGrid(Object.keys(model.parameters))}
          </details>
          {actions}
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <h3>Assumptions</h3>
            {lockNote}
          </div>
          {paramGrid(Object.keys(model.parameters))}
          {s.spec.dataProvenance && (
            <p className="data-note">
              Uses estimates from <strong>{String(s.spec.dataProvenance.fileName)}</strong>
              {s.spec.dataProvenance.synthetic === true && <span className="tag">synthetic data</span>}. See "Behind this result" for details.
            </p>
          )}
          {actions}
        </div>
      )}

      {isSchedule && <FuturesComparison ws={ws} current={s} />}

      {isSchedule ? (
        s.status === "completed" && (
          <details className="card more" data-testid="scenario-detail-more">
            <summary>This scenario in detail: outcomes and comparison with its parent</summary>
            {outcomesCard}
            {comparedCard}
          </details>
        )
      ) : (
        <>
          {outcomesCard}
          {comparedCard}
        </>
      )}

      {s.status === "completed" && s.result && (
        <div className="card">
          <div className="card-head">
            <h3>Can I trust and repeat this?</h3>
            <button data-testid="reproduce" disabled={busy !== null} onClick={() => void ws.reproduce(s.id)}>
              {busy?.kind === "reproduce" && busy.scenarioId === s.id ? "Re-running…" : "Reproduce this result"}
            </button>
          </div>
          {repro && (
            <p className={`repro ${repro.status}`} data-testid="repro-status">
              {repro.status === "identical" && "✓ Reproduced exactly: re-running the same assumptions with the same seed gave an identical result fingerprint."}
              {repro.status === "different" && "✗ The re-run gave different numbers. This can happen on a different browser engine (floating-point math)."}
              {repro.status === "version-mismatch" && "! Produced by a different model or engine version, so it cannot be verified here."}
              {repro.status === "invalid" && "✗ The stored data does not match its fingerprint; it was modified."}
              {repro.status === "not-run" && "Nothing to reproduce yet."}
              {repro.notes.map((n) => <span className="block small" key={n}>{n}</span>)}
            </p>
          )}
          <details>
            <summary>Behind this result</summary>
            <dl className="facts">
              <dt>Model</dt><dd>{s.spec.modelId}@{s.result.modelVersion}</dd>
              <dt>Engine / RNG</dt><dd>{s.result.engineVersion} / {s.result.rngVersion}</dd>
              <dt>Run settings</dt><dd>{s.spec.replications} repeats; warm-up {formatNumber(s.spec.settings.warmup)} h, then {formatNumber(measured)} h measured; seed {s.spec.masterSeed}</dd>
              <dt>Assumptions fingerprint</dt><dd title={s.fingerprint}><code>{shortHash(s.fingerprint)}</code></dd>
              <dt>Result fingerprint</dt><dd title={s.result.resultHash}><code>{shortHash(s.result.resultHash)}</code></dd>
              <dt>Produced on</dt><dd>{s.result.runtime.name} {s.result.runtime.version.slice(0, 60)}</dd>
            </dl>
            {s.spec.dataProvenance && (
              <>
                <h4>Data provenance</h4>
                <dl className="facts" data-testid="provenance">
                  {Object.entries(s.spec.dataProvenance).map(([k, v]) => (
                    <div key={k} className="fact-row"><dt>{k}</dt><dd>{typeof v === "number" ? formatNumber(v) : String(v)}</dd></div>
                  ))}
                </dl>
              </>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
