/**
 * Task 8 inspection: run the validation journey at desktop, tablet and mobile widths,
 * capture screenshots and measure horizontal overflow. Assertions are limited to the
 * journey working and to the page not overflowing horizontally.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/task8/", import.meta.url));
mkdirSync(dir, { recursive: true });

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-390", width: 390, height: 844 },
];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== "fixed") {
        offenders.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").join(".") : ""}${el.dataset.testid ? `[${el.dataset.testid}]` : ""} right=${Math.round(r.right)}`);
      }
    }
    return { clientWidth: w, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 12) };
  });
}

for (const vp of VIEWPORTS) {
  test(`validation journey at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const log: Record<string, unknown> = {};
    const shot = async (step: string) => {
      await page.screenshot({ path: `${dir}${vp.name}-${step}.png`, fullPage: true });
      log[step] = await overflow(page);
    };

    await page.goto("/#staffing");
    await shot("01-empty");
    await page.getByTestId("load-example").click();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("node-Front desk (today)")).toContainText("Simulated");
    await shot("02-baseline");

    await page.getByTestId("fork-name").fill("Add one staff member");
    await page.getByTestId("fork").click();
    await page.getByTestId("param-servers").fill("3");
    await page.getByTestId("param-servers").press("Enter");
    await expect(page.getByText("was 2")).toBeVisible();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("comparison")).toBeVisible();
    await shot("03-compare");

    // Two-change branch so the sensitivity rows are also inspected at this width.
    await page.getByTestId("node-Front desk (today)").click();
    await page.getByTestId("fork-name").fill("Busier day, extra staff");
    await page.getByTestId("fork").click();
    await page.getByTestId("param-servers").fill("3");
    await page.getByTestId("param-servers").press("Enter");
    await expect(page.getByText("was 2")).toBeVisible();
    await page.getByTestId("param-arrivalRatePerHour").fill("18");
    await page.getByTestId("param-arrivalRatePerHour").press("Enter");
    await expect(page.getByText("was 16")).toBeVisible();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("sensitivity")).toBeVisible();
    await shot("03b-sensitivity");
    await page.getByTestId("node-Add one staff member").click();
    await expect(page.getByTestId("comparison")).toBeVisible();

    await page.getByText("How sure is this?").click();
    await page.getByTestId("reproduce").click();
    await expect(page.getByTestId("repro-status")).toContainText("Reproduced exactly");
    await shot("04-uncertainty-reproduce");

    await page.getByTestId("node-Front desk (today)").click();
    await page.getByTestId("open-data").click();
    await page.getByTestId("load-demo-csv").click();
    await page.getByTestId("estimate").click();
    await expect(page.getByTestId("est-lambda")).toBeVisible();
    await shot("05-csv-estimate");
    await page.getByTestId("apply-estimate").click();
    await expect(page.getByTestId("node-Demand measured from data")).toBeVisible();
    await shot("06-data-branch");

    writeFileSync(`${dir}${vp.name}-overflow.json`, JSON.stringify(log, null, 2));
    for (const [step, o] of Object.entries(log) as [string, { scrollWidth: number; clientWidth: number }][]) {
      expect.soft(o.scrollWidth, `horizontal overflow at ${vp.name} ${step}`).toBeLessThanOrEqual(o.clientWidth);
    }
  });
}
