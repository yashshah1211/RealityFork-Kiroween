# Design: RealityFork core

## Package boundaries
```
packages/core   pure TS; runs in Node and in the browser; no I/O
  src/version.ts        ENGINE_VERSION, RNG_VERSION
  src/rng.ts            splitmix32 seeding, xoshiro128**, named streams, exponential
  src/engine/eventQueue.ts  binary heap keyed by (time, seq)
  src/model.ts          ModelDefinition<P, M> interface + schemas
  src/registry.ts       model registry (id@version)
  src/models/queue.ts   M/M/c FIFO (simulateQueue with injectable samplers)
  src/stats/tdist.ts    regularized incomplete beta, t CDF, t quantile
  src/stats/summary.ts  mean, SD, SE, t-CI
  src/stats/welch.ts    Welch moving average for warm-up selection
  src/analytic/erlang.ts  Erlang C, Wq, Lq, W, L
  src/runner.ts         replications, summaries, run metadata
packages/cli    Node scripts: sim.ts, benchmark.ts (writes docs/validation/)
```

## RNG
- `splitmix32` mixes the seed; `xoshiro128**` generates 32-bit outputs.
  `uniform() = next() / 2^32 ∈ [0, 1)`.
- Stream seed = splitmix32 chain over (masterSeed, fnv1a32(name), replication).
  The four xoshiro state words are filled from successive splitmix32 outputs. An all-zero state is impossible
  in practice; it is guarded anyway.
- `exponential(rate) = -ln(1 - u) / rate`. Since u ∈ [0, 1), 1 - u ∈ (0, 1] and the
  log is finite. Resolution is 2^-32, so the largest possible draw is ≈ 22.2/rate. This is documented.

## Queue model semantics
- State: queue (FIFO array with a head index), number of busy servers, customer records.
- `simulateQueue(params, samplers, phases)`: `samplers.interarrival()` and
  `samplers.service()` are injectable. The registered model wires them to the
  exponential streams `arrivals` and `service`; tests inject fixed sequences.
- Arrival at t (t ≤ H): create customer n, draw the service time, start service if a server is
  free, otherwise enqueue; draw the next interarrival; schedule it if t + a ≤ H.
- Departure: free a server, start the next queued customer (FIFO).
- Areas N(t), Q(t), B(t) (busy servers) are integrated over [W, H] only.
- After H: arrivals have stopped; the simulation runs until all cohort customers have departed
  (the "drain-cohort" end-of-run rule). Non-cohort customers still present simply finish along the way.
- Metrics: meanWait, meanSojourn (cohort); avgQueueLength, avgInSystem,
  utilization, throughputPerHour (departures in [W, H] / (H - W)), maxQueueLength,
  arrivalRateObserved (cohort size / (H - W)), cohortSize,
  censoredInQueueAtHorizon, censoredInServiceAtHorizon, costPerHour.
- Cost per hour = c × serverCostPerHour + waitingCostPerHour × (Σ cohort waits) / (H − W).
  This is the explicit cost assumption. Its waiting-cost term is cohort-based, so waits that extend past H are
  still counted against the cohort's window.

## Statistics
- The t quantile is found by bisection on the t CDF (computed via the regularized incomplete beta,
  Lentz continued fraction). It is verified against published quantiles in tests.
- Benchmark family: 2 cases × 3 metrics (Wq, Lq, utilization) = 6 CI checks, each at
  α = 0.01 / 6 (Bonferroni), so the family-wise confidence is ≥ 99%.

## Model extensibility
`ModelDefinition` declares a parameter schema, a metric schema, its stream names, and
`run(params, streams, runConfig)`. The runner knows nothing queue-specific. A second
model plugs in by registering a definition (see the Task 3 extensibility test).

## Scenarios (Task 4)
```
src/serialize/canonical.ts  encodeJson/decodeJson ($nonFinite), canonicalStringify, sha256Hex (Web Crypto)
src/scenario/types.ts       Scenario, ScenarioSpec, ScenarioResult, Change, ReproductionReport
src/scenario/scenario.ts    createBaseline, fork, editDraft, runScenario, reproduce, verifyIntegrity, diffSpecs
src/scenario/bundle.ts      exportBundle, importBundle (full validation)
src/scenario/store.ts       ScenarioStore: put (locked scenarios cannot be replaced), lineage, children
```
- fingerprint = sha256(canonical({schema, spec})). resultHash = sha256(canonical({fingerprint,
  model id/version, engine version, RNG version, perReplication, summary})). The runtime is excluded from both.
- A fork inherits the parent's seed, so branches share random streams by default.
- editDraft keeps the id and recomputes `changesFromParent` against the parent's values, which it
  recovers from the existing change records. No copy of the parent is stored.

## Comparison (Task 5)
```
src/stats/difference.ts  pairedDifference, welchDifference, pairingEffect
src/compare/types.ts     ScenarioComparison and its parts (UI-facing, no presentation logic)
src/compare/compare.ts   compareScenarios, classifyDifference
src/compare/explain.ts   template statements (assumption/direct/uncertainty/model-effect/interaction/pairing/caveat)
```
UI questions → fields: *What changed?* `assumptions`. *What happens?* `outcomes[].directDifference`.
*What looks influential?* `sensitivity.perMetric[].ranking` and `effects`. *How uncertain?*
`outcomes[].difference` and `conclusion`. *Can I reproduce it?* `baseline/variant.fingerprint` and
`resultHash`, plus `sensitivity.runs`.

Interaction residuals within 64·ε of the per-replication magnitude are set to 0, so floating-point
rounding is not reported as non-additivity.
