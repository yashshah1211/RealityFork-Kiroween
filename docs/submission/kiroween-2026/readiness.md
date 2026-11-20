# RealityFork submission readiness

The accepted hosted build is identified by runtime revision `1d95db28fc78e24ef5b690327a3a39c83785cf9c`. This independent source snapshot preserves the reviewed application logic, dependency lockfile and Kiro files. Its London model includes the Wayfinder’s Shelter, and its production build serves the static license notice. Both distribution changes await separate deployment approval. [Hosted application](https://realityfork-final.onrender.com/?preview=atlas)

## Mandatory requirements

| Requirement | Status | Evidence or action |
| --- | --- | --- |
| Kiroween 2026 registration | PASS | Registration evidence was reviewed. Confirm the final team roster and entry owner in Devpost. |
| Eligible entrant, residence, age, team size and representative | BLOCKED | Entrant confirms eligibility, authority, exclusions and conflicts. |
| Project created during the submission window and disclosure of earlier work | BLOCKED | Reviewed dates fit the window. Entrant confirms project origin, any earlier work and other submissions. |
| Functional application built with Kiro | PASS | Tracked specs and tests, actual IDE work, steering records and a completed hook invocation. [Kiro evidence](kiro-usage.md) |
| Running demo, supported platform and source installation | PASS | The hosted build and the keyless local workflows were verified. [Local setup](../../../README.md#run-locally) |
| Free judge testing through January 29, 2027 | BLOCKED | The public chapter and planner are available. The gated AI feature has finite limits and needs written organizer clarification, private access and continued availability. [Judge information](judge-testing.md) |
| Feature description and Kiro write-up | PASS | [Devpost copy](devpost.md) and [Kiro write-up](kiro-usage.md). |
| Public YouTube video of the working app | MISSING | The planned cut is 2:49. Live generation and Revisit footage, clearance, captions and the public upload are pending. [Video plan](demo.md) |
| Ownership, third-party rights and deployment notices | BLOCKED | This source and its local build carry full notices and the original Wayfinder’s Shelter. Entrant ownership and final footage clearance remain open. The matching hosted model and notices await separate approval. [Asset credits](asset-credits.md) |
| Public open-source GitHub repository with complete runnable source, assets and root `/.kiro` | BLOCKED | The replacement snapshot is prepared locally for review. The root MIT license and eight Kiro files are present. Verify GitHub’s MIT detection and signed-out access after publication approval. |
| Category, bonuses and English materials | PASS | Costume Contest is recommended. Confirm any optional bonus qualifies. The written materials are in English. |
| Complete and submit Devpost entry before the deadline | MISSING | Entrant validates the final form and submits by December 4, 2026 at 2:00 p.m. PST. |

[Kiroween 2026 Official Rules](https://kiroween.devpost.com/rules)

## Origin and pre-existing work

- The submission period started October 30, 2026. The earliest project-named IDE metadata located is November 1, with no accompanying implementation transcript.
- The November 7 Kiro session contains project research. The original repository's first commit dates to November 7 and contains the core prototype, the Kiro artifacts, property tests and the initial benchmark.
- The universal workflow also dates to November 7. The inspected London Blender source and export have November 14 file timestamps. The cinematic experience entered the repository on November 17. The reviewed chapter and entrance were accepted on November 19.
- The review supports development during the submission window. Only the entrant can attest to original rights and disclose earlier or imported work that might be outside the recorded timeline.

## Validation evidence

The accepted runtime passed type checking, production build, 499 core and 258 web tests, the deterministic M/M/c benchmark, and 44 production-mode Chromium checks. The live entry bundle fingerprints matched the accepted build. Firefox and WebKit passed a narrow-width planner comparison. The accepted release test used mocked provider responses. An earlier authorized live check successfully used both generation and Revisit on the same AI implementation.

The source distribution includes the original test suites, synthetic datasets, reviewed offline fixtures and selected technical reports. Historical QA media, raw run logs and original Git metadata stay in the private archive. [Benchmark report](../../validation/benchmark-report.md) · [Reproducibility notes](../../validation/reproducibility.md) · [Atlas notes](../../validation/atlas-3d/README.md)

The reviewed lockfile includes development-tool advisories. The production-only npm audit returned zero findings. A patched development-toolchain candidate was assessed separately. This distribution preserves the reviewed lockfile and uses a plain Node production server.
