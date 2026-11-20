import { formatNumber } from "@realityfork/core";

/**
 * Display helpers. They only round for display; the underlying values keep full precision
 * (results, fingerprints and comparisons are computed by the core on unrounded numbers).
 */

const minutes = (h: number) => {
  const m = h * 60;
  return Math.abs(m) >= 10 ? m.toFixed(0) : m.toFixed(1);
};

/** Money: whole dollars from $100, otherwise cents. */
export function showMoney(v: number): string {
  if (!Number.isFinite(v)) return "n/a";
  return `$${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}

/** Display a value with its unit. Durations under 2 hours are shown in minutes. */
export function showValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "n/a";
  if (unit === "hours") return Math.abs(v) < 2 ? `${minutes(v)} min` : `${v.toFixed(1)} h`;
  if (unit === "fraction") return `${(v * 100).toFixed(1)}%`;
  if (unit.startsWith("$")) return `${showMoney(v)}${unit.slice(1)}`;
  return `${formatNumber(v)} ${unit}`.trim();
}

export function showDiff(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "n/a";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (unit === "fraction") return `${sign}${(a * 100).toFixed(1)} pts`;
  return `${sign}${showValue(a, unit)}`;
}

/** Headline outcomes. The modelled total cost is shown in the trade-off panel, split into its parts. */
export const KEY_METRICS = ["meanWait", "avgQueueLength", "utilization"] as const;

const KEY_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  "queue.mmc": KEY_METRICS,
  "queue.daypart": ["meanWait", "shareWaitOver15Min", "staffingCostPerDay"],
};
export const keyMetrics = (modelId: string): readonly string[] => KEY_BY_MODEL[modelId] ?? KEY_METRICS;

/**
 * Plain-language help for the primary path, keyed by model id then parameter or metric key.
 * The model's own technical descriptions are kept behind a "Technical detail" disclosure.
 */
export const PLAIN_HELP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "queue.mmc": {
    servers: "How many people serve customers at the same time.",
    arrivalRatePerHour: "On average, how many customers walk up each hour. Arrivals are random, so some hours are busier than others.",
    serviceRatePerHour: "How many customers one person can finish in an hour, on average. Some customers take much longer than others.",
    serverCostPerHour: "What one hour of one staff member costs you.",
    waitingCostPerHour: "A value you choose for one hour of one customer's waiting. It is an assumption, not money you pay; use the break-even value below to see when it matters.",
  },
  "queue.daypart": {
    serviceRatePerHour: "How many customers one person can finish in an hour, on average. Some customers take much longer than others.",
    staffCostPerHour: "What one hour of one staff member costs you. Time spent finishing a customer after a shift ends is paid at the same rate.",
    waitingCostPerHour: "A value you choose for one hour of one customer's waiting. It is an assumption, not money you pay; the break-even value shows when it matters.",
    ...Object.fromEntries(["08:00–10:00", "10:00–12:00", "12:00–14:00", "14:00–16:00", "16:00–18:00", "18:00–20:00"].flatMap((l, i) => [
      [`rate${i + 1}`, `Average customers arriving per hour between ${l}. Arrivals are random within the block.`],
      [`staff${i + 1}`, `People scheduled to serve between ${l}.`],
    ])),
  },
};

export function shortHash(h: string): string {
  return `${h.slice(0, 10)}…`;
}
