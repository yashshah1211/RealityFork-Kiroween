/**
 * R19, browser store: figures read from the question, the correction flows and what an AI request costs.
 * The server is replaced by a fake; nothing here reaches a provider.
 *
 *  - nothing is applied until the user confirms, and then only to the futures they chose
 *  - no extra AI request is made to confirm, edit or apply figures
 *  - "Edit my question" keeps the draft, says when it is out of date, and never touches a saved map
 *  - "Generate different possibilities" keeps the draft on screen while it waits and restores it with the reason on failure
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareStory, evaluateBranch, exportRealities, importRealities, MAX_QUESTION_LENGTH, staleSuggestions, type Proposal, type Reality } from "@realityfork/core";
import { directEngine } from "../engine";
import type { StorageLike } from "../state/workspace";
import { RealityStore, type ApiFetcher, type ApiPath } from "./store";

const load = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../e2e/fixtures/${file}`, import.meta.url)), "utf8")) as Record<string, Proposal>;
const audit = load("audit-proposals.json");
const r19 = load("r19-proposals.json");
const r20a = load("r20a-proposals.json");
const MISSION_BOOKSTORE = "What if I opened a bookstore? I have a budget of ₹500,000 and expect monthly rent of ₹35,000.";
const MISSION_STUDY = "What if I studied for 3 hours every day instead of 1 hour for the next 6 months?";
const BOOKSTORE = "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?";
const STUDY = "What if I studied two hours daily instead of one hour for exams four weeks away?";
const COLLEGE = "What if my college replaced written exams with team-based projects?";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}
type Reply = { status: number; body: unknown };
type Call = { path: ApiPath; body: Record<string, unknown> };
const draftReply = (proposal: unknown): Reply => ({ status: 200, body: { ok: true, proposal, model: "mock-model", warnings: [] } });
const failure: Reply = { status: 504, body: { ok: false, code: "timeout", message: "The AI guide took too long." } };

function setup(drafts: Proposal[], over: (call: Call, n: number) => Reply | undefined = () => undefined) {
  const calls: Call[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  const fetcher: ApiFetcher = async (path, payload) => {
    const call = { path, body: JSON.parse(JSON.stringify(payload)) as Record<string, unknown> };
    calls.push(call);
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    return over(call, calls.length) ?? draftReply(drafts[Math.min(calls.length, drafts.length) - 1]);
  };
  const storage = new MemoryStorage();
  const store = new RealityStore(directEngine, storage, fetcher, async () => undefined);
  return {
    store, calls, storage,
    /** Make the next request wait until `go()` is called, so the screen in between can be inspected. */
    pause: () => { hold = true; },
    go: () => { hold = false; release?.(); release = null; },
  };
}
async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for the store");
    await new Promise((r) => setTimeout(r, 2));
  }
}
const readyPlan = (store: RealityStore) => {
  const p = store.getState().plan;
  if (p.status !== "ready") throw new Error(`expected a draft, got ${p.status}`);
  return p;
};
const waitReady = (store: RealityStore) => until(() => store.getState().plan.status === "ready" && !(store.getState().plan as { busy?: boolean }).busy);
const branch = (r: Reality, name: string) => r.branches.find((b) => b.name === name)!;

