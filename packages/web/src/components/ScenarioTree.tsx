import { plainChanges, type Scenario } from "@realityfork/core";
import type { Workspace } from "../state/workspace";
import { useWorkspace } from "../state/useWorkspace";

/** Short list of changed assumptions; long lists are cut to the first two plus a count. */
function changesText(s: Scenario): string {
  const ch = s.changesFromParent.filter((c) => c.path.startsWith("params.") || c.path === "dataProvenance");
  if (ch.length <= 3) return plainChanges(ch);
  return `${plainChanges(ch.slice(0, 2))}; and ${ch.length - 2} more changes`;
}

function Node({ ws, s, depth }: { ws: Workspace; s: Scenario; depth: number }) {
  const state = useWorkspace(ws);
  const kids = ws.children(s.id);
  const selected = state.selectedId === s.id;
  const running = state.busy?.kind === "run" && state.busy.scenarioId === s.id;
  return (
    <li className={depth > 0 ? "branch" : "root"}>
      <button
        className={`node ${selected ? "selected" : ""}`}
        onClick={() => ws.select(s.id)}
        aria-current={selected}
        data-testid={`node-${s.name}`}
      >
        <span className="node-name">{s.name}</span>
        <span className={`status ${s.status}`}>{running ? "Running…" : s.status === "completed" ? "Simulated" : "Draft"}</span>
        {s.parentId && <span className="node-changes">{changesText(s)}</span>}
        {s.spec.dataProvenance && <span className="tag">{s.spec.dataProvenance.synthetic === true ? "synthetic data" : "data"}</span>}
      </button>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Node key={k.id} ws={ws} s={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ScenarioTree({ ws }: { ws: Workspace }) {
  useWorkspace(ws);
  return (
    <ul className="tree" data-testid="tree">
      {ws.roots().map((r) => (
        <Node key={r.id} ws={ws} s={r} depth={0} />
      ))}
    </ul>
  );
}
