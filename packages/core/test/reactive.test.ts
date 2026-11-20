/**
 * R15: context-aware, reactive futures. Context questions and answers, no eligibility or legal claims in AI text,
 * suggestion dependencies and staleness, "what changed", the one-path re-evaluation (request, validation,
 * approval) and compatibility with files saved before R15.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { AI_POSSIBILITY_NOTE, checkContextAnswers, plannerMessage, proposalToReality, selectAll, validateProposal, type Proposal } from "../src/reality/proposal";
import {
  AI_REVISIT_NOTE, applyRevisit, checkRevisitRequest, isAiSuggestion, REVISIT_JSON_SCHEMA, revisitCause, revisitRequest, selectAllRevisit, validateRevisit,
  type RevisitRequest, type RevisitSuggestion,
} from "../src/reality/revisit";
import { branchStory, compareStory, describeChange, factMatches, knownView, staleSuggestions } from "../src/reality/story";
import { exportRealities, forkBranch, importRealities, knownKeys, setContext, updateBranch, type KnownFact, type Reality } from "../src/reality/reality";

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/reactive-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
const draft = (k: string): Proposal => structuredClone(fixtures[k]!);
const counter = () => {
  let n = 0;
  return () => `x${++n}`;
};
const errorsOf = (raw: unknown) => {
  const c = validateProposal(raw);
  return c.ok ? [] : c.errors;
};
const CONTEXT: KnownFact[] = [
  { id: "context-1", question: "Which country are you thinking of moving to?", answer: "Germany" },
  { id: "context-2", question: "How would you earn a living there?", answer: "existing remote job" },
];
const REMOTE = "Remote relocation to Germany";

async function relocation(contextUsed = true): Promise<Reality> {
  const p = draft("relocation-tailored");
  return proposalToReality("What if I moved to another country?", p, selectAll(p), { model: "test-model", createdAt: "2026-11-07T10:00:00.000Z", context: CONTEXT, contextUsed }, counter());
}
const named = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;
const textOf = (r: Reality, name: string) => named(r, name).possibilities.map((p) => p.text);
const answer = (r: Reality, name: string, key: string, value: number | string | boolean | null) =>
  updateBranch(r, named(r, name).id, { values: { [key]: value }, sources: { [key]: "user" } });
const addFact = (r: Reality, name: string, text: string) =>
  updateBranch(r, named(r, name).id, { facts: [...(named(r, name).facts ?? []), { id: `f${(named(r, name).facts ?? []).length + 1}`, question: "", answer: text }] });

describe("context questions in a draft", () => {
  it("every reactive fixture is a valid proposal", () => {
    for (const k of Object.keys(fixtures)) expect(errorsOf(draft(k)), k).toEqual([]);
  });
  it("allows at most two questions, each with up to four short examples and no figures", () => {
    const p = draft("relocation-first");
    const q = p.contextQuestions[0]!;
    expect(errorsOf({ ...p, contextQuestions: [q, q, q] })).toContain("contextQuestions: expected 0–2 items, got 3");
    expect(errorsOf({ ...p, contextQuestions: [{ ...q, examples: ["Germany", "Under $2,000 a month"] }] }).join(" ")).toMatch(/contextQuestions\[0\]\.examples\[1\] states a figure/);
    expect(errorsOf({ ...p, contextQuestions: [{ ...q, examples: ["a", "b", "c", "d", "e"] }] }).join(" ")).toMatch(/up to 4 short examples/);
    expect(errorsOf({ ...p, contextQuestions: [{ ...q, question: " " }] }).join(" ")).toMatch(/contextQuestions\[0\]\.question is empty/);
  });
  it("answers are checked and passed to the planner as facts from the user", () => {
    expect(checkContextAnswers(undefined)).toEqual([]);
    expect(checkContextAnswers([{ question: " Where? ", answer: " Germany " }])).toEqual([{ question: "Where?", answer: "Germany" }]);
    expect(typeof checkContextAnswers([{ question: "Where?", answer: "" }])).toBe("string");
    expect(typeof checkContextAnswers([{ question: "Where?", answer: "x".repeat(201) }])).toBe("string");
    expect(typeof checkContextAnswers(Array.from({ length: 5 }, () => ({ question: "q", answer: "a" })))).toBe("string");
    expect(typeof checkContextAnswers("Germany")).toBe("string");
    const msg = plannerMessage("What if I moved to another country?", [{ question: "Which country?", answer: "Germany" }]);
    expect(msg).toBe("Situation: What if I moved to another country?\nWhat the user told us (facts from the user):\n- Which country? Germany");
    expect(plannerMessage("What if?", [])).toBe("Situation: What if?");
  });
});

describe("no eligibility, legal-status or guarantee claims in AI text", () => {
  const base = () => draft("relocation-tailored");
  it("rejects them as statements", () => {
    expect(errorsOf({ ...base(), interpretation: "You qualify for a digital nomad visa in Germany." }).join(" ")).toMatch(/interpretation states eligibility/);
    const p = base();
    p.possibilities[0]!.text = "A visa is available for remote workers like you";
    expect(errorsOf(p).join(" ")).toMatch(/possibilities\[0\] states eligibility/);
    const q = base();
    q.limitations = ["Remote work is legally permitted in Germany."];
    expect(errorsOf(q).join(" ")).toMatch(/limitations\[0\] states eligibility/);
    const g = base();
    g.branches[0]!.description = "Income is guaranteed to continue after the move.";
    expect(errorsOf(g).join(" ")).toMatch(/branches\[0\]\.description states eligibility/);
  });
  it("allows them as questions or evidence to gather, and allows 'no guarantee'", () => {
    const p = base();
    p.questions = [...p.questions, "Are you eligible for a residence permit?"];
    p.missingEvidence = [...p.missingEvidence, "Whether a work permit is available for your nationality"];
    p.possibilities[3]!.text = "There is no guarantee of finding work quickly";
    expect(errorsOf(p)).toEqual([]);
  });
});

describe("what each suggestion depends on", () => {
  it("unknown dependency keys are dropped with a warning, not fatal", () => {
    const p = draft("relocation-tailored");
    p.possibilities[0]!.about = ["employerAllowsAbroad", "visaStatus"];
    const c = validateProposal(p);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.warnings).toContain("Ignored 1 dependency reference(s) to unknown assumptions.");
    expect(c.proposal.possibilities[0]!.about).toEqual(["employerAllowsAbroad"]);
  });

  it("the accepted map keeps the context, who set each value, and each suggestion's basis", async () => {
    const r = await relocation();
    expect(r.context).toEqual(CONTEXT);
    const root = r.branches[0]!;
    const remote = named(r, REMOTE);
    expect(remote.values.keepRemoteJob).toBe(true);
    expect(remote.sources).toEqual({ keepRemoteJob: "ai" });
    const employer = remote.possibilities.find((p) => p.text.startsWith("Your employer may not agree"))!;
    expect(employer.about).toEqual(["employerAllowsAbroad"]);
    expect(employer.basis).toEqual({ values: { employerAllowsAbroad: null }, known: knownKeys(r, remote) });
    expect(employer.note).toBe(AI_POSSIBILITY_NOTE);
    // Suggestions for every path keep one id across paths; their basis follows each path's own values.
    const sharedRoot = root.possibilities.find((p) => p.text === "Missing family and friends")!;
    expect(remote.possibilities.find((p) => p.text === "Missing family and friends")!.id).toBe(sharedRoot.id);
    // Nothing needs a fresh look right after the draft is accepted.
    for (const b of r.branches) expect(staleSuggestions(r, b)).toEqual([]);
    const [back] = await importRealities(exportRealities([r]));
    expect(back).toEqual(r);
  });

  it("when the draft could not use the answers, its suggestions are flagged as made before them", async () => {
    const r = await relocation(false);
    const stale = staleSuggestions(r, named(r, REMOTE));
    expect(stale.length).toBe(named(r, REMOTE).possibilities.length);
    expect(stale.every((s) => s.madeBefore && s.changed.length === 0)).toBe(true);
  });
});

describe("answers change a path: what changed, deterministically", () => {
  it("a changed value flags the suggestions that depend on it, and only those", async () => {
    const r0 = await relocation();
    const r1 = await answer(r0, REMOTE, "employerAllowsAbroad", true);
    const change = describeChange({ r: r0, b: named(r0, REMOTE) }, { r: r1, b: named(r1, REMOTE) });
    expect(change.values).toEqual([{ key: "employerAllowsAbroad", label: "Employer agrees to me working from Germany", unit: "", from: null, to: true }]);
    expect(change.dependent.map((p) => p.text)).toEqual(["Your employer may not agree to you working from another country"]);
    expect(change.madeBefore).toBe(0);
    expect(change.calculated).toEqual([]);
    expect(staleSuggestions(r1, named(r1, REMOTE)).map((s) => [s.possibility.text, s.changed, s.madeBefore])).toEqual([
      ["Your employer may not agree to you working from another country", ["Employer agrees to me working from Germany"], false],
    ]);
    // Known lists only what the user set, not the AI's choice that defines the path.
    expect(knownView(r1, named(r1, REMOTE)).values.map((x) => x.variable.key)).toEqual(["employerAllowsAbroad"]);
  });

  it("numbers recalculate only through formulas whose inputs all come from the user", async () => {
    const r0 = await relocation();
    let r = await answer(r0, REMOTE, "monthlyIncome", 4000);
    r = await answer(r, REMOTE, "livingCosts", 2500);
    const change = describeChange({ r: r0, b: named(r0, REMOTE) }, { r, b: named(r, REMOTE) });
    expect(change.calculated.map((c) => [c.formula.label, c.from.status, c.to])).toEqual([["Left each month", "missing", { status: "ok", value: 1500 }]]);
    expect(change.dependent.map((p) => p.text)).toEqual(["Living costs may differ from what you pay now"]);
    expect(change.empty).toBe(false);
  });

  it("something new the user tells us flags the earlier suggestions in that path as made before it", async () => {
    const r0 = await relocation();
    const r1 = await addFact(r0, REMOTE, "My employer allows me to work remotely");
    const change = describeChange({ r: r0, b: named(r0, REMOTE) }, { r: r1, b: named(r1, REMOTE) });
    expect(change.facts).toEqual([{ question: "", from: null, to: "My employer allows me to work remotely" }]);
    const active = named(r1, REMOTE).possibilities.length;
    expect(change.madeBefore).toBe(active);
    expect(staleSuggestions(r1, named(r1, REMOTE)).every((s) => s.madeBefore)).toBe(true);
    // Other paths did not hear it.
    expect(staleSuggestions(r1, named(r1, "Find a job in Germany first"))).toEqual([]);
    expect(knownView(r1, named(r1, REMOTE)).facts.map((f) => f.answer)).toEqual(["My employer allows me to work remotely"]);
  });

  it("editing a context answer applies to every path and keeps the original question", async () => {
    const r0 = await relocation();
    const r1 = await setContext(r0, [{ ...CONTEXT[0]!, answer: "Austria" }, CONTEXT[1]!]);
    expect(r1.question).toBe("What if I moved to another country?");
    const change = describeChange({ r: r0, b: named(r0, REMOTE) }, { r: r1, b: named(r1, REMOTE) });
    expect(change.facts).toEqual([{ question: CONTEXT[0]!.question, from: "Germany", to: "Austria" }]);
    for (const b of r1.branches) expect(staleSuggestions(r1, b).length).toBe(b.possibilities.length);
    // Removing every answer drops the field again.
    expect((await setContext(r1, [])).context).toBeUndefined();
  });

  it("the starting reality's suggestions follow its own values", async () => {
    const r = await relocation();
    const story = branchStory(r, r.branches[0]!);
    expect(story.known.context).toEqual(CONTEXT);
    expect(story.stale).toEqual([]);
    expect(story.toVerify).toEqual([]);
  });
});

describe("another look at one path: the request", () => {
  it("carries only the chosen path, the question, the context and who set each value", async () => {
    let r = await relocation();
    r = await answer(r, REMOTE, "employerAllowsAbroad", true);
    r = await addFact(r, REMOTE, "My employer allows me to work remotely");
    const b = named(r, REMOTE);
    const req = revisitRequest(r, b, revisitCause(r, b));
    const json = JSON.stringify(req);
    for (const other of ["Find a job in Germany first", "Stay and keep working remotely", "As things are", b.fingerprint, b.id, r.id]) expect(json).not.toContain(other);
    expect(req.question).toBe("What if I moved to another country?");
    expect(req.context).toEqual(CONTEXT.map(({ question, answer: a }) => ({ question, answer: a })));
    expect(req.known).toEqual([{ question: "", answer: "My employer allows me to work remotely" }]);
    expect(Object.fromEntries(req.assumptions.map((a) => [a.key, [a.value, a.source]]))).toEqual({
      keepRemoteJob: [true, "ai"], employerAllowsAbroad: [true, "user"], monthlyIncome: [null, "unset"], livingCosts: [null, "unset"],
    });
    expect(req.suggestions.every((s) => s.from === "ai")).toBe(true);
    expect(req.change).toBe("The user told us: My employer allows me to work remotely. Now set in this path: Employer agrees to me working from Germany: yes.");
    expect(checkRevisitRequest(req)).toEqual({ ok: true, request: req });
  });

  it("the server check keeps only known fields and rejects malformed bodies", async () => {
    const r = await relocation();
    const req = revisitRequest(r, named(r, REMOTE), "x");
    const sneaky = { ...req, otherBranches: ["Find a job in Germany first"], path: { ...req.path, fingerprint: "abc" }, assumptions: req.assumptions.map((a) => ({ ...a, secret: 1 })) };
    const checked = checkRevisitRequest(sneaky);
    expect(checked.ok && JSON.stringify(checked.request)).toBe(JSON.stringify(req));
    expect(checkRevisitRequest({ ...req, change: " " }).ok).toBe(false);
    expect(checkRevisitRequest({ ...req, assumptions: [{ ...req.assumptions[0]!, source: "server" }] }).ok).toBe(false);
    expect(checkRevisitRequest({ ...req, suggestions: Array.from({ length: 17 }, (_, i) => ({ ...req.suggestions[0]!, id: `s${i}` })) }).ok).toBe(false);
    expect(checkRevisitRequest(null).ok).toBe(false);
  });

  it("long names and notes are clipped so the request always passes the check", async () => {
    const r0 = await relocation();
    const b0 = named(r0, REMOTE);
    const r = await updateBranch(r0, b0.id, { name: "N".repeat(200), possibilities: [...b0.possibilities, { id: "own", text: "y".repeat(450), likelihood: "not-judged", note: "", source: "user" }] });
    const b = r.branches.find((x) => x.id === b0.id)!;
    const req = revisitRequest(r, b, "z".repeat(400));
    expect(checkRevisitRequest(req).ok).toBe(true);
    expect(req.path.name).toHaveLength(120);
    // R19: "user" only because this possibility records source "user". One with no recorded source is sent as "unrecorded".
    expect(req.suggestions.find((s) => s.id === "own")).toMatchObject({ from: "user", tone: "uncertain" });
    expect(req.change).toHaveLength(300);
  });
});

describe("another look at one path: the reply", () => {
  const reply = (req: RevisitRequest): RevisitSuggestion => ({
    summary: "Because your employer permits remote work, this path now needs a closer look at work authorization and living costs.",
    reconsider: [{ id: req.suggestions.find((s) => s.text.startsWith("Your employer may not agree"))!.id, reason: "You told us your employer permits remote work." }],
    add: [
      {
        text: "Your income could continue through the move", trigger: "your employer keeps employing you while you live in Germany",
        mechanism: "Your pay would not depend on finding a German employer.", downstream: "The move could be paid for without a gap in income.",
        uncertainty: "Whether working from Germany is permitted for you, and how your employer handles pay abroad.", tone: "upside", about: ["employerAllowsAbroad", "visaType"],
      },
      {
        text: "Your working hours could shift", trigger: "your team works in a different time zone",
        mechanism: "Meetings set for your team's daytime may fall early or late in Germany.", downstream: "",
        uncertainty: "Where your team is based and how flexible meeting times are.", tone: "uncertain", about: [],
      },
    ],
    questions: ["Is working from Germany legally permitted for you?", "How will the time-zone difference affect your working hours?"],
    evidence: ["Your employer's written approval to work from Germany"],
  });
  async function setup() {
    let r = await relocation();
    r = await answer(r, REMOTE, "employerAllowsAbroad", true);
    r = await addFact(r, REMOTE, "My employer allows me to work remotely");
    const b = named(r, REMOTE);
    const req = revisitRequest(r, b, revisitCause(r, b));
    return { r, b, req };
  }
  const errs = (raw: unknown, req: RevisitRequest) => {
    const c = validateRevisit(raw, req);
    return c.ok ? [] : c.errors.join(" | ");
  };

  it("the schema is strict-mode compatible", () => {
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(walk);
      }
      if (s.type === "array") walk(s.items as Record<string, unknown>);
    };
    walk(REVISIT_JSON_SCHEMA as unknown as Record<string, unknown>);
  });

  it("accepts a cautious reply and drops unknown dependency keys", async () => {
    const { req } = await setup();
    const c = validateRevisit(reply(req), req);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.suggestion.add[0]!.about).toEqual(["employerAllowsAbroad"]);
    expect(c.warnings).toEqual(["Ignored 1 dependency reference(s) to unknown assumptions."]);
  });

  it("rejects eligibility or legal claims as statements, but lets questions ask about them", async () => {
    const { req } = await setup();
    expect(errs({ ...reply(req), summary: "Because you are eligible for a digital nomad visa, this path looks simpler." }, req)).toMatch(/summary states eligibility/);
    expect(errs({ ...reply(req), add: [{ ...reply(req).add[0]!, text: "A work visa is available for remote employees" }] }, req)).toMatch(/add\[0\] states eligibility/);
    expect(errs({ ...reply(req), reconsider: [{ ...reply(req).reconsider[0]!, reason: "Remote work is legally permitted in Germany." }] }, req)).toMatch(/reconsider\[0\] states eligibility/);
    expect(errs({ ...reply(req), questions: ["Are you eligible for a residence permit?"] }, req)).toEqual([]);
  });

  it("rejects figures, statements posing as questions, and reconsidering what is not an AI suggestion of this path", async () => {
    const { r, req } = await setup();
    expect(errs({ ...reply(req), add: [{ ...reply(req).add[0]!, text: "Rent is about €1,200 a month" }] }, req)).toMatch(/add\[0\] states a figure/);
    expect(errs({ ...reply(req), questions: ["Check the rules"] }, req)).toMatch(/questions\[0\] must be a question/);
    expect(errs({ ...reply(req), reconsider: [{ id: "nope", reason: "x" }] }, req)).toMatch(/"nope" is not one of this path's AI suggestions/);
    // A suggestion that belongs only to another path (shared "every path" suggestions keep one id everywhere).
    const other = named(r, "Find a job in Germany first").possibilities.find((p) => p.text === "A job search can take a while")!.id;
    expect(req.suggestions.map((s) => s.id)).not.toContain(other);
    expect(errs({ ...reply(req), reconsider: [{ id: other, reason: "x" }] }, req)).toMatch(/is not one of this path's AI suggestions/);
    // A note the user wrote can never be targeted.
    const own = { ...req, suggestions: [...req.suggestions, { id: "own", text: "I like the idea", tone: "upside" as const, from: "user" as const }] };
    expect(errs({ ...reply(own), reconsider: [{ id: "own", reason: "x" }] }, own)).toMatch(/"own" is not one of this path's AI suggestions/);
    expect(errs({ ...reply(req), extra: 1 }, req)).toMatch(/revisit\.extra is not allowed/);
  });

  it("applies only the approved items to that path, sets aside instead of deleting, and records the look", async () => {
    const { r, b, req } = await setup();
    const c = validateRevisit(reply(req), req);
    if (!c.ok) throw new Error(c.errors.join("; "));
    const sel = { ...selectAllRevisit(c.suggestion), add: [true, false] };
    const next = await applyRevisit(r, b.id, req, c.suggestion, sel, { model: "test-model", at: "2026-11-07T11:00:00.000Z" }, counter());
    const after = next.branches.find((x) => x.id === b.id)!;
    const employer = after.possibilities.find((p) => p.text.startsWith("Your employer may not agree"))!;
    expect(employer.setAside).toBe("You told us your employer permits remote work.");
    expect(after.possibilities).toHaveLength(b.possibilities.length + 1);
    const added = after.possibilities.at(-1)!;
    expect(added).toMatchObject({
      text: "Your income could continue through the move", tone: "upside", note: AI_REVISIT_NOTE, likelihood: "not-judged", about: ["employerAllowsAbroad"],
      cause: { trigger: "your employer keeps employing you while you live in Germany", mechanism: "Your pay would not depend on finding a German employer.", downstream: "The move could be paid for without a gap in income.", uncertainty: "Whether working from Germany is permitted for you, and how your employer handles pay abroad." },
    });
    expect(isAiSuggestion(added)).toBe(true);
    expect(after.possibilities.some((p) => p.text === "Your working hours could shift")).toBe(false);
    expect(after.revisits).toEqual([{ model: "test-model", at: "2026-11-07T11:00:00.000Z", cause: req.change, summary: c.suggestion.summary, questions: c.suggestion.questions, evidence: c.suggestion.evidence }]);
    // The kept suggestions were seen with what is known now: nothing needs a fresh look any more.
    expect(staleSuggestions(next, after)).toEqual([]);
    const story = branchStory(next, after);
    expect(story.setAside.map((p) => p.text)).toEqual(["Your employer may not agree to you working from another country"]);
    expect(story.challenges.map((p) => p.text)).not.toContain("Your employer may not agree to you working from another country");
    expect(story.toVerify).toEqual(c.suggestion.questions);
    expect(story.toFindOut).toEqual(c.suggestion.evidence);
    // Every other path is untouched, byte for byte.
    for (const x of r.branches.filter((y) => y.id !== b.id)) expect(next.branches.find((y) => y.id === x.id)).toEqual(x);
    // Set-aside suggestions are not compared as active claims.
    const cmp = compareStory(next, b.id, named(next, "Find a job in Germany first").id);
    expect([...cmp.challenges.onlyA, ...cmp.challenges.both].map((p) => p.text)).not.toContain("Your employer may not agree to you working from another country");
    const [back] = await importRealities(exportRealities([next]));
    expect(back).toEqual(next);
  });

  it("an unknown path is refused", async () => {
    const { r, req } = await setup();
    await expect(applyRevisit(r, "missing", req, reply(req), selectAllRevisit(reply(req)), { model: "m", at: "t" })).rejects.toThrow(/no longer exists/);
  });
});

describe("compatibility with files saved before R15", () => {
  for (const name of ["realities-6e4b8f2.json", "realities-5b17057.json"]) {
    it(`${name} imports unchanged and works with the new views`, async () => {
      const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
      const realities = await importRealities(text);
      const stored = JSON.parse(text).realities.flatMap((r: { branches: { fingerprint: string }[] }) => r.branches.map((b) => b.fingerprint));
      expect(realities.flatMap((r) => r.branches.map((b) => b.fingerprint))).toEqual(stored);
      // Same content. (Import has always written `origin` after `branches`, so AI maps differ only in key order.)
      expect(JSON.parse(exportRealities(realities))).toEqual(JSON.parse(text));
      for (const r of realities) {
        expect(r.context).toBeUndefined();
        for (const b of r.branches) {
          expect(staleSuggestions(r, b)).toEqual([]);
          expect(knownView(r, b)).toEqual({ context: [], facts: [], values: [], notApplicable: [] });
          expect(checkRevisitRequest(revisitRequest(r, b, revisitCause(r, b))).ok).toBe(true);
        }
      }
    });
  }
  it("an AI map from before R15 still marks its suggestions as AI suggestions, so a fresh look can reconsider them", async () => {
    const [r] = await importRealities(readFileSync(fileURLToPath(new URL("./fixtures/realities-5b17057.json", import.meta.url)), "utf8"));
    const b = r!.branches[1]!;
    const req = revisitRequest(r!, b, revisitCause(r!, b));
    expect(req.change).toBe("The user asked for a fresh look at this path.");
    expect(req.suggestions.filter((s) => s.from === "ai").length).toBe(b.possibilities.filter((p) => p.note === AI_POSSIBILITY_NOTE).length);
    expect(req.assumptions.every((a) => a.source === "unset" || a.source === "unspecified")).toBe(true);
  });
});

describe("branches stay independent (property)", () => {
  it("answers and facts in one path never change any other path", async () => {
    const r0 = await relocation();
    const forks = r0.branches.filter((b) => b.parentId !== null);
    const op = fc.record({
      at: fc.integer({ min: 0, max: forks.length - 1 }),
      kind: fc.constantFrom("income", "costs", "employer", "fact"),
      n: fc.integer({ min: 0, max: 100_000 }),
      yes: fc.boolean(),
    });
    await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 6 }), async (ops) => {
      let r = r0;
      for (const o of ops) {
        const b = r.branches.find((x) => x.id === forks[o.at]!.id)!;
        const before = r;
        r = o.kind === "fact"
          ? await addFact(r, b.name, `Fact ${o.n}`)
          : await answer(r, b.name, o.kind === "income" ? "monthlyIncome" : o.kind === "costs" ? "livingCosts" : "employerAllowsAbroad", o.kind === "employer" ? o.yes : o.n);
        for (const x of before.branches.filter((y) => y.id !== b.id)) expect(r.branches.find((y) => y.id === x.id)).toEqual(x);
      }
    }), { numRuns: 25 });
  });

  it("a path branched from another keeps the facts it was given and goes its own way", async () => {
    let r = await relocation();
    r = await addFact(r, REMOTE, "My employer allows me to work remotely");
    const f = await forkBranch(r, named(r, REMOTE).id, { name: "Remote, employer says no" }, counter());
    expect(f.branch.facts).toEqual(named(r, REMOTE).facts);
    r = await answer(f.reality, "Remote, employer says no", "employerAllowsAbroad", false);
    expect(named(r, REMOTE).values.employerAllowsAbroad).toBeNull();
    expect(textOf(r, "Remote, employer says no")).toEqual(textOf(r, REMOTE));
  });
});

describe("connecting what the user said to an open question (user-testing regression)", () => {
  const REPORTED = "My employer has explicitly approved me working remotely from Germany.";
  async function withLabel(label: string) {
    const p = draft("relocation-tailored");
    p.variables = p.variables.map((v) => (v.key === "employerAllowsAbroad" ? { ...v, label } : v));
    return proposalToReality("What if I moved to another country?", p, selectAll(p), { model: "test-model", createdAt: "2026-11-07T10:00:00.000Z", context: CONTEXT }, counter());
  }

  it("the reported sentence points to the matching open question, under either wording of it", async () => {
    for (const label of ["Employer allows work from abroad", "Employer agrees to me working from Germany"]) {
      const r = await addFact(await withLabel(label), REMOTE, REPORTED);
      const b = named(r, REMOTE);
      const matches = factMatches(r, b);
      expect(matches.map((m) => m.variable.label), label).toEqual([label]);
      expect(matches[0]!.facts.map((f) => f.answer)).toEqual([REPORTED]);
      expect(branchStory(r, b).matches).toEqual(matches);
    }
  });

  it("it is only a pointer: no value is set, and the question stays unknown until the user answers", async () => {
    const r0 = await withLabel("Employer allows work from abroad");
    const r = await addFact(r0, REMOTE, REPORTED);
    const b = named(r, REMOTE);
    expect(b.values).toEqual(named(r0, REMOTE).values);
    expect(b.values.employerAllowsAbroad).toBeNull();
    expect(b.sources).toEqual({ keepRemoteJob: "ai" });
    expect(branchStory(r, b).unknowns.map((u) => u.variable.key)).toContain("employerAllowsAbroad");
    // Once the user answers, the question is no longer open, so nothing points to it any more.
    const answered = await answer(r, REMOTE, "employerAllowsAbroad", true);
    expect(factMatches(answered, named(answered, REMOTE))).toEqual([]);
    expect(named(answered, REMOTE).sources).toEqual({ keepRemoteJob: "ai", employerAllowsAbroad: "user" });
  });

  it("is conservative: one shared word with a longer name is not enough", async () => {
    const r = await relocation();
    // The context answer "Germany" shares one word with "Employer agrees to me working from Germany" and "Living costs in Germany".
    for (const name of [REMOTE, "Find a job in Germany first"]) expect(factMatches(r, named(r, name)), name).toEqual([]);
    const other = await addFact(r, REMOTE, "I enjoy remote meetings");
    expect(factMatches(other, named(other, REMOTE))).toEqual([]);
    // Two shared words do count: where "Keep my current remote job" is still open, "existing remote job" points to it.
    const stay = named(r, "Stay and keep working remotely");
    expect(factMatches(r, stay).map((m) => [m.variable.key, m.facts.map((f) => f.answer)])).toEqual([["keepRemoteJob", ["existing remote job"]]]);
  });

  it("a short name matches when most of its words are used; numbers are never read out of the text", async () => {
    const p = draft("restaurant-tailored");
    let r = await proposalToReality("What if I opened a restaurant?", p, selectAll(p), { model: "m", createdAt: "2026-11-07T10:00:00.000Z" }, counter());
    r = await addFact(r, "Small café", "Our start-up budget is about 25 lakh rupees");
    const b = named(r, "Small café");
    expect(factMatches(r, b).map((m) => m.variable.key)).toEqual(["startupBudget"]);
    expect(b.values.startupBudget).toBeNull();
  });

  it("only looks at the path itself and the context; other paths' facts do not count", async () => {
    const r = await addFact(await withLabel("Employer allows work from abroad"), REMOTE, REPORTED);
    const stay = named(r, "Stay and keep working remotely");
    expect(stay.values.employerAllowsAbroad).toBeNull();
    expect(factMatches(r, stay).map((m) => m.variable.key)).toEqual(["keepRemoteJob"]); // from the context answer only
  });

  it("copes with any text: punctuation, accents and other scripts", async () => {
    const r0 = await relocation();
    for (const text of ["¿Mi empleador está de acuerdo?", "雇主同意", "—", "Employer, employer!!! WORKING… from: Germany?"]) {
      const r = await addFact(r0, REMOTE, text);
      expect(() => factMatches(r, named(r, REMOTE))).not.toThrow();
    }
    const r = await addFact(r0, REMOTE, "Employer, employer!!! WORKING… from: Germany?");
    expect(factMatches(r, named(r, REMOTE)).map((m) => m.variable.key)).toEqual(["employerAllowsAbroad"]);
  });
});
