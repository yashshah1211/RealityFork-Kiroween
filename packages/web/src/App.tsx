import { useRef, useState } from "react";
import { useWorkspace } from "./state/useWorkspace";
import type { Workspace } from "./state/workspace";
import { ScenarioTree } from "./components/ScenarioTree";
import { ScenarioDetail } from "./components/ScenarioDetail";
import { DataImport } from "./components/DataImport";
import { SCHEDULE_CARD, SCHEDULE_CSV } from "./scheduleData";


export function App({ ws }: { ws: Workspace }) {
  const state = useWorkspace(ws);
  const [showData, setShowData] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = ws.selected();

  const download = () => {
    const blob = new Blob([ws.exportText()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "realityfork-scenarios.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>RealityFork</h1>
          <p className="tagline">Fork a decision, run both futures, and see what changed. <a href="#" className="small">← Back to all realities</a></p>
        </div>
        <div className="toolbar">
          {state.scenarios.length > 0 && (
            <>
              {/* The arrival-log estimator fills the single-rate model only; schedules get demand from their example log. */}
              {selected?.spec.modelId !== "queue.daypart" && <button className="ghost" onClick={() => setShowData((v) => !v)} data-testid="open-data">
                {showData ? "Close data" : "Estimate from data"}
              </button>}
              <button className="ghost" onClick={download} data-testid="export">Export</button>
            </>
          )}
          <button className="ghost" onClick={() => fileRef.current?.click()} data-testid="import">Import</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="import-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await ws.importText(await f.text());
              e.target.value = "";
            }}
          />
          {state.scenarios.length > 0 && (
            <button className="ghost danger" onClick={() => confirm("Remove all scenarios from this browser?") && ws.reset()}>Reset</button>
          )}
        </div>
      </header>

      {state.loadError && (
        <div className="banner error" role="alert">
          {state.loadError}
          <button onClick={() => { ws.reset(); }}>Start fresh</button>
        </div>
      )}
      {state.error && (
        <div className="banner error" role="alert" data-testid="error">
          {state.error}
          <button onClick={ws.dismiss}>Dismiss</button>
        </div>
      )}
      {state.notice && (
        <div className="banner info" role="status">
          {state.notice}
          <button onClick={ws.dismiss}>OK</button>
        </div>
      )}

      {state.scenarios.length === 0 ? (
        <main className="empty">
          <h2>See when demand is highest. Explore when extra staff would help most.</h2>
          <p>
            A service center has long queues at busy times. Look at when customers arrive, try different staffing schedules,
            and compare the simulated waits and costs side by side.
          </p>
          <button
            className="primary"
            data-testid="load-schedule-example"
            onClick={() =>
              void ws.loadScheduleExample({
                csv: SCHEDULE_CSV, fileName: SCHEDULE_CARD.fileName, synthetic: SCHEDULE_CARD.synthetic,
                observationWindow: SCHEDULE_CARD.observationWindow, localUtcOffsetMinutes: SCHEDULE_CARD.generatorParameters.utcOffsetMinutes,
              })
            }
          >
            Start with the service-center example
          </button>
          <p className="muted small">The example uses synthetic (made-up) arrival data. Results are model estimates, not predictions.</p>
          <p className="small">
            <button className="link" onClick={() => void ws.loadExample()} data-testid="load-example">Or try a simpler front desk with one average arrival rate</button>
            <span className="muted"> · or import scenarios you exported earlier.</span>
          </p>
        </main>
      ) : (
        <div className="layout">
          <aside className="sidebar">
            <h2 className="section-title">Scenarios</h2>
            <ScenarioTree ws={ws} />
          </aside>
          <main className="main">
            {showData && selected && selected.spec.modelId !== "queue.daypart" && <DataImport ws={ws} parent={selected} onDone={() => setShowData(false)} />}
            {selected ? <ScenarioDetail ws={ws} scenario={selected} /> : <p className="muted">Select a scenario.</p>}
          </main>
        </div>
      )}
    </div>
  );
}
