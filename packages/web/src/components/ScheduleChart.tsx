import { formatNumber, readBlockProvenance, scheduleView, type Scenario } from "@realityfork/core";
import type { Workspace } from "../state/workspace";

/**
 * Demand per time block (bars, with the data's 95% range when estimated from a log) and the staff
 * on duty (people, plus how many customers they can serve per hour, shown as a line on the bar).
 * Values come from core's scheduleView and readBlockProvenance; this component only draws them.
 */
export function ScheduleChart({ ws, s, busy }: { ws: Workspace; s: Scenario; busy: boolean }) {
  const v = scheduleView(s.spec.params);
  const prov = readBlockProvenance(s.spec.dataProvenance);
  const editable = s.status === "draft" && !busy;
  const top = Math.max(...v.blocks.flatMap((b, i) => [b.ratePerHour, b.capacityPerHour, prov?.blocks[i]?.ciHigh ?? 0]), 1) * 1.08;
  const pctOf = (x: number) => `${Math.min(100, (x / top) * 100)}%`;
  const parentStaff = s.parentId ? ws.getState().scenarios.find((x) => x.id === s.parentId)?.spec.params : undefined;
  return (
    <div className="schedule">
      <div className="sched-grid" data-testid="demand-chart" role="img" aria-label={`Customers arriving per hour by time of day: ${v.blocks.map((b) => `${b.label} ${formatNumber(b.ratePerHour)}`).join(", ")}`}>
        {v.blocks.map((b, i) => {
          const fromData = prov !== null && prov.blocks[i] !== undefined && prov.blocks[i]!.rate === b.ratePerHour;
          const tone = b.load >= 1 ? "over" : b.load >= 0.8 ? "tight" : "ok";
          return (
            <div className="sched-col" key={b.label} data-testid={`block-${i + 1}`}>
              <div className="sched-bar-area">
                <div className={`sched-bar ${tone}`} style={{ height: pctOf(b.ratePerHour) }} title={`${formatNumber(b.ratePerHour)} customers per hour`} />
                {fromData && prov && (
                  <div className="sched-ci" style={{ bottom: pctOf(prov.blocks[i]!.ciLow), height: `calc(${pctOf(prov.blocks[i]!.ciHigh)} - ${pctOf(prov.blocks[i]!.ciLow)})` }} aria-hidden="true" />
                )}
                <div className="sched-cap" style={{ bottom: pctOf(b.capacityPerHour) }} aria-hidden="true" />
              </div>
              <div className="sched-rate" data-testid={`rate-${i + 1}`}>
                <strong>{formatNumber(Math.round(b.ratePerHour * 10) / 10)}</strong>/h
                {!fromData && prov && <span className="tag manual">edited</span>}
              </div>
              <div className="sched-label">{b.label.replace("–", "–\u200b")}</div>
            </div>
          );
        })}
      </div>
      <div className="sched-grid staff-row" data-testid="staff-chart">
        {v.blocks.map((b, i) => {
          const key = `staff${i + 1}`;
          const was = parentStaff?.[key];
          const changed = was !== undefined && was !== b.staff;
          return (
            <div className={`sched-col staff ${changed ? "changed" : ""} ${i === v.peakIndex ? "peak" : ""}`} key={b.label}>
              <div className="people" aria-hidden="true">{"●".repeat(Math.min(b.staff, 8))}{b.staff > 8 ? "…" : ""}</div>
              <div className="staff-count" data-testid={`staff-count-${i + 1}`}>{b.staff} staff</div>
              <div className="cap small muted">serve {formatNumber(b.capacityPerHour)}/h</div>
              {editable && (
                <div className="stepper">
                  <button aria-label={`One fewer person ${b.label}`} data-testid={`staff-minus-${i + 1}`} disabled={b.staff <= 0} onClick={() => void ws.editParam(s.id, key, b.staff - 1)}>−</button>
                  <button aria-label={`One more person ${b.label}`} data-testid={`staff-plus-${i + 1}`} onClick={() => void ws.editParam(s.id, key, b.staff + 1)}>+</button>
                </div>
              )}
              {changed && <div className="was small">was {was}</div>}
            </div>
          );
        })}
      </div>
      <ul className="legend small">
        <li><span className="key bar" /> Customers arriving per hour{prov ? `, estimated from the ${prov.synthetic ? "synthetic " : ""}log` : ""}</li>
        {prov && <li><span className="key ci" /> 95% range of that estimate</li>}
        <li><span className="key cap" /> How many customers the staff on duty can serve per hour</li>
        <li><span className="key over" /> More customers than staff can serve: a line builds up</li>
      </ul>
    </div>
  );
}
