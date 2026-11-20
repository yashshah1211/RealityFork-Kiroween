/**
 * Final QA correction, in a real browser: a figure from the question is not pre-ticked for futures its words do not
 * support. Reported: the ₹80,000/month salary was ticked for the futures where the job ends and not for staying in it.
 * The draft is a deterministic fixture (r20a-proposals.json, "quitCafe") served by a mocked /api/plan; no live model is
 * contacted and every other /api request is refused. Screenshots go to Playwright's own output folder, never to docs/.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const r20a = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/r20a-proposals.json", import.meta.url)), "utf8"));
const QA = "What if I left my ₹80,000/month software job in Mumbai to open a café? I have ₹10 lakh savings and expect ₹6 lakh setup cost and ₹40,000 monthly rent. Compare quitting to run it full-time, testing a weekend café while employed, and staying in my current job.";

async function serve(page: Page, proposal: unknown) {
  const seen = { plan: 0, other: [] as string[], errors: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  await page.route("**/api/**", (route) => {
    if (!route.request().url().endsWith("/api/plan")) {
      seen.other.push(route.request().url());
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "Not in this test." }) });
    }
    seen.plan++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal, model: "openai/gpt-oss-120b (mocked in this test)", warnings: [] }) });
  });
  return seen;
}

test.describe("a salary the question does not tie to the right futures", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("is not ticked for any future; the user places it in the two futures that keep the job, and Compare follows that choice", async ({ page }) => {
    const seen = await serve(page, r20a.quitCafe);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill(QA);
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("future-card-2")).toBeVisible();

    // Offered for its assumption, but nothing is ticked and no future is chosen; the reason is said.
    await expect(page.getByTestId("figure-variable-0")).toHaveText("Software job salary");
    await expect(page.getByTestId("figure-use-0")).not.toBeChecked();
    await expect(page.getByTestId("figure-target-0")).toHaveValue("none");
    await expect(page.getByTestId("figure-scope-why-0")).toHaveText("You wrote “my”, so it may describe what you have now, which some futures could change. Choose where to use it.");
    await expect(page.getByTestId("figure-unplaced-0")).toBeVisible();
    // The rent (now the fourth row: the two lakh amounts are read since the live-test fix) is not ticked either.
    await expect(page.getByTestId("figure-row-3")).toContainText("₹40,000 monthly rent");
    await expect(page.getByTestId("figure-use-3")).not.toBeChecked();
    await page.screenshot({ path: test.info().outputPath("salary-not-preselected.png"), fullPage: true });

    // With three futures every pair can be chosen: the user picks the two where the job continues.
    await page.getByTestId("figure-target-0").selectOption({ label: "Part-time café and Stay in job" });
    await expect(page.getByTestId("figure-use-0")).toBeChecked();
    await expect(page.getByTestId("figure-scope-0")).toHaveText("Used in “Part-time café” and “Stay in job”.");
    await page.getByTestId("figures-confirm").click();
    // The salary, plus the two lakh amounts their own words place (savings everywhere, setup cost on the two cafés).
    await expect(page.getByTestId("figures-summary")).toContainText("Using 3 figures from your question");

    // On the full-time café the salary is not decided; on staying in the job it is the user's figure.
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText("Full-time café");
    await page.getByTestId("compare-with").click();
    await page.getByTestId("compare-pick-Stay in job").click();
    await expect(page.getByTestId("compare-view")).toBeVisible();
    await expect(page.getByTestId("cmp-head-a")).toContainText("Full-time café");
    const salary = page.getByTestId("cmp-differ").locator("li", { hasText: "Software job salary" });
    await expect(salary.locator(".differ-a")).toHaveText("not decided yet");
    await expect(salary.locator(".differ-b")).toContainText("80,000");
    await page.screenshot({ path: test.info().outputPath("salary-compare.png"), fullPage: true });
    expect(seen.plan).toBe(1);
    expect(seen.other).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});
