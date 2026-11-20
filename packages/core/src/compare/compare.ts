import type { ModelDefinition } from "../model";
import { diffSpecs, fork, modelFor, runScenario } from "../scenario/scenario";
import { ScenarioError, type Scenario } from "../scenario/types";
import { pairedDifference, pairingEffect, welchDifference, type DifferenceSummary } from "../stats/difference";
import { deepFreeze } from "../util/freeze";
import { explainComparison } from "./explain";
import { computeTradeoff } from "./tradeoff";
import type {
  DifferenceConclusion,
  MetricSensitivity,
  OutcomeComparison,
  ParameterEffect,
  ScenarioComparison,
  SensitivityAnalysis,
  SensitivityRunRef,
} from "./types";

export interface CompareOptions {
  /** Run one-at-a-time sensitivity experiments (default true). */
  readonly sensitivity?: boolean;
  /** Maximum number of changed parameters to decompose (default 5). */
  readonly maxSensitivityParameters?: number;
  /** Confidence level for every interval (default: the baseline's). */
  readonly confidence?: number;
}

/** Relative tolerance for treating an interaction residual as floating-point rounding (64 ulp-scale). */
export const ROUNDING_TOLERANCE = 64 * Number.EPSILON;

export function classifyDifference(d: DifferenceSummary): DifferenceConclusion {
  if (d.nonFinite > 0 || !Number.isFinite(d.mean) || !Number.isFinite(d.ciLow) || !Number.isFinite(d.ciHigh)) return "not-computable";
  if (d.allZero) return "identical-in-every-replication";
  if (d.ciLow > 0) return "variant-higher";
  if (d.ciHigh < 0) return "variant-lower";
  return "inconclusive";
}

const metricValues = (s: Scenario, key: string) => s.result!.perReplication.map((m) => m[key]!);

function requireCompleted(s: Scenario, role: string): asserts s is Scenario & { result: NonNullable<Scenario["result"]> } {
  if (s.status !== "completed" || !s.result) throw new ScenarioError(`${role} "${s.id}" has not been run`);
}

export async function compareScenarios(baseline: Scenario, variant: Scenario, options: CompareOptions = {}): Promise<ScenarioComparison> {
  requireCompleted(baseline, "baseline");
  requireCompleted(variant, "variant");
  const issues: string[] = [];
  if (baseline.spec.modelId !== variant.spec.modelId || baseline.spec.modelVersion !== variant.spec.modelVersion)
    issues.push(`different models: ${baseline.spec.modelId}@${baseline.spec.modelVersion} vs ${variant.spec.modelId}@${variant.spec.modelVersion}`);
  if (baseline.result.engineVersion !== variant.result.engineVersion || baseline.result.rngVersion !== variant.result.rngVersion)
    issues.push("results were produced by different engine or RNG versions");
  if (issues.length) throw new ScenarioError("scenarios are not comparable", issues);

  const model = modelFor(baseline.spec) as ModelDefinition;
  const confidence = options.confidence ?? baseline.spec.confidence;
  const assumptions = diffSpecs(baseline.spec, variant.spec);
  const paired = baseline.spec.masterSeed === variant.spec.masterSeed && baseline.spec.replications === variant.spec.replications;
  const pairing = paired
    ? {
        mode: "paired" as const,
        reason: `Same seed (${baseline.spec.masterSeed}) and replication count: replication r uses the same random arrival and service streams in both scenarios.`,
        replications: baseline.spec.replications,
      }
    : {
        mode: "independent" as const,
        reason: "Different seeds or replication counts, so replications are not matched; using Welch's two-sample interval.",
        replications: Math.min(baseline.spec.replications, variant.spec.replications),
      };

  const outcomes: OutcomeComparison[] = Object.entries(model.metrics).map(([key, spec]) => {
    const a = metricValues(baseline, key);
    const b = metricValues(variant, key);
    const difference = paired ? pairedDifference(a, b, confidence) : welchDifference(a, b, confidence);
    const conclusion = classifyDifference(difference);
    const baselineMean = baseline.result!.summary[key]!.mean;
    const variantMean = variant.result!.summary[key]!.mean;
    const directDifference = variantMean - baselineMean;
    const direction =
      spec.lowerIsBetter === null || (conclusion !== "variant-higher" && conclusion !== "variant-lower")
        ? null
        : (conclusion === "variant-lower") === spec.lowerIsBetter
          ? "better"
          : "worse";
    return {
      metric: key,
      label: spec.label,
      unit: spec.unit,
      lowerIsBetter: spec.lowerIsBetter,
      baselineMean,
      variantMean,
      directDifference,
      relativeChange: Number.isFinite(baselineMean) && baselineMean !== 0 && Number.isFinite(directDifference) ? directDifference / Math.abs(baselineMean) : null,
      difference,
      conclusion,
      direction,
      pairing: paired && difference.nonFinite === 0 ? pairingEffect(a, b) : null,
    };
  });

  const sensitivity = await sensitivityAnalysis(baseline, variant, model, assumptions, paired, confidence, options);
  const tradeoff = computeTradeoff(baseline, variant, model, paired, confidence);

  const cmp: Omit<ScenarioComparison, "statements" | "disclaimer"> = {
    baseline: { id: baseline.id, name: baseline.name, fingerprint: baseline.fingerprint, resultHash: baseline.result.resultHash },
    variant: { id: variant.id, name: variant.name, fingerprint: variant.fingerprint, resultHash: variant.result.resultHash },
    model: { id: model.id, version: model.version },
    confidence,
    pairing,
    assumptions,
    outcomes,
    sensitivity,
    tradeoff,
  };
  const { statements, disclaimer } = explainComparison(cmp);
  return deepFreeze({ ...cmp, statements, disclaimer });
}

