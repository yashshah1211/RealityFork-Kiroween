/**
 * Binary min-heap of events ordered by (time, insertion sequence).
 * Ties in time are broken by insertion order, so processing is deterministic.
 */
export interface ScheduledEvent<K extends string = string, P = unknown> {
  readonly time: number;
  readonly seq: number;
  readonly kind: K;
  readonly payload: P;
}

export class EventQueue<K extends string = string, P = unknown> {
  private heap: ScheduledEvent<K, P>[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.heap.length;
  }

  schedule(time: number, kind: K, payload: P): ScheduledEvent<K, P> {
    if (!Number.isFinite(time)) throw new RangeError(`event time must be finite, got ${time}`);
    const ev: ScheduledEvent<K, P> = { time, seq: this.nextSeq++, kind, payload };
    this.heap.push(ev);
    this.siftUp(this.heap.length - 1);
    return ev;
  }

  peek(): ScheduledEvent<K, P> | undefined {
    return this.heap[0];
  }

  pop(): ScheduledEvent<K, P> | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private static less(a: ScheduledEvent, b: ScheduledEvent): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }

  private siftUp(i: number): void {
    const h = this.heap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!EventQueue.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private siftDown(i: number): void {
    const h = this.heap;
    const n = h.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && EventQueue.less(h[l]!, h[m]!)) m = l;
      if (r < n && EventQueue.less(h[r]!, h[m]!)) m = r;
      if (m === i) return;
      [h[i], h[m]] = [h[m]!, h[i]!];
      i = m;
    }
  }
}
