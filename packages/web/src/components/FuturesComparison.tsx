import { useEffect, useRef } from "react";
import { explainStaffingChoice, type BreakEven, type Scenario, type ScenarioComparison } from "@realityfork/core";
import type { Workspace } from "../state/workspace";
import { comparisonKey } from "../state/workspace";
import { useWorkspace } from "../state/useWorkspace";
import { showDiff, showMoney, showValue } from "../format";

const SHORT: Record<BreakEven["status"], string> = {
  finite: "",
  "variant-dominates": "none needed: less staffing and less waiting",
  "baseline-dominates": "none: more staffing and more waiting",
  "waiting-change-inconclusive": "none: waiting change not distinguishable from noise",
  "no-waiting-change": "none: waiting does not change",
  "no-staffing-change": "none: staffing does not change",
  "not-computable": "cannot be computed",
};

function breakEvenText(b: BreakEven): string {
  if (b.status !== "finite" || b.value === null) return SHORT[b.status];
  const range = b.ciLow !== null && b.ciHigh !== null ? ` (likely ${showMoney(b.ciLow)}–${showMoney(b.ciHigh)})` : "";
  return `${showMoney(b.value)} per customer-hour${range}`;
}

/**
 * Side-by-side comparison of every simulated schedule in the scenario's tree against its root.
 * All numbers come from simulated summaries and core comparisons (quick: no sensitivity runs).
 */
