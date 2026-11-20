/**
 * Export / import of scenario bundles. Import validates structure, the model schema,
 * fingerprints, result hashes and lineage before returning anything.
 *
 * Hashes detect accidental or naive modification. They are not signatures: anyone can
 * edit a file and recompute them.
 */
import { decodeJson, encodeJson, type JsonValue } from "../serialize/canonical";
import { deepFreeze } from "../util/freeze";
import { ENGINE_VERSION, RNG_VERSION } from "../version";
import { computeResultHash, fingerprintSpec, modelFor, validateSpec } from "./scenario";
import { BUNDLE_SCHEMA, SCENARIO_SCHEMA, ScenarioError, type Scenario } from "./types";

export function exportBundle(scenarios: readonly Scenario[]): string {
  return JSON.stringify(
    encodeJson({ schema: BUNDLE_SCHEMA, exportedWith: { engineVersion: ENGINE_VERSION, rngVersion: RNG_VERSION }, scenarios }),
    null,
    2,
  );
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number";
const isStr = (v: unknown): v is string => typeof v === "string";

function checkKeys(o: Record<string, unknown>, required: string[], where: string, issues: string[]) {
  for (const k of required) if (!(k in o)) issues.push(`${where}: missing "${k}"`);
  for (const k of Object.keys(o)) if (!required.includes(k)) issues.push(`${where}: unexpected field "${k}"`);
}

function structuralIssues(s: unknown, i: number): string[] {
  const issues: string[] = [];
  const w = `scenarios[${i}]`;
  if (!isObj(s)) return [`${w}: not an object`];
  checkKeys(s, ["schema", "id", "name", "parentId", "parentFingerprint", "changesFromParent", "spec", "fingerprint", "status", "result"], w, issues);
  if (s.schema !== SCENARIO_SCHEMA) issues.push(`${w}: unsupported schema ${JSON.stringify(s.schema)} (expected ${SCENARIO_SCHEMA})`);
  if (!isStr(s.id) || s.id.length === 0) issues.push(`${w}: id must be a non-empty string`);
  if (!isStr(s.name)) issues.push(`${w}: name must be a string`);
  if (!(s.parentId === null || isStr(s.parentId))) issues.push(`${w}: parentId must be a string or null`);
  if (!(s.parentFingerprint === null || isStr(s.parentFingerprint))) issues.push(`${w}: parentFingerprint must be a string or null`);
  if ((s.parentId === null) !== (s.parentFingerprint === null)) issues.push(`${w}: parentId and parentFingerprint must both be set or both be null`);
  if (!isStr(s.fingerprint) || !/^[0-9a-f]{64}$/.test(s.fingerprint)) issues.push(`${w}: fingerprint must be a SHA-256 hex string`);
  if (s.status !== "draft" && s.status !== "completed") issues.push(`${w}: status must be "draft" or "completed"`);
  if (!Array.isArray(s.changesFromParent)) issues.push(`${w}: changesFromParent must be an array`);
  else
    s.changesFromParent.forEach((c, j) => {
      if (!isObj(c) || !isStr(c.path) || !isStr(c.label) || !isStr(c.unit)) issues.push(`${w}.changesFromParent[${j}]: malformed`);
    });
  const sp = s.spec;
  if (!isObj(sp)) issues.push(`${w}: spec must be an object`);
  else {
    checkKeys(sp, ["modelId", "modelVersion", "params", "settings", "masterSeed", "replications", "confidence", "dataProvenance"], `${w}.spec`, issues);
    if (!isStr(sp.modelId) || !isStr(sp.modelVersion)) issues.push(`${w}.spec: modelId/modelVersion must be strings`);
    if (!isObj(sp.params) || !Object.values(sp.params).every(isNum)) issues.push(`${w}.spec.params: must map names to numbers`);
    if (!isObj(sp.settings) || !isNum(sp.settings.warmup) || !isNum(sp.settings.horizon)) issues.push(`${w}.spec.settings: warmup/horizon must be numbers`);
    if (!isNum(sp.masterSeed) || !isNum(sp.replications) || !isNum(sp.confidence)) issues.push(`${w}.spec: masterSeed/replications/confidence must be numbers`);
    if (!(sp.dataProvenance === null || (isObj(sp.dataProvenance) && Object.values(sp.dataProvenance).every((v) => ["string", "number", "boolean"].includes(typeof v)))))
      issues.push(`${w}.spec.dataProvenance: must be null or a flat record`);
  }
  if (s.status === "draft" && s.result !== null) issues.push(`${w}: a draft must not carry results`);
  if (s.status === "completed") {
    const r = s.result;
    if (!isObj(r)) issues.push(`${w}: a completed scenario needs results`);
    else {
      checkKeys(r, ["modelId", "modelVersion", "engineVersion", "rngVersion", "perReplication", "summary", "resultHash", "runtime"], `${w}.result`, issues);
      if (!Array.isArray(r.perReplication) || !r.perReplication.every((m) => isObj(m) && Object.values(m).every(isNum)))
        issues.push(`${w}.result.perReplication: must be an array of numeric records`);
      if (!isObj(r.summary)) issues.push(`${w}.result.summary: must be an object`);
      if (!isStr(r.resultHash) || !/^[0-9a-f]{64}$/.test(r.resultHash)) issues.push(`${w}.result.resultHash: must be a SHA-256 hex string`);
      if (!isObj(r.runtime) || !isStr(r.runtime.name) || !isStr(r.runtime.version)) issues.push(`${w}.result.runtime: malformed`);
    }
  }
  return issues;
}

export interface ImportResult {
  readonly scenarios: readonly Scenario[];
  readonly warnings: readonly string[];
}

export async function importBundle(text: string): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = decodeJson(JSON.parse(text) as JsonValue);
  } catch (e) {
    throw new ScenarioError("import rejected: not valid bundle JSON", [String((e as Error).message)]);
  }
  if (!isObj(raw)) throw new ScenarioError("import rejected", ["bundle must be an object"]);
  if (raw.schema !== BUNDLE_SCHEMA) throw new ScenarioError("import rejected", [`unsupported bundle schema ${JSON.stringify(raw.schema)}`]);
  if (!Array.isArray(raw.scenarios)) throw new ScenarioError("import rejected", ["scenarios must be an array"]);

  const issues: string[] = [];
  const warnings: string[] = [];
  raw.scenarios.forEach((s, i) => issues.push(...structuralIssues(s, i)));
  if (issues.length) throw new ScenarioError("import rejected", issues);

  const scenarios = raw.scenarios as Scenario[];
  const ids = new Set<string>();
  for (const [i, s] of scenarios.entries()) {
    const w = `scenarios[${i}] "${s.id}"`;
    if (ids.has(s.id)) issues.push(`${w}: duplicate id`);
    ids.add(s.id);
    try {
      validateSpec(s.spec);
    } catch (e) {
      issues.push(`${w}: ${(e as Error).message}`);
      continue;
    }
    if ((await fingerprintSpec(s.spec)) !== s.fingerprint) issues.push(`${w}: fingerprint does not match its assumptions (file was modified)`);
    if (s.result) {
      const r = s.result;
      const model = modelFor(s.spec);
      if (r.modelId !== s.spec.modelId || r.modelVersion !== s.spec.modelVersion) issues.push(`${w}: result model does not match spec model`);
      if (r.perReplication.length !== s.spec.replications) issues.push(`${w}: expected ${s.spec.replications} replications, found ${r.perReplication.length}`);
      const metricKeys = Object.keys(model.metrics).sort().join(",");
      if (!r.perReplication.every((m) => Object.keys(m).sort().join(",") === metricKeys)) issues.push(`${w}: replication metrics do not match the model's metric schema`);
      if (Object.keys(r.summary).sort().join(",") !== metricKeys) issues.push(`${w}: summary metrics do not match the model's metric schema`);
      if ((await computeResultHash(s.fingerprint, r)) !== r.resultHash) issues.push(`${w}: result hash does not match its results (file was modified)`);
      if (r.engineVersion !== ENGINE_VERSION || r.rngVersion !== RNG_VERSION) {
        warnings.push(`${w}: produced with engine ${r.engineVersion} / RNG ${r.rngVersion}; current is ${ENGINE_VERSION} / ${RNG_VERSION}. Results are kept as a record, but reproduction will report a version mismatch.`);
      }
    }
  }
  // Lineage: parents present, no cycles, locked parents unchanged since the fork.
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  for (const s of scenarios) {
    if (s.parentId === null) continue;
    const p = byId.get(s.parentId);
    if (!p) {
      warnings.push(`"${s.id}": parent "${s.parentId}" is not in this bundle`);
      continue;
    }
    if (p.status === "completed" && p.fingerprint !== s.parentFingerprint) issues.push(`"${s.id}": parent "${p.id}" is locked but its fingerprint differs from the one recorded at fork time`);
    const seen = new Set<string>([s.id]);
    let cur: Scenario | undefined = p;
    while (cur) {
      if (seen.has(cur.id)) {
        issues.push(`"${s.id}": lineage cycle through "${cur.id}"`);
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  if (issues.length) throw new ScenarioError("import rejected", issues);
  return { scenarios: scenarios.map((s) => deepFreeze(s)), warnings };
}
