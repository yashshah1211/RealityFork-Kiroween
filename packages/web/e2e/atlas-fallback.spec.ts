/**
 * 3D Explore preview fallbacks, in the default headless Chromium (SwiftShader, software WebGL): the scene simplifies
 * itself. The default landing keeps its flat fallback and the standard Explore view remains available.
 */
import { expect, test, type Page } from "@playwright/test";
import { guard, isLondonDownload, openExample, PREVIEW, stats } from "./atlas-helpers";

async function disableWebGL(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

test("software rendering (SwiftShader): the scene simplifies itself and stays usable", async ({ page }) => {
  test.setTimeout(240_000);
  const g = await guard(page);
  await openExample(page, "move-city");
  await expect.poll(async () => (await stats(page))?.gpu ?? "", { timeout: 30_000 }).toContain("SwiftShader");
  await page.getByTestId("atlas-down").click();
  await expect(page.getByTestId("atlas-title")).toHaveText("Move to London");
  await expect(page.getByTestId("atlas-simplified")).toBeVisible({ timeout: 90_000 });
  expect((await stats(page))!.quality).toBe("low");
  await expect(page.getByTestId("atlas-branch")).toBeEnabled();
  expect(g.api).toEqual([]);
});

test("no WebGL: the standard Explore view, with the reason", async ({ page }, info) => {
  const g = await guard(page);
  await disableWebGL(page);
  await page.goto(PREVIEW);
  await page.getByTestId("example-move-city").click();
  await expect(page.getByTestId("atlas-unavailable")).toContainText("needs WebGL");
  await expect(page.getByTestId("story")).toBeVisible();
  await expect(page.getByTestId("story-title")).toHaveText("Stay in Mumbai");
  expect(g.all.some(isLondonDownload)).toBe(false);
  await page.screenshot({ path: info.outputPath("flagged-no-webgl-fallback.png"), animations: "disabled" });
});

test("root uses standard Explore without loading the 3D map or London model", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await expect(page.getByTestId("story")).toBeVisible();
  await expect(page.getByTestId("atlas")).toHaveCount(0);
  await expect(page.getByTestId("atlas-switch")).toHaveCount(0);
  await page.getByTestId("branch-Move to London").click();
  await expect(page.getByTestId("story-title")).toHaveText("Move to London");
  expect(g.all.filter((u) => /AtlasExplore|london_island|draco_/.test(u))).toEqual([]);
  expect(g.api).toEqual([]);
  expect(g.errors).toEqual([]);
});

const hollowEntry = (page: Page) => page.getByRole("button", { name: "Enter The Hollow", exact: true });
const hollow = (page: Page) => page.getByRole("dialog", { name: "The Hollow", exact: true });

async function expectLandingWorld(page: Page) {
  await expect(page.getByTestId("imagine-world").locator("canvas")).toHaveCSS("opacity", "1", { timeout: 15_000 });
  await expect(hollowEntry(page)).toBeVisible();
}

test("root has the 3D landing and keyboard Hollow navigation at reduced motion", async ({ page }, info) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expectLandingWorld(page);

  await page.getByTestId("explore-possibilities").focus();
  await page.keyboard.press("Tab");
  await expect(hollowEntry(page)).toBeFocused();
  await expect(page.getByTestId("hollow-entry-label").getByText("Press Enter")).toBeVisible();
  await page.screenshot({ path: info.outputPath("desktop-home.png"), animations: "disabled" });
  await page.keyboard.press("Enter");
  await expect(hollow(page)).toHaveAttribute("data-phase", "exploring");
  await page.keyboard.press("Escape");
  await expect(hollow(page)).toHaveCount(0);
  await expect(hollowEntry(page)).toBeFocused();
  await page.getByTestId("whatif-input").fill("our family adopted a dog?");
  await page.getByTestId("start-blank").click();
  await expect(page.getByTestId("question")).toHaveText("What if our family adopted a dog?");
  await expect(page.getByTestId("define-panel")).toBeVisible();
  expect(g.api).toEqual([]);
  expect(g.errors).toEqual([]);
});

test("legacy Atlas links still show the 3D landing and open maps in 3D", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/?preview=atlas");
  await expectLandingWorld(page);
  await page.getByTestId("example-solar").click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  await expect(page.getByTestId("atlas-title")).toHaveText("4 kW system, today's prices");
  expect(g.api).toEqual([]);
});

test("root without WebGL keeps the flat landing and a usable manual planner", async ({ page }, info) => {
  const g = await guard(page);
  await disableWebGL(page);
  await page.goto("/");
  await expect(page.getByTestId("imagine")).toHaveClass(/\bflat\b/);
  await expect(page.getByTestId("imagine-world")).toHaveCount(0);
  await expect(hollowEntry(page)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("no-webgl-home.png"), animations: "disabled" });

  await page.getByTestId("whatif-input").fill("our family adopted a dog?");
  await page.getByTestId("start-blank").click();
  await expect(page.getByTestId("question")).toHaveText("What if our family adopted a dog?");
  await expect(page.getByTestId("define-panel")).toBeVisible();
  await page.getByTestId("var-label").fill("Monthly food cost");
  await page.getByTestId("var-unit").fill("£ per month");
  await page.getByTestId("var-start").fill("40");
  await page.getByTestId("add-variable").click();
  await expect(page.getByTestId("var-monthlyFoodCost")).toContainText("Monthly food cost");
  expect(g.api).toEqual([]);
  expect(g.errors).toEqual([]);
});

async function tapHollowIsland(page: Page) {
  const entry = hollowEntry(page);
  await entry.scrollIntoViewIfNeeded();
  const bounds = (await entry.boundingBox())!;
  // The keyboard button marks the island, while the canvas receives touch input.
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

test.describe("mobile default landing", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });

  test("root fits the viewport and the Hollow touch entry and return work", async ({ page }, info) => {
    const g = await guard(page);
    await page.goto("/");
    await expectLandingWorld(page);
    await expect(page.getByTestId("whatif-input")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await tapHollowIsland(page);
    await expect(page.getByTestId("hollow-entry-label").getByText("Tap to enter")).toBeVisible();
    await expect(hollow(page)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("mobile-home.png"), animations: "disabled" });
    await tapHollowIsland(page);
    await expect(hollow(page)).toHaveAttribute("data-phase", "exploring");
    await page.getByRole("button", { name: "Return to Multiverse", exact: true }).tap();
    await expect(hollow(page)).toHaveCount(0);
    await expect(hollowEntry(page)).toBeVisible();
    expect(g.api).toEqual([]);
    expect(g.errors).toEqual([]);
  });
});