export function FuturesComparison({ ws, current }: { ws: Workspace; current: Scenario }) {
  const state = useWorkspace(ws);
  const family = ws.family(current.id).filter((x) => x.spec.modelId === current.spec.modelId && x.spec.modelVersion === current.spec.modelVersion);
  const base = family[0]!;
  const done = family.filter((x) => x.status === "completed" && x.result);
  const drafts = family.filter((x) => x.status === "draft");
  const options = done.filter((x) => x.id !== base.id);
  const baseDone = base.status === "completed";
  const cmp = (variant: Scenario, ref: Scenario): ScenarioComparison | undefined => state.comparisons[comparisonKey(ref, variant, true)];

  // Incremental comparison between the cheapest and the dearest option that both cut waiting.
  const efficient = options
    .map((o) => ({ o, t: cmp(o, base)?.tradeoff ?? null }))
    .filter((x) => x.t !== null && x.t.staffingChange.mean > 0 && x.t.waitingHoursChange.mean < 0)
    .sort((a, b) => a.t!.staffingChange.mean - b.t!.staffingChange.mean);
  const cheaper = efficient[0]?.o;
  const dearer = efficient.length > 1 ? efficient[efficient.length - 1]!.o : undefined;

  const pairs: [Scenario, Scenario][] = baseDone ? options.map((o) => [o, base]) : [];
  if (cheaper && dearer && cheaper.id !== dearer.id) pairs.push([dearer, cheaper]);
  const missing = pairs.find(([v, r]) => !cmp(v, r));
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!missing || state.busy) return;
    const key = comparisonKey(missing[1], missing[0], true);
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    void ws.compare(missing[0].id, missing[1].id, true);
  }, [missing, state.busy, ws]);

  const running = state.busy?.kind === "run" ? state.scenarios.find((x) => x.id === state.busy!.scenarioId) : undefined;
  const inc = cheaper && dearer && cheaper.id !== dearer.id ? cmp(dearer, cheaper) : undefined;
  const ready = baseDone && options.length > 0 && !missing;

  const maxWait = Math.max(...done.map((x) => x.result!.summary.meanWait!.ciHigh), 1e-9);
  const maxCost = Math.max(...done.map((x) => x.result!.summary.modeledCostPerDay!.mean), 1e-9);
  const m = (x: Scenario, k: string) => x.result!.summary[k]!;

  return (
    <div className="card futures" data-testid="futures">
      <div className="card-head">
        <h3>Compare futures</h3>
        {drafts.length > 0 && (
          <button className="primary" data-testid="run-all" disabled={state.busy !== null} onClick={() => void ws.runMany(drafts.map((d) => d.id))}>
            {running ? `Simulating "${running.name}"…` : `Simulate ${drafts.length === 1 ? `"${drafts[0]!.name}"` : `all ${drafts.length} drafts`}`}
          </button>
        )}
      </div>
      <p className="small muted">
        Each future is {base.spec.replications} simulated repeats of {base.spec.settings.horizon / 24} days, with the same random customers in every future, so differences come from the schedule.
        Compared with "{base.name}".
      </p>
      {done.length === 0 && <p className="muted">Nothing simulated yet. Simulate the drafts to compare them.</p>}

      {done.length > 0 && (
        <>
          <h4>How long do customers wait?</h4>
          <ul className="hbars" data-testid="wait-chart">
            {done.map((x) => {
              const w = m(x, "meanWait");
              return (
                <li key={x.id} data-testid={`wait-${x.name}`}>
                  <span className="hbar-name">{x.name}</span>
                  <span className="hbar-track">
                    <span className="hbar wait" style={{ width: `${(w.mean / maxWait) * 100}%` }} />
                    <span className="hbar-ci" style={{ left: `${(w.ciLow / maxWait) * 100}%`, width: `${((w.ciHigh - w.ciLow) / maxWait) * 100}%` }} aria-hidden="true" />
                  </span>
                  <span className="hbar-value">
                    <strong>{showValue(w.mean, "hours")}</strong> average · {showValue(m(x, "shareWaitOver15Min").mean, "fraction")} wait over 15 min
                  </span>
                </li>
              );
            })}
          </ul>

          <h4>What does each future cost per day?</h4>
          <ul className="hbars" data-testid="cost-chart">
            {done.map((x) => {
              const parts = [
                { k: "scheduled", v: m(x, "scheduledCostPerDay").mean, label: "scheduled staff" },
                { k: "extra", v: m(x, "extraTimeCostPerDay").mean, label: "finishing customers after shifts end" },
                { k: "penalty", v: m(x, "waitingPenaltyPerDay").mean, label: "assumed waiting penalty" },
              ];
              return (
                <li key={x.id} data-testid={`cost-${x.name}`}>
                  <span className="hbar-name">{x.name}</span>
                  <span className="hbar-track stacked" title={parts.map((p) => `${p.label} ${showMoney(p.v)}`).join(", ")}>
                    {parts.map((p) => <span key={p.k} className={`hbar ${p.k}`} style={{ width: `${(p.v / maxCost) * 100}%` }} />)}
                  </span>
                  <span className="hbar-value"><strong>{showMoney(m(x, "modeledCostPerDay").mean)}</strong> modelled total</span>
                </li>
              );
            })}
          </ul>
          <ul className="legend small">
            <li><span className="key scheduled" /> Scheduled staff</li>
            <li><span className="key extra" /> Staff finishing customers after a shift or closing (same hourly rate)</li>
            <li><span className="key penalty" /> Assumed waiting penalty: ${base.spec.params.waitingCostPerHour} per customer-hour, a value you chose, not cash</li>
          </ul>

          <div className="table-wrap">
            <table className="cost-table" data-testid="cost-table">
              <thead>
                <tr>
                  <th>Per day</th><th>Scheduled staff</th><th>After-shift time</th><th>Waiting (customer-hours)</th><th>Assumed waiting penalty</th><th>Modelled total</th><th title="The value of one customer-hour of waiting above which this future has a lower modelled total than the starting point">Break-even waiting value vs the starting point</th>
                </tr>
              </thead>
              <tbody>
                {done.map((x) => {
                  const c = x.id === base.id ? undefined : cmp(x, base);
                  return (
                    <tr key={x.id} data-testid={`row-${x.name}`}>
                      <td>{x.name}</td>
                      <td className="num">{showMoney(m(x, "scheduledCostPerDay").mean)}</td>
                      <td className="num">{showMoney(m(x, "extraTimeCostPerDay").mean)}</td>
                      <td className="num">{m(x, "waitingHoursPerDay").mean.toFixed(1)}</td>
                      <td className="num">{showMoney(m(x, "waitingPenaltyPerDay").mean)}</td>
                      <td className="num">{showMoney(m(x, "modeledCostPerDay").mean)}</td>
                      <td data-testid={`breakeven-${x.name}`}>{x.id === base.id ? "starting point" : c?.tradeoff ? breakEvenText(c.tradeoff.breakEven) : baseDone ? "comparing…" : `simulate "${base.name}" first`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {inc?.tradeoff && cheaper && dearer && (
            <p className="small" data-testid="incremental">
              From "{cheaper.name}" to "{dearer.name}": {inc.tradeoff.breakEven.status === "finite" ? `worth it only if waiting is worth more than ${breakEvenText(inc.tradeoff.breakEven)}` : SHORT[inc.tradeoff.breakEven.status]}.
            </p>
          )}
        </>
      )}

      {ready && (
        <div className="why" data-testid="why">
          <h4>Why might extra staff only at the peak give a better trade-off here?</h4>
          <ul>
            {explainStaffingChoice(
              base,
              options.flatMap((o) => {
                const c = cmp(o, base);
                return c ? [{ scenario: o, vsBaseline: c }] : [];
              }),
              inc && cheaper && dearer ? { cheaper, dearer, comparison: inc } : null,
            ).map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}

      {ready && (
        <details data-testid="futures-uncertainty">
          <summary>How sure is this?</summary>
          <ul className="small">
            {options.map((o) => {
              const c = cmp(o, base)!;
              const w = c.outcomes.find((x) => x.metric === "meanWait")!;
              const t = c.tradeoff!;
              return (
                <li key={o.id}>
                  <strong>{o.name}</strong> vs "{base.name}": average wait {showDiff(w.difference.mean, "hours")} (likely range {showDiff(w.difference.ciLow, "hours")} to {showDiff(w.difference.ciHigh, "hours")}
                  {w.conclusion === "inconclusive" ? "; not distinguishable from noise" : ""}); waiting {showDiff(t.waitingHoursChange.mean, "customer-hours")} a day (likely {showDiff(t.waitingHoursChange.ciLow, "customer-hours")} to {showDiff(t.waitingHoursChange.ciHigh, "customer-hours")});
                  staffing {showDiff(t.staffingChange.mean, "$")} a day (likely {showDiff(t.staffingChange.ciLow, "$")} to {showDiff(t.staffingChange.ciHigh, "$")}).
                  {t.breakEven.intervalMethod === "delta-method" && " The break-even range is approximate (delta method), because time spent finishing customers after shifts varies between repeats."}
                </li>
              );
            })}
            <li>Ranges are 95% confidence intervals across {base.spec.replications} matched repeats. They describe simulation noise only, not whether the model's assumptions match a real service center.</li>
            <li>Assumptions: random arrivals at a steady rate within each 2-hour block; random service times; nobody gives up and leaves; after 20:00 staff finish everyone still waiting.</li>
          </ul>
        </details>
      )}
      <p className="disclaimer">Model estimates under stated assumptions, using synthetic demand data. Not predictions for a real service center.</p>
    </div>
  );
}
