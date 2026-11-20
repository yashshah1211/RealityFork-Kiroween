/**
 * RealityFork scenario CLI. The store file is a validated scenario bundle.
 *
 *   npm run rf -- <store.json> baseline <name> [key=value ...] [--seed N] [--reps N] [--warmup W] [--horizon H]
 *   npm run rf -- <store.json> fork <parentId> <name> [key=value ...]
 *   npm run rf -- <store.json> set <draftId> key=value ...
 *   npm run rf -- <store.json> run <id|all>
 *   npm run rf -- <store.json> list
 *   npm run rf -- <store.json> compare <baselineId> <variantId> [--no-sensitivity] [--all-metrics]
 *   npm run rf -- <store.json> reproduce <id|all>
 *   npm run rf -- <store.json> export <out.json>
 *   npm run rf -- <store.json> import <in.json>     (validates, then replaces the store)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  compareScenarios,
  createBaseline,
  editDraft,
  exportBundle,
  fork,
  formatNumber,
  importBundle,
  queueModel,
  reproduce,
  runScenario,
  ScenarioError,
  ScenarioStore,
  type Scenario,
  type ScenarioComparison,
} from "@realityfork/core";

const [storePath, command, ...args] = process.argv.slice(2);

function usage(): never {
  console.error("usage: npm run rf -- <store.json> <baseline|fork|set|run|list|compare|reproduce|export|import> ...");
  process.exit(2);
}

async function load(): Promise<ScenarioStore> {
  if (!existsSync(storePath!)) return new ScenarioStore();
  const { scenarios, warnings } = await importBundle(readFileSync(storePath!, "utf8"));
  for (const w of warnings) console.warn(`warning: ${w}`);
  return new ScenarioStore(scenarios);
}
const save = (store: ScenarioStore) => writeFileSync(storePath!, exportBundle(store.all()) + "\n");

function parseAssignments(list: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of list) {
    const m = /^([A-Za-z_][\w]*)=(.+)$/.exec(a);
    if (!m) throw new ScenarioError(`expected key=value, got "${a}"`);
    const v = Number(m[2]);
    if (!Number.isFinite(v)) throw new ScenarioError(`"${m[1]}" must be a finite number`);
    out[m[1]!] = v;
  }
  return out;
}

function splitFlags(list: string[]) {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.startsWith("--")) {
      const next = list[i + 1];
      if (next !== undefined && !next.startsWith("--") && !next.includes("=") && ["--seed", "--reps", "--warmup", "--horizon"].includes(a)) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

function slugId(store: ScenarioStore, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scenario";
  let id = base;
  for (let i = 2; store.has(id); i++) id = `${base}-${i}`;
  return id;
}

const short = (h: string) => h.slice(0, 12);

function describe(s: Scenario): string {
  const changes = s.changesFromParent.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("; ");
  return `${s.id.padEnd(18)} ${s.status.padEnd(9)} fp ${short(s.fingerprint)}  ${s.result ? `result ${short(s.result.resultHash)}` : "".padEnd(19)}  "${s.name}"${s.parentId ? `  ← ${s.parentId}${changes ? ` (${changes})` : ""}` : ""}`;
}

const KEY_METRICS = ["meanWait", "avgQueueLength", "utilization", "throughputPerHour", "arrivalRateObserved", "costPerHour"];

function printComparison(c: ScenarioComparison, all: boolean) {
  const show = (m: string | null) => all || m === null || KEY_METRICS.includes(m);
  console.log(`Comparison: "${c.baseline.name}" (${c.baseline.id}) → "${c.variant.name}" (${c.variant.id})`);
  console.log(`Model ${c.model.id}@${c.model.version}; ${c.pairing.mode} replications (${c.pairing.replications}); ${c.confidence * 100}% intervals\n`);
  console.log("WHAT CHANGED (assumptions)");
  for (const a of c.assumptions) console.log(`  ${a.label.padEnd(40)} ${String(a.from).padStart(8)} → ${String(a.to).padEnd(8)} ${a.unit}`);
  console.log("\nMODELED OUTCOMES (variant − baseline)");
  console.log(`  ${"metric".padEnd(36)} ${"baseline".padStart(10)} ${"variant".padStart(10)} ${"diff".padStart(10)}  CI of difference          reading                       paired var. ratio`);
  for (const o of c.outcomes) {
    if (!show(o.metric)) continue;
    const ciText = `[${formatNumber(o.difference.ciLow)}, ${formatNumber(o.difference.ciHigh)}]`;
    const reading = o.conclusion + (o.direction ? ` (${o.direction})` : "");
    const ratio = o.pairing ? `${formatNumber(o.pairing.ratio)} (${o.pairing.varianceReduction >= 0 ? "-" : "+"}${Math.abs(o.pairing.varianceReduction * 100).toFixed(1)}% var)` : "n/a";
    console.log(`  ${o.label.padEnd(36)} ${formatNumber(o.baselineMean).padStart(10)} ${formatNumber(o.variantMean).padStart(10)} ${formatNumber(o.directDifference).padStart(10)}  ${ciText.padEnd(25)} ${reading.padEnd(29)} ${ratio}`);
  }
  const s = c.sensitivity;
  console.log("\nSENSITIVITY (one parameter at a time, matched random inputs)");
  if (!s.available) console.log(`  unavailable: ${s.reason}`);
  else {
    for (const r of s.runs) console.log(`  run ${r.scenarioId}  fp ${short(r.fingerprint)}  result ${short(r.resultHash)}`);
    for (const m of s.perMetric) {
      if (!show(m.metric)) continue;
      console.log(`  ${m.label} [${m.unit}]: combined ${formatNumber(m.combined.mean)} [${formatNumber(m.combined.ciLow)}, ${formatNumber(m.combined.ciHigh)}]`);
      for (const e of m.effects) console.log(`     only ${e.label.padEnd(36)} ${formatNumber(e.effect.mean).padStart(10)} [${formatNumber(e.effect.ciLow)}, ${formatNumber(e.effect.ciHigh)}]  ${e.conclusion}`);
      if (m.effects.length > 1)
        console.log(`     interaction residual ${"".padEnd(28)} ${formatNumber(m.interaction.mean).padStart(10)} [${formatNumber(m.interaction.ciLow)}, ${formatNumber(m.interaction.ciHigh)}]  ${m.interactionConclusion}   (decomposition error ${m.decompositionError.toExponential(1)})`);
    }
  }
  console.log("\nEXPLANATION (templates filled with computed values)");
  for (const st of c.statements) if (show(st.metric)) console.log(`  [${st.kind}] ${st.text}`);
  console.log(`\n${c.disclaimer}`);
}

async function main() {
  if (!storePath || !command) usage();
  const store = await load();
  const { flags, rest } = splitFlags(args);
  switch (command) {
    case "baseline": {
      const [name, ...assign] = rest;
      if (!name) usage();
      const s = await createBaseline({
        id: slugId(store, name),
        name,
        modelId: queueModel.id,
        modelVersion: queueModel.version,
        params: parseAssignments(assign),
        settings: { warmup: Number(flags.warmup ?? 1000), horizon: Number(flags.horizon ?? 11000) },
        masterSeed: Number(flags.seed ?? 1),
        replications: Number(flags.reps ?? 30),
      });
      store.put(s);
      save(store);
      console.log(`created ${describe(s)}`);
      break;
    }
    case "fork": {
      const [parentId, name, ...assign] = rest;
      if (!parentId || !name) usage();
      const s = await fork(store.get(parentId), { id: slugId(store, name), name, params: parseAssignments(assign) });
      store.put(s);
      save(store);
      console.log(`forked  ${describe(s)}`);
      break;
    }
    case "set": {
      const [id, ...assign] = rest;
      if (!id) usage();
      const s = await editDraft(store.get(id), { params: parseAssignments(assign) });
      store.put(s);
      save(store);
      console.log(`edited  ${describe(s)}`);
      break;
    }
    case "run": {
      const targets = rest[0] === "all" ? store.all().filter((s) => s.status === "draft") : [store.get(rest[0] ?? usage())];
      for (const t of targets) {
        const t0 = performance.now();
        const done = await runScenario(t);
        store.put(done);
        console.log(`ran     ${describe(done)}  (${(performance.now() - t0).toFixed(0)} ms)`);
      }
      save(store);
      break;
    }
    case "list":
      for (const s of store.all()) console.log(describe(s));
      break;
    case "compare": {
      const [a, b] = rest;
      if (!a || !b) usage();
      const t0 = performance.now();
      const c = await compareScenarios(store.get(a), store.get(b), { sensitivity: flags["no-sensitivity"] !== true });
      printComparison(c, flags["all-metrics"] === true);
      console.log(`\ncomparison wall-clock: ${(performance.now() - t0).toFixed(0)} ms`);
      break;
    }
    case "reproduce": {
      const targets = rest[0] === "all" ? store.all() : [store.get(rest[0] ?? usage())];
      for (const t of targets) {
        const r = await reproduce(t);
        console.log(`${t.id.padEnd(18)} ${r.status.toUpperCase().padEnd(16)} fingerprint ${r.checks.fingerprintValid ? "valid" : "INVALID"}, result hash ${r.checks.resultHashValid === null ? "n/a" : r.checks.resultHashValid ? "valid" : "INVALID"}, versions ${r.checks.versionsMatch === null ? "n/a" : r.checks.versionsMatch ? "match" : "MISMATCH"}${r.reproducedResultHash ? `, re-run ${short(r.reproducedResultHash)}` : ""}`);
        for (const d of r.differences.slice(0, 5)) console.log(`    ${d.path}: recorded ${d.recorded}, reproduced ${d.reproduced}`);
        for (const n of r.notes) console.log(`    note: ${n}`);
      }
      break;
    }
    case "export": {
      const out = rest[0] ?? usage();
      writeFileSync(out, exportBundle(store.all()) + "\n");
      console.log(`exported ${store.all().length} scenarios to ${out}`);
      break;
    }
    case "import": {
      const file = rest[0] ?? usage();
      const { scenarios, warnings } = await importBundle(readFileSync(file, "utf8"));
      for (const w of warnings) console.warn(`warning: ${w}`);
      save(new ScenarioStore(scenarios));
      console.log(`imported and validated ${scenarios.length} scenarios from ${file}`);
      break;
    }
    default:
      usage();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? `error: ${e.message}` : e);
  process.exit(1);
});
