# Visual-first journey: UX plan and component map

Goal: a first-time visitor understands RealityFork in five seconds, and every stage has exactly one obvious next step.
Everything below reuses the existing core (realities, branches, formulas, proposals) and the existing single AI call.

## The journey

| Stage | What the user sees | One primary action | Secondary (quiet) |
|---|---|---|---|
| 1. Imagine | A large "What if…" sentence with the input inside it, over a soft line that forks into three paths. | **Explore possibilities** (AI draft) | example maps, "map it out yourself", saved maps, More menu |
| 2. Discover | The question, then 2–3 future cards branching from "As things are": name, defining difference, decisions, one likely upside and one challenge. Labelled "AI-suggested possibilities, not predictions". | **Explore this future** on a card (this is the approval: kept futures are added to the map) | keep/skip a future, "Before you rely on this" (questions, evidence, limits), "Adjust the draft", try again, discard |
| 3. Explore | A map of all paths (current path highlighted), then one future told as a story: what's different, could go well, could be hard, still unknown, calculated results. A "Next step" card asks one question at a time. | the Next-step card: **answer one question**, or **compare** once nothing is unknown | explore another path, compare with…, all details |
| 4. Branch | "Explore another path from here": pick a different choice (one tap) or name a new path. The map grows and highlights the new path. | **choose a different decision** | name a path yourself |
| 5. Compare | Two futures side by side: where they differ, what could go well or be hard in each, calculated results only when both are computed from your numbers. | **Continue with A** | continue with B, technical comparison |

Rules applied everywhere: no jargon in the default view ("path", "future", "decision", never "fork", "branch",
"fingerprint"), unknown values are listed as questions rather than "unknown" cells, and numbers appear only when a
formula has every input from the user. Advanced controls (all assumptions, formulas, likelihood, fingerprints,
simulations) stay available under "All details".

## Component map (`packages/web/src/reality/`)

| Component | Role | Data |
|---|---|---|
| `RealityApp` | shell: header (wordmark, More menu), banners, stage router | `RealityStore` state |
| `Imagine` | stage 1 | `requestPlan`, `create`, `loadExample`, saved realities |
| `Discover` | stage 2: loading, error and ready states | `plan` (proposal + selection), `editPlan`, `acceptPlan(focus)` |
| `RealityMap` | the tree of paths; current path highlighted; horizontal, scrolls on phones | `Reality`, selected id |
| `Explore` | stage 3–4: story, Next step, path sheet, compare picker, All details | core `branchStory`, `forkChoices`; `forkWith`, `updateBranch` |
| `CompareView` | stage 5 | core `compareStory` |
| `panels.tsx` | unchanged advanced editors (assumptions, formulas, possibilities, technical comparison) | existing operations |

Core additions (`packages/core/src/reality/`): `story.ts` (pure groupings: `branchStory`, `forkChoices`,
`compareStory`), an optional `tone` on possibilities (upside / challenge) and an optional `origin` record for
AI-drafted maps. Both are omitted from fingerprints when absent, so files saved earlier import unchanged.
The proposal schema gains `tone` per possibility, filled by the same single AI call.
