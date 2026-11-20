import { currencyOf, isIntervention, type AssumptionValue, type CalculatedResult, type FactChange, type OutcomeUnit, type PossibilityOrigin, type ValueProvenance } from "@realityfork/core";

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const exactMoney = new Intl.NumberFormat("en-GB", { maximumSignificantDigits: 21 });
type MoneyPrecision = "compact" | "exact";

/** Display only; values keep full precision in the model. */
export function showNumber(x: number): string {
  if (!Number.isFinite(x)) return "n/a";
  return nf.format(Math.abs(x) >= 1000 ? Math.round(x) : x);
}


// The number policy (parsing, the currency symbols, the largest amount) lives in core: see amounts.ts.
export { currencyOf, MAX_AMOUNT, parseNumberInput, type ParsedNumber } from "@realityfork/core";

/** A number with its unit: "£1,500 per month", "-£500 per month", "£36", "40 minutes", "8.3 years". */
export function withUnit(x: number, unit: string, moneyPrecision: MoneyPrecision = "compact"): string {
  if (!Number.isFinite(x)) return "n/a";
  const u = unit.trim();
  const symbol = currencyOf(u);
  if (!symbol) return `${showNumber(x)}${u ? ` ${u}` : ""}`;
  const rest = u.slice(symbol.length).trim();
  const digits = moneyPrecision === "exact" ? exactMoney.format(Math.abs(x)) : showNumber(Math.abs(x));
  const amount = `${x < 0 ? "-" : ""}${symbol}${digits}`;
  return rest ? `${amount}${rest.startsWith("/") ? "" : " "}${rest}` : amount;
}

export function showAssumption(v: AssumptionValue, unit = "", moneyPrecision: MoneyPrecision = "compact"): string {
  if (v === null) return "unknown";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return withUnit(v, unit, moneyPrecision);
  return showOption(v);
}

/**
 * A choice written as a code identifier by the AI ("fullTime", "newCountry", "self_study") shown in words ("full time",
 * "new country", "self study"). Only that shape is changed: plain words, names and brands ("London", "iPhone", "eBay")
 * are shown exactly as written. Display only: the stored value, and so every fingerprint, stays the same.
 */
export function showOption(v: string): string {
  if (/^[a-z]{2,}(?:[A-Z][a-z0-9]+)+$/.test(v)) return v.replace(/([A-Z])/g, " $1").toLowerCase();
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(v)) return v.replace(/_/g, " ");
  return v;
}

export function showResult(r: CalculatedResult, unit: string, short = false): string {
  switch (r.status) {
    case "ok":
      return typeof r.value === "number" ? withUnit(r.value, unit) : typeof r.value === "boolean" ? (r.value ? "yes" : "no") : r.value;
    case "missing":
      return short ? "needs input" : `Needs: ${r.missing.join(", ")}`;
    case "not-applicable":
      return short ? "not applicable" : `Not applicable: ${r.reason}`;
    default:
      return short ? "error" : `Cannot calculate: ${r.message}`;
  }
}

/** A calculated result with its unit (declared, or derived from its inputs by formulaUnit). Mixed units show no number. */
export function showOutcome(u: OutcomeUnit, r: CalculatedResult, short = false): string {
  if (u.status === "mixed" && r.status === "ok" && typeof r.value === "number") return `units don't match (${u.units.join(", ")})`;
  return showResult(r, u.unit, short);
}

/** Where an outcome's unit came from, for "How these are worked out". */
export function unitNote(u: OutcomeUnit): string {
  switch (u.status) {
    case "declared": return `in ${u.unit}`;
    case "derived": return `in ${u.unit}, the unit of the amounts it adds or subtracts`;
    case "mixed": return `no unit: it adds or subtracts amounts in different units (${u.units.join(", ")}), so no result is shown`;
    default: return "no unit given";
  }
}

