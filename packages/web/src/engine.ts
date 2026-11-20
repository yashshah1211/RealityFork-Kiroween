/**
 * Simulation engine boundary. The UI never runs simulations on the main thread in the
 * browser: WorkerEngine posts to a Web Worker. DirectEngine is used by unit tests.
 */
import {
  compareScenarios,
  deepFreeze,
  reproduce,
  runScenario,
  type CompareOptions,
  type ReproductionReport,
  type Scenario,
  type ScenarioComparison,
} from "@realityfork/core";

export interface Engine {
  run(s: Scenario): Promise<Scenario>;
  compare(baseline: Scenario, variant: Scenario, options?: CompareOptions): Promise<ScenarioComparison>;
  reproduce(s: Scenario): Promise<ReproductionReport>;
}

export const directEngine: Engine = {
  run: (s) => runScenario(s),
  compare: (a, b, o) => compareScenarios(a, b, o),
  reproduce: (s) => reproduce(s),
};

type Op = "run" | "compare" | "reproduce";
type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export function createWorkerEngine(): Engine {
  const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  let next = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(deepFreeze(e.data.result));
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`simulation worker failed: ${e.message}`));
    pending.clear();
  };
  const call = <T>(op: Op, args: unknown[]) =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, op, args });
    });
  return {
    run: (s) => call<Scenario>("run", [s]),
    compare: (a, b, o) => call<ScenarioComparison>("compare", [a, b, o ?? {}]),
    reproduce: (s) => call<ReproductionReport>("reproduce", [s]),
  };
}
