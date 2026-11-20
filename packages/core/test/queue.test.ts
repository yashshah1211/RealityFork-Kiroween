import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { queueModel, simulateQueue, type QueueRunDetail, type Samplers } from "../src/models/queue";
import { createStreams } from "../src/rng";

const NEVER = 1e15;

/** Samplers that replay fixed sequences; interarrivals end with a value beyond any horizon. */
function fixedSamplers(inter: readonly number[], serv: readonly number[]): Samplers {
  let i = 0;
  let j = 0;
  return {
    interarrival: () => (i < inter.length ? inter[i++]! : NEVER),
    service: () => {
      if (j >= serv.length) throw new Error("service sequence exhausted");
      return serv[j++]!;
    },
  };
}

/** Independent reference: Kiefer–Wolfowitz workload recursion for FIFO G/G/c. */
function kieferWolfowitzWaits(c: number, inter: readonly number[], serv: readonly number[]): number[] {
  const free = new Array<number>(c).fill(0);
  const waits: number[] = [];
  let t = 0;
  for (let n = 0; n < inter.length; n++) {
    t = n === 0 ? inter[0]! : t + inter[n]!;
    free.sort((a, b) => a - b);
    const start = Math.max(t, free[0]!);
    free[0] = start + serv[n]!;
    waits.push(start - t);
  }
  return waits;
}

const waitsOf = (d: QueueRunDetail) => d.customers.arrival.map((a, i) => d.customers.serviceStart[i]! - a);

const seqArb = fc
  .integer({ min: 1, max: 80 })
  .chain((n) =>
    fc.tuple(
      fc.array(fc.double({ min: 0.001, max: 3, noNaN: true }), { minLength: n, maxLength: n }),
      fc.array(fc.double({ min: 0, max: 5, noNaN: true }), { minLength: n, maxLength: n }),
    ),
  );

const openRun = { warmup: 0, horizon: 1e12 };

describe("queue model: known answers (R2.9)", () => {
  it("single server matches a hand-computed Lindley trace exactly", () => {
    // Arrivals at 1,2,3,4; services 2, 0.5, 3, 1.
    // Lindley: W1=0, W2=max(0,0+2-1)=1, W3=max(0,1+0.5-1)=0.5, W4=max(0,0.5+3-1)=2.5
    const d = simulateQueue(1, fixedSamplers([1, 1, 1, 1], [2, 0.5, 3, 1]), openRun);
    expect(waitsOf(d)).toEqual([0, 1, 0.5, 2.5]);
    expect(d.customers.departure).toEqual([3, 3.5, 6.5, 7.5]);
  });

  it("property: c = 1 equals Lindley's recursion exactly", () => {
    fc.assert(
      fc.property(seqArb, ([inter, serv]) => {
        const d = simulateQueue(1, fixedSamplers(inter, serv), openRun);
        const lindley: number[] = [];
        let w = 0;
        for (let n = 0; n < inter.length; n++) {
          if (n > 0) w = Math.max(0, w + serv[n - 1]! - inter[n]!);
          lindley.push(w);
        }
        const sim = waitsOf(d);
        // Lindley accumulates differences, the simulation absolute times; compare to rounding.
        return sim.every((x, i) => Math.abs(x - lindley[i]!) <= 1e-9 * (1 + Math.abs(lindley[i]!)));
      }),
    );
  });

  it("property: any c equals the Kiefer–Wolfowitz reference exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), seqArb, (c, [inter, serv]) => {
        const d = simulateQueue(c, fixedSamplers(inter, serv), openRun);
        expect(waitsOf(d)).toEqual(kieferWolfowitzWaits(c, inter, serv));
      }),
    );
  });
});

