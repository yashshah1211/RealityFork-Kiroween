import { useEffect, useRef, useState } from "react";
import { explainTradeoff, formatNumber, plainChanges, plainOutcome, type CostTradeoff, type OutcomeComparison, type Scenario, type ScenarioComparison } from "@realityfork/core";
import type { Workspace } from "../state/workspace";
import { comparisonKey } from "../state/workspace";
import { useWorkspace } from "../state/useWorkspace";
import { keyMetrics, showDiff, showMoney, showValue } from "../format";

/** Horizontal interval bar for a difference, centred on zero. */
function IntervalBar({ low, high, mean, scale }: { low: number; high: number; mean: number; scale: number }) {
  if (![low, high, mean].every(Number.isFinite) || scale <= 0) return null;
  const pos = (x: number) => `${50 + (x / scale) * 48}%`;
  return (
    <div className="ibar" aria-hidden="true">
      <div className="ibar-zero" />
      <div className="ibar-range" style={{ left: pos(Math.min(low, high)), width: `${(Math.abs(high - low) / scale) * 48}%` }} />
      <div className="ibar-mean" style={{ left: pos(mean) }} />
    </div>
  );
}

function OutcomeLine({ o }: { o: OutcomeComparison }) {
  const tone = o.direction === "better" ? "good" : o.direction === "worse" ? "bad" : o.conclusion === "inconclusive" ? "unclear" : "neutral";
  const d = o.difference;
  const scale = Math.max(Math.abs(d.ciLow), Math.abs(d.ciHigh), Math.abs(d.mean)) * 1.05;
  return (
    <li className={`oline ${tone}`} data-testid={`cmp-${o.metric}`}>
      <div className="oline-text">{plainOutcome(o, showValue)}</div>
      {o.conclusion !== "not-computable" && o.conclusion !== "identical-in-every-replication" && (
        <div className="oline-ci">
          <IntervalBar low={d.ciLow} high={d.ciHigh} mean={d.mean} scale={scale} />
          <span className="small muted">
            difference {showDiff(d.mean, o.unit)}, likely range {showDiff(d.ciLow, o.unit)} to {showDiff(d.ciHigh, o.unit)}
          </span>
        </div>
      )}
    </li>
  );
}

function Sensitivity({ c }: { c: ScenarioComparison }) {
  const s = c.sensitivity;
  const [metric, setMetric] = useState<string>("meanWait");
  if (!s.available) return <p className="muted small">What drove the change: not available ({s.reason})</p>;
  if (s.parameters.length < 2) return null;
  const m = s.perMetric.find((x) => x.metric === metric) ?? s.perMetric[0]!;
  const rows = [
    ...m.effects.map((e) => ({ key: e.path, label: `Only "${e.label}" changed (${formatNumber(e.from)} → ${formatNumber(e.to)})`, d: e.effect, note: e.conclusion === "inconclusive" ? "inconclusive" : "" })),
    { key: "interaction", label: "Interaction: the part that does not simply add up", d: m.interaction, note: m.interactionConclusion === "inconclusive" ? "inconclusive" : m.interaction.allZero ? "none" : "" },
  ];
  const scale = Math.max(...rows.flatMap((r) => [Math.abs(r.d.ciLow), Math.abs(r.d.ciHigh), Math.abs(r.d.mean)]).filter(Number.isFinite), 1e-12) * 1.05;
  return (
    <div className="sens" data-testid="sensitivity">
      <div className="card-head">
        <h4>What drove the change?</h4>
        <select value={m.metric} onChange={(e) => setMetric(e.target.value)} aria-label="Outcome to break down">
          {s.perMetric.map((x) => <option key={x.metric} value={x.metric}>{x.label}</option>)}
        </select>
      </div>
      <p className="small muted">
        Each change re-simulated on its own from the baseline, with the same random customers. Total change: {showDiff(m.combined.mean, m.unit)}.
      </p>
      <ul className="sens-rows">
        {rows.map((r) => (
          <li key={r.key} className={r.key === "interaction" ? "interaction" : ""} data-testid={`sens-${r.key}`}>
            <span className="sens-label">{r.label}</span>
            <IntervalBar low={r.d.ciLow} high={r.d.ciHigh} mean={r.d.mean} scale={scale} />
            <span className="sens-value">{showDiff(r.d.mean, m.unit)}{r.note && <em> ({r.note})</em>}</span>
          </li>
        ))}
      </ul>
      <p className="small muted">These are model estimates. Splitting a combined change into separate effects plus an interaction is one way to describe it, measured from this baseline; it does not identify real-world causes.</p>
    </div>
  );
}

