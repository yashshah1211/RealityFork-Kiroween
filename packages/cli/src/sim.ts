/**
 * npm run sim -- <scenario.json>
 * Scenario JSON: { modelId, modelVersion, params, settings: {warmup, horizon}, seed, replications, confidence? }
 */
import { readFileSync } from "node:fs";
import { getModel, runReplications } from "@realityfork/core";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run sim -- <scenario.json>");
  process.exit(2);
}
const sc = JSON.parse(readFileSync(file, "utf8")) as {
  modelId: string;
  modelVersion: string;
  params: Record<string, number>;
  settings: { warmup: number; horizon: number };
  seed: number;
  replications: number;
  confidence?: number;
};

const model = getModel(sc.modelId, sc.modelVersion);
const t0 = performance.now();
const r = runReplications(model, sc.params, sc.settings, sc.seed, sc.replications, sc.confidence ?? 0.95);
const ms = performance.now() - t0;

console.log(`Model: ${model.title} (${r.metadata.modelId}@${r.metadata.modelVersion})`);
console.log(`Engine ${r.metadata.engineVersion} | RNG ${r.metadata.rngVersion} | seed ${r.metadata.masterSeed} | ${r.metadata.replications} replications`);
console.log(`Warm-up ${sc.settings.warmup} h, measurement window [${sc.settings.warmup}, ${sc.settings.horizon}] h`);
console.log("Results are model estimates under the stated assumptions, not predictions.\n");
const fmt = (x: number) => (Number.isFinite(x) ? x.toPrecision(5) : String(x));
for (const [key, spec] of Object.entries(model.metrics) as [string, { label: string; unit: string }][]) {
  const s = r.summary[key]!;
  console.log(`${spec.label.padEnd(36)} ${fmt(s.mean).padStart(10)} ${spec.unit.padEnd(20)} ${Math.round(s.confidence * 100)}% CI [${fmt(s.ciLow)}, ${fmt(s.ciHigh)}]`);
}
console.log(`\nwall-clock: ${ms.toFixed(1)} ms`);
