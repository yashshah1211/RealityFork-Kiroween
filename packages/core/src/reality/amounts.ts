/**
 * Reading a number the way the user wrote it: ONE policy for every place an amount is typed or found in text (the
 * question card, the editors, the figures read from a question). It lives in core so that nothing can read a figure by
 * a looser rule than the one that refuses `1,5` and `1.500` (R18.1).
 *
 * Moved here unchanged from packages/web/src/reality/format.ts in R19; `format.ts` re-exports it, and its tests
 * (format.test.ts) still run against it. Pure: no DOM, no Node modules.
 */
/** Currency symbols written before the number. A unit that starts with one is an amount of money in that currency. */
const SYMBOL = /^[₹£$€¥₩₦₱₺₽₪₫₴₡₲₵₸]/;
const SYMBOL_END = /[₹£$€¥₩₦₱₺₽₪₫₴₡₲₵₸]$/;
/** The currency symbol a unit starts with ("₹ per month" → "₹"), or null. Never inferred from anything else. */
export const currencyOf = (unit: string): string | null => SYMBOL.exec(unit.trim())?.[0] ?? null;

// ---------- typed amounts ----------

/** Largest amount accepted. Beyond this a number can no longer hold whole units exactly, so it would not calculate reliably. */
export const MAX_AMOUNT = 1e15;

export type ParsedNumber = { readonly ok: true; readonly value: number | null } | { readonly ok: false; readonly message: string };

const plain = (x: number): string => String(x);

/**
 * Scale words written out after a number, with the number of places each one moves the decimal point: "5 lakh" is
 * exactly 500,000. Only these whole words are read; abbreviations (20k, 5 L, 2 cr, 3 mn, 1 bn) and words such as
 * "hundred", "dozen" or "grand" are not.
 */
export const SCALE_WORDS: Readonly<Record<string, number>> = {
  thousand: 3, thousands: 3, lakh: 5, lakhs: 5, lac: 5, lacs: 5, million: 6, millions: 6, crore: 7, crores: 7, billion: 9, billions: 9,
};
const SCALE_AFTER = new RegExp(`^(.*\\S)\\s+(${Object.keys(SCALE_WORDS).join("|")})$`, "iu");
/** Digits ("1234.5") with the decimal point moved `power` places to the right, as digits: no binary multiplication, so no rounding. */
function shiftDecimal(digits: string, power: number): string {
  const [whole = "", frac = ""] = digits.split(".");
  const moved = frac.padEnd(power, "0");
  return `${whole}${moved.slice(0, power)}${moved.length > power ? `.${moved.slice(power)}` : ""}`;
}

/**
 * A number the user typed. The policy never reads a separator as something it is not:
 *
 *  - Accepted: digits (1200), a dot for decimals (1.5, 0.285), commas that group thousands exactly as the app shows
 *    them (1,500 · 20,000 · 1,234,567.5), lakh grouping (1,00,000), spaces between groups of three (2 500), an optional
 *    sign (+, -, −), and the currency symbol of the field's own unit before or after the amount.
 *  - A scale word written out after the number (5 lakh · 1.5 crore · 20 thousand · 2 million · 3 billion; see
 *    SCALE_WORDS): the number before it is read by these same rules, then its decimal point is moved, so 1.1 lakh is
 *    exactly 110,000. Abbreviations (20k, 5 L, 2 cr, 3 mn) are refused as letters.
 *  - Refused with a reason, never converted: a comma that is not a thousands separator (1,5 · 0,285), dots used as
 *    thousands separators (1.200,50 · 1.200.300), and a dot followed by exactly three digits after 1–3 digits
 *    (1.500 · 2.500), which could be 1.5 or 1,500 depending on the writer's country. Letters, exponents (1e3), other
 *    punctuation and amounts of 1,000,000,000,000,000 or more are refused too.
 *  - A different currency symbol is refused, and so is any symbol on a field whose unit names no currency. No currency
 *    is ever guessed.
 *
 * Empty input means "unknown" (value null); the caller decides whether that is allowed.
 */
