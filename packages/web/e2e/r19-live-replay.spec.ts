/**
 * R19: the two REAL model replies recorded by `RF_LIVE=1 npm run r19:live` (docs/validation/r19-live-drafts.json),
 * played back in the browser through a mock. No provider is contacted here: this is "recorded-real", not live.
 * It answers: do the figures read from the user's question line up with what a real model drafted?
 *
 * Skipped (not failed) when the recording does not exist, so the default suite never depends on a live step.
 */
import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const recording = here("../../../docs/validation/r19-live-drafts.json");
const shotsDir = here("../../../docs/validation/screenshots/r19/");
mkdirSync(shotsDir, { recursive: true });
const live = existsSync(recording)
  ? (JSON.parse(readFileSync(recording, "utf8")) as { model: string; results: { id: string; question: string; ok: boolean; proposal?: unknown }[] })
  : null;
const reply = (id: string) => live?.results.find((r) => r.id === id);

async function serve(page: Page, proposal: unknown) {
  const seen = { plan: 0, errors: [] as string[], other: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (!url.endsWith("/api/plan")) {
      seen.other.push(url);
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "Not in this test." }) });
    }
    seen.plan++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal, model: `${live!.model} (recorded real reply)`, warnings: [] }) });
  });
  return seen;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${shotsDir}after-recorded-real-${name}.png`, fullPage: true, animations: "disabled" });

test.describe("recorded real model replies", () => {
  test.skip(!live, "docs/validation/r19-live-drafts.json is not present (the live step has not been run)");
  test.use({ viewport: { width: 1440, height: 900 } });

  test("A (bookstore): the real draft's labels and units match the question; one confirmation gives ₹8,000 a month, nothing retyped", async ({ page }) => {
    const a = reply("A")!;
    expect(a.ok).toBe(true);
    const seen = await serve(page, a.proposal);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill(a.question);
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    // R20A: the two amounts that state "per month" are ticked; "₹8,000 rent" does not, so the user ticks it.
    for (const k of [0, 2]) await expect(page.getByTestId(`figure-use-${k}`)).toBeChecked();
    await expect(page.getByTestId("figure-use-1")).not.toBeChecked();
    await expect(page.getByTestId("figure-variable-0")).toHaveText("Monthly sales");
    await expect(page.getByTestId("figure-variable-1")).toHaveText("Monthly rent");
    await expect(page.getByTestId("figure-variable-2")).toHaveText("Other monthly expenses");
    await shot(page, "A-figures-panel");
    await page.getByTestId("figure-use-1").check();
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText("Open Bookstore");
    await expect(page.getByTestId("story-calc-monthlyProfit")).toContainText("₹8,000 per month");
    // None of the three amounts the user wrote is asked for again. The one question left is a yes/no the real model added on its
    // own ("Partnering with an online retailer"), which the user's question never mentioned: a genuine unknown, not a repeat.
    await expect(page.getByTestId("question-card")).toContainText("Partnering with an online retailer");
    for (const label of ["Monthly sales", "Monthly rent", "Other monthly expenses"]) await expect(page.getByTestId("question-card")).not.toContainText(label);
    await shot(page, "A-result");
    // The future where the shop is not opened was not given the amounts.
    await page.getByTestId("branch-Do Not Open").click();
    await expect(page.getByTestId("known-stated-monthlyRent")).toHaveCount(0);
    expect(seen.plan).toBe(1);
    expect(seen.other).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test("B (study plan): the real model made daily study time a CHOICE, so only the weeks are offered and the rest is not forced into a number", async ({ page }) => {
    const b = reply("B")!;
    expect(b.ok).toBe(true);
    const seen = await serve(page, b.proposal);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill(b.question);
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    await expect(page.locator("[data-testid^=figure-row-]")).toHaveCount(1);
    await expect(page.getByTestId("figure-row-0")).toContainText("“exams four weeks away”");
    await expect(page.getByTestId("figure-variable-0")).toHaveText("Weeks until exam");
    await expect(page.getByTestId("figures-unused")).toContainText("“studied two hours daily”");
    await expect(page.getByTestId("figures-unused")).toContainText("“Daily study time” is a choice in this draft, not a number");
    await shot(page, "B-figures-panel");
    await page.getByTestId("figures-confirm").click();
    await page.getByTestId("explore-future-1").click();
    await expect(page.getByTestId("story-title")).toHaveText("Increase to two hours");
    await expect(page.getByTestId("story-known")).toContainText("Weeks until exam: 4 weeks");
    // The choice is already set by the draft for this future: nothing about hours is asked again.
    await expect(page.getByTestId("question-card")).not.toContainText("Daily study time");
    await shot(page, "B-result");
    expect(seen.plan).toBe(1);
    expect(seen.other).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});
