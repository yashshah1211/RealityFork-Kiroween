/**
 * Browser store, R15 flows, with the server replaced by a fake: context questions (answered, skipped, changed),
 * the number of AI requests each path costs, what the user tells us, "explore both", and the approved,
 * one-path re-evaluation (including refusing to apply it to a path that changed in the meantime).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { staleSuggestions, type Proposal, type Reality, type RevisitRequest } from "@realityfork/core";
import { directEngine } from "../engine";
import type { StorageLike } from "../state/workspace";
import { RealityStore, type ApiFetcher, type ApiPath } from "./store";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../../e2e/fixtures/reactive-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
const QUESTION = "What if I moved to another country?";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

type Reply = { status: number; body: unknown };
type Call = { path: ApiPath; body: Record<string, unknown> };
const draftReply = (proposal: unknown): Reply => ({ status: 200, body: { ok: true, proposal, model: "mock-model", warnings: [] } });
const revisitReply = (req: RevisitRequest, summary = "Because your employer permits remote work, this path now needs a closer look at work authorization and living costs."): Reply => ({
  status: 200,
  body: {
    ok: true, model: "mock-model", warnings: [],
    suggestion: {
      summary,
      reconsider: req.suggestions.filter((s) => s.text.startsWith("Your employer may not agree")).map((s) => ({ id: s.id, reason: "You told us your employer permits remote work." })),
      add: [
        {
          text: "Your income could continue through the move", trigger: "your employer keeps employing you while you live in Germany", mechanism: "Your pay would not depend on finding a German employer.",
          downstream: "The move could be paid for without a gap in income.", uncertainty: "Whether working from Germany is permitted for you.", tone: "upside", about: ["employerAllowsAbroad"],
        },
        { text: "Your working hours could shift", trigger: "your team works in a different time zone", mechanism: "Meetings set for your team's daytime may fall early or late in Germany.", downstream: "", uncertainty: "Where your team is based.", tone: "uncertain", about: [] },
      ],
      questions: ["Is working from Germany legally permitted for you?"],
      evidence: [],
    },
  },
});

/** A fake server: tailored drafts when the request carries context, the first draft otherwise. */
function setup(over: (call: Call, n: number) => Reply | undefined = () => undefined) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetcher: ApiFetcher = async (path, payload) => {
    const call = { path, body: JSON.parse(JSON.stringify(payload)) as Record<string, unknown> };
    calls.push(call);
    const custom = over(call, calls.length);
    if (custom) return custom;
    if (path === "/api/revisit") return revisitReply(call.body as unknown as RevisitRequest);
    return draftReply(call.body.context ? fx["relocation-tailored"] : fx["relocation-first"]);
  };
  const storage = new MemoryStorage();
  const store = new RealityStore(directEngine, storage, fetcher, async (ms) => void sleeps.push(ms));
  return { store, calls, sleeps, storage };
}
async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for the store");
    await new Promise((r) => setTimeout(r, 2));
  }
}
const ready = (store: RealityStore) => until(() => store.getState().plan.status === "ready");
const branch = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;

async function tailoredMap() {
  const s = setup();
  await s.store.requestPlan(QUESTION);
  s.store.answerContext("Germany");
  s.store.answerContext("existing remote job");
  await ready(s.store);
  await s.store.acceptPlan(0);
  return s;
}

