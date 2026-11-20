# How we used Kiro

We used the **Kiro IDE** to develop the decision engine and work through later Atlas and planner changes. The core spec started with a seeded staffing model, where we could check results against a known benchmark, then expanded to universal branching, validated AI drafts and Revisit. The same branch-and-compare interaction appears in the finished game-like introduction.

## Requirements, design and tasks

- [Requirements](../../../.kiro/specs/realityfork-core/requirements.md) expressed behaviors an implementation could be checked against. R1–R5 cover seeding, simulation, scenario ancestry and comparison. R12–R19 carry forward editable assumptions and saved paths, validation of drafts, conditional consequences, context changes and supported input handling.
- [Design](../../../.kiro/specs/realityfork-core/design.md) describes the package boundaries, named random streams, simulation measurements, scenario fingerprints and comparisons. We could review when a number should stay identical after a fork and which fields must change.
- [Tasks](../../../.kiro/specs/realityfork-core/tasks.md) put RNG and benchmark work before user-facing branching. They record the correctness review, regression cases and the still-open participant study. The original November 7 implementation and its initial artifacts were reviewed for this account. The [development timeline](readiness.md#origin-and-pre-existing-work) records that evidence. The local IDE spec registry links `realityfork-core` to the November 7 project session.

## Steering and the test hook

The [product](../../../.kiro/steering/product.md), [technology](../../../.kiro/steering/tech.md) and [claims policy](../../../.kiro/steering/claims-policy.md) files were included in real Kiro IDE turns. In the Phase 3.5 session an additional event included [simulation correctness](../../../.kiro/steering/simulation-correctness.md) for core work. This kept the difference between inputs, calculations and qualitative possibilities in scope. The simulation steering also defines separate seeded streams and consistent measurement windows so a comparison cannot silently mix different bases.

The [Run core tests on save hook](../../../.kiro/hooks/core-tests-on-save.json) matches TypeScript saves under `packages/core/src` and runs `npm test --silent`. At the accepted release `npm test` runs both core and web suites. In **Resume RealityFork Phase 3.5 Implementation**, at **17:40:38 IST on November 16**, the IDE recorded a `ContextualHookInvoked` event for `core-tests-on-save.json#hook-0`, action `runCommand`, status `completed`. This supports a completed invocation. It establishes neither a count across all sessions nor a standalone test pass result.

## Where it helped

| Example | What the evidence shows |
| --- | --- |
| Reproducible branches | R4 makes canonical identity and parent immutability explicit. [Canonical tests](../../../packages/core/test/canonical.test.ts) exercise generated values and stable representations. [Scenario tests](../../../packages/core/test/scenario.test.ts) check invariants and reject changed bundles. |
| Checking the simulator | [Queue tests](../../../packages/core/test/queue.test.ts) generate random seeds, rates, schedules of arrivals and service times, and server counts. They compare independent recurrences and assert invariants such as conservation and bounds. Task 9.4 records a concrete fast-check case where a floating-point rate multiplied by its observation window did not equal the integer departures. The implementation rounds the reconstructed count and the regression case stays in the suite. |
| Expanding from prototype to product | The November 7 IDE session **Build Universal Reality Forking Platform** records the task to expand the staffing prototype into what-if maps, branching and comparisons, with product, claims and technology steering included. R12 and the [visual-first journey notes](../../design/visual-first-journey.md) describe the resulting design. |
| Making the Atlas usable | The IDE records for **3D branching-reality prototype**, **RealityFork Product Redesign for Kiroween**, and the November 16 product sessions contain inspection, edits and validation around the Atlas and its fallback. The [3D validation notes](../../validation/atlas-3d/README.md) show how the 3D view fits the same functional planner. |

## Authentic session references

| Local IDE record | Evidence suitable for an approved recording |
| --- | --- |
| November 7, **Release figure preselection fix** | Original project research appears early in the session. The local spec registry associates it with `realityfork-core`. Show the repository requirements, design and tasks alongside the relevant IDE history. |
| November 7, **Build Universal Reality Forking Platform** | The user request for the universal branchable decision app and the IDE’s steering inclusion event. |
| November 13–15, **3D branching-reality prototype** and **RealityFork Product Redesign for Kiroween** | Project-specific Atlas work and the snapshots and tests for the 3D view. |
| November 16, **RealityFork Phase 3: Complete Product Experience** and **Resume RealityFork Phase 3.5 Implementation** | IDE steering inclusion records and the completed hook event. |

Session titles and events were checked in authenticated local IDE records. The record above removes local account paths, session identifiers, unrelated conversations and tool output. For the video, show the actual Kiro IDE and tracked files. Review the frame for private information before recording.

## Attribution

Kiro-assisted work includes the specs, early prototype and universal workflow, plus later Atlas and product work evidenced by IDE sessions. Some of those later Kiro sessions were ordinary chat sessions that used existing steering and specs. Codex chat history corroborates the subsequent haunted landing, Hollow and bookshop milestones, acceptance testing, signed judge access and submission preparation. The chapter and deployment work span multiple tools and dates. This submission credits the Kiro work for which evidence was recovered and makes no claim for Crew, custom agents, MCP or powers. Groq is an app runtime integration.
