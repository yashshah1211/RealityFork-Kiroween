/**
 * queue.daypart@0.1.0: multi-server FIFO queue with piecewise-constant arrival rates and a
 * staffing schedule (validation spike). The constant-rate model queue.mmc is unchanged.
 *
 * Time unit: hours. Model time 0 = opening of day 1. Each day is 24 h:
 *   blocks 1–6: six 2-hour opening blocks, [0,2), [2,4), …, [10,12) → 08:00–20:00 local time;
 *   closed:     [12, 24) → no arrivals.
 * The run covers D = horizon / 24 whole days (warm-up must be 0: each run starts empty at opening).
 *
 * Arrivals: non-homogeneous Poisson with piecewise-constant rate λ(t), generated EXACTLY by time
 * change. Draw E ~ Exp(1) from the arrivals stream, then advance until ∫ λ = E, crossing block
 * boundaries (rate changes) and skipping zero-rate time. A single constant-rate exponential gap is
 * never applied across a boundary. With one constant-rate segment this is arithmetically identical
 * to queue.mmc's arrivals, which a test checks.
 *
 * Staffing rules (no pre-emption):
 *  - capacity(t) = scheduled staff of the current block;
 *  - an increase starts waiting customers immediately;
 *  - a DECREASE never interrupts a service. Servers above the new capacity finish their current
 *    customer, then leave; no new service starts while busy ≥ capacity;
 *  - paid staff on duty at t = max(capacity(t), busy(t)), so overrun to finish a service is paid;
 *  - at closing (end of block 6) arrivals stop and the block-6 staff stay on (overtime) until the
 *    system is empty, then capacity drops to 0. Customers still present carry over to the next
 *    day only if the system has not emptied by the next opening (reported as openingBacklog).
 *  - after the last day, the same overtime rule drains the system, so every customer finishes.
 *
 * Accounting (per day = total ÷ D): staff-hours = ∫ on-duty dt (including overtime and overrun);
 * waiting customer-hours = ∫ Q(t) dt (including overtime); costs use the stated hourly values.
 */
import { EventQueue } from "../engine/eventQueue";
import type { MetricSpec, ModelDefinition, ParameterSpec, RunSettings } from "../model";
import { validateSettings } from "../model";

export interface Segment {
  readonly start: number;
  readonly end: number;
  readonly ratePerHour: number;
  readonly staff: number;
  /** Closed segments have rate 0 and use the overtime rule. */
  readonly closed: boolean;
  /** Block index for per-block statistics, or -1. */
  readonly block: number;
}

/** Next arrival time after t, given E ~ Exp(1), by inverting the cumulative rate. Infinity if none before the last segment ends. */
export function nextArrivalTime(t: number, unitExp: number, segments: readonly Segment[], startIndex = 0): { time: number; index: number } {
  let remaining = unitExp;
  let i = startIndex;
  while (i < segments.length && segments[i]!.end <= t) i++;
  let cur = t;
  while (i < segments.length) {
    const s = segments[i]!;
    const from = Math.max(cur, s.start);
    if (s.ratePerHour > 0) {
      const capacity = s.ratePerHour * (s.end - from);
      if (capacity >= remaining) return { time: from + remaining / s.ratePerHour, index: i };
      remaining -= capacity;
    }
    cur = s.end;
    i++;
  }
  return { time: Number.POSITIVE_INFINITY, index: segments.length };
}

export interface ScheduledSamplers {
  /** Exp(1) draws for the arrival time change. */
  unitExponential(): number;
  service(): number;
}

export interface ScheduledRun {
  readonly arrival: readonly number[];
  readonly serviceStart: readonly number[];
  readonly departure: readonly number[];
  readonly block: readonly number[];
  readonly areaQueue: number;
  readonly areaOnDuty: number;
  readonly areaOnDutyClosed: number;
  readonly areaBusy: number;
  /** ∫ scheduled staff dt over open segments (deterministic: Σ staff × length). */
  readonly areaScheduled: number;
  /** ∫ max(0, busy − scheduled) dt over open segments: paid time finishing a customer after a decrease. */
  readonly areaOverrun: number;
  readonly maxQueue: number;
  /** Number in system at the start of each segment, plus the totals there (for conservation checks). */
  readonly boundaries: readonly { readonly time: number; readonly inSystem: number; readonly arrived: number; readonly departed: number; readonly inQueue: number; readonly busy: number }[];
  readonly endTime: number;
}