export function parseNumberInput(raw: string, unit: string): ParsedNumber {
  const typed = raw.normalize("NFKC").trim();
  if (!typed) return { ok: true, value: null };
  const say = (message: string): ParsedNumber => ({ ok: false, message });
  const notANumber = say(`“${typed}” isn't a number. Type digits with a dot for decimals, like 1200 or 2.5.`);

  let t = typed.replace(/[\s\u00a0\u2009\u202f]+/g, " ");
  let negative = false;
  const sign = (): void => {
    const m = /^([-−+])\s*/.exec(t);
    if (m) {
      negative = m[1] !== "+";
      t = t.slice(m[0].length);
    }
  };
  sign();
  let symbol: string | null = null;
  const lead = SYMBOL.exec(t);
  if (lead) {
    symbol = lead[0];
    t = t.slice(1).trimStart();
    if (!negative) sign();
  }
  const tail = SYMBOL_END.exec(t);
  if (tail) {
    if (symbol) return notANumber;
    symbol = tail[0];
    t = t.slice(0, -1).trimEnd();
  }
  if (symbol) {
    const own = currencyOf(unit);
    if (symbol !== own) {
      return say(own ? `This is in ${unit.trim()}. Enter the amount in ${own}, or just the number.` : `${unit.trim() ? `“${unit.trim()}”` : "This value"} has no currency, so enter just the number.`);
    }
  }
  let s = t.trim();
  // "5 lakh", "₹1.5 crore": the number is read by the rules below and the scale applied exactly at the end.
  const scaled = SCALE_AFTER.exec(s);
  const power = scaled ? SCALE_WORDS[scaled[2]!.toLowerCase()]! : 0;
  const word = scaled ? ` ${scaled[2]!}` : "";
  if (scaled) s = scaled[1]!.trim();
  if (!s || /[^\d.,\s]/.test(s)) return notANumber;

  let digits: string;
  if (/^\d+$/.test(s) || /^\d+\.$/.test(s)) digits = s;
  else if (/^\d*\.\d+$/.test(s)) {
    // 1.500 reads as 1.5 in some countries and as 1,500 in others: ask rather than choose.
    const m = /^([1-9]\d{0,2})\.(\d{3})$/.exec(s);
    if (m) return say(`“${typed}” could mean ${plain(Number(s))}${word} or ${m[1]}${m[2]}${word}. Type ${plain(Number(s))}${word} or ${m[1]}${m[2]}${word} so there is no doubt.`);
    digits = s;
  } else if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s) || /^[1-9]\d?(,\d{2})+,\d{3}(\.\d+)?$/.test(s)) digits = s.replace(/,/g, "");
  else if (/^[1-9]\d{0,2}( \d{3})+(\.\d+)?$/.test(s)) digits = s.replace(/ /g, "");
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    const meant = s.replace(/\./g, "").replace(",", ".");
    return say(`“${typed}” looks like European number formatting, which this field does not read. Type ${meant}${word} (a dot for decimals, no separators).`);
  } else if (/^[1-9]\d{0,2}(\.\d{3}){2,}$/.test(s)) {
    return say(`“${typed}” uses dots to group thousands, which this field does not read. Type ${s.replace(/\./g, "")}${word} (no separators).`);
  } else if (s.includes(",")) {
    const decimal = /^\d+,\d+$/.test(s) ? ` If you meant ${s.replace(",", ".")}, type it with a dot.` : "";
    return say(`“${typed}” has a comma that does not separate thousands. Use a dot for decimals (1.5) and commas only for thousands (1,500).${decimal}`);
  } else return notANumber;

  const value = Number(power ? shiftDecimal(digits, power) : digits);
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_AMOUNT) return say(`“${typed}” is larger than RealityFork can calculate with reliably (below 1,000,000,000,000,000).`);
  const signed = negative ? -value : value;
  return { ok: true, value: signed === 0 ? 0 : signed };
}

/** True when `ch` is a currency symbol this policy knows (the same set `parseNumberInput` and `currencyOf` use). */
export const isCurrencySymbol = (ch: string): boolean => ch.length > 0 && SYMBOL.test(ch);
