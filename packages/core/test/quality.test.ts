/**
 * R16: conditional causal consequences. A consequence carries what could set it off, why, what it could change next
 * and what would confirm or reverse it. Research tasks and advice are not consequences; contradictory or identical
 * futures are rejected; files saved before R16 import unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/index";
import { consequenceErrors, internalNames, isTaskLike, proposalToReality, selectAll, validateProposal, type ConsequenceParts, type Proposal } from "../src/reality/proposal";
import { exportRealities, importRealities, updateBranch } from "../src/reality/reality";
import { applyRevisit, revisitCause, revisitRequest, selectAllRevisit, validateRevisit } from "../src/reality/revisit";
import { branchStory, conditionalSentence, consequenceView, knownView, staleSuggestions } from "../src/reality/story";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/e2e/fixtures/reactive-proposals.json", import.meta.url)), "utf8")) as Record<string, Proposal>;
const draft = (k: string): Proposal => structuredClone(fx[k]!);
const counter = () => {
  let n = 0;
  return () => `q${++n}`;
};
const errorsOf = (raw: unknown) => {
  const c = validateProposal(raw);
  return c.ok ? [] : c.errors;
};
const ok: ConsequenceParts = {
  text: "Monthly savings could shrink", trigger: "living costs turn out higher while your salary stays the same",
  mechanism: "Rent, insurance and daily costs would take a larger share of the same income.", downstream: "Housing choices or savings goals may need to change.",
  uncertainty: "Your actual rent, health insurance, taxes and salary after the move.",
};

describe("research tasks and advice are not consequences", () => {
  // The four items from the R16 brief's real-world test and the four from the stored R15 live look, verbatim.
  const reported = ["Investigate housing costs.", "Check health insurance requirements.", "Assess whether salary covers expenses.", "Consider German language classes."];
  const storedLive = [
    "Investigate which visa category (e.g., digital nomad, work, or other) is required for remote employees in Germany.",
    "Compare Germany's cost of living to your current location to see if it fits your budget.",
    "Assess the level of German language needed for daily life and whether you need to start learning.",
    "Plan how you will build a new social support network after the move.",
  ];
  it("flags every task from the baseline", () => {
    for (const t of [...reported, ...storedLive]) expect(isTaskLike(t), t).toBe(true);
  });
  it("flags advice, even when hedged", () => {
    for (const t of ["You should check the rental market first.", "You may want to compare health insurers.", "It is worth asking your employer.", "Make sure your contract allows it.", "You could investigate co-working spaces."]) expect(isTaskLike(t), t).toBe(true);
  });
  it("does not flag consequences, including those that start with a noun a task could start with", () => {
    for (const t of [
      ok.text, "Long hours leave little time for family", "Budget pressure could rise in the first months", "Contact with family could become rarer",
      "Start-up costs could exceed your savings", "Plans could change once you arrive", "Finding a suitable job can be difficult", "Learning German could take time",
      "You may need to pay a higher rent", "Research time for your thesis could shrink", "Delivery-app fees reduce what you keep from each order",
    ]) expect(isTaskLike(t), t).toBe(false);
  });
});

describe("a consequence needs a cause and stays conditional", () => {
  const errs = (c: Partial<ConsequenceParts>) => consequenceErrors("possibilities[0]", { ...ok, ...c }).join(" | ");
  it("accepts a complete consequence; nothing has to follow it", () => {
    expect(errs({})).toBe("");
    expect(errs({ downstream: "" })).toBe("");
  });
  it("requires a trigger, a mechanism and what could change it", () => {
    expect(errs({ trigger: " " })).toMatch(/possibilities\[0\]\.trigger is empty/);
    expect(errs({ mechanism: "" })).toMatch(/possibilities\[0\]\.mechanism is empty/);
    expect(errs({ uncertainty: "" })).toMatch(/possibilities\[0\]\.uncertainty is empty/);
  });
  it("rejects figures in any part", () => {
    expect(errs({ mechanism: "Rent takes about 40% of income." })).toMatch(/\.mechanism states a figure/);
    expect(errs({ downstream: "You could save €300 less each month." })).toMatch(/\.downstream states a figure/);
    expect(errs({ uncertainty: "Whether rent stays under £1,000." })).toMatch(/\.uncertainty states a figure/);
  });
  it("rejects regulated claims in what it asserts, but allows them in the condition and in what to find out", () => {
    expect(errs({ mechanism: "As a remote worker you qualify for a digital nomad visa." })).toMatch(/\.mechanism states eligibility/);
    expect(errs({ downstream: "You will be a tax resident in Germany." })).toMatch(/\.downstream states eligibility/);
    expect(errs({ text: "Moving is legally required to be registered within two weeks" })).toMatch(/possibilities\[0\] states eligibility/);
    expect(errs({ trigger: "working from Germany is permitted for you", uncertainty: "Whether you qualify for a residence permit." })).toBe("");
  });
  it("rejects laws and official rules stated as fact (the two from the R16 live replies)", () => {
    expect(errs({ mechanism: "German tax law taxes residents on worldwide income." })).toMatch(/\.mechanism states eligibility/);
    expect(errs({ mechanism: "German tax rates apply to worldwide income for residents." })).toMatch(/\.mechanism states eligibility/);
    expect(errs({ mechanism: "Spending less than the residency threshold keeps you non-resident for tax purposes." })).toMatch(/\.mechanism states eligibility/);
    expect(errs({ mechanism: "Higher everyday expenses reduce the amount left after paying bills." })).toBe("");
  });
  it("rejects code names in text people read, and an if-clause inside the consequence", () => {
    const names = ["taxResident", "languageProficiency", "touristOrResidencePermit"];
    const named = (c: Partial<ConsequenceParts>) => consequenceErrors("add[0]", { ...ok, ...c }, names).join(" | ");
    expect(named({ trigger: "taxResident becomes true" })).toMatch(/add\[0\]\.trigger uses the internal name "taxResident"/);
    expect(named({ trigger: "languageProficiency remains at basic level" })).toMatch(/uses the internal name "languageProficiency"/);
    expect(named({ text: "You could face a higher tax burden if you become a German tax resident" })).toMatch(/add\[0\] has its own if-clause/);
    expect(named({ trigger: "you become a tax resident in Germany" })).toBe("");
    // Ordinary words that happen to be keys are not code names: only camelCase names count.
    expect(internalNames([{ key: "format", options: ["café", "full restaurant"] }, { key: "visaStatus", options: ["workVisa", "none"] }])).toEqual(["visaStatus", "workVisa"]);
  });
  it("rejects a task in the consequence or in what follows it", () => {
    expect(errs({ text: "Check health insurance requirements." })).toMatch(/possibilities\[0\] is a task or advice/);
    expect(errs({ downstream: "Consider moving to a cheaper district." })).toMatch(/\.downstream is a task or advice/);
  });
});

describe("drafts: distinct futures, no contradictions, no repeats", () => {
  it("rejects a future that decides the same thing two ways, naming every conflicting setting", () => {
    const p = draft("university-tailored");
    p.branches[0]!.settings = [{ variable: "assessmentMix", value: "projects only" }, { variable: "assessmentMix", value: "mixed" }];
    const e = errorsOf(p);
    expect(e).toContain('branches[0].settings[0]: "assessmentMix" is set more than once with different values');
    expect(e).toContain('branches[0].settings[1]: "assessmentMix" is set more than once with different values');
  });
  it("rejects futures that make exactly the same decisions", () => {
    const p = draft("university-tailored");
    p.branches[1]!.settings = [...p.branches[0]!.settings];
    expect(errorsOf(p)).toContain("branches[1] makes the same decisions as branches[0]; futures must differ in what is decided");
    // Several futures without settings are allowed (for example "keep things as they are").
    const q = draft("relocation-tailored");
    q.branches[1]!.settings = [];
    expect(errorsOf(q)).toEqual([]);
  });
  it("rejects the same consequence twice in one future", () => {
    const p = draft("relocation-tailored");
    p.possibilities.push({ ...p.possibilities[0]!, text: `${p.possibilities[0]!.text}.` });
    expect(errorsOf(p)).toContain(`possibilities[${p.possibilities.length - 1}] repeats possibilities[0]`);
  });
  it("a draft's research tasks and code names are rejected like a fresh look's", () => {
    const p = draft("relocation-tailored");
    p.possibilities[0]!.text = "Check health insurance requirements.";
    p.possibilities[1]!.text = "Income continues while keepRemoteJob is yes";
    const e = errorsOf(p);
    expect(e).toEqual(expect.arrayContaining([expect.stringMatching(/^possibilities\[0\] is a task or advice/), 'possibilities[1] uses the internal name "keepRemoteJob"; write it in plain words']));
  });
});

describe("stored and shown", () => {
  it("an approved fresh look keeps each consequence's cause; the view names unknown assumptions as unresolved", async () => {
    const p = draft("relocation-tailored");
    let r = await proposalToReality("What if I moved to Germany while keeping my current remote job?", p, selectAll(p), { model: "m", createdAt: "2026-11-08T10:00:00.000Z" }, counter());
    const b0 = r.branches.find((x) => x.name === "Remote relocation to Germany")!;
    // Draft suggestions keep the R15 shape: no explanation.
    for (const x of b0.possibilities) expect(consequenceView(r, b0, x)).toBeNull();
    r = await updateBranch(r, b0.id, { facts: [{ id: "f1", question: "", answer: "I expect the cost of living in Germany to be higher than in my current city." }] });
    const b = r.branches.find((x) => x.id === b0.id)!;
    const req = revisitRequest(r, b, revisitCause(r, b));
    const s = { summary: "Because you expect living costs in Germany to be higher, this path could leave less money each month.", reconsider: [], add: [{ ...ok, tone: "challenge" as const, about: ["livingCosts", "monthlyIncome"] }], questions: [], evidence: [] };
    const c = validateRevisit(s, req);
    if (!c.ok) throw new Error(c.errors.join("; "));
    const next = await applyRevisit(r, b.id, req, c.suggestion, selectAllRevisit(c.suggestion), { model: "m", at: "2026-11-08T11:00:00.000Z" }, counter());
    const after = next.branches.find((x) => x.id === b.id)!;
    const added = after.possibilities.at(-1)!;
    expect(added.cause).toEqual({ trigger: ok.trigger, mechanism: ok.mechanism, downstream: ok.downstream, uncertainty: ok.uncertainty });
    const view = consequenceView(next, after, added)!;
    expect([view.consequence, view.condition]).toEqual(["Monthly savings could shrink", "living costs turn out higher while your salary stays the same"]);
    expect(view.dependsOn.map((d) => [d.variable.label, d.value])).toEqual([["Living costs in Germany", null], ["Monthly income", null]]);
    // The user's own notes have no explanation and are shown as before.
    expect(consequenceView(next, after, { id: "own", text: "Closer to the Alps", likelihood: "not-judged", note: "" })).toBeNull();
    const [back] = await importRealities(exportRealities([next]));
    expect(back).toEqual(next);
  });

  it("a malformed explanation is refused", async () => {
    const p = draft("relocation-tailored");
    const r = await proposalToReality("What if?", p, selectAll(p), { model: "m", createdAt: "2026-11-08T10:00:00.000Z" }, counter());
    const b = r.branches[1]!;
    const bad = { ...b.possibilities[0]!, cause: { trigger: "x", mechanism: "", downstream: "", uncertainty: "y" } };
    await expect(updateBranch(r, b.id, { possibilities: [bad] })).rejects.toThrow(/malformed explanation/);
  });

  it("the condition reads after 'if' without changing the words", () => {
    expect(conditionalSentence("Monthly savings could shrink.", "If Your rent rises.")).toEqual({ consequence: "Monthly savings could shrink", condition: "your rent rises" });
    expect(conditionalSentence("Sales could fall", "Germany's rents rise faster than pay").condition).toBe("Germany's rents rise faster than pay");
    expect(conditionalSentence("Sales could fall", "when a competitor opens nearby").condition).toBe("a competitor opens nearby");
  });

  it("a fresh look's new consequences are checked the same way", async () => {
    const p = draft("relocation-tailored");
    let r = await proposalToReality("What if?", p, selectAll(p), { model: "m", createdAt: "2026-11-08T10:00:00.000Z" }, counter());
    const b0 = r.branches.find((x) => x.name === "Remote relocation to Germany")!;
    r = await updateBranch(r, b0.id, { facts: [{ id: "f1", question: "", answer: "I expect the cost of living in Germany to be higher than in my current city." }] });
    const b = r.branches.find((x) => x.id === b0.id)!;
    const req = revisitRequest(r, b, revisitCause(r, b));
    const reply = { summary: "Because you expect higher living costs, this path could leave less money each month.", reconsider: [], add: [{ ...ok, tone: "challenge", about: ["livingCosts"] }], questions: [], evidence: [] };
    expect(validateRevisit(reply, req).ok).toBe(true);
    const tasks = { ...reply, add: [{ ...ok, text: "Investigate housing costs.", tone: "challenge", about: [] }] };
    const c = validateRevisit(tasks, req);
    expect(c.ok ? [] : c.errors).toEqual([expect.stringMatching(/^add\[0\] is a task or advice/)]);
    const repeat = { ...reply, add: [{ ...ok, text: "Income continues from the first day", tone: "upside", about: [] }] };
    const d = validateRevisit(repeat, req);
    expect(d.ok ? [] : d.errors).toEqual(["add[0] repeats a current suggestion of this path"]);
  });
});

describe("compatibility with files saved before R16", () => {
  for (const name of ["realities-6e4b8f2.json", "realities-5b17057.json", "realities-4e4bdfe.json"]) {
    it(`${name}: every fingerprint matches, and older suggestions are shown without an explanation`, async () => {
      const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
      const realities = await importRealities(text);
      expect(realities.flatMap((r) => r.branches.map((b) => b.fingerprint))).toEqual(JSON.parse(text).realities.flatMap((r: { branches: { fingerprint: string }[] }) => r.branches.map((b) => b.fingerprint)));
      expect(JSON.parse(exportRealities(realities))).toEqual(JSON.parse(text));
      for (const r of realities) for (const b of r.branches) {
        for (const p of b.possibilities) expect(consequenceView(r, b, p)).toBeNull();
        expect(() => branchStory(r, b)).not.toThrow();
      }
    });
  }
  it("an R15 map keeps its context, facts, value sources and approved look", async () => {
    const [r] = await importRealities(readFileSync(fileURLToPath(new URL("./fixtures/realities-4e4bdfe.json", import.meta.url)), "utf8"));
    const b = r!.branches.find((x) => x.name === "Remote relocation to Germany")!;
    expect(knownView(r!, b).context.map((f) => f.answer)).toEqual(["Germany", "existing remote job"]);
    expect(knownView(r!, b).facts.map((f) => f.answer)).toEqual(["My employer allows me to work remotely"]);
    expect(b.sources).toEqual({ keepRemoteJob: "ai", employerAllowsAbroad: "user" });
    expect(b.revisits).toHaveLength(1);
    expect(branchStory(r!, b).setAside.map((p) => p.text)).toEqual(["Your employer may not agree to you working from another country"]);
    expect(staleSuggestions(r!, b)).toEqual([]);
  });
});
