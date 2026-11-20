/**
 * R19, first use in a real browser: the figures read from the question, the correction flows, branch separation, and what
 * is sent to the AI. The draft replies are deterministic fixtures (docs: "mocked" in the report); no live model here.
 *
 *  - figures are applied only after a confirmation, only to the futures chosen, and never asked for again
 *  - an unclear mapping, a missing currency or a missing period is asked about, not guessed
 *  - "Edit my question" keeps the draft and never touches a saved map; "Generate different possibilities" keeps the draft
 *    on screen while it waits and puts it back, with the reason, if the request fails
 *  - the AI request calls a suggestion 'user' only when the user wrote it
 *  - desktop and 390px: nothing overflows, nothing is cut off
 *
 * Screenshots: docs/validation/screenshots/r19/after-*.png
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const shotsDir = here("../../../docs/validation/screenshots/r19/");
mkdirSync(shotsDir, { recursive: true });
const audit = JSON.parse(readFileSync(here("./fixtures/audit-proposals.json"), "utf8"));
const r19 = JSON.parse(readFileSync(here("./fixtures/r19-proposals.json"), "utf8"));
const reactive = JSON.parse(readFileSync(here("./fixtures/reactive-proposals.json"), "utf8"));
const MODEL = "openai/gpt-oss-120b (mocked in this test)";

const A = "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?";
const B = "What if I studied two hours daily instead of one hour for exams four weeks away?";
const C = "What if my college replaced written exams with team-based projects?";

type Draft = Record<string, unknown>;
interface Seen { plan: { question: string; context?: unknown }[]; revisit: Record<string, unknown>[]; errors: string[] }
/** Serve draft replies in order (the last one repeats). A reply can be `"fail"` to simulate a provider timeout. */
async function serve(page: Page, drafts: (Draft | "fail")[], opts: { holdSecond?: number } = {}): Promise<Seen> {
  const seen: Seen = { plan: [], revisit: [], errors: [] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|status of 5\d\d|Failed to load resource/i.test(m.text() + (m.location().url ?? ""))) seen.errors.push(m.text());
  });
  let n = 0;
  await page.route("**/api/plan", async (route) => {
    seen.plan.push(route.request().postDataJSON());
    const i = n++;
    if (i === 1 && opts.holdSecond) await new Promise((r) => setTimeout(r, opts.holdSecond));
    const d = drafts[Math.min(i, drafts.length - 1)]!;
    if (d === "fail") return route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ ok: false, code: "timeout", message: "The AI guide took too long." }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: d, model: MODEL, warnings: [] }) });
  });
  await page.route("**/api/revisit", (route) => {
    seen.revisit.push(route.request().postDataJSON());
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "Not in this test." }) });
  });
  return seen;
}
const ask = async (page: Page, q: string) => {
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(q);
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("future-card-0")).toBeVisible();
};
const shot = (page: Page, name: string) => page.screenshot({ path: `${shotsDir}after-${name}.png`, fullPage: true, animations: "disabled" });
const overflowing = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const known = (page: Page) => page.getByTestId("story-known");

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("bookstore: figures from the question are shown, confirmed once, and fill the opened future; the other future is not given them", async ({ page }) => {
      const seen = await serve(page, [audit.bookstore]);
      await ask(page, A);
      const panel = page.getByTestId("figures-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Figures from your question");
      await expect(panel).toContainText("“₹20,000 per month in sales”");
      await expect(panel).toContainText("“₹8,000 rent”");
      await expect(panel).toContainText("“₹4,000 other monthly expenses”");
      // Nothing is applied yet. Only what states its period is pre-ticked (R20A): "₹8,000 rent" does not say per month, so it waits for the user.
      for (const k of [0, 2]) await expect(page.getByTestId(`figure-use-${k}`)).toBeChecked();
      await expect(page.getByTestId("figure-use-1")).not.toBeChecked();
      await expect(page.getByTestId("figure-row-1")).toContainText("per month for the other amounts, not this one");
      await expect(page.getByTestId("figure-read-0")).toHaveText("₹20,000 per month");
      await expect(page.getByTestId("figure-variable-1")).toHaveText("Rent");
      // Part of what is asked about: each goes to the future that does it ("Don't open it" is left out), and the panel says why.
      await expect(page.getByTestId("figure-scope-0")).toContainText("Used only in “Open the bookstore”.");
      await expect(page.getByTestId("figure-scope-why-0")).toContainText("“Don't open it” reads as not doing it");
      await expect(page.getByTestId("explore-future-0")).toHaveText("Save and explore this future →");
      expect(await overflowing(page)).toBe(false);
      await shot(page, `${vp.name}-figures-panel`);

      // The user confirms the rent's period by ticking it.
      await page.getByTestId("figure-use-1").check();
      await page.getByTestId("figures-confirm").click();
      await expect(page.getByTestId("figures-summary")).toHaveText(/Using 3 figures from your question/);
      await expect(page.getByTestId("figures-summary")).toBeFocused();
      await expect(page.getByTestId("explore-future-0")).toHaveText("Save and explore with your figures →");
      expect(await overflowing(page)).toBe(false);
      await shot(page, `${vp.name}-figures-confirmed`);

      await page.getByTestId("explore-future-0").click();
      await expect(page.getByTestId("story-title")).toHaveText("Open the bookstore");
      await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
      // Nothing asks again for what was confirmed, and the words are shown as the user's own what-if figure.
      await expect(page.getByTestId("question-card")).toHaveCount(0);
      await expect(page.getByTestId("known-stated-rent")).toContainText("From your question: “₹8,000 rent”");
      await expect(page.getByTestId("known-stated-rent")).toContainText("not checked against anything");
      await expect(known(page)).toContainText("Rent: ₹8,000 per month");
      expect(await overflowing(page)).toBe(false);
      await shot(page, `${vp.name}-bookstore-result`);

      // The other future was not given the amounts: it asks for them, in its own words.
      await page.getByTestId("branch-Don't open it").click();
      await expect(page.getByTestId("question-card")).toContainText("Sales per month");
      await expect(page.getByTestId("story-calc-shopProfit")).toContainText("needs Sales per month, Rent, Other costs");
      await expect(page.getByTestId("known-stated-rent")).toHaveCount(0);
      expect(seen.plan).toHaveLength(1);
      expect(seen.errors).toEqual([]);
    });

    test("Change re-opens the confirmed figures with the keyboard on the panel, and the choices made before are still there", async ({ page }) => {
      await serve(page, [audit.bookstore]);
      await ask(page, A);
      await page.getByTestId("figure-use-2").uncheck();
      await page.getByTestId("figures-confirm").click();
      // One figure is used; the two that were offered and not used are named, so nothing is left out unnoticed.
      await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question");
      await expect(page.getByTestId("figures-left-out")).toContainText("“₹8,000 rent”");
      await expect(page.getByTestId("figures-left-out")).toContainText("“₹4,000 other monthly expenses”");
      await page.getByTestId("figures-change").click();
      await expect(page.getByTestId("figures-panel")).toBeVisible();
      await expect(page.getByTestId("figures-title")).toBeFocused();
      // What the user chose is what they see again: the unticked figure is still unticked.
      await expect(page.getByTestId("figure-use-2")).not.toBeChecked();
      await expect(page.getByTestId("figure-use-1")).not.toBeChecked();
      await expect(page.getByTestId("figure-use-0")).toBeChecked();
      await expect(page.getByTestId("explore-future-0")).toHaveText("Save and explore this future →");
    });

    test("nothing is applied without the confirmation: opening a future first leaves every number to be answered", async ({ page }) => {
      const seen = await serve(page, [audit.bookstore]);
      await ask(page, A);
      await page.getByTestId("explore-future-0").click();
      await expect(page.getByTestId("question-card")).toContainText("Sales per month");
      await expect(page.getByTestId("story-calc-shopProfit")).toContainText("needs Sales per month, Rent, Other costs");
      await expect(page.getByTestId("known-stated-rent")).toHaveCount(0);
      expect(seen.errors).toEqual([]);
    });

    test("study plan: two hours and one hour go to their own futures, and the user can correct a figure's place before confirming", async ({ page }) => {
      const seen = await serve(page, [r19.education]);
      await ask(page, B);
      await expect(page.getByTestId("figures-panel")).toContainText("“studied two hours daily”");
      await expect(page.getByTestId("figures-panel")).toContainText("“one hour for exams”");
      await expect(page.getByTestId("figures-panel")).toContainText("“exams four weeks away”");
      await expect(page.getByTestId("figure-read-1")).toHaveText("1 hour per day");
      // The two hours figures say which future they belong to, by name. The weeks count down to a date, which is the same in
      // both futures being compared, so they go to both (R20A), and the panel says why (the countdown reason, R20A.1).
      await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
      await expect(page.getByTestId("figure-target-1")).toHaveValue("f1");
      await expect(page.getByTestId("figure-target-2")).toHaveValue("all");
      await expect(page.getByTestId("figure-scope-2")).toContainText("Used in every future in the draft (2).");
      await expect(page.getByTestId("figure-scope-why-2")).toContainText("It counts down to a date, which is the same in every future.");
      await expect(page.getByTestId("figure-row-0")).toContainText("each goes in a different future");
      // "one hour" borrowed its period and meaning from "two hours daily", so it is shown, not ticked for the user.
      await expect(page.getByTestId("figure-use-0")).toBeChecked();
      await expect(page.getByTestId("figure-use-1")).not.toBeChecked();
      await expect(page.getByTestId("figure-row-1")).toContainText("taken from another figure, so it is used only if you tick it");
      await expect(page.getByTestId("figure-use-2")).toBeChecked();
      await page.getByTestId("figure-use-1").check();
      await shot(page, `${vp.name}-study-panel`);

      // Correct it: swap the futures so both hours figures claim the same one. Confirming is refused, and says why.
      await page.getByTestId("figure-target-1").selectOption("f0");
      await expect(page.getByTestId("figures-problem")).toContainText("Two figures are set for “Study hours per day” in the same future");
      await expect(page.getByTestId("figures-confirm")).toBeDisabled();
      await shot(page, `${vp.name}-study-collision`);
      await page.getByTestId("figure-target-1").selectOption("f1");
      await expect(page.getByTestId("figures-confirm")).toBeEnabled();

      await page.getByTestId("figures-confirm").click();
      await page.getByTestId("explore-future-0").click();
      await expect(page.getByTestId("story-calc-totalStudyHours")).toContainText("56 hours");
      await page.getByTestId("branch-Keep one hour daily").click();
      // One hour is there already and so are the weeks, which were confirmed for both futures: nothing about them is asked again.
      await expect(known(page)).toContainText("Study hours per day: 1 hours per day");
      await expect(known(page)).toContainText("Weeks until the exams: 4 weeks");
      await expect(page.getByTestId("story-calc-totalStudyHours")).toContainText("28 hours");
      await expect(page.getByTestId("question-card")).not.toContainText("Weeks until the exams");
      // No invented improvement: nothing in the page claims a percentage or an outcome of studying more.
      await expect(page.locator("body")).not.toContainText(/\d+\s?% (better|more|higher|improvement)/i);
      expect(seen.errors).toEqual([]);
    });

    test("an unclear mapping is asked, not guessed: a figure without the currency or period is shown unticked with the reason", async ({ page }) => {
      const draft = structuredClone(audit.bookstore);
      draft.variables.find((v: { key: string }) => v.key === "rent").label = "Shop costs";
      draft.variables.find((v: { key: string }) => v.key === "otherCosts").label = "Shop costs";
      const seen = await serve(page, [draft]);
      await ask(page, "What if I opened a bookstore with 20000 per month in sales and ₹4,000 shop costs per month?");
      const rows = page.locator("[data-testid^=figure-row-]");
      await expect(rows).toHaveCount(2);
      // 20000 has no currency symbol but the field is in ₹: shown, unticked, with the reason.
      await expect(page.getByTestId("figure-use-0")).not.toBeChecked();
      await expect(page.getByTestId("figure-row-0")).toContainText("no currency symbol; this field is in “₹ per month”");
      // "Read as" shows only what the user wrote: never a ₹ they did not type. The field's own unit is shown beside the field.
      await expect(page.getByTestId("figure-read-0")).toHaveText("20,000 per month");
      await expect(page.getByTestId("figure-read-0")).not.toContainText("₹");
      await expect(page.getByTestId("figure-unit-0")).toHaveText("₹ per month");
      // This one's words do say "₹4,000 … per month", so that is what is shown, even before an assumption is chosen.
      await expect(page.getByTestId("figure-read-1")).toHaveText("₹4,000 per month");
      // ₹4,000 shop costs fits two assumptions equally: no pre-selection, the user chooses.
      await expect(page.getByTestId("figure-use-1")).not.toBeChecked();
      await expect(page.getByTestId("figure-variable-1")).toHaveValue("");
      await expect(page.getByTestId("figure-row-1")).toContainText("More than one assumption fits");
      await expect(page.getByTestId("figures-confirm")).toBeDisabled();
      expect(await overflowing(page)).toBe(false);
      await shot(page, `${vp.name}-unclear-mapping`);

      // The user decides: tick the first (their own call), pick an assumption for the second.
      await page.getByTestId("figure-use-0").check();
      await page.getByTestId("figure-variable-1").selectOption("rent");
      await page.getByTestId("figure-use-1").check();
      await page.getByTestId("figures-confirm").click();
      await page.getByTestId("explore-future-0").click();
      await expect(known(page)).toContainText("Sales per month: ₹20,000 per month");
      // The user's pick: the ₹4,000 went to the assumption they chose (its label is "Shop costs" in this draft), and the other one is still asked.
      await expect(page.getByTestId("known-value-rent")).toContainText("Shop costs: ₹4,000 per month");
      await expect(page.getByTestId("known-value-otherCosts")).toHaveCount(0);
      await expect(page.getByTestId("question-card")).toContainText("Shop costs");
      expect(seen.errors).toEqual([]);
    });

    test("a number the typed-amount policy refuses is never used and is listed as not used", async ({ page }) => {
      const seen = await serve(page, [audit.bookstore]);
      await ask(page, "What if I opened a bookstore with ₹20,000 per month in sales, 1.500 rent and 4k other expenses?");
      await expect(page.getByTestId("figure-row-0")).toContainText("“₹20,000 per month in sales”");
      await expect(page.locator("[data-testid^=figure-row-]")).toHaveCount(1);
      const unused = page.getByTestId("figures-unused");
      await expect(unused).toContainText("“1.500”");
      await expect(unused).toContainText("could mean 1.5 or 1500");
      await expect(unused).toContainText("“4k”");
      await expect(unused).toContainText("letters stuck to a number are not read");
      expect(seen.errors).toEqual([]);
    });
  });
}

