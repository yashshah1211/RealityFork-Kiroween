# R15: context-aware, reactive futures

The smallest compatible change: no new architecture or panels, one new AI request type, optional data fields only.
Requirements: `.kiro/specs/realityfork-core/requirements.md` (R15). Evidence: `docs/validation/reactive-report.md`.

## Loop
QUESTION → (0–2 optional context questions) → FUTURES → choose one → answer / tell something new → WHAT CHANGED →
(only if the user asks) ANOTHER LOOK at that path → preview → approve → continue, compare or branch.

## AI requests (all started by the user, all through the local server and its one limiter)
| Step | Request | When |
|---|---|---|
| First draft | `POST /api/plan {question}` | "Explore possibilities". One reply carries up to two context questions **and** a complete first draft. |
| Tailored draft | `POST /api/plan {question, context}` | Only if the user answered at least one question. A tailored draft asks nothing more (the server and the browser both force `contextQuestions: []`). |
| Another look | `POST /api/revisit {one path}` | Only when the user presses "Ask AI to take another look" in a path. |

A journey costs 1 request if the questions are skipped, 2 if any is answered, and +1 per requested look.
Rejected alternative: a separate "questions only" request before the draft (one more request on every journey, and a
blank screen while waiting). Changing the answers to the same values reuses the tailored draft without a request.
If tailoring fails, the general futures are shown with the reason, the answers are kept, and the suggestions they
could not take into account are flagged for a fresh look (`proposalToReality(..., { contextUsed: false })`).

## Data (all optional, hashed only when non-empty, so earlier files keep their fingerprints)
- `Reality.context: KnownFact[]`: answers to the context questions (ids `context-1`, `context-2`), every path.
- `Branch.facts: KnownFact[]`: what the user told RealityFork about one path; copied when branching.
- `Branch.sources: { [key]: "user" | "ai" }`: who set each value. Values the AI draft chose to define a path are
  `"ai"`; answers, edits, chosen alternatives and "Explore both" values are `"user"`.
- `Possibility.about` / `Possibility.basis`: the assumptions an AI suggestion depends on, their values when it was
  made, and the keys of what was known then (`factKey = id=answer`, so an edited answer counts as new information).
- `Possibility.setAside`: why the user set a suggestion aside after another look. Kept, never deleted; "Put back" undoes it.
- `Branch.revisits`: the approved looks (model, time, cause, summary, questions to verify, evidence).

## Deterministic reactions (`packages/core/src/reality/story.ts`)
- `describeChange(before, after)`: values changed, facts added/edited/removed, calculated results that changed,
  AI suggestions that depend on a changed value, and suggestions made before newly told facts.
- `staleSuggestions(r, b)`: an AI suggestion "may need a fresh look" when a value in its basis changed or the
  user told RealityFork something it was not based on. Suggestions without a basis (older files) are never flagged.
- Nothing qualitative is recalculated. The "what changed" text is a template filled with these computed values.

## Another look (`packages/core/src/reality/revisit.ts`)
- Request (`revisitRequest`): the question, the context answers, the path's name and description, its facts, its
  assumptions (value and who set it), its active suggestions (id, text, tone, AI or user) and `revisitCause`, a
  template sentence of what the user told us since. No other path, no ids of other paths, no fingerprints. Texts are
  clipped to the limits of `checkRevisitRequest`, which the server uses to rebuild the body from known fields only.
- Reply (`REVISIT_JSON_SCHEMA`, strict): `summary` (one sentence starting "Because"), `reconsider` (ids of this
  path's AI suggestions, with a reason), `add` (≤ 4 possibilities with tone and dependencies), `questions` (≤ 4, each
  ending with "?"), `evidence` (≤ 3). The AI cannot set values, add assumptions or touch the user's own notes.
- Checks (`validateRevisit`, on the server with bounded repair and again in the browser): no figures anywhere; no
  eligibility, legal-status, permit-availability or guarantee statements outside questions and evidence.
- Approval (`applyRevisit`): ticked additions are added, ticked reconsiderations are set aside with their reason,
  kept AI suggestions the AI saw are re-based on what is known now, and the look is recorded. The browser refuses to
  apply when the path's fingerprint changed after the request.

## UI (no new panels)
- Discover: one context question at a time (free text, example chips that only fill the field, Skip), then the
  futures with "Based on what you told us: … · Change", or "These futures are general · Answer a question to tailor
  them" when both were skipped.
- Explore, in the story column: **Known** (context answers with Change; path facts with Change/Remove; values the
  user set; "Add something you know"), **Possible** (with "may need a fresh look" tags and a "Set aside" list),
  **Calculated**, and "To verify before relying on this path" under Still unknown.
- Explore, next step (one primary action): a fresh look in progress or its preview → the next question (with "Not
  sure? Explore both" for yes/no and two-way choices) → "N AI suggestions may need a fresh look" with "Ask AI to take
  another look" and the quiet "Continue without AI" → compare. A "What changed" note sits above the card after edits.
- The fresh-look offer depends only on flagged suggestions: when another card is the primary step, it shows as a compact
  prompt under "What changed" with the same single button (secondary).
- Facts and open questions: `factMatches` (story.ts) finds open questions that share words with what the user said.
  The matched question is asked next and quotes the fact; the user gives the answer. Nothing is set from the text.
- Focus: each context question's heading takes focus; the preview's summary takes focus; after applying or dismissing,
  focus returns to the next-step area.
