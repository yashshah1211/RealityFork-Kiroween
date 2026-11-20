import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { AI_POSSIBILITY_NOTE, PROPOSAL_JSON_SCHEMA, proposalToReality, selectAll, usableFormulas, validateProposal, type Proposal } from "../src/reality/proposal";
import { compareBranches, evaluateBranch, exportRealities, importRealities } from "../src/reality/reality";

const fixture = (): Proposal => JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/restaurant-proposal.json", import.meta.url)), "utf8"));
let n = 0;
const ids = () => `p${++n}`;
const errorsOf = (p: unknown) => {
  const r = validateProposal(p);
  return r.ok ? [] : r.errors;
};

describe("proposal validation", () => {
  it("the schema is strict-mode compatible: every object lists all properties as required and forbids extras", () => {
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(walk);
      }
      if (s.type === "array") walk(s.items as Record<string, unknown>);
    };
    walk(PROPOSAL_JSON_SCHEMA as unknown as Record<string, unknown>);
  });

  it("accepts a well-formed proposal", () => {
    expect(validateProposal(fixture()).ok).toBe(true);
  });

  it("rejects malformed structure", () => {
    expect(errorsOf(null)[0]).toMatch(/must be an object/);
    expect(errorsOf({ ...fixture(), extra: 1 })).toContain("proposal.extra is not allowed");
    const { limitations: _l, ...noLimits } = fixture();
    expect(errorsOf(noLimits)).toContain("proposal.limitations is missing");
    expect(errorsOf({ ...fixture(), branches: fixture().branches.slice(0, 1) })[0]).toMatch(/branches: expected 2–3/);
  });

  it("rejects invented figures, probabilities and numeric settings", () => {
    const p = fixture();
    expect(errorsOf({ ...p, interpretation: "Most restaurants fail: 60% close in a year." })[0]).toMatch(/states a figure/);
    expect(errorsOf({ ...p, questions: ["Can you afford $50,000?"] })[0]).toMatch(/states a figure/);
    expect(errorsOf({ ...p, limitations: ["There is a probability of 0.3 of failure"] })[0]).toMatch(/states a figure/);
    expect(errorsOf({ ...p, missingEvidence: ["Rent is about 2k per month"] })[0]).toMatch(/states a figure/);
    const b = structuredClone(p);
    b.branches[0]!.settings.push({ variable: "monthlyRevenue", value: "8000" });
    expect(errorsOf(b)[0]).toMatch(/number assumptions cannot be set/);
    const f = structuredClone(p);
    f.formulas[0]!.expression = "monthlyRevenue * 0.3";
    expect(errorsOf(f)[0]).toMatch(/uses the number 0.3/);
    const ok = structuredClone(p);
    ok.formulas[0]!.expression = "(monthlyRevenue - monthlyCosts) * 12";
    expect(validateProposal(ok).ok).toBe(true);
  });

  it("rejects formulas over unknown names, bad options and unknown branches", () => {
    const p = structuredClone(fixture());
    p.formulas[0]!.expression = "revenue - costs";
    p.branches[0]!.settings[0]!.value = "food truck";
    p.possibilities[0]!.branch = "Somewhere else";
    const e = errorsOf(p);
    expect(e.some((x) => /unknown names?: revenue, costs/.test(x))).toBe(true);
    expect(e.some((x) => /not an option/.test(x))).toBe(true);
    expect(e.some((x) => /unknown branch/.test(x))).toBe(true);
  });
});

