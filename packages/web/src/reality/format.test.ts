/**
 * Display and input rules. R18: values keep their currency and period, typed amounts may carry the unit's own currency
 * symbol, mismatched units show no number. R18.1: a typed amount is never silently read as a different magnitude; a
 * change the user is exploring is worded apart from a fact; the caption over possibilities says only what is recorded.
 */
import { describe, expect, it } from "vitest";
import { changeCaption, currencyOf, factChangeLine, MAX_AMOUNT, parseNumberInput, possibilityCaption, possibilityTag, showAssumption, showOption, showOutcome, showResult, signed, toldLine, withUnit } from "./format";

describe("product sprint: a choice the AI wrote as a code identifier is shown in words", () => {
  it("camelCase and snake_case identifiers read as words; the stored value is not touched", () => {
    // Option values from the recorded live drafts of the sprint (café, moving abroad, self-study).
    for (const [raw, shown] of [["fullTime", "full time"], ["partTime", "part time"], ["newCountry", "new country"], ["currentCountry", "current country"], ["selfStudy", "self study"], ["self_study", "self study"], ["full_time_job", "full time job"]] as const) {
      expect(showOption(raw), raw).toBe(shown);
      expect(showAssumption(raw), raw).toBe(shown);
    }
    expect(changeCaption({ changes: [{ label: "Café operating mode", unit: "", to: "fullTime" }], told: [] }, false)).toBe("Café operating mode: full time");
  });

  it("plain words, names, brands and anything that is not an identifier are shown exactly as written", () => {
    for (const v of ["London", "physical shop", "online first", "none", "urban", "iPhone", "eBay", "macOS", "A1", "COVID", "NASA", "e-commerce", "self-study", "McDonald's", "LinkedIn", "x", ""]) {
      expect(showOption(v), v).toBe(v);
    }
  });
});

describe("amounts with their currency and period", () => {
  it("puts a leading currency symbol before the number and keeps the rest of the unit", () => {
    expect(showAssumption(1500, "£ per month")).toBe("£1,500 per month");
    expect(showAssumption(8000, "₹ per month")).toBe("₹8,000 per month");
    expect(showAssumption(2500, "€ per month")).toBe("€2,500 per month");
    expect(showAssumption(12, "$ per hour")).toBe("$12 per hour");
    expect(showAssumption(36, "£")).toBe("£36");
    expect(showAssumption(1500, "£/month")).toBe("£1,500/month");
    expect(showAssumption(-500, "£ per month")).toBe("-£500 per month");
    expect(showAssumption(0.28, "£ per kWh")).toBe("£0.28 per kWh");
  });

  it("leaves every other unit after the number, and a missing unit missing", () => {
    expect(showAssumption(40, "minutes")).toBe("40 minutes");
    expect(showAssumption(12, "hours per week")).toBe("12 hours per week");
    expect(showAssumption(4000, "per month")).toBe("4,000 per month");
    expect(showAssumption(8000, "INR per month")).toBe("8,000 INR per month");
    expect(showAssumption(1200, "")).toBe("1,200");
    expect(showAssumption(null, "£")).toBe("unknown");
    expect(withUnit(Number.NaN, "£")).toBe("n/a");
    expect(currencyOf("per month")).toBeNull();
    expect(currencyOf(" ₹ per month")).toBe("₹");
  });

  it("signs differences in the same format", () => {
    expect(signed(300, "£ per month")).toBe("+£300 per month");
    expect(signed(-300, "£ per month")).toBe("−£300 per month");
    expect(signed(0, "£")).toBe("±£0");
    expect(signed(1000, "per month")).toBe("+1,000 per month");
    expect(signed(950, "")).toBe("+950");
  });

  it("shows no number when an outcome adds or subtracts different units, and says why", () => {
    const ok = { status: "ok", value: 1540 } as const;
    expect(showOutcome({ status: "mixed", unit: "", units: ["£ per month", "minutes"] }, ok)).toBe("units don't match (£ per month, minutes)");
    expect(showOutcome({ status: "derived", unit: "₹ per month" }, { status: "ok", value: 8000 })).toBe("₹8,000 per month");
    expect(showOutcome({ status: "unknown", unit: "" }, ok)).toBe("1,540");
    expect(showOutcome({ status: "mixed", unit: "", units: ["a", "b"] }, { status: "missing", missing: ["Rent"] })).toBe("Needs: Rent");
    expect(showResult({ status: "ok", value: true }, "£")).toBe("yes");
  });
});

/** value: the number that must be stored; "refused": nothing is stored and a reason is shown. */
type Case = readonly [typed: string, unit: string, expected: number | null | "refused", reason?: RegExp];