describe("queue model: invariants (R2.5–R2.8, R2.10)", () => {
  const settings = { warmup: 20, horizon: 200 };
  const params = { ...queueModel.defaults };

  const runSeeded = (seed: number, servers: number, lambda: number, mu: number) => {
    const s = createStreams(seed, queueModel.streams, 0);
    return simulateQueue(
      servers,
      { interarrival: () => s["arrivals"]!.exponential(lambda), service: () => s["service"]!.exponential(mu) },
      settings,
    );
  };

  const caseArb = fc.record({
    seed: fc.nat({ max: 0xffffffff }),
    servers: fc.integer({ min: 1, max: 5 }),
    lambda: fc.double({ min: 0.2, max: 6, noNaN: true }),
    mu: fc.double({ min: 0.5, max: 3, noNaN: true }),
  });

  it("property: conservation at H (arrived = departed + in queue + in service)", () => {
    fc.assert(
      fc.property(caseArb, ({ seed, servers, lambda, mu }) => {
        const h = runSeeded(seed, servers, lambda, mu).atHorizon;
        return h.arrived === h.departed + h.inQueue + h.inService && h.inService <= servers;
      }),
      { numRuns: 150 },
    );
  });

  it("property: waits >= 0, sojourn >= wait, utilization in [0,1], throughput bounded", () => {
    fc.assert(
      fc.property(caseArb, ({ seed, servers, lambda, mu }) => {
        const d = runSeeded(seed, servers, lambda, mu);
        const m = d.metrics;
        const c = d.customers;
        for (let i = 0; i < c.arrival.length; i++) {
          if (c.arrival[i]! < settings.warmup) continue;
          const w = c.serviceStart[i]! - c.arrival[i]!;
          if (!(w >= 0) || !(c.departure[i]! - c.arrival[i]! >= w)) return false;
        }
        const window = settings.horizon - settings.warmup;
        return (
          m.utilization >= 0 &&
          m.utilization <= 1 + 1e-12 &&
          // throughput × window is an integer count of departures; recover it exactly before comparing
          // (55/180 × 180 = 55.00000000000001 in floating point, see the regression case below).
          Math.round(m.throughputPerHour * window) <= d.atHorizon.arrived &&
          m.avgQueueLength >= 0 &&
          m.avgInSystem >= m.avgQueueLength
        );
      }),
      { numRuns: 150 },
    );
  });

  it("regression: throughput bound case found by fast-check (every arrival departs inside the window)", () => {
    const d = runSeeded(3282869648, 2, 0.30819003331170497, 0.5000000000000059);
    const window = settings.horizon - settings.warmup;
    expect(d.atHorizon.arrived).toBe(55);
    expect(Math.round(d.metrics.throughputPerHour * window)).toBe(55);
    expect(d.metrics.throughputPerHour).toBe(55 / 180);
  });

  it("property: FIFO, so service starts are in arrival order", () => {
    fc.assert(
      fc.property(caseArb, ({ seed, servers, lambda, mu }) => {
        const s = runSeeded(seed, servers, lambda, mu).customers.serviceStart.filter((x) => !Number.isNaN(x));
        return s.every((x, i) => i === 0 || x >= s[i - 1]!);
      }),
      { numRuns: 150 },
    );
  });

  it("property: drain-cohort, so every cohort customer has a recorded departure", () => {
    fc.assert(
      fc.property(caseArb, ({ seed, servers, lambda, mu }) => {
        const d = runSeeded(seed, servers, lambda, mu);
        const c = d.customers;
        let cohort = 0;
        for (let i = 0; i < c.arrival.length; i++) {
          if (c.arrival[i]! < settings.warmup) continue;
          cohort++;
          if (Number.isNaN(c.departure[i]!)) return false;
        }
        return cohort === d.metrics.cohortSize;
      }),
      { numRuns: 150 },
    );
  });

  it("customers still in the system at H are kept and reported as censored, not dropped", () => {
    // Arrivals at 5 and 9.5 (H = 10, W = 0). Customer 2 needs 50 h of service.
    const d = simulateQueue(1, fixedSamplers([5, 4.5], [1, 50]), { warmup: 0, horizon: 10 });
    expect(d.metrics.cohortSize).toBe(2);
    expect(d.metrics.censoredInServiceAtHorizon).toBe(1);
    expect(d.metrics.censoredInQueueAtHorizon).toBe(0);
    expect(d.metrics.meanSojourn).toBeCloseTo((1 + 50) / 2, 12);
    // Time averages are still restricted to [0, 10].
    expect(d.metrics.utilization).toBeCloseTo((1 + 0.5) / 10, 12);
  });

  it("property: exact finite-window Little identities for N(t), Q(t) and busy servers", () => {
    fc.assert(
      fc.property(caseArb, ({ seed, servers, lambda, mu }) => {
        const d = runSeeded(seed, servers, lambda, mu);
        const { warmup: W, horizon: H } = settings;
        const ov = (a: number, b: number) => {
          const end = Number.isNaN(b) ? Infinity : b;
          return Math.max(0, Math.min(end, H) - Math.max(a, W));
        };
        const c = d.customers;
        let sys = 0;
        let que = 0;
        let bus = 0;
        for (let i = 0; i < c.arrival.length; i++) {
          const start = Number.isNaN(c.serviceStart[i]!) ? Infinity : c.serviceStart[i]!;
          sys += ov(c.arrival[i]!, c.departure[i]!);
          que += ov(c.arrival[i]!, start);
          bus += ov(start, c.departure[i]!);
        }
        const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * (1 + Math.abs(y));
        return close(d.areas.system, sys) && close(d.areas.queue, que) && close(d.areas.busy, bus);
      }),
      { numRuns: 150 },
    );
  });

  it("property: with matched inputs, adding a server never increases any customer's wait", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), seqArb, (c, [inter, serv]) => {
        const a = waitsOf(simulateQueue(c, fixedSamplers(inter, serv), openRun));
        const b = waitsOf(simulateQueue(c + 1, fixedSamplers(inter, serv), openRun));
        return b.every((w, i) => w <= a[i]! + 1e-12);
      }),
    );
  });

  it("R2.7 identical inputs give deep-equal outputs (registered model)", () => {
    const run = () => queueModel.run(params, createStreams(31337, queueModel.streams, 3), settings);
    expect(run()).toEqual(run());
  });

  it("separate streams keep arrivals identical when the server count changes (CRN alignment)", () => {
    const arrivalsFor = (servers: number) => {
      const s = createStreams(77, queueModel.streams, 0);
      return simulateQueue(
        servers,
        { interarrival: () => s["arrivals"]!.exponential(1.6), service: () => s["service"]!.exponential(1) },
        settings,
      ).customers;
    };
    const two = arrivalsFor(2);
    const three = arrivalsFor(3);
    expect(three.arrival).toEqual(two.arrival);
    expect(three.service).toEqual(two.service);
  });

  it("cost per hour follows the stated formula", () => {
    const d = simulateQueue(2, fixedSamplers([1, 0.5], [3, 3]), { warmup: 0, horizon: 10 }, { serverCostPerHour: 30, waitingCostPerHour: 20 });
    // Both start immediately (2 servers): total wait 0, so cost = 2 × 30.
    expect(d.metrics.costPerHour).toBe(60);
    const e = simulateQueue(1, fixedSamplers([1, 0.5], [3, 3]), { warmup: 0, horizon: 10 }, { serverCostPerHour: 30, waitingCostPerHour: 20 });
    // Second waits 2.5 h, all inside the window: 30 + 20 × 2.5 / 10 = 35.
    expect(e.metrics.costPerHour).toBeCloseTo(35, 12);
  });

  it("cohort-basis waits and window-basis integrals differ at the boundary, by design", () => {
    // W = 0, H = 10, one server. Customer 1 arrives at 9 (service 5), customer 2 at 9.5.
    // Customer 2 waits from 9.5 to 14: full wait 4.5 h (cohort basis, via drain),
    // but only 0.5 h of that waiting lies inside [0, 10] (window basis, ∫Q dt).
    const d = simulateQueue(1, fixedSamplers([9, 0.5], [5, 1]), { warmup: 0, horizon: 10 }, { serverCostPerHour: 0, waitingCostPerHour: 10 });
    expect(d.metrics.meanWait).toBeCloseTo((0 + 4.5) / 2, 12);
    expect(d.metrics.censoredInQueueAtHorizon).toBe(1);
    expect(d.areas.queue).toBeCloseTo(0.5, 12);
    expect(d.metrics.avgQueueLength).toBeCloseTo(0.05, 12);
    // Cost uses the window basis: 10 $/h × 0.5 customer-hours ÷ 10 h.
    expect(d.metrics.costPerHour).toBeCloseTo(0.5, 12);
    // So λ̂·W̄q (0.2 × 2.25 = 0.45) ≠ Lq (0.05) here: the asymptotic relation is not an identity.
    expect(d.metrics.arrivalRateObserved * d.metrics.meanWait).not.toBeCloseTo(d.metrics.avgQueueLength, 3);
  });

  it("an empty cohort yields NaN waits (no observations), distinct from a zero wait", () => {
    const empty = simulateQueue(1, fixedSamplers([50], [1]), { warmup: 0, horizon: 10 });
    expect(empty.metrics.cohortSize).toBe(0);
    expect(Number.isNaN(empty.metrics.meanWait)).toBe(true);
    const zero = simulateQueue(1, fixedSamplers([1], [1]), { warmup: 0, horizon: 10 });
    expect(zero.metrics.meanWait).toBe(0);
  });

  it("rejects invalid settings and samples", () => {
    expect(() => simulateQueue(1, fixedSamplers([1], [1]), { warmup: 5, horizon: 5 })).toThrow(RangeError);
    expect(() => simulateQueue(0, fixedSamplers([1], [1]), openRun)).toThrow(RangeError);
    expect(() => simulateQueue(1, fixedSamplers([1], [-1]), openRun)).toThrow(RangeError);
  });
});
