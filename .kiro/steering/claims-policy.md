---
inclusion: always
---

# Claims policy

RealityFork outputs are **model estimates under stated assumptions**. They are not
predictions of real-world outcomes.

- Never present a simulated number as what *will* happen.
- Every comparison distinguishes these four things:
  - **Direct calculation**: an arithmetic difference between two runs.
  - **Model-estimated effect**: the effect of one parameter change in the model, with the other inputs held fixed.
  - **Interaction**: the part of the combined effect not explained by the sum of the one-at-a-time effects.
  - **Uncertainty**: the confidence interval across replications. Differences whose CI contains 0 are labeled "not distinguishable from noise".
- Real-world **causal claims** are out of scope unless validated against observed
  outcomes. Say so explicitly.
- No LLM may generate, adjust or "explain away" a numerical result. Explanatory text
  is built from templates filled with computed values.
- Synthetic data must be labeled synthetic everywhere it appears.
- Documentation and reports must not claim performance, accuracy or reliability that
  has not been measured. Paste real output.
