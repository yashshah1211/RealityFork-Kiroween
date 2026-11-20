/**
 * R20A, trustworthy figures, in a real browser. The draft replies are deterministic fixtures ("mocked"); no live model is
 * contacted and every other /api request is refused. Screenshots go to Playwright's own output folder (git-ignored),
 * never to docs/.
 *
 *  RV-01  a lump sum is never ticked into a per-period field; a period the user did not write is never filled in
 *  RV-02  a hedged amount ("at least", "about", "up to" …) is kept with its words and used only when the user says it is exact
 *  RV-03  editing the question keeps the choices for a figure whose meaning did not change, says what it kept and what it
 *         could not, and warns about an offered figure that has no future
 *  RV-06  a figure shared by the futures goes to all of them, says so in plain words, can be narrowed, and Compare agrees
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const r20a = JSON.parse(readFileSync(here("./fixtures/r20a-proposals.json"), "utf8"));
const audit = JSON.parse(readFileSync(here("./fixtures/audit-proposals.json"), "utf8"));
const MODEL = "openai/gpt-oss-120b (mocked in this test)";

const MISSION_BOOKSTORE = "What if I opened a bookstore? I have a budget of ₹500,000 and expect monthly rent of ₹35,000.";
const MISSION_STUDY = "What if I studied for 3 hours every day instead of 1 hour for the next 6 months?";

interface Seen { plan: { question: string }[]; other: string[]; errors: string[] }
/** Serve the draft replies in order (the last repeats); refuse every other /api request and remember it. */
async function serve(page: Page, drafts: unknown[]): Promise<Seen> {
  const seen: Seen = { plan: [], other: [], errors: [] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|status of 5\d\d|Failed to load resource/i.test(m.text() + (m.location().url ?? ""))) seen.errors.push(m.text());
  });
  let n = 0;
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (!url.endsWith("/api/plan")) {
      seen.other.push(url);
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "Not in this test." }) });
    }
    seen.plan.push(route.request().postDataJSON());
    const proposal = drafts[Math.min(n++, drafts.length - 1)];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal, model: MODEL, warnings: [] }) });
  });
  return seen;
}
const ask = async (page: Page, q: string) => {
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(q);
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("future-card-0")).toBeVisible();
};
const overflowing = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
const known = (page: Page) => page.getByTestId("story-known");

