import { useMemo, useState } from "react";
import { csvHeader, formatNumber, type DurationUnit, type QueueImportReport, type Scenario } from "@realityfork/core";
import type { Workspace } from "../state/workspace";
import { DEMO_CARD, DEMO_CSV } from "../demoData";

const STATUS_TEXT: Record<string, string> = {
  consistent: "consistent with the model's assumption",
  departure: "departs from the model's assumption",
  "strong-departure": "strongly departs from the model's assumption",
  "too-few": "too few observations to check",
};

function FitBadge({ label, status, detail }: { label: string; status: string; detail: string }) {
  const tone = status === "consistent" ? "good" : status === "too-few" ? "neutral" : "bad";
  return (
    <li className={`fit ${tone}`}>
      <strong>{label}</strong>: {STATUS_TEXT[status] ?? status} <span className="muted small">({detail})</span>
    </li>
  );
}

export function DataImport({ ws, parent, onDone }: { ws: Workspace; parent: Scenario; onDone: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  const [arrivalCol, setArrivalCol] = useState("");
  const [serviceCol, setServiceCol] = useState("");
  const [unit, setUnit] = useState<DurationUnit>("minutes");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [tzMode, setTzMode] = useState<"explicit" | "assume">("explicit");
  const [tzOffset, setTzOffset] = useState("0");
  const [report, setReport] = useState<QueueImportReport | null>(null);
  const [useLam, setUseLam] = useState(true);
  const [useMu, setUseMu] = useState(true);
  const [lamOverride, setLamOverride] = useState("");
  const [muOverride, setMuOverride] = useState("");
  const [name, setName] = useState("Demand measured from data");
  const [busy, setBusy] = useState(false);

  const header = useMemo(() => {
    if (text === null) return { cols: [] as readonly string[], error: null as string | null };
    try {
      return { cols: csvHeader(text), error: null };
    } catch (e) {
      return { cols: [], error: (e as Error).message };
    }
  }, [text]);

  const loadDemo = () => {
    setText(DEMO_CSV);
    setFileName(DEMO_CARD.fileName);
    setSynthetic(DEMO_CARD.synthetic);
    setArrivalCol("arrival_time");
    setServiceCol("service_minutes");
    setUnit(DEMO_CARD.serviceDurationUnit);
    setStart(DEMO_CARD.observationWindow.start);
    setEnd(DEMO_CARD.observationWindow.end);
    setTzMode("explicit");
    setReport(null);
  };

  const estimate = async () => {
    if (text === null) return;
    setBusy(true);
    const offset = Number(tzOffset);
    const r = await ws.estimate(text, {
      fileName: fileName || "uploaded.csv",
      synthetic,
      mapping: { arrivalTime: arrivalCol, serviceDuration: serviceCol || null },
      serviceDurationUnit: unit,
      observationWindow: { start, end },
      timezone: { assumeOffsetMinutes: tzMode === "explicit" ? null : Number.isFinite(offset) ? offset * 60 : 0 },
    });
    setReport(r);
    setBusy(false);
  };

  const parseOverride = (raw: string) => {
    const v = Number(raw.trim());
    return raw.trim() !== "" && Number.isFinite(v) && v > 0 ? v : null;
  };
  const lamBad = !useLam && parseOverride(lamOverride) === null;
  const muBad = !useMu && report?.service && parseOverride(muOverride) === null;

  const apply = async () => {
    if (!report) return;
    const child = await ws.applyEstimate(parent.id, report, name, {
      ...(useLam ? {} : { arrivalRate: parseOverride(lamOverride)! }),
      ...(useMu || !report.service ? {} : { serviceRate: parseOverride(muOverride)! }),
    });
    if (child) onDone();
  };

  const errors = report?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = report?.issues.filter((i) => i.severity === "warning") ?? [];

  return (
    <section className="card data" data-testid="data-panel">
      <div className="card-head">
        <h3>Estimate assumptions from an arrival log</h3>
        <button className="ghost" onClick={onDone}>Close</button>
      </div>
      <p className="small muted">
        A CSV with one row per customer: when they arrived and, optionally, how long service took. The result becomes a new alternative of
        "{parent.name}"; nothing existing is changed.
      </p>
      <div className="actions">
        <button onClick={loadDemo} data-testid="load-demo-csv">Use the synthetic demo log</button>
        <label className="file-label">
          or upload a CSV
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="csv-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setText(await f.text());
              setFileName(f.name);
              setSynthetic(false);
              setStart("");
              setEnd("");
              setReport(null);
            }}
          />
        </label>
      </div>
      {header.error && <p className="field-error" role="alert">{header.error}</p>}
      {text !== null && !header.error && (
        <div className="form-grid">
          <div className="file-line">
            <strong>{fileName}</strong>
            {synthetic && <span className="tag">synthetic data</span>}
            <label className="inline"><input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} /> This file is synthetic (not real observations)</label>
          </div>
          <label>Arrival time column
            <select value={arrivalCol} onChange={(e) => setArrivalCol(e.target.value)} data-testid="map-arrival">
              <option value="">choose…</option>
              {header.cols.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Service duration column
            <select value={serviceCol} onChange={(e) => setServiceCol(e.target.value)} data-testid="map-service">
              <option value="">none (arrivals only)</option>
              {header.cols.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Service duration unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as DurationUnit)}>
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </label>
          <label>Observation started at
            <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="2026-03-02T08:00:00-05:00" data-testid="window-start" />
          </label>
          <label>Observation ended at
            <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="2026-03-16T18:00:00-05:00" data-testid="window-end" />
          </label>
          <label>Timestamps without a time zone
            <select value={tzMode} onChange={(e) => setTzMode(e.target.value as "explicit" | "assume")}>
              <option value="explicit">are rejected</option>
              <option value="assume">are read as UTC offset…</option>
            </select>
          </label>
          {tzMode === "assume" && (
            <label>Offset from UTC (hours)
              <input value={tzOffset} onChange={(e) => setTzOffset(e.target.value)} inputMode="decimal" />
            </label>
          )}
          <p className="small muted span2">
            The observation window must cover exactly the period the log was recorded, including quiet stretches with no arrivals. It is not
            guessed from the first and last rows.
          </p>
          <button className="primary" disabled={busy || !arrivalCol} onClick={() => void estimate()} data-testid="estimate">
            {busy ? "Estimating…" : "Estimate"}
          </button>
        </div>
      )}

      {report && (
        <div className="report" data-testid="estimate-report">
          {errors.length > 0 && (
            <ul className="issues errors" role="alert">
              {errors.map((i, k) => <li key={k}>{i.message}</li>)}
            </ul>
          )}
          {report.ok && report.arrivalRate && report.window && (
            <>
              <div className="estimates">
                <div className="estimate">
                  <div className="outcome-label">Customers arriving</div>
                  <div className="outcome-value" data-testid="est-lambda">{formatNumber(report.arrivalRate.perHour)} per hour</div>
                  <div className="outcome-ci">95% range {formatNumber(report.arrivalRate.ciLow)} to {formatNumber(report.arrivalRate.ciHigh)}</div>
                  <code className="formula">{report.arrivalRate.formula}</code>
                </div>
                {report.service && (
                  <div className="estimate">
                    <div className="outcome-label">Customers one staff member can serve</div>
                    <div className="outcome-value" data-testid="est-mu">{formatNumber(report.service.ratePerHour)} per hour</div>
                    <div className="outcome-ci">95% range {formatNumber(report.service.rateCiLow)} to {formatNumber(report.service.rateCiHigh)}</div>
                    <code className="formula">{report.service.formula}</code>
                  </div>
                )}
              </div>
              <p className="small muted">
                Counted {report.counts.arrivalsInWindow} arrivals and {report.counts.serviceSamples} service durations over {formatNumber(report.window.hours)} h
                ({report.window.startUtc} to {report.window.endUtc}, UTC). File fingerprint {report.file.sha256.slice(0, 12)}…
              </p>
              <h4>Does the data fit the model's assumptions?</h4>
              <ul className="fits">
                {report.fit.interarrivalCv && <FitBadge label="Random arrivals (gaps between arrivals)" status={report.fit.interarrivalCv.status} detail={`variation ${formatNumber(report.fit.interarrivalCv.cv)}, model assumes 1`} />}
                {report.fit.serviceCv && <FitBadge label="Service-time variation" status={report.fit.serviceCv.status} detail={`variation ${formatNumber(report.fit.serviceCv.cv)}, model assumes 1`} />}
                {report.fit.dispersion && <FitBadge label="Steady arrival rate hour to hour" status={report.fit.dispersion.status} detail={`dispersion ${formatNumber(report.fit.dispersion.index)} per ${report.fit.dispersion.binHours} h, p = ${report.fit.dispersion.pValue.toPrecision(2)}`} />}
                {report.fit.rateDrift && <FitBadge label="Same arrival rate in both halves of the period" status={report.fit.rateDrift.status} detail={`${formatNumber(report.fit.rateDrift.firstRatePerHour)} vs ${formatNumber(report.fit.rateDrift.secondRatePerHour)} per hour, p = ${report.fit.rateDrift.pValue.toPrecision(2)}`} />}
              </ul>
              <p className="small muted">
                Passing these checks does not prove the model is right; they can miss some patterns, such as busy mornings and quiet afternoons that
                repeat every day. The model uses one average arrival rate for the whole period.
              </p>
            </>
          )}
          {warnings.length > 0 && (
            <ul className="issues warnings">
              {warnings.map((i, k) => <li key={k}>{i.message}{i.lines && i.lines.length > 0 ? ` (lines ${i.lines.join(", ")})` : ""}</li>)}
            </ul>
          )}
          {report.ok && (
            <div className="apply">
              <label className="inline">
                <input type="checkbox" checked={useLam} onChange={(e) => setUseLam(e.target.checked)} data-testid="use-lambda" /> Use estimated arrivals
              </label>
              {!useLam && <input aria-label="Arrival rate override" placeholder="per hour" value={lamOverride} onChange={(e) => setLamOverride(e.target.value)} data-testid="override-lambda" />}
              {report.service && (
                <>
                  <label className="inline">
                    <input type="checkbox" checked={useMu} onChange={(e) => setUseMu(e.target.checked)} /> Use estimated service rate
                  </label>
                  {!useMu && <input aria-label="Service rate override" placeholder="per hour" value={muOverride} onChange={(e) => setMuOverride(e.target.value)} />}
                </>
              )}
              <input aria-label="Name of the new alternative" value={name} onChange={(e) => setName(e.target.value)} data-testid="data-fork-name" />
              <button className="primary" disabled={Boolean(lamBad || muBad)} onClick={() => void apply()} data-testid="apply-estimate">
                Create alternative with these values
              </button>
              {(lamBad || muBad) && <span className="field-error">Enter a positive number for each override.</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