/** "Type of place: café", "Hire staff: yes", "Rent: £1,200 per month". */
export function showSetting(label: string, value: AssumptionValue, unit = "", moneyPrecision: MoneyPrecision = "compact"): string {
  return `${label}: ${showAssumption(value, unit, moneyPrecision)}`;
}

// ---------- what a path differs in by words ----------

/**
 * A path differs from its parent in words in two different ways, and they are worded differently so a hypothetical is
 * never read as a fact: a change the user is EXPLORING (their premise for that path) and something they TOLD us
 * (a fact they know). A removal reads as "not on this path" because it may be a removal here or a later addition to the
 * parent; nothing records which.
 */
export function toldLine(f: FactChange): string {
  if (isIntervention(f)) return f.to === null ? `Change not applied here: ${f.from}` : `Exploring: ${f.to}`;
  return f.to === null ? `Not on this path: ${f.from}` : `You told us: ${f.to}`;
}

/** The same distinction for edits over time ("what changed" after the user changes their own words). */
export function factChangeLine(f: FactChange): string {
  const exploring = isIntervention(f);
  if (f.to === null) return exploring ? `No longer exploring: ${f.from}` : `No longer noted: ${f.from}`;
  if (f.from === null) return exploring ? `Exploring: ${f.to}` : `You told us: ${f.to}`;
  return exploring ? `Exploring: ${f.to} (was ${f.from})` : `Now: ${f.to} (was ${f.from})`;
}

/** One-line summary of what a path changed, for the map and lists: its values, then what the user told it. */
export function changeCaption(d: { readonly changes: readonly { label: string; unit: string; to: AssumptionValue }[]; readonly told: readonly FactChange[] }, isStart: boolean, moneyPrecision: MoneyPrecision = "compact"): string {
  if (isStart) return "Where you start";
  const parts = [...d.changes.map((c) => showSetting(c.label, c.to, c.unit, moneyPrecision)), ...d.told.map(toldLine)];
  return parts.length ? parts.join(" · ") : "Nothing changed yet";
}

// ---------- where things came from (one vocabulary for the whole application) ----------

/** Where a value used in a calculation came from, in a few words (see valueOrigin). */
export function originWords(p: ValueProvenance): string {
  switch (p.origin) {
    case "user": return "from you";
    case "example": return "example figure";
    case "ai": return "chosen by the AI draft";
    case "unrecorded": return "origin not recorded";
    default: return "not known yet";
  }
}

/** Who wrote a possibility, as a short tag. */
export const possibilityTag = (o: PossibilityOrigin): string => (o === "user" ? "written by you" : o === "example" ? "from the example" : o === "ai" ? "suggested by the AI" : "origin not recorded");

/**
 * The line above a list of possibilities. It says who wrote them only as far as that is recorded: a list is "your own"
 * only when every item is recorded as the user's, and anything saved without a record is never called anyone's.
 */
export function possibilityCaption(origins: readonly PossibilityOrigin[]): string {
  if (origins.length === 0) return "Possibilities you add, not predictions";
  const kinds = new Set(origins);
  if (kinds.size === 1) {
    const only = origins[0]!;
    return only === "user" ? "Your own possibilities, not predictions"
      : only === "ai" ? "AI-suggested possibilities, not predictions"
      : only === "example" ? "Possibilities that came with this example, not predictions"
      : "Possibilities (who wrote them was not recorded), not predictions";
  }
  if (kinds.size === 2 && kinds.has("ai") && kinds.has("user")) return "AI-suggested and your own possibilities, not predictions";
  return "Possibilities from more than one source (marked on each), not predictions";
}

/** Hues for futures: the start is violet; each first-level future gets its own colour, kept by its descendants. */
export const HUES = [248, 162, 24, 300, 200, 340, 95, 48] as const;
export const futureHue = (i: number) => HUES[(i + 1) % HUES.length]!;
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function signed(x: number, unit: string): string {
  const s = x > 0 ? "+" : x < 0 ? "−" : "±";
  return `${s}${withUnit(Math.abs(x), unit)}`;
}
