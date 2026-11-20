/**
 * The Phase 3 journey fixtures (e2e/fixtures/phase3-proposals.json) are what a real reply would have to be: each draft
 * passes validateProposal, the fresh look passes validateRevisit against the request the real store builds, and each
 * map is drawn by the same scenery rules as any other. Mocked provider; no network.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateProposal, type Proposal, type RevisitRequest, type RevisitSuggestion } from "@realityfork/core";
import { directEngine } from "../engine";
import type { StorageLike } from "../state/workspace";
import { RealityStore, type ApiFetcher } from "./store";
import { resolveScenery } from "../atlas/environment/resolve";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../../e2e/fixtures/phase3-proposals.json", import.meta.url)), "utf8")) as Record<string, unknown>;
const GAMING = "What if I started my own independent gaming company?";
const CELLO = "What if I learned to play the cello at sixty?";
const MODEL = "fixture: phase3-proposals.json (mocked, no AI request)";
type Look = Omit<RevisitSuggestion, "reconsider"> & { reconsider: { match: string; reason: string }[] };

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

/** The fresh look as the e2e mock sends it: suggestions named by their text get the ids the request gave them. */
function lookFor(req: RevisitRequest, look: Look): RevisitSuggestion {
  return { ...look, reconsider: look.reconsider.flatMap((x) => req.suggestions.filter((s) => s.text === x.match).map((s) => ({ id: s.id, reason: x.reason }))) };
}

function mockedStore() {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher: ApiFetcher = async (path, payload) => {
    const body = payload as Record<string, unknown>;
    sent.push({ path, body });
    if (path === "/api/revisit") return { status: 200, body: { ok: true, suggestion: lookFor(body as unknown as RevisitRequest, fx["gaming-revisit"] as Look), model: MODEL, warnings: [] } };
    const q = String(body.question);
    const proposal = q === CELLO ? fx.cello : body.context ? fx["gaming-tailored"] : fx["gaming-first"];
    return { status: 200, body: { ok: true, proposal, model: MODEL, warnings: [] } };
  };
  const store = new RealityStore(directEngine, new MemoryStorage(), fetcher, async () => undefined);
  return { store, sent };
}

describe("Phase 3 journey fixtures", () => {
  it("every draft is a valid planner draft", () => {
    for (const k of ["gaming-first", "gaming-tailored", "cello"]) {
      const check = validateProposal(fx[k]);
      expect(check.ok ? [] : check.errors, k).toEqual([]);
    }
    expect((fx["gaming-first"] as Proposal).contextQuestions).toHaveLength(2);
    expect((fx["gaming-tailored"] as Proposal).contextQuestions).toHaveLength(0);
  });

  it("the gaming journey: two optional questions, one answered, a tailored draft, a studio universe, a child path, a fresh look", async () => {
    const { store, sent } = mockedStore();
    await store.requestPlan(GAMING);
    expect(store.getState().plan.status).toBe("context");
    store.answerContext("Small story-driven games");
    store.skipContext();
    await new Promise((r) => setTimeout(r, 0));
    await expect.poll(() => store.getState().plan.status).toBe("ready");
    const plan = store.getState().plan;
    if (plan.status !== "ready") throw new Error("no draft");
    expect(plan.tailored).toBe(true);
    expect(sent.map((x) => [x.path, "context" in x.body])).toEqual([["/api/plan", false], ["/api/plan", true]]);
    await store.acceptPlan(0);
    const r = store.active()!;
    expect(r.context?.map((c) => c.answer)).toEqual(["Small story-driven games"]);
    expect(resolveScenery(r)).toMatchObject({ family: "business", theme: "studio" });
    const studio = r.branches.find((b) => b.name === "Self-funded indie studio")!;
    // Figures the user types, then a child path with one change, then a fresh look at it.
    await store.answer(studio.id, "savings", 18000);
    await store.answer(studio.id, "monthlyCosts", 1500);
    const child = await store.exploreChange(studio.id, { key: "workspace", value: "Spare room at home" });
    expect(child?.name).toBe("Self-funded indie studio · Where the work happens: Spare room at home");
    await store.requestRevisit(child!.id);
    const rv = store.getState().revisit;
    expect(rv.status === "error" ? rv.message : rv.status).toBe("ready");
    if (rv.status !== "ready") throw new Error("no fresh look");
    expect(rv.suggestion.reconsider.map((x) => x.reason)).toHaveLength(1);
    expect(rv.suggestion.add).toHaveLength(2);
    await store.applyRevisit();
    const after = store.active()!.branches.find((b) => b.id === child!.id)!;
    expect(after.possibilities.filter((p) => p.setAside).map((p) => p.text)).toEqual(["Savings run out before the game is finished"]);
    expect(after.possibilities.filter((p) => p.cause).map((p) => p.text)).toEqual((fx["gaming-revisit"] as Look).add.map((a) => a.text));
    expect(sent.map((x) => x.path)).toEqual(["/api/plan", "/api/plan", "/api/revisit"]);
  });

  it("an unusual question with no kind of place opens under the open sky", async () => {
    const { store } = mockedStore();
    await store.requestPlan(CELLO);
    expect(store.getState().plan.status).toBe("ready");
    await store.acceptPlan(1);
    const c = resolveScenery(store.active()!);
    expect([c.family, c.theme, c.automatic]).toEqual(["neutral", "sky", true]);
  });
});
