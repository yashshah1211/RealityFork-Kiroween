import type { ModelDefinition, RunSettings } from "../model";
import { validateParams, validateSettings } from "../model";
import { getModel } from "../registry";
import { runReplications } from "../runner";
import { describeRuntime } from "../runtime";
import { canonicalHash, canonicalStringify } from "../serialize/canonical";
import { fnv1a32 } from "../rng";
import { deepFreeze } from "../util/freeze";
import { ENGINE_VERSION, RNG_VERSION } from "../version";
import {
  SCENARIO_SCHEMA,
  ScenarioError,
  type Change,
  type ReproductionReport,
  type Scenario,
  type ScenarioEdits,
  type ScenarioResult,
  type ScenarioSpec,
} from "./types";

export type IdGenerator = () => string;

/** Default ids: "sc_" + 12 random hex characters from crypto.getRandomValues. */
export const randomId: IdGenerator = () => {
  const g = globalThis as unknown as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } };
  if (!g.crypto?.getRandomValues) throw new Error("crypto.getRandomValues is required for random ids");
  const bytes = g.crypto.getRandomValues(new Uint8Array(6));
  return "sc_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export function fingerprintSpec(spec: ScenarioSpec): Promise<string> {
  return canonicalHash({ schema: SCENARIO_SCHEMA, spec });
}

export function computeResultHash(fingerprint: string, r: Omit<ScenarioResult, "resultHash" | "runtime">): Promise<string> {
  return canonicalHash({
    fingerprint,
    modelId: r.modelId,
    modelVersion: r.modelVersion,
    engineVersion: r.engineVersion,
    rngVersion: r.rngVersion,
    perReplication: r.perReplication,
    summary: r.summary,
  });
}

export function modelFor(spec: ScenarioSpec): ModelDefinition {
  return getModel(spec.modelId, spec.modelVersion) as ModelDefinition;
}

export function validateSpec(spec: ScenarioSpec): void {
  const model = modelFor(spec);
  validateParams(model, spec.params as Record<string, number>);
  validateSettings(spec.settings);
  if (!Number.isInteger(spec.masterSeed) || spec.masterSeed < 0 || spec.masterSeed > 0xffffffff) {
    throw new ScenarioError(`masterSeed must be an integer in [0, 2^32)`);
  }
  if (!Number.isInteger(spec.replications) || spec.replications < 2) throw new ScenarioError("replications must be an integer >= 2");
  if (!(spec.confidence > 0 && spec.confidence < 1)) throw new ScenarioError("confidence must be in (0, 1)");
}

const SETTING_LABELS: Record<string, string> = { warmup: "Warm-up period", horizon: "Run length (horizon)" };

function labelFor(model: ModelDefinition, path: string): { label: string; unit: string } {
  if (path.startsWith("params.")) {
    const spec = model.parameters[path.slice(7)];
    return spec ? { label: spec.label, unit: spec.unit } : { label: path, unit: "" };
  }
  if (path.startsWith("settings.")) return { label: SETTING_LABELS[path.slice(9)] ?? path, unit: "model time units" };
  if (path === "masterSeed") return { label: "Random seed", unit: "" };
  if (path === "replications") return { label: "Replications", unit: "runs" };
  if (path === "confidence") return { label: "Confidence level", unit: "fraction" };
  if (path === "dataProvenance") return { label: "Dataset", unit: "" };
  return { label: path, unit: "" };
}

export function provenanceLabel(p: NonNullable<ScenarioSpec["dataProvenance"]>): string {
  const name = typeof p.fileName === "string" ? p.fileName : "dataset";
  const synthetic = p.synthetic === true ? "SYNTHETIC " : "";
  return `${synthetic}${name} [record ${fnv1a32(canonicalStringify(p)).toString(16).padStart(8, "0")}]`;
}

/** Flatten the comparable assumptions of a spec into path → value. */
export function flattenSpec(spec: ScenarioSpec): Map<string, number | string | null> {
  const m = new Map<string, number | string | null>();
  for (const k of Object.keys(spec.params).sort()) m.set(`params.${k}`, spec.params[k]!);
  m.set("settings.warmup", spec.settings.warmup);
  m.set("settings.horizon", spec.settings.horizon);
  m.set("masterSeed", spec.masterSeed);
  m.set("replications", spec.replications);
  m.set("confidence", spec.confidence);
  // Short, human-readable label; the checksum over the canonical record still detects any difference.
  m.set("dataProvenance", spec.dataProvenance ? provenanceLabel(spec.dataProvenance) : null);
  return m;
}

/** All assumption differences between two specs of the same model, in a stable order. */
export function diffSpecs(a: ScenarioSpec, b: ScenarioSpec): Change[] {
  const model = modelFor(b);
  const fa = flattenSpec(a);
  const fb = flattenSpec(b);
  const out: Change[] = [];
  for (const [path, to] of fb) {
    const from = fa.has(path) ? fa.get(path)! : null;
    if (!Object.is(from, to)) out.push({ path, ...labelFor(model, path), from, to });
  }
  return out;
}

