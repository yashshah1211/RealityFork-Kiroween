import type { RandomStream } from "./rng";

export interface ParameterSpec {
  /** Plain-language label shown to non-experts. */
  readonly label: string;
  readonly unit: string;
  readonly description: string;
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

export interface MetricSpec {
  readonly label: string;
  readonly unit: string;
  readonly lowerIsBetter: boolean | null;
  readonly description: string;
}

export interface RunSettings {
  /** Warm-up length W (model time units). Measurement window is [W, H]. */
  readonly warmup: number;
  /** Horizon H. Arrivals are generated only on [0, H]. */
  readonly horizon: number;
}

/**
 * A simulation model. The runner is model-agnostic: it only uses this interface.
 * P = parameter record, M = metric record (all numeric).
 */
export interface ModelDefinition<
  P extends Record<string, number> = Record<string, number>,
  M extends Record<string, number> = Record<string, number>,
> {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly parameters: { readonly [K in keyof P]: ParameterSpec };
  readonly metrics: { readonly [K in keyof M]: MetricSpec };
  /** Names of the independent random streams this model consumes. */
  readonly streams: readonly string[];
  readonly defaults: P;
  run(params: P, streams: Readonly<Record<string, RandomStream>>, settings: RunSettings): M;
  /**
   * Optional mapping used by the cost trade-off explanation. Metadata only; it does not change
   * model output, so adding or changing it does not require a model version bump.
   */
  readonly decision?: DecisionMapping<P, M>;
}

export interface DecisionMapping<P extends Record<string, number>, M extends Record<string, number>> {
  /** Accounting period for the amounts below, e.g. "hour" (of the measurement window) or "day". */
  readonly timeUnit: string;
  /** Staffing expenditure per time unit ($). */
  staffingCost(params: P, metrics: M): number;
  /** Customer-hours spent waiting per time unit. */
  waitingHours(params: P, metrics: M): number;
  /** Assumed (hypothetical) value of one customer-hour of waiting ($). */
  waitingValue(params: P): number;
}

export function validateParams<P extends Record<string, number>>(model: ModelDefinition<P>, params: P): void {
  for (const key of Object.keys(model.parameters) as (keyof P & string)[]) {
    const spec = model.parameters[key];
    const v = params[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new RangeError(`${model.id}: parameter "${key}" must be a finite number`);
    }
    if (v < spec.min || v > spec.max) {
      throw new RangeError(`${model.id}: parameter "${key}"=${v} outside [${spec.min}, ${spec.max}]`);
    }
    if (spec.integer && !Number.isInteger(v)) {
      throw new RangeError(`${model.id}: parameter "${key}" must be an integer`);
    }
  }
  for (const key of Object.keys(params)) {
    if (!(key in model.parameters)) throw new RangeError(`${model.id}: unknown parameter "${key}"`);
  }
}

export function validateSettings(settings: RunSettings): void {
  const { warmup, horizon } = settings;
  if (!(Number.isFinite(warmup) && Number.isFinite(horizon) && warmup >= 0 && horizon > warmup)) {
    throw new RangeError(`run settings require 0 <= warmup < horizon, got warmup=${warmup}, horizon=${horizon}`);
  }
}
