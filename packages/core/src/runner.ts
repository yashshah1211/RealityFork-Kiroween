import type { ModelDefinition, RunSettings } from "./model";
import { validateParams, validateSettings } from "./model";
import { createStreams } from "./rng";
import { summarize, type Summary } from "./stats/summary";
import { ENGINE_VERSION, RNG_VERSION } from "./version";

export interface RunMetadata {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly engineVersion: string;
  readonly rngVersion: string;
  readonly masterSeed: number;
  readonly replications: number;
  readonly streams: readonly string[];
  readonly params: Readonly<Record<string, number>>;
  readonly settings: RunSettings;
  readonly confidence: number;
  /** Populated from Task 6 (CSV provenance). Always present so the shape is stable. */
  readonly dataProvenance: null;
}

export interface ReplicationResult<M extends Record<string, number>> {
  readonly metadata: RunMetadata;
  readonly perReplication: readonly M[];
  readonly summary: { readonly [K in keyof M]: Summary };
}

/**
 * Run `replications` independent replications. Replication r uses streams derived
 * from (masterSeed, streamName, r), so a given replication index sees the same random
 * inputs in every scenario that shares a master seed (common random numbers).
 */
export function runReplications<P extends Record<string, number>, M extends Record<string, number>>(
  model: ModelDefinition<P, M>,
  params: P,
  settings: RunSettings,
  masterSeed: number,
  replications: number,
  confidence = 0.95,
): ReplicationResult<M> {
  validateParams(model, params);
  validateSettings(settings);
  if (!Number.isInteger(replications) || replications < 2) {
    throw new RangeError("at least 2 replications are required for a confidence interval");
  }
  const perReplication: M[] = [];
  for (let r = 0; r < replications; r++) {
    perReplication.push(model.run(params, createStreams(masterSeed, model.streams, r), settings));
  }
  const summary = {} as { [K in keyof M]: Summary };
  for (const key of Object.keys(model.metrics) as (keyof M & string)[]) {
    summary[key] = summarize(
      perReplication.map((m) => m[key] as number),
      confidence,
    );
  }
  return {
    metadata: {
      modelId: model.id,
      modelVersion: model.version,
      engineVersion: ENGINE_VERSION,
      rngVersion: RNG_VERSION,
      masterSeed,
      replications,
      streams: [...model.streams],
      params: { ...params },
      settings: { warmup: settings.warmup, horizon: settings.horizon },
      confidence,
      dataProvenance: null,
    },
    perReplication,
    summary,
  };
}
