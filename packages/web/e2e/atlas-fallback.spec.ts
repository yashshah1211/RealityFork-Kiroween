/**
 * 3D Explore preview fallbacks, in the default headless Chromium (SwiftShader, software WebGL): the scene simplifies
 * itself; without WebGL the standard Explore view is shown with the reason; without the flag nothing changes and no
 * 3D code is downloaded.
 */
import { expect, test } from "@playwright/test";
import { guard, isLondonDownload, openExample, PREVIEW, shots, stats } from "./atlas-helpers";

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

test("no WebGL: the standard Explore view, with the reason", async ({ page }) => {
  const g = await guard(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto(PREVIEW);
  await page.getByTestId("example-move-city").click();
  await expect(page.getByTestId("atlas-unavailable")).toContainText("needs WebGL");
  await expect(page.getByTestId("story")).toBeVisible();
  await expect(page.getByTestId("story-title")).toHaveText("Stay in Mumbai");
  expect(g.all.some(isLondonDownload)).toBe(false);
  await page.screenshot({ path: `${shots}12-no-webgl-fallback.png`, animations: "disabled" });
});

test("without the flag nothing changes: the standard Explore view, and no 3D code is loaded", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await expect(page.getByTestId("story")).toBeVisible();
  await expect(page.getByTestId("atlas")).toHaveCount(0);
  await expect(page.getByTestId("atlas-switch")).toHaveCount(0);
  await page.getByTestId("branch-Move to London").click();
  await expect(page.getByTestId("story-title")).toHaveText("Move to London");
  expect(g.all.filter((u) => /AtlasExplore|\/atlas\/scene\/|\/three(\b|_)|three\.module|london_island|draco_/.test(u))).toEqual([]);
  expect(g.api).toEqual([]);
  expect(g.errors).toEqual([]);
});