test.describe("RV-01: a period the user did not write is never filled in", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("'a budget of ₹500,000' is ticked for a Starting budget, with the monthly rent beside it", async ({ page }) => {
    const seen = await serve(page, [r20a.bookstoreStartingBudget]);
    await ask(page, MISSION_BOOKSTORE);
    await expect(page.getByTestId("figure-variable-0")).toHaveText("Starting budget");
    await expect(page.getByTestId("figure-variable-1")).toHaveText("Monthly rent");
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figure-use-1")).toBeChecked();
    expect(seen.errors).toEqual([]);
  });

  test("the same budget is NOT ticked into a 'Monthly budget'; ticking it is the user's confirmation, and then it is used as written", async ({ page }, info) => {
    const seen = await serve(page, [r20a.bookstoreMonthlyBudget]);
    await ask(page, MISSION_BOOKSTORE);
    await expect(page.getByTestId("figure-variable-0")).toHaveText("Monthly budget");
    await expect(page.getByTestId("figure-use-0")).not.toBeChecked();
    await expect(page.getByTestId("figure-row-0")).toContainText("does not say per month; this field is “₹ per month”. Tick it only if the amount is per month.");
    await expect(page.getByTestId("figure-row-0")).not.toContainText("other amounts");
    // The rent says "monthly" itself, so it stays ticked: an explicit period is authoritative.
    await expect(page.getByTestId("figure-use-1")).toBeChecked();
    await shot(page, info, "rv01-monthly-budget-panel");

    // Not ticking it: it is left out, said so, and the field is asked for as before.
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question");
    await expect(page.getByTestId("figures-left-out")).toContainText("“budget of ₹500,000”");
    await page.getByTestId("explore-future-0").click();
    await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
    await expect(known(page)).not.toContainText("Monthly budget: ₹500,000");
    await expect(page.getByTestId("question-card")).toContainText("Monthly budget");

    // Ticking it first: used exactly as written, with the user's words.
    await page.getByTestId("home").click();
    await ask(page, MISSION_BOOKSTORE);
    await page.getByTestId("figure-use-0").check();
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 2 figures from your question");
    await expect(page.getByTestId("figures-left-out")).toHaveCount(0);
    await page.getByTestId("explore-future-0").click();
    await expect(known(page)).toContainText("Monthly budget: ₹500,000 per month");
    await expect(page.getByTestId("known-stated-monthlyBudget")).toContainText("From your question: “budget of ₹500,000”");
    expect(seen.other).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("RV-02: a hedged amount is kept with its words and used only when the user says it is exact", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const word of ["at least", "at most", "up to", "about", "approximately", "roughly", "around", "over", "under"]) {
    test(`“${word}” is not ticked, explains itself, and ticking it uses exactly ₹35,000 with the user's words`, async ({ page }, info) => {
      const seen = await serve(page, [audit.bookstore]);
      await ask(page, `What if I opened a bookstore and paid ${word} ₹35,000 per month in rent?`);
      const row = page.getByTestId("figure-row-0");
      await expect(row).toContainText(`“${word} ₹35,000 per month in rent”`);
      await expect(page.getByTestId("figure-read-0")).toHaveText(`${word} ₹35,000 per month`);
      await expect(page.getByTestId("figure-variable-0")).toHaveText("Rent");
      await expect(page.getByTestId("figure-use-0")).not.toBeChecked();
      await expect(row).toContainText(`You wrote “${word}”`);
      await expect(page.getByTestId("figure-exact-0")).toHaveText("Tick to use ₹35,000 per month as an exact value");
      // The note is tied to the checkbox, so assistive technology reads the reason with it.
      const described = await page.getByTestId("figure-use-0").getAttribute("aria-describedby");
      expect(described).toBeTruthy();
      await expect(page.locator(`#${described!.split(" ")[0]}`)).toContainText(`You wrote “${word}”`);
      // Nothing to confirm until the user decides.
      await expect(page.getByTestId("figures-confirm")).toBeDisabled();
      await expect(page.getByText("Tick a figure to use it.")).toBeVisible();
      if (word === "at least") await shot(page, info, "rv02-at-least-panel");

      await page.getByTestId("figure-use-0").check();
      await page.getByTestId("figures-confirm").click();
      await page.getByTestId("explore-future-0").click();
      await expect(known(page)).toContainText("Rent: ₹35,000 per month");
      await expect(page.getByTestId("known-stated-rent")).toContainText(`From your question: “${word} ₹35,000 per month in rent”`);
      expect(seen.plan).toHaveLength(1);
      expect(seen.errors).toEqual([]);
    });
  }

  test("several figures in one sentence: each hedge stays with its own amount, and the plain ones are still ticked", async ({ page }) => {
    await serve(page, [audit.bookstore]);
    await ask(page, "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and at most ₹4,000 other monthly expenses?");
    await expect(page.getByTestId("figure-row-0")).toContainText("“₹20,000 per month in sales”");
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figure-row-0")).not.toContainText("You wrote");
    await expect(page.getByTestId("figure-row-2")).toContainText("“at most ₹4,000 other monthly expenses”");
    await expect(page.getByTestId("figure-row-2")).toContainText("You wrote “at most”");
    await expect(page.getByTestId("figure-use-2")).not.toBeChecked();
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question");
    await expect(page.getByTestId("figures-left-out")).toContainText("“₹8,000 rent”");
    await expect(page.getByTestId("figures-left-out")).toContainText("“at most ₹4,000 other monthly expenses”");
  });

  test("a trailing hedge ('or more') is kept too", async ({ page }) => {
    await serve(page, [audit.bookstore]);
    await ask(page, "What if I opened a bookstore and rent was ₹35,000 per month or more?");
    await expect(page.getByTestId("figure-read-0")).toHaveText("₹35,000 per month or more");
    await expect(page.getByTestId("figure-use-0")).not.toBeChecked();
    await expect(page.getByTestId("figure-exact-0")).toHaveText("Tick to use ₹35,000 per month as an exact value");
  });
});

test.describe("RV-03: editing the question keeps the user's choices, says what it kept, and warns about a figure with no future", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const edit = async (page: Page, to: string) => {
    await page.getByTestId("edit-question").click();
    await page.getByTestId("question-edit-input").fill(to);
    await page.getByTestId("question-edit-apply").click();
  };

  test("3 hours → 2 hours: the tick and the future stay, the panel says so, nothing is applied until it is confirmed again, and no AI request is made", async ({ page }, info) => {
    const seen = await serve(page, [r20a.studyMonths]);
    await ask(page, MISSION_STUDY);
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await page.getByTestId("figure-use-1").check();
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 2 figures from your question");

    await edit(page, MISSION_STUDY.replace("3 hours", "2 hours"));
    expect(seen.plan).toHaveLength(1);
    // The earlier confirmation no longer stands (the number changed), but nothing the user chose was lost.
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    await expect(page.getByTestId("figure-read-0")).toHaveText("2 hours per day");
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
    await expect(page.getByTestId("figure-use-1")).toBeChecked();
    await expect(page.getByTestId("figures-edit-note")).toContainText("Your figure choices after the change");
    await expect(page.getByTestId("figures-edit-note")).toContainText("Kept your choices for “studied for 2 hours every day” (it was “studied for 3 hours every day”). It goes in “Study three hours daily”.");
    // The reason a shared figure goes to every future is still shown after the edit.
    await expect(page.getByTestId("figure-scope-why-2")).toContainText("Your question compares other figures, so this one is the same in each future.");
    await expect(page.getByTestId("figures-edit-note")).toContainText("The name “Study three hours daily” was written for the earlier number.");
    await expect(page.getByTestId("figures-unplaced")).toHaveCount(0);
    await expect(page.getByTestId("figures-confirm")).toBeEnabled();
    await shot(page, info, "rv03-kept-after-edit");

    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 2 figures from your question");
    await expect(page.getByTestId("figures-edit-note")).toHaveCount(0);
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText("Study three hours daily");
    await expect(known(page)).toContainText("Study hours per day: 2 hours per day");
    await expect(page.getByTestId("known-stated-studyHours")).toContainText("From your question: “studied for 2 hours every day”");
    await page.getByTestId("branch-Keep one hour daily").click();
    await expect(known(page)).toContainText("Study hours per day: 1 hours per day");
    expect(seen.plan).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });

  test("a change in meaning is not carried: the loss is said, and the new figure is listed instead of vanishing", async ({ page }) => {
    await serve(page, [r20a.studyMonths]);
    await ask(page, MISSION_STUDY);
    await page.getByTestId("figures-confirm").click();
    await edit(page, MISSION_STUDY.replace("3 hours every day", "3 hours every week"));
    await expect(page.getByTestId("figures-edit-note")).toContainText("Not kept: your choice for “studied for 3 hours every day”");
    await expect(page.getByTestId("figures-unused")).toContainText("“studied for 3 hours every week”");
    await expect(page.getByTestId("figures-confirm")).toBeDisabled();
  });

  test("an offered figure that has no future is warned about before confirming, named after it, and decided by choosing one", async ({ page }, info) => {
    const draft = structuredClone(r20a.studyMonths);
    draft.branches[0].name = "Study longer";
    draft.branches[1].name = "Keep my routine";
    draft.possibilities = draft.possibilities.map((x: { branch: string }) => ({ ...x, branch: x.branch === "Study three hours daily" ? "Study longer" : x.branch === "Keep one hour daily" ? "Keep my routine" : x.branch }));
    await serve(page, [draft]);
    await ask(page, MISSION_STUDY);
    await expect(page.getByTestId("figure-target-0")).toHaveValue("none");
    await expect(page.getByTestId("figure-unplaced-0")).toContainText("No future chosen yet");
    await expect(page.getByTestId("figures-unplaced")).toHaveText("2 figures have no future yet, so they will not be used unless you choose one: “studied for 3 hours every day”, “1 hour for the next”.");
    await shot(page, info, "rv03-no-future-warning");
    // Choosing a future for one of them is the user's decision; the warning follows.
    await page.getByTestId("figure-use-0").check();
    await page.getByTestId("figure-target-0").selectOption("f0");
    await expect(page.getByTestId("figures-unplaced")).toHaveText("“1 hour for the next” has no future yet, so it will not be used unless you choose one.");
    // The user may still go on without it, and then it is named as left out.
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question");
    await expect(page.getByTestId("figures-left-out")).toContainText("“1 hour for the next”");
  });
});

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test.describe(`RV-06 ${vp.name}: a figure shared by the futures goes to all of them, and Compare agrees`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the bookstore example: one confirmation puts the budget and the rent in both futures, and Compare shows them as the same in both", async ({ page }, info) => {
      const seen = await serve(page, [r20a.bookstoreStartingBudget]);
      await ask(page, MISSION_BOOKSTORE);
      for (const k of [0, 1]) {
        await expect(page.getByTestId(`figure-use-${k}`)).toBeChecked();
        await expect(page.getByTestId(`figure-target-${k}`)).toHaveValue("all");
        await expect(page.getByTestId(`figure-scope-${k}`)).toContainText("Used in every future in the draft (2).");
      }
      // The budget is something the person has; the rent is expected, and neither of these two futures reads as not opening the shop.
      await expect(page.getByTestId("figure-scope-why-0")).toContainText("It is something you have");
      await expect(page.getByTestId("figure-scope-why-1")).toContainText("No future reads as not doing it, so it goes to every future.");
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `rv06-${vp.name}-panel`);
      await page.getByTestId("figures-confirm").click();
      await expect(page.getByTestId("figures-summary")).toContainText("Using 2 figures from your question: 2 in every future");
      expect(await overflowing(page)).toBe(false);

      await page.getByTestId("explore-future-0").click();
      await expect(page.getByTestId("story-title")).toHaveText("Open a physical shop");
      await expect(known(page)).toContainText("Starting budget: ₹500,000");
      await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
      await expect(page.getByTestId("story-calc-monthsOfRentTheBudgetCovers")).toContainText("14.29 months");
      // Nothing is asked again for what was said once: every number has a value, so there is no question card at all.
      await expect(page.getByTestId("question-card")).toHaveCount(0);
      // The other future was given them too, in the user's words.
      await page.getByTestId("branch-Start online first").click();
      await expect(page.getByTestId("known-stated-startingBudget")).toContainText("From your question: “budget of ₹500,000”");
      await expect(page.getByTestId("known-stated-monthlyRent")).toContainText("From your question: “expect monthly rent of ₹35,000”");
      await expect(page.getByTestId("story-calc-monthsOfRentTheBudgetCovers")).toContainText("14.29 months");

      // Compare: what was said once is the same in both, not a difference and not "not decided yet".
      await page.getByTestId("compare-with").click();
      await page.getByTestId("compare-pick-Open a physical shop").click();
      await expect(page.getByTestId("compare-view")).toBeVisible();
      await expect(page.getByTestId("cmp-differ")).toContainText("Shop format");
      await expect(page.getByTestId("cmp-differ")).not.toContainText("Starting budget");
      await expect(page.getByTestId("cmp-differ")).not.toContainText("not decided yet");
      await expect(page.getByTestId("cmp-same")).toContainText("Starting budget ₹500,000");
      await expect(page.getByTestId("cmp-same")).toContainText("Monthly rent ₹35,000 per month");
      await expect(page.getByTestId("cmp-not-comparable")).toHaveCount(0);
      await expect(page.getByTestId("cmp-calc-monthsOfRentTheBudgetCovers")).toContainText("14.29 months");
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `rv06-${vp.name}-compare`);
      expect(seen.plan).toHaveLength(1);
      expect(seen.other).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test("the user can narrow a figure to one future before confirming, and Compare says the other future has nothing decided", async ({ page }, info) => {
      await serve(page, [r20a.bookstoreStartingBudget]);
      await ask(page, MISSION_BOOKSTORE);
      await page.getByTestId("figure-target-0").selectOption("f1");
      await expect(page.getByTestId("figure-scope-0")).toHaveText("Used only in “Start online first”.");
      await expect(page.getByTestId("figure-scope-why-0")).toHaveCount(0);
      await page.getByTestId("figures-confirm").click();
      await expect(page.getByTestId("figures-summary")).toContainText("1 in every future, 1 in the future it was placed in");
      await page.getByTestId("explore-future-0").click();
      await expect(page.getByTestId("story-title")).toHaveText("Open a physical shop");
      await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
      await expect(page.getByTestId("question-card")).toContainText("Starting budget");
      await page.getByTestId("compare-with").click();
      await page.getByTestId("compare-pick-Start online first").click();
      await expect(page.getByTestId("cmp-differ")).toContainText("Starting budget");
      await expect(page.getByTestId("cmp-differ")).toContainText("not decided yet");
      await expect(page.getByTestId("cmp-same")).toContainText("Monthly rent ₹35,000 per month");
      await expect(page.getByTestId("cmp-same")).not.toContainText("Starting budget");
      await expect(page.getByTestId("cmp-not-comparable")).toContainText("add your numbers for: Starting budget");
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `rv06-${vp.name}-compare-narrowed`);
    });
  });
}

