# Requirements: RealityFork core (validation prototype)

Scope of this spec: Tasks 1–8 of the approved validation plan. **Tasks 1–3 are in
progress**; Tasks 4–8 are recorded here so later work stays consistent, but they are
not implemented.

## R1. Seeded random streams (Task 1)
- R1.1 WHEN a stream is created from the same master seed, stream name and replication
  index THEN it SHALL produce the identical sequence.
- R1.2 WHEN the stream name or replication index differs THEN the sequence SHALL differ.
- R1.3 Uniform draws SHALL lie in [0, 1).
- R1.4 Exponential draws SHALL use inverse-transform sampling; over 10^5 draws the
  sample mean SHALL be within 1% of 1/rate for the fixed test seed.
- R1.5 The RNG algorithm SHALL be identified by `RNG_VERSION` in run metadata.

## R2. Event engine and queue model (Task 2)
- R2.1 Events SHALL be ordered by (time, insertion sequence), so ties are deterministic.
- R2.2 The queue model SHALL be a single-stage, c-server, FIFO queue with Poisson
  arrivals and exponential service (M/M/c), registered as `queue.mmc@1.1.0`.
- R2.3 Service time SHALL be drawn at arrival, in arrival order, from the `service`
  stream; interarrival times from the `arrivals` stream.
- R2.4 Run phases SHALL follow `simulation-correctness.md`: warm-up [0, W),
  measurement [W, H], arrivals only on [0, H], drain-cohort end of run, and censoring
  counts reported at H.
- R2.5 Conservation: at H, arrived = departed + in queue + in service.
- R2.6 All waits ≥ 0; utilization ∈ [0, 1]; FIFO service-start order equals arrival order.
- R2.7 Identical inputs SHALL produce deep-equal outputs.
- R2.8 With matched inputs, increasing the server count SHALL NOT increase any
  individual customer's wait.
- R2.9 With c = 1 and injected sequences, waits SHALL equal Lindley's recursion
  exactly; for c ≥ 1 they SHALL equal an independent Kiefer–Wolfowitz reference.
- R2.10 Exact finite-window Little identity: ∫_W^H N(t) dt SHALL equal the sum of
  sojourn overlaps with [W, H] (floating-point tolerance), and likewise for Q(t).

## R3. Replications, statistics, benchmark (Task 3)
- R3.1 Independent replications SHALL use per-replication derived seeds.
- R3.2 Summaries SHALL report n, mean, sample SD, SE and a Student-t CI with a
  numerically computed quantile.
- R3.3 The benchmark SHALL compare against Erlang C for (λ=1.6, μ=1, c=2) and
  (λ=2.4, μ=1, c=3), both ρ = 0.8, with a measurement window ≥ 10,000 mean service
  times per replication and ≥ 30 replications.
- R3.4 Statistical acceptance: each analytic value SHALL lie within its replication
  CI at a Bonferroni-adjusted family-wise level of 99%.
- R3.5 Precision acceptance: relative error of Wq < 5%; utilization within 2% of ρ;
  asymptotic Little (Lq vs λ̂·W̄q and L vs λ̂·W̄) within 3%.
- R3.6 Warm-up SHALL be justified with a Welch-style moving-average curve in the report.
- R3.7 The report SHALL be generated from real output and include runtimes.

## R0. Correctness review before Tasks 4–5
- R0.1 Each metric SHALL have one basis: cohort or window. `costPerHour` SHALL use the window
  basis for both terms (fixed; model bumped to queue.mmc@1.1.0).
- R0.2 "No observations" SHALL be NaN and SHALL survive export, import and hashing as
  {"$nonFinite":"NaN"}, distinct from 0 and from null.
- R0.3 Cross-runtime reproduction limits SHALL be documented (docs/validation/reproducibility.md).

