/**
 * Figures the user already wrote in their question (R19).
 *
 * "What if I opened a bookstore with ₹20,000 per month in sales, ₹8,000 rent …" already says the numbers; asking for
 * them again is friction. This module reads them out of the question and proposes where they belong in the AI's draft.
 * It never decides: nothing here sets a value. The user sees each proposal, can change or reject it, and only what they
 * confirm is used (see proposalToReality's `figures`).
 *
 * Deterministic and local: no AI request, no network. Conservative on purpose, because a wrong number is worse than a
 * number the user types once:
 *  - Every number is read by the SAME policy that reads typed amounts (amounts.ts): `1,5`, `1.500`, `1.200,50`, `1e3`
 *    are never guessed, they are reported as "not used". So are numbers glued to letters (`20k`), written with a short
 *    or unusual scale word (`20 k`, `5 L`, `2 cr`, `3 hundred`), signed, in a range (`20-30`, `between 5 and 8`), a
 *    fraction or time (`1/2`, `10:30`), a percentage, a duration in parts (`1 hour 30 minutes`), several numbers in a row
 *    (`5 lakh 50 thousand`, `twenty five hours`).
 *  - A scale word written out after the number (`₹5 lakh`, `1.5 crore`, `20 thousand`, `2 million`) is read by that same
 *    policy, exactly (5 lakh is 500,000), and the figure keeps the user's own words. A note beside it says how it was
 *    read, and like every figure it is used only after the user confirms.
 *  - A figure is matched to an assumption only when the words around it overlap the assumption's name AND its unit is
 *    compatible: the same currency, the same kind of unit, the same period. A currency or period that the question does
 *    not state, or that the field does not have, is never filled in: it is shown as a note and the figure is not
 *    pre-selected. No currency is inferred from a word, a place or a field: only a symbol the user wrote counts.
 *  - When two figures fit the same assumption ("two hours instead of one hour") they cannot both go in one future: each
 *    needs its own future, which is proposed only when the future's name says it.
 *
 * R20A, trustworthy figures. What is pre-ticked is only what the user wrote, next to the figure:
 *  - A period the user did not write beside an amount is never filled in from another amount or another figure ("budget
 *    of ₹500,000" is not "₹500,000 per month" because the rent is monthly). It is said, the row is not pre-ticked.
 *  - A hedge is kept with the amount and is not an exact amount: "at least", "at most", "up to", "about",
 *    "approximately", "roughly", "around", "over", "under" (and a few plain synonyms, before the figure or right after
 *    it: "3 hours or more"). The value is never turned into a range; the row is not pre-ticked, and ticking it is the
 *    user's confirmation that this number is to be used exactly.
 *  - Where a figure goes is proposed from evidence in the question and the draft, never by default (R20A.1, scope.ts):
 *    figures that compete for one assumption go to the future whose name says them; any other figure goes to the futures
 *    it applies to: the ones its own words name, the ones that do what is asked ("there", an expectation), the ones that
 *    keep things as they are ("here", "now"), or every future when it is something the person has or a countdown to a
 *    date. When that cannot be told, nothing is ticked and the user chooses (an offered figure with no place is warned
 *    about). The reason is said. "The future the user opens" is still a choice the user can make, never a default.
 *  - When the question is edited, the user's choices follow a figure whose meaning did not change (carryFigureChoices),
 *    but a place that only repeats what the earlier wording proposed follows the new wording; anything else is said,
 *    never dropped silently.
 * Pure module: no DOM, no Node modules.
 */
import { currencyOf, isCurrencySymbol, parseNumberInput, SCALE_WORDS } from "./amounts";
import type { AppliedFigure, Proposal, ProposalSelection, ProposalVariable } from "./proposal";
import { decideScope, futureRoles, readCues, type FutureRole, type ScopeBasis, type ScopeCues, type ScopeDecision } from "./scope";
import { FUNCTION_WORDS } from "./story";
import { normalizeUnit } from "./units";

// ---------- reading ----------

/**
 * How the user hedged a figure. A hedged figure is not an exact amount, so it is never pre-selected and never turned
 * into a range: the number stays what was written and the words stay with it.
 */
export interface StatedQualifier {
  /** "min": at least, more than, over …  "max": at most, up to, under, less than …  "about": about, roughly, around … */
  readonly kind: "min" | "max" | "about";
  /** The user's own words ("at least", "or more", "roughly"). */
  readonly word: string;
  /** True when it was written after the amount ("₹35,000 or more"), false when before ("at least ₹35,000"). */
  readonly after: boolean;
}

/** One figure found in the question, exactly as written. */
export interface StatedValue {
  /** Stable while the wording around it is unchanged: the words, plus which occurrence of them. */
  readonly id: string;
  /** The user's own words that state it, e.g. "₹20,000 per month in sales". Never reworded. */
  readonly text: string;
  readonly value: number;
  /** The currency symbol the user wrote, or null. A currency is never inferred. */
  readonly currency: string | null;
  /** "hour", "week", … when the figure counts a unit of time; "" for money and bare numbers. */
  readonly base: string;
  /** "month", "day", … when the question gives a period ("per month", "monthly", "daily", "/month"); otherwise null. */
  readonly period: string | null;
  /** Word stems that say what it is ("sales" → "sal"). */
  readonly label: readonly string[];
  /** Notes about words taken from the figure it is compared with ("two hours daily instead of one hour"). */
  readonly inherited: readonly string[];
  /** The hedge the user wrote with it ("at least", "about", "or more"), or null for an amount stated plainly. */
  readonly qualifier: StatedQualifier | null;
  /** Its own words say it is a lump sum (budget, savings, total, one-time, deposit …): it never takes a period from another amount. */
  readonly lumpSum: boolean;
  /** What its own clause and sentence say about where it belongs (R20A.1): points back to what is asked, to today, an expectation, something the person has … */
  readonly cues: ScopeCues;
  /** Where the words are in the question (offsets into the original string). */
  readonly start: number;
  readonly end: number;
  /** Present when the number was written with a scale word: the word ("lakh") and the figure as written ("₹5 lakh"). */
  readonly scale?: { readonly word: string; readonly written: string };
}
/** A number in the question that was not used, and why, in plain words. */
export interface StatedUnclear { readonly text: string; readonly why: string }
export interface StatedRead { readonly values: readonly StatedValue[]; readonly unclear: readonly StatedUnclear[] }

const TIME_BASES = new Set(["second", "minute", "hour", "day", "week", "month", "year"]);
const TIME_WORD = "seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?";
const ADVERB: Readonly<Record<string, string>> = { hourly: "hour", daily: "day", weekly: "week", monthly: "month", yearly: "year", annually: "year" };
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};
const NUMWORD = Object.keys(NUMBER_WORDS).join("|");
const WORD_OF: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(NUMBER_WORDS).map(([w, n]) => [n, w]));
/** Words that end the stretch of a sentence a figure's meaning is read from. */
const CLAUSE_END = /[,;.?!:()]|\b(?:and|but|with|while|instead|than|then|so|because|if|when|versus|vs|whereas|plus|or|rather)\b/giu;
const COMPARES = /^(?:instead of|rather than|versus|vs\.?|compared (?:with|to)|as opposed to)$/i;
/** Words next to a figure that say nothing about what it is. */
const FILLER = new Set(
  ("per away left ahead remaining until before after roughly approximately approx around about almost nearly circa over under above below just only also " +
    "least most more less fewer minimum maximum min max upwards excess").split(" "),
);
const SYNONYM: Readonly<Record<string, string>> = { expens: "cost", spend: "cost", revenu: "sal" };
/** A scale word written out after a number ("₹5 lakh", "2 million"): read together with the number, exactly (amounts.ts). */
const SCALE_READ = new RegExp(String.raw`^[ \t\u00a0]+(${Object.keys(SCALE_WORDS).join("|")})(?![\p{L}\p{N}])`, "iu");
/** Any other word after a number that scales it ("20 k", "5 L", "3 hundred"): reading the number alone would be wrong by that factor. */
const SCALE = /^\s*(?:k|m|mn|bn|b|l|lakhs?|lacs?|crores?|cr|thousands?|hundreds?|millions?|billions?|trillions?|dozens?|grand)\b/i;
const FRACTION = /^\s*(?:and\s+)?(?:a\s+)?(?:half|quarter)\b/i;
const PERCENT = /^\s*(?:%|percent\b|per\s?cent\b)/i;
const ORDINAL = /^(?:st|nd|rd|th)$/i;
/** A word before a duration that makes "a week" mean "within a week", not "per week". */
const YEAR_WORDS = new Set(["in", "by", "from", "since", "until", "till", "before", "after", "during", "around", "year"]);