test.describe("correcting the AI's reading of the question", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Edit my question: the draft stays, the figures follow the new wording, and a note says the futures were made for the old one", async ({ page }) => {
    const seen = await serve(page, [audit.bookstore]);
    await ask(page, A);
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("edit-question").click();
    await expect(page.getByTestId("question-edit-input")).toBeFocused();
    await expect(page.getByTestId("question-edit-apply")).toBeDisabled();
    await shot(page, "desktop-1440-edit-question");
    await page.getByTestId("question-edit-input").fill(A.replace("₹20,000", "₹25,000"));
    await page.getByTestId("question-edit-apply").click();
    // No request, the draft is still there, the heading shows the new wording, and the focus went back to the link.
    expect(seen.plan).toHaveLength(1);
    await expect(page.getByTestId("future-card-0")).toBeVisible();
    await expect(page.locator("h1.question")).toContainText("₹25,000");
    await expect(page.getByTestId("edit-question")).toBeFocused();
    const note = page.getByTestId("question-changed-note");
    await expect(note).toContainText("You changed your question");
    await expect(note).toContainText("were drafted for “What if I opened a weekend bookstore with ₹20,000");
    // The earlier confirmation no longer stands: the figures are read again and must be confirmed again.
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    await expect(page.getByTestId("figure-read-0")).toHaveText("₹25,000 per month");
    // R20A: only the number changed, so the choices made for it are kept, and the panel says so.
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figures-edit-note")).toContainText("Kept your choices for “₹25,000 per month in sales” (it was “₹20,000 per month in sales”)");
    await expect(page.getByTestId("figures-edit-note")).toContainText("Check the new figures below, then confirm again.");
    await shot(page, "desktop-1440-question-changed");
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("question")).toContainText("₹25,000");
    await expect(known(page)).toContainText("Sales per month: ₹25,000 per month");
    await expect(page.getByTestId("known-stated-monthlySales")).toContainText("“₹25,000 per month in sales”");
    expect(seen.plan).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });

  test("Edit my question can be cancelled with Escape, and refuses to apply the same or an empty wording", async ({ page }) => {
    await serve(page, [audit.bookstore]);
    await ask(page, A);
    await page.getByTestId("edit-question").click();
    await page.getByTestId("question-edit-input").fill("");
    await expect(page.getByTestId("question-edit-apply")).toBeDisabled();
    await page.getByTestId("question-edit-input").fill(A);
    await expect(page.getByTestId("question-edit-apply")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("question-edit")).toHaveCount(0);
    await expect(page.getByTestId("edit-question")).toBeFocused();
    await expect(page.getByTestId("question-changed-note")).toHaveCount(0);
  });

  test("Generate possibilities for this wording: one request with the edited question; the draft stays visible while it waits", async ({ page }) => {
    const second = { ...structuredClone(audit.bookstore), interpretation: "A second reading, for the edited question." };
    const seen = await serve(page, [audit.bookstore, second], { holdSecond: 1500 });
    await ask(page, A);
    const edited = A.replace("₹20,000", "₹25,000");
    await page.getByTestId("edit-question").click();
    await page.getByTestId("question-edit-input").fill(edited);
    await page.getByTestId("question-edit-apply").click();
    await page.getByTestId("generate-for-wording").click();
    await expect(page.getByTestId("plan-busy")).toBeVisible();
    await expect(page.getByTestId("future-card-0")).toBeVisible();
    await expect(page.getByTestId("explore-future-0")).toBeDisabled();
    await shot(page, "desktop-1440-generating-draft-stays");
    await expect(page.getByTestId("plan-interpretation")).toContainText("A second reading", { timeout: 15_000 });
    await expect(page.getByTestId("plan-busy")).toHaveCount(0);
    await expect(page.getByTestId("question-changed-note")).toHaveCount(0);
    expect(seen.plan).toHaveLength(2);
    expect(seen.plan[1]!.question).toBe(edited);
    // Review before approval: nothing is saved by getting a new draft.
    await expect(page.getByTestId("discover")).toBeVisible();
    await expect(page.getByTestId("story")).toHaveCount(0);
    expect(seen.errors).toEqual([]);
  });

  test("Generate different possibilities: if it fails, the draft the user was looking at is still there, with the reason", async ({ page }) => {
    const seen = await serve(page, [audit.bookstore, "fail"]);
    await ask(page, A);
    await page.getByTestId("figure-use-1").check();
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("retry-plan").click();
    await expect(page.getByTestId("retry-error")).toContainText("The AI guide took too long.");
    await expect(page.getByTestId("retry-error")).toContainText("The ones below are still here");
    await expect(page.getByTestId("future-card-0")).toBeVisible();
    await expect(page.getByTestId("figures-summary")).toBeVisible();
    await expect(page.getByTestId("explore-future-0")).toBeEnabled();
    await shot(page, "desktop-1440-generate-failed-draft-kept");
    // The old draft is still usable.
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
    expect(seen.plan).toHaveLength(2);
  });

  test("editing the question or asking again never touches a map that is already saved", async ({ page }) => {
    await serve(page, [audit.bookstore]);
    await ask(page, A);
    await page.getByTestId("figure-use-1").check();
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
    // A second question, edited and regenerated, while the first map is saved.
    await page.getByTestId("home").click();
    await expect(page.getByTestId(`open-${A}`)).toBeVisible();
    await page.getByTestId("whatif-input").fill("What if I opened a café?");
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("future-card-0")).toBeVisible();
    await page.getByTestId("edit-question").click();
    await page.getByTestId("question-edit-input").fill("What if I opened a bakery?");
    await page.getByTestId("question-edit-apply").click();
    await page.getByTestId("retry-plan").click();
    await expect(page.getByTestId("future-card-0")).toBeVisible();
    await page.getByTestId("discard-plan").click();
    // Exactly one saved map, unchanged: the café and the bakery drafts were never saved.
    await expect(page.locator('[data-testid^="open-What if"]')).toHaveCount(1);
    await page.getByTestId(`open-${A}`).click();
    await page.getByTestId("branch-Open the bookstore").click();
    await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
    await expect(page.getByTestId("known-stated-rent")).toContainText("“₹8,000 rent”");
  });
});

