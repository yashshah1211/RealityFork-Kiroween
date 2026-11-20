/**
 * queue.mmc@1.1.0: single-stage, c-server, FIFO queue (M/M/c when samplers are
 * exponential).
 *
 * Run phases (see .kiro/steering/simulation-correctness.md):
 *   - t = 0: empty and idle.
 *   - Warm-up [0, W); measurement window [W, H]. Arrivals are generated only on [0, H]
 *     (an arrival exactly at H is included).
 *   - Cohort = customers arriving in [W, H].
 *   - End of run ("drain-cohort"): after H, no new arrivals; events continue until
 *     every cohort customer has departed. No cohort customer is excluded for still
 *     being in the system at H; the counts at H are reported as censoring diagnostics.
 *   - Time averages (L, Lq, utilization, max queue) integrate over [W, H] only.
 *   - Events at exactly time H belong to the state "at H".
 */
import { EventQueue } from "../engine/eventQueue";
import type { ModelDefinition, RunSettings } from "../model";
import { validateSettings } from "../model";

export interface QueueParams extends Record<string, number> {
  servers: number;
  arrivalRatePerHour: number;
  serviceRatePerHour: number;
  serverCostPerHour: number;
  waitingCostPerHour: number;
}

export interface QueueMetrics extends Record<string, number> {
  meanWait: number;
  meanSojourn: number;
  avgQueueLength: number;
  avgInSystem: number;
  utilization: number;
  throughputPerHour: number;
  arrivalRateObserved: number;
  maxQueueLength: number;
  cohortSize: number;
  censoredInQueueAtHorizon: number;
  censoredInServiceAtHorizon: number;
  costPerHour: number;
}

export interface Samplers {
  /** Time until the next arrival (>= 0). */
  interarrival(): number;
  /** Service requirement of the customer arriving now (>= 0). */
  service(): number;
}

export interface SimulateOptions {
  /** If set, also return time-averaged queue length per bin over [0, H]. */
  binWidth?: number;
}

export interface CustomerRecords {
  readonly arrival: readonly number[];
  readonly service: readonly number[];
  /** NaN if service never started (only possible for non-cohort customers left after drain). */
  readonly serviceStart: readonly number[];
  /** NaN if the customer had not departed when the simulation stopped. */
  readonly departure: readonly number[];
}

export interface QueueRunDetail {
  readonly metrics: QueueMetrics;
  readonly customers: CustomerRecords;
  /** Raw integrals over [W, H]. */
  readonly areas: { readonly system: number; readonly queue: number; readonly busy: number };
  readonly atHorizon: {
    readonly arrived: number;
    readonly departed: number;
    readonly inQueue: number;
    readonly inService: number;
  };
  readonly bins?: readonly number[];
  readonly eventsProcessed: number;
}

