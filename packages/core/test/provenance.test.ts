/**
 * R19 P4: the request sent to the AI says who wrote each suggestion only as far as that is recorded, and does not let a
 * suggestion copied from an earlier path look freshly confirmed. The screen (possibilityOrigin, carriedOver) and the
 * request must agree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { buildFromTemplate, CAFE_QUEUE, MOVE_CITY, SOLAR } from "../src/reality/examples";
import { AI_POSSIBILITY_NOTE } from "../src/reality/proposal";
import { forkBranch, importRealities, updateBranch, type Possibility, type Reality } from "../src/reality/reality";
import {
  AI_REVISIT_NOTE, checkRevisitRequest, possibilityOrigin, REVISIT_SYSTEM_PROMPT, revisitCause, revisitRequest, validateRevisit,
  type RevisitRequest, type RevisitSuggestion,
} from "../src/reality/revisit";
import { carriedOver } from "../src/reality/story";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const counter = (p: string) => {
  let n = 0;
  return () => `${p}${++n}`;
};
const poss = (id: string, text: string, extra: Partial<Possibility> = {}): Possibility => ({ id, text, likelihood: "not-judged", note: "", ...extra });
const requestFor = (r: Reality, id: string): RevisitRequest => {
  const b = r.branches.find((x) => x.id === id)!;
  return revisitRequest(r, b, revisitCause(r, b));
};
const fromOf = (req: RevisitRequest, id: string) => req.suggestions.find((s) => s.id === id)!;

/** A start path that holds one possibility of every source RealityFork can record. */
async function everySource(): Promise<{ r: Reality; startId: string }> {
  let r = await buildFromTemplate(MOVE_CITY, counter("m"));
  const start = r.branches[0]!;
  r = await updateBranch(r, start.id, {
    possibilities: [
      ...start.possibilities.map((p) => ({ ...p })),
      poss("u1", "My sister lives nearby", { source: "user", tone: "upside" }),
      poss("a1", "Living costs could rise", { note: AI_POSSIBILITY_NOTE, tone: "challenge" }),
      poss("a2", "A second look found a risk", { note: AI_REVISIT_NOTE, tone: "challenge" }),
      poss("n1", "Saved before sources were recorded", { tone: "upside" }),
    ],
  });
  return { r, startId: start.id };
}

