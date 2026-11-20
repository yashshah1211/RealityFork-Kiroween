import type { Change } from "../scenario/types";
import type { DifferenceSummary, PairingEffect } from "../stats/difference";
import type { CostTradeoff } from "./tradeoff";

/** How to read a difference. Never "no effect": an interval containing 0 is inconclusive. */
export type DifferenceConclusion =
  | "variant-higher"
  | "variant-lower"
  | "inconclusive"
  | "identical-in-every-replication"
  | "not-computable";

export interface ScenarioRef {
  readonly id: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly resultHash: string;
}

export interface OutcomeComparison {
  readonly metric: string;
  readonly label: string;
  readonly unit: string;
  readonly lowerIsBetter: boolean | null;
  readonly baselineMean: number;
  readonly variantMean: number;
  /** Direct calculation: variantMean − baselineMean. */
  readonly directDifference: number;
  /** Relative change vs baseline, or null if baseline mean is 0 or non-finite. */
  readonly relativeChange: number | null;
  /** Statistical uncertainty of the difference. */
  readonly difference: DifferenceSummary;
  readonly conclusion: DifferenceConclusion;
  /** Desirability, only when the CI excludes 0 and the metric has a preferred direction. */
  readonly direction: "better" | "worse" | null;
  /** Measured effect of matched random inputs on variance (paired comparisons only). */
  readonly pairing: PairingEffect | null;
}

export interface ParameterEffect {
  readonly path: string;
  readonly label: string;
  readonly unit: string;
  readonly from: number;
  readonly to: number;
  /** Model-estimated effect of changing only this parameter, others held at baseline. */
  readonly effect: DifferenceSummary;
  readonly conclusion: DifferenceConclusion;
}

export interface MetricSensitivity {
  readonly metric: string;
  readonly label: string;
  readonly unit: string;
  /** Combined effect of all changes (variant − baseline), per replication. */
  readonly combined: DifferenceSummary;
  readonly effects: readonly ParameterEffect[];
  /** combined − Σ one-at-a-time effects, per replication. */
  readonly interaction: DifferenceSummary;
  readonly interactionConclusion: DifferenceConclusion;
  /** |mean(combined) − (Σ mean(effects) + mean(interaction))|; should be ~0 (floating point). */
  readonly decompositionError: number;
  /** Parameter paths ordered by |mean effect|, largest first. Not a causal ranking. */
  readonly ranking: readonly string[];
}

export interface SensitivityRunRef {
  readonly path: string;
  readonly scenarioId: string;
  readonly fingerprint: string;
  readonly resultHash: string;
}

export type SensitivityAnalysis =
  | {
      readonly available: true;
      readonly method: "one-at-a-time-matched";
      readonly parameters: readonly string[];
      readonly runs: readonly SensitivityRunRef[];
      readonly perMetric: readonly MetricSensitivity[];
    }
  | { readonly available: false; readonly reason: string };

export type StatementKind = "assumption" | "direct" | "uncertainty" | "model-effect" | "interaction" | "pairing" | "tradeoff" | "caveat";

/** Template text filled with computed values. `metric` is set for per-metric statements. */
export interface Statement {
  readonly kind: StatementKind;
  readonly metric: string | null;
  readonly text: string;
}

export interface ScenarioComparison {
  readonly baseline: ScenarioRef;
  readonly variant: ScenarioRef;
  readonly model: { readonly id: string; readonly version: string };
  readonly confidence: number;
  readonly pairing: { readonly mode: "paired" | "independent"; readonly reason: string; readonly replications: number };
  readonly assumptions: readonly Change[];
  readonly outcomes: readonly OutcomeComparison[];
  readonly sensitivity: SensitivityAnalysis;
  /** Staffing-versus-waiting trade-off, when the model declares a decision mapping. */
  readonly tradeoff: CostTradeoff | null;
  readonly statements: readonly Statement[];
  readonly disclaimer: string;
}