test.describe("RV-06: figures that belong to what is asked, or to one option, do not spread", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the amounts of 'what if I opened …' go to the future that opens the shop, not to the one that does not, and the panel says why", async ({ page }) => {
    await serve(page, [audit.bookstore]);
    await ask(page, "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?");
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
    await expect(page.getByTestId("figure-scope-0")).toContainText("Used only in “Open the bookstore”.");
    await expect(page.getByTestId("figure-scope-why-0")).toContainText("It is part of what you are asking about. “Don't open it” reads as not doing it (it starts with “don't”), so it is not copied there.");
  });

  test("a statement written apart from the question as a possibility ('would be') belongs to the future that does it, not to the one that stays", async ({ page }) => {
    await serve(page, [r20a.relocation]);
    await ask(page, "What if I moved to London? My rent would be £2,000 a month.");
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
    await expect(page.getByTestId("figure-scope-0")).toContainText("Used only in “Move to London”.");
  });

  test("a figure the user places in one future stays there, whichever future is opened", async ({ page }) => {
    await serve(page, [r20a.bookstoreStartingBudget]);
    await ask(page, MISSION_BOOKSTORE);
    await page.getByTestId("figure-target-1").selectOption("f1");
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-0").click();
    await expect(known(page)).toContainText("Starting budget: ₹500,000");
    await expect(page.getByTestId("question-card")).toContainText("Monthly rent");
    await page.getByTestId("branch-Start online first").click();
    await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
  });
});