describe("figures from the question: nothing is applied until the user confirms", () => {
  it("opening a future without confirming leaves every number unknown, exactly as before R19", async () => {
    const { store, calls } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    expect(readyPlan(store).figures).toEqual({ confirmed: false, choices: {} });
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Open the bookstore").values.monthlySales).toBeNull();
    expect(r.branches.every((b) => b.stated === undefined)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("one confirmation, then opening the future: the bookstore shows ₹8,000 a month of profit with nothing retyped, and no second AI request", async () => {
    const { store, calls, storage } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    expect(store.figurePlan()!.rows).toHaveLength(3);
    // R20A: "₹8,000 rent" does not say per month (only the other amounts do), so the user ticks it: one tick, nothing retyped.
    const rent = store.figurePlan()!.rows.find((r) => r.chosenVariable === "rent")!;
    expect(rent).toMatchObject({ use: false, status: "check" });
    store.setFigureChoice(rent.stated.id, { use: true });
    store.confirmFigures();
    expect(readyPlan(store).figures.confirmed).toBe(true);
    await store.acceptPlan(0);
    const r = store.active()!;
    const open = branch(r, "Open the bookstore");
    expect(store.selected()!.id).toBe(open.id);
    expect(open.values).toMatchObject({ monthlySales: 20000, rent: 8000, otherCosts: 4000 });
    expect(open.sources).toMatchObject({ monthlySales: "user", rent: "user", otherCosts: "user" });
    expect(evaluateBranch(r, open).calculated[0]!.result).toMatchObject({ status: "ok", value: 8000 });
    // The other future and the starting point are untouched.
    expect(branch(r, "Don't open it").values.monthlySales).toBeNull();
    expect(r.branches[0]!.values.monthlySales).toBeNull();
    expect(staleSuggestions(r, open)).toEqual([]);
    expect(calls).toHaveLength(1);
    // It is saved with the map, words included, and survives a reload.
    const reloaded = new RealityStore(directEngine, storage, async () => ({ status: 500, body: {} }), async () => undefined);
    await reloaded.restore();
    const again = reloaded.active()!;
    expect(branch(again, "Open the bookstore").stated!.rent).toEqual({ text: "₹8,000 rent", value: 8000 });
    expect(again).toEqual(r);
  });

  it("the shop's amounts stay with the future that opens the shop whichever card is pressed; 'the future I open', when the user chooses it, follows the card (R19)", async () => {
    // R20A.1: "Don't open it" reads as not doing it, so pressing its card does not put the shop's sales on it.
    const a = setup([audit.bookstore!]);
    await a.store.requestPlan(BOOKSTORE);
    a.store.confirmFigures();
    await a.store.acceptPlan(1);
    const kept = a.store.active()!;
    expect(a.store.selected()!.name).toBe("Don't open it");
    expect(branch(kept, "Don't open it").values.monthlySales).toBeNull();
    expect(branch(kept, "Open the bookstore").values.monthlySales).toBe(20000);
    // Chosen on purpose, "the future I open" is exactly what it was: it follows the card that is pressed.
    const { store } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    for (const row of store.figurePlan()!.rows) store.setFigureChoice(row.stated.id, { target: "open" });
    store.confirmFigures();
    await store.acceptPlan(1);
    const r = store.active()!;
    expect(store.selected()!.name).toBe("Don't open it");
    expect(branch(r, "Don't open it").values.monthlySales).toBe(20000);
    expect(branch(r, "Open the bookstore").values.monthlySales).toBeNull();
  });

  it("unticking a figure, or moving one to another future, is honoured", async () => {
    const { store } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    const rows = store.figurePlan()!.rows;
    const other = rows.find((r) => r.chosenVariable === "otherCosts")!;
    const sales = rows.find((r) => r.chosenVariable === "monthlySales")!;
    store.setFigureChoice(other.stated.id, { use: false });
    store.setFigureChoice(sales.stated.id, { target: 1 });
    store.confirmFigures();
    await store.acceptPlan(0);
    const r = store.active()!;
    // The rent was never ticked (its period is not written), the other costs were unticked, the sales went to the other future.
    expect(branch(r, "Open the bookstore").values).toMatchObject({ monthlySales: null, rent: null, otherCosts: null });
    expect(branch(r, "Don't open it").values.monthlySales).toBe(20000);
  });

  it("a confirmation stays exactly as confirmed: renaming a future afterwards does not move a figure", async () => {
    const { store } = setup([r19.education!]);
    await store.requestPlan(STUDY);
    // "one hour" borrows its period from "two hours daily", so the user ticks it themselves.
    store.setFigureChoice(store.figurePlan()!.rows.find((r) => r.chosenVariable === "studyHours" && r.stated.value === 1)!.stated.id, { use: true });
    store.confirmFigures();
    const before = readyPlan(store).figures.choices;
    // Swap the two names, the way the "Adjust the draft" rename does it: possibilities stay attached to their future.
    const swap = new Map([["Study two hours daily", "Keep one hour daily, in a new way"], ["Keep one hour daily", "Study two hours daily"]]);
    store.editPlan((p, s) => ({
      proposal: {
        ...p,
        branches: p.branches.map((b) => ({ ...b, name: swap.get(b.name) ?? b.name })),
        possibilities: p.possibilities.map((x) => ({ ...x, branch: swap.get(x.branch) ?? x.branch })),
      },
      selection: s,
    }));
    expect(readyPlan(store).figures.choices).toEqual(before);
    expect(readyPlan(store).figures.confirmed).toBe(true);
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Keep one hour daily, in a new way").values.studyHours).toBe(2);
    expect(branch(r, "Study two hours daily").values.studyHours).toBe(1);
  });

  it("study plan: two hours and one hour go to the futures that say so, the four weeks both share go to both; nothing else is invented", async () => {
    const { store } = setup([r19.education!]);
    await store.requestPlan(STUDY);
    store.setFigureChoice(store.figurePlan()!.rows.find((r) => r.chosenVariable === "studyHours" && r.stated.value === 1)!.stated.id, { use: true });
    store.confirmFigures();
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Study two hours daily").values).toMatchObject({ studyHours: 2, weeksToExams: 4, revisionStyle: null });
    expect(branch(r, "Keep one hour daily").values).toMatchObject({ studyHours: 1, weeksToExams: 4 });
    expect(evaluateBranch(r, branch(r, "Study two hours daily")).calculated[0]!.result).toMatchObject({ status: "ok", value: 56 });
    expect(evaluateBranch(r, branch(r, "Keep one hour daily")).calculated[0]!.result).toMatchObject({ status: "ok", value: 28 });
  });

  it("when the draft has no assumption for the numbers, or the question has none, there is nothing to confirm", async () => {
    const q = setup([r19.projects!]);
    await q.store.requestPlan(COLLEGE);
    expect(q.store.figurePlan()).toMatchObject({ rows: [], offer: false, ready: false });
    q.store.confirmFigures();
    expect(readyPlan(q.store).figures.confirmed).toBe(false);
    await q.store.acceptPlan(0);
    expect(q.store.active()!.branches.every((b) => b.stated === undefined)).toBe(true);
    expect(q.calls).toHaveLength(1);
  });

  it("a plan with something in the way cannot be confirmed (two figures for one assumption in the same future)", async () => {
    const { store } = setup([r19.education!]);
    await store.requestPlan(STUDY);
    const study = store.figurePlan()!.rows.filter((r) => r.chosenVariable === "studyHours");
    store.setFigureChoice(study[0]!.stated.id, { use: true, target: "open" });
    store.setFigureChoice(study[1]!.stated.id, { use: true, target: "open" });
    expect(store.figurePlan()!.problem).not.toBeNull();
    store.confirmFigures();
    expect(readyPlan(store).figures.confirmed).toBe(false);
  });

  it("any change after confirming re-opens the confirmation; 'Change' re-opens it too", async () => {
    const { store } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    store.confirmFigures();
    store.changeFigures();
    expect(readyPlan(store).figures.confirmed).toBe(false);
    store.confirmFigures();
    store.setFigureChoice(store.figurePlan()!.rows[0]!.stated.id, { use: false });
    expect(readyPlan(store).figures.confirmed).toBe(false);
  });

  it("dropping a kept assumption from the draft un-confirms figures that no longer fit; unrelated edits keep them", async () => {
    const { store } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    store.setFigureChoice(store.figurePlan()!.rows.find((r) => r.chosenVariable === "rent")!.stated.id, { use: true });
    store.confirmFigures();
    store.editPlan((p, s) => ({ proposal: p, selection: { ...s, branches: s.branches.map((k, i) => (i === 1 ? false : k)) } }));
    expect(readyPlan(store).figures.confirmed).toBe(true);
    const rentAt = audit.bookstore!.variables.findIndex((v) => v.key === "rent");
    store.editPlan((p, s) => ({ proposal: p, selection: { ...s, variables: s.variables.map((k, i) => (i === rentAt ? false : k)) } }));
    expect(readyPlan(store).figures.confirmed).toBe(false);
    expect(store.figurePlan()!.rows.map((r) => r.chosenVariable)).not.toContain("rent");
  });
});

describe("Edit my question", () => {
  it("applies the wording locally: no request, the draft stays, figures are read from the new wording and need confirming again", async () => {
    const { store, calls } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    store.confirmFigures();
    const draftBefore = readyPlan(store).proposal;
    expect(store.editQuestion(BOOKSTORE.replace("₹20,000", "₹25,000"))).toBe(true);
    const plan = readyPlan(store);
    expect(plan.question).toContain("₹25,000");
    expect(plan.madeFor).toBe(BOOKSTORE);
    expect(plan.proposal).toBe(draftBefore);
    expect(plan.figures.confirmed).toBe(false);
    expect(store.figurePlan()!.rows.find((r) => r.chosenVariable === "monthlySales")!.stated.value).toBe(25000);
    expect(calls).toHaveLength(1);
    store.confirmFigures();
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(r.question).toContain("₹25,000");
    expect(branch(r, "Open the bookstore").values.monthlySales).toBe(25000);
    expect(branch(r, "Open the bookstore").stated!.monthlySales!.text).toBe("₹25,000 per month in sales");
  });

  it("a choice the user made about a figure that did not change is kept", async () => {
    const { store } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    const other = store.figurePlan()!.rows.find((r) => r.chosenVariable === "otherCosts")!;
    expect(other.use).toBe(true);
    store.setFigureChoice(other.stated.id, { use: false });
    store.editQuestion(BOOKSTORE.replace("₹20,000", "₹25,000"));
    expect(store.figurePlan()!.rows.find((r) => r.chosenVariable === "otherCosts")!.use).toBe(false);
  });

  it("keeps a missing 'What if', refuses empty or over-long wording, and changes nothing when refused", async () => {
    const { store } = setup([audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    expect(store.editQuestion("   ")).toBe(false);
    // Over the limit once "What if " is added (the limit is MAX_QUESTION_LENGTH characters of the question as asked).
    expect(store.editQuestion("x".repeat(MAX_QUESTION_LENGTH))).toBe(false);
    expect(readyPlan(store).question).toBe(BOOKSTORE);
    expect(store.editQuestion("…I opened a bookstore with ₹5,000 rent?")).toBe(true);
    expect(readyPlan(store).question).toBe("What if I opened a bookstore with ₹5,000 rent?");
  });

  it("never touches a saved map: only the pending draft's wording changes", async () => {
    const { store } = setup([audit.bookstore!, audit.bookstore!]);
    await store.requestPlan(BOOKSTORE);
    await store.acceptPlan(0);
    const saved = JSON.stringify(store.getState().realities);
    await store.requestPlan("What if I opened a café?");
    store.editQuestion("What if I opened a bakery?");
    expect(JSON.stringify(store.getState().realities)).toBe(saved);
  });

  it("is ignored while a replacement is on its way", async () => {
    const s = setup([audit.bookstore!, audit.bookstore!]);
    await s.store.requestPlan(BOOKSTORE);
    s.pause();
    const pending = s.store.regenerate();
    expect(s.store.editQuestion("What if I opened a bakery?")).toBe(false);
    s.go();
    await pending;
  });
});

describe("Generate different possibilities", () => {
  it("is one request with the same question, keeps the draft on screen while it waits, then shows the new one for review (nothing is created)", async () => {
    const s = setup([audit.bookstore!, { ...audit.bookstore!, interpretation: "A second reading of the same question." }]);
    await s.store.requestPlan(BOOKSTORE);
    const first = readyPlan(s.store);
    s.pause();
    const pending = s.store.regenerate();
    const waiting = readyPlan(s.store);
    expect(waiting.busy).toBe(true);
    expect(waiting.proposal).toBe(first.proposal);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]).toEqual({ path: "/api/plan", body: { question: BOOKSTORE } });
    s.go();
    await pending;
    const next = readyPlan(s.store);
    expect(next.busy).toBe(false);
    expect(next.proposal.interpretation).toBe("A second reading of the same question.");
    expect(next.figures).toEqual({ confirmed: false, choices: {} });
    expect(s.store.getState().realities).toEqual([]);
    expect(s.store.active()).toBeNull();
  });

  it("when the request fails the draft the user was looking at comes back, with the reason", async () => {
    const s = setup([audit.bookstore!], (_call, n) => (n === 2 ? failure : undefined));
    await s.store.requestPlan(BOOKSTORE);
    s.store.confirmFigures();
    const first = readyPlan(s.store);
    await s.store.regenerate();
    const plan = readyPlan(s.store);
    expect(plan.busy).toBe(false);
    expect(plan.retryError).toBe("The AI guide took too long.");
    expect(plan.proposal).toBe(first.proposal);
    expect(plan.figures.confirmed).toBe(true);
    // A later success clears the reason.
    await s.store.regenerate();
    expect(readyPlan(s.store).retryError).toBeNull();
  });

  it("a reply that fails the browser's own checks is treated as a failure, not shown", async () => {
    const bad = { ...audit.bookstore!, interpretation: "Most shops fail: 60% close in a year." };
    const s = setup([audit.bookstore!, bad as Proposal]);
    await s.store.requestPlan(BOOKSTORE);
    const first = readyPlan(s.store);
    await s.store.regenerate();
    const plan = readyPlan(s.store);
    expect(plan.proposal).toBe(first.proposal);
    expect(plan.retryError).toMatch(/failed RealityFork's checks/);
  });

  it("uses the wording as edited, so a corrected question gets possibilities made for it; the note about wording clears", async () => {
    const s = setup([audit.bookstore!, audit.bookstore!]);
    await s.store.requestPlan(BOOKSTORE);
    const edited = "What if I opened a weekend bookstore with ₹25,000 per month in sales?";
    s.store.editQuestion(edited);
    expect(readyPlan(s.store).madeFor).toBe(BOOKSTORE);
    await s.store.regenerate();
    expect(s.calls[1]!.body).toEqual({ question: edited });
    const plan = readyPlan(s.store);
    expect(plan.question).toBe(edited);
    expect(plan.madeFor).toBe(edited);
  });

  it("carries the answers the user already gave and does not ask the context questions again", async () => {
    const withQuestions = { ...audit.bookstore!, contextQuestions: [{ question: "Which town?", why: "Rents differ.", examples: ["a small town"] }] };
    const s = setup([withQuestions as Proposal, audit.bookstore!, audit.bookstore!]);
    await s.store.requestPlan(BOOKSTORE);
    expect(s.store.getState().plan.status).toBe("context");
    s.store.answerContext("Pune");
    await waitReady(s.store);
    expect(s.calls).toHaveLength(2);
    await s.store.regenerate();
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.body).toEqual({ question: BOOKSTORE, context: [{ question: "Which town?", answer: "Pune" }] });
    expect(readyPlan(s.store).tailored).toBe(true);
    expect(readyPlan(s.store).round.answers).toEqual(["Pune"]);
  });

  it("when the question had context questions and the user skipped them, they are not asked again", async () => {
    const withQuestions = { ...audit.bookstore!, contextQuestions: [{ question: "Which town?", why: "Rents differ.", examples: [] }] };
    const s = setup([withQuestions as Proposal, withQuestions as Proposal]);
    await s.store.requestPlan(BOOKSTORE);
    s.store.skipContext();
    await waitReady(s.store);
    await s.store.regenerate();
    const plan = readyPlan(s.store);
    expect(plan.proposal.contextQuestions).toEqual([]);
    expect(plan.tailored).toBe(false);
    expect(s.calls[1]!.body).toEqual({ question: BOOKSTORE });
  });

  it("discarding while it waits ignores the late reply", async () => {
    const s = setup([audit.bookstore!, audit.bookstore!]);
    await s.store.requestPlan(BOOKSTORE);
    s.pause();
    const pending = s.store.regenerate();
    s.store.rejectPlan();
    s.go();
    await pending;
    expect(s.store.getState().plan.status).toBe("idle");
  });
});

describe("a draft made for other wording", () => {
  it("keeps the wording it was made for when the answers are changed afterwards", async () => {
    const withQuestions = { ...audit.bookstore!, contextQuestions: [{ question: "Which town?", why: "Rents differ.", examples: [] }] };
    const s = setup([withQuestions as Proposal, audit.bookstore!, audit.bookstore!]);
    await s.store.requestPlan(BOOKSTORE);
    s.store.answerContext("Pune");
    await waitReady(s.store);
    s.store.editQuestion("What if I opened a weekend bookstore with ₹25,000 per month in sales?");
    s.store.editContext();
    s.store.answerContext("Mumbai");
    await waitReady(s.store);
    expect(readyPlan(s.store).question).toContain("₹25,000");
    // The tailored request used the question as edited, so the draft was made for it.
    expect(s.calls[2]!.body.question).toContain("₹25,000");
    expect(readyPlan(s.store).madeFor).toContain("₹25,000");
  });
});

// ---------- R20A: trustworthy figures ----------

describe("R20A: figures are read conservatively, kept through an edit, and shared only when the question shows it", () => {
  const row = (store: RealityStore, variable: string, value?: number) =>
    store.figurePlan()!.rows.find((r) => r.chosenVariable === variable && (value === undefined || r.stated.value === value))!;

  it("RV-01: a lump-sum budget is not put into a 'Monthly budget' unless the user ticks it, and then it is used as written", async () => {
    const a = setup([r20a.bookstoreMonthlyBudget!]);
    await a.store.requestPlan(MISSION_BOOKSTORE);
    expect(row(a.store, "monthlyBudget")).toMatchObject({ use: false, status: "check" });
    a.store.confirmFigures();
    await a.store.acceptPlan(0);
    const without = a.store.active()!;
    expect(branch(without, "Open a physical shop").values).toMatchObject({ monthlyBudget: null, monthlyRent: 35000 });
    expect(without.branches.every((b) => b.stated?.monthlyBudget === undefined)).toBe(true);

    const b = setup([r20a.bookstoreMonthlyBudget!]);
    await b.store.requestPlan(MISSION_BOOKSTORE);
    b.store.setFigureChoice(row(b.store, "monthlyBudget").stated.id, { use: true });
    b.store.confirmFigures();
    await b.store.acceptPlan(0);
    const ticked = b.store.active()!;
    expect(branch(ticked, "Open a physical shop").values).toMatchObject({ monthlyBudget: 500000, monthlyRent: 35000 });
    expect(branch(ticked, "Open a physical shop").stated!.monthlyBudget).toEqual({ text: "budget of ₹500,000", value: 500000 });
    // Starting budget (no period) takes it with no tick: nothing is borrowed, nothing is asked.
    const c = setup([r20a.bookstoreStartingBudget!]);
    await c.store.requestPlan(MISSION_BOOKSTORE);
    expect(row(c.store, "startingBudget")).toMatchObject({ use: true, status: "clear" });
  });

  it("RV-02: a hedged amount is left out until the user says it is exact; then the number written is what is used, with the user's words", async () => {
    const HEDGED = "What if I opened a weekend bookstore with about ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?";
    const a = setup([audit.bookstore!]);
    await a.store.requestPlan(HEDGED);
    const sales = row(a.store, "monthlySales");
    expect(sales.stated.qualifier).toMatchObject({ kind: "about", word: "about" });
    expect(sales).toMatchObject({ use: false, status: "check" });
    expect(a.store.figurePlan()!.rows.filter((r) => r.use).map((r) => r.chosenVariable)).toEqual(["otherCosts"]);
    a.store.confirmFigures();
    await a.store.acceptPlan(0);
    expect(branch(a.store.active()!, "Open the bookstore").values.monthlySales).toBeNull();

    const b = setup([audit.bookstore!]);
    await b.store.requestPlan(HEDGED);
    b.store.setFigureChoice(row(b.store, "monthlySales").stated.id, { use: true });
    b.store.confirmFigures();
    await b.store.acceptPlan(0);
    const open = branch(b.store.active()!, "Open the bookstore");
    expect(open.values.monthlySales).toBe(20000);
    expect(open.stated!.monthlySales!.text).toBe("about ₹20,000 per month in sales");
  });

  it("RV-03: correcting a number keeps the tick and the future, says so, asks to confirm again, and applies the new number to the same future", async () => {
    const { store, calls } = setup([r20a.studyMonths!]);
    await store.requestPlan(MISSION_STUDY);
    expect(row(store, "studyHours", 3)).toMatchObject({ use: true, target: 0 });
    store.setFigureChoice(row(store, "studyHours", 1).stated.id, { use: true });
    store.confirmFigures();
    expect(readyPlan(store).figures.confirmed).toBe(true);

    expect(store.editQuestion(MISSION_STUDY.replace("3 hours", "2 hours"))).toBe(true);
    const plan = readyPlan(store);
    // The number changed, so it is confirmed again; nothing is applied meanwhile.
    expect(plan.figures.confirmed).toBe(false);
    expect(plan.figures.notes).toEqual([
      "Kept your choices for “studied for 2 hours every day” (it was “studied for 3 hours every day”). It goes in “Study three hours daily”.",
      "The name “Study three hours daily” was written for the earlier number. Check that it still fits, or ask for possibilities that match your new wording.",
    ]);
    expect(row(store, "studyHours", 2)).toMatchObject({ use: true, target: 0, unplaced: false, blocked: null });
    expect(row(store, "studyHours", 1)).toMatchObject({ use: true, target: 1 });
    expect(store.figurePlan()).toMatchObject({ warning: null, ready: true });

    store.confirmFigures();
    expect(readyPlan(store).figures.notes).toBeUndefined();
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Study three hours daily").values.studyHours).toBe(2);
    expect(branch(r, "Study three hours daily").stated!.studyHours).toEqual({ text: "studied for 2 hours every day", value: 2 });
    expect(branch(r, "Keep one hour daily").values.studyHours).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("RV-03: a choice that cannot be kept is said, the new figure is still shown, and leaving it out is warned about before confirming", async () => {
    const { store } = setup([r20a.studyMonths!]);
    await store.requestPlan(MISSION_STUDY);
    store.confirmFigures();
    // The unit of the first figure changes (per day → per week): it no longer fits "hours per day".
    store.editQuestion(MISSION_STUDY.replace("3 hours every day", "3 hours every week"));
    const plan = readyPlan(store);
    expect(plan.figures.notes!.join(" ")).toMatch(/Not kept: your choice for “studied for 3 hours every day”/);
    const fp = store.figurePlan()!;
    expect(fp.unused.map((u) => u.text)).toContain("studied for 3 hours every week");
    expect(fp.rows.some((r) => r.stated.text.includes("every week"))).toBe(false);

    // The old wording but the futures' names cannot tell the two hours figures apart: the panel says what is left out.
    const draft = structuredClone(r20a.studyMonths!);
    draft.branches[0]!.name = "Study longer";
    draft.branches[1]!.name = "Keep my routine";
    draft.possibilities = draft.possibilities.map((x) => ({ ...x, branch: x.branch === "Study three hours daily" ? "Study longer" : x.branch === "Keep one hour daily" ? "Keep my routine" : x.branch }));
    const b = setup([draft]);
    await b.store.requestPlan(MISSION_STUDY);
    const warn = b.store.figurePlan()!;
    expect(warn.warning).toMatch(/has no future yet|have no future yet/);
    expect(warn.unplaced.map((r) => r.stated.value)).toEqual([3, 1]);
    // Confirming is still possible if something else is ticked, but nothing is left out without having been said.
    b.store.setFigureChoice(row(b.store, "studyHours", 3).stated.id, { use: true, target: 0 });
    expect(b.store.figurePlan()!.warning).toBe("“1 hour for the next” has no future yet, so it will not be used unless you choose one.");
  });

  it("RV-06: the bookstore example: the budget and the rent go to both futures after one confirmation, whichever is opened, and Compare shows them as the same in both", async () => {
    for (const open of [0, 1]) {
      const { store, calls } = setup([r20a.bookstoreStartingBudget!]);
      await store.requestPlan(MISSION_BOOKSTORE);
      expect(store.figurePlan()!.rows.map((r) => [r.chosenVariable, r.target, r.use, r.scopeText])).toEqual([
        ["startingBudget", "all", true, "Used in every future in the draft (2)."],
        ["monthlyRent", "all", true, "Used in every future in the draft (2)."],
      ]);
      store.confirmFigures();
      await store.acceptPlan(open);
      const r = store.active()!;
      const physical = branch(r, "Open a physical shop");
      const online = branch(r, "Start online first");
      for (const b of [physical, online]) {
        expect(b.values, b.name).toMatchObject({ startingBudget: 500000, monthlyRent: 35000 });
        expect(b.sources, b.name).toMatchObject({ startingBudget: "user", monthlyRent: "user", shopFormat: "ai" });
        expect(evaluateBranch(r, b).calculated[0]!.result, b.name).toMatchObject({ status: "ok", value: 500000 / 35000 });
      }
      // The starting point is untouched, and the copies descend from it.
      const root = r.branches[0]!;
      expect(root.parentId).toBeNull();
      expect(root.values.startingBudget).toBeNull();
      expect([physical.parentId, online.parentId]).toEqual([root.id, root.id]);
      const cmp = compareStory(r, physical.id, online.id);
      expect(cmp.differences.map((d) => d.variable.key)).toEqual(["shopFormat"]);
      expect(cmp.sameInBoth.map((s) => s.variable.key)).toEqual(["startingBudget", "monthlyRent"]);
      expect(cmp.missingForCalculation).toEqual([]);
      expect(calls).toHaveLength(1);
      // Saving and reopening changes nothing: fingerprints and provenance are those of the content.
      const [back] = await importRealities(exportRealities([r]));
      expect(back).toEqual(r);
    }
  });

  it("RV-06: the user can narrow the scope before confirming, and Compare then says the other future has nothing decided", async () => {
    const { store } = setup([r20a.bookstoreStartingBudget!]);
    await store.requestPlan(MISSION_BOOKSTORE);
    store.setFigureChoice(row(store, "startingBudget").stated.id, { target: 1 });
    expect(row(store, "startingBudget")).toMatchObject({ target: 1, scopeText: "Used only in “Start online first”.", scopeWhy: null });
    store.confirmFigures();
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Open a physical shop").values.startingBudget).toBeNull();
    expect(branch(r, "Start online first").values.startingBudget).toBe(500000);
    const cmp = compareStory(r, branch(r, "Open a physical shop").id, branch(r, "Start online first").id);
    expect(cmp.differences.find((d) => d.variable.key === "startingBudget")).toMatchObject({ a: null, b: 500000 });
    expect(cmp.sameInBoth.map((s) => s.variable.key)).toEqual(["monthlyRent"]);
    expect(cmp.missingForCalculation).toEqual(["Starting budget"]);
  });

  it("RV-06: figures that are part of what is asked about, and figures that compete, do not spread", async () => {
    // R19's bookstore: sales, rent and costs are what the "what if" describes; the future that is not opened gets none.
    const a = setup([audit.bookstore!]);
    await a.store.requestPlan(BOOKSTORE);
    a.store.setFigureChoice(row(a.store, "rent").stated.id, { use: true });
    a.store.confirmFigures();
    await a.store.acceptPlan(0);
    expect(branch(a.store.active()!, "Don't open it").values).toMatchObject({ monthlySales: null, rent: null, otherCosts: null });
    // Competing figures: each stays in the future whose name says it, even when the user ticks them both.
    const b = setup([r20a.studyMonths!]);
    await b.store.requestPlan(MISSION_STUDY);
    b.store.setFigureChoice(row(b.store, "studyHours", 1).stated.id, { use: true });
    b.store.setFigureChoice(row(b.store, "horizonMonths").stated.id, { use: true });
    b.store.confirmFigures();
    await b.store.acceptPlan(1);
    const r = b.store.active()!;
    expect(branch(r, "Study three hours daily").values).toMatchObject({ studyHours: 3, horizonMonths: 6 });
    expect(branch(r, "Keep one hour daily").values).toMatchObject({ studyHours: 1, horizonMonths: 6 });
    expect(evaluateBranch(r, branch(r, "Study three hours daily")).calculated[0]!.result).toMatchObject({ status: "ok", value: (3 * 6 * 365) / 12 });
  });
});

// ---------- R20A.1: figure scope ----------

describe("R20A.1: figures go only to the futures they apply to, ambiguity is confirmed, and editing never moves a choice onto a new meaning", () => {
  const MOVE = "What if I moved to London?";
  const row = (store: RealityStore, variable: string) => store.figurePlan()!.rows.find((r) => r.chosenVariable === variable)!;

  it("'Rent there is £2,000 a month': London gets it whichever card is opened, the future that stays gets nothing, and Compare says so", async () => {
    for (const open of [0, 1]) {
      const { store, calls } = setup([r20a.relocation!]);
      await store.requestPlan(`${MOVE} Rent there is £2,000 a month.`);
      expect(row(store, "monthlyRent")).toMatchObject({ target: 0, use: true, scope: "scenario" });
      store.confirmFigures();
      await store.acceptPlan(open);
      const r = store.active()!;
      expect(branch(r, "Move to London").values.monthlyRent).toBe(2000);
      expect(branch(r, "Move to London").stated!.monthlyRent).toEqual({ text: "Rent there is £2,000 a month", value: 2000 });
      expect(branch(r, "Stay in Mumbai").values.monthlyRent).toBeNull();
      expect(branch(r, "Stay in Mumbai").stated).toBeUndefined();
      const cmp = compareStory(r, branch(r, "Move to London").id, branch(r, "Stay in Mumbai").id);
      expect(cmp.differences.find((d) => d.variable.key === "monthlyRent")).toMatchObject({ a: 2000, b: null });
      expect(cmp.sameInBoth).toEqual([]);
      expect(calls).toHaveLength(1);
    }
  });

  it("a plain fact in a draft with a future that stays is not placed: it is not applied until the user chooses, and the choice is exactly theirs", async () => {
    const { store } = setup([r20a.relocation!]);
    await store.requestPlan(`${MOVE} Rent is £2,000 a month.`);
    expect(row(store, "monthlyRent")).toMatchObject({ target: "none", use: false, scope: "unclear", unplaced: true });
    expect(store.figurePlan()!.warning).toMatch(/has no future yet/);
    // Confirming with nothing ticked is not possible, so nothing can be applied by accident.
    store.confirmFigures();
    expect(readyPlan(store).figures.confirmed).toBe(false);
    store.setFigureChoice(row(store, "monthlyRent").stated.id, { use: true, target: 1 });
    store.confirmFigures();
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Stay in Mumbai").values.monthlyRent).toBe(2000);
    expect(branch(r, "Move to London").values.monthlyRent).toBeNull();
  });

  it("different recurring expenses: each goes to its alternative, the savings go to both, and the one that names none is chosen by the user", async () => {
    const { store } = setup([r20a.housing!]);
    const Q = "What if I rented a flat or bought one? I have savings of ₹300,000. Rent would be ₹20,000 a month, while the loan payment would be ₹15,000 a month.";
    await store.requestPlan(Q);
    expect(store.figurePlan()!.rows.map((r) => [r.chosenVariable, r.target, r.use])).toEqual([["savings", "all", true], ["monthlyRent", 0, true], ["monthlyLoan", "none", false]]);
    expect(store.figurePlan()!.warning).toMatch(/loan payment would be ₹15,000 a month/);
    store.setFigureChoice(row(store, "monthlyLoan").stated.id, { use: true, target: 1 });
    expect(store.figurePlan()!.warning).toBeNull();
    store.confirmFigures();
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Rent a flat").values).toMatchObject({ savings: 300000, monthlyRent: 20000, monthlyLoan: null });
    expect(branch(r, "Buy a flat").values).toMatchObject({ savings: 300000, monthlyRent: null, monthlyLoan: 15000 });
    const cmp = compareStory(r, branch(r, "Rent a flat").id, branch(r, "Buy a flat").id);
    expect(cmp.sameInBoth.map((s) => s.variable.key)).toEqual(["savings"]);
    expect(cmp.differences.map((d) => d.variable.key)).toEqual(["tenure", "monthlyRent", "monthlyLoan"]);
  });

  it("editing a figure's wording from 'shared' to 'about London' drops the old choice of place, says so, and places it by what it now says", async () => {
    const { store } = setup([r20a.relocation!]);
    await store.requestPlan(`${MOVE} I have a budget of £2,000 a month for rent.`);
    expect(row(store, "monthlyRent")).toMatchObject({ target: "all", scope: "personal", use: true });
    store.confirmFigures();
    store.editQuestion(`${MOVE} My rent there would be £2,000 a month.`);
    const plan = readyPlan(store);
    expect(plan.figures.confirmed).toBe(false);
    expect(plan.figures.notes!.join(" ")).toMatch(/Not kept: your choice for “£2,000 a month for rent”/);
    expect(row(store, "monthlyRent")).toMatchObject({ target: 0, scope: "scenario", use: true });
    store.confirmFigures();
    await store.acceptPlan(0);
    expect(branch(store.active()!, "Stay in Mumbai").values.monthlyRent).toBeNull();
    expect(branch(store.active()!, "Move to London").values.monthlyRent).toBe(2000);
  });

  it("editing only the number keeps a shared figure shared and a London figure with London", async () => {
    const a = setup([r20a.relocation!]);
    await a.store.requestPlan(`${MOVE} I have a budget of £2,000 a month for rent.`);
    a.store.confirmFigures();
    a.store.editQuestion(`${MOVE} I have a budget of £2,500 a month for rent.`);
    expect(row(a.store, "monthlyRent")).toMatchObject({ target: "all", use: true });
    expect(row(a.store, "monthlyRent").stated.value).toBe(2500);
    const b = setup([r20a.relocation!]);
    await b.store.requestPlan(`${MOVE} Rent there is £2,000 a month.`);
    b.store.confirmFigures();
    b.store.editQuestion(`${MOVE} Rent there is £2,500 a month.`);
    expect(row(b.store, "monthlyRent")).toMatchObject({ target: 0, use: true });
    expect(readyPlan(b.store).figures.confirmed).toBe(false);
  });

  it("after a confirmation, editing the sentence that asks moves 'there' with it: the old place is not replayed, the move is said, and nothing is applied until confirmed again", async () => {
    const { store, calls } = setup([r20a.relocation!]);
    await store.requestPlan(`${MOVE} Rent there is £2,000 a month.`);
    expect(row(store, "monthlyRent")).toMatchObject({ target: 0, use: true });
    store.confirmFigures();
    expect(readyPlan(store).figures.confirmed).toBe(true);

    store.editQuestion("What if I stayed in Mumbai? Rent there is £2,000 a month.");
    const plan = readyPlan(store);
    expect(plan.figures.confirmed).toBe(false);
    expect(plan.figures.notes).toEqual(["Changed: “Rent there is £2,000 a month” was used in “Move to London”; with your new wording it goes in “Stay in Mumbai”. Check that this is right."]);
    expect(row(store, "monthlyRent")).toMatchObject({ target: 1, use: true, scopeText: "Used only in “Stay in Mumbai”." });
    // Not confirmed: opening a future now applies nothing.
    expect(store.figuresOn(0)).toBe(0);
    expect(store.figuresOn(1)).toBe(0);
    store.confirmFigures();
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(branch(r, "Stay in Mumbai").values.monthlyRent).toBe(2000);
    expect(branch(r, "Move to London").values.monthlyRent).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("after a confirmation, swapping the two numbers puts each back in the future whose name says it", async () => {
    const { store } = setup([r20a.studyMonths!]);
    await store.requestPlan(MISSION_STUDY);
    store.setFigureChoice(row(store, "studyHours").stated.id, { use: true });
    store.confirmFigures();
    store.editQuestion("What if I studied for 1 hour every day instead of 3 hours for the next 6 months?");
    const hours = store.figurePlan()!.rows.filter((r) => r.chosenVariable === "studyHours");
    expect(hours.map((r) => [r.stated.value, r.target])).toEqual([[1, 1], [3, 0]]);
    expect(readyPlan(store).figures.confirmed).toBe(false);
  });
});
