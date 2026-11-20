/**
 * Independent QA release blockers, in a real browser. The café draft is the RECORDED LIVE reply (sprint-live-drafts.json)
 * served by a mocked /api/plan; the solar map is the built-in example. No live model; every other /api request is refused.
 *  1. A figure can be marked as not applying to a path: it is not asked again there, the calculation that needs it does
 *     not apply there, and Compare says so instead of setting 0 against a number. A side made only of zeros is said.
 *  2. A question over the limit is stopped at the form, with the count and the limit, before any request; the text stays.
 *  3. The trade-off's summary agrees with the possibilities listed under it (solar: the battery's outage backup).
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const live = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/sprint-live-drafts.json", import.meta.url)), "utf8"));
const cafe = live.cafe as { question: string; model: string; warnings: string[]; proposal: { branches: { name: string }[] } };
const LIMIT = 500;

async function guard(page: Page) {
  const seen = { plan: 0, other: [] as string[], errors: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  await page.route("**/api/**", (route) => {
    if (!route.request().url().endsWith("/api/plan")) {
      seen.other.push(route.request().url());
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "Not in this test." }) });
    }
    seen.plan++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: cafe.proposal, model: `${cafe.model} (recorded live reply, replayed)`, warnings: cafe.warnings }) });
  });
  return seen;
}
const overflowing = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test.describe("QA 2: a question over the limit is stopped at the form", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the count and the limit are shown, nothing is sent, the page stays, the text is kept; shortened, it goes", async ({ page }) => {
    const seen = await guard(page);
    await page.goto("/");
    const long = `I quit my software job in Mumbai to open a café near the station? ${"I earn ₹80,000 a month, have ₹10 lakh saved, and rent near the station is about ₹60,000. ".repeat(6)}`;
    expect(long.length).toBeGreaterThan(LIMIT);
    await page.getByTestId("whatif-input").fill(long);
    await expect(page.getByTestId("whatif-count")).toContainText(`of ${LIMIT} characters`);
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("whatif-help")).toContainText(`questions can be up to ${LIMIT}. Shorten it by`);
    await expect(page.getByTestId("whatif-help")).toContainText("Your text is kept.");
    await expect(page.getByTestId("whatif-input")).toHaveAttribute("aria-invalid", "true");
    // Enter does the same as the button.
    await page.getByTestId("whatif-input").press("Enter");
    await expect(page.getByTestId("imagine")).toBeVisible();
    await expect(page.getByTestId("discover")).toHaveCount(0);
    await expect(page.getByTestId("whatif-input")).toHaveValue(long);
    expect(seen.plan).toBe(0);
    await page.screenshot({ path: test.info().outputPath("qa2-too-long.png"), fullPage: true });
    // Shortened by the user: the message goes and the question is explored.
    const short = long.slice(0, LIMIT - 20);
    await page.getByTestId("whatif-input").fill(short);
    await expect(page.getByTestId("whatif-help")).not.toContainText("Shorten it by");
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("future-card-0")).toBeVisible();
    expect(seen.plan).toBe(1);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("QA 3: the trade-off's summary agrees with what is listed under it", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("solar: start vs “Add a battery” does not claim both list the same, and the battery's outage backup is marked as its own", async ({ page }) => {
    const seen = await guard(page);
    await page.goto("/");
    await page.getByTestId("example-solar").click();
    await expect(page.getByTestId("story")).toBeVisible();
    await page.getByTestId("branch-4 kW system, today's prices").click();
    await page.getByTestId("compare-with").click();
    await page.getByTestId("compare-pick-Add a battery").click();
    await expect(page.getByTestId("compare-view")).toBeVisible();
    await expect(page.getByTestId("trade-same")).toHaveCount(0);
    await expect(page.getByTestId("trade-unsorted")).toContainText("Some are listed for one path only");
    const backup = page.getByTestId("cmp-either").locator("li", { hasText: "Backup power during outages" });
    await expect(backup).toContainText("Could go either way on “Add a battery”");
    await expect(page.getByTestId("cmp-either").locator("li", { hasText: "Roof may need repairs first" })).toContainText("Listed in both");
    // Two paths that really list the same: the sentence is used, and is true.
    await page.getByTestId("continue-a").click();
    await page.getByTestId("branch-Electricity prices rise 30%").click();
    await page.getByTestId("compare-with").click();
    await page.getByTestId("compare-pick-Shaded roof, no export payments").click();
    await expect(page.getByTestId("trade-same")).toBeVisible();
    expect(seen.errors).toEqual([]);
  });
});

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test.describe(`QA 1 (${vp.name}): what does not apply to a future is not asked for and not compared as 0`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("café vs staying at the job: one click says the café's revenue doesn't apply to the job; Compare explains instead of showing 7,000 against 0", async ({ page }) => {
      const seen = await guard(page);
      await page.goto("/");
      await page.getByTestId("whatif-input").fill(cafe.question);
      await page.getByTestId("explore-possibilities").click();
      await expect(page.getByTestId("future-card-1")).toBeVisible();
      await page.getByTestId("explore-future-1").click();
      await expect(page.getByTestId("story-title")).toHaveText("Stay at Job");
      // The first thing asked is the café's revenue, on the path that keeps the job: it does not apply here.
      await expect(page.getByTestId("question-card")).toContainText("Café monthly revenue");
      await page.getByTestId("not-applicable").click();
      await expect(page.getByTestId("question-card")).not.toContainText("Café monthly revenue");
      await expect(page.getByTestId("known-na-cafeRevenue")).toContainText("Café monthly revenue: doesn't apply to this path");
      await expect(page.getByTestId("story-calculated")).toContainText("does not apply to this path");

      // Compare with opening the café: the profit is worked out there and not compared here; nothing is asked of the job path for it.
      await page.getByTestId("compare-with").click();
      await page.getByTestId("compare-pick-Open Café").click();
      await expect(page.getByTestId("compare-view")).toBeVisible();
      await expect(page.getByTestId("cmp-differ").locator("li", { hasText: "Café monthly revenue" })).toContainText("doesn't apply");
      await expect(page.getByTestId("cmp-not-applicable")).toContainText("Net café profit per month doesn't apply to “Stay at Job”");
      await expect(page.getByTestId("cmp-not-applicable")).toContainText("so it is not compared");
      await expect(page.getByTestId("settle-a-cafeRevenue-input")).toHaveCount(0);
      await expect(page.getByTestId("settle-b-cafeRevenue-input")).toHaveCount(0);
      await expect(page.getByTestId("settle-b-cafeCosts-input")).toHaveCount(0);
      await expect(page.getByTestId("cmp-worked")).not.toContainText("Net café profit per month (no unit given)");
      expect(await overflowing(page)).toBe(false);
      await page.screenshot({ path: test.info().outputPath(`qa1-${vp.name}-not-applicable.png`), fullPage: true });

      // Undo it and type zeros instead (what the tester had to do): the numbers show, but no gain is claimed and the reason is said.
      await page.getByTestId("continue-a").click();
      await page.getByTestId("known-na-undo-cafeRevenue").click();
      await expect(page.getByTestId("known-na-cafeRevenue")).toHaveCount(0);
      await page.getByTestId("compare-with").click();
      await page.getByTestId("compare-pick-Open Café").click();
      // Compare was opened from “Stay at Job”, so it is A here and “Open Café” is B.
      await expect(page.getByTestId("cmp-head-a")).toContainText("Stay at Job");
      for (const [side, key, value] of [["b", "cafeRevenue", "18000"], ["b", "cafeCosts", "11000"], ["a", "cafeRevenue", "0"], ["a", "cafeCosts", "0"]] as const) {
        await page.getByTestId(`settle-${side}-${key}-input`).fill(value);
        await page.getByTestId(`settle-${side}-${key}-save`).click();
        await expect(page.getByTestId(`settle-${side}-${key}-input`)).toHaveCount(0);
      }
      const zero = page.locator("[data-testid^=cmp-all-zero-]");
      await expect(zero).toContainText("Every figure behind this is 0 on “Stay at Job”");
      await expect(page.getByTestId("cmp-worked")).toContainText("Worked out from: Café monthly revenue, Café monthly operating costs. Nothing else is included.");
      await expect(page.getByTestId("cmp-worked").locator("li", { hasText: "Net café profit per month" })).not.toContainText("B − A");
      // One click turns the zeros into "doesn't apply", and the comparison says so.
      await page.locator("[data-testid^=cmp-mark-na-]").click();
      await expect(page.getByTestId("cmp-not-applicable")).toContainText("Net café profit per month doesn't apply to “Stay at Job”");
      // Branching and saved inputs are intact: the café's own figures are still on its path.
      await page.getByTestId("continue-b").click();
      await expect(page.getByTestId("story-title")).toHaveText("Open Café");
      await expect(page.getByTestId("story-known")).toContainText("Café monthly revenue: 18,000");
      await expect(page.getByTestId("story-calculated")).toContainText("7,000");
      expect(seen.plan).toBe(1);
      expect(seen.other).toEqual([]);
      expect(seen.errors).toEqual([]);
    });
  });
}
