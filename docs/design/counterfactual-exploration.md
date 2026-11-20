# R17 plan: interactive counterfactual exploration

## Already there (reused, not duplicated)
| Piece | Where |
|---|---|
| Fork a path; values, facts, sources, possibilities (with basis) copied; parent untouched; lineage and fingerprints | `forkBranch`, `updateBranch` (core) |
| One-tap fork on a different *choice* or *yes/no* | `PathSheet` + `forkChoices`; R16 "Explore a different choice" link; "Not sure? Explore both" |
| Name a new path | `PathSheet` form |
| What changed between two states of a path: values, facts, calculations, dependent suggestions, suggestions made before new facts | `describeChange` (story.ts) |
| Suggestions flagged when their basis no longer matches; "Ask AI to take another look" | `staleSuggestions`, `FreshLookPrompt` / `FreshLookCard` |
| Side-by-side comparison with calculated differences only when both sides have numbers | `compareStory`, `CompareView` |

## Missing
1. A new path with a different **number** (e.g. income, running costs): `forkChoices` skips numbers.
2. An entry point on **every suggestion**: draft suggestions (no cause) have no "change this" action.
3. A **user-described** change ("I negotiate a higher salary") that the path records, so earlier suggestions are flagged.
4. A **parent vs new path** summary that separates calculated changes, the user's changes and possible consequences
   needing another look.
5. Compare lists copied suggestions as "In both" even when the change may undermine them on one side.

## One mechanism for every situation
- Each suggestion gets a quiet **"What if this changed?"** link. It opens the existing next-step sheet slot with:
  - the assumptions the AI linked it to (`about`), first, labelled as the AI's link; then the other assumptions;
  - per assumption: a number field (the user's value only) or one tap per other choice;
  - "Or describe a different change" (free text, saved on the new path as a change being explored: a hypothetical, shown
    as "Exploring: …", never as a fact the user told us; since R18.1 "Explore another path from here" has the same field
    and the same operation, see docs/validation/r18-1-truth-and-safety.md).
- Creating it calls one store operation, `exploreChange(fromId, change, possibilityId)`: fork, then set the value with
  source "user", or add the text as a path fact whose question is `INTERVENTION_QUESTION` (a hypothetical). Reuses a
  sibling with the same change instead of duplicating it.
- The new path shows **"What this change does"**, compared with its parent: *Changed by you*; *Calculated*, formulas
  only, or what they still need; *Possible: may no longer hold, not recalculated*, with the existing "Ask AI to take
  another look". Built from `describeChange(parent, child)` in a new story.ts view, so the UI only formats it.
- Compare tags suggestions that may need a fresh look on either side.
- The R16 "Explore a different choice" link is replaced by the new link (one entry point).

No new AI request type, no new data fields, no new panels.