describe("five unrelated domains (mocked provider replies)", () => {
  const others = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/domain-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
  const all: [string, Proposal][] = [["What if I opened a restaurant?", fixture()], ...Object.entries(others)];
  it.each(all)("%s → valid proposal → reality graph with unknown numbers, comparable branches, export round trip", async (q, p) => {
    expect(validateProposal(p)).toMatchObject({ ok: true });
    const r = await proposalToReality(q, p, selectAll(p), { model: "mock", createdAt: "2026-11-07T00:00:00Z" }, ids);
    expect(r.branches).toHaveLength(p.branches.length + 1);
    expect(r.variables.filter((v) => v.kind === "number").every((v) => r.branches.every((b) => b.values[v.key] === null))).toBe(true);
    // No calculated outcome can produce a number until the user enters values.
    for (const b of r.branches) expect(evaluateBranch(r, b).calculated.every((c) => c.result.status !== "ok")).toBe(true);
    const c = compareBranches(r, r.branches[1]!.id, r.branches[2]!.id);
    expect(c.assumptions.length).toBe(p.variables.length);
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
  });
});

describe("accepted proposal → reality", () => {
  it("uses the normal operations: unknown numbers, choices set per branch, unreviewed formulas, unjudged possibilities", async () => {
    const p = fixture();
    const r = await proposalToReality("What if I started my own restaurant?", p, selectAll(p), { model: "openai/gpt-oss-120b", createdAt: "2026-11-07T00:00:00Z" }, ids);
    expect(r.branches.map((b) => b.name)).toEqual(["As things are", "Small café, owner-run", "Full restaurant with staff", "Keep my current job"]);
    expect(r.branches.every((b) => b.values.monthlyRevenue === null)).toBe(true);
    expect(r.branches[1]!.values).toMatchObject({ format: "café", hireStaff: false });
    expect(r.branches[2]!.values).toMatchObject({ format: "full restaurant", hireStaff: true });
    expect(r.formulas.every((f) => !f.reviewed)).toBe(true);
    expect(evaluateBranch(r, r.branches[1]!).missingAssumptions).toEqual(["Sales per month", "Running costs per month", "Start-up cost"]);
    expect(r.branches[1]!.possibilities.map((x) => [x.text, x.tone ?? "unsorted"])).toEqual([
      ["Local competition changes", "unsorted"],
      ["Full control over the menu and atmosphere", "upside"],
      ["Long hours leave little time for family", "challenge"],
    ]);
    expect(r.branches.flatMap((b) => b.possibilities).every((x) => x.likelihood === "not-judged" && x.note === AI_POSSIBILITY_NOTE)).toBe(true);
    // Provenance is structured: the draft's model, acceptance time, missing evidence and limitations.
    expect(r.description).toBe(p.interpretation);
    expect(r.questions).toEqual(p.questions);
    expect(r.origin).toEqual({ kind: "ai", model: "openai/gpt-oss-120b", acceptedAt: "2026-11-07T00:00:00Z", evidence: p.missingEvidence, limitations: p.limitations });
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
    // The origin record is covered by the fingerprints: editing it in an exported file is detected.
    await expect(importRealities(exportRealities([r]).replace("openai/gpt-oss-120b", "someone-else"))).rejects.toThrow(/fingerprint does not match/);
  });

  it("rejects a possibility tone outside upside / challenge / uncertain", () => {
    const p = structuredClone(fixture());
    (p.possibilities[0] as { tone: string }).tone = "certain";
    expect(errorsOf(p).some((e) => /tone must be one of/.test(e))).toBe(true);
  });

  it("dropped items are left out; formulas that need a dropped assumption are left out too", async () => {
    const p = fixture();
    const sel = { ...selectAll(p), branches: [true, false, true], variables: p.variables.map((v) => v.key !== "startupCost") };
    expect(usableFormulas(p, sel)).toEqual([true, false]);
    const r = await proposalToReality("What if I started my own restaurant?", p, sel, { model: "m", createdAt: "2026-11-07T00:00:00Z" }, ids);
    expect(r.branches.map((b) => b.name)).toEqual(["As things are", "Small café, owner-run", "Keep my current job"]);
    expect(r.formulas.map((f) => f.label)).toEqual(["Profit per month"]);
    expect(r.variables.some((v) => v.key === "startupCost")).toBe(false);
  });
});
