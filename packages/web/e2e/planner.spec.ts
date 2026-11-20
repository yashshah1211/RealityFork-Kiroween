/**
 * AI planner edge cases in the visual journey. The endpoint is mocked with fixed replies, so these tests make
 * no network calls and use no API key: adjusting the draft before approval, discarding it, free-tier
 * exhaustion falling back to the manual workflow, and the browser-side check rejecting invented figures.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/planner/", import.meta.url));
mkdirSync(dir, { recursive: true });
const proposal = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/restaurant-proposal.json", import.meta.url)), "utf8"));

const mockPlan = (page: Page, status: number, body: unknown) =>
  page.route("**/api/plan", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));

test("adjusting the draft: a dropped assumption takes its formula with it; nothing exists before approval", async ({ page }) => {
  await mockPlan(page, 200, { ok: true, proposal, model: "openai/gpt-oss-120b (mocked in this test)", warnings: [] });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill("What if I started my own restaurant?");
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("plan-interpretation")).toContainText("small independent place");
  await expect(page.getByTestId("discover")).toContainText("Every number will come from you");
  await page.getByTestId("discover-uncertainties").locator("summary").click();
  await expect(page.getByTestId("discover-uncertainties")).toContainText("Rents for suitable premises in your area");
  await expect(page.getByTestId("discover-uncertainties")).toContainText("every number must come from you");
  await page.getByTestId("discover-adjust").locator("summary").click();
  await page.getByTestId("keep-variables-4").uncheck(); // Start-up cost
  await expect(page.getByTestId("formula-dropped-1")).toContainText("Needs something you left out");
  await page.getByTestId("keep-possibilities-0").uncheck(); // Full control over the menu and atmosphere
  await page.screenshot({ path: `${dir}desktop-adjust.png`, fullPage: true, animations: "disabled" });
  // Nothing has been created yet.
  expect(await page.evaluate(() => localStorage.getItem("realityfork.realities.v1"))).toBeNull();
  await page.getByTestId("explore-future-0").click();

  await expect(page.getByTestId("story-title")).toHaveText("Small café, owner-run");
  await expect(page.getByTestId("story-calc-profitPerMonth")).toBeVisible();
  await expect(page.getByTestId("story-calc-monthsToEarnBackTheStartUpCost")).toHaveCount(0);
  await expect(page.getByTestId("story-unknowns")).not.toContainText("Start-up cost");
  await expect(page.getByTestId("story-upsides")).not.toContainText("Full control over the menu");
  await expect(page.getByTestId("story-challenges")).toContainText("Long hours leave little time for family");
  // Provenance is visible on request.
  await page.locator(".about summary").click();
  await expect(page.locator(".about-body")).toContainText("Drafted by openai/gpt-oss-120b (mocked in this test) and accepted by you");
  await expect(page.locator(".about-body")).toContainText("every number must come from you");
  // The AI's "every future" possibility sits with each future, sorted as "either way".
  await expect(page.getByTestId("story-either")).toContainText("Local competition changes");
  // All details still offers the full editors for the accepted map.
  await page.getByTestId("all-details").click();
  await expect(page.getByTestId("value-monthlyRevenue")).toHaveValue("");
  await expect(page.getByTestId("calc-profitPerMonth")).toContainText("example formula");
  await page.getByTestId("tab-define").click();
  await expect(page.getByTestId("formula-profitPerMonth")).toContainText("monthlyRevenue - monthlyCosts");
});

test("discard returns to the question; free-tier exhaustion falls back to the manual workflow", async ({ page }) => {
  await mockPlan(page, 200, { ok: true, proposal, model: "mock", warnings: [] });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill("What if I started my own restaurant?");
  await page.getByTestId("explore-possibilities").click();
  await page.getByTestId("discard-plan").click();
  await expect(page.getByTestId("discover")).toHaveCount(0);
  await expect(page.getByTestId("whatif-input")).toHaveValue("What if I started my own restaurant?");
  await expect(page.getByTestId("map")).toHaveCount(0);

  await page.unroute("**/api/plan");
  await mockPlan(page, 429, { ok: false, code: "quota", message: "The free daily allowance for the AI planner is used up. It resets automatically; you can keep working by hand meanwhile." });
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("plan-error")).toContainText("Today's free AI allowance is used up");
  await expect(page.getByTestId("plan-error")).not.toContainText(/upgrade|billing|pay/i);
  await page.screenshot({ path: `${dir}desktop-quota-fallback.png`, fullPage: true, animations: "disabled" });
  await page.getByTestId("map-it-myself").click();
  await expect(page.getByTestId("define-panel")).toBeVisible();
});

test("safe server-side adjustments are disclosed without hiding the futures", async ({ page }) => {
  await mockPlan(page, 200, {
    ok: true, proposal, model: "mock",
    warnings: ["Left out 1 AI-suggested formula(s) that failed checks."],
  });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill("What if I moved to another country?");
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("future-card-0")).toBeVisible();
  await page.getByTestId("discover-uncertainties").locator("summary").click();
  await expect(page.getByTestId("draft-adjustments")).toContainText("Left out 1 AI-suggested formula");
});

test("a reply with an invented figure is rejected in the browser too", async ({ page }) => {
  await mockPlan(page, 200, { ok: true, proposal: { ...proposal, interpretation: "Most restaurants fail, about 60% in year one." }, model: "mock" });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill("What if I started my own restaurant?");
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("plan-error")).toContainText("The AI's draft didn't pass our checks");
  await expect(page.getByTestId("plan-error")).toContainText("states a figure");
  await expect(page.getByTestId("retry-plan")).toBeVisible();
});
