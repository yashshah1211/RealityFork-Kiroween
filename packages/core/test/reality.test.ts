import { describe, expect, it } from "vitest";
import "../src/index";
import { evaluateNode, parseExpression, referencedNames } from "../src/reality/expr";
import {
  addFormula,
  addVariable,
  changesFromParent,
  compareBranches,
  createReality,
  evaluateBranch,
  evaluateFormula,
  exportRealities,
  forkBranch,
  importRealities,
  keyFromLabel,
  removeBranch,
  removeVariable,
  simulationInput,
  updateBranch,
} from "../src/reality/reality";
import { buildFromTemplate, CAFE_QUEUE, MOVE_CITY, SOLAR } from "../src/reality/examples";
import { createBaseline, runScenario } from "../src/scenario/scenario";

let n = 0;
const ids = () => `id${++n}`;
const ev = (src: string, vars: Record<string, number | boolean | string> = {}) => evaluateNode(parseExpression(src), (k) => {
  if (!(k in vars)) throw new Error(`no ${k}`);
  return vars[k]!;
});

describe("expression language (no eval)", () => {
  it("arithmetic, precedence, functions and conditions", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("-2 ^ 2")).toBe(-4);
    expect(ev("2 ^ 3 ^ 2")).toBe(512);
    expect(ev("min(3, 1, 2) + max(4, 5) + abs(-1)")).toBe(7);
    expect(ev("round(2.345, 2)")).toBe(2.35);
    expect(ev("if(x > 2, 10, 20)", { x: 3 })).toBe(10);
    expect(ev('city == "London" and not remote', { city: "London", remote: false })).toBe(true);
    expect(ev("1.5e3")).toBe(1500);
  });

  it("rejects unsafe or malformed input with clear messages", () => {
    // Only the fixed grammar is accepted; anything else is a parse error, never executed.
    for (const bad of ["", "1 +", "alert(1)", "x.constructor", "x[0]", "1;2", "`x`", "a = 1", "(1", "x y"]) {
      expect(() => ev(bad, { x: 1, y: 1 })).toThrow();
    }
    expect(() => ev("1 / 0")).toThrow(/division by zero/);
    expect(() => ev("x + 1", { x: true })).toThrow(/must be a number/);
    expect(() => ev('x == "a"', { x: 1 })).toThrow(/cannot compare/);
    expect(() => parseExpression("1+".repeat(300) + "1")).toThrow(/longer than/);
    expect(() => parseExpression("(".repeat(60) + "1" + ")".repeat(60))).toThrow(/nested too deeply/);
    expect(referencedNames(parseExpression("a + b * if(c, a, true)"))).toEqual(["a", "b", "c"]);
  });
});

describe("a brand-new situation built from generic primitives", () => {
  const build = async () => {
    let r = await createReality({ question: "What if our family adopted a dog?" }, ids);
    r = await addVariable(r, { label: "Monthly food cost", kind: "number", unit: "£ per month", source: "pet shop prices" }, 40);
    r = await addVariable(r, { label: "Dog size", kind: "category", options: ["small", "large"] }, "small");
    r = await addVariable(r, { label: "Insurance", kind: "boolean" }, true);
    r = await addVariable(r, { label: "Vet bills", kind: "number", unit: "£ per year", uncertainty: "no idea yet" }, null);
    r = await addFormula(r, { label: "Yearly food", expression: "monthlyFoodCost * 12", unit: "£" });
    r = await addFormula(r, { label: "Yearly total", expression: "yearlyFood + vetBills + if(insurance, 300, 0)", unit: "£" });
    return r;
  };

  it("keys come from labels and are unique", () => {
    expect(keyFromLabel("Monthly food cost (£)", [])).toBe("monthlyFoodCost");
    expect(keyFromLabel("Monthly food cost", ["monthlyFoodCost"])).toBe("monthlyFoodCost2");
    expect(keyFromLabel("if", [])).toBe("ifValue");
    expect(keyFromLabel("2 cars", [])).toBe("v2Cars");
  });

  it("missing assumptions are named instead of inventing a number", async () => {
    const r = await build();
    const out = evaluateBranch(r, r.branches[0]!);
    expect(out.calculated[0]!.result).toEqual({ status: "ok", value: 480 });
    expect(out.calculated[1]!.result).toEqual({ status: "missing", missing: ["Vet bills"] });
    expect(out.missingAssumptions).toEqual(["Vet bills"]);
  });

  it("two forks change independently; the parent stays as it was; lineage and fingerprints are kept", async () => {
    let r = await build();
    const root = r.branches[0]!;
    const a = await forkBranch(r, root.id, { name: "Small dog" }, ids);
    const b = await forkBranch(a.reality, root.id, { name: "Large dog" }, ids);
    r = b.reality;
    r = await updateBranch(r, b.branch.id, { values: { dogSize: "large", monthlyFoodCost: 90, vetBills: 600 } });
    r = await updateBranch(r, a.branch.id, { values: { vetBills: 250 }, possibilities: [{ id: "p1", text: "More walks outside", likelihood: "likely", note: "" }] });
    const small = r.branches.find((x) => x.id === a.branch.id)!;
    const large = r.branches.find((x) => x.id === b.branch.id)!;
    expect(r.branches[0]!.values).toEqual(root.values);
    expect(small.parentId).toBe(root.id);
    expect(small.parentFingerprint).toBe(root.fingerprint);
    expect(new Set(r.branches.map((x) => x.fingerprint)).size).toBe(3);
    expect(changesFromParent(r, large).changes.map((c) => c.key)).toEqual(["monthlyFoodCost", "dogSize", "vetBills"]);
    const c = compareBranches(r, small.id, large.id);
    expect(c.calculated.map((x) => x.difference)).toEqual([600, 950]);
    expect(c.assumptions.filter((x) => x.changed).map((x) => x.variable.key)).toEqual(["monthlyFoodCost", "dogSize", "vetBills"]);
    expect(c.possibilities.onlyA.map((p) => p.text)).toEqual(["More walks outside"]);
    // Editing the parent later shows up as "parent changed since fork"; the child's values are not touched.
    r = await updateBranch(r, root.id, { values: { monthlyFoodCost: 45 } });
    const small2 = r.branches.find((x) => x.id === a.branch.id)!;
    expect(small2.values.monthlyFoodCost).toBe(40);
    expect(changesFromParent(r, small2).parentChangedSinceFork).toBe(true);
  });

  it("validates values, formulas and removal", async () => {
    const r = await build();
    await expect(updateBranch(r, r.branches[0]!.id, { values: { dogSize: "medium" } })).rejects.toThrow(/one of/);
    await expect(updateBranch(r, r.branches[0]!.id, { values: { monthlyFoodCost: "lots" as unknown as number } })).rejects.toThrow(/must be a number/);
    await expect(addFormula(r, { label: "Bad", expression: "unknownThing * 2" })).rejects.toThrow(/unknown name/);
    await expect(removeVariable(r, "vetBills")).rejects.toThrow(/still used by: Yearly total/);
    await expect(removeBranch(r, r.branches[0]!.id)).rejects.toThrow(/cannot be removed/);
    const f = await forkBranch(r, r.branches[0]!.id, { name: "x" }, ids);
    const g = await forkBranch(f.reality, f.branch.id, { name: "y" }, ids);
    expect((await removeBranch(g.reality, f.branch.id)).branches).toHaveLength(1);
  });

  it("export → import round trip; tampering is rejected", async () => {
    const start = await build();
    const r = (await forkBranch(start, start.branches[0]!.id, { name: "Alt" }, ids)).reality;
    const text = exportRealities([r]);
    const [back] = await importRealities(text);
    expect(back).toEqual(r);
    await expect(importRealities(text.replace('"monthlyFoodCost": 40', '"monthlyFoodCost": 41'))).rejects.toThrow(/fingerprint does not match/);
    await expect(importRealities("{}")).rejects.toThrow(/not a RealityFork/);
  });
});

