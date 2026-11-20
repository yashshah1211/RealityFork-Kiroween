import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { EventQueue } from "../src/engine/eventQueue";

describe("event queue (R2.1)", () => {
  it("pops in time order and breaks ties by insertion order", () => {
    const q = new EventQueue<"e", string>();
    q.schedule(2, "e", "c");
    q.schedule(1, "e", "a");
    q.schedule(2, "e", "d");
    q.schedule(1, "e", "b");
    const out: string[] = [];
    while (q.size) out.push(q.pop()!.payload);
    expect(out).toEqual(["a", "b", "c", "d"]);
  });

  it("property: popped sequence is sorted by (time, seq)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 300 }), (times) => {
        const q = new EventQueue<"e", number>();
        times.forEach((t, i) => q.schedule(t, "e", i));
        let prevT = -Infinity;
        let prevSeq = -1;
        let count = 0;
        while (q.size) {
          const ev = q.pop()!;
          if (ev.time < prevT || (ev.time === prevT && ev.seq <= prevSeq)) return false;
          prevT = ev.time;
          prevSeq = ev.seq;
          count++;
        }
        return count === times.length;
      }),
    );
  });

  it("rejects non-finite times", () => {
    const q = new EventQueue();
    expect(() => q.schedule(Number.POSITIVE_INFINITY, "x", null)).toThrow(RangeError);
    expect(() => q.schedule(Number.NaN, "x", null)).toThrow(RangeError);
  });
});