const MATRIX: readonly Case[] = [
  // separators: only a reading that cannot be mistaken is accepted
  ["1,5", "£ per month", "refused", /comma that does not separate thousands.*1\.5/],
  ["1.5", "£ per month", 1.5],
  ["1,500", "£ per month", 1500],
  ["1.500", "£ per month", "refused", /could mean 1\.5 or 1500/],
  ["2.500", "£", "refused", /could mean 2\.5 or 2500/],
  ["10.250", "£", "refused", /could mean 10\.25 or 10250/],
  ["0.500", "£", 0.5],
  ["0,285", "£ per kWh", "refused", /If you meant 0\.285/],
  ["0.285", "£ per kWh", 0.285],
  ["1234.567", "£", 1234.567],
  ["1,234,567.5", "£", 1234567.5],
  ["1,500.250", "£", 1500.25],
  ["1,00,000", "₹ per month", 100000],
  ["12,34,567", "₹ per month", 1234567],
  ["2 500", "£", 2500],
  ["1 234 567", "£", 1234567],
  ["2 50", "£", "refused", /isn't a number/],
  ["1.200,50", "€", "refused", /European number formatting.*1200\.50/],
  ["1.200.300", "€", "refused", /dots to group thousands.*1200300/],
  ["12,345,67", "£", "refused", /comma/],
  ["1,2345", "£", "refused", /comma/],
  ["1,5.5", "£", "refused", /comma/],
  ["01,500", "£", "refused", /comma/],
  // currencies: the field's own symbol, before or after; never another; never on a unit without one
  ["€2.500", "€ per month", "refused", /could mean 2\.5 or 2500/],
  ["€2,500", "€ per month", 2500],
  ["2,500 €", "€ per month", 2500],
  ["20 €", "€ per month", 20],
  ["₹20,000", "₹ per month", 20000],
  ["₹ 20,000", "₹ per month", 20000],
  ["$8,000", "₹ per month", "refused", /This is in ₹ per month/],
  ["₹8,000", "per month", "refused", /has no currency/],
  ["£5", "", "refused", /has no currency/],
  ["₹", "₹ per month", "refused", /isn't a number/],
  ["₹20,000₹", "₹ per month", "refused", /isn't a number/],
  // signs and zero
  ["-300", "£", -300],
  ["−300", "£", -300],
  ["+300", "£", 300],
  ["-£300", "£ per month", -300],
  ["£-300", "£ per month", -300],
  ["-1,500", "£", -1500],
  ["0", "£", 0],
  ["0.0", "£", 0],
  ["-0", "£", 0],
  ["000", "£", 0],
  ["007", "£", 7],
  // empty is "unknown"; letters and other punctuation are refused
  ["", "£", null],
  ["   ", "£", null],
  ["abc", "£", "refused", /isn't a number/],
  ["12abc", "£", "refused", /isn't a number/],
  ["1e3", "£", "refused", /isn't a number/],
  ["Infinity", "£", "refused", /isn't a number/],
  ["NaN", "£", "refused", /isn't a number/],
  ["(300)", "£", "refused", /isn't a number/],
  ["50%", "%", "refused", /isn't a number/],
  [".", "£", "refused", /isn't a number/],
  ["1..5", "£", "refused", /isn't a number/],
  ["1.2.3", "£", "refused", /isn't a number/],
  // spellings of an amount the parser does not read: refused with a message, never guessed (documented limitation)
  ["Rs. 500", "₹ per month", "refused", /isn't a number/],
  ["Rs 500", "₹ per month", "refused", /isn't a number/],
  ["INR 500", "₹ per month", "refused", /isn't a number/],
  ["500 INR", "₹ per month", "refused", /isn't a number/],
  ["5e3", "£", "refused", /isn't a number/],
  ["50 %", "per cent", "refused", /isn't a number/],
  ["1_000", "£", "refused", /isn't a number/],
  ["1'000", "£", "refused", /isn't a number/],
  ["٣٠٠", "£", "refused", /isn't a number/],
  // Unicode compatibility forms are normalised first, so full-width digits read as the digits they are
  ["１２３", "£", 123],
  ["１，５００", "£", 1500],
  ["999,999,999,999,999", "£", 999999999999999],
  // very large values
  ["999999999999999", "£", 999999999999999],
  ["1000000000000000", "£", "refused", /larger than RealityFork can calculate/],
  ["1,000,000,000,000,000", "£", "refused", /larger than RealityFork can calculate/],
  ["999999999999999999999", "£", "refused", /larger than RealityFork can calculate/],
  ["9".repeat(400), "£", "refused", /larger than RealityFork can calculate/],
];

describe("typed amounts: the stored value is exactly what was written, or nothing is stored", () => {
  for (const [typed, unit, expected, reason] of MATRIX) {
    it(`${JSON.stringify(typed.length > 30 ? `${typed.slice(0, 12)}…(${typed.length} digits)` : typed)} in “${unit}” → ${expected === "refused" ? "refused" : expected}`, () => {
      const r = parseNumberInput(typed, unit);
      if (expected === "refused") {
        expect(r.ok).toBe(false);
        if (!r.ok && reason) expect(r.message).toMatch(reason);
      } else {
        expect(r).toEqual({ ok: true, value: expected });
        if (typeof expected === "number") expect(Object.is((r as { value: number }).value, -0)).toBe(false);
      }
    });
  }

  it("never returns a number for an input whose magnitude depends on the writer's country", () => {
    for (const typed of ["1.500", "2.500", "10.250", "100.000", "1,5", "0,285", "1.200,50", "12,5"]) expect(parseNumberInput(typed, "£").ok, typed).toBe(false);
  });

  it("every accepted input is within the limit and finite", () => {
    for (const [typed, unit, expected] of MATRIX) {
      if (typeof expected !== "number") continue;
      const r = parseNumberInput(typed, unit);
      expect(r.ok && r.value !== null && Number.isFinite(r.value) && Math.abs(r.value) < MAX_AMOUNT, typed).toBe(true);
    }
  });

  it("a refusal always says what to type instead", () => {
    for (const typed of ["1,5", "1.500", "€2.500", "1.200,50", "abc", "1000000000000000"]) {
      const r = parseNumberInput(typed, typed.startsWith("€") ? "€ per month" : "£");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(30);
    }
  });
});

describe("captions and wording", () => {
  const exploring = { question: "What is different on this path?", from: null, to: "I split the two hours into four sessions." };
  const told = { question: "", from: null, to: "Exams are held in the main hall" };

  it("a change being explored reads as a what-if; something the user told us reads as a fact", () => {
    expect(changeCaption({ changes: [], told: [exploring] }, false)).toBe("Exploring: I split the two hours into four sessions.");
    expect(changeCaption({ changes: [], told: [told] }, false)).toBe("You told us: Exams are held in the main hall");
    expect(changeCaption({ changes: [{ label: "Rent", unit: "£ per month", to: 1200 }], told: [exploring] }, false)).toBe("Rent: £1,200 per month · Exploring: I split the two hours into four sessions.");
    expect(changeCaption({ changes: [], told: [] }, false)).toBe("Nothing changed yet");
    expect(changeCaption({ changes: [], told: [exploring] }, true)).toBe("Where you start");
  });

  it("a word that is on the parent but not here is not described as a removal", () => {
    expect(toldLine({ question: "", from: "Old fact", to: null })).toBe("Not on this path: Old fact");
    expect(toldLine({ question: "What is different on this path?", from: "A change", to: null })).toBe("Change not applied here: A change");
    expect(changeCaption({ changes: [], told: [{ question: "", from: "Old fact", to: null }] }, false)).toBe("Not on this path: Old fact");
  });

  it("edits over time keep the same distinction", () => {
    expect(factChangeLine({ question: "", from: null, to: "x" })).toBe("You told us: x");
    expect(factChangeLine({ question: "", from: "x", to: "y" })).toBe("Now: y (was x)");
    expect(factChangeLine({ question: "", from: "x", to: null })).toBe("No longer noted: x");
    const q = "What is different on this path?";
    expect(factChangeLine({ question: q, from: null, to: "x" })).toBe("Exploring: x");
    expect(factChangeLine({ question: q, from: "x", to: "y" })).toBe("Exploring: y (was x)");
    expect(factChangeLine({ question: q, from: "x", to: null })).toBe("No longer exploring: x");
  });

  it("the caption over possibilities names an author only as far as it is recorded", () => {
    expect(possibilityCaption([])).toBe("Possibilities you add, not predictions");
    expect(possibilityCaption(["user"])).toBe("Your own possibilities, not predictions");
    expect(possibilityCaption(["user", "user"])).toBe("Your own possibilities, not predictions");
    expect(possibilityCaption(["ai", "ai"])).toBe("AI-suggested possibilities, not predictions");
    expect(possibilityCaption(["example", "example"])).toBe("Possibilities that came with this example, not predictions");
    expect(possibilityCaption(["unrecorded"])).toBe("Possibilities (who wrote them was not recorded), not predictions");
    expect(possibilityCaption(["ai", "user"])).toBe("AI-suggested and your own possibilities, not predictions");
    expect(possibilityCaption(["example", "user"])).toBe("Possibilities from more than one source (marked on each), not predictions");
    expect(possibilityCaption(["unrecorded", "user"])).toBe("Possibilities from more than one source (marked on each), not predictions");
    // Nothing that is not recorded as the user's is ever captioned as theirs.
    for (const mix of [["example"], ["unrecorded"], ["ai"], ["example", "unrecorded"], ["ai", "example"]] as const) expect(possibilityCaption(mix)).not.toMatch(/^Your own/);
  });

  it("each origin has its own tag", () => {
    expect(["user", "example", "ai", "unrecorded"].map((o) => possibilityTag(o as never))).toEqual(["written by you", "from the example", "suggested by the AI", "origin not recorded"]);
  });
});
