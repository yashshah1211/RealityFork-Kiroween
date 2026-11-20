/**
 * Analytical validation of queue.mmc against exact M/M/c (Erlang C) results.
 *
 * The design was fixed before the first run and must not be tuned to obtain a pass
 * (see .kiro/steering/simulation-correctness.md):
 *   - 2 cases, both ρ = 0.8.
 *   - Warm-up W = 1,000 h; measurement window 20,000 h (= 20,000 mean service times at μ = 1).
 *   - 30 independent replications; master seed 20261107.
 *   - Statistical family: 2 cases × {Wq, Lq, utilization} = 6 CI checks, Bonferroni-adjusted
 *     to a family-wise confidence of 99% (each check at 1 − 0.01/6).
 *   - Precision checks (engineering adequacy, not hypothesis tests):
 *     |Wq error| < 5%, |utilization − ρ| / ρ < 2%, asymptotic Little within 3%.
 *   - Warm-up evidence: Welch curve from an independent pilot (seed 20261108).
 */
import { mmcAnalytic, type MmcAnalytic } from "../analytic/erlang";
import { queueModel, simulateQueue, type QueueMetrics, type QueueParams } from "../models/queue";
import { createStreams } from "../rng";
import { runReplications, type ReplicationResult } from "../runner";
import { summarize } from "../stats/summary";
import { welchCurve, type WelchCurve } from "../stats/welch";

export interface MmcCase {
  readonly id: string;
  readonly lambda: number;
  readonly mu: number;
  readonly servers: number;
}

export const BENCHMARK_CASES: readonly MmcCase[] = [
  { id: "M/M/2 rho=0.8", lambda: 1.6, mu: 1, servers: 2 },
  { id: "M/M/3 rho=0.8", lambda: 2.4, mu: 1, servers: 3 },
];

export const BENCHMARK_CONFIG = {
  warmup: 1_000,
  horizon: 21_000,
  replications: 30,
  masterSeed: 20261107,
  familyConfidence: 0.99,
  checksPerCase: 3,
  tolerances: { wqRelErr: 0.05, utilRelErr: 0.02, littleRelErr: 0.03 },
  pilot: { masterSeed: 20261108, horizon: 4_000, binWidth: 50, replications: 30, window: 5 },
} as const;

export interface BenchmarkCheck {
  readonly name: string;
  readonly kind: "statistical" | "precision";
  readonly analytic: number;
  readonly estimate: number;
  readonly ciLow?: number;
  readonly ciHigh?: number;
  readonly relativeError: number;
  readonly tolerance?: number;
  readonly passed: boolean;
}

export interface CaseResult {
  readonly benchmarkCase: MmcCase;
  readonly analytic: MmcAnalytic;
  readonly result: ReplicationResult<QueueMetrics>;
  readonly perCheckConfidence: number;
  readonly checks: readonly BenchmarkCheck[];
  readonly little: {
    readonly lqTimeAverage: number;
    readonly lambdaHatTimesWq: number;
    readonly lqRelDiff: number;
    readonly lTimeAverage: number;
    readonly lambdaHatTimesW: number;
    readonly lRelDiff: number;
  };
  readonly censoring: { readonly meanInQueueAtH: number; readonly meanInServiceAtH: number; readonly meanCohortSize: number };
}

const relErr = (est: number, truth: number) => Math.abs(est - truth) / Math.abs(truth);