/*
 * R20A.1, a figure goes only to the futures it applies to. The draft says which futures do what is asked and which keep
 * things as they are; the user's own words say whether a figure points to the thing asked ("there"), to today ("here"),
 * is something the person has ("my budget") or is expected. Where those do not settle it the panel asks, it never guesses.
 */
const MOVE = "What if I moved to London?";
const HOUSING_Q = "What if I rented a flat or bought one? I have savings of ₹300,000. Rent would be ₹20,000 a month, while the loan payment would be ₹15,000 a month.";
const editQuestion = async (page: Page, to: string) => {
  await page.getByTestId("edit-question").click();
  await page.getByTestId("question-edit-input").fill(to);
  await page.getByTestId("question-edit-apply").click();
};
const openCompare = async (page: Page, other: string) => {
  await page.getByTestId("compare-with").click();
  await page.getByTestId(`compare-pick-${other}`).click();
  await expect(page.getByTestId("compare-view")).toBeVisible();
};

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test.describe(`R20A.1 ${vp.name}: figures go only to the futures they apply to, and the user confirms what cannot be told`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("“Rent there is £2,000 a month” belongs to the move, not to staying: the staying future is given nothing, asks for it, and Compare says it is not decided", async ({ page }, info) => {
      const seen = await serve(page, [r20a.relocation]);
      await ask(page, `${MOVE} Rent there is £2,000 a month.`);
      await expect(page.getByTestId("figure-variable-0")).toHaveText("Monthly rent");
      await expect(page.getByTestId("figure-use-0")).toBeChecked();
      await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
      await expect(page.getByTestId("figure-scope-0")).toContainText("Used only in “Move to London”.");
      await expect(page.getByTestId("figure-scope-why-0")).toContainText("“there” points to what you ask about, which “Move to London” describes.");
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `r20a1-${vp.name}-there-panel`);
      await page.getByTestId("figures-confirm").click();
      await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question: 1 in the future it was placed in");

      // The future that stays was not given the number. It is asked for, never invented.
      await page.getByTestId("explore-future-1").click();
      await expect(page.getByTestId("story-title")).toHaveText("Stay in Mumbai");
      await expect(known(page)).not.toContainText("£2,000");
      await expect(page.getByTestId("question-card")).toContainText("Monthly rent");
      // The future that moves has it, in the user's own words.
      await page.getByTestId("branch-Move to London").click();
      await expect(known(page)).toContainText("Monthly rent: £2,000 per month");
      await expect(page.getByTestId("known-stated-monthlyRent")).toContainText("From your question: “Rent there is £2,000 a month”");

      await openCompare(page, "Stay in Mumbai");
      await expect(page.getByTestId("cmp-differ")).toContainText("Monthly rent");
      await expect(page.getByTestId("cmp-differ")).toContainText("not decided yet");
      // Nothing is the same in both here, so there may be no "same" list at all; if there is one, the rent is not in it.
      await expect(page.getByTestId("cmp-same").filter({ hasText: "Monthly rent" })).toHaveCount(0);
      await expect(page.getByTestId("cmp-not-comparable")).toContainText("add your numbers for: Monthly rent");
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `r20a1-${vp.name}-there-compare`);
      expect(seen.plan).toHaveLength(1);
      expect(seen.other).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test("a bookstore question with a future that does not open: the budget goes to both, the rent only to the future that opens, and Compare keeps shared and undecided apart", async ({ page }, info) => {
      const seen = await serve(page, [r20a.bookstoreOrNot]);
      await ask(page, MISSION_BOOKSTORE);
      await expect(page.getByTestId("figure-variable-0")).toHaveText("Starting budget");
      await expect(page.getByTestId("figure-use-0")).toBeChecked();
      await expect(page.getByTestId("figure-target-0")).toHaveValue("all");
      await expect(page.getByTestId("figure-scope-0")).toContainText("Used in every future in the draft (2).");
      await expect(page.getByTestId("figure-scope-why-0")).toContainText("It is something you have");
      await expect(page.getByTestId("figure-variable-1")).toHaveText("Monthly rent");
      await expect(page.getByTestId("figure-use-1")).toBeChecked();
      await expect(page.getByTestId("figure-target-1")).toHaveValue("f0");
      await expect(page.getByTestId("figure-scope-1")).toContainText("Used only in “Open the bookstore”.");
      await expect(page.getByTestId("figure-scope-why-1")).toContainText("You wrote “expect”, so it follows from what you ask about.");
      await expect(page.getByTestId("figure-scope-why-1")).toContainText("“Don't open it” reads as not doing it (it starts with “don't”), so it is not copied there.");
      await expect(page.getByTestId("figure-scope-why-1")).toContainText("Choose “every future” if it holds there too.");
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `r20a1-${vp.name}-bookstore-panel`);
      await page.getByTestId("figures-confirm").click();
      await expect(page.getByTestId("figures-summary")).toContainText("Using 2 figures from your question: 1 in every future, 1 in the future it was placed in");
      expect(await overflowing(page)).toBe(false);

      await page.getByTestId("explore-future-0").click();
      await expect(page.getByTestId("story-title")).toHaveText("Open the bookstore");
      await expect(known(page)).toContainText("Starting budget: ₹500,000");
      await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
      await expect(page.getByTestId("story-calc-monthsOfRentTheBudgetCovers")).toContainText("14.29 months");

      // The future that does not open has the budget, which is the person's, and not the shop's rent.
      await page.getByTestId("branch-Don't open it").click();
      await expect(known(page)).toContainText("Starting budget: ₹500,000");
      await expect(known(page)).not.toContainText("Monthly rent: ₹35,000");
      await expect(page.getByTestId("question-card")).toContainText("Monthly rent");

      await openCompare(page, "Open the bookstore");
      await expect(page.getByTestId("cmp-same")).toContainText("Starting budget ₹500,000");
      await expect(page.getByTestId("cmp-same")).not.toContainText("Monthly rent");
      await expect(page.getByTestId("cmp-differ")).toContainText("Open the shop");
      await expect(page.getByTestId("cmp-differ")).toContainText("Monthly rent");
      await expect(page.getByTestId("cmp-differ")).toContainText("not decided yet");
      await expect(page.getByTestId("cmp-not-comparable")).toContainText("add your numbers for: Monthly rent");
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `r20a1-${vp.name}-bookstore-compare`);
      expect(seen.plan).toHaveLength(1);
      expect(seen.other).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test("the user can say the rent holds in the future that does not open too, and then Compare shows it as the same in both", async ({ page }) => {
      await serve(page, [r20a.bookstoreOrNot]);
      await ask(page, MISSION_BOOKSTORE);
      await page.getByTestId("figure-target-1").selectOption("all");
      await expect(page.getByTestId("figure-scope-1")).toContainText("Used in every future in the draft (2).");
      // The reason belonged to the proposal; the user has now chosen, so it is no longer shown as if it applied.
      await expect(page.getByTestId("figure-scope-why-1")).toHaveCount(0);
      await page.getByTestId("figures-confirm").click();
      await expect(page.getByTestId("figures-summary")).toContainText("Using 2 figures from your question: 2 in every future");
      await page.getByTestId("explore-future-1").click();
      await expect(page.getByTestId("story-title")).toHaveText("Don't open it");
      await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
      await expect(page.getByTestId("question-card")).toHaveCount(0);
      await openCompare(page, "Open the bookstore");
      await expect(page.getByTestId("cmp-same")).toContainText("Starting budget ₹500,000");
      await expect(page.getByTestId("cmp-same")).toContainText("Monthly rent ₹35,000 per month");
      await expect(page.getByTestId("cmp-not-comparable")).toHaveCount(0);
      expect(await overflowing(page)).toBe(false);
    });

    test("a plain fact that does not say whether it holds if the user does it or not is not placed: nothing is ticked, the panel says so, and choosing a future is enough", async ({ page }, info) => {
      const seen = await serve(page, [r20a.bookstoreOrNot]);
      await ask(page, "What if I opened a bookstore? Rent is ₹35,000 a month.");
      await expect(page.getByTestId("figure-variable-0")).toHaveText("Monthly rent");
      await expect(page.getByTestId("figure-use-0")).not.toBeChecked();
      await expect(page.getByTestId("figure-target-0")).toHaveValue("none");
      await expect(page.getByTestId("figure-scope-why-0")).toHaveText("Your question does not say whether it holds if you do it or not. Choose where to use it.");
      await expect(page.getByTestId("figure-unplaced-0")).toContainText("No future chosen yet");
      await expect(page.getByTestId("figures-unplaced")).toHaveText("“Rent is ₹35,000 a month” has no future yet, so it will not be used unless you choose one.");
      await expect(page.getByTestId("figures-confirm")).toBeDisabled();
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `r20a1-${vp.name}-ambiguous-panel`);

      // Choosing where it holds is the user's decision, and it is all the figure was waiting for.
      await page.getByTestId("figure-target-0").selectOption("f0");
      await expect(page.getByTestId("figure-use-0")).toBeChecked();
      await expect(page.getByTestId("figure-scope-0")).toContainText("Used only in “Open the bookstore”.");
      await expect(page.getByTestId("figures-unplaced")).toHaveCount(0);
      await expect(page.getByTestId("figure-unplaced-0")).toHaveCount(0);
      await expect(page.getByTestId("figures-confirm")).toBeEnabled();
      await page.getByTestId("figures-confirm").click();
      await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question: 1 in the future it was placed in");
      await page.getByTestId("explore-future-0").click();
      await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
      await page.getByTestId("branch-Don't open it").click();
      await expect(known(page)).not.toContainText("Monthly rent: ₹35,000");
      expect(seen.plan).toHaveLength(1);
      expect(seen.errors).toEqual([]);
    });
  });
}

