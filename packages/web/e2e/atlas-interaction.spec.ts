/**
 * 3D Explore preview: keyboard, reduced motion, a London model that fails to load, and a 390 px phone, on the
 * machine GPU. No AI and no network.
 */
import { expect, test } from "@playwright/test";
import { details, GPU, guard, isDracoDownload, isLondonDownload, openExample, settle, shot, stats } from "./atlas-helpers";


test.use({ launchOptions: { args: GPU }, viewport: { width: 1440, height: 900 } });

test("solar needs no London asset; keyboard moves between futures; O and Escape switch views", async ({ page }) => {
  const g = await guard(page);
  await openExample(page, "solar");
  await settle(page);
  expect(g.all.some(isLondonDownload)).toBe(false);
  expect(g.all.some(isDracoDownload)).toBe(false);
  // Focus starts on the selected future's heading.
  await expect(page.getByTestId("atlas-title")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("atlas-title")).toHaveText("Electricity prices rise 30%");
  await expect(page.getByTestId("atlas-title")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("atlas-title")).toHaveText("Add a battery");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("atlas-title")).toHaveText("Shaded roof, no export payments");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("atlas-title")).toHaveText("Add a battery");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("atlas-title")).toHaveText("4 kW system, today's prices");
  await page.keyboard.press("o");
  await expect(page.getByTestId("atlas-overview")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("atlas-focus")).toHaveAttribute("aria-pressed", "true");
  // The buttons do the same for pointer and touch users.
  await page.getByTestId("atlas-down").click();
  await expect(page.getByTestId("atlas-title")).toHaveText("Electricity prices rise 30%");
  await page.getByTestId("atlas-up").click();
  await expect(page.getByTestId("atlas-title")).toHaveText("4 kW system, today's prices");
  // Answering a question in the panel goes through the store like the standard view.
  expect(g.api).toEqual([]);
  expect(g.errors).toEqual([]);
});

test("reduced motion: futures change place at once; with motion they glide", async ({ page }) => {
  await guard(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openExample(page, "solar");
  await settle(page);
  await page.getByTestId("atlas-node-Add a battery").click();
  await page.waitForTimeout(120);
  expect((await stats(page))!.settled).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByTestId("atlas-crumb-4 kW system, today's prices").click();
  await page.waitForTimeout(120);
  expect((await stats(page))!.settled).toBe(false);
  await settle(page);
});

test("if the London model fails to load, London is drawn as a city island, the map still works, and Try again loads it", async ({ page }) => {
  const g = await guard(page);
  await page.route(isLondonDownload, (route) => route.fulfill({ status: 404, body: "not found" }));
  await openExample(page, "move-city");
  await expect(page.getByTestId("atlas-model-failed")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("atlas-node-Move to London").click();
  await expect(page.getByTestId("atlas-title")).toHaveText("Move to London");
  await expect(page.getByTestId("atlas-world")).toHaveText("The detailed London model could not be loaded, so this path is drawn as a city island instead.");
  await settle(page);
  expect((await stats(page))!.islands.every((x) => x.visual === "kit" && x.family === "urban")).toBe(true);
  await details(page);
  await expect(page.getByTestId("atlas-calc-monthlySavings")).toContainText("£700 per month");
  await shot(page, "11-model-failed-fallback");
  await page.unroute(isLondonDownload);
  await page.getByTestId("atlas-model-retry").click();
  await expect(page.getByTestId("atlas-model-failed")).toBeHidden({ timeout: 30_000 });
  await settle(page, { model: true });
  expect((await stats(page))!.islands.filter((x) => x.visual === "london-full")).toHaveLength(1);
  await expect(page.getByTestId("atlas-world")).toHaveText("Shown as London: City is London on this path.");
  expect(g.api).toEqual([]);
  // The 404 is the only error, from the request this test refused on purpose.
  expect(g.errors.filter((e) => !e.includes("404"))).toEqual([]);
});

test("mobile, 390 px: the panel is a sheet, the world keeps the top of the screen", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openExample(page, "move-city");
  await settle(page, { model: true });
  await page.getByTestId("atlas-down").click();
  await expect(page.getByTestId("atlas-title")).toHaveText("Move to London");
  await settle(page);
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  // Touch-sized controls.
  for (const id of ["atlas-up", "atlas-down", "atlas-focus", "atlas-overview", "atlas-branch"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  }
  await shot(page, "10-mobile-390");
  await page.getByTestId("atlas-hide-panel").click();
  await settle(page);
  await shot(page, "10b-mobile-390-panel-hidden");
  await page.getByTestId("atlas-show-panel").click();
  await expect(page.getByTestId("atlas-title")).toHaveText("Move to London");
  expect(g.api).toEqual([]);
  expect(g.errors).toEqual([]);
});