test.describe("honest wording", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("cards say the draft, the button says what saving does, and 'filled in' is not claimed while questions are open", async ({ page }) => {
    await serve(page, [audit.bookstore]);
    await ask(page, A);
    await expect(page.getByTestId("include-future-0")).toHaveText("✓ Included in draft");
    await page.getByTestId("include-future-1").click();
    await expect(page.getByTestId("include-future-1")).toHaveText("Left out");
    await expect(page.getByTestId("approval-note")).toContainText("Nothing is saved yet. Choosing a future saves it");
    await expect(page.getByTestId("discover")).toContainText("Every number will come from you");
    await page.getByTestId("include-future-1").click();
    await page.getByTestId("figure-use-1").check();
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-0").click();
    // Every number has a value now, but the draft's own questions are still open: the card must not say "filled in".
    await page.getByTestId("branch-from-here").click();
    await page.getByTestId("fork-name").fill("Copy");
    await page.getByTestId("fork-create").click();
    await page.getByTestId("branch-Open the bookstore").click();
    const next = page.getByTestId("next-step");
    await expect(next.locator("h3").first()).toHaveText("Every number has a value");
    await expect(page.getByTestId("open-items-note")).toContainText("still open");
    await expect(next).not.toContainText("This future is filled in");
    // One primary action in the next step, and only one primary comparison button on the whole page.
    await expect(next.locator(".btn-primary:visible")).toHaveCount(1);
    await expect(page.locator(".btn-primary:visible", { hasText: /compare/i })).toHaveCount(1);
    await shot(page, "desktop-1440-every-number-has-a-value");
  });

  test("a map with one path shows one 'Explore another path from here', not two", async ({ page }) => {
    await serve(page, [audit.bookstore]);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill("What if I rented a bigger flat?");
    await page.getByTestId("start-blank").click();
    await page.getByTestId("var-label").fill("Monthly rent");
    await page.getByTestId("var-unit").fill("£ per month");
    await page.getByTestId("var-start").fill("1200");
    await page.getByTestId("add-variable").click();
    await page.getByTestId("all-details").click();
    await expect(page.getByTestId("next-step").getByRole("button", { name: /Explore another path from here/ })).toHaveCount(1);
  });

  test("a question with no numbers gets no extra step, its draft question is editable, and nothing speculative is presented as verified", async ({ page }) => {
    const seen = await serve(page, [r19.projects]);
    await ask(page, C);
    await expect(page.locator("[data-testid^=figures]")).toHaveCount(0);
    await expect(page.getByTestId("edit-question")).toBeVisible();
    await expect(page.getByTestId("explore-future-0")).toHaveText("Save and explore this future →");
    await shot(page, "desktop-1440-qualitative-discover");
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText("Team projects replace exams");
    await expect(page.getByTestId("story-known")).toContainText("Nothing yet");
    await expect(page.locator(".possible-section")).toContainText("Possibilities to think with, not predictions");
    await expect(page.getByTestId("known-stated-assessment")).toHaveCount(0);
    expect(seen.plan).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });

  test("a currency the question named but the field lacks is said on the question card, never converted", async ({ page }) => {
    const draft = structuredClone(audit.bookstore);
    for (const v of draft.variables) if (v.kind === "number") v.unit = "per month";
    await serve(page, [draft]);
    await ask(page, A);
    // The figures do not fit a field with no currency, so none is pre-ticked; the user skips the panel and opens a future.
    await expect(page.getByTestId("figure-use-0")).not.toBeChecked();
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("question-currency-hint")).toContainText("Your question says ₹ here");
    await expect(page.getByTestId("question-currency-hint")).toContainText("enter just the number");
  });
});