export function simulateQueue(
  servers: number,
  samplers: Samplers,
  settings: RunSettings,
  costs: { serverCostPerHour: number; waitingCostPerHour: number } = { serverCostPerHour: 0, waitingCostPerHour: 0 },
  options: SimulateOptions = {},
): QueueRunDetail {
  validateSettings(settings);
  if (!Number.isInteger(servers) || servers < 1) throw new RangeError(`servers must be an integer >= 1`);
  const W = settings.warmup;
  const H = settings.horizon;

  const eq = new EventQueue<"arrival" | "departure", number>();
  const arrival: number[] = [];
  const service: number[] = [];
  const serviceStart: number[] = [];
  const departure: number[] = [];

  const queue: number[] = [];
  let qHead = 0;
  let busy = 0;
  let nSystem = 0;
  let departedTotal = 0;

  let last = 0;
  let areaN = 0;
  let areaQ = 0;
  let areaB = 0;
  let maxQ = 0;
  let departuresInWindow = 0;
  let cohortRemaining = 0;
  let events = 0;

  const binWidth = options.binWidth;
  const bins = binWidth ? new Array<number>(Math.ceil(H / binWidth)).fill(0) : undefined;

  const qlen = () => queue.length - qHead;

  const integrate = (to: number) => {
    const q = qlen();
    const lo = Math.max(last, W);
    const hi = Math.min(to, H);
    if (hi > lo) {
      const dt = hi - lo;
      areaN += nSystem * dt;
      areaQ += q * dt;
      areaB += busy * dt;
      if (q > maxQ) maxQ = q;
    }
    if (bins && binWidth && q > 0) {
      let a = last;
      const b = Math.min(to, H);
      while (a < b) {
        const idx = Math.min(Math.floor(a / binWidth), bins.length - 1);
        const end = Math.min(b, (idx + 1) * binWidth);
        bins[idx]! += q * (end - a);
        if (end <= a) break;
        a = end;
      }
    }
    last = to;
  };

  const startService = (id: number, t: number) => {
    busy++;
    serviceStart[id] = t;
    eq.schedule(t + service[id]!, "departure", id);
  };

  const checkDraw = (x: number, what: string) => {
    if (!(x >= 0) || !Number.isFinite(x)) throw new RangeError(`${what} sample must be finite and >= 0, got ${x}`);
    return x;
  };

  const first = checkDraw(samplers.interarrival(), "interarrival");
  if (first <= H) eq.schedule(first, "arrival", -1);

  let snapshot: QueueRunDetail["atHorizon"] | undefined;
  const takeSnapshot = () => ({ arrived: arrival.length, departed: departedTotal, inQueue: qlen(), inService: busy });

  while (eq.size > 0) {
    const next = eq.peek()!;
    if (next.time > H && !snapshot) {
      integrate(H);
      snapshot = takeSnapshot();
    }
    if (next.time > H && cohortRemaining === 0) break;
    eq.pop();
    events++;
    const t = next.time;
    integrate(t);

    if (next.kind === "arrival") {
      const id = arrival.length;
      arrival.push(t);
      // Service requirement drawn at arrival, in arrival order (keeps CRN aligned).
      service.push(checkDraw(samplers.service(), "service"));
      serviceStart.push(Number.NaN);
      departure.push(Number.NaN);
      nSystem++;
      if (t >= W) cohortRemaining++;
      if (busy < servers) startService(id, t);
      else queue.push(id);
      const a = checkDraw(samplers.interarrival(), "interarrival");
      if (t + a <= H) eq.schedule(t + a, "arrival", -1);
    } else {
      const id = next.payload;
      busy--;
      nSystem--;
      departedTotal++;
      departure[id] = t;
      if (t >= W && t <= H) departuresInWindow++;
      if (arrival[id]! >= W) cohortRemaining--;
      if (qlen() > 0) {
        const nextId = queue[qHead++]!;
        startService(nextId, t);
        if (qHead > 1024 && qHead * 2 > queue.length) {
          queue.splice(0, qHead);
          qHead = 0;
        }
      }
    }
  }
  if (!snapshot) {
    integrate(H);
    snapshot = takeSnapshot();
  }

  const measure = H - W;
  let cohortSize = 0;
  let sumWait = 0;
  let sumSojourn = 0;
  let censoredQ = 0;
  let censoredS = 0;
  for (let i = 0; i < arrival.length; i++) {
    if (arrival[i]! < W) continue;
    cohortSize++;
    const s = serviceStart[i]!;
    const d = departure[i]!;
    sumWait += s - arrival[i]!;
    sumSojourn += d - arrival[i]!;
    if (s > H) censoredQ++;
    else if (d > H) censoredS++;
  }

  const metrics: QueueMetrics = {
    meanWait: cohortSize > 0 ? sumWait / cohortSize : Number.NaN,
    meanSojourn: cohortSize > 0 ? sumSojourn / cohortSize : Number.NaN,
    avgQueueLength: areaQ / measure,
    avgInSystem: areaN / measure,
    utilization: areaB / (servers * measure),
    throughputPerHour: departuresInWindow / measure,
    arrivalRateObserved: cohortSize / measure,
    maxQueueLength: maxQ,
    cohortSize,
    censoredInQueueAtHorizon: censoredQ,
    censoredInServiceAtHorizon: censoredS,
    // Window basis for both terms: staff cost over [W, H] plus waiting cost of the
    // customer-hours actually spent waiting during [W, H] (∫Q dt), per window hour.
    costPerHour: servers * costs.serverCostPerHour + (costs.waitingCostPerHour * areaQ) / measure,
  };

  return {
    metrics,
    customers: { arrival, service, serviceStart, departure },
    areas: { system: areaN, queue: areaQ, busy: areaB },
    atHorizon: snapshot,
    ...(bins && binWidth ? { bins: bins.map((v, i) => v / Math.max(Math.min(binWidth, H - i * binWidth), 1e-300)) } : {}),
    eventsProcessed: events,
  };
}