function applyEdits(spec: ScenarioSpec, edits: ScenarioEdits): ScenarioSpec {
  const model = modelFor(spec);
  for (const k of Object.keys(edits.params ?? {})) {
    if (!(k in model.parameters)) throw new ScenarioError(`unknown parameter "${k}" for ${spec.modelId}@${spec.modelVersion}`);
  }
  const settings: RunSettings = {
    warmup: edits.settings?.warmup ?? spec.settings.warmup,
    horizon: edits.settings?.horizon ?? spec.settings.horizon,
  };
  return {
    modelId: spec.modelId,
    modelVersion: spec.modelVersion,
    params: { ...spec.params, ...(edits.params ?? {}) },
    settings,
    masterSeed: edits.masterSeed ?? spec.masterSeed,
    replications: edits.replications ?? spec.replications,
    confidence: edits.confidence ?? spec.confidence,
    dataProvenance: edits.dataProvenance === undefined ? spec.dataProvenance : edits.dataProvenance === null ? null : { ...edits.dataProvenance },
  };
}

export interface CreateBaselineInput {
  readonly name: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly params?: Readonly<Record<string, number>>;
  readonly settings: RunSettings;
  readonly masterSeed: number;
  readonly replications: number;
  readonly confidence?: number;
  readonly dataProvenance?: DataProvenanceInput;
  readonly id?: string;
}
type DataProvenanceInput = ScenarioSpec["dataProvenance"];

async function build(fields: Omit<Scenario, "schema" | "fingerprint">): Promise<Scenario> {
  validateSpec(fields.spec);
  const fingerprint = await fingerprintSpec(fields.spec);
  return deepFreeze({ schema: SCENARIO_SCHEMA, ...fields, fingerprint });
}

export async function createBaseline(input: CreateBaselineInput, idGenerator: IdGenerator = randomId): Promise<Scenario> {
  const model = getModel(input.modelId, input.modelVersion) as ModelDefinition;
  const spec: ScenarioSpec = {
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    params: { ...model.defaults, ...(input.params ?? {}) },
    settings: { warmup: input.settings.warmup, horizon: input.settings.horizon },
    masterSeed: input.masterSeed,
    replications: input.replications,
    confidence: input.confidence ?? 0.95,
    dataProvenance: input.dataProvenance ? { ...input.dataProvenance } : null,
  };
  return build({
    id: input.id ?? idGenerator(),
    name: input.name,
    parentId: null,
    parentFingerprint: null,
    changesFromParent: [],
    spec,
    status: "draft",
    result: null,
  });
}

/** Create a new draft branch. The parent (draft or completed) is never modified. */
export async function fork(
  parent: Scenario,
  options: { readonly name: string; readonly id?: string } & ScenarioEdits,
  idGenerator: IdGenerator = randomId,
): Promise<Scenario> {
  const spec = applyEdits(parent.spec, options);
  return build({
    id: options.id ?? idGenerator(),
    name: options.name,
    parentId: parent.id,
    parentFingerprint: parent.fingerprint,
    changesFromParent: diffSpecs(parent.spec, spec),
    spec,
    status: "draft",
    result: null,
  });
}

/**
 * Edit a draft. Returns a new object with the same id and a new fingerprint.
 * Completed scenarios are locked: fork them instead.
 */
export async function editDraft(scenario: Scenario, edits: ScenarioEdits): Promise<Scenario> {
  if (scenario.status !== "draft") {
    throw new ScenarioError(`scenario "${scenario.id}" has completed results and is locked; fork it to change assumptions`);
  }
  const spec = applyEdits(scenario.spec, edits);
  // Recover the parent's value for each path from existing changes, so the diff stays relative to the parent.
  let changes: Change[] = [];
  if (scenario.parentId !== null) {
    const parentValues = flattenSpec(scenario.spec);
    for (const c of scenario.changesFromParent) parentValues.set(c.path, c.from);
    const model = modelFor(spec);
    changes = [];
    for (const [path, to] of flattenSpec(spec)) {
      const from = parentValues.has(path) ? parentValues.get(path)! : null;
      if (!Object.is(from, to)) changes.push({ path, ...labelFor(model, path), from, to });
    }
  }
  return build({ ...scenario, spec, changesFromParent: changes });
}

/** Run a draft. Returns a new, locked scenario with the same id and fingerprint. */
export async function runScenario(scenario: Scenario): Promise<Scenario> {
  if (scenario.status !== "draft") throw new ScenarioError(`scenario "${scenario.id}" already has results and is locked`);
  const result = await executeSpec(scenario.spec, scenario.fingerprint);
  return deepFreeze({ ...scenario, status: "completed" as const, result });
}