export function runMmcCase(c: MmcCase, cfg = BENCHMARK_CONFIG): CaseResult {
  const analytic = mmcAnalytic(c.lambda, c.mu, c.servers);
  const params: QueueParams = {
    servers: c.servers,
    arrivalRatePerHour: c.lambda,
    serviceRatePerHour: c.mu,
    serverCostPerHour: 0,
    waitingCostPerHour: 0,
  };
  const familySize = BENCHMARK_CASES.length * cfg.checksPerCase;
  const perCheckConfidence = 1 - (1 - cfg.familyConfidence) / familySize;
  const result = runReplications(queueModel, params, { warmup: cfg.warmup, horizon: cfg.horizon }, cfg.masterSeed, cfg.replications, perCheckConfidence);
  const s = result.summary;

  const ciCheck = (name: string, truth: number, sm: (typeof s)["meanWait"]): BenchmarkCheck => ({
    name,
    kind: "statistical",
    analytic: truth,
    estimate: sm.mean,
    ciLow: sm.ciLow,
    ciHigh: sm.ciHigh,
    relativeError: relErr(sm.mean, truth),
    passed: sm.ciLow <= truth && truth <= sm.ciHigh,
  });

  const reps = result.perReplication;
  const lqT = summarize(reps.map((m) => m.avgQueueLength)).mean;
  const lamWq = summarize(reps.map((m) => m.arrivalRateObserved * m.meanWait)).mean;
  const lT = summarize(reps.map((m) => m.avgInSystem)).mean;
  const lamW = summarize(reps.map((m) => m.arrivalRateObserved * m.meanSojourn)).mean;
  const little = {
    lqTimeAverage: lqT,
    lambdaHatTimesWq: lamWq,
    lqRelDiff: relErr(lamWq, lqT),
    lTimeAverage: lT,
    lambdaHatTimesW: lamW,
    lRelDiff: relErr(lamW, lT),
  };

  const t = cfg.tolerances;
  const checks: BenchmarkCheck[] = [
    ciCheck("Wq inside Bonferroni CI", analytic.wq, s.meanWait),
    ciCheck("Lq inside Bonferroni CI", analytic.lq, s.avgQueueLength),
    ciCheck("utilization inside Bonferroni CI", analytic.rho, s.utilization),
    {
      name: "Wq relative error < 5%",
      kind: "precision",
      analytic: analytic.wq,
      estimate: s.meanWait.mean,
      relativeError: relErr(s.meanWait.mean, analytic.wq),
      tolerance: t.wqRelErr,
      passed: relErr(s.meanWait.mean, analytic.wq) < t.wqRelErr,
    },
    {
      name: "utilization within 2% of rho",
      kind: "precision",
      analytic: analytic.rho,
      estimate: s.utilization.mean,
      relativeError: relErr(s.utilization.mean, analytic.rho),
      tolerance: t.utilRelErr,
      passed: relErr(s.utilization.mean, analytic.rho) < t.utilRelErr,
    },
    {
      name: "asymptotic Little: Lq vs lambda-hat * Wq within 3%",
      kind: "precision",
      analytic: lqT,
      estimate: lamWq,
      relativeError: little.lqRelDiff,
      tolerance: t.littleRelErr,
      passed: little.lqRelDiff < t.littleRelErr,
    },
    {
      name: "asymptotic Little: L vs lambda-hat * W within 3%",
      kind: "precision",
      analytic: lT,
      estimate: lamW,
      relativeError: little.lRelDiff,
      tolerance: t.littleRelErr,
      passed: little.lRelDiff < t.littleRelErr,
    },
  ];

  return {
    benchmarkCase: c,
    analytic,
    result,
    perCheckConfidence,
    checks,
    little,
    censoring: {
      meanInQueueAtH: s.censoredInQueueAtHorizon.mean,
      meanInServiceAtH: s.censoredInServiceAtHorizon.mean,
      meanCohortSize: s.cohortSize.mean,
    },
  };
}

export interface PilotResult {
  readonly benchmarkCase: MmcCase;
  readonly binWidth: number;
  readonly curve: WelchCurve;
  readonly analyticLq: number;
}

/** Independent pilot runs from an empty system, binned queue length, Welch curve. */
export function runWelchPilot(c: MmcCase, cfg = BENCHMARK_CONFIG): PilotResult {
  const p = cfg.pilot;
  const series: number[][] = [];
  for (let r = 0; r < p.replications; r++) {
    const st = createStreams(p.masterSeed, queueModel.streams, r);
    const d = simulateQueue(
      c.servers,
      { interarrival: () => st["arrivals"]!.exponential(c.lambda), service: () => st["service"]!.exponential(c.mu) },
      { warmup: 0, horizon: p.horizon },
      undefined,
      { binWidth: p.binWidth },
    );
    series.push([...(d.bins ?? [])]);
  }
  return { benchmarkCase: c, binWidth: p.binWidth, curve: welchCurve(series, p.window), analyticLq: mmcAnalytic(c.lambda, c.mu, c.servers).lq };
}