## R4. Scenarios and branching (Task 4)
- R4.1 createBaseline, fork, editDraft, runScenario, reproduce, exportBundle and importBundle SHALL exist; all scenario objects are deep-frozen.
- R4.2 `id` (identity) and `fingerprint` (SHA-256 of the canonical spec) SHALL be distinct; `resultHash` SHALL be separate from the fingerprint.
- R4.3 Canonical JSON SHALL be independent of property insertion order.
- R4.4 WHEN a scenario is completed THEN editing or re-running it SHALL fail; changes require a fork.
- R4.5 WHEN a descendant is forked or edited THEN no ancestor or sibling SHALL change.
- R4.6 Results SHALL record model, engine and RNG versions and the runtime; specs SHALL keep optional data provenance.
- R4.7 Import SHALL validate structure, schema, model registration, parameters, fingerprints, result hashes and lineage, and SHALL reject modified files.
- R4.8 WHEN the recorded model, engine or RNG version differs from the current one THEN reproduce SHALL report `version-mismatch`, never `identical`.

## R5. Comparison (Task 5)
- R5.1 Assumption diff with labels and units; per-metric baseline mean, variant mean and direct difference.
- R5.2 Same seed and replication count → paired t interval on per-replication differences; otherwise Welch.
- R5.3 Conclusions: variant-higher, variant-lower, inconclusive (CI contains 0, never "no effect"), identical-in-every-replication, not-computable.
- R5.4 The CRN effect SHALL be measured per metric as Var(D) / (Var(A) + Var(B)) and reported whether it helps or hurts.
- R5.5 One-at-a-time sensitivity: one matched run per changed parameter (at most 5); a per-replication
  interaction residual; decomposition identity combined = Σ effects + residual.
- R5.6 Explanations SHALL be templates filled with computed values, with a fixed non-causal
  disclaimer, a non-uniqueness caveat and a multiplicity caveat.
## R6. CSV import and data-driven parameters (Task 6)
- R6.1 Columns SHALL be mapped by the user; no column names are hardcoded.
- R6.2 An explicit observation window [start, end) SHALL be required and validated (parseable, has an offset or an explicit assumption, end > start). It is never inferred from the data.
- R6.3 λ̂ = n / T (hours) with an exact Poisson (Garwood) CI. Mean service is converted from the
  stated unit to hours; μ̂ = 1 / mean, with a CI from the t interval of the mean.
- R6.4 Malformed and missing timestamps, missing time zones, duplicates, negative, zero and non-numeric durations, rows outside the window, empty files and windows with no arrivals SHALL produce explicit errors or counted warnings that cite line numbers.
- R6.5 Fit checks: CV of interarrival and service times (|CV − 1| > 3/√n flagged), the dispersion
  index of counts per bin (χ² test, p < 0.01 flagged), and (estimator 1.1.0, added in Task 8) a split-half
  exact binomial rate test (p < 0.01 flagged; "too few" below 20 arrivals). The UI SHALL state that passing the checks is not proof the model fits.
- R6.6 A synthetic demo CSV (fixed seed, known λ = 1.5/h, μ = 1.2/h) with a dataset card.
- R6.7 Users SHALL be able to accept or override each estimate. Provenance (file, sha256, synthetic flag, window, mapping, unit, time zone policy, estimator version, estimates, applied values, override flags, warnings, fit statuses) SHALL go into spec.dataProvenance, and therefore into the fingerprint.

## R7. Minimal UI (Task 7)
- R7.1 React + Vite. Simulations run in a Web Worker. All logic stays in core; UI state lives in a testable `Workspace` class.
- R7.2 Journey: load example → fork → edit with validation → run with progress → compare (plain sentences, interval bars) → sensitivity and interaction → reproduce → CSV estimate and apply → provenance → export and import. Local persistence uses a validated bundle.
- R7.3 Empty, loading, invalid-input and error states.
- R7.4 Playwright E2E covering the whole journey (Playwright as a devDependency).
- R8 Validation reports: test results, usability study, differentiation study, decision.

