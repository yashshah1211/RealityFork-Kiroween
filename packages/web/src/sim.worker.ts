/// <reference lib="webworker" />
import { compareScenarios, reproduce, runScenario, type CompareOptions, type Scenario } from "@realityfork/core";

type Msg = { id: number; op: "run" | "compare" | "reproduce"; args: unknown[] };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const { id, op, args } = e.data;
  try {
    const result =
      op === "run"
        ? await runScenario(args[0] as Scenario)
        : op === "compare"
          ? await compareScenarios(args[0] as Scenario, args[1] as Scenario, (args[2] ?? {}) as CompareOptions)
          : await reproduce(args[0] as Scenario);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