/**
 * Boundary policy.
 *  "0.1.0" (queue.daypart@0.1.0, kept for reproducibility of that version):
 *    - events at the same instant run in scheduling order, so a boundary event runs before an
 *      arrival that lands exactly on it, even if the arrival belongs to the earlier block;
 *    - after closing, all block-6 staff are paid until the system is empty, idle or not.
 *  "0.2.0" (Phase 1 audit fixes):
 *    - an arrival that lands exactly on the end of its own block is processed before that boundary
 *      (blocks are [start, end); the arrival's block decides the staffing it meets). Before the fix
 *      such an arrival at closing could wait overnight, or stall the run on the last day;
 *    - after closing, a staff member leaves as soon as no customer is waiting for them, the same
 *      rule as a mid-day decrease, so paid after-close time = busy time;
 *    - paid time is split into scheduled (∫ capacity in open blocks), overrun (∫ max(0, busy −
 *      capacity) in open blocks, i.e. finishing a customer after a decrease) and after-close.
 */
export type BoundaryPolicy = "0.1.0" | "0.2.0";

export function simulateScheduled(segments: readonly Segment[], samplers: ScheduledSamplers, policy: BoundaryPolicy = "0.1.0"): ScheduledRun {
  if (segments.length === 0) throw new RangeError("at least one segment is required");
  segments.forEach((s, i) => {
    if (!(s.end > s.start) || (i > 0 && s.start !== segments[i - 1]!.end)) throw new RangeError("segments must be contiguous with positive length");
    if (!(s.ratePerHour >= 0) || !Number.isFinite(s.ratePerHour)) throw new RangeError("arrival rates must be finite and >= 0");
    if (!Number.isInteger(s.staff) || s.staff < 0) throw new RangeError("staff must be a non-negative integer");
    if (s.closed && s.ratePerHour !== 0) throw new RangeError("closed segments must have arrival rate 0");
  });
  type Kind = "arrival" | "departure" | "segment";
  const eq = new EventQueue<Kind, number>();
  const arrival: number[] = [];
  const serviceStart: number[] = [];
  const departure: number[] = [];
  const service: number[] = [];
  const block: number[] = [];
  const queue: number[] = [];
  let qHead = 0;
  let busy = 0;
  let inSystem = 0;
  let departed = 0;
  let capacity = segments[0]!.closed ? 0 : segments[0]!.staff;
  let segIdx = 0;
  let overtimeStaff = 0; // staff kept on after closing until empty
  let last = 0;
  let areaQueue = 0, areaOnDuty = 0, areaOnDutyClosed = 0, areaBusy = 0, areaScheduled = 0, areaOverrun = 0, maxQueue = 0;
  const boundaries: ScheduledRun["boundaries"][number][] = [];
  const qlen = () => queue.length - qHead;
  const v2 = policy === "0.2.0";
  const finalEnd = segments[segments.length - 1]!.end;
  // 0.1.0 counted only closed segments; 0.2.0 also treats a drain past the last segment as after-close.
  const inClosed = () => segments[segIdx]!.closed || (v2 && last >= finalEnd);
  // 0.2.0: after closing, staff without a customer leave, so paid time = busy.
  const onDuty = () => (v2 && inClosed() ? busy : Math.max(capacity, busy));

  const integrate = (to: number) => {
    const dt = to - last;
    if (dt > 0) {
      const q = qlen();
      const closedNow = inClosed();
      areaQueue += q * dt;
      areaOnDuty += onDuty() * dt;
      areaBusy += busy * dt;
      if (closedNow) areaOnDutyClosed += onDuty() * dt;
      else {
        areaScheduled += capacity * dt;
        areaOverrun += Math.max(0, busy - capacity) * dt;
      }
      if (q > maxQueue) maxQueue = q;
    }
    last = to;
  };
  const startWaiting = (t: number) => {
    while (qlen() > 0 && busy < capacity) {
      const id = queue[qHead++]!;
      busy++;
      serviceStart[id] = t;
      eq.schedule(t + service[id]!, "departure", id);
    }
  };
  const check = (x: number, what: string) => {
    if (!(x >= 0) || !Number.isFinite(x)) throw new RangeError(`${what} sample must be finite and >= 0, got ${x}`);
    return x;
  };

  for (let i = 1; i < segments.length; i++) eq.schedule(segments[i]!.start, "segment", i);
  let next = nextArrivalTime(0, check(samplers.unitExponential(), "unit exponential"), segments);
  if (Number.isFinite(next.time)) eq.schedule(next.time, "arrival", next.index);

  type Ev = NonNullable<ReturnType<typeof eq.pop>>;
  const handle = (ev: Ev) => {
    const t = ev.time;
    if (ev.kind === "segment") {
      boundaries.push({ time: t, inSystem, arrived: arrival.length, departed, inQueue: qlen(), busy });
      const prev = segments[segIdx]!;
      segIdx = ev.payload;
      const s = segments[segIdx]!;
      if (s.closed) {
        overtimeStaff = prev.closed ? overtimeStaff : prev.staff;
        capacity = inSystem > 0 ? overtimeStaff : 0;
      } else {
        capacity = s.staff;
      }
      startWaiting(t);
    } else if (ev.kind === "arrival") {
      const id = arrival.length;
      arrival.push(t);
      block.push(segments[ev.payload]!.block);
      service.push(check(samplers.service(), "service"));
      serviceStart.push(Number.NaN);
      departure.push(Number.NaN);
      inSystem++;
      queue.push(id);
      startWaiting(t);
      next = nextArrivalTime(t, check(samplers.unitExponential(), "unit exponential"), segments, ev.payload);
      if (Number.isFinite(next.time)) eq.schedule(next.time, "arrival", next.index);
    } else {
      const id = ev.payload;
      busy--;
      inSystem--;
      departed++;
      departure[id] = t;
      const s = segments[segIdx]!;
      const closedNow = s.closed || t >= finalEnd;
      if (closedNow && inSystem === 0) capacity = 0; // overtime ends
      startWaiting(t);
    }
  };

  while (eq.size > 0) {
    const ev = eq.pop()!;
    integrate(ev.time);
    if (v2 && ev.kind === "segment") {
      // Same-instant batch: arrivals that belong to an EARLIER segment (they landed exactly on its
      // end) run before this boundary; everything else keeps scheduling order.
      const batch: Ev[] = [];
      while (eq.size > 0 && eq.peek()!.time === ev.time) batch.push(eq.pop()!);
      const early = batch.filter((e) => e.kind === "arrival" && e.payload < ev.payload);
      const rest = batch.filter((e) => !(e.kind === "arrival" && e.payload < ev.payload));
      for (const e of [...early, ev, ...rest]) handle(e);
    } else {
      handle(ev);
    }
    // After the last segment the overtime rule keeps draining with the last open staffing.
    if (eq.size === 0 && inSystem > 0) throw new Error("simulation stalled with customers in the system and no staff (staff 0 in an open block with no later staffing)");
  }
  // Scheduled staff are paid to the end of the last segment even if the last event was earlier.
  // Customers left after finalEnd are drained by the loop above, so endTime may exceed finalEnd.
  if (last < finalEnd) integrate(finalEnd);
  return { arrival, serviceStart, departure, block, areaQueue, areaOnDuty, areaOnDutyClosed, areaBusy, areaScheduled, areaOverrun, maxQueue, boundaries, endTime: last };
}