## R9. Revision sprint A: explicit trade-off and comprehension (after Task 8)
- R9.1 A model MAY declare an optional `decision` mapping (time unit, staffing cost, waiting customer-hours, assumed waiting value). It is metadata: it SHALL NOT change simulated output, so it does not bump the model version.
- R9.2 Comparisons of models with a mapping SHALL report: staffing change, change in simulated customer-hours waiting (with interval), the assumed waiting value, the modelled net change under that value, and the break-even value w* = −ΔS/ΔWh. All values are computed from results.
- R9.3 When ΔWh is zero, its interval contains 0, staffing does not change, or one option dominates, the comparison SHALL say that no finite useful threshold exists and why. The break-even interval is exact when ΔS is identical in every replication and SHALL be labelled "approximate" (delta method) otherwise.
- R9.4 Text SHALL describe the waiting value as a hypothetical assumption and SHALL NOT present a lower modelled total as a cash saving. queue.mmc `costPerHour` has no preferred direction.
- R9.5 The UI example is a front desk (16 arrivals/h, 10 services per staff member per hour, 2 staff). The demo CSV is a separate synthetic front-desk file; the clinic fixture stays unchanged.
- R9.6 Primary path in plain language; model name, distributions, hashes and provenance behind disclosures. Display rounding only; computation keeps full precision.

## R10. Revision sprint B: time-of-day staffing schedules
- R10.1 New model `queue.daypart@0.1.0` (queue.mmc unchanged): six 2-hour open blocks 08:00–20:00 local, piecewise-constant arrival rates, a staffing level per block, queue carryover across blocks and days, matched `arrivals`/`service` streams.
- R10.2 Staffing decreases never interrupt service; paid on-duty time = max(capacity, busy). At closing, block-6 staff stay until the system is empty. Warm-up must be 0; the horizon must be whole days.
- R10.3 Validation: stationary special case equals queue.mmc sample path by sample path; Kiefer–Wolfowitz with constant staff; hand-computed boundary, increase, decrease, carryover and closing cases; conservation at every boundary; Poisson block counts; deterministic replay; accounting identities; repeated-day stability. Erlang C SHALL NOT be used to validate time-varying cases.
- R10.4 Block-rate estimator `block-rates-csv@0.1.0`: one declared fixed local offset (no DST or named zones), exposure per block, source counts, warnings for sparse blocks (< 10 arrivals), offset mismatches and arrivals outside open blocks.
- R10.5 CLI decision demo (`npm run demo:daypart`) comparing today, all-day extra staff and peak-only extra staff; it SHALL NOT claim scheduling is novel.