async function executeSpec(spec: ScenarioSpec, fingerprint: string): Promise<ScenarioResult> {
  validateSpec(spec);
  const model = modelFor(spec);
  const r = runReplications(model, { ...spec.params }, spec.settings, spec.masterSeed, spec.replications, spec.confidence);
  const body = {
    modelId: model.id,
    modelVersion: model.version,
    engineVersion: ENGINE_VERSION,
    rngVersion: RNG_VERSION,
    perReplication: r.perReplication.map((m) => ({ ...m })),
    summary: { ...r.summary },
  };
  return { ...body, resultHash: await computeResultHash(fingerprint, body), runtime: describeRuntime() };
}

/** Check stored hashes without re-running. */
export async function verifyIntegrity(s: Scenario): Promise<{ fingerprintValid: boolean; resultHashValid: boolean | null }> {
  const fingerprintValid = (await fingerprintSpec(s.spec)) === s.fingerprint;
  const resultHashValid = s.result ? (await computeResultHash(s.fingerprint, s.result)) === s.result.resultHash : null;
  return { fingerprintValid, resultHashValid };
}

/**
 * Re-run a completed scenario and compare. "identical" requires valid hashes, equal model, engine and
 * RNG versions, and an equal result hash. A version mismatch is never reported as identical.
 */
export async function reproduce(s: Scenario): Promise<ReproductionReport> {
  const runtime = describeRuntime();
  let currentModelVersion: string | null = null;
  try {
    currentModelVersion = modelFor(s.spec).version;
  } catch {
    currentModelVersion = null;
  }
  const current = { modelVersion: currentModelVersion, engineVersion: ENGINE_VERSION, rngVersion: RNG_VERSION, runtime };
  const integrity = await verifyIntegrity(s);
  const base = { scenarioId: s.id, fingerprint: s.fingerprint, current };
  if (!s.result) {
    return { ...base, status: "not-run", checks: { ...integrity, versionsMatch: null }, recorded: null, reproducedResultHash: null, numericallyIdentical: null, differences: [], notes: ["Scenario has no results to reproduce."] };
  }
  const rec = s.result;
  const recorded = { modelVersion: rec.modelVersion, engineVersion: rec.engineVersion, rngVersion: rec.rngVersion, resultHash: rec.resultHash, runtime: rec.runtime };
  const notes: string[] = [];
  const versionsMatch =
    currentModelVersion === rec.modelVersion && rec.modelVersion === s.spec.modelVersion && rec.engineVersion === ENGINE_VERSION && rec.rngVersion === RNG_VERSION;
  if (!versionsMatch) {
    notes.push(
      `Version mismatch: recorded model ${rec.modelVersion}, engine ${rec.engineVersion}, RNG ${rec.rngVersion}; ` +
        `current model ${currentModelVersion ?? "not registered"}, engine ${ENGINE_VERSION}, RNG ${RNG_VERSION}. A verified replay is not possible.`,
    );
  }
  if (!integrity.fingerprintValid) notes.push("Stored fingerprint does not match the stored assumptions (modified after creation).");
  if (integrity.resultHashValid === false) notes.push("Stored result hash does not match the stored results (modified after the run).");

  let reproducedResultHash: string | null = null;
  let numericallyIdentical: boolean | null = null;
  const differences: { path: string; recorded: number; reproduced: number }[] = [];
  if (currentModelVersion === s.spec.modelVersion) {
    const again = await executeSpec(s.spec, s.fingerprint);
    reproducedResultHash = again.resultHash;
    numericallyIdentical = true;
    again.perReplication.forEach((m, i) => {
      const r = rec.perReplication[i] ?? {};
      for (const k of Object.keys(m)) {
        if (!Object.is(m[k], r[k])) {
          numericallyIdentical = false;
          if (differences.length < 20) differences.push({ path: `perReplication[${i}].${k}`, recorded: r[k] ?? Number.NaN, reproduced: m[k]! });
        }
      }
    });
    if (again.perReplication.length !== rec.perReplication.length) numericallyIdentical = false;
    if (!numericallyIdentical && (runtime.name !== rec.runtime.name || runtime.version !== rec.runtime.version)) {
      notes.push(`Different runtime (${rec.runtime.name} ${rec.runtime.version} → ${runtime.name} ${runtime.version}); floating-point math functions may differ in the last bits.`);
    }
  } else {
    notes.push("Model version is not registered in this build, so the scenario was not re-run.");
  }

  let status: ReproductionReport["status"];
  if (!integrity.fingerprintValid || integrity.resultHashValid === false) status = "invalid";
  else if (!versionsMatch) status = "version-mismatch";
  else status = reproducedResultHash === rec.resultHash ? "identical" : "different";

  return deepFreeze({
    ...base,
    status,
    checks: { ...integrity, versionsMatch },
    recorded,
    reproducedResultHash,
    numericallyIdentical,
    differences,
    notes,
  });
}
