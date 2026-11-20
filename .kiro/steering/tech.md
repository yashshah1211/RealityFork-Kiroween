---
inclusion: always
---

# Technical conventions

## Stack
- TypeScript (strict, `noUncheckedIndexedAccess`), npm workspaces, Node 20+.
- Tests: Vitest + fast-check (property-based testing).
- CLI scripts run with `tsx`. UI (Task 7, not yet started): React + Vite, with Playwright as a dev dependency for end-to-end tests.
- No paid APIs. Do not add dependencies without a stated reason in the spec.

## Layout
- `packages/core`: pure simulation core. **It must not import DOM, React, Node-only
  modules (`fs`, `path`, `crypto` from Node) or anything from `packages/cli` or
  `packages/web`.** It must run unchanged in Node and in the browser.
- `packages/cli`: Node-only scripts (simulation runner, benchmark, report writer).
- `docs/validation/`: generated evidence. Reports are written by scripts from real
  output; never hand-edit numbers into them.

## Versioning and reproducibility
- Every model has `id` + semantic `version`. Bump the model version whenever its
  numerical output for the same inputs could change.
- `ENGINE_VERSION` and `RNG_VERSION` constants live in `packages/core/src/version.ts`.
  Bump them on any change that alters output for identical inputs.
- Run metadata must include: model id/version, engine version, RNG version, master
  seed, parameters, run settings, and (from Task 6) data provenance.
- Determinism is guaranteed for the same inputs on the same JS runtime. `Math.log` and
  `Math.exp` are not required to be correctly rounded by ECMAScript, so bit-identical
  results across different engines are not guaranteed. Record this as a known limitation
  (details: docs/validation/reproducibility.md).
- Hashing: SHA-256 via Web Crypto (`globalThis.crypto.subtle`), over canonical JSON
  (`packages/core/src/serialize/canonical.ts`). Never hash `JSON.stringify` output directly.
- Core must reach `crypto`, `TextEncoder`, `process` or `navigator` only through `globalThis` with
  local structural types, never by importing Node modules.

## Commands
- `npm test`: all core tests.
- `npm run typecheck`
- `npm run sim -- <scenario.json>`
- `npm run benchmark`: M/M/c analytical validation; writes `docs/validation/benchmark-report.md`.
- `npm run rf -- <store.json> <command>`: scenario CLI (baseline, fork, set, run, list, compare, reproduce, export, import).
- `bash examples/demo-branching.sh`: end-to-end demo (its output is captured in docs/validation/cli-demo.txt).
- `npm run generate:synthetic`: regenerates data/synthetic/ (clinic fixture, unchanged; front-desk constant-rate and daily-pattern CSVs; each with a dataset card).
- `npm run demo:daypart`: time-of-day staffing demo (queue.daypart); writes docs/validation/daypart-demo.txt.
- Universal realities (default UI at `/`): logic in `packages/core/src/reality/` (expr.ts, reality.ts, examples.ts,
  proposal.ts, story.ts); UI in `packages/web/src/reality/` (RealityApp → Imagine, Discover, Explore + RealityMap,
  CompareView; panels.tsx holds the advanced editors). Presentation groupings belong in story.ts, not in components. Never use eval/Function for formulas; extend the grammar in expr.ts instead.
  New situations must never need new code: examples are data built through the public operations.
- Specialized staffing tool: `/#staffing`.
- AI planner: `packages/core/src/reality/proposal.ts` (schema, validation, conversion; no network) and
  `packages/web/server/` (Groq adapter, loaded by the Vite dev server via `ssrLoadModule`). The key is read
  only server-side from `GROQ_API_KEY`; never use a `VITE_` prefix for it. `npm run plan:eval` runs the live
  five-domain evaluation. Automated tests always mock the provider.
- Reactive futures (R15, docs/design/reactive-futures.md): two endpoints share one limiter: `POST /api/plan`
  (`{question}` returns a draft plus 0–2 context questions; `{question, context}` returns a tailored draft) and
  `POST /api/revisit` (one path; schema, request check, validation and approval in `packages/core/src/reality/revisit.ts`).
  Every AI request is started by the user; never add an automatic one. AI text may ASK about eligibility, legal status
  or permits but never state them (`ASSERTION_RE`). New optional fields (`context`, `facts`, `sources`, `revisits`,
  `about`, `basis`, `setAside`) are hashed only when present: keep it that way so older files keep their fingerprints.
  Staleness and "what changed" come from `story.ts` (`staleSuggestions`, `describeChange`); the UI only formats them.
- Causal consequences (R16): consequences added by `/api/revisit` carry `cause {trigger, mechanism, downstream, uncertainty}`.
  Checks live in `proposal.ts` (`consequenceErrors`, `statementErrors`, `isTaskLike`, `RULE_RE`, `internalNames`); they are
  phrase heuristics, not semantic verification. First drafts keep the R15 possibility format: do not add causes to drafts
  without new live evidence (docs/validation/r16-quality-results.md). Display text comes from `consequenceView` in `story.ts`.