/** Staffing spend versus customer waiting. All numbers come from core's computeTradeoff. */
function Tradeoff({ t, baseName, variantName }: { t: CostTradeoff; baseName: string; variantName: string }) {
  const u = t.timeUnit;
  const sentences = explainTradeoff(t, baseName, variantName);
  const breakEvenText = sentences[sentences.length - 1]!;
  const range = (d: { ciLow: number; ciHigh: number }, f: (x: number) => string) => `likely range ${f(d.ciLow)} to ${f(d.ciHigh)}`;
  const signed = (x: number, f: (x: number) => string) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${f(Math.abs(x))}`;
  const hrs = (x: number) => formatNumber(x);
  return (
    <div className="tradeoff" data-testid="tradeoff">
      <h4>Staffing cost versus customer waiting</h4>
      <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Per {u}</th><th>{baseName}</th><th>{variantName}</th><th>Change</th></tr>
        </thead>
        <tbody>
          <tr data-testid="tradeoff-staffing">
            <td>Staffing spend</td>
            <td className="num">{showMoney(t.baselineStaffing)}</td>
            <td className="num">{showMoney(t.variantStaffing)}</td>
            <td className="num">{signed(t.staffingChange.mean, showMoney)}</td>
          </tr>
          <tr data-testid="tradeoff-waiting">
            <td>Customer-hours spent waiting (simulated)</td>
            <td className="num">{hrs(t.baselineWaitingHours)}</td>
            <td className="num">{hrs(t.variantWaitingHours)}</td>
            <td className="num">{signed(t.waitingHoursChange.mean, hrs)} <span className="small muted">({range(t.waitingHoursChange, hrs)})</span></td>
          </tr>
        </tbody>
      </table>
      </div>
      <p className="breakeven" data-testid="tradeoff-breakeven">
        {breakEvenText}
      </p>
      <p className="small" data-testid="tradeoff-net">
        With your assumed value of waiting ({t.waitingValue.same ? `${showMoney(t.waitingValue.baseline)}` : `${showMoney(t.waitingValue.baseline)} vs ${showMoney(t.waitingValue.variant)}`} per customer-hour), the modelled total
        (staffing + assumed waiting value) changes by {signed(t.netCostChange.mean, showMoney)} per {u} ({range(t.netCostChange, (x) => signed(x, showMoney))}). The
        waiting value is an assumption you chose, not money paid, so a lower modelled total is not a cash saving.
      </p>
    </div>
  );
}

export function Comparison({ ws, variant, referenceId }: { ws: Workspace; variant: Scenario; referenceId: string }) {
  const state = useWorkspace(ws);
  const ref = state.scenarios.find((x) => x.id === referenceId);
  const key = ref ? comparisonKey(ref, variant) : "";
  const c = state.comparisons[key];
  const comparing = state.busy?.kind === "compare" && state.busy.scenarioId === variant.id;
  // Attempt each comparison once; a failure is shown in the error banner instead of retrying in a loop.
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (ref && ref.status === "completed" && !c && !state.busy && !attempted.current.has(key)) {
      attempted.current.add(key);
      void ws.compare(variant.id, ref.id);
    }
  }, [key, c, state.busy, ref, variant.id, ws]);
  if (!ref) return null;
  if (!c) return <p className="muted" role="status">{comparing ? "Comparing, including one-change-at-a-time simulations…" : "Preparing comparison…"}</p>;
  const keys = keyMetrics(c.model.id);
  const key4 = c.outcomes.filter((o) => keys.includes(o.metric));
  const others = c.outcomes.filter((o) => !keys.includes(o.metric));
  return (
    <div className="comparison" data-testid="comparison">
      <p className="changed">
        <strong>What changed:</strong> {plainChanges(c.assumptions)}
      </p>
      <ul className="olines">{key4.map((o) => <OutcomeLine key={o.metric} o={o} />)}</ul>
      {c.tradeoff && <Tradeoff t={c.tradeoff} baseName={ref.name} variantName={variant.name} />}
      <Sensitivity c={c} />
      <details>
        <summary>How sure is this?</summary>
        <ul className="small">
          <li>{c.pairing.reason}</li>
          {c.outcomes.filter((o) => o.pairing && keys.includes(o.metric)).map((o) => (
            <li key={o.metric}>
              {o.label}: matched random customers {o.pairing!.ratio < 1 ? `reduced the variance of the comparison by ${(o.pairing!.varianceReduction * 100).toFixed(0)}%` : `increased the variance of the comparison by ${(-o.pairing!.varianceReduction * 100).toFixed(0)}%`}.
            </li>
          ))}
          {c.statements.filter((st) => st.kind === "caveat").slice(1).map((st) => <li key={st.text}>{st.text}</li>)}
          <li>
            Other outcomes:{" "}
            {others.map((o) => `${o.label}: ${showValue(o.baselineMean, o.unit)} → ${showValue(o.variantMean, o.unit)} (${o.conclusion.replace(/-/g, " ")})`).join("; ")}.
          </li>
        </ul>
      </details>
      <p className="disclaimer">{c.disclaimer}</p>
    </div>
  );
}