test.describe("R20A.1: other shapes of question", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("two alternatives with different recurring expenses: the savings are shared, the rent stays with the alternative that names it, and the loan, which names neither, is asked about", async ({ page }, info) => {
    const seen = await serve(page, [r20a.housing]);
    await ask(page, HOUSING_Q);
    await expect(page.getByTestId("figure-variable-0")).toHaveText("Savings");
    await expect(page.getByTestId("figure-target-0")).toHaveValue("all");
    await expect(page.getByTestId("figure-variable-1")).toHaveText("Monthly rent");
    await expect(page.getByTestId("figure-target-1")).toHaveValue("f0");
    await expect(page.getByTestId("figure-scope-why-1")).toContainText("Your words name “Rent a flat” and not the other future.");
    await expect(page.getByTestId("figure-variable-2")).toHaveText("Monthly loan payment");
    await expect(page.getByTestId("figure-use-2")).not.toBeChecked();
    await expect(page.getByTestId("figure-target-2")).toHaveValue("none");
    await expect(page.getByTestId("figure-scope-why-2")).toContainText("Other figures in your question belong to one future each, so it is unclear whether this one is the same in all of them. Choose where to use it.");
    // The warning does not block the other two: the user may go on without the loan, but is told before, not after.
    await expect(page.getByTestId("figures-unplaced")).toHaveText("“loan payment would be ₹15,000 a month” has no future yet, so it will not be used unless you choose one.");
    await expect(page.getByTestId("figures-confirm")).toBeEnabled();
    await shot(page, info, "r20a1-housing-panel");

    await page.getByTestId("figure-target-2").selectOption("f1");
    await expect(page.getByTestId("figure-use-2")).toBeChecked();
    await expect(page.getByTestId("figures-unplaced")).toHaveCount(0);
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 3 figures from your question: 1 in every future, 2 in the future they were placed in");

    await page.getByTestId("explore-future-1").click();
    await expect(page.getByTestId("story-title")).toHaveText("Buy a flat");
    await expect(known(page)).toContainText("Savings: ₹300,000");
    await expect(known(page)).toContainText("Monthly loan payment: ₹15,000 per month");
    await expect(known(page)).not.toContainText("Monthly rent: ₹20,000");
    await page.getByTestId("branch-Rent a flat").click();
    await expect(known(page)).toContainText("Savings: ₹300,000");
    await expect(known(page)).toContainText("Monthly rent: ₹20,000 per month");
    await expect(known(page)).not.toContainText("Monthly loan payment: ₹15,000");

    await openCompare(page, "Buy a flat");
    await expect(page.getByTestId("cmp-same")).toContainText("Savings ₹300,000");
    await expect(page.getByTestId("cmp-differ")).toContainText("Monthly rent");
    await expect(page.getByTestId("cmp-differ")).toContainText("Monthly loan payment");
    expect(seen.plan).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });

  test("three futures, two of which open: the rent is offered as every future except the one that does not, one choice covers both, and both get it", async ({ page }, info) => {
    const seen = await serve(page, [r20a.bookstoreTwoWaysOrNot]);
    await ask(page, MISSION_BOOKSTORE);
    await expect(page.getByTestId("future-card-2")).toBeVisible();
    await expect(page.getByTestId("figure-target-0")).toHaveValue("all");
    await expect(page.getByTestId("figure-target-1")).toHaveValue("s0,2");
    await expect(page.getByTestId("figure-scope-1")).toContainText("Used in every future except “Don't open it”.");
    await expect(page.getByTestId("figure-target-1").locator("option", { hasText: "every future except “Don't open it”" })).toHaveCount(1);
    await shot(page, info, "r20a1-three-futures-panel");
    // The same choice at 390 px: the longest option label must not widen the page.
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await overflowing(page)).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 2 figures from your question: 1 in every future, 1 in the futures it was placed in");
    await page.getByTestId("explore-future-2").click();
    await expect(page.getByTestId("story-title")).toHaveText("Open an online shop");
    await expect(known(page)).toContainText("Starting budget: ₹500,000");
    await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
    await page.getByTestId("branch-Open a street shop").click();
    await expect(known(page)).toContainText("Starting budget: ₹500,000");
    await expect(known(page)).toContainText("Monthly rent: ₹35,000 per month");
    await page.getByTestId("branch-Don't open it").click();
    await expect(known(page)).toContainText("Starting budget: ₹500,000");
    await expect(known(page)).not.toContainText("Monthly rent: ₹35,000");
    expect(seen.plan).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });

  test("editing a shared figure into one about the move does not keep 'every future': the loss is said, and the new wording is placed afresh", async ({ page }, info) => {
    const seen = await serve(page, [r20a.relocation]);
    await ask(page, `${MOVE} I have a budget of £2,000 a month for rent.`);
    await expect(page.getByTestId("figure-target-0")).toHaveValue("all");
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question: 1 in every future");

    await editQuestion(page, `${MOVE} My rent there would be £2,000 a month.`);
    expect(seen.plan).toHaveLength(1);
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    await expect(page.getByTestId("figures-edit-note")).toContainText("Not kept: your choice for “£2,000 a month for rent”");
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
    await expect(page.getByTestId("figure-scope-0")).toContainText("Used only in “Move to London”.");
    await shot(page, info, "r20a1-edit-shared-to-specific");
    // Nothing is applied until the user confirms the new reading.
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-1").click();
    await expect(known(page)).not.toContainText("£2,000");
    expect(seen.errors).toEqual([]);
  });

  test("after a confirmation, editing the sentence that asks moves 'there' with it: the old place is not replayed, the move is said, and nothing is applied until confirmed again", async ({ page }, info) => {
    const seen = await serve(page, [r20a.relocation]);
    await ask(page, `${MOVE} Rent there is £2,000 a month.`);
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
    await page.getByTestId("figures-confirm").click();
    await expect(page.getByTestId("figures-summary")).toContainText("Using 1 figure from your question: 1 in the future it was placed in");

    await editQuestion(page, "What if I stayed in Mumbai? Rent there is £2,000 a month.");
    expect(seen.plan).toHaveLength(1);
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    await expect(page.getByTestId("figures-edit-note")).toContainText("Changed: “Rent there is £2,000 a month” was used in “Move to London”; with your new wording it goes in “Stay in Mumbai”. Check that this is right.");
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f1");
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figure-scope-0")).toContainText("Used only in “Stay in Mumbai”.");
    await shot(page, info, "r20a1-edit-asked-sentence");
    // Nothing is applied until the user confirms the new reading: the future that moves gets nothing, the one that stays gets the rent.
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText("Move to London");
    await expect(known(page)).not.toContainText("£2,000");
    await page.getByTestId("branch-Stay in Mumbai").click();
    await expect(known(page)).toContainText("Monthly rent: £2,000 per month");
    expect(seen.errors).toEqual([]);
  });

  test("editing a figure about the move into one the person has does not keep 'Move to London': it is placed by its new wording", async ({ page }) => {
    const seen = await serve(page, [r20a.relocation]);
    await ask(page, `${MOVE} My rent there would be £2,000 a month.`);
    await expect(page.getByTestId("figure-target-0")).toHaveValue("f0");
    await page.getByTestId("figures-confirm").click();

    await editQuestion(page, `${MOVE} I have a budget of £2,000 a month for rent.`);
    expect(seen.plan).toHaveLength(1);
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    await expect(page.getByTestId("figures-edit-note")).toContainText("Not kept: your choice for");
    await expect(page.getByTestId("figure-target-0")).toHaveValue("all");
    await expect(page.getByTestId("figure-scope-0")).toContainText("Used in every future in the draft (2).");
    expect(seen.errors).toEqual([]);
  });

  test("editing only the number keeps a place the user chose, even one the draft would not have proposed", async ({ page }) => {
    const seen = await serve(page, [r20a.bookstoreOrNot]);
    await ask(page, "What if I opened a bookstore? Rent is ₹35,000 a month.");
    await page.getByTestId("figure-target-0").selectOption("all");
    await page.getByTestId("figures-confirm").click();
    await editQuestion(page, "What if I opened a bookstore? Rent is ₹40,000 a month.");
    expect(seen.plan).toHaveLength(1);
    await expect(page.getByTestId("figure-read-0")).toHaveText("₹40,000 per month");
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figure-target-0")).toHaveValue("all");
    await expect(page.getByTestId("figures-edit-note")).toContainText("Kept your choices for");
    expect(seen.errors).toEqual([]);
  });
});
