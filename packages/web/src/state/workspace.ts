/**
 * Workspace state for the UI, independent of React. All scenario logic lives in the core
 * package; this layer only orchestrates it and persists a validated bundle.
 */
import {
  blockRatesProvenance,
  createBaseline,
  DAYPART_BLOCKS,
  editDraft,
  estimateBlockRates,
  estimateQueueInputs,
  standardAlternatives,
  type CompareOptions,
  exportBundle,
  fork,
  forkFromEstimate,
  getModel,
  importBundle,
  type ModelDefinition,
  type QueueImportOptions,
  type QueueImportReport,
  type ReproductionReport,
  type Scenario,
  type ScenarioComparison,
} from "@realityfork/core";
import type { Engine } from "../engine";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = "realityfork.workspace.v1";

/**
 * Example front desk: about 16 arrivals per hour, 10 services per staff member per hour
 * (6-minute average service), 2 staff, so staff are busy 80% of the time. Hypothetical values,
 * not measurements. Warm-up 100 h, then 1000 h measured (about 16,000 customers per repeat).
 */
export const EXAMPLE = {
  name: "Front desk (today)",
  modelId: "queue.mmc",
  modelVersion: "1.1.0",
  params: { servers: 2, arrivalRatePerHour: 16, serviceRatePerHour: 10, serverCostPerHour: 30, waitingCostPerHour: 20 },
  settings: { warmup: 100, horizon: 1100 },
  masterSeed: 1,
  replications: 30,
} as const;

/**
 * Scheduling example: a service center open 08:00–20:00 in six 2-hour blocks. Demand per block is
 * estimated in the browser from the SYNTHETIC daily log; staffing, service speed and costs are entered
 * by hand (hypothetical). 30 matched repeats of 20 simulated days.
 */
export const SCHEDULE_EXAMPLE = {
  modelId: "queue.daypart",
  modelVersion: "0.2.0",
  staffPerBlock: 2,
  manual: { serviceRatePerHour: 10, staffCostPerHour: 30, waitingCostPerHour: 20 },
  settings: { warmup: 0, horizon: 24 * 20 },
  masterSeed: 2026,
  replications: 30,
  names: { baseline: "A. Today's staffing", allDay: "B. One more person all day", peak: "C. One more person at the peak" },
} as const;

export interface ScheduleSource {
  readonly csv: string;
  readonly fileName: string;
  readonly synthetic: boolean;
  readonly observationWindow: { readonly start: string; readonly end: string };
  readonly localUtcOffsetMinutes: number;
}

export interface WorkspaceState {
  readonly scenarios: readonly Scenario[];
  readonly selectedId: string | null;
  /** Reference scenario for comparison; null = the selected scenario's parent. */
  readonly referenceId: string | null;
  readonly busy: { readonly kind: "run" | "compare" | "reproduce"; readonly scenarioId: string; readonly startedAt: number } | null;
  readonly error: string | null;
  readonly notice: string | null;
  readonly comparisons: Readonly<Record<string, ScenarioComparison>>;
  readonly reproductions: Readonly<Record<string, ReproductionReport>>;
  readonly loadError: string | null;
}

const empty: WorkspaceState = {
  scenarios: [], selectedId: null, referenceId: null, busy: null, error: null, notice: null, comparisons: {}, reproductions: {}, loadError: null,
};

export const comparisonKey = (a: Scenario, b: Scenario, quick = false) => `${a.id}:${a.result?.resultHash}|${b.id}:${b.result?.resultHash}${quick ? "|quick" : ""}`;

export type ParamCheck = { ok: true; value: number } | { ok: false; message: string };

/** Validate a raw text input against the model's parameter schema. */
export function checkParam(model: ModelDefinition, key: string, raw: string): ParamCheck {
  const spec = model.parameters[key];
  if (!spec) return { ok: false, message: "Unknown setting" };
  const t = raw.trim();
  if (t === "") return { ok: false, message: "Enter a number" };
  const v = Number(t);
  if (!Number.isFinite(v)) return { ok: false, message: "Enter a number (use a dot for decimals)" };
  if (spec.integer && !Number.isInteger(v)) return { ok: false, message: "Must be a whole number" };
  const min = spec.min < 1e-6 ? 0 : spec.min;
  if (v < spec.min || (spec.min < 1e-6 && spec.min > 0 && v <= 0)) return { ok: false, message: `Must be ${spec.min < 1e-6 ? "greater than 0" : `at least ${min}`}` };
  if (v > spec.max) return { ok: false, message: `Must be at most ${spec.max}` };
  return { ok: true, value: v };
}