describe("context questions before exploring", () => {
  it("one reply brings the questions and a first draft; answering costs exactly one more request, carrying the answers", async () => {
    const { store, calls } = setup();
    await store.requestPlan(QUESTION);
    const asking = store.getState().plan;
    expect(asking.status).toBe("context");
    if (asking.status !== "context") return;
    expect(asking.round.asked.map((q) => q.question)).toEqual(["Which country are you thinking of moving to?", "How would you earn a living there?"]);
    expect(calls).toEqual([{ path: "/api/plan", body: { question: QUESTION } }]);
    store.answerContext("  Germany ");
    expect(store.getState().plan).toMatchObject({ status: "context", step: 1 });
    store.answerContext("existing remote job");
    await ready(store);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual({ question: QUESTION, context: [
      { question: "Which country are you thinking of moving to?", answer: "Germany" },
      { question: "How would you earn a living there?", answer: "existing remote job" },
    ] });
    const plan = store.getState().plan;
    expect(plan.status === "ready" && [plan.tailored, plan.proposal.branches[0]!.name]).toEqual([true, "Remote relocation to Germany"]);
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(r.question).toBe(QUESTION);
    expect(r.context).toEqual([
      { id: "context-1", question: "Which country are you thinking of moving to?", answer: "Germany" },
      { id: "context-2", question: "How would you earn a living there?", answer: "existing remote job" },
    ]);
    expect(store.selected()!.name).toBe("Remote relocation to Germany");
  });

  it("skipping both shows the first draft with no second request", async () => {
    const { store, calls } = setup();
    await store.requestPlan(QUESTION);
    store.skipContext();
    store.skipContext();
    await ready(store);
    const plan = store.getState().plan;
    expect(plan.status === "ready" && [plan.tailored, plan.proposal.branches[0]!.name]).toEqual([false, "Move with a job offer"]);
    expect(calls).toHaveLength(1);
    await store.acceptPlan(0);
    expect(store.active()!.context).toBeUndefined();
  });

  it("changing the answers later: unchanged answers reuse the tailored futures; new answers make one new request", async () => {
    const { store, calls } = setup();
    await store.requestPlan(QUESTION);
    store.answerContext("Germany");
    store.answerContext("existing remote job");
    await ready(store);
    const tailored = store.getState().plan;
    store.editContext();
    expect(store.getState().plan).toMatchObject({ status: "context", step: 0, round: { answers: ["Germany", "existing remote job"] } });
    store.answerContext("Germany");
    store.answerContext("existing remote job");
    expect(store.getState().plan).toBe(tailored);
    expect(calls).toHaveLength(2);
    store.editContext();
    store.answerContext("Canada");
    store.answerContext("existing remote job");
    await until(() => calls.length === 3 && store.getState().plan.status === "ready");
    expect((calls[2]!.body.context as { answer: string }[]).map((c) => c.answer)).toEqual(["Canada", "existing remote job"]);
  });

  it("if tailoring fails, the general futures are shown, the answers are kept, and their suggestions are flagged for a fresh look", async () => {
    const { store, calls } = setup((call) => (call.body.context ? { status: 429, body: { ok: false, code: "rate-limited", message: "The free tier is busy for this account. Try again shortly, or continue by hand." } } : undefined));
    await store.requestPlan(QUESTION);
    store.answerContext("Germany");
    store.skipContext();
    await ready(store);
    const plan = store.getState().plan;
    expect(plan.status === "ready" && [plan.tailored, plan.tailorError]).toEqual([false, "The free tier is busy for this account. Try again shortly, or continue by hand."]);
    expect(calls).toHaveLength(2);
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(r.context?.map((f) => f.answer)).toEqual(["Germany"]);
    const b = store.selected()!;
    expect(staleSuggestions(r, b).length).toBe(b.possibilities.length);
    expect(staleSuggestions(r, b).every((s) => s.madeBefore)).toBe(true);
  });

  it("the local server's spacing is waited out once; provider rate limits are never retried", async () => {
    let refused = false;
    const s = setup((call) => {
      if (call.body.context && !refused) {
        refused = true;
        return { status: 429, body: { ok: false, code: "local-limit", message: "Please wait a few seconds between suggestions.", retryAfterSeconds: 4 } };
      }
      return undefined;
    });
    await s.store.requestPlan(QUESTION);
    s.store.answerContext("Germany");
    s.store.answerContext("existing remote job");
    await ready(s.store);
    expect(s.sleeps).toEqual([4250]);
    expect(s.calls).toHaveLength(3);
    expect(s.store.getState().plan).toMatchObject({ status: "ready", tailored: true });

    const busy = setup(() => ({ status: 429, body: { ok: false, code: "rate-limited", message: "busy" } }));
    await busy.store.requestPlan(QUESTION);
    expect(busy.calls).toHaveLength(1);
    expect(busy.sleeps).toEqual([]);
    expect(busy.store.getState().plan).toMatchObject({ status: "error", code: "rate-limited" });
  });
});

