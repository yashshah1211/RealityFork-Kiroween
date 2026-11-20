/**
 * Unit spellings, for deciding whether two amounts can be added or subtracted. Display and storage always keep the
 * unit exactly as written; this only answers "is it the same unit?".
 *
 * Only spelling is normalised: case, spacing, "/" or "a"/"each"/"every" for "per", and the common abbreviations of
 * time words (min/minutes, hr/hours, wk/week, yr/year) and "%"/"percent". Nothing is converted (minutes are not hours,
 * a month is not a year) and no currency is ever added, guessed or equated with another: "$" stays "$", and a unit
 * without a currency stays without one.
 */

const TIME: Readonly<Record<string, string>> = {
  sec: "second", secs: "second", second: "second", seconds: "second",
  min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  day: "day", days: "day",
  wk: "week", wks: "week", week: "week", weeks: "week",
  month: "month", months: "month",
  yr: "year", yrs: "year", year: "year", years: "year",
};
const PER_WORDS = new Set(["a", "an", "each", "every"]);

/** A canonical spelling of a unit, used only to compare units. "₹/month" and "₹ per month" give the same result. */
export function normalizeUnit(unit: string): string {
  const s = unit
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*\/\s*/g, " per ")
    .replace(/\bper\s*cent\b/g, "%")
    .replace(/\bpercent\b/g, "%")
    .replace(/\.(?=\s|$)/g, "")
    .trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  return tokens
    .map((t, i) => {
      if (PER_WORDS.has(t) && TIME[tokens[i + 1] ?? ""] !== undefined) return "per";
      return TIME[t] ?? t;
    })
    .join(" ");
}

/** True when two units are the same unit written differently (or identically). Two empty units are the same. */
export const sameUnit = (a: string, b: string): boolean => normalizeUnit(a) === normalizeUnit(b);
