/**
 * npm run demo:daypart
 * Revision-sprint spike: DATA → DECISION → ALTERNATIVES → EXPLANATION with a daily demand pattern.
 *   1. Estimate 2-hour block arrival rates from the SYNTHETIC daily log (explicit window, fixed local offset).
 *   2. Baseline: 2 staff all day. A: 3 staff all day. B: 3 staff only 12:00–14:00 (the peak).
 *   3. Compare with matched random customers and the staffing-vs-waiting trade-off.
 * Writes docs/validation/daypart-demo.txt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareScenarios,
  createBaseline,
  estimateBlockRates,
  explainTradeoff,
  fork,
  formatNumber,
  reproduce,
  runScenario,
  DAYPART_BLOCKS,
  type Scenario,
  type ScenarioComparison,
} from "@realityfork/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const csvPath = resolve(root, "data/synthetic/frontdesk-daily-SYNTHETIC.csv");
const card = JSON.parse(readFileSync(resolve(root, "data/synthetic/frontdesk-daily-SYNTHETIC.card.json"), "utf8"));
const text = readFileSync(csvPath, "utf8");
const lines: string[] = [];
const log = (s = "") => {
  lines.push(s);
  console.log(s);
};
const min = (h: number) => `${formatNumber(Math.round(h * 600) / 10)} min`;
const t0 = performance.now();

log("RealityFork daypart spike: SYNTHETIC data, model estimates only (not predictions)");
log("");
const blocks = DAYPART_BLOCKS.map((b, i) => ({ label: b.label, startHour: 8 + 2 * i, endHour: 10 + 2 * i }));
const est = await estimateBlockRates(text, {
  fileName: card.fileName, synthetic: true, arrivalColumn: "arrival_time",
  observationWindow: card.observationWindow, timezone: { assumeOffsetMinutes: null }, localUtcOffsetMinutes: -300, blocks,
});
if (!est.ok) throw new Error(est.issues.map((i) => i.message).join("; "));
log(`1. DATA: ${card.fileName} (sha256 ${est.fileSha256.slice(0, 12)}…), window ${est.window!.startLocal} → ${est.window!.endLocal} local (fixed UTC−05:00, no DST)`);
log("   block          arrivals  exposure   estimate/h   95% range      true (generator)");
const trueRates = String(card.generatorParameters.ratesPerHour).split(",").map(Number);
est.blocks.forEach((b, i) => log(`   ${b.label.padEnd(13)} ${String(b.count).padStart(8)}  ${String(b.exposureHours).padStart(6)} h   ${formatNumber(b.ratePerHour).padStart(8)}     ${formatNumber(b.ciLow)}–${formatNumber(b.ciHigh)}`.padEnd(70) + `${trueRates[i]}`));
log(`   warnings: ${est.issues.length ? est.issues.map((i) => i.code).join(", ") : "none"}`);
log("");

const rateParams: Record<string, number> = {};
est.blocks.forEach((b, i) => (rateParams[`rate${i + 1}`] = b.ratePerHour));
const staff = (s: number[]) => Object.fromEntries(s.map((v, i) => [`staff${i + 1}`, v]));
const baseline = await runScenario(
  await createBaseline({
    id: "today", name: "Today: 2 staff all day", modelId: "queue.daypart", modelVersion: "0.2.0",
    params: { ...rateParams, ...staff([2, 2, 2, 2, 2, 2]), serviceRatePerHour: 10, staffCostPerHour: 30, waitingCostPerHour: 20 },
    settings: { warmup: 0, horizon: 24 * 20 }, masterSeed: 2026, replications: 30,
    dataProvenance: { kind: "block-rates", estimator: est.estimator, fileName: card.fileName, sha256: est.fileSha256, synthetic: true, windowStart: est.window!.startLocal, windowEnd: est.window!.endLocal, localUtcOffsetMinutes: -300 },
  }),
);
const A = await runScenario(await fork(baseline, { id: "all-day", name: "A: 3 staff all day", params: staff([3, 3, 3, 3, 3, 3]) }));
const B = await runScenario(await fork(baseline, { id: "peak-only", name: "B: +1 staff 12:00–14:00 only", params: { staff3: 3 } }));
const B2 = await runScenario(await fork(baseline, { id: "peak-and-after", name: "B2: +1 staff 12:00–16:00", params: { staff3: 3, staff4: 3 } }));
const runMs = performance.now() - t0;

log("2. ALTERNATIVES (30 matched repeats × 20 simulated days each; costs: $30 per staff-hour, waiting valued at an ASSUMED $20 per customer-hour)");
const row = (s: Scenario) => {
  const m = s.result!.summary;
  return `   ${s.name.padEnd(30)} wait ${min(m.meanWait!.mean).padStart(8)}  peak-arrival wait ${min(m.meanWaitBlock3!.mean).padStart(8)}  >15 min ${(m.shareWaitOver15Min!.mean * 100).toFixed(1).padStart(5)}%  staff-h/day ${formatNumber(m.staffHoursPerDay!.mean).padStart(6)}  staffing $${m.staffingCostPerDay!.mean.toFixed(0).padStart(5)}/day (overrun+after-close $${m.extraTimeCostPerDay!.mean.toFixed(2)})  waiting ${formatNumber(m.waitingHoursPerDay!.mean).padStart(6)} cust-h/day`;
};
[baseline, A, B, B2].forEach((s) => log(row(s)));
log("");

const explain = (c: ScenarioComparison, a: Scenario, b: Scenario) => {
  log(`3. EXPLANATION: "${a.name}" → "${b.name}"`);
  const w = c.outcomes.find((o) => o.metric === "meanWait")!;
  log(`   Average wait: ${min(w.baselineMean)} → ${min(w.variantMean)} (difference ${min(w.difference.mean)}, likely range ${min(w.difference.ciLow)} to ${min(w.difference.ciHigh)}; ${w.conclusion})`);
  for (const s of explainTradeoff(c.tradeoff!, a.name, b.name)) log(`   ${s}`);
  log("");
};
const cA = await compareScenarios(baseline, A, { sensitivity: false });
const cB = await compareScenarios(baseline, B, { sensitivity: false });
const cB2 = await compareScenarios(baseline, B2, { sensitivity: false });
const cAB = await compareScenarios(B, A, { sensitivity: false });
explain(cA, baseline, A);
explain(cB, baseline, B);
explain(cB2, baseline, B2);
explain(cAB, B, A);

const reps = await Promise.all([baseline, A, B, B2].map((s) => reproduce(s)));
log(`4. REPRODUCE: ${reps.map((r, i) => `${[baseline, A, B, B2][i]!.id} ${r.status}`).join(", ")}`);
log(`   timing: 4 scenarios × 30 repeats × 20 days ran in ${runMs.toFixed(0)} ms; total ${(performance.now() - t0).toFixed(0)} ms (Node ${process.version})`);
log("");
log("All numbers are model estimates under stated assumptions (Poisson arrivals with constant rate within each 2-hour block, random service times, no abandonment, closing rule: after 20:00 the last-block staff keep serving anyone still waiting and leave when no one is waiting for them; overrun and after-closing time are paid at the same hourly rate). The $20/customer-hour waiting value is hypothetical; break-even values do not depend on it.");
writeFileSync(resolve(root, "docs/validation/daypart-demo.txt"), lines.join("\n") + "\n");