## R11. Decision experience sprint: staffing schedules in the browser
- R11.1 Audit queue.daypart shift boundaries and cost accounting. Fixes go into a new version (`queue.daypart@0.2.0`); 0.1.0 stays registered and unchanged. Each finding has a regression test.
- R11.2 Paid time and spend SHALL be split into scheduled, overrun (after a decrease) and after-closing parts that add up to the total, plus the assumed waiting penalty and the modelled total, all per day over the same run.
- R11.3 The first screen SHALL say "See when demand is highest. Explore when extra staff would help most." and offer the scheduling example: a synthetic service center whose block demand is estimated in the browser from `frontdesk-daily-SYNTHETIC.csv`, with three real forks: today, one more person all day, one more person in the busiest block (computed, not hardcoded).
- R11.4 The schedule view SHALL show demand per block (with the estimate's 95% range), staffing per block with what it can serve, and −/+ controls on drafts. Forking stays the way to create alternatives.
- R11.5 The futures comparison SHALL show, for every simulated schedule in the tree: average wait (with range), share waiting over 15 min, scheduled spend, after-shift spend, waiting customer-hours, assumed waiting penalty, modelled total, and break-even against the starting point and between the cheapest and dearest improving options. A template explanation (core) states why targeted staffing may give a better trade-off. Uncertainty is behind one disclosure.
- R11.6 Provenance SHALL show which inputs come from synthetic data (block rates: counts, exposure, intervals, warnings) and which are entered by hand. It is part of the fingerprint and the export.
- R11.7 Playwright SHALL cover the journey at 1440, 768 and 390 px with screenshots, timings and an overflow check.
- R11.8 The usability protocol and blank results sheet SHALL target the scheduling task. No participant data may be invented.

## R12. Universal platform vertical slice ("Git for reality")
- R12.1 The app opens on "What if…?". Any typed situation creates a reality with a starting branch; nothing is inferred from the text.
- R12.2 Generic primitives in core (`packages/core/src/reality/`): number / choice / yes-no assumptions with source and uncertainty notes; formulas in a small safe expression language (no eval; fixed grammar, length and depth limits); optional conditions; speculative possibilities with the user's own likelihood; simulation links that map assumptions to a registered validated model.
- R12.3 Outcomes are labelled Calculated, Simulated or Speculative. Unknown values are null; outcomes that need them name the missing assumption instead of producing a number. No confidence interval is shown except for Simulated outcomes from the validated models.
- R12.4 Branches: fork any branch, edit values independently, lineage, parent fingerprint at fork, "parent edited since fork", SHA-256 fingerprint per branch over definitions and content. Export/import validates every fingerprint; local persistence uses the same validated bundle.
- R12.5 The branching canvas is the centrepiece. Any two branches can be compared (assumptions, calculated differences, possibilities).
- R12.6 Examples are data built through the public operations (moving city, solar, café queue via the simulation adapter). The staffing-schedule tool stays available at `#staffing`.

## R13. AI scenario planner (zero-cost proof of concept)
- R13.1 "Draft it with AI" sends the question to a local server endpoint (`POST /api/plan`, Vite dev-server middleware). The GroqCloud key (`GROQ_API_KEY`, ignored `.env.local`) stays server-side; only free-tier `openai/gpt-oss-120b` / `openai/gpt-oss-20b` are allowed.
- R13.2 The model returns JSON in strict schema mode; the server AND the browser validate it (`validateProposal`). Proposals contain no numbers: number assumptions start unknown, formula constants are limited to unit conversions, text stating money, percentages or probabilities is rejected, possibilities start "not judged".
- R13.3 Nothing is created until the user accepts. The preview offers Accept, Edit (rename, drop items) and Reject. Acceptance builds the reality with the existing operations (`proposalToReality`); formulas are marked unreviewed.
- R13.4 Limits: question ≤ 300 chars, request body ≤ 2 KB (8 KB from R15, which adds up to four context answers), 1 generation per 10 s and 20 per hour, 3000 output tokens, 45 s timeout, one retry only for invalid output, never on 429. Rate-limit and quota errors are explained without asking for payment. The manual workflow is unchanged.

## R14. Visual-first experience
- R14.1 The default UI is a five-stage journey: Imagine (one "What if…" input, one primary action), Discover (AI futures as branching cards; choosing one is the approval), Explore (a focused story of one future plus the map of paths), Branch (a new path by one tap on a different choice, or by naming it), Compare (differences, upsides, challenges, and numbers only when both sides are calculated).
- R14.2 Each stage shows one primary action. Technical editors (assumptions, formulas, likelihood, fingerprints) stay available under "All details" and "Technical comparison".
- R14.3 Possibilities may carry a tone (upside / challenge). The proposal schema asks the same single AI call for it. Tone and the AI `origin` record are optional and omitted from fingerprints when absent, so earlier files import unchanged (test: `realities-6e4b8f2.json`).
- R14.4 Unknown values are asked one at a time, inputs that unlock a calculation first. No table of "unknown" in the default view.
- R14.5 Mobile-first layout without horizontal page overflow at 390 px; reduced-motion support; focus moves to each new stage's heading.

## R15. Context-aware, reactive futures
Plan: docs/design/reactive-futures.md. Evidence: docs/validation/reactive-report.md.
- R15.1 Context before exploring: the first draft reply carries 0–2 short questions about the person's situation (each with a reason and up to four short examples, no figures). They are asked one at a time, answered in free text or skipped. Skipping both shows the first draft with no further request; answering at least one makes exactly one more draft request that carries the answers (`POST /api/plan {question, context}`), and a tailored draft asks nothing more. The original question is kept verbatim. Answers can be changed before choosing a future (unchanged answers reuse the tailored draft) and edited later in the path view.
- R15.2 Nothing is domain-specific: questions, futures and assumptions come from the model and are checked by the same generic validators; no code mentions a domain.
- R15.3 Known / Calculated / Possible. Known = what the user told RealityFork: context answers (`Reality.context`, every path), facts about one path (`Branch.facts`, copied when branching) and values the user set (`Branch.sources[key] = "user"`; values chosen by the AI draft to define a path are `"ai"`). Calculated = formulas whose inputs all come from the user. Possible = qualitative suggestions (AI or user), never predictions.
- R15.4 Reactive answers: an answer, a new fact or a context edit is saved, formulas are re-evaluated, and the path shows what changed (template text filled with computed values only). AI suggestions record what they depend on (`Possibility.about`) and what was known when they were made (`Possibility.basis`); a suggestion is flagged "may need a fresh look" when a value it depends on changed or the user told RealityFork something since. Qualitative claims are never recalculated automatically.
- R15.5 Another look (`POST /api/revisit`): only after the explicit action "Ask AI to take another look". The request carries only that path: the question, the context, the path's facts, its assumptions with who set each value, its active suggestions and a template sentence of what changed. The reply may only add possibilities, mark existing AI suggestions to reconsider, list questions to verify (ending with "?") and evidence to gather. It is validated on the server and again in the browser, previewed item by item, and applied only on approval to that path. Reconsidered suggestions are set aside with the reason, never deleted, and can be put back. Applying is refused if the path changed after the request.
- R15.6 No eligibility, legal-status, visa/permit-availability or guarantee statements in AI text (`ASSERTION_RE`); they are allowed only as questions or evidence to gather. Figures stay forbidden everywhere. A rejected claim is not shown in the error message.
- R15.7 Branches stay independent: answers, facts and approved re-evaluations change one path only. "Not sure? Explore both" (yes/no or two-option choices) creates one new path per answer, only on that explicit action, and reuses an existing path with the same answer.
- R15.8 Compatibility: all R15 fields are optional and omitted from fingerprints when empty, so files saved before R15 import with unchanged fingerprints (fixtures `realities-6e4b8f2.json`, `realities-5b17057.json`).
- R15.9 Requests: one shared server limiter for drafts and fresh looks; body limits 8 KB (draft) and 64 KB (fresh look); 1500 output tokens for a fresh look; the browser waits out the local server's own spacing once ("local-limit", never forwarded to the provider) and never retries provider rate limits.
- R15.10 Whenever a path has suggestions that may need a fresh look, exactly one "Ask AI to take another look" action is visible in the next step, whatever else the next step shows (user-testing fix).
- R15.11 A fact that shares words with an open question points to it (`factMatches`, deterministic, no AI): that question is asked next and quotes the fact. The value stays unknown until the user answers (user-testing fix).

## R16. Future quality: conditional causal consequences
Baseline: docs/validation/r16-quality-baseline.md. Results and decision: docs/validation/r16-quality-results.md.
- R16.1 A possibility may carry `cause {trigger, mechanism, downstream, uncertainty}` (`downstream` may be empty). It is optional and hashed only when present, so earlier files import unchanged (fixtures `realities-6e4b8f2.json`, `realities-5b17057.json`, `realities-4e4bdfe.json`).
- R16.2 "Ask AI to take another look" returns conditional consequences with all four parts, in one request. A consequence without a trigger, mechanism or uncertainty is left out, never padded.
- R16.3 Checks (server repair and browser): research tasks or advice in place of a consequence; figures; eligibility, legal, tax-residency or guarantee claims, and laws stated as fact, in what is asserted (allowed in the condition and in things to find out); code names (camelCase keys or options) in text people read; an if-clause inside the consequence; repeats. Drafts get the same statement checks plus contradictory settings in one future and futures with identical decisions. Notes say what was left out and why, without quoting text.
- R16.4 Explore shows "{consequence} if {condition}." and "Then: …", with "Why this might happen" (mechanism, the assumptions it depends on, marked "not known yet" when unresolved, what could change it, and a link to try a different choice on a new path).
- R16.5 First drafts keep the R15 possibility format: the live check showed causes in one draft request made it worse (REVISE).

## R17. Interactive counterfactual exploration
Plan: docs/design/counterfactual-exploration.md. Evaluation: docs/validation/r17-counterfactual-report.md.
- R17.1 Every suggestion offers "What if this changed?": the assumptions the AI linked it to (`about`) first, labelled as the AI's link, then the others; a number takes only the user's own value, a choice one tap; or the user describes a change in their own words.
- R17.2 One operation (`exploreChange`) for every situation: fork the current path, apply ONE change with source "user" (or save the described change as a Known fact, never as a value), select the new path. The parent, its fingerprint and lineage are unchanged; a sibling with exactly the same change is reused.
- R17.3 The new path shows what the change does compared with its parent (`whatIfView`): what the user changed; calculated results from formulas only, or what they still need; AI suggestions that depend on a changed value (or predate a described change), labelled "not recalculated", with the existing user-approved "Ask AI to take another look".
- R17.4 Compare tags suggestions that may need a fresh look on either side. No new data fields, AI requests or panels.

## R18. Audit repairs (seven P1 findings)
Root causes, fixes and results: docs/validation/r18-audit-repairs.md. Reproductions: packages/web/e2e/audit.spec.ts, packages/core/test/audit.test.ts.
- R18.1 (RF-01) A decision chip opens the change sheet for that assumption first: a number field with its current value and unit, or that assumption's own choices; other assumptions and a change in the user's words follow. The path is created by `exploreChange`.
- R18.2 (RF-04) One definition of "changed" (`changesFromParent`: values and what the user told the path) for the path header, map captions, pickers and Compare. A described change is never turned into a value or recalculated.
- R18.3 (RF-03) Compare shows each validated simulation on both paths (mean, 95% interval, unit, model@version, seed, repeats) or its status (not simulated yet, out of date, running, needs inputs, failed). The difference B − A comes from the engine's paired comparison and says "not distinguishable from noise" when its interval contains 0. No number is shown for a path without a run.
- R18.4 (RF-05) Suggestions copied from an earlier path without a basis are tagged "carried over, not re-checked" when the path differs (or "may not hold here" when a dependency differs); `about: []` is never tagged; nothing is removed. Compare lists them under "Listed in both" with the same tag.
- R18.5 (RF-02) Every saved map is reachable from the first screen ("All your maps (n)"), distinguishable (paths, edit time when recorded, a short map reference when questions repeat) and opens with its edits. Edit times are recorded in the browser's envelope only, from R18 on.
- R18.6 (RF-06) Values record who gave them ("user", "ai", "example"); Known lists the user's values with the path they were first set in; each calculated result says what it uses and where each value came from. Older values read "origin not recorded".
- R18.7 (RF-07) Amounts keep their currency and period ("₹8,000 per month"); a formula without a unit takes one only from same-unit sums and differences; mixed units show no number; code-name labels in drafts become words; typed amounts may carry the unit's own currency symbol. No currency is ever inferred.

## R18.1 milestone. Truthful branches and data safety (items P1 to P5)
Root causes, fixes, before/after evidence and results: docs/validation/r18-1-truth-and-safety.md. The items are labelled P1 to P5 so they are not confused with requirements R18.1 to R18.7 above, which number the seven audit findings. Tests: packages/core/test/truth.test.ts, packages/web/src/reality/format.test.ts, packages/web/src/reality/store.truth.test.ts, packages/web/e2e/truth.spec.ts.
- P1 A path the user describes in words ("Explore another path from here" → "Or describe what is different", or "What if this changed?") is one record, whichever way it was entered: a fact on the new path whose question is `INTERVENTION_QUESTION`. It is a hypothetical: never a value, never presented as a known fact, and nothing is recalculated from it. The path header, map caption, Known, "What this change does", Compare and the AI request all read that one record ("Exploring: …"; to the AI, `HYPOTHETICAL_QUESTION`). The parent is unchanged. The same sentence entered by either route is one path. A copy that has only a name is offered as "an unchanged copy" and says nothing changed.
- P2 A possibility records who wrote it when that is known: `Possibility.source` is "user" (typed in the app) or "example" (came with an example); the AI's are recognised by their note; anything saved earlier is "unrecorded" and is never credited to anyone. Captions and per-item tags (`possibilityCaption`, `possibilityTag`) say only what is recorded. Older files keep their fingerprints (the field is hashed only when present).
- P3 Typed amounts follow one stated policy (`parseNumberInput`, documented in format.ts): read plain digits, a dot decimal, comma thousands in groups of three, lakh grouping, spaces between groups of three, a sign, and the field's own currency symbol; refuse with a message everything else (a decimal comma, `1.500`, European `1.200,50`, dot grouping, letters, exponents, `%`, brackets, 10^15 or more, another currency, any currency on a field with none). A refused entry stores nothing and changes no calculation. Empty means unknown. No currency is guessed.
- P4 Unit spellings are compared by `normalizeUnit` / `sameUnit` (spelling only: "₹/month" = "₹ per month", "minutes" = "min"). The unit is displayed as typed. Different periods, currencies and dimensions stay different; a missing currency is never supplied; an unlabeled number stays without a unit. Nothing is converted.
- P5 Importing never replaces or drops a saved map (`mergeImported`). A new ID is added; identical content is skipped; the same ID with different content is added as a separate copy under a new ID (fingerprints do not include the map ID, so the copy stays valid). Importing the same file again adds nothing. The notice says what happened. Saved maps keep their edit times; added maps have none.
## R19 milestone. Frictionless first experience
Baseline (measured before any change): docs/validation/r19-baseline.md. Results: docs/validation/r19-first-experience.md. Tests: packages/core/test/stated.test.ts and provenance.test.ts, packages/web/src/reality/store.figures.test.ts, packages/web/e2e/firstuse.spec.ts and r19-journeys.spec.ts.
- R19.1 Figures the user wrote in the question are read locally (no AI request) with the same policy that reads typed amounts. A number that policy refuses (`1,5`, `1.500`, `20k`) or that is signed, scaled, a percentage, a range, a fraction, a time, a year or a duration in parts is listed as "not used" with the reason and never guessed.
- R19.2 A figure is offered for an assumption only when its words overlap the assumption's name and its unit is compatible (same currency, kind of unit and period). A missing currency or period is said, the row is not pre-ticked, and no currency is inferred from a word, a place or a field. A figure no number assumption can hold is never forced into one; if the draft keeps the idea as a choice, the reason says so.
- R19.3 Nothing is applied until the user confirms. Each figure can be unticked, moved to another assumption, or sent to a chosen future ("the future I open" by default); two figures for one assumption cannot share a future. Confirmed figures are set only on the futures chosen, as the user's own values (`sources` "user") with their words kept (`Branch.stated`, hashed only when present). They are never asked for again, and no suggestion is flagged as made before they were known.
- R19.4 "Edit my question" changes the wording on screen without a request and without discarding the draft; a note says the futures were drafted for the earlier wording, and figures are read again from the new one. "Generate different possibilities" is one request with the question as it reads now and the answers already given; the current draft stays visible while it waits and comes back, with the reason, if the request fails. Neither touches a saved map.
- R19.5 The request for a fresh look says who wrote each suggestion only as far as that is recorded (`from`: ai, user, example or unrecorded, the same origin the screen shows) and marks suggestions copied from an earlier path `inherited`. Older two-value requests still pass the server check.
- R19.6 Wording says what is true: cards are "Included in draft"; the button is "Save and explore this future" (or "…with your figures" when confirmed figures will be filled in there); "This future is filled in" is used only when no number is unknown and no question is open, otherwise "Every number has a value" with the count of open items; one "Explore another path from here" is shown, not two.
- R19.7 The live check makes at most two provider requests, enforced in code, and is never part of the default test run.