describe("what the user tells us in a path", () => {
  it("answers record who set them, and the path remembers what it was before", async () => {
    const { store } = await tailoredMap();
    const before = store.active()!;
    const id = store.selected()!.id;
    await store.answer(id, "employerAllowsAbroad", true);
    await store.answer(id, "monthlyIncome", 4000);
    const r = store.active()!;
    expect(branch(r, "Remote relocation to Germany").sources).toEqual({ keepRemoteJob: "ai", employerAllowsAbroad: "user", monthlyIncome: "user" });
    expect(store.getState().change).toEqual({ realityId: r.id, branchId: id, before });
    store.select(r.branches[0]!.id);
    expect(store.getState().change).toBeNull();
  });

  it("facts and context answers can be added, edited and removed", async () => {
    const { store } = await tailoredMap();
    const id = store.selected()!.id;
    await store.addFact(id, "  My employer allows me to work remotely ");
    let b = store.selected()!;
    expect(b.facts?.map((f) => [f.question, f.answer])).toEqual([["", "My employer allows me to work remotely"]]);
    await store.editFact(id, b.facts![0]!.id, "My employer allows remote work from abroad");
    expect(store.selected()!.facts![0]!.answer).toBe("My employer allows remote work from abroad");
    await store.removeFact(id, b.facts![0]!.id);
    b = store.selected()!;
    expect(b.facts).toEqual([]);
    await store.editContextFact(id, "context-1", "Austria");
    expect(store.active()!.context!.map((f) => f.answer)).toEqual(["Austria", "existing remote job"]);
    await store.editContextFact(id, "context-2", "");
    expect(store.active()!.context!.map((f) => f.id)).toEqual(["context-1"]);
    expect(store.active()!.question).toBe(QUESTION);
  });

  it("explore both: one new path per answer, the original untouched, and no duplicates when asked twice", async () => {
    const { store, calls } = await tailoredMap();
    const remote = store.selected()!;
    await store.exploreBoth(remote.id, "employerAllowsAbroad");
    let r = store.active()!;
    const kids = r.branches.filter((b) => b.parentId === remote.id);
    expect(kids.map((b) => [b.name, b.values.employerAllowsAbroad, b.sources?.employerAllowsAbroad])).toEqual([
      ["Remote relocation to Germany · Employer agrees to me working from Germany: yes", true, "user"],
      ["Remote relocation to Germany · Employer agrees to me working from Germany: no", false, "user"],
    ]);
    expect(branch(r, "Remote relocation to Germany")).toEqual(remote);
    expect(store.selected()!.id).toBe(kids[0]!.id);
    await store.exploreBoth(remote.id, "employerAllowsAbroad");
    r = store.active()!;
    expect(r.branches.filter((b) => b.parentId === remote.id)).toHaveLength(2);
    await store.exploreBoth(remote.id, "monthlyIncome");
    expect(store.getState().error).toMatch(/Only a yes\/no question or a choice between two options/);
    expect(calls).toHaveLength(2);
  });
});

describe("another look at one path", () => {
  it("sends only that path; approval applies the chosen items there and nowhere else; it is saved", async () => {
    const { store, calls, storage } = await tailoredMap();
    const remote = store.selected()!;
    await store.exploreBoth(remote.id, "employerAllowsAbroad");
    const yes = store.selected()!;
    await store.addFact(yes.id, "My employer allows me to work remotely");
    const before = store.active()!;
    await store.requestRevisit(yes.id);
    const sent = calls.at(-1)!;
    expect(sent.path).toBe("/api/revisit");
    const json = JSON.stringify(sent.body);
    expect(sent.body.path).toEqual({ name: yes.name, description: "" });
    for (const other of ["Find a job in Germany first", "Stay and keep working remotely", "Employer agrees to me working from Germany: no", yes.fingerprint]) expect(json).not.toContain(other);
    expect(sent.body.known).toEqual([{ question: "", answer: "My employer allows me to work remotely" }]);
    const rv = store.getState().revisit;
    expect(rv.status).toBe("ready");
    store.toggleRevisit("add", 1);
    await store.applyRevisit();
    const r = store.active()!;
    const after = r.branches.find((b) => b.id === yes.id)!;
    expect(after.possibilities.find((p) => p.text.startsWith("Your employer may not agree"))!.setAside).toBe("You told us your employer permits remote work.");
    expect(after.possibilities.map((p) => p.text)).toContain("Your income could continue through the move");
    expect(after.possibilities.find((p) => p.text === "Your income could continue through the move")!.cause?.trigger).toBe("your employer keeps employing you while you live in Germany");
    expect(after.possibilities.map((p) => p.text)).not.toContain("Your working hours could shift");
    expect(after.revisits).toHaveLength(1);
    for (const b of before.branches.filter((x) => x.id !== yes.id)) expect(r.branches.find((x) => x.id === b.id)).toEqual(b);
    expect(store.getState().revisit).toEqual({ status: "idle" });
    expect(calls.filter((c) => c.path === "/api/revisit")).toHaveLength(1);
    // Saved: a fresh store restores the same map, fingerprints checked.
    const again = new RealityStore(directEngine, storage, async () => ({ status: 500, body: null }));
    await again.restore();
    expect(again.active()).toEqual(r);
  });

  it("refuses to apply to a path that changed after the request", async () => {
    const { store } = await tailoredMap();
    const id = store.selected()!.id;
    await store.answer(id, "employerAllowsAbroad", true);
    await store.requestRevisit(id);
    expect(store.getState().revisit.status).toBe("ready");
    await store.answer(id, "monthlyIncome", 4000);
    const changed = store.selected()!;
    await store.applyRevisit();
    expect(store.getState().revisit).toMatchObject({ status: "error", code: "changed" });
    expect(store.selected()).toEqual(changed);
  });

  it("a reply that fails the browser's own check is not applied", async () => {
    const { store } = await tailoredMap();
    const id = store.selected()!.id;
    await store.answer(id, "employerAllowsAbroad", true);
    const unsafe = new RealityStore(directEngine, null, async (path, payload) =>
      path === "/api/revisit" ? revisitReply(payload as RevisitRequest, "Because you are eligible for a digital nomad visa, this path is simple.") : draftReply(fx["relocation-tailored"]));
    await unsafe.importText(store.exportText());
    unsafe.open(store.active()!.id);
    await unsafe.requestRevisit(id);
    expect(unsafe.getState().revisit).toMatchObject({ status: "error", code: "invalid-output" });
    const message = (unsafe.getState().revisit as { message: string }).message;
    expect(message).toMatch(/summary states eligibility/);
    // The rejected claim itself is never shown.
    expect(message).not.toMatch(/digital nomad|visa/i);
  });
});