export const queueModel: ModelDefinition<QueueParams, QueueMetrics> = {
  id: "queue.mmc",
  // 1.1.0: costPerHour waiting term moved from cohort basis to window basis (∫Q over [W, H]).
  version: "1.1.0",
  title: "Service desk queue (M/M/c, first-come-first-served)",
  streams: ["arrivals", "service"],
  parameters: {
    servers: { label: "Staff on duty", unit: "people", description: "Number of parallel servers.", min: 1, max: 1000, integer: true },
    arrivalRatePerHour: { label: "Customers arriving", unit: "per hour", description: "Average arrival rate (Poisson arrivals).", min: 1e-9, max: 1e6 },
    serviceRatePerHour: { label: "Customers one staff member can serve", unit: "per hour", description: "Service rate per server (exponential service times).", min: 1e-9, max: 1e6 },
    serverCostPerHour: { label: "Cost of one staff member", unit: "$ per hour", description: "Staffing cost per server-hour.", min: 0, max: 1e9 },
    waitingCostPerHour: { label: "Cost of a customer waiting", unit: "$ per customer-hour", description: "Cost assigned to each hour a customer waits in the queue.", min: 0, max: 1e9 },
  },
  metrics: {
    meanWait: { label: "Average wait before service", unit: "hours", lowerIsBetter: true, description: "Cohort basis: mean full queue wait of customers arriving in the measurement window, including waiting after the horizon (drain). NaN if no customer arrived." },
    meanSojourn: { label: "Average total time in system", unit: "hours", lowerIsBetter: true, description: "Wait plus service, same cohort." },
    avgQueueLength: { label: "Average number waiting", unit: "customers", lowerIsBetter: true, description: "Time-average queue length over the measurement window." },
    avgInSystem: { label: "Average number in system", unit: "customers", lowerIsBetter: true, description: "Time-average number present over the measurement window." },
    utilization: { label: "Staff utilization", unit: "fraction", lowerIsBetter: null, description: "Fraction of staff time spent serving." },
    // No preferred direction: in a stable queue throughput mostly tracks demand, so "higher" is not "better".
    throughputPerHour: { label: "Customers served", unit: "per hour", lowerIsBetter: null, description: "Window basis: departures during the measurement window per hour (includes customers who arrived during warm-up)." },
    arrivalRateObserved: { label: "Observed arrivals", unit: "per hour", lowerIsBetter: null, description: "Cohort size divided by window length." },
    maxQueueLength: { label: "Longest queue", unit: "customers", lowerIsBetter: true, description: "Maximum queue length held during the window." },
    cohortSize: { label: "Customers measured", unit: "customers", lowerIsBetter: null, description: "Arrivals in the measurement window." },
    censoredInQueueAtHorizon: { label: "Still waiting at end of window", unit: "customers", lowerIsBetter: null, description: "Cohort customers waiting at H (included in metrics via drain)." },
    censoredInServiceAtHorizon: { label: "Still in service at end of window", unit: "customers", lowerIsBetter: null, description: "Cohort customers in service at H (included via drain)." },
    // lowerIsBetter is null: this total includes a hypothetical waiting value, so a lower number is not
    // automatically "better". The trade-off view (compare/tradeoff.ts) separates the two parts.
    costPerHour: { label: "Modelled cost per hour (staff + assumed waiting value)", unit: "$ per hour", lowerIsBetter: null, description: "Window basis: servers × staff cost per hour + assumed waiting value × (customer-hours spent waiting during the window) ÷ window length." },
  },
  decision: {
    timeUnit: "hour",
    staffingCost: (p) => p.servers * p.serverCostPerHour,
    // Customer-hours waiting per window hour = time-average queue length (same basis as costPerHour).
    waitingHours: (_p, m) => m.avgQueueLength,
    waitingValue: (p) => p.waitingCostPerHour,
  },
  defaults: { servers: 2, arrivalRatePerHour: 1.6, serviceRatePerHour: 1, serverCostPerHour: 30, waitingCostPerHour: 20 },
  run(params, streams, settings) {
    const arrivals = streams["arrivals"];
    const svc = streams["service"];
    if (!arrivals || !svc) throw new Error("queue.mmc requires 'arrivals' and 'service' streams");
    return simulateQueue(
      params.servers,
      {
        interarrival: () => arrivals.exponential(params.arrivalRatePerHour),
        service: () => svc.exponential(params.serviceRatePerHour),
      },
      settings,
      { serverCostPerHour: params.serverCostPerHour, waitingCostPerHour: params.waitingCostPerHour },
    ).metrics;
  },
};