- Counterfactuals (R17): "What if this changed?" goes through one store operation, `exploreChange` (fork + one user change),
  and one view, `whatIfView` (story.ts, on `describeChange`). Never recalculate or rewrite a qualitative suggestion: flag it
  and offer the user-approved fresh look. Do not add per-domain flows.
- Audit repairs (R18, docs/validation/r18-audit-repairs.md): "changed" has ONE definition, `pathDifference` /
  `changesFromParent` (values plus `told`, via `diffFacts`); never test values alone for "nothing changed". Decision chips
  open the "What if this changed?" sheet focused on that assumption. Copies of suggestions without a basis are tagged by
  `carriedOver` (never removed). Provenance: `ValueSource` includes "example"; Known, "Uses:" lines and the editor read
  `valueOrigin` / `formulaUses`; values without a source are "origin not recorded". Units: format with `withUnit` /
  `showOutcome` (currency symbol first) and `formulaUnit` (declared, or derived only from + and −; mixed shows no number);
  never infer a currency. Number fields parse with `parseNumberInput`. Compare's simulated outcomes compare finished runs
  with `engine.compare` (store `compareSimulations`); a path without a run shows no number. Edit times live in the
  local-storage envelope only (`edited`), recorded in `put()`; the bundle and export format are unchanged.
- Truthful branches and data safety (R18.1, docs/validation/r18-1-truth-and-safety.md): a change the user DESCRIBES is one
  record, a path fact whose question is `INTERVENTION_QUESTION` (`isIntervention`); both "Explore another path → describe"
  and "What if this changed?" create it through `exploreChange`. It is a hypothetical: word it "Exploring: …" (`toldLine`,
  `factChangeLine`), never "You told us", never turn it into a value, and send it to the AI under `HYPOTHETICAL_QUESTION`.
  `forkWith(name)` is only for an unchanged copy. Possibilities record `source` ("user" at creation in the app, "example" for
  examples; never write `source: undefined`, `canonicalHash` rejects it); read it with `possibilityOrigin`, and caption lists
  with `possibilityCaption`. Missing source is "unrecorded": never infer one. Units compare with `normalizeUnit` /
  `sameUnit` (spelling only; display keeps the typed unit). `parseNumberInput` is the only number parser (it lives in
  `packages/core/src/reality/amounts.ts` since R19 and `format.ts` re-exports it) and its policy is in its doc comment: refuse
  ambiguous input with a message, never strip a separator. Import goes through `mergeImported`: never replace or drop a
  saved map; a same-ID map with different content becomes a separate copy.
- First-use friction (R19, docs/validation/r19-first-experience.md): figures the user already wrote in the question are read
  LOCALLY (`stated.ts`: `readStatedValues`, `figurePlan`, `appliedFigures`; no AI request, no network) through the same
  `parseNumberInput` policy, so `1,5`, `1.500`, `20k`, `5 lakh`, `5%`, signed numbers, ranges, fractions, times and years are
  reported as "not used", never guessed. A figure is matched to an assumption only by shared words AND a compatible unit (same
  currency, kind of unit and period); a missing currency or period is said and the row is not pre-ticked; no currency is ever
  inferred; two figures for one assumption need different futures. Nothing is applied until the user confirms in the Discover
  panel; then `proposalToReality(…, { figures })` sets them as `sources[key] = "user"` plus `Branch.stated[key] = {text, value}`
  (the user's own words; hashed only when present, so older files keep their fingerprints) on the chosen futures only, before
  suggestion bases are computed (no false "may need a fresh look"). `knownView` / `valueOrigin` show the words only while the path
  still holds that number. The AI never sets a number and never sees a reason to: the question already carries the figures.
  "Edit my question" changes `ReadyPlan.question` locally (`madeFor` keeps the wording the futures were drafted for);
  "Generate different possibilities" is `regenerate()`: one request, the draft stays on screen, a failure restores it with the
  reason. The AI request says who wrote a suggestion only as far as it is recorded (`from`: ai | user | example | unrecorded, the
  same `possibilityOrigin` the screen uses) and marks copies from an earlier path `inherited` (the same ones `carriedOver` tags).
  Live check: `RF_LIVE=1 npm run r19:live` (at most 2 provider requests, enforced in code; never part of `npm test`).
- Web UI: the scheduling example (queue.daypart@0.2.0) is the first-screen journey. Schedule views and the
  staffing-choice explanation come from `packages/core/src/compare/schedule.ts`; block-rate provenance from
  `blockRatesProvenance` / `readBlockProvenance`. The UI only draws and formats them.
- Decision mapping: a model may declare `decision` (staffing cost, waiting customer-hours, assumed waiting value).
  It is metadata and must not change simulated output. Trade-off numbers come only from `computeTradeoff`.
- `npm run dev`: web UI on http://localhost:5173. `npm run e2e`: Playwright (run `npx playwright install chromium` once first).
- UI rule: `packages/web` never computes statistics. It calls core and only formats values. Simulations go through
  `Engine` (Web Worker in the browser; `directEngine` in tests).
