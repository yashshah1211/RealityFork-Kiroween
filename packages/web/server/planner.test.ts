import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkRevisitRequest, MAX_QUESTION_LENGTH, PLANNER_SYSTEM_PROMPT, proposalToReality, REVISIT_SYSTEM_PROMPT, revisitCause, revisitRequest, selectAll, updateBranch, type Proposal, type RevisitRequest } from "@realityfork/core";
import { BODY_LIMITS, createPlanner, validateProviderProposal, validateProviderRevisit } from "./planner";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../e2e/fixtures/restaurant-proposal.json", import.meta.url)), "utf8"));
const reactive = JSON.parse(readFileSync(fileURLToPath(new URL("../e2e/fixtures/reactive-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
const KEY = "gsk_test_SECRET_123";

function fakeFetch(replies: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const completion = (content: unknown) => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 1234 } }, headers: { "x-ratelimit-remaining-requests": "999" } });

describe("server-side planner adapter", () => {
  it("without a key it refuses and explains the manual fallback", async () => {
    const r = await createPlanner({ apiKey: undefined }).plan("What if I opened a restaurant?");
    expect(r).toMatchObject({ ok: false, code: "no-key", status: 503 });
  });

  it("only allows free-tier GPT-OSS models", () => {
    expect(() => createPlanner({ apiKey: KEY, model: "gemini-2.5-pro" })).toThrow(/not an allowed/);
  });

  it("sends a strict JSON-schema request with bounded output and returns a validated proposal", async () => {
    const { f, calls } = fakeFetch([completion(fixture)]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if I opened a restaurant?");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.body).toMatchObject({ model: "openai/gpt-oss-120b", max_completion_tokens: 3000, response_format: { type: "json_schema", json_schema: { strict: true } } });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("tells the planner to avoid numeric echoes in questions and duplicate structured decisions", () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/including generated questions, never repeat, convert, or restate a user-supplied amount numerically/i);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/nonempty set of structured settings must be unique across branches, regardless of the descriptions/i);
  });

  it("retries at most once, only for output that fails validation", async () => {
    const bad = { ...fixture, interpretation: "About 60% of restaurants close." };
    const once = fakeFetch([completion(bad), completion(fixture)]);
    const r1 = await createPlanner({ apiKey: KEY, fetchImpl: once.f }).plan("What if I opened a restaurant?");
    expect(r1).toMatchObject({ ok: true, attempts: 2 });
    expect(String((once.calls[1]!.body.messages as { content: string }[]).at(-1)!.content)).toMatch(/states a figure/);
    const twice = fakeFetch([completion(bad)]);
    const r2 = await createPlanner({ apiKey: KEY, fetchImpl: twice.f }).plan("What if I opened a restaurant?");
    expect(r2).toMatchObject({ ok: false, code: "invalid-output", status: 422 });
    expect(twice.calls).toHaveLength(2);
  });

  it("recovers a live-style draft with only invalid optional suggestions, without another API call", async () => {
    const bad = structuredClone(fixture);
    bad.formulas[0].expression = "monthlyRevenue - unknownCosts"; // inconsistent formula
    bad.branches[0].settings.push({ variable: "monthlyRevenue", value: "99999" }); // numeric guess
    bad.possibilities[0].tone = "positive"; // invalid classification; cannot claim it is an upside
    bad.possibilities[1].text = "Guaranteed savings of $50,000"; // invented claim
    const preflight = validateProviderProposal(bad);
    if (!preflight.ok) throw new Error(`Optional-detail repair failed: ${preflight.errors.join(" | ")}`);
    const { f, calls } = fakeFetch([completion(bad)]);
    const result = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if I moved to another country?");
    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(1);
    expect(result.proposal.formulas).toHaveLength(fixture.formulas.length - 1);
    expect(result.proposal.branches[0]!.settings).toHaveLength(fixture.branches[0].settings.length);
    expect(result.proposal.possibilities[0]!.tone).toBe("uncertain");
    expect(result.proposal.possibilities.some((p: { text: string }) => p.text.includes("$50,000"))).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("formula"),
      expect.stringContaining("branch choices"),
      expect.stringContaining("speculative claim"),
      expect.stringContaining("marked uncertain"),
    ]));
  });

  it("cannot recover an invented figure in essential text by discarding optional details", async () => {
    const bad = structuredClone(fixture);
    bad.interpretation = "There is a 60% chance of success.";
    bad.formulas[0].expression = "unknownCosts - monthlyCosts";
    const { f, calls } = fakeFetch([completion(bad)]);
    const result = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if I moved to another country?");
    expect(result).toMatchObject({ ok: false, status: 422, code: "invalid-output" });
    expect(calls).toHaveLength(2);
  });

  it("rate limits and free-tier exhaustion are reported, never retried, and never ask for payment", async () => {
    const busy = fakeFetch([{ status: 429, body: { error: { message: "Rate limit reached on tokens per minute (TPM)" } }, headers: { "retry-after": "7" } }]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: busy.f }).plan("What if I opened a restaurant?");
    expect(r).toMatchObject({ ok: false, code: "rate-limited", retryAfterSeconds: 7 });
    expect(busy.calls).toHaveLength(1);
    const daily = fakeFetch([{ status: 429, body: { error: { message: "Rate limit reached on requests per day (RPD)" } } }]);
    const d = await createPlanner({ apiKey: KEY, fetchImpl: daily.f }).plan("What if I opened a restaurant?");
    expect(d).toMatchObject({ ok: false, code: "quota" });
    if (!d.ok) expect(d.message).not.toMatch(/upgrade|pay|billing/i);
  });

  it("limits input length and generation frequency locally", async () => {
    let t = 0;
    const { f, calls } = fakeFetch([completion(fixture)]);
    const p = createPlanner({ apiKey: KEY, fetchImpl: f, now: () => t, minIntervalMs: 10_000, maxPerHour: 2 });
    expect(await p.plan("x".repeat(MAX_QUESTION_LENGTH + 1))).toMatchObject({ code: "bad-input" });
    expect((await p.plan("What if?")).ok).toBe(true);
    t = 5_000;
    expect(await p.plan("What if?")).toMatchObject({ code: "local-limit", retryAfterSeconds: 5 });
    t = 20_000;
    expect((await p.plan("What if?")).ok).toBe(true);
    t = 40_000;
    expect(await p.plan("What if?")).toMatchObject({ code: "local-limit" });
    expect(calls).toHaveLength(2);
  });

  it("provider errors do not leak the key", async () => {
    const { f } = fakeFetch([{ status: 401, body: `invalid api key ${KEY}` }]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if?");
    expect(r).toMatchObject({ ok: false, code: "provider-error" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});

describe("context answers and another look at one path (R15)", () => {
  const ANSWERS = [
    { question: "Which country are you thinking of moving to?", answer: "Germany" },
    { question: "How would you earn a living there?", answer: "existing remote job" },
  ];
  const userMessage = (call: { body: Record<string, unknown> }) => (call.body.messages as { role: string; content: string }[]).find((m) => m.role === "user")!.content;

  /** The remote-relocation path after the user said their employer agrees and added a fact. */
  async function revisitFixture(): Promise<RevisitRequest> {
    const p = reactive["relocation-tailored"]!;
    let r = await proposalToReality("What if I moved to another country?", p, selectAll(p), { model: "m", createdAt: "2026-11-07T10:00:00.000Z", context: ANSWERS.map((a, i) => ({ id: `context-${i + 1}`, ...a })) });
    const b = r.branches.find((x) => x.name === "Remote relocation to Germany")!;
    r = await updateBranch(r, b.id, { values: { employerAllowsAbroad: true }, sources: { employerAllowsAbroad: "user" }, facts: [{ id: "f1", question: "", answer: "My employer allows me to work remotely" }] });
    const after = r.branches.find((x) => x.id === b.id)!;
    return revisitRequest(r, after, revisitCause(r, after));
  }
  const goodReply = (req: RevisitRequest) => ({
    summary: "Because your employer permits remote work, this path now needs a closer look at work authorization and living costs.",
    reconsider: [{ id: req.suggestions.find((s) => s.text.startsWith("Your employer may not agree"))!.id, reason: "You told us your employer permits remote work." }],
    add: [{
      text: "Your income could continue through the move", trigger: "your employer keeps employing you while you live in Germany", mechanism: "Your pay would not depend on finding a German employer.",
      downstream: "The move could be paid for without a gap in income.", uncertainty: "Whether working from Germany is permitted for you.", tone: "upside", about: ["employerAllowsAbroad"],
    }],
    questions: ["Is working from Germany legally permitted for you?"],
    evidence: ["Your employer's written approval to work from Germany"],
  });
  /** A reply that fills every field of the schema but writes research tasks where consequences belong. */
  const taskReply = (req: RevisitRequest) => ({
    ...goodReply(req),
    add: ["Investigate housing costs.", "Check health insurance requirements.", "Assess whether salary covers expenses.", "Consider German language classes."]
      .map((text) => ({ ...goodReply(req).add[0]!, text, tone: "challenge" })),
  });

  it("sends the answers as facts from the user and never asks again once they answered", async () => {
    const asksAnyway = { ...reactive["relocation-tailored"], contextQuestions: reactive["relocation-first"]!.contextQuestions };
    const { f, calls } = fakeFetch([completion(asksAnyway)]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if I moved to another country?", ANSWERS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.contextQuestions).toEqual([]);
    expect(userMessage(calls[0]!)).toBe("Situation: What if I moved to another country?\nWhat the user told us (facts from the user):\n- Which country are you thinking of moving to? Germany\n- How would you earn a living there? existing remote job");
    // The first draft asks; its questions come back with it in the same reply.
    const first = fakeFetch([completion(reactive["relocation-first"])]);
    const d = await createPlanner({ apiKey: KEY, fetchImpl: first.f }).plan("What if I moved to another country?");
    expect(d.ok && d.proposal.contextQuestions.map((q) => q.question)).toEqual(["Which country are you thinking of moving to?", "How would you earn a living there?"]);
    expect(userMessage(first.calls[0]!)).toBe("Situation: What if I moved to another country?");
  });

  it("invalid or extra context questions are left out without another call", async () => {
    const p = structuredClone(reactive["relocation-first"]!);
    const [q0, q1] = p.contextQuestions;
    p.contextQuestions = [q0!, { ...q1!, examples: ["Under $3,000 a month"] }, q0!];
    const { f, calls } = fakeFetch([completion(p)]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if I moved to another country?");
    expect(calls).toHaveLength(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.contextQuestions).toHaveLength(2);
    expect(r.proposal.contextQuestions.some((q) => q.examples.some((e) => e.includes("$")))).toBe(false);
    expect(r.warnings).toContain("Left out context questions that failed checks.");
  });

  it("malformed context answers are refused before anything is sent", async () => {
    const { f, calls } = fakeFetch([completion(reactive["relocation-tailored"])]);
    const p = createPlanner({ apiKey: KEY, fetchImpl: f });
    expect(await p.plan("What if?", [{ question: "Which country?", answer: "x".repeat(201) }])).toMatchObject({ ok: false, code: "bad-input", status: 400 });
    expect(await p.plan("What if?", "Germany")).toMatchObject({ ok: false, code: "bad-input" });
    expect(calls).toHaveLength(0);
  });

  it("another look sends only that path, as JSON, with its own strict schema and a smaller output budget", async () => {
    const req = await revisitFixture();
    const { f, calls } = fakeFetch([completion(goodReply(req))]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).revisit({ ...req, extra: "never forwarded" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.suggestion.summary).toMatch(/^Because your employer permits remote work/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ max_completion_tokens: 2000, response_format: { type: "json_schema", json_schema: { name: "realityfork_revisit", strict: true } } });
    expect(userMessage(calls[0]!)).toBe(`One path, as JSON:\n${JSON.stringify(req)}`);
    for (const other of ["Find a job in Germany first", "Stay and keep working remotely", "never forwarded"]) expect(userMessage(calls[0]!)).not.toContain(other);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("another look: optional items that fail checks are dropped; a claim of eligibility is retried once, then refused", async () => {
    const req = await revisitFixture();
    const mixed = { ...goodReply(req), add: [...goodReply(req).add, { ...goodReply(req).add[0]!, text: "Rent will be about €1,500" }], questions: [...goodReply(req).questions, "Check the rules"] };
    const repaired = validateProviderRevisit(mixed, req);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.suggestion.add.map((x) => x.text)).toEqual(["Your income could continue through the move"]);
      expect(repaired.suggestion.questions).toEqual(["Is working from Germany legally permitted for you?"]);
      expect(repaired.warnings).toContain("Left out AI suggestions that failed checks.");
    }
    const claim = { ...goodReply(req), summary: "Because you are eligible for a digital nomad visa, moving is straightforward." };
    const { f, calls } = fakeFetch([completion(claim)]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).revisit(req);
    expect(r).toMatchObject({ ok: false, code: "invalid-output", status: 422 });
    expect(calls).toHaveLength(2);
    expect(userMessage(calls[1]!)).toContain("One path, as JSON:");
    expect(String((calls[1]!.body.messages as { content: string }[]).at(-1)!.content)).toMatch(/summary states eligibility/);
  });

  it("malformed re-evaluation requests never reach the provider", async () => {
    const req = await revisitFixture();
    const { f, calls } = fakeFetch([completion(goodReply(req))]);
    const p = createPlanner({ apiKey: KEY, fetchImpl: f });
    expect(await p.revisit(null)).toMatchObject({ ok: false, code: "bad-input" });
    expect(await p.revisit({ ...req, change: "" })).toMatchObject({ ok: false, code: "bad-input" });
    expect(await p.revisit({ ...req, assumptions: [{ ...req.assumptions[0]!, key: "not a key!" }] })).toMatchObject({ ok: false, code: "bad-input" });
    expect(calls).toHaveLength(0);
    expect(BODY_LIMITS).toEqual({ "/api/plan": 8_000, "/api/revisit": 64_000 });
  });

  it("R19 live budget: for a draft, maxAttempts 1 is exactly one provider call even when the reply fails the checks, and a counting wrapper refuses a call past the budget", async () => {
    const bad = { ...fixture, interpretation: "About 60% of shops close in the first year." };
    const { f, calls } = fakeFetch([completion(bad)]);
    const BUDGET = 2;
    let made = 0;
    const counting = (async (url: string, init: RequestInit) => {
      if (made >= BUDGET) throw new Error("budget used");
      made++;
      return (f as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    const p = createPlanner({ apiKey: KEY, fetchImpl: counting, maxAttempts: 1, minIntervalMs: 0 });
    // An invalid reply costs one request, not two: no retry.
    expect(await p.plan("What if I opened a bookstore?")).toMatchObject({ ok: false, code: "invalid-output" });
    expect(calls).toHaveLength(1);
    expect(made).toBe(1);
    // The second scenario also costs one. A third would be refused by the wrapper before it reached the provider.
    expect(await p.plan("What if I studied more?")).toMatchObject({ ok: false, code: "invalid-output" });
    expect(made).toBe(2);
    expect(await p.plan("What if a third question?")).toMatchObject({ ok: false, code: "provider-error" });
    expect(calls).toHaveLength(2);
    expect(made).toBe(2);
  });

  it("drafts and fresh looks share one limiter, and maxAttempts 1 means exactly one provider call", async () => {
    let t = 0;
    const req = await revisitFixture();
    const { f, calls } = fakeFetch([completion(reactive["relocation-first"]), completion(goodReply(req))]);
    const p = createPlanner({ apiKey: KEY, fetchImpl: f, now: () => t, minIntervalMs: 10_000 });
    expect((await p.plan("What if I moved to another country?")).ok).toBe(true);
    t = 3_000;
    expect(await p.revisit(req)).toMatchObject({ ok: false, code: "local-limit", retryAfterSeconds: 7 });
    t = 11_000;
    expect((await p.revisit(req)).ok).toBe(true);
    expect(calls).toHaveLength(2);
    const once = fakeFetch([completion({ ...goodReply(req), summary: "Because you qualify for a visa, nothing changes." })]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: once.f, maxAttempts: 1 }).revisit(req);
    expect(r).toMatchObject({ ok: false, code: "invalid-output" });
    expect(once.calls).toHaveLength(1);
  });
});

describe("R16: consequences, not research tasks", () => {
  const ANSWERS = [{ question: "Which country are you thinking of moving to?", answer: "Germany" }];
  async function lookRequest(): Promise<RevisitRequest> {
    const p = reactive["relocation-tailored"]!;
    let r = await proposalToReality("What if I moved to Germany while keeping my current remote job?", p, selectAll(p), { model: "m", createdAt: "2026-11-08T10:00:00.000Z", context: ANSWERS.map((a, i) => ({ id: `context-${i + 1}`, ...a })) });
    const b = r.branches.find((x) => x.name === "Remote relocation to Germany")!;
    r = await updateBranch(r, b.id, { facts: [{ id: "f1", question: "", answer: "I expect the cost of living in Germany to be higher than in my current city." }] });
    const after = r.branches.find((x) => x.id === b.id)!;
    return revisitRequest(r, after, revisitCause(r, after));
  }
  const consequence = {
    text: "Monthly savings could shrink", trigger: "living costs in Germany turn out higher while your salary stays the same",
    mechanism: "Rent, insurance and daily costs would take a larger share of the same income.", downstream: "Housing choices or savings goals may need to change.",
    uncertainty: "Your actual rent, health insurance, taxes and salary after the move.", tone: "challenge", about: ["livingCosts", "monthlyIncome"],
  };
  const look = (add: unknown[]) => ({ summary: "Because you expect living costs in Germany to be higher, this path could leave less money each month.", reconsider: [], add, questions: ["What would rent cost in the city you are considering?"], evidence: [] });

  it("the prompts ask for causes and keep tasks out of consequences", () => {
    for (const rule of [/trigger/, /mechanism/, /never invent a chain/i, /Investigate/, /guess or expectation/, /never use assumption keys/, /Never explain a consequence with laws/]) expect(REVISIT_SYSTEM_PROMPT).toMatch(rule);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/guess or expectation/);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/materially different/);
  });

  it("a look that lists the reported research tasks keeps its questions, drops the tasks and says why, in one call", async () => {
    const req = await lookRequest();
    const tasks = ["Investigate housing costs.", "Check health insurance requirements.", "Assess whether salary covers expenses.", "Consider German language classes."].map((text) => ({ ...consequence, text }));
    const { f, calls } = fakeFetch([completion(look(tasks))]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).revisit(req);
    expect(calls).toHaveLength(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.suggestion.add).toEqual([]);
    expect(validateProviderRevisit(look([tasks[0], consequence]), req)).toMatchObject({ ok: true, suggestion: { add: [{ text: "Monthly savings could shrink" }] } });
    expect(r.suggestion.questions).toEqual(["What would rent cost in the city you are considering?"]);
    expect(r.warnings).toEqual(["Left out 4 suggestions that were research tasks, not a possible consequence. Things to find out stay in the questions."]);
    // The note never quotes the model or the user.
    expect(r.warnings.join(" ")).not.toMatch(/housing|insurance|Germany/i);
  });

  it("a draft's research tasks and code names are left out with a note; the rest of the draft is kept", async () => {
    const p = structuredClone(reactive["relocation-tailored"]!);
    p.possibilities[0]!.text = "Research rental prices in Berlin";
    p.possibilities[1]!.text = "Income could stay the same while keepRemoteJob is yes";
    const { f, calls } = fakeFetch([completion(p)]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if I moved to Germany while keeping my current remote job?");
    expect(calls).toHaveLength(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.possibilities).toHaveLength(p.possibilities.length - 2);
    expect(r.warnings).toEqual(expect.arrayContaining([
      "Left out 1 suggestion that was a research task, not a possible consequence. Things to find out stay in the questions.",
      "Left out 1 suggestion written with internal names instead of plain words.",
    ]));
  });

  it("contradictory settings are dropped, never resolved by picking one; identical futures are refused and retried once", async () => {
    const p = structuredClone(reactive["relocation-tailored"]!);
    p.branches[0]!.settings = [{ variable: "keepRemoteJob", value: "yes" }, { variable: "keepRemoteJob", value: "no" }];
    const fixed = validateProviderProposal(p);
    expect(fixed.ok).toBe(true);
    if (fixed.ok) {
      expect(fixed.proposal.branches[0]!.settings).toEqual([]);
      expect(fixed.warnings).toContain("Left out inconsistent AI-suggested branch choices.");
    }
    const same = structuredClone(reactive["relocation-tailored"]!);
    same.branches[1]!.settings = [{ variable: "keepRemoteJob", value: "yes" }];
    const { f, calls } = fakeFetch([completion(same), completion(reactive["relocation-tailored"])]);
    const r = await createPlanner({ apiKey: KEY, fetchImpl: f }).plan("What if I moved to Germany?");
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(String((calls[1]!.body.messages as { content: string }[]).at(-1)!.content)).toMatch(/makes the same decisions/);
  });
});

describe("R16: the recorded live look (docs/validation/r16-live-quality.json), replayed offline", () => {
  const live = JSON.parse(readFileSync(fileURLToPath(new URL("../../../docs/validation/r16-live-quality.json", import.meta.url)), "utf8"));
  it("keeps the two plain consequences, drops the tax-rule and code-name ones with notes, keeps every question", () => {
    const req = checkRevisitRequest(live.request2.body);
    if (!req.ok) throw new Error(req.message);
    const c = validateProviderRevisit(live.request2.result.suggestion, req.request);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.suggestion.add.map((x) => x.text)).toEqual(["Your monthly savings could shrink.", "You might need to adjust your budget for housing."]);
    expect(c.suggestion.questions).toHaveLength(4);
    expect(c.suggestion.evidence).toHaveLength(3);
    expect(c.warnings).toEqual([
      "Left out 1 suggestion that stated a rule, eligibility or a guarantee as fact. Rules to check stay in the questions.",
      "Left out 1 suggestion written with internal names instead of plain words.",
    ]);
  });
});
