import { ScenarioError, type Scenario } from "./types";

/** In-memory collection with lineage queries. Completed scenarios cannot be replaced. */
export class ScenarioStore {
  private readonly items = new Map<string, Scenario>();

  constructor(initial: readonly Scenario[] = []) {
    for (const s of initial) this.put(s);
  }

  put(s: Scenario): void {
    const existing = this.items.get(s.id);
    if (existing && existing.status === "completed") {
      const same = existing.fingerprint === s.fingerprint && existing.result?.resultHash === s.result?.resultHash;
      if (!same) throw new ScenarioError(`scenario "${s.id}" is locked; fork it instead of replacing it`);
    }
    this.items.set(s.id, s);
  }

  get(id: string): Scenario {
    const s = this.items.get(id);
    if (!s) throw new ScenarioError(`no scenario with id "${id}"`);
    return s;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  all(): Scenario[] {
    return [...this.items.values()];
  }

  children(id: string): Scenario[] {
    return this.all().filter((s) => s.parentId === id);
  }

  /** Root → … → id. */
  lineage(id: string): Scenario[] {
    const chain: Scenario[] = [];
    const seen = new Set<string>();
    let cur: Scenario | undefined = this.get(id);
    while (cur) {
      if (seen.has(cur.id)) throw new ScenarioError(`lineage cycle at "${cur.id}"`);
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId && this.items.has(cur.parentId) ? this.items.get(cur.parentId) : undefined;
    }
    return chain;
  }
}