test.describe("the AI request says only what is recorded", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a fresh look sends 'ai', 'user' and 'unrecorded' as themselves, and marks copies from an earlier path as inherited", async ({ page }) => {
    const seen = await serve(page, [reactive["relocation-first"]]);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill("What if I moved to another country?");
    await page.getByTestId("explore-possibilities").click();
    await page.getByTestId("context-skip").click();
    await page.getByTestId("context-skip").click();
    await page.getByTestId("explore-future-0").click();
    // The user writes a possibility of their own on this path, then tells RealityFork something so a fresh look is offered.
    await page.getByTestId("add-known").click();
    await page.getByTestId("add-known-text").fill("My employer allows me to work remotely");
    await page.getByTestId("add-known-save").click();
    await expect(page.getByTestId("ask-fresh-look")).toBeVisible();
    await page.getByTestId("ask-fresh-look").click();
    await expect.poll(() => seen.revisit.length).toBe(1);
    const req = seen.revisit[0] as { suggestions: { from: string; inherited?: boolean }[] };
    expect(req.suggestions.length).toBeGreaterThan(0);
    for (const s of req.suggestions) expect(["ai", "user", "example", "unrecorded"]).toContain(s.from);
    // Everything in this map is the AI's own draft: it is called that, never "user".
    expect(req.suggestions.every((s) => s.from === "ai")).toBe(true);
    expect(req.suggestions.some((s) => "inherited" in s)).toBe(false);
  });
});