const timeOf = (word: string): string | null => {
  const n = normalizeUnit(word.toLowerCase());
  return TIME_BASES.has(n) ? n : null;
};

/** A word reduced to its stem, the way factMatches does, plus -ied/-ies → -y and a few synonyms (expenses = costs). */
function stem(raw: string): string {
  let w = raw.normalize("NFKC").toLowerCase();
  if (w.length > 4 && (w.endsWith("ies") || w.endsWith("ied"))) w = `${w.slice(0, -3)}y`;
  else for (const end of ["ing", "ed", "ly", "s"]) if (w.length - end.length >= 3 && w.endsWith(end)) { w = w.slice(0, -end.length); break; }
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return SYNONYM[w] ?? w;
}

interface Tok { readonly text: string; readonly start: number; readonly end: number }
const tokens = (s: string, offset = 0): Tok[] => [...s.matchAll(/\p{L}+(?:['’]\p{L}+)?/gu)].map((m) => ({ text: m[0], start: offset + m.index!, end: offset + m.index! + m[0].length }));
/** The meaning-carrying stems among some words: no function words, fillers, periods or units of time. */
const meaningStems = (toks: readonly Tok[]): string[] =>
  toks.filter((t) => { const l = t.text.toLowerCase(); return !FUNCTION_WORDS.has(l) && !FILLER.has(l) && !ADVERB[l] && timeOf(l) === null; }).map((t) => stem(t.text));

/** A number-like token of the question: digits with a currency symbol before or right after them, or a number word. */
interface Hit {
  readonly start: number;
  /** After the number, its currency symbol and its scale word, if any. */
  readonly end: number;
  readonly symbol: string | null;
  readonly raw: string;
  readonly word: boolean;
  /** A scale word written out right after the number ("lakh" in "₹5 lakh"), read exactly with it; null when there is none. */
  readonly scale: string | null;
}
/** A stretch of the question that holds a number which is not used, and why. */
interface Skip { readonly start: number; readonly end: number; readonly why: string }

const isLetterOrDigit = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
const blank = (s: string, from: number, to: number): string => s.slice(0, from) + " ".repeat(to - from) + s.slice(to);

/** Every number-like token, in order, plus the numbers that sit inside a word, a fraction, a date or a time (reported, never returned). */
function findNumbers(q: string): { hits: Hit[]; skips: Skip[] } {
  const hits: Hit[] = [];
  const skips: Skip[] = [];
  // "1/2", "10:30" and "12/05/2024" are read as a whole or not at all, so their parts are never mistaken for amounts.
  let rest = q;
  for (const m of q.matchAll(/\d+(?:[/:]\d+)+/g)) {
    skips.push({ start: m.index!, end: m.index! + m[0].length, why: "fractions, dates and times are not read from a question" });
    rest = blank(rest, m.index!, m.index! + m[0].length);
  }
  for (const m of rest.matchAll(/\d+(?:[.,]\d+)*/gu)) {
    const numStart = m.index!;
    const numEnd = numStart + m[0].length;
    // A currency symbol right before the digits (one space allowed) or right after them.
    const j = rest[numStart - 1] === " " ? numStart - 2 : numStart - 1;
    const lead = j >= 0 && isCurrencySymbol(rest[j]!);
    const trail = !lead && isCurrencySymbol(rest[numEnd] ?? "");
    const start = lead ? j : numStart;
    const end = trail ? numEnd + 1 : numEnd;
    const symbol = lead ? rest[j]! : trail ? rest[numEnd]! : null;
    const prev = rest[start - 1];
    const next = rest[end];
    if (isLetterOrDigit(prev) || prev === "." || prev === ",") { skips.push({ start, end, why: "it is part of a longer word or number" }); continue; }
    if (isLetterOrDigit(next)) {
      const glue = /^[\p{L}\p{N}_]+/u.exec(rest.slice(end))?.[0] ?? "";
      // "3rd" is an ordinal, not an amount. Anything else stuck to a number ("20k", "7pm", "1e3") might change what it means.
      if (!ORDINAL.test(glue)) skips.push({ start, end: end + glue.length, why: "letters stuck to a number are not read (write 20,000, not 20k)" });
      continue;
    }
    const scale = SCALE_READ.exec(rest.slice(end));
    hits.push({ start, end: scale ? end + scale[0].length : end, symbol, raw: m[0], word: false, scale: scale ? scale[1]! : null });
  }
  // A number word counts only before a unit of time ("two hours") or inside a range ("two to three"): "one of my friends" is not a figure.
  const words = new RegExp(String.raw`\b(${NUMWORD})\b(?=[\s-]+(?:${TIME_WORD})\b|\s*(?:[-–—]|to\b|or\b)\s*(?:${NUMWORD}\b|\d))`, "giu");
  for (const m of q.matchAll(words)) hits.push({ start: m.index!, end: m.index! + m[1]!.length, symbol: null, raw: m[1]!, word: true, scale: null });
  hits.sort((a, b) => a.start - b.start);
  return { hits, skips };
}

const RANK: Readonly<Record<string, number>> = { second: 0, minute: 1, hour: 2, day: 3, week: 4, month: 5, year: 6 };
const RANGE_GAP = new RegExp(String.raw`^\s*(?:(?:${TIME_WORD})\s*)?(?:[-–—]|to)\s*$`, "iu");
const BETWEEN_GAP = new RegExp(String.raw`^\s*(?:(?:${TIME_WORD})\s*)?and\s*$`, "iu");
const PARTS_GAP = new RegExp(String.raw`^\s*(${TIME_WORD})\s*(?:and|&)?\s*$`, "iu");
const UNIT_AFTER = new RegExp(String.raw`^\s*(${TIME_WORD})\b`, "iu");

/** Why two neighbouring numbers cannot be read one by one, or null. */
function pairWhy(q: string, a: Hit, b: Hit): string | null {
  const gap = q.slice(a.end, b.start);
  if (RANGE_GAP.test(gap) || (BETWEEN_GAP.test(gap) && /\bbetween\s*$/i.test(q.slice(0, a.start)))) return "it looks like a range, so no single figure is used";
  if (/^\s*or\s*$/i.test(gap)) return "it is one of two possible figures, so none is used";
  const parts = PARTS_GAP.exec(gap);
  const smaller = UNIT_AFTER.exec(q.slice(b.end))?.[1];
  // "1 hour 30 minutes": a second number counting a smaller unit than the first continues it.
  if (parts && smaller && (RANK[timeOf(smaller) ?? ""] ?? 99) < (RANK[timeOf(parts[1]!) ?? ""] ?? -1)) return "a duration written in parts (like 1 hour 30 minutes) is not read";
  if (/^\s*$/.test(gap)) return "two numbers in a row are not read";
  return null;
}

const SIGN = /[-−+]$/u;
const NUMBERS_BEFORE = new RegExp(String.raw`(?:${NUMWORD}|hundred|thousand|million|billion)(?:[\s-]+and)?[\s-]+$`, "iu");
/** "in 2027", "by 2030": a year, not an amount. */
const YEAR_AFTER = new RegExp(String.raw`^\s*(?:${TIME_WORD}|[₹£$€¥])`, "iu");
const isYear = (before: string, after: string, raw: string): boolean =>
  /^\d{4}$/.test(raw) && Number(raw) >= 1900 && Number(raw) <= 2100 && YEAR_WORDS.has(tokens(before).at(-1)?.text.toLowerCase() ?? "") && !YEAR_AFTER.test(after);

/** Why one number must not be used, with the stretch of the question to report, or null when it can be read. */
function whyNot(q: string, h: Hit): Skip | null {
  const before = q.slice(0, h.start);
  const after = q.slice(h.end);
  const span = (why: string, from = h.start, to = h.end): Skip => ({ start: from, end: to, why });
  if (SIGN.test(before) && !isLetterOrDigit(before.at(-2))) return span("a signed amount is not read from a question", h.start - 1);
  if (before.endsWith("(") && after.startsWith(")")) return span("a bracketed amount is not read from a question", h.start - 1, h.end + 1);
  for (const [re, why] of [
    [PERCENT, "percentages are not read from a question"],
    [SCALE, "a short or unusual scale word (k, L, cr, hundred …) changes the number, so write it out (5 lakh, 2 million) or write the full figure"],
    [FRACTION, "fractions written in words are not read"],
  ] as const) {
    const m = re.exec(after);
    if (m) return span(why, h.start, h.end + m[0].trimEnd().length);
  }
  if (h.word) { const m = NUMBERS_BEFORE.exec(before); if (m) return span("several number words in a row are not read", m.index); }
  if (!h.symbol && isYear(before, after, h.raw)) return span("it looks like a year, not an amount");
  return null;
}

/** The text between two positions, cut at the first clause end going forward. */
const forward = (q: string, from: number, to: number): string => {
  const seg = q.slice(from, to);
  CLAUSE_END.lastIndex = 0;
  const m = CLAUSE_END.exec(seg);
  return m ? seg.slice(0, m.index) : seg;
};
/** The text between two positions, after the last clause end going backward. */
const backward = (q: string, from: number, to: number): { text: string; start: number } => {
  const seg = q.slice(from, to);
  let cut = 0;
  for (const m of seg.matchAll(CLAUSE_END)) cut = m.index! + m[0].length;
  return { text: seg.slice(cut), start: from + cut };
};

/** What a number measures, from the words around it: its unit of time, its period, the stems that name it, and the words it spans. */
function describe(q: string, h: Hit, floor: number, ceiling: number): { base: string; period: string | null; label: string[]; start: number; end: number } {
  const toks = tokens(forward(q, h.end, ceiling), h.end);
  const used = new Set<number>();
  let base = "";
  let period: string | null = null;
  const slash = /^\s*\/\s*(\p{L}+)/u.exec(q.slice(h.end, ceiling));
  if (slash && timeOf(slash[1]!)) { period = timeOf(slash[1]!); used.add(0); }
  else if (!h.symbol && toks[0] && timeOf(toks[0].text)) { base = timeOf(toks[0].text)!; used.add(0); }
  for (let k = 0; period === null && k < Math.min(toks.length, 6); k++) {
    const w = toks[k]!.text.toLowerCase();
    const t = toks[k + 1] ? timeOf(toks[k + 1]!.text) : null;
    // "per" is always a rate; "a/each/every" only right after the figure ("2 hours a day"), never in "in a week".
    if (t && (w === "per" || (k <= 1 && ["a", "an", "each", "every"].includes(w)))) { period = t; used.add(k); used.add(k + 1); }
    else if (ADVERB[w]) { period = ADVERB[w]!; used.add(k); }
  }
  // Only the first few words after a figure describe it; later words belong to the rest of the sentence.
  const near = toks.slice(0, 6);
  let label = meaningStems(near.filter((_, k) => !used.has(k))).slice(0, 3);
  let start = h.start;
  let end = h.end;
  near.forEach((t, k) => { if (used.has(k) || meaningStems([t]).length || FILLER.has(t.text.toLowerCase())) end = Math.max(end, t.end); });
  if (!label.length) {
    // Nothing after it names it ("two hours daily"): use the words just before it, back to the last clause end.
    const back = backward(q, floor, h.start);
    const bt = tokens(back.text, back.start);
    const named = bt.filter((t) => meaningStems([t]).length > 0).slice(-3);
    label = named.map((t) => stem(t.text)).reverse();
    if (named.length) start = Math.min(start, named[0]!.start);
    const adverb = period === null ? bt.slice(-4).find((t) => ADVERB[t.text.toLowerCase()]) : undefined;
    if (adverb) { period = ADVERB[adverb.text.toLowerCase()]!; start = Math.min(start, adverb.start); }
  }
  return { base, period, label: [...new Set(label)], start, end };
}

// ---------- hedges, lump sums and background (R20A) ----------

const BOUNDARY = String.raw`(^|[^\p{L}\p{N}])`;
const LEAD_MIN = String.raw`at\s+least|no\s+(?:less|fewer)\s+than|not\s+(?:less|fewer)\s+than|more\s+than|greater\s+than|(?:a\s+)?minimum(?:\s+of)?|min\.?|upwards\s+of|in\s+excess\s+of|over|above`;
const LEAD_MAX = String.raw`at\s+most|up\s+to|no\s+more\s+than|not\s+more\s+than|less\s+than|fewer\s+than|lower\s+than|(?:a\s+)?maximum(?:\s+of)?|max\.?|under|below`;
const LEAD_ABOUT = String.raw`approximately|approx\.?|roughly|around|about|nearly|almost|circa|~|≈`;
const lead = (words: string): RegExp => new RegExp(`${BOUNDARY}(${words})\\s*$`, "iu");
const LEADING: readonly (readonly [RegExp, StatedQualifier["kind"]])[] = [[lead(LEAD_MIN), "min"], [lead(LEAD_MAX), "max"], [lead(LEAD_ABOUT), "about"]];
/**
 * What may sit between a figure and a trailing hedge: a few plain words, its unit and its period ("3 hours a day or more",
 * "20 customers or so"). Never a number, punctuation (but one comma) or a word that starts a new clause ("and", "but", "with" …).
 */
const STOPS = "and|but|with|while|instead|than|then|so|because|if|when|versus|vs|whereas|plus|or|rather";
const BETWEEN = String.raw`(?:\s*\/\s*\p{L}+|\s+(?!(?:${STOPS})(?![\p{L}\p{N}]))\p{L}+)`;
// "or more", "or so", "and above" always speak about the number before them. "at least", "at most", "minimum", "maximum" can
// also speak about what follows ("rent, at least in the first year"), so after a figure they count only at the end of a clause.
const TRAILING = new RegExp(
  String.raw`^${BETWEEN}{0,4}\s*,?\s*(?:(or\s+(?:more|above|higher|over|less|fewer|lower|below|so|thereabouts)|and\s+(?:up|above|over|under|below))(?![\p{L}\p{N}])|(at\s+least|at\s+most|minimum|maximum|min|max)(?=\s*(?:[,;.?!:)]|$)))`,
  "iu",
);
const trailingKind = (phrase: string): StatedQualifier["kind"] =>
  /\b(?:so|thereabouts)$/i.test(phrase) ? "about" : /\b(?:less|fewer|lower|below|under|most|max|maximum)$/i.test(phrase) ? "max" : "min";

interface Hedge { readonly qualifier: StatedQualifier; readonly start: number; readonly end: number }
/**
 * A hedge written directly before the figure ("at least ₹35,000", "about 3 hours") or right after it and its unit
 * ("3 hours a day or more"). Words further away never count, and each figure takes only its own: in "about 3 hours a day
 * for 6 months" only the 3 is hedged.
 */
function hedgeOf(q: string, h: Hit): Hedge | null {
  const from = Math.max(0, h.start - 40);
  const before = q.slice(from, h.start);
  let best: Hedge | null = null;
  for (const [re, kind] of LEADING) {
    const m = re.exec(before);
    if (!m) continue;
    const start = from + m.index + m[1]!.length;
    // The earliest phrase wins, so "no more than" is a maximum, not a minimum ("more than").
    if (!best || start < best.start) best = { qualifier: { kind, word: m[2]!.replace(/\s+/g, " ").toLowerCase(), after: false }, start, end: h.end };
  }
  if (best) return best;
  const t = TRAILING.exec(q.slice(h.end, h.end + 80));
  if (!t) return null;
  const word = (t[1] ?? t[2])!.replace(/\s+/g, " ").toLowerCase();
  return { qualifier: { kind: trailingKind(word), word, after: true }, start: h.start, end: h.end + t[0].length };
}

/** A budget, savings, a total, a one-time cost: said once, and not per anything unless the question says so. */
const LUMP = new RegExp(
  `${BOUNDARY}(?:budget|savings?|saved|total|one[\\s-]?time|one[\\s-]?off|front|initial|starting|deposit|advance|loan|funds?|capital|invest(?:ment|ed)?|lump|set[\\s-]?up|down[\\s-]?payment|purchase)(?![\\p{L}\\p{N}])`,
  "iu",
);

/** Sentences of the question, split after . ? ! that is followed by a space and a capital (or the end): "Rs. 500" and "1.5" never split. */
function sentenceSpans(q: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (const m of q.matchAll(/[.!?]+(?=\s+[\p{Lu}"“'‘(\[]|\s*$)/gu)) {
    const end = m.index! + m[0].length;
    out.push({ start: from, end });
    from = end;
  }
  if (from < q.length) out.push({ start: from, end: q.length });
  return out;
}
/** The sentence that asks the question ("What if …", "Should I …", or the one ending in a question mark). */
function askedSentence(q: string, spans: readonly { start: number; end: number }[]): number | null {
  const named = spans.findIndex((s) => /\bwhat\s+(?:if|would|happens|about)\b|\bsuppose\b|\bimagine\b|\bshould\s+i\b|\bhow\s+(?:would|might|much)\b/i.test(q.slice(s.start, s.end)));
  if (named >= 0) return named;
  const marked = spans.findIndex((s) => /\?\s*$/.test(q.slice(s.start, s.end)));
  return marked >= 0 ? marked : null;
}
/** Words that carry no meaning of their own in a clause: ordinals, quantifiers and degree words. */
const LOW_CONTENT = new Set("first last next new old same other another more less each every all any some many much both either neither such own whole".split(" "));
/** The meaning-carrying stems of some text: no function words, fillers, periods, units of time, number words or low-content words. */
const contentStems = (text: string): string[] =>
  [...new Set(tokens(text).filter((t) => { const l = t.text.toLowerCase(); return !FUNCTION_WORDS.has(l) && !FILLER.has(l) && !ADVERB[l] && timeOf(l) === null && !Object.prototype.hasOwnProperty.call(NUMBER_WORDS, l) && !LOW_CONTENT.has(l); }).map((t) => stem(t.text)))];
/** The clause of a sentence a figure sits in: from the last clause end before it to the first one after it, with the figure itself blanked out. */
function clauseOf(q: string, sentence: { start: number; end: number }, h: { start: number; end: number }): string {
  const one = new RegExp(CLAUSE_END.source, "iu");
  const before = q.slice(sentence.start, h.start);
  let from = sentence.start;
  for (const m of before.matchAll(CLAUSE_END)) from = sentence.start + m.index! + m[0].length;
  const rest = q.slice(h.end, sentence.end);
  const cut = one.exec(rest);
  const to = h.end + (cut ? cut.index : rest.length);
  return `${q.slice(from, h.start)} ${q.slice(h.end, to)}`;
}

/** Read the figures out of a question. Never throws; a number that cannot be read safely is reported, not guessed. */
export function readStatedValues(question: string): StatedRead {
  const q = question;
  const { hits, skips } = findNumbers(q);

  // Neighbouring numbers that belong together (a range, a choice, a duration in parts) are skipped as one stretch.
  const grouped = new Set<number>();
  for (let i = 0; i < hits.length; i++) {
    let j = i;
    const why = hits[i + 1] ? pairWhy(q, hits[i]!, hits[i + 1]!) : null;
    if (!why) continue;
    while (hits[j + 1] && pairWhy(q, hits[j]!, hits[j + 1]!)) j++;
    const first = hits[i]!;
    const last = hits[j]!;
    const lead = /\bbetween\s*$/i.exec(q.slice(0, first.start));
    const unit = UNIT_AFTER.exec(q.slice(last.end));
    skips.push({ start: lead ? lead.index : first.start, end: last.end + (unit ? unit[0].length : 0), why });
    for (let k = i; k <= j; k++) grouped.add(k);
    i = j;
  }

  const values: StatedValue[] = [];
  const seen = new Map<string, number>();
  const spans = sentenceSpans(q);
  const asked = askedSentence(q, spans);
  const askedStems = asked === null ? [] : contentStems(q.slice(spans[asked]!.start, spans[asked]!.end));
  hits.forEach((h, i) => {
    if (grouped.has(i)) return;
    const block = whyNot(q, h);
    if (block) { skips.push(block); return; }
    let value: number;
    if (h.word) value = NUMBER_WORDS[h.raw.toLowerCase()]!;
    else {
      // The same policy as a typed amount. The symbol (if any) is passed as the unit so only the digits are judged.
      const parsed = parseNumberInput(`${h.symbol ?? ""}${h.raw}${h.scale ? ` ${h.scale}` : ""}`, h.symbol ?? "");
      if (!parsed.ok) { skips.push({ start: h.start, end: h.end, why: parsed.message.replace(/^“[^”]*”\s*/u, "") }); return; }
      if (parsed.value === null) return;
      value = parsed.value;
    }
    // The words between two figures belong to the one they sit next to: a hedge ("roughly 6 months") is the next figure's, not this one's.
    const before = hits[i - 1];
    const after = hits[i + 1];
    const floor = before ? Math.max(before.end, hedgeOf(q, before)?.end ?? 0) : 0;
    const ceiling = after ? Math.min(after.start, hedgeOf(q, after)?.start ?? after.start) : q.length;
    // A hedge stays with the amount: the quoted words include it, the number is not changed, and it is never exact. A hedge
    // before the figure is read through, so "less than" is not mistaken for the end of the clause that names the figure.
    const hedge = hedgeOf(q, h);
    const d = describe(q, hedge && hedge.start < h.start ? { ...h, start: hedge.start } : h, floor, ceiling);
    const start = hedge ? Math.min(d.start, hedge.start) : d.start;
    const end = hedge ? Math.max(d.end, hedge.end) : d.end;
    const text = q.slice(start, end).replace(/\s+/g, " ").trim();
    const n = (seen.get(text.toLowerCase()) ?? 0) + 1;
    seen.set(text.toLowerCase(), n);
    // What its own clause and sentence say about where it belongs. With no sentence that asks, the whole question is the asked part.
    const at = spans.findIndex((s) => h.start >= s.start && h.start < s.end);
    const sentence = at >= 0 ? spans[at]! : { start: 0, end: q.length };
    const inAsked = asked === null || at === asked;
    const clause = clauseOf(q, sentence, h);
    // The words right before the figure, or before its hedge ("my roughly ₹80,000 …"), within its sentence.
    const prefix = q.slice(sentence.start, hedge && hedge.start < h.start ? hedge.start : h.start);
    const cues = readCues(clause, q.slice(h.end, h.end + 48), inAsked ? null : q.slice(sentence.start, sentence.end), inAsked, contentStems(clause), askedStems, TIME_WORD, prefix);
    values.push({
      id: `${text.toLowerCase()}#${n}`, text, value, currency: h.symbol, base: d.base, period: d.period, label: d.label, inherited: [],
      qualifier: hedge?.qualifier ?? null, lumpSum: LUMP.test(text) || LUMP.test(clause), cues, start, end,
      ...(h.scale ? { scale: { word: h.scale, written: q.slice(h.start, h.end).replace(/\s+/g, " ") } } : {}),
    });
  });

  // "two hours daily instead of one hour": the second figure measures the same thing, so it shares what it does not say.
  const out = [...values];
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!;
    const b = out[i]!;
    if (b.base !== a.base || b.currency !== a.currency || !COMPARES.test(q.slice(a.end, b.start).replace(/\s+/g, " ").trim())) continue;
    const notes: string[] = [];
    let period = b.period;
    let label = b.label;
    if (period === null && a.period !== null) { period = a.period; notes.push(`“per ${a.period}” is taken from “${a.text}”`); }
    if (a.label.length && !label.some((w) => a.label.includes(w))) { label = [...new Set([...a.label, ...label])]; notes.push(`what it measures is taken from “${a.text}”`); }
    out[i] = { ...b, period, label, inherited: notes };
  }
  // One entry per stretch of the question: a number inside a stretch already reported ("1e3", "20-30 hours") adds nothing.
  const ordered = skips.sort((x, y) => x.start - y.start || y.end - x.end);
  const reported: Skip[] = [];
  for (const s of ordered) if (!reported.some((o) => s.start >= o.start && s.end <= o.end)) reported.push(s);
  const unclear = reported.map((s) => ({ text: q.slice(s.start, s.end).replace(/\s+/g, " ").trim(), why: s.why }));
  return { values: out, unclear };
}

// ---------- matching ----------

interface UnitParts { currency: string | null; base: string; period: string | null }
/** A variable's unit as currency, kind of unit and period: "₹ per month" → ₹ / – / month; "hours per day" → – / hour / day. */
function unitParts(unit: string): UnitParts {
  const currency = currencyOf(unit);
  const rest = normalizeUnit(currency ? unit.trim().slice(currency.length) : unit);
  const per = /^(?:(\S+)\s+)?per\s+(\S+)$/.exec(rest);
  if (per) return { currency, base: per[1] ?? "", period: per[2]! };
  return { currency, base: rest, period: null };
}
const labelStems = (label: string): string[] => meaningStems(tokens(label));
const showUnit = (v: ProposalVariable) => (v.unit.trim() ? `“${v.unit.trim()}”` : "no unit");

export type StatedStatus = "clear" | "check" | "unclear";
export interface StatedMatch {
  readonly stated: StatedValue;
  /** The assumption it was matched to (a variable key of the proposal), or null when it needs the user's choice. */
  readonly variable: string | null;
  /** Every assumption whose unit fits, best first: the choices offered when the mapping is corrected. */
  readonly candidates: readonly string[];
  /** clear: pre-selected. check: a likely match with something to read first. unclear: the user chooses. */
  readonly status: StatedStatus;
  /** Plain-words notes, shown beside the figure. */
  readonly notes: readonly string[];
  /** Other figures that fit the same assumption: each then needs a different future. */
  readonly conflictsWith: readonly string[];
  /** The future (index into the proposal's branches) whose NAME says this figure, when exactly one does. */
  readonly future: number | null;
  /** What the question and the draft show about where it belongs (see scope.ts). */
  readonly scope: ScopeBasis;
  /** The futures it is proposed for (null: the user chooses), and why, in plain words. */
  readonly placement: ScopeDecision;
}

/** How a figure written with a scale word was read: "You wrote “₹5 lakh”: read as ₹500,000 (1 lakh is 100,000)." */
function scaleNote(s: StatedValue): string {
  const show = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 20 });
  const word = s.scale!.word.toLowerCase();
  const one = word.endsWith("s") ? word.slice(0, -1) : word;
  return `You wrote “${s.scale!.written}”: read as ${s.currency ?? ""}${show(s.value)} (1 ${one} is ${show(10 ** (SCALE_WORDS[word] ?? 0))}).`;
}

/** What a hedge means, in the user's words, for the note beside the figure. */
function hedgeNote(s: StatedValue): string {
  const q = s.qualifier!;
  // What to do is on the checkbox itself ("Tick to use … as an exact value"); the note says only why it is not ticked.
  if (q.word === "over" || q.word === "under") {
    return `You wrote “${q.word}”, which can mean ${q.word === "over" ? "more" : "less"} than the amount or during it, so it is not read as an exact amount.`;
  }
  const what = q.kind === "min" ? "a lower limit" : q.kind === "max" ? "an upper limit" : "an estimate";
  return `You wrote “${q.word}”: ${what}, not an exact amount.`;
}

/** How one figure fits one assumption: null when their units disagree or nothing ties them together, otherwise what is settled and what is not. `named`: they share words. */
interface Fit { readonly v: ProposalVariable; readonly notes: readonly string[]; readonly settled: boolean; readonly named: boolean; readonly score: number }

function fit(s: StatedValue, v: ProposalVariable, sharedPeriod: string | null): Fit | null {
  const u = unitParts(v.unit);
  // A different currency, kind of unit or period is never bridged.
  if (s.currency && u.currency && s.currency !== u.currency) return null;
  if (s.base && u.base && s.base !== u.base) return null;
  if ((s.currency && u.base) || (s.base && u.currency)) return null;
  if (s.period && u.period && s.period !== u.period) return null;
  // Something missing on one side is said, never filled in.
  const w = labelStems(v.label);
  // "50 customers per day" names its unit with a word, not a symbol: the field's unit word is among the figure's words.
  const unitNamed = !!u.base && !TIME_BASES.has(u.base) && s.label.includes(stem(u.base));
  const notes: string[] = [];
  let settled = true;
  const unsure = (note: string): void => { notes.push(note); settled = false; };
  if (s.currency && !u.currency) unsure(`Your question says ${s.currency}; this field has no currency, so it would be left off.`);
  else if (!s.currency && u.currency) unsure(`Your question gives no currency symbol; this field is in ${showUnit(v)}.`);
  if (s.base && !u.base && !u.currency) unsure(`Your question counts ${s.base}s; this field has ${v.unit.trim() ? showUnit(v) : "no unit"}.`);
  else if (!s.base && !s.currency && u.base && !unitNamed) unsure(`Your question gives no unit; this field is in ${showUnit(v)}.`);
  if (!s.period && u.period) {
    // A period the user did not write beside this amount is never filled in (R20A): "budget of ₹500,000" is not
    // "₹500,000 per month" because the rent is monthly. A lump-sum wording never even borrows one; any other amount may
    // be per period like its neighbours, which is said, and the user ticks it if so.
    if (s.currency && !s.lumpSum && sharedPeriod === u.period) unsure(`Your question gives per ${u.period} for the other amounts, not this one. It may be per ${u.period} too: tick it only if it is.`);
    else unsure(`Your question does not say per ${u.period}; this field is ${showUnit(v)}. Tick it only if the amount is per ${u.period}.`);
  } else if (s.period && !u.period) unsure(`Your question says per ${s.period}; this field has no period.`);
  if (s.qualifier) unsure(hedgeNote(s));
  const shared = s.label.filter((x) => w.includes(x)).length;
  const named = shared >= 2 || (shared > 0 && shared * 2 >= w.length);
  // What ties a figure to an assumption: a shared word; the same unit of time; or, for a money amount with no words of
  // its own ("I'll pay ₹5,000 per month"), the same currency. A money amount whose own words name something else
  // ("₹8,000 rent" when the draft has no rent) is not offered for the nearest money field: that would be a guess.
  const tied = shared > 0 || (s.base !== "" && s.base === u.base) || (s.label.length === 0 && s.currency !== null && s.currency === u.currency);
  if (!tied) return null;
  const exact = (s.currency ?? "") === (u.currency ?? "") && s.base === u.base;
  const score = shared * 10 + (w.length ? (shared / w.length) * 5 : 0) + (exact ? 2 : 0) + (s.period !== null && s.period === u.period ? 1 : 0);
  return { v, notes, settled, named, score };
}

/** The proposal's futures whose names say this figure: "Study two hours daily" for 2, "Keep one hour daily" for 1. */
function futureFor(s: StatedValue, names: readonly (string | null)[]): number | null {
  const words = new Set([String(s.value), ...(WORD_OF[s.value] ? [WORD_OF[s.value]!] : [])]);
  const hits = names.flatMap((n, i) => (n !== null && [...n.toLowerCase().matchAll(/\p{L}+|\d+(?:\.\d+)?/gu)].some((m) => words.has(m[0])) ? [i] : []));
  return hits.length === 1 ? hits[0]! : null;
}

/** Propose where each figure goes in the draft. `keep` says which variables the user kept; `names` are the futures' names (null for a left-out future). */
export function matchStatedValues(read: StatedRead, p: Proposal, keep: readonly boolean[], names: readonly (string | null)[]): StatedMatch[] {
  const variables = p.variables.filter((v, i) => keep[i] !== false && v.kind === "number");
  // A period the question gives for some money amounts is how the others are read when they say none.
  const moneyPeriods = new Set(read.values.filter((s) => s.currency && s.period).map((s) => s.period!));
  const sharedPeriod = moneyPeriods.size === 1 ? [...moneyPeriods][0]! : null;

  // How the futures read (do they do what is asked, or keep things as they are), and which words tell them apart.
  const kept = names.map((n) => n !== null);
  const askedStems = read.values[0]?.cues.askedStems ?? [];
  const roles: FutureRole[] = futureRoles(p.branches, p.variables, kept, new Set(askedStems), stem, contentStems);
  const keptIdx = roles.map((r) => r.index);
  const nameStems = new Map(keptIdx.map((i) => [i, new Set(contentStems(p.branches[i]!.name))]));
  /** The futures whose names share a distinctive word with these stems: a word that some kept names have and others do not. */
  const touching = (stems: readonly string[]): number[] =>
    keptIdx.filter((i) => stems.some((w) => nameStems.get(i)!.has(w) && keptIdx.some((j) => !nameStems.get(j)!.has(w))));
  /** The same, only when they are some of the futures and not all of them. */
  const named = (stems: readonly string[]): number[] | null => {
    const found = touching(stems);
    return found.length > 0 && found.length < keptIdx.length ? found : null;
  };
  const rows = read.values.map((s) => {
    const fits = variables.flatMap((v) => { const f = fit(s, v, sharedPeriod); return f ? [f] : []; }).sort((a, b) => b.score - a.score);
    const named = fits.filter((f) => f.named);
    let chosen: Fit | null = null;
    let ambiguous = false;
    if (named.length > 1 && named[0]!.score - named[1]!.score < 2) ambiguous = true;
    else if (named.length) chosen = named[0]!;
    else if (!s.currency && s.base) {
      // No name in common: a unit of time that only one assumption has is a likely match, but never a clear one.
      const byUnit = fits.filter((f) => unitParts(f.v.unit).base === s.base);
      if (byUnit.length === 1) chosen = byUnit[0]!;
    }
    // Only what the user wrote beside the figure is pre-selected: a period or meaning borrowed from another figure is shown, not trusted.
    const status: StatedStatus = chosen ? (chosen.named && chosen.settled && s.inherited.length === 0 ? "clear" : "check") : "unclear";
    const extra = ambiguous ? ["More than one assumption fits this figure: choose which."] : chosen && !chosen.named ? ["Matched by its unit only; none of its words are in the assumption's name."] : [];
    return { s, fits, chosen, status, extra };
  });

  const byVariable = new Map<string, string[]>();
  for (const r of rows) if (r.chosen) byVariable.set(r.chosen.v.key, [...(byVariable.get(r.chosen.v.key) ?? []), r.s.id]);
  // When the question compares figures for one assumption, its other figures are the same in each of the compared futures.
  const compares = [...byVariable.values()].some((ids) => ids.length > 1);
  const ties = rows.map((r) => named(r.s.cues.stems));
  const competing = rows.map((r) => (r.chosen ? (byVariable.get(r.chosen.v.key) ?? []).length > 1 : false));
  return rows.map(({ s, fits, chosen, status, extra }, at) => {
    const mates = chosen ? (byVariable.get(chosen.v.key) ?? []).filter((id) => id !== s.id) : [];
    const notes = [...(s.scale ? [scaleNote(s)] : []), ...(chosen?.notes ?? []), ...extra, ...s.inherited];
    if (s.inherited.length) notes.push("Part of this was taken from another figure, so it is used only if you tick it.");
    if (mates.length) notes.push("Another figure fits this assumption too, so each goes in a different future.");
    // Figures that compete for one assumption are placed by the number in a future's name; every other figure by what its own words and the draft show.
    const future = mates.length ? futureFor(s, names) : null;
    const tiesElsewhere = ties.some((t, j) => j !== at && t !== null && !competing[j]);
    const placement: ScopeDecision = mates.length
      ? { basis: "competing", futures: future === null ? null : [future], why: "", except: [] }
      : decideScope(s.cues, { tie: ties[at]!, touches: touching(s.cues.stems), anaphor: s.cues.deictic ? named(askedStems) : null, compares, tiesElsewhere }, roles);
    const scope: ScopeBasis = placement.basis;
    return {
      stated: s, variable: chosen?.v.key ?? null, candidates: fits.map((f) => f.v.key), status, notes: [...new Set(notes)], conflictsWith: mates,
      // Only a figure that competes with another for the same assumption is placed by a future's name: otherwise the name
      // ("Study two hours daily") might be a coincidence, and a single figure follows the future the user opens.
      future,
      scope,
      placement,
    };
  });
}

// ---------- the user's choices ----------

/**
 * Where a figure goes: the future the user opens, every future in the draft, one future or several (by index, ascending,
 * at least two for several), or nowhere yet.
 */
export type FigureTarget = "open" | "all" | number | readonly number[] | "none";
/** The futures a target names, when it names them itself (not "open", which follows the card pressed, and not "all"). */
const members = (t: FigureTarget): readonly number[] => (typeof t === "number" ? [t] : Array.isArray(t) ? (t as readonly number[]) : []);
/** The same place, whichever way it is written. */
export const sameTarget = (a: FigureTarget | undefined, b: FigureTarget | undefined): boolean =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === (b as readonly number[])[i]));
/** A decision about futures as a target: every kept future is "all", one is its index, several are a list, none is "none". */
const toTarget = (futures: readonly number[] | null, kept: readonly number[]): FigureTarget =>
  futures === null ? "none" : futures.length === kept.length && kept.every((i) => futures.includes(i)) ? "all" : futures.length === 1 ? futures[0]! : [...futures];
/** What the user changed about one figure; anything not set follows the proposal. */
export interface FigureChoice { readonly use?: boolean; readonly variable?: string | null; readonly target?: FigureTarget }
export interface FigureRow extends StatedMatch {
  /** The assumption in use after the user's choice. */
  readonly chosenVariable: string | null;
  readonly use: boolean;
  readonly target: FigureTarget;
  /** Set when this row cannot be used as it stands (no assumption, no future, or it collides with another row). */
  readonly blocked: string | null;
  /** Where it goes now, in plain words ("Used in every future in the draft (2).", "Used only in “Open the bookstore”."). Empty with one future. */
  readonly scopeText: string;
  /** Why it was proposed there; null when it is somewhere else (the user chose another place) or the reason is in another note. */
  readonly scopeWhy: string | null;
  /** Offered, but no future is chosen for it and the user has not ticked or unticked it: it will not be used unless they choose. */
  readonly unplaced: boolean;
}
export interface FigurePlan {
  /** Figures that fit at least one assumption in the draft. */
  readonly rows: readonly FigureRow[];
  /** Numbers that were not used, with the reason: unreadable ones, and figures no assumption in the draft fits. */
  readonly unused: readonly StatedUnclear[];
  /** Why the ticked figures cannot all be used together, or null. */
  readonly problem: string | null;
  /** True when there is something worth showing for confirmation. */
  readonly offer: boolean;
  /** True when something is ticked and nothing is in the way. */
  readonly ready: boolean;
  /** Offered figures that have no future yet. Confirming leaves them out, so it is said before, not after. */
  readonly unplaced: readonly FigureRow[];
  /** The plain-words warning about `unplaced`, or null. */
  readonly warning: string | null;
}

const overlap = (a: FigureTarget, b: FigureTarget) => a === "all" || b === "all" || a === "open" || b === "open" || members(a).some((i) => members(b).includes(i));

/** The figures of a question, their proposed places, and the user's choices applied. Pure: the same inputs give the same plan. */
export function figurePlan(question: string, p: Proposal, sel: ProposalSelection, choices: Readonly<Record<string, FigureChoice>> = {}): FigurePlan {
  const read = readStatedValues(question);
  const names = p.branches.map((b, i) => (sel.branches[i] === false ? null : b.name));
  const matches = matchStatedValues(read, p, sel.variables, names);
  const kept = new Set(p.variables.filter((_, i) => sel.variables[i] !== false).map((v) => v.key));
  const fitting = matches.filter((m) => m.candidates.length > 0);
  const keptIdx = names.flatMap((n, i) => (n !== null ? [i] : []));
  const futuresKept = keptIdx.length;
  const rows: FigureRow[] = fitting.map((m) => {
    const c = choices[m.stated.id] ?? {};
    const chosenVariable = c.variable !== undefined ? (c.variable !== null && kept.has(c.variable) ? c.variable : null) : m.variable;
    // Where the question and the draft show it belongs (scope.ts); the user's choice replaces it. When they do not show it, nothing is ticked.
    const defaultTarget: FigureTarget = toTarget(m.placement.futures, keptIdx);
    const target = c.target ?? defaultTarget;
    // Ticked for the user only when nothing else is open: the amount reads clearly and a future is settled, either by the
    // draft or by the user choosing one (that choice is the confirmation the row was waiting for). A hedge, a missing
    // period or currency still needs the tick itself, and an explicit untick always wins.
    const placedByUser = c.target !== undefined && c.target !== "none";
    const use = c.use ?? (m.status === "clear" && (m.placement.futures !== null || placedByUser));
    const unplaced = target === "none" && chosenVariable !== null && c.use === undefined;
    return {
      ...m, chosenVariable, use, target, blocked: null, unplaced,
      scopeText: scopeSentence(target, names, futuresKept, sameTarget(target, defaultTarget) ? m.placement.except : []),
      scopeWhy: sameTarget(target, defaultTarget) && m.placement.why ? m.placement.why : null,
    };
  });
  // Rows that collide: two ticked figures for one assumption in overlapping futures.
  let problem: string | null = null;
  const withBlock = rows.map((r, i) => {
    if (!r.use) return r;
    if (!r.chosenVariable) return { ...r, blocked: "Choose which assumption this is." };
    if (r.target === "none") return { ...r, blocked: "Choose where to use it." };
    // A figure for a future that is not in the draft is never dropped quietly: the user picks another place or unticks it.
    if (members(r.target).some((i) => names[i] == null)) return { ...r, blocked: "That future is left out of the draft." };
    const clash = rows.find((o, j) => j !== i && o.use && o.chosenVariable === r.chosenVariable && o.target !== "none" && overlap(o.target, r.target));
    if (clash) {
      const label = p.variables.find((v) => v.key === r.chosenVariable)?.label ?? r.chosenVariable;
      problem ??= `Two figures are set for “${label}” in the same future. Give each its own future, or untick one.`;
      return { ...r, blocked: "Another ticked figure uses the same assumption in the same future." };
    }
    return r;
  });
  // A figure no number assumption can hold. If the draft keeps the same idea as a choice ("Daily study time: one / two"),
  // say so: the number is not lost, the draft just represents it differently, and nothing is forced into a number field.
  const asChoice = (s: StatedValue): string => {
    const hit = p.variables.find((v, i) => sel.variables[i] !== false && v.kind !== "number" && labelStems(v.label).some((w) => s.label.includes(w)));
    return hit ? `; “${hit.label}” is a choice in this draft, not a number` : "";
  };
  const unused: StatedUnclear[] = [
    ...read.unclear,
    ...matches.filter((m) => m.candidates.length === 0).map((m) => ({ text: m.stated.text, why: `none of this draft's number assumptions fits it${asChoice(m.stated)}` })),
  ];
  const used = withBlock.filter((r) => r.use);
  // An offered figure with no future would be left out when the user confirms. Said now, never found out afterwards.
  const unplaced = withBlock.filter((r) => r.unplaced);
  const warning = unplaced.length === 0 ? null
    : unplaced.length === 1 ? `“${unplaced[0]!.stated.text}” has no future yet, so it will not be used unless you choose one.`
    : `${unplaced.length} figures have no future yet, so they will not be used unless you choose one: ${unplaced.map((r) => `“${r.stated.text}”`).join(", ")}.`;
  return { rows: withBlock, unused, problem, offer: withBlock.length > 0, ready: used.length > 0 && used.every((r) => r.blocked === null), unplaced, warning };
}

/** Where a figure goes, in plain words. Empty when there is only one future (nothing to choose between) or none is chosen yet. */
function scopeSentence(target: FigureTarget, names: readonly (string | null)[], futuresKept: number, except: readonly string[] = []): string {
  if (futuresKept < 2 || target === "none") return "";
  if (target === "all") return `Used in every future in the draft (${futuresKept}).`;
  if (target === "open") return "Used in the future you open.";
  const named = members(target).map((i) => names[i]);
  if (named.some((n) => !n)) return "That future is left out of the draft.";
  if (named.length === 1) return `Used only in “${named[0]}”.`;
  if (except.length > 0) return `Used in every future except ${except.map((n) => `“${n}”`).join(" and ")}.`;
  return `Used in ${named.slice(0, -1).map((n) => `“${n}”`).join(", ")} and “${named.at(-1)}”.`;
}

/**
 * The ticked figures as values to set, once the user has confirmed them. `focus` is the future they are about to open
 * (an index into the proposal's futures; "the future I open" means exactly that one), `included` says which futures
 * the map will have. A figure whose future is not in the map is dropped, never moved. Nothing at all unless the plan
 * is `ready`.
 */
export function appliedFigures(plan: FigurePlan, focus: number | undefined, included: readonly boolean[]): AppliedFigure[] {
  const out: AppliedFigure[] = [];
  // A plan with a collision or a missing choice is applied as a whole or not at all: never a half of what was confirmed.
  if (!plan.ready) return out;
  for (const r of plan.rows) {
    if (!r.use || r.blocked || !r.chosenVariable) continue;
    const futures = r.target === "open" ? (focus === undefined ? [] : [focus]) : r.target === "all" ? included.flatMap((k, i) => (k ? [i] : [])) : members(r.target);
    for (const f of futures) if (included[f]) out.push({ variable: r.chosenVariable, value: r.stated.value, text: r.stated.text, future: f });
  }
  return out;
}

// ---------- an edited question ----------

export interface CarriedFigures {
  /** The user's choices, re-keyed to the figures of the new wording. */
  readonly choices: Readonly<Record<string, FigureChoice>>;
  /** Plain-words lines for the screen: what was kept for a figure whose number changed, and what could not be kept. */
  readonly notes: readonly string[];
}

/** What a figure means apart from its number: the same unit, period, hedge, place in the question and words. */
const meaning = (s: StatedValue): string =>
  [
    s.currency ?? "", s.base, s.period ?? "", s.qualifier?.kind ?? "", s.label.join(","),
    // What decides which futures it belongs to: if these words change, an earlier choice of place is no longer about the same statement.
    s.cues.asked ? "asked" : "apart", s.cues.deictic ?? "", s.cues.current ?? "", s.cues.expected ?? "", s.cues.personal ? "mine" : "", s.cues.calendar ? "dated" : "", s.cues.own ?? "", s.cues.stems.join(","),
  ].join("|");
/** The numbers a future's name says ("Study 3 hours daily", "Keep one hour daily"). */
const numbersIn = (name: string): number[] =>
  [...name.toLowerCase().matchAll(/\d+(?:\.\d+)?|\p{L}+/gu)].flatMap((m) => {
    if (/^\d/.test(m[0])) return [Number(m[0])];
    return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, m[0]) ? [NUMBER_WORDS[m[0]]!] : [];
  });

/**
 * The user's choices about figures, carried over to an edited question (R20A, "Edit my question").
 *
 * A figure of the old wording and one of the new wording are the same figure when everything but the number is the
 * same: its unit, period, hedge, the place it sits in the question and the words that name it (and, among several
 * with the same meaning, their order). Their choices follow it: the tick, the assumption and the future.
 *
 * What counts as a choice (R20A.1). A confirmed plan stores every row as resolved, including values that only repeat
 * what the draft proposed. Those are not the user's decisions: if the new wording proposes something else (the question
 * that asks changed, so "there" points somewhere else; the numbers were swapped, so the names point the other way), the
 * stored place or tick follows the new wording and the row says so, instead of an old proposal being replayed as if the
 * user had chosen it. What differs from the proposal is the user's and stays. An untick is always kept: carrying it can
 * only use fewer figures, never more. A place that only the number decided ("the future whose name says 3") is the one
 * exception: it is kept as it was shown when the new wording says nothing, so changing the number does not quietly
 * empty it.
 *
 * Nothing is carried to a figure that means something else now; that is said, never dropped silently. A figure that was
 * in use and now goes somewhere else, or nowhere yet, is said too. Confirmation is not carried: the number or the
 * wording changed, so the user confirms it again.
 */
export function carryFigureChoices(
  oldQuestion: string, newQuestion: string, p: Proposal, sel: ProposalSelection, choices: Readonly<Record<string, FigureChoice>>,
): CarriedFigures {
  if (oldQuestion === newQuestion) return { choices: { ...choices }, notes: [] };
  const before = figurePlan(oldQuestion, p, sel, choices);
  /** What the earlier wording proposed on its own: a stored value equal to this was not necessarily decided by the user. */
  const proposedBefore = new Map(figurePlan(oldQuestion, p, sel, {}).rows.map((r) => [r.stated.id, r]));
  const after = figurePlan(newQuestion, p, sel, {});
  const quoted = (i: number): string => `“${p.branches[i]?.name ?? `future ${i + 1}`}”`;
  const placeText = (t: FigureTarget): string => {
    if (t === "all") return "every future";
    if (t === "open") return "the future you open";
    const named = members(t).map(quoted);
    return named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : (named[0] ?? "no future yet");
  };
  const group = (list: readonly StatedValue[]): Map<string, StatedValue[]> => {
    const by = new Map<string, StatedValue[]>();
    for (const s of list) by.set(meaning(s), [...(by.get(meaning(s)) ?? []), s]);
    return by;
  };
  const newBy = group(readStatedValues(newQuestion).values);
  const mateOf = new Map<string, StatedValue>();
  for (const [key, olds] of group(readStatedValues(oldQuestion).values)) olds.forEach((o, i) => { const n = newBy.get(key)?.[i]; if (n) mateOf.set(o.id, n); });

  const out: Record<string, FigureChoice> = {};
  const notes: string[] = [];
  for (const row of before.rows) {
    const mate = mateOf.get(row.stated.id);
    const explicit = choices[row.stated.id];
    // Only what the user decided is theirs to lose (a confirmed plan stores every row's choice, so all of those count).
    const decided = explicit !== undefined && Object.keys(explicit).length > 0;
    const now = mate ? after.rows.find((r) => r.stated.id === mate.id) : undefined;
    if (!mate || !now) {
      if (decided) notes.push(`Not kept: your choice for “${row.stated.text}”. ${mate ? `“${mate.text}” does not fit an assumption in the draft.` : "That figure now means something else, or is no longer in your question."}`);
      continue;
    }
    const carried: { use?: boolean; variable?: string | null; target?: FigureTarget } = { ...explicit };
    // A stored value that only repeats what the earlier wording proposed is not a decision. When the new wording proposes
    // something else for it, the new wording wins; the user is told if that moves a figure they were using.
    const proposed = proposedBefore.get(row.stated.id);
    // Figures that compete for one assumption are placed by the number in a future's name. When the new number is in no
    // name ("2 hours" with futures named for 3 and 1), the place is kept as it was shown: the number changed, the choice
    // did not. When a name does say the new number, the name wins over the old place, so numbers that were swapped do
    // not leave each one in the other's future.
    const keepsShown = row.scope === "competing" && now.scope === "competing" && now.target === "none" && row.target !== "none";
    const staleTarget = !keepsShown && carried.target !== undefined && proposed !== undefined && sameTarget(carried.target, proposed.target) && !sameTarget(now.target, carried.target);
    // A tick that repeats the old proposal is dropped only if the new wording would not tick it (a hedge, or no place yet):
    // it is never taken as consent to a different statement.
    const staleTick = !keepsShown && carried.use === true && proposed !== undefined && proposed.use && !now.use;
    if (staleTarget) delete carried.target;
    if (staleTick) delete carried.use;
    if (keepsShown && carried.target === undefined) {
      carried.target = row.target;
      if (carried.use === undefined && row.use) carried.use = true;
    }
    if (Object.keys(carried).length > 0) out[mate.id] = carried;
    // Where the figure goes now. A figure that was in use and moves is said, not left to be noticed.
    const goesTo = carried.target ?? now.target;
    const moved = row.use && (staleTarget || staleTick) && !sameTarget(goesTo, row.target);
    if (moved) {
      const figure = mate.text === row.stated.text ? `“${mate.text}”` : `“${mate.text}” (it was “${row.stated.text}”)`;
      notes.push(
        goesTo === "none"
          ? `Needs your choice: ${figure} was used in ${placeText(row.target)}, but your new wording does not say where it holds. Choose a future for it.`
          : `Changed: ${figure} was used in ${placeText(row.target)}; with your new wording it goes in ${placeText(goesTo)}. Check that this is right.`,
      );
    }
    if (Object.keys(carried).length === 0 || mate.value === row.stated.value) continue;
    const place = typeof goesTo === "number" ? p.branches[goesTo]?.name : undefined;
    // A figure that moved has just been described; one that stayed is told what was kept.
    if (!moved) {
      const where = place ? ` It goes in “${place}”.` : goesTo === "all" ? " It goes in every future." : goesTo === "open" ? " It goes in the future you open." : "";
      notes.push(`Kept your choices for “${mate.text}” (it was “${row.stated.text}”).${where}`);
    }
    const said = place ? numbersIn(place) : [];
    if (place && said.length > 0 && !said.includes(mate.value)) {
      notes.push(`The name “${place}” was written for the earlier number. Check that it still fits, or ask for possibilities that match your new wording.`);
    }
  }
  return { choices: out, notes };
}

/** A note for a question card: the question gave a currency for this assumption but the field has none. Null when nothing is wrong. */
export function currencyHint(question: string, label: string, unit: string): string | null {
  if (currencyOf(unit)) return null;
  const words = labelStems(label);
  const hit = readStatedValues(question).values.find((s) => s.currency && s.label.some((w) => words.includes(w)));
  return hit ? `Your question says ${hit.currency} here (“${hit.text}”). This field has no currency, so enter just the number.` : null;
}