describe("the request says who wrote a suggestion only as far as that is recorded", () => {
  it("each source category is sent as itself: ai, user, example, unrecorded", async () => {
    const { r, startId } = await everySource();
    const req = requestFor(r, startId);
    expect(fromOf(req, "u1").from).toBe("user");
    expect(fromOf(req, "a1").from).toBe("ai");
    expect(fromOf(req, "a2").from).toBe("ai");
    expect(fromOf(req, "n1").from).toBe("unrecorded");
    const example = r.branches[0]!.possibilities.find((p) => p.source === "example")!;
    expect(fromOf(req, example.id).from).toBe("example");
  });

  it("an example's text and an unrecorded suggestion are never called 'user'", async () => {
    const { r, startId } = await everySource();
    for (const s of requestFor(r, startId).suggestions) {
      const p = r.branches[0]!.possibilities.find((x) => x.id === s.id)!;
      if (s.from === "user") expect(p.source, p.text).toBe("user");
    }
  });

  it("for every example and every older saved map the request origin equals what the screen shows", async () => {
    const maps: Reality[] = [];
    for (const t of [MOVE_CITY, SOLAR, CAFE_QUEUE]) maps.push(await buildFromTemplate(t, counter("t")));
    for (const f of ["realities-4e4bdfe.json", "realities-5b17057.json", "realities-6e4b8f2.json"]) maps.push(...(await importRealities(fixture(f))));
    let checked = 0;
    for (const r of maps) {
      for (const b of r.branches) {
        const req = requestFor(r, b.id);
        for (const s of req.suggestions) {
          const p = b.possibilities.find((x) => x.id === s.id)!;
          expect(s.from, `${r.question} › ${b.name} › ${p.text}`).toBe(possibilityOrigin(p));
          checked++;
        }
        expect(checkRevisitRequest(req)).toEqual({ ok: true, request: req });
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("saved maps from before sources were recorded stay 'unrecorded': nothing is invented about them", async () => {
    const [old] = await importRealities(fixture("realities-6e4b8f2.json"));
    const req = requestFor(old!, old!.branches[0]!.id);
    const origins = new Set(req.suggestions.map((s) => s.from));
    expect(origins.has("user")).toBe(false);
    expect(origins.has("example")).toBe(false);
    expect([...origins]).toEqual(expect.arrayContaining(["unrecorded"]));
  });
});

/** A child of the start path that differs from it (one value changed), so what it copied was not written for what it holds now. */
async function changedChild(r: Reality, startId: string, name: string, idGen: () => string): Promise<{ reality: Reality; id: string }> {
  const f = await forkBranch(r, startId, { name }, idGen);
  const key = f.reality.variables.find((v) => v.kind === "number")!.key;
  const reality = await updateBranch(f.reality, f.branch.id, { values: { [key]: 4321 }, sources: { [key]: "user" } });
  return { reality, id: f.branch.id };
}

describe("a suggestion copied from an earlier path is marked inherited, the same ones the screen tags as carried over", () => {
  it("the path where it was written is not marked; its changed child is, for everything that was not re-checked", async () => {
    const { r, startId } = await everySource();
    const c = await changedChild(r, startId, "A child path", counter("f"));
    const parentReq = requestFor(c.reality, startId);
    expect(parentReq.suggestions.some((s) => "inherited" in s)).toBe(false);

    const childReq = requestFor(c.reality, c.id);
    const child = c.reality.branches.find((b) => b.id === c.id)!;
    const carried = new Set(carriedOver(c.reality, child).map((x) => x.possibility.id));
    expect(carried.size).toBeGreaterThan(0);
    for (const s of childReq.suggestions) expect("inherited" in s, s.text).toBe(carried.has(s.id));
    // Origin is unchanged by inheritance: a user's note copied down is still the user's, an example still an example.
    expect(fromOf(childReq, "u1")).toMatchObject({ from: "user", inherited: true });
    expect(fromOf(childReq, "n1")).toMatchObject({ from: "unrecorded", inherited: true });
    expect(checkRevisitRequest(childReq)).toEqual({ ok: true, request: childReq });
  });

  it("an unchanged copy has nothing the screen calls 'carried over', so nothing is marked: the two never disagree", async () => {
    const { r, startId } = await everySource();
    const f = await forkBranch(r, startId, { name: "Same as before" }, counter("u"));
    const child = f.reality.branches.find((b) => b.id === f.branch.id)!;
    expect(carriedOver(f.reality, child)).toEqual([]);
    expect(requestFor(f.reality, f.branch.id).suggestions.some((s) => "inherited" in s)).toBe(false);
  });

  it("inherited is only ever true when present, and an AI suggestion that records its basis is left to staleness", async () => {
    const { r, startId } = await everySource();
    const c = await changedChild(r, startId, "Child", counter("g"));
    for (const s of requestFor(c.reality, c.id).suggestions) expect(s.inherited === undefined || s.inherited === true).toBe(true);
    const child = c.reality.branches.find((b) => b.id === c.id)!;
    const withBasis = await updateBranch(c.reality, c.id, {
      possibilities: child.possibilities.map((p) => (p.id === "a1" ? { ...p, about: ["rent"], basis: { values: { rent: null }, known: [] } } : p)),
    });
    expect("inherited" in fromOf(requestFor(withBasis, c.id), "a1")).toBe(false);
  });

  it("the request still sends no other path, id or fingerprint", async () => {
    const { r, startId } = await everySource();
    const c = await changedChild(r, startId, "Child", counter("h"));
    const json = JSON.stringify(requestFor(c.reality, c.id));
    expect(json).not.toContain(startId);
    expect(json).not.toContain(c.reality.branches[0]!.fingerprint);
  });
});

describe("the server check", () => {
  it("accepts the four origins and the inherited flag and rebuilds them unchanged; drops anything else in the body", async () => {
    const { r, startId } = await everySource();
    const c = await changedChild(r, startId, "Child", counter("k"));
    const req = requestFor(c.reality, c.id);
    expect(req.suggestions.some((s) => s.inherited === true)).toBe(true);
    const sneaky = { ...req, suggestions: req.suggestions.map((s) => ({ ...s, secret: 1 })) };
    const checked = checkRevisitRequest(sneaky);
    expect(checked.ok && JSON.stringify(checked.request)).toBe(JSON.stringify(req));
  });

  it("rejects an origin it does not know and an inherited flag that is not exactly true", async () => {
    const { r, startId } = await everySource();
    const req = requestFor(r, startId);
    const s0 = req.suggestions[0]!;
    for (const bad of [{ from: "assistant" }, { from: "" }, { from: "USER" }, { from: null }, { inherited: false }, { inherited: "yes" }, { inherited: 1 }]) {
      expect(checkRevisitRequest({ ...req, suggestions: [{ ...s0, ...bad }] }).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("requests in the earlier two-value form (ai, user) and the recorded R16 live request still pass", () => {
    const live = JSON.parse(readFileSync(fileURLToPath(new URL("../../../docs/validation/r16-live-quality.json", import.meta.url)), "utf8"));
    expect(checkRevisitRequest(live.request2.body).ok).toBe(true);
    const old = { ...live.request2.body, suggestions: [{ id: "s1", text: "Something", tone: "uncertain", from: "user" }] };
    expect(checkRevisitRequest(old).ok).toBe(true);
  });
});

describe("what the AI may reconsider", () => {
  const reply = (id: string): RevisitSuggestion => ({
    summary: "Because the user told us something new, this suggestion could change.", reconsider: [{ id, reason: "It may no longer hold." }], add: [], questions: [], evidence: [],
  });

  it("only its own earlier suggestions: a user's note, an example's text or an unrecorded one is not the AI's to set aside", async () => {
    const { r, startId } = await everySource();
    const req = requestFor(r, startId);
    expect(validateRevisit(reply("a1"), req).ok).toBe(true);
    expect(validateRevisit(reply("a2"), req).ok).toBe(true);
    const example = r.branches[0]!.possibilities.find((p) => p.source === "example")!;
    for (const id of ["u1", "n1", example.id]) {
      const check = validateRevisit(reply(id), req);
      expect(check.ok, id).toBe(false);
      if (!check.ok) expect(check.errors.join(" ")).toMatch(/is not one of this path's AI suggestions/);
    }
  });
});

describe("the instruction to the model", () => {
  it("says what each origin means and that inherited is not confirmed for this path, in one place", () => {
    expect(REVISIT_SYSTEM_PROMPT).toMatch(/unrecorded = nobody recorded who wrote it, so do not assume it came from the user/);
    expect(REVISIT_SYSTEM_PROMPT).toMatch(/example = illustrative text from a built-in example, not the user's/);
    expect(REVISIT_SYSTEM_PROMPT).toMatch(/inherited: true means it was copied from an earlier path and was not re-checked for this one/);
    expect(REVISIT_SYSTEM_PROMPT.match(/inherited: true/g)).toHaveLength(1);
  });
});