describe("cross-domain examples use the same primitives", () => {
  it("moving city: savings, conditional share, yes/no commute, unknown moving cost", async () => {
    const r = await buildFromTemplate(MOVE_CITY, ids);
    const [stay, move, remote] = r.branches;
    const val = (b: typeof stay, k: string) => evaluateFormula(r, b!, k);
    expect(val(stay, "monthlySavings")).toEqual({ status: "ok", value: 650 });
    expect(val(move, "monthlySavings")).toEqual({ status: "ok", value: 700 });
    expect(val(move, "yearlySavings")).toEqual({ status: "missing", missing: ["One-off moving and visa costs"] });
    expect(val(remote, "commuteHours")).toEqual({ status: "ok", value: 0 });
    expect(val(move, "commuteHours")).toEqual({ status: "ok", value: 40 * 2 * 5 / 60 });
    expect(remote!.parentId).toBe(move!.id);
    expect(move!.possibilities.map((p) => p.text)).toContain("Faster career growth");
  });

  it("solar: payback only when savings are positive", async () => {
    const r = await buildFromTemplate(SOLAR, ids);
    const byName = (n: string) => r.branches.find((b) => b.name === n)!;
    const base = evaluateFormula(r, byName("4 kW system, today's prices"), "annualSavings");
    expect(base.status).toBe("ok");
    expect((base as { value: number }).value).toBeCloseTo(3600 * 0.5 * 0.28 + 3600 * 0.5 * 0.12, 9);
    expect(evaluateFormula(r, byName("4 kW system, today's prices"), "paybackYears")).toEqual({ status: "ok", value: 8.3 });
    expect(evaluateFormula(r, byName("Shaded roof, no export payments"), "paybackYears").status).toBe("not-applicable");
    const c = compareBranches(r, r.branches[0]!.id, byName("Electricity prices rise 30%").id);
    expect(c.calculated.find((x) => x.formula.key === "paybackYears")!.difference!).toBeLessThan(0);
  });

  it("café: the simulation adapter maps assumptions to the validated queue model and runs reproducibly", async () => {
    const r = await buildFromTemplate(CAFE_QUEUE, ids);
    const one = simulationInput(r, r.branches[0]!, "queueWait");
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.input.params).toEqual({ servers: 1, arrivalRatePerHour: 24, serviceRatePerHour: 30, serverCostPerHour: 12, waitingCostPerHour: 0 });
    const ran = await runScenario(await createBaseline({ ...one.input, settings: { warmup: 10, horizon: 110 }, replications: 5 }));
    expect(ran.result!.summary.meanWait!.mean).toBeGreaterThan(0);
    const r2 = await updateBranch(r, r.branches[0]!.id, { values: { baristas: null } });
    const m = simulationInput(r2, r2.branches[0]!, "queueWait");
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.missing).toEqual(["Baristas on duty"]);
    const r3 = await updateBranch(r, r.branches[0]!.id, { values: { baristas: 1.5 } });
    const bad = simulationInput(r3, r3.branches[0]!, "queueWait");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems[0]).toMatch(/whole number/);
  });
});