export const DAYPART_BLOCKS = [
  { key: "1", label: "08:00–10:00" },
  { key: "2", label: "10:00–12:00" },
  { key: "3", label: "12:00–14:00" },
  { key: "4", label: "14:00–16:00" },
  { key: "5", label: "16:00–18:00" },
  { key: "6", label: "18:00–20:00" },
] as const;
const BLOCK_HOURS = 2;
const OPEN_HOURS = 12;

export function daypartSegments(rates: readonly number[], staff: readonly number[], days: number): Segment[] {
  const out: Segment[] = [];
  for (let d = 0; d < days; d++) {
    const base = d * 24;
    for (let b = 0; b < 6; b++) {
      out.push({ start: base + b * BLOCK_HOURS, end: base + (b + 1) * BLOCK_HOURS, ratePerHour: rates[b]!, staff: staff[b]!, closed: false, block: b });
    }
    out.push({ start: base + OPEN_HOURS, end: base + 24, ratePerHour: 0, staff: 0, closed: true, block: -1 });
  }
  return out;
}

export type DaypartParams = Record<string, number>;
export type DaypartMetrics = Record<string, number>;

const rateKeys = DAYPART_BLOCKS.map((b) => `rate${b.key}`);
const staffKeys = DAYPART_BLOCKS.map((b) => `staff${b.key}`);