export class Workspace {
  private state: WorkspaceState = empty;
  private listeners = new Set<() => void>();

  constructor(private readonly engine: Engine, private readonly storage: StorageLike | null = null) {}

  getState = (): WorkspaceState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<WorkspaceState>, persist = false) {
    this.state = { ...this.state, ...patch };
    if (persist) this.persist();
    for (const l of this.listeners) l();
  }

  private persist() {
    if (!this.storage) return;
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ selectedId: this.state.selectedId, bundle: exportBundle(this.state.scenarios) }));
  }

  get(id: string): Scenario {
    const s = this.state.scenarios.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario "${id}"`);
    return s;
  }

  selected(): Scenario | null {
    return this.state.selectedId ? (this.state.scenarios.find((s) => s.id === this.state.selectedId) ?? null) : null;
  }

  model(s: Scenario): ModelDefinition {
    return getModel(s.spec.modelId, s.spec.modelVersion) as ModelDefinition;
  }

  /** Restore from storage. Invalid saved data is reported, never silently discarded. */
  async restore(): Promise<void> {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { selectedId: string | null; bundle: string };
      const { scenarios } = await importBundle(saved.bundle);
      const selectedId = scenarios.some((s) => s.id === saved.selectedId) ? saved.selectedId : (scenarios[0]?.id ?? null);
      this.set({ scenarios, selectedId });
    } catch (e) {
      this.set({ loadError: `Your saved workspace could not be validated and was not loaded. ${(e as Error).message}` });
    }
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      this.set({ error: null });
      return await fn();
    } catch (e) {
      this.set({ error: (e as Error).message, busy: null });
      return undefined;
    }
  }

  private replace(s: Scenario, extra: Partial<WorkspaceState> = {}) {
    const exists = this.state.scenarios.some((x) => x.id === s.id);
    const scenarios = exists ? this.state.scenarios.map((x) => (x.id === s.id ? s : x)) : [...this.state.scenarios, s];
    this.set({ scenarios, ...extra }, true);
  }

  loadExample = () =>
    this.guard(async () => {
      const s = await createBaseline({ ...EXAMPLE, params: { ...EXAMPLE.params }, settings: { ...EXAMPLE.settings } });
      this.replace(s, { selectedId: s.id, referenceId: null, notice: null });
      return s;
    });

  /**
   * Load the scheduling example: estimate demand per block from the log, create today's schedule,
   * and fork the two standard alternatives (all day, busiest block only). All three are drafts.
   */
  loadScheduleExample = (source: ScheduleSource) =>
    this.guard(async () => {
      const blocks = DAYPART_BLOCKS.map((b, i) => ({ label: b.label, startHour: 8 + 2 * i, endHour: 10 + 2 * i }));
      const report = await estimateBlockRates(source.csv, {
        fileName: source.fileName, synthetic: source.synthetic, arrivalColumn: "arrival_time",
        observationWindow: source.observationWindow, timezone: { assumeOffsetMinutes: null },
        localUtcOffsetMinutes: source.localUtcOffsetMinutes, blocks,
      });
      if (!report.ok) throw new Error(`The example log could not be read: ${report.issues.map((i) => i.message).join("; ")}`);
      const E = SCHEDULE_EXAMPLE;
      const params: Record<string, number> = { ...E.manual };
      report.blocks.forEach((b, i) => {
        params[`rate${i + 1}`] = b.ratePerHour;
        params[`staff${i + 1}`] = E.staffPerBlock;
      });
      const base = await createBaseline({
        name: E.names.baseline, modelId: E.modelId, modelVersion: E.modelVersion, params,
        settings: { ...E.settings }, masterSeed: E.masterSeed, replications: E.replications,
        dataProvenance: blockRatesProvenance(report, source),
      });
      const alt = standardAlternatives(base.spec.params);
      const allDay = await fork(base, { name: E.names.allDay, params: alt.allDay });
      const peak = await fork(base, { name: `${E.names.peak} (${alt.peakLabel})`, params: alt.peakOnly });
      const scenarios = [...this.state.scenarios, base, allDay, peak];
      this.set({ scenarios, selectedId: base.id, referenceId: null, notice: null }, true);
      return { base, allDay, peak };
    });

  /** Run several drafts one after another (each through the engine, so each is reproducible). */
  runMany = (ids: readonly string[]) =>
    this.guard(async () => {
      for (const id of ids) {
        if (this.get(id).status !== "draft") continue;
        this.set({ busy: { kind: "run", scenarioId: id, startedAt: Date.now() } });
        const done = await this.engine.run(this.get(id));
        this.replace(done, { busy: null });
      }
      return ids.map((id) => this.get(id));
    });

  /** The scenario's tree: its root and every descendant, in creation order. */
  family(id: string): Scenario[] {
    const root = this.lineage(id)[0];
    if (!root) return [];
    const out: Scenario[] = [];
    const visit = (s: Scenario) => {
      out.push(s);
      for (const c of this.children(s.id)) visit(c);
    };
    visit(root);
    return out;
  }

  select = (id: string) => this.set({ selectedId: id, referenceId: null, error: null, notice: null }, true);

  setReference = (id: string | null) => this.set({ referenceId: id });

  fork = (parentId: string, name: string) =>
    this.guard(async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Give the alternative a name");
      const child = await fork(this.get(parentId), { name: trimmed });
      this.replace(child, { selectedId: child.id, referenceId: null, notice: null });
      return child;
    });

  /** Edit one parameter of a draft. Completed scenarios are locked by the core. */
  editParam = (id: string, key: string, value: number) =>
    this.guard(async () => {
      const s = await editDraft(this.get(id), { params: { [key]: value } });
      this.replace(s);
      return s;
    });

  run = (id: string) =>
    this.guard(async () => {
      this.set({ busy: { kind: "run", scenarioId: id, startedAt: Date.now() } });
      const done = await this.engine.run(this.get(id));
      this.replace(done, { busy: null });
      return done;
    });

  /**
   * Compare the reference (default: parent) against the scenario; cached by result hashes.
   * quick = without the one-change-at-a-time sensitivity runs (used by the futures comparison).
   */
  compare = (variantId: string, referenceId: string, quick = false) =>
    this.guard(async () => {
      const a = this.get(referenceId);
      const b = this.get(variantId);
      const key = comparisonKey(a, b, quick);
      const cached = this.state.comparisons[key];
      if (cached) return cached;
      this.set({ busy: { kind: "compare", scenarioId: variantId, startedAt: Date.now() } });
      const options: CompareOptions = quick ? { sensitivity: false } : {};
      const c = await this.engine.compare(a, b, options);
      this.set({ comparisons: { ...this.state.comparisons, [key]: c }, busy: null });
      return c;
    });

  reproduce = (id: string) =>
    this.guard(async () => {
      this.set({ busy: { kind: "reproduce", scenarioId: id, startedAt: Date.now() } });
      const r = await this.engine.reproduce(this.get(id));
      this.set({ reproductions: { ...this.state.reproductions, [id]: r }, busy: null });
      return r;
    });

  exportText = (): string => exportBundle(this.state.scenarios);

  importText = (text: string) =>
    this.guard(async () => {
      const { scenarios, warnings } = await importBundle(text);
      if (scenarios.length === 0) throw new Error("The file contains no scenarios");
      this.set(
        { scenarios, selectedId: scenarios[0]!.id, referenceId: null, comparisons: {}, reproductions: {}, loadError: null, notice: warnings.length ? `Imported with warnings: ${warnings.join(" ")}` : `Imported ${scenarios.length} scenario(s).` },
        true,
      );
      return scenarios;
    });

  estimate = (text: string, options: QueueImportOptions): Promise<QueueImportReport> => estimateQueueInputs(text, options);

  applyEstimate = (parentId: string, report: QueueImportReport, name: string, overrides: { arrivalRate?: number; serviceRate?: number }) =>
    this.guard(async () => {
      const child = await forkFromEstimate(this.get(parentId), report, {
        name: name.trim() || "From data",
        ...(overrides.arrivalRate !== undefined ? { arrivalRateOverride: overrides.arrivalRate } : {}),
        ...(overrides.serviceRate !== undefined ? { serviceRateOverride: overrides.serviceRate } : {}),
      });
      this.replace(child, { selectedId: child.id, referenceId: null, notice: null });
      return child;
    });

  reset = () => {
    this.storage?.removeItem(STORAGE_KEY);
    this.state = empty;
    for (const l of this.listeners) l();
  };

  dismiss = () => this.set({ error: null, notice: null, loadError: null });

  children(id: string): Scenario[] {
    return this.state.scenarios.filter((s) => s.parentId === id);
  }

  roots(): Scenario[] {
    const ids = new Set(this.state.scenarios.map((s) => s.id));
    return this.state.scenarios.filter((s) => s.parentId === null || !ids.has(s.parentId));
  }

  lineage(id: string): Scenario[] {
    const chain: Scenario[] = [];
    let cur: Scenario | undefined = this.state.scenarios.find((s) => s.id === id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId ? this.state.scenarios.find((s) => s.id === cur!.parentId) : undefined;
    }
    return chain;
  }
}
