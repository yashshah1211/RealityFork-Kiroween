# Reproducibility, hashing and metric bases

## Identity vs content
| Concept | What it is | Changes when |
|---|---|---|
| `id` | Identity of a scenario (e.g. `busier-day`) | never; editing a draft keeps it |
| `fingerprint` | SHA-256 of canonical `{schema, spec}`: model id/version, parameters, run settings, master seed, replications, confidence, data provenance | any assumption changes |
| `resultHash` | SHA-256 of canonical `{fingerprint, model id/version, engine version, RNG version, per-replication metrics, summaries}` | the inputs, any version, or any output number changes |

Two scenarios with identical assumptions share a fingerprint but not an id. In the CLI demo, the
one-at-a-time sensitivity run "only Staff on duty" has the same fingerprint and result hash
(`76ea1b746ac2…`, `43191327fa1b…`) as the user's "Add one staff member" branch.

Hashes detect accidental or naive edits. They are **not signatures**: anyone can edit a file and recompute them.

## Canonical JSON
- Object keys are sorted (UTF-16 code-unit order), so hashes do not depend on property insertion order. A property-based test checks this.
- Numbers use ECMAScript `Number::toString`, which the specification defines exactly.
- `-0` is normalised to `0`.
- `NaN`, `Infinity` and `-Infinity` are encoded as `{"$nonFinite": "NaN" | "Infinity" | "-Infinity"}`. Plain JSON would turn them into `null`.
- `NaN` means *no observations*. For example, `meanWait` is NaN when no customer arrived in the measurement window. It stays distinct from a legitimate `0` through export, import, hashing and comparison, where it is reported as "not computable".

## Reproduction statuses
| Status | Meaning |
|---|---|
| `identical` | Hashes valid, model, engine and RNG versions equal, and the re-run gives the same result hash. |
| `different` | Versions match but the re-run differs. Field-level differences are listed. |
| `version-mismatch` | The recorded model, engine or RNG version differs from the current one. **Never reported as identical**, even if the numbers happen to match. |
| `invalid` | The stored fingerprint or result hash does not match the stored content. |
| `not-run` | The scenario is a draft. |

## Limits of bit-identical reproduction across JavaScript runtimes
- **Bit-identical everywhere:** uniform random numbers (32-bit integer arithmetic: `Math.imul`, shifts) and the canonical JSON text.
- **Same runtime only:** exponential draws use `Math.log`. Summaries use `Math.sqrt` and floating-point sums, and the t quantile uses `Math.log`, `Math.exp` and `Math.sin` (Lanczos gamma). ECMAScript leaves `Math.log`, `exp`, `pow` and `sin` "implementation-approximated"; only basic arithmetic and `Math.sqrt` are correctly rounded. Different engines, or different versions of one engine, may differ in the last bits.
- **Consequence:** a result hash produced under Node 24 / V8 may not match a re-run in another browser or a future Node release. `reproduce` then returns `different` and notes the runtime change. The recorded runtime (`result.runtime`) is informational and excluded from hashes.
- Not yet done: a correctly rounded `log` (e.g. a pure-integer or fdlibm port) would make the whole pipeline engine-independent, at some speed cost.

## Metric bases in queue.mmc@1.1.0 (correctness review)
| Basis | Metrics | Customers counted |
|---|---|---|
| **Cohort** | `meanWait`, `meanSojourn`, `cohortSize`, `arrivalRateObserved`, censoring counts | Customers arriving in [W, H]. Full waits are kept, including time after H (drain-cohort). |
| **Window** | `avgQueueLength`, `avgInSystem`, `utilization`, `maxQueueLength`, `throughputPerHour`, `costPerHour` | Whoever is present during [W, H], including warm-up arrivals. Time after H is excluded. |

- The **exact** finite-window Little identity holds per basis: ∫_W^H Q(t)dt equals the sum over *all* customers of their waiting-interval overlap with [W, H] (tested).
- λ̂·W̄q ≈ Lq mixes the two bases. It is only **asymptotic**, and differs by boundary terms (tested with a constructed counterexample, then measured at 0.00–0.01% in the benchmark).
- **Fix made in this review:** `costPerHour` previously combined window-basis staff cost with cohort-basis waiting (which included waits after H). It now uses ∫Q dt over [W, H] for the waiting term, so both cost terms share the window basis. The model version was bumped from 1.0.0 to 1.1.0 because this output can change.
