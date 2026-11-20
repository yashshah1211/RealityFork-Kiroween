# RealityFork — The Hollow

**Tagline** · Walk through a what-if before you live it.

## Inspiration

A hard decision rarely comes down to a single number. A shop owner may need to pay a bill without losing the place their neighbours rely on. Writing a list of pros and cons makes it hard to see what changes if one assumption turns out differently. We wanted a way to preserve both paths and compare them after the decision had been explored.

## What it does

RealityFork is a browser-based decision explorer. The Hollow introduces it through Mara’s fictional bookshop. At the Keeper’s Desk you can sell the shop, keep it open, or share stewardship with the village. Visit the Whispering Well for a follow-up decision. Rewind to try another route, then use the Forking Mirror to compare who has access to the books, what happens to the debt, and how the work changes.

Bring your own question to the planner or open an example. With judge AI access, the planner can draft possible futures for review. Change an assumption to create a child path, compare it with the original, and ask for a fresh look when new information makes an earlier suggestion stale. RealityFork labels user inputs, calculations, and qualitative possibilities. Saved maps live in the current browser and can be exported as files.

## How we built it

React and Three.js render the Hollow and the 3D Atlas. TypeScript models choices and branch lineage. Mara’s two decisions lead to authored outcomes, and the village reflects the active story timeline. The main planner stores branches and provenance independently of the scene. A Node server handles the optional Groq integration, validates proposals before sending them to the browser, and requires a judge session in production. The browser validates a proposal again before committing it. The café example adds a distinct, seeded queue model with a benchmark against Erlang C. See the [Kiro development write-up](kiro-usage.md).

## Technical challenges

- A fork has to preserve the earlier path while moving only the assumptions that the visitor chose to change.
- Three-dimensional scenery needs to reflect the selected path without introducing new claims. The authored story can change the village. Scenery in the planner illustrates a path.
- A model reply can be incomplete or inconsistent. The planner validates replies, presents drafts for review, and keeps manual and built-in examples usable when inference is unavailable.
- The scene needs workable keyboard and touch controls, reduced-motion behavior, and a path back to the planner on devices without WebGL.

## Accomplishments

We shipped an explorable village with a two-decision, rewindable chapter and a side-by-side timeline comparison. We carried the same action into the planner, where a visitor can save a decision map, branch an assumption, compare the results, and revisit suggestions after learning more.

## What we learned

Scenario exploration needs a visible record of what changed and where each claim came from. A replayable model helps check the implementation. Showing the trade-off in the scene and in the comparison helps the visitor explain what they learned.

## What’s next

Observe first-time users testing real decisions, measure how quickly they can explain a trade-off, and use that evidence to improve orientation, accessibility, and draft review.

## Submission links

- [Live RealityFork and The Hollow](https://realityfork-final.onrender.com/?preview=atlas)
- [GitHub source](https://github.com/yashshah1211/RealityFork-Kiroween) · add to Devpost after visibility is approved.
- Public YouTube URL · add the verified link after recording and publication approval. [Video plan](demo.md)
- [Private judge testing copy](judge-testing.md) · intended for the private form field.

## Category and bonus prizes

**Enter Costume Contest.** The village, bookshop, well, and mirror teach visitors how to make, revisit, and compare choices. **Frankenstein** is the alternative for the 3D, branching, simulation, and model integration, but gives less emphasis to the interface’s role in the decision.

| Bonus | Recommendation and required evidence |
| --- | --- |
| Best Demo | Pursue through the main submission. Eligible entries are considered, with selection depending on presentation and overall scores. |
| Bonus Blog | Optional if an entrant publishes a public third-party blog within the submission period, explicitly identifies it as part of Kiroween 2026, and includes the URL. |
| Social Blitz | Optional if the entrant writes a personal post during the submission period, places `#KiroweenHackathon26` first, explains how Kiro changed their process, and supplies the public URL. |
| Ghost of Kiroween Past | Claim only after confirming Kiroween 2025 registration and this project’s independent origin. |
| Best Student Project | Claim only if all entrant team members qualify. Put the required enrollment and identity details in Devpost. |
| Best Startup Project | Claim only with confirmed founder status, LinkedIn profile, and startup website. |
| Best Kiro Crew App | No qualifying separate Kiro Crew app was identified. |

[Kiroween 2026 Official Rules](https://kiroween.devpost.com/rules)
