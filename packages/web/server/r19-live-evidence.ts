/**
 * What R19's local figure reader makes of a draft: shared by the live step (r19-live.ts, which makes the provider requests) and
 * by r19-live-reread.ts (which recomputes this from the SAVED replies with the current code, making no request at all).
 * Pure given its inputs; no network.
 */
import { appliedFigures, evaluateBranch, figurePlan, proposalToReality, selectAll, type Proposal } from "@realityfork/core";

export async function figureEvidence(question: string, proposal: Proposal, model: string): Promise<Record<string, unknown>> {
  const sel = selectAll(proposal);
  const plan = figurePlan(question, proposal, sel);
  const label = (key: string | null) => (key ? proposal.variables.find((v) => v.key === key)?.label ?? key : null);
  const rows = plan.rows.map((r) => ({
    words: r.stated.text, value: r.stated.value, goesTo: label(r.chosenVariable), unit: r.chosenVariable ? proposal.variables.find((v) => v.key === r.chosenVariable)?.unit ?? "" : null,
    status: r.status, tickedByDefault: r.use, target: r.target, notes: r.notes, candidates: r.candidates.map(label), blocked: r.blocked,
  }));
  const out: Record<string, unknown> = {
    variables: proposal.variables.map((v) => ({ key: v.key, label: v.label, kind: v.kind, unit: v.unit })),
    futures: proposal.branches.map((b) => b.name),
    figureRows: rows,
    notUsed: plan.unused,
    planReady: plan.ready,
    planProblem: plan.problem,
  };
  // What the user gets by pressing "Use these figures" with the defaults and then opening the first future.
  if (plan.ready) {
    const figures = appliedFigures(plan, 0, proposal.branches.map(() => true));
    const r = await proposalToReality(question, proposal, sel, { model, createdAt: "2026-11-10T00:00:00.000Z", figures });
    const opened = r.branches.find((b) => b.parentId === r.branches[0]!.id && b.name === proposal.branches[0]!.name)!;
    out.afterDefaultConfirmation = {
      appliedValues: Object.fromEntries(figures.map((f) => [label(f.variable), f.value])),
      openedFuture: opened.name,
      calculated: evaluateBranch(r, opened).calculated.map((c) => ({ label: c.formula.label, status: c.result.status, value: c.result.status === "ok" ? c.result.value : null })),
      stillUnknown: r.variables.filter((v) => v.kind === "number" && opened.values[v.key] === null).map((v) => v.label),
    };
  }
  return out;
}