async function sensitivityAnalysis(
  baseline: Scenario,
  variant: Scenario,
  model: ModelDefinition,
  assumptions: ReturnType<typeof diffSpecs>,
  paired: boolean,
  confidence: number,
  options: CompareOptions,
): Promise<SensitivityAnalysis> {
  if (options.sensitivity === false) return { available: false, reason: "Sensitivity analysis was not requested." };
  if (!paired) return { available: false, reason: "One-at-a-time effects need matched replications (same seed and replication count)." };
  const nonParam = assumptions.filter((c) => !c.path.startsWith("params."));
  if (nonParam.length) {
    return { available: false, reason: `Only parameter changes can be decomposed; these also differ: ${nonParam.map((c) => c.label).join(", ")}.` };
  }
  const changed = assumptions.filter((c) => c.path.startsWith("params."));
  const max = options.maxSensitivityParameters ?? 5;
  if (changed.length === 0) return { available: false, reason: "No parameters differ." };
  if (changed.length > max) return { available: false, reason: `${changed.length} parameters differ; the limit for one-at-a-time analysis is ${max}.` };

  // One-at-a-time runs: baseline with exactly one parameter set to the variant value, same seed/settings.
  const runs: SensitivityRunRef[] = [];
  const oat = new Map<string, Scenario>();
  if (changed.length === 1) {
    oat.set(changed[0]!.path, variant);
  } else {
    for (const c of changed) {
      const key = c.path.slice("params.".length);
      const draft = await fork(baseline, {
        name: `sensitivity: only ${c.label} (${baseline.name} → ${variant.name})`,
        id: `${baseline.id}~oat~${key}~${variant.fingerprint.slice(0, 8)}`,
        params: { [key]: c.to as number },
      });
      const done = await runScenario(draft);
      oat.set(c.path, done);
      runs.push({ path: c.path, scenarioId: done.id, fingerprint: done.fingerprint, resultHash: done.result!.resultHash });
    }
  }

  const perMetric: MetricSensitivity[] = Object.entries(model.metrics).map(([key, spec]) => {
    const base = metricValues(baseline, key);
    const comb = metricValues(variant, key);
    const effects: ParameterEffect[] = changed.map((c) => {
      const e = pairedDifference(base, metricValues(oat.get(c.path)!, key), confidence);
      return { path: c.path, label: c.label, unit: c.unit, from: c.from as number, to: c.to as number, effect: e, conclusion: classifyDifference(e) };
    });
    // Per-replication residual: (V − B) − Σ_k (OAT_k − B).
    const zero = base.map(() => 0);
    const sumEffects = changed.reduce((acc, c) => {
      const o = metricValues(oat.get(c.path)!, key);
      return acc.map((v, i) => v + (o[i]! - base[i]!));
    }, zero);
    // Residuals no larger than accumulated floating-point rounding are set to exactly 0, so an
    // exactly additive model is not reported as "non-additive" because of 1e-14 noise.
    const residualVariant = comb.map((v, i) => {
      const r = v - base[i]! - sumEffects[i]!;
      const scale = Math.abs(v) + Math.abs(base[i]!) + changed.reduce((s, c) => s + Math.abs(metricValues(oat.get(c.path)!, key)[i]!), 0);
      return Math.abs(r) <= ROUNDING_TOLERANCE * scale ? 0 : r;
    });
    const interaction = pairedDifference(zero, residualVariant, confidence);
    const combined = pairedDifference(base, comb, confidence);
    const decompositionError = Math.abs(combined.mean - (effects.reduce((s, e) => s + e.effect.mean, 0) + interaction.mean));
    const ranking = [...effects]
      .filter((e) => Number.isFinite(e.effect.mean))
      .sort((x, y) => Math.abs(y.effect.mean) - Math.abs(x.effect.mean))
      .map((e) => e.path);
    // With a single changed parameter the residual is identically zero by construction.
    return {
      metric: key,
      label: spec.label,
      unit: spec.unit,
      combined,
      effects,
      interaction,
      interactionConclusion: classifyDifference(interaction),
      decompositionError,
      ranking,
    };
  });

  return { available: true, method: "one-at-a-time-matched", parameters: changed.map((c) => c.path), runs, perMetric };
}