const parameters: Record<string, ParameterSpec> = {};
DAYPART_BLOCKS.forEach((b, i) => {
  parameters[rateKeys[i]!] = { label: `Customers arriving ${b.label}`, unit: "per hour", description: `Average arrivals per hour during ${b.label} (random arrivals at a steady rate within the block).`, min: 0, max: 1e5 };
});
DAYPART_BLOCKS.forEach((b, i) => {
  parameters[staffKeys[i]!] = { label: `Staff on duty ${b.label}`, unit: "people", description: `Scheduled staff during ${b.label}.`, min: 0, max: 1000, integer: true };
});
parameters.serviceRatePerHour = { label: "Customers one staff member can serve", unit: "per hour", description: "Average services per staff member per hour (random service times).", min: 1e-9, max: 1e6 };
parameters.staffCostPerHour = { label: "Cost of one staff member", unit: "$ per hour", description: "Paid per staff-hour on duty, including overtime and overrun.", min: 0, max: 1e9 };
parameters.waitingCostPerHour = { label: "Assumed value of customer waiting", unit: "$ per customer-hour", description: "Hypothetical value of one customer-hour of waiting; used only for the trade-off.", min: 0, max: 1e9 };

const metrics: Record<string, MetricSpec> = {
  meanWait: { label: "Average wait before service", unit: "hours", lowerIsBetter: true, description: "Mean wait of all customers in the run." },
  shareWaitOver15Min: { label: "Customers waiting over 15 minutes", unit: "fraction", lowerIsBetter: true, description: "Share of customers whose wait exceeded 0.25 h." },
  customersPerDay: { label: "Customers per day", unit: "customers", lowerIsBetter: null, description: "Arrivals ÷ days." },
  waitingHoursPerDay: { label: "Total customer waiting per day", unit: "customer-hours", lowerIsBetter: true, description: "∫ queue length dt ÷ days (includes overtime)." },
  staffHoursPerDay: { label: "Paid staff-hours per day", unit: "hours", lowerIsBetter: null, description: "∫ max(scheduled, busy) dt ÷ days." },
  overtimeHoursPerDay: { label: "Overtime staff-hours per day", unit: "hours", lowerIsBetter: null, description: "Paid staff-hours after closing ÷ days." },
  staffingCostPerDay: { label: "Staffing spend per day", unit: "$ per day", lowerIsBetter: null, description: "Paid staff-hours × staff cost." },
  modeledCostPerDay: { label: "Modelled cost per day (staff + assumed waiting value)", unit: "$ per day", lowerIsBetter: null, description: "Staffing spend + assumed waiting value × waiting customer-hours." },
  utilization: { label: "Staff busy time", unit: "fraction", lowerIsBetter: null, description: "Busy staff-hours ÷ paid staff-hours." },
  maxQueueLength: { label: "Longest queue", unit: "customers", lowerIsBetter: true, description: "Maximum queue length during the run." },
  openingBacklog: { label: "Customers still present at opening", unit: "customers", lowerIsBetter: true, description: "Mean number in system at the opening of days 2…D (carryover between days)." },
};
DAYPART_BLOCKS.forEach((b) => {
  metrics[`meanWaitBlock${b.key}`] = { label: `Average wait, arrivals ${b.label}`, unit: "hours", lowerIsBetter: true, description: `Mean wait of customers arriving ${b.label}; NaN if none arrived.` };
});


/** Metrics added in 0.2.0: paid time and spend split by reason, and the assumed waiting penalty. */
const metricsV2: Record<string, MetricSpec> = {
  ...metrics,
  staffHoursPerDay: { label: "Paid staff-hours per day", unit: "hours", lowerIsBetter: null, description: "Scheduled + overrun + after-close staff-hours ÷ days." },
  scheduledHoursPerDay: { label: "Scheduled staff-hours per day", unit: "hours", lowerIsBetter: null, description: "Σ staff per block × 2 h (open hours only)." },
  overrunHoursPerDay: { label: "Overrun staff-hours per day", unit: "hours", lowerIsBetter: null, description: "Paid time finishing a customer after a scheduled staff decrease during opening hours ÷ days." },
  overtimeHoursPerDay: { label: "After-closing staff-hours per day", unit: "hours", lowerIsBetter: null, description: "Paid time serving customers still present after 20:00 ÷ days. Staff leave once no one is waiting for them." },
  scheduledCostPerDay: { label: "Scheduled staffing spend per day", unit: "$ per day", lowerIsBetter: null, description: "Scheduled staff-hours × staff cost." },
  extraTimeCostPerDay: { label: "Overrun and after-closing spend per day", unit: "$ per day", lowerIsBetter: null, description: "(Overrun + after-closing staff-hours) × staff cost, at the same hourly rate." },
  staffingCostPerDay: { label: "Staffing spend per day", unit: "$ per day", lowerIsBetter: null, description: "Scheduled + overrun + after-closing spend." },
  waitingPenaltyPerDay: { label: "Assumed waiting penalty per day", unit: "$ per day", lowerIsBetter: null, description: "Assumed waiting value × waiting customer-hours per day. Hypothetical, not cash." },
};

