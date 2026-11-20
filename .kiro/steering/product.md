---
inclusion: always
---

# RealityFork: product intent

RealityFork is **Git for reality**: a universal platform where anyone describes a situation
("What if I moved to London?"), forks it into alternative realities, changes assumptions and
compares the consequences. Describe → fork → change → explore → compare.

It is not a queue simulator or staffing tool. Those are one optional specialized example
(validated simulators reached through an adapter, and the `#staffing` tool). New situations
must work without new code. Outcomes are always labelled Calculated (user formulas),
Simulated (validated models only) or Speculative (user judgement); missing assumptions are
named, never invented.

## Default experience (visual-first journey)
Imagine → Discover → Explore → Branch → Compare (docs/design/visual-first-journey.md).
- One primary action per stage; secondary actions stay quiet (links, the More menu, "All details").
- Plain words in the default view: "future", "path", "decision", never "fork", "branch", "fingerprint" or "variable".
- Show unknowns as questions (one at a time), not as tables of "unknown". Numbers appear only when a formula has
  every input from the user. AI-suggested content is always labelled as possibilities, not predictions.
- Choosing a future in Discover is the approval: nothing is created before it.
- Respect reduced motion; keep keyboard focus on the new stage's heading after each transition.
- Context (R15): at most two optional questions before the futures, one at a time, free text, always skippable.
  In a path, show three kinds of content: **Known** (what the user told us), **Calculated** (formulas with every input
  from the user) and **Possible** (suggestions, never predictions). After an answer, say what changed. A fresh AI look
  at a path happens only when the user asks for it, is previewed, and changes nothing until approved; reconsidered
  suggestions are set aside, never deleted. Do not create paths automatically for answers ("Explore both" is explicit).
- A consequence the AI adds says why: "Y could happen if X", then what it could change, and (on request) why, what it
  depends on and what could change it. A research task is never shown as a consequence; things to find out are questions.

## Who it is for
Anyone facing a decision who is not a modelling expert: individuals, households, students,
small-business operators, civic planners. The long-term goal is a general-purpose platform,
not a single-domain simulator.

## Experience principles
- Plain-language labels with units. No jargon without an explanation.
- Every number shown must be traceable to a calculation the user can inspect.
- Results are model estimates under stated assumptions, never predictions.
- Branching must feel as lightweight as duplicating a document.