describe("user-testing regression: a fact never changes a value by itself", () => {
  it("telling RealityFork something only adds the fact; the matching question stays open until the user answers it", async () => {
    const { store, calls } = await tailoredMap();
    const id = store.selected()!.id;
    const before = store.selected()!;
    await store.addFact(id, "My employer has explicitly approved me working remotely from Germany.");
    const after = store.selected()!;
    expect(after.values).toEqual(before.values);
    expect(after.values.employerAllowsAbroad).toBeNull();
    expect(after.sources).toEqual(before.sources);
    expect(after.possibilities).toEqual(before.possibilities);
    expect(calls).toHaveLength(2); // the two drafts; the fact itself sends nothing
    await store.answer(id, "employerAllowsAbroad", true);
    expect(store.selected()!.sources?.employerAllowsAbroad).toBe("user");
  });
});

describe("R17: what if this changed?", () => {
  it("a different value makes one new path from the current one, set by the user; the original is untouched; asking twice reuses it", async () => {
    const { store, calls } = await tailoredMap();
    const remote = store.selected()!;
    await store.answer(remote.id, "monthlyIncome", 4000);
    const parent = store.selected()!;
    const made = await store.exploreChange(parent.id, { key: "monthlyIncome", value: 5000 });
    const r = store.active()!;
    expect(made?.name).toBe("Remote relocation to Germany · Monthly income: 5,000 per month");
    expect(made).toMatchObject({ parentId: parent.id, parentFingerprint: parent.fingerprint, values: { monthlyIncome: 5000 }, sources: { monthlyIncome: "user" } });
    expect(r.branches.find((b) => b.id === parent.id)).toEqual(parent);
    expect(store.getState()).toMatchObject({ selectedId: made!.id, whatIf: { realityId: r.id, branchId: made!.id } });
    await store.exploreChange(parent.id, { key: "monthlyIncome", value: 5000 });
    expect(store.active()!.branches.filter((b) => b.parentId === parent.id)).toHaveLength(1);
    expect(calls).toHaveLength(2); // the two drafts: exploring a change sends nothing
  });

  it("refuses the current value and an empty description; never invents a value", async () => {
    const { store } = await tailoredMap();
    const id = store.selected()!.id;
    await store.exploreChange(id, { key: "keepRemoteJob", value: true });
    expect(store.getState().error).toMatch(/already has Keep my current remote job: yes/);
    await store.exploreChange(id, { key: "monthlyIncome", value: null });
    expect(store.getState().error).toMatch(/Enter the value/);
    await store.exploreChange(id, { text: "  " });
    expect(store.getState().error).toMatch(/Describe the change first/);
    expect(store.active()!.branches).toHaveLength(4);
  });

  it("a described change is saved on the new path as something the user said, and the mark clears when they move on", async () => {
    const { store } = await tailoredMap();
    const parent = store.selected()!;
    const made = await store.exploreChange(parent.id, { text: "I negotiate a higher salary" });
    expect(made).toMatchObject({ name: "I negotiate a higher salary", values: parent.values });
    expect(made!.facts?.map((f) => [f.question, f.answer])).toEqual([["What is different on this path?", "I negotiate a higher salary"]]);
    store.openCompare(parent.id, made!.id);
    store.continueWith(made!.id);
    expect(store.getState().whatIf?.branchId).toBe(made!.id); // comparing and coming back keeps it
    store.select(parent.id);
    expect(store.getState().whatIf).toBeNull();
  });
});
