import type { RunSettings } from "../model";
import type { RuntimeInfo } from "../runtime";
import type { Summary } from "../stats/summary";

export const SCENARIO_SCHEMA = "realityfork.scenario/1";
export const BUNDLE_SCHEMA = "realityfork.bundle/1";

/** Optional description of the dataset that informed a scenario (filled from Task 6). */
export type DataProvenance = Readonly<Record<string, string | number | boolean>>;

/** Everything that determines a run's numerical output. Its hash is the input fingerprint. */
export interface ScenarioSpec {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly params: Readonly<Record<string, number>>;
  readonly settings: RunSettings;
  readonly masterSeed: number;
  readonly replications: number;
  readonly confidence: number;
  readonly dataProvenance: DataProvenance | null;
}

/** One assumption that differs from the parent at fork time (or after a draft edit). */
export interface Change {
  /** e.g. "params.servers", "settings.horizon", "masterSeed", "dataProvenance". */
  readonly path: string;
  readonly label: string;
  readonly unit: string;
  readonly from: number | string | null;
  readonly to: number | string | null;
}

export interface ScenarioResult {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly engineVersion: string;
  readonly rngVersion: string;
  readonly perReplication: readonly Readonly<Record<string, number>>[];
  readonly summary: Readonly<Record<string, Summary>>;
  /** SHA-256 over fingerprint, versions, per-replication metrics and summaries. */
  readonly resultHash: string;
  /** Informational only; excluded from every hash. */
  readonly runtime: RuntimeInfo;
}

export interface Scenario {
  readonly schema: typeof SCENARIO_SCHEMA;
  /** Identity: stable across draft edits. Two scenarios can share content but never an id. */
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  /** Parent's input fingerprint at the moment of forking. */
  readonly parentFingerprint: string | null;
  readonly changesFromParent: readonly Change[];
  readonly spec: ScenarioSpec;
  /** Content: SHA-256 of the canonical spec. Equal specs share a fingerprint. */
  readonly fingerprint: string;
  readonly status: "draft" | "completed";
  readonly result: ScenarioResult | null;
}

/** Edits a fork or draft edit may apply. */
export interface ScenarioEdits {
  readonly params?: Readonly<Record<string, number>>;
  readonly settings?: Partial<RunSettings>;
  readonly masterSeed?: number;
  readonly replications?: number;
  readonly confidence?: number;
  /** null clears provenance; undefined leaves it unchanged. */
  readonly dataProvenance?: DataProvenance | null;
}

export type ReproductionStatus = "identical" | "different" | "version-mismatch" | "not-run" | "invalid";

export interface ReproductionReport {
  readonly scenarioId: string;
  readonly fingerprint: string;
  readonly status: ReproductionStatus;
  readonly checks: {
    readonly fingerprintValid: boolean;
    readonly resultHashValid: boolean | null;
    readonly versionsMatch: boolean | null;
  };
  readonly recorded: {
    readonly modelVersion: string;
    readonly engineVersion: string;
    readonly rngVersion: string;
    readonly resultHash: string;
    readonly runtime: RuntimeInfo;
  } | null;
  readonly current: { readonly modelVersion: string | null; readonly engineVersion: string; readonly rngVersion: string; readonly runtime: RuntimeInfo };
  readonly reproducedResultHash: string | null;
  /** Whether the re-run produced numerically identical per-replication metrics (null if not re-run). */
  readonly numericallyIdentical: boolean | null;
  readonly differences: readonly { readonly path: string; readonly recorded: number; readonly reproduced: number }[];
  readonly notes: readonly string[];
}

export class ScenarioError extends Error {
  constructor(message: string, readonly issues: readonly string[] = []) {
    super(issues.length ? `${message}:\n - ${issues.join("\n - ")}` : message);
    this.name = "ScenarioError";
  }
}