function makeDaypartModel(version: BoundaryPolicy): ModelDefinition<DaypartParams, DaypartMetrics> {
  const v2 = version === "0.2.0";
  return {
    id: "queue.daypart",
    // 0.2.0: boundary-arrival ordering, after-close pay = busy time, paid time split (Phase 1 audit).
    version,
    title: "Service desk with a daily demand pattern and staffing schedule",
    streams: ["arrivals", "service"],
    parameters,
    metrics: v2 ? metricsV2 : metrics,
    defaults: {
      rate1: 8, rate2: 14, rate3: 24, rate4: 14, rate5: 10, rate6: 6,
      staff1: 2, staff2: 2, staff3: 2, staff4: 2, staff5: 2, staff6: 2,
      serviceRatePerHour: 10, staffCostPerHour: 30, waitingCostPerHour: 20,
    },
    run(p, streams, settings: RunSettings) {
      validateSettings(settings);
      if (settings.warmup !== 0) throw new RangeError("queue.daypart: warm-up must be 0 (each run starts empty at the first opening)");
      const days = settings.horizon / 24;
      if (!Number.isInteger(days) || days < 1) throw new RangeError("queue.daypart: horizon must be a whole number of 24-hour days");
      const arrivals = streams["arrivals"];
      const svc = streams["service"];
      if (!arrivals || !svc) throw new Error("queue.daypart requires 'arrivals' and 'service' streams");
      const segs = daypartSegments(rateKeys.map((k) => p[k]!), staffKeys.map((k) => p[k]!), days);
      const r = simulateScheduled(segs, {
        unitExponential: () => arrivals.exponential(1),
        service: () => svc.exponential(p.serviceRatePerHour!),
      }, version);
      const n = r.arrival.length;
      let sumWait = 0;
      let over = 0;
      const bSum = [0, 0, 0, 0, 0, 0];
      const bN = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const w = r.serviceStart[i]! - r.arrival[i]!;
        sumWait += w;
        if (w > 0.25) over++;
        const b = r.block[i]!;
        bSum[b]! += w;
        bN[b]!++;
      }
      const openings = r.boundaries.filter((x) => x.time > 0 && Math.abs(x.time % 24) < 1e-9);
      const cost = p.staffCostPerHour!;
      const value = p.waitingCostPerHour!;
      const out: DaypartMetrics = {
        meanWait: n > 0 ? sumWait / n : Number.NaN,
        shareWaitOver15Min: n > 0 ? over / n : Number.NaN,
        customersPerDay: n / days,
        waitingHoursPerDay: r.areaQueue / days,
        staffHoursPerDay: r.areaOnDuty / days,
        overtimeHoursPerDay: r.areaOnDutyClosed / days,
        staffingCostPerDay: (r.areaOnDuty / days) * cost,
        modeledCostPerDay: (r.areaOnDuty / days) * cost + (r.areaQueue / days) * value,
        utilization: r.areaOnDuty > 0 ? r.areaBusy / r.areaOnDuty : Number.NaN,
        maxQueueLength: r.maxQueue,
        openingBacklog: openings.length > 0 ? openings.reduce((s, x) => s + x.inSystem, 0) / openings.length : 0,
      };
      if (v2) {
        // Exact Σ staff × block length; the integral r.areaScheduled equals it up to rounding (tested).
        out.scheduledHoursPerDay = staffKeys.reduce((s, k) => s + p[k]! * BLOCK_HOURS, 0);
        out.overrunHoursPerDay = r.areaOverrun / days;
        out.scheduledCostPerDay = out.scheduledHoursPerDay * cost;
        out.extraTimeCostPerDay = ((r.areaOverrun + r.areaOnDutyClosed) / days) * cost;
        out.waitingPenaltyPerDay = (r.areaQueue / days) * value;
      }
      DAYPART_BLOCKS.forEach((b, i) => {
        out[`meanWaitBlock${b.key}`] = bN[i]! > 0 ? bSum[i]! / bN[i]! : Number.NaN;
      });
      return out;
    },
    decision: {
      timeUnit: "day",
      staffingCost: (_p, m) => m.staffingCostPerDay!,
      waitingHours: (_p, m) => m.waitingHoursPerDay!,
      waitingValue: (p) => p.waitingCostPerHour!,
    },
  };
}

/** queue.daypart@0.1.0, kept unchanged so results produced with it still reproduce. */
export const daypartModelV010 = makeDaypartModel("0.1.0");
/** queue.daypart@0.2.0, the current version (Phase 1 audit fixes). */
export const daypartModel = makeDaypartModel("0.2.0");
