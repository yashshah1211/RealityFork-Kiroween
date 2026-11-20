import { describe, expect, it } from "vitest";
import fc from "fast-check";
import "../src/index";
import {
  computeResultHash,
  createBaseline,
  editDraft,
  fork,
  reproduce,
  runScenario,
  verifyIntegrity,
} from "../src/scenario/scenario";
import { exportBundle, importBundle } from "../src/scenario/bundle";
import { ScenarioStore } from "../src/scenario/store";
import { ScenarioError, type Scenario } from "../src/scenario/types";
import { canonicalStringify, decodeJson, encodeJson } from "../src/serialize/canonical";
import { ENGINE_VERSION } from "../src/version";

const small = { warmup: 20, horizon: 220 };
let counter = 0;
const ids = () => `t${++counter}`;
const base = (over: Partial<Parameters<typeof createBaseline>[0]> = {}) =>
  createBaseline({ name: "Baseline", modelId: "queue.mmc", modelVersion: "1.1.0", settings: small, masterSeed: 7, replications: 4, ...over }, ids);
/** Plain, mutable deep copy (for crafting tampered inputs). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mutable = (s: Scenario): any => decodeJson(JSON.parse(JSON.stringify(encodeJson(s))));

describe("scenarios: creation, identity and immutability (R4)", () => {
  it("creates a frozen draft with a SHA-256 fingerprint", async () => {
    const b = await base();
    expect(b.status).toBe("draft");
    expect(b.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(b) && Object.isFrozen(b.spec) && Object.isFrozen(b.spec.params)).toBe(true);
    expect(() => {
      (b.spec.params as Record<string, number>).servers = 9;
    }).toThrow(TypeError);
  });

  it("id and fingerprint are distinct: same content gives same fingerprint, different ids", async () => {
    const a = await base({ name: "A" });
    const b = await base({ name: "B" });
    expect(a.id).not.toBe(b.id);
    expect(a.fingerprint).toBe(b.fingerprint);
    const c = await base({ params: { servers: 3 } });
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("fork records lineage and the assumption diff, and leaves the parent untouched", async () => {
    const b = await base();
    const before = canonicalStringify(b);
    const f = await fork(b, { name: "More staff", params: { servers: 3 } }, ids);
    expect(f.parentId).toBe(b.id);
    expect(f.parentFingerprint).toBe(b.fingerprint);
    expect(f.changesFromParent).toEqual([{ path: "params.servers", label: "Staff on duty", unit: "people", from: 2, to: 3 }]);
    expect(f.spec.masterSeed).toBe(b.spec.masterSeed);
    expect(canonicalStringify(b)).toBe(before);
  });

  it("editing a draft keeps its id, updates the fingerprint and keeps the diff relative to the parent", async () => {
    const b = await base();
    const f = await fork(b, { name: "Busy", params: { servers: 3 } }, ids);
    const f2 = await editDraft(f, { params: { arrivalRatePerHour: 1.8 } });
    expect(f2.id).toBe(f.id);
    expect(f2.fingerprint).not.toBe(f.fingerprint);
    expect(f2.changesFromParent.map((c) => c.path)).toEqual(["params.arrivalRatePerHour", "params.servers"]);
    const f3 = await editDraft(f2, { params: { servers: 2 } });
    expect(f3.changesFromParent.map((c) => c.path)).toEqual(["params.arrivalRatePerHour"]);
    expect(f.spec.params.servers).toBe(3); // earlier object unchanged
  });

  it("completed scenarios are locked: no re-run, no edit; forking still works", async () => {
    const done = await runScenario(await base());
    expect(done.status).toBe("completed");
    await expect(runScenario(done)).rejects.toThrow(ScenarioError);
    await expect(editDraft(done, { params: { servers: 3 } })).rejects.toThrow(/locked/);
    const child = await fork(done, { name: "child", params: { servers: 3 } }, ids);
    expect(child.parentFingerprint).toBe(done.fingerprint);
  });

  it("run keeps the fingerprint; the result hash is separate and records versions", async () => {
    const d = await base();
    const r = await runScenario(d);
    expect(r.fingerprint).toBe(d.fingerprint);
    expect(r.result!.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.result!.resultHash).not.toBe(r.fingerprint);
    expect(r.result!.engineVersion).toBe(ENGINE_VERSION);
    expect(r.result!.perReplication).toHaveLength(4);
  });

  it("rejects invalid assumptions", async () => {
    await expect(base({ params: { servers: 0 } })).rejects.toThrow(RangeError);
    await expect(base({ replications: 1 })).rejects.toThrow(ScenarioError);
    const b = await base();
    await expect(fork(b, { name: "x", params: { nonsense: 1 } }, ids)).rejects.toThrow(/unknown parameter/);
  });

  it("preserves optional dataset provenance in the fingerprint", async () => {
    const a = await base({ dataProvenance: { source: "clinic-SYNTHETIC.csv", sha256: "ab".repeat(32), rows: 120, synthetic: true } });
    const b = await base();
    expect(a.spec.dataProvenance?.synthetic).toBe(true);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("scenarios: property-based branch independence and lineage", () => {
  type Op = { kind: "fork" | "edit"; target: number; servers: number; lambda: number };
  const opArb: fc.Arbitrary<Op> = fc.record({
    kind: fc.constantFrom("fork" as const, "edit" as const),
    target: fc.nat({ max: 50 }),
    servers: fc.integer({ min: 1, max: 4 }),
    lambda: fc.double({ min: 0.1, max: 3, noNaN: true }),
  });

  it("random fork/edit sequences never change any other scenario; lineage stays consistent", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), async (ops) => {
        const b = await base();
        const versions: Scenario[] = [b]; // every object ever created
        const snapshots = new Map<Scenario, string>([[b, canonicalStringify(b)]]);
        const latest = new Map<string, Scenario>([[b.id, b]]);
        const forkedFrom = new Map<string, string>(); // child id -> parent fingerprint at fork time
        for (const op of ops) {
          const all = [...latest.values()];
          const t = all[op.target % all.length]!;
          const next =
            op.kind === "fork"
              ? await fork(t, { name: "f", params: { servers: op.servers, arrivalRatePerHour: op.lambda } }, ids)
              : await editDraft(t, { params: { servers: op.servers } });
          if (op.kind === "fork") forkedFrom.set(next.id, t.fingerprint);
          versions.push(next);
          snapshots.set(next, canonicalStringify(next));
          latest.set(next.id, next);
        }
        for (const v of versions) if (canonicalStringify(v) !== snapshots.get(v)) return false;
        for (const s of latest.values()) {
          if (s.parentId === null) continue;
          if (!latest.has(s.parentId)) return false;
          if (s.parentFingerprint !== forkedFrom.get(s.id)) return false;
        }
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it("property: export/import round-trips scenarios with identical fingerprints and valid integrity", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        fc.nat({ max: 0xffffffff }),
        async (servers, lambda, seed) => {
          const b = await base({ params: { servers, arrivalRatePerHour: lambda }, masterSeed: seed, replications: 2, settings: { warmup: 5, horizon: 40 } });
          const done = await runScenario(b);
          const { scenarios } = await importBundle(exportBundle([b, done].slice(1)));
          const back = scenarios[0]!;
          const integrity = await verifyIntegrity(back);
          return back.fingerprint === done.fingerprint && back.result!.resultHash === done.result!.resultHash && integrity.fingerprintValid && integrity.resultHashValid === true;
        },
      ),
      { numRuns: 25 },
    );
  });

  it("property: hashes are stable across repeated computation and runs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 0xffffffff }), async (seed) => {
        const a = await runScenario(await base({ masterSeed: seed, replications: 2, settings: { warmup: 5, horizon: 40 } }));
        const b = await runScenario(await base({ masterSeed: seed, replications: 2, settings: { warmup: 5, horizon: 40 } }));
        return a.fingerprint === b.fingerprint && a.result!.resultHash === b.result!.resultHash;
      }),
      { numRuns: 25 },
    );
  });
});

describe("scenarios: export, import and reproduction", () => {
  it("round-trips a bundle exactly, including NaN 'no observations' values", async () => {
    const b = await runScenario(await base());
    const empty = await runScenario(await fork(b, { name: "No customers", params: { arrivalRatePerHour: 1e-6 } }, ids).then((f) => f));
    expect(Number.isNaN(empty.result!.perReplication[0]!.meanWait)).toBe(true);
    expect(empty.result!.summary.meanWait!.nonFinite).toBe(4);
    const text = exportBundle([b, empty]);
    expect(text).toContain('"$nonFinite": "NaN"');
    const { scenarios, warnings } = await importBundle(text);
    expect(warnings).toEqual([]);
    expect(scenarios).toEqual([b, empty]);
    expect(Number.isNaN(scenarios[1]!.result!.perReplication[0]!.meanWait)).toBe(true);
  });

  it("reproduce reports identical for an unmodified completed scenario", async () => {
    const r = await runScenario(await base());
    const rep = await reproduce(r);
    expect(rep.status).toBe("identical");
    expect(rep.numericallyIdentical).toBe(true);
    expect(rep.reproducedResultHash).toBe(r.result!.resultHash);
    const imported = (await importBundle(exportBundle([r]))).scenarios[0]!;
    expect((await reproduce(imported)).status).toBe("identical");
  });

  it("reproduce of a draft is 'not-run'", async () => {
    expect((await reproduce(await base())).status).toBe("not-run");
  });

  it("NEGATIVE: an edited assumption in an export is rejected", async () => {
    const r = await runScenario(await base());
    const tampered = exportBundle([r]).replace('"servers": 2', '"servers": 3');
    await expect(importBundle(tampered)).rejects.toThrow(/fingerprint does not match/);
  });

  it("NEGATIVE: an edited result value in an export is rejected", async () => {
    const r = await runScenario(await base());
    const m = mutable(r);
    m.result.perReplication[0].meanWait += 0.001;
    await expect(importBundle(JSON.stringify(encodeJson({ schema: "realityfork.bundle/1", scenarios: [m] })))).rejects.toThrow(/result hash does not match/);
  });

  it("NEGATIVE: unknown model versions, bad schemas, drafts with results and duplicate ids are rejected", async () => {
    const r = await runScenario(await base());
    const wrap = (s: unknown) => JSON.stringify(encodeJson({ schema: "realityfork.bundle/1", scenarios: [s] }));
    const v = mutable(r);
    v.spec.modelVersion = "9.9.9";
    await expect(importBundle(wrap(v))).rejects.toThrow(/not registered/);
    const s = mutable(r);
    s.schema = "realityfork.scenario/0";
    await expect(importBundle(wrap(s))).rejects.toThrow(/unsupported schema/);
    const d = mutable(r);
    d.status = "draft";
    await expect(importBundle(wrap(d))).rejects.toThrow(/draft must not carry results/);
    await expect(importBundle(JSON.stringify(encodeJson({ schema: "realityfork.bundle/1", scenarios: [mutable(r), mutable(r)] })))).rejects.toThrow(/duplicate id/);
    await expect(importBundle("not json")).rejects.toThrow(/not valid bundle JSON/);
    await expect(importBundle(JSON.stringify({ schema: "other", scenarios: [] }))).rejects.toThrow(/unsupported bundle schema/);
    const x = mutable(r);
    x.extra = 1;
    await expect(importBundle(wrap(x))).rejects.toThrow(/unexpected field/);
  });

  it("NEGATIVE: a child whose locked parent differs from the fork-time fingerprint is rejected", async () => {
    const p = await runScenario(await base());
    const c = mutable(await fork(p, { name: "c", params: { servers: 3 } }, ids));
    c.parentFingerprint = "0".repeat(64);
    await expect(importBundle(JSON.stringify(encodeJson({ schema: "realityfork.bundle/1", scenarios: [mutable(p), c] })))).rejects.toThrow(/locked but its fingerprint differs/);
  });

  it("NEGATIVE: an engine-version mismatch is never reported as an identical replay", async () => {
    const r = await runScenario(await base());
    const m = mutable(r);
    m.result.engineVersion = "0.0.9";
    m.result.resultHash = await computeResultHash(m.fingerprint, m.result);
    const { scenarios, warnings } = await importBundle(JSON.stringify(encodeJson({ schema: "realityfork.bundle/1", scenarios: [m] })));
    expect(warnings.join()).toMatch(/engine 0\.0\.9/);
    const rep = await reproduce(scenarios[0]!);
    expect(rep.status).toBe("version-mismatch");
    expect(rep.checks.versionsMatch).toBe(false);
    expect(rep.numericallyIdentical).toBe(true); // numbers happen to match, still not "identical"
    expect(rep.notes.join()).toMatch(/verified replay is not possible/);
  });

  it("NEGATIVE: re-hashed but altered results reproduce as 'different' with the exact field", async () => {
    const r = await runScenario(await base());
    const m = mutable(r);
    m.result.perReplication[2].utilization = 0.5;
    m.result.resultHash = await computeResultHash(m.fingerprint, m.result);
    const rep = await reproduce(m as Scenario);
    expect(rep.status).toBe("different");
    expect(rep.differences.map((d) => d.path)).toContain("perReplication[2].utilization");
  });

  it("NEGATIVE: altered results without re-hashing reproduce as 'invalid'", async () => {
    const r = await runScenario(await base());
    const m = mutable(r);
    m.result.perReplication[0].meanWait = 0;
    expect((await reproduce(m as Scenario)).status).toBe("invalid");
  });
});

describe("scenario store", () => {
  it("tracks lineage and children; refuses to replace a locked scenario", async () => {
    const b = await runScenario(await base());
    const a = await fork(b, { name: "a", params: { servers: 3 } }, ids);
    const a2 = await fork(a, { name: "a2", params: { arrivalRatePerHour: 1.8 } }, ids);
    const store = new ScenarioStore([b, a, a2]);
    expect(store.lineage(a2.id).map((s) => s.id)).toEqual([b.id, a.id, a2.id]);
    expect(store.children(b.id).map((s) => s.id)).toEqual([a.id]);
    const other = await runScenario(await base({ id: b.id, params: { servers: 4 } }));
    expect(() => store.put(other)).toThrow(/locked/);
    store.put(await runScenario(a)); // draft → completed is allowed
    expect(store.get(a.id).status).toBe("completed");
  });
});