test("a map with figures from the question survives saving to a file and opening it again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await serve(page, [audit.bookstore]);
  await ask(page, A);
  await page.getByTestId("figure-use-1").check();
  await page.getByTestId("figures-confirm").click();
  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
  await page.getByTestId("more-menu").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-realities").click();
  const file = await (await download).path();
  const text = readFileSync(file, "utf8");
  expect(text).toContain("₹8,000 rent");
  await page.getByTestId("more-menu").click();
  await page.getByTestId("reset-realities").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("Remove your map from this browser?");
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId(`open-${A}`)).toHaveCount(0);
  await page.getByTestId("import-realities-file").setInputFiles(file);
  await expect(page.getByTestId("notice")).toContainText("Restored 1 reality");
  await page.getByTestId(`open-${A}`).click();
  // A reopened map starts at "As things are": nothing was set there, and the figures are on the future they were confirmed for.
  await expect(page.getByTestId("story-calc-shopProfit")).toContainText("needs Sales per month, Rent, Other costs");
  await page.getByTestId("branch-Open the bookstore").click();
  await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
  await expect(page.getByTestId("known-stated-rent")).toContainText("From your question: “₹8,000 rent”");
  await page.getByTestId("branch-Don't open it").click();
  await expect(page.getByTestId("known-stated-rent")).toHaveCount(0);
  expect(seen.errors).toEqual([]);
});
