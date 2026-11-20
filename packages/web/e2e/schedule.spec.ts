/**
 * Decision-experience sprint: staffing-schedule journey at 1440, 768 and 390 px.
 * Load example → inspect demand → three alternatives (+ one new fork) → edit the peak schedule →
 * run → compare → cost breakdown → reproduce → export/import. Screenshots and timings are written
 * to docs/validation/screenshots/schedule/ and docs/validation/schedule-perf.json.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/schedule/", import.meta.url));
const perfFile = fileURLToPath(new URL("../../../docs/validation/schedule-perf.json", import.meta.url));
mkdirSync(dir, { recursive: true });

const A = "A. Today's staffing";
const B = "B. One more person all day";
const C = "C. One more person at the peak (12:00–14:00)";
const D = "D. Peak and early afternoon";

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-390", width: 390, height: 844 },
];

async function overflow(page: Page) {
  return page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
}

const money = (t: string) => Number(/\$([0-9.]+)/.exec(t)?.[1] ?? Number.NaN);

for (const vp of VIEWPORTS) {
  test(`scheduling decision journey at ${vp.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const widths: Record<string, { clientWidth: number; scrollWidth: number }> = {};
    const shot = async (step: string) => {
      await page.screenshot({ path: `${dir}${vp.name}-${step}.png`, fullPage: true });
      widths[step] = await overflow(page);
    };

    // 1. First screen.
    await page.goto("/#staffing");
    await expect(page.getByText("See when demand is highest. Explore when extra staff would help most.")).toBeVisible();
    await shot("01-start");

    // 2. Load the example: demand is estimated in the browser from the synthetic log.
    await page.getByTestId("load-schedule-example").click();
    for (const n of [A, B, C]) await expect(page.getByTestId(`node-${n}`)).toContainText("Draft");
    await expect(page.getByTestId("demand-chart")).toBeVisible();
    await expect(page.getByTestId("rate-3")).toContainText("24.9");
    await expect(page.getByTestId("staff-count-3")).toContainText("2 staff");
    await page.getByTestId("demand-source").locator("summary").click();
    await expect(page.getByTestId("demand-source")).toContainText("synthetic data");
    await expect(page.getByTestId("demand-table")).toContainText("497");
    await expect(page.getByTestId("manual-line")).toContainText("an assumption, not cash");
    await shot("02-demand");

    // 3. The peak-only alternative differs only at 12:00–14:00.
    await page.getByTestId(`node-${C}`).click();
    await expect(page.getByTestId("staff-count-3")).toContainText("3 staff");
    await expect(page.getByTestId("staff-count-2")).toContainText("2 staff");
    await expect(page.getByTestId(`node-${C}`)).toContainText("Staff on duty 12:00–14:00 2 → 3");

    // 4. Create a fourth alternative from C and edit its schedule with the steppers.
    await page.getByTestId("fork-name").fill(D);
    await page.getByTestId("fork").click();
    await expect(page.getByTestId(`node-${D}`)).toContainText("Draft");
    await page.getByTestId("staff-plus-4").click();
    await expect(page.getByTestId("staff-count-4")).toContainText("3 staff");
    await page.getByTestId("staff-plus-5").click();
    await expect(page.getByTestId("staff-count-5")).toContainText("3 staff");
    await page.getByTestId("staff-minus-5").click();
    await expect(page.getByTestId("staff-count-5")).toContainText("2 staff");
    await expect(page.getByTestId(`node-${D}`)).toContainText("Staff on duty 14:00–16:00 2 → 3");
    await shot("03-edit-schedule");

    // 5. Simulate every draft in the tree and compare.
    const t0 = Date.now();
    await page.getByTestId("run-all").click();
    for (const n of [A, B, C, D]) await expect(page.getByTestId(`node-${n}`)).toContainText("Simulated", { timeout: 60_000 });
    const runMs = Date.now() - t0;
    await expect(page.getByTestId("why")).toBeVisible({ timeout: 60_000 });
    const compareMs = Date.now() - t0;
    await expect(page.getByTestId("why")).toContainText("demand is highest 12:00–14:00");
    await expect(page.getByTestId("wait-chart")).toContainText(A);
    for (const n of [A, B, C, D]) await expect(page.getByTestId(`row-${n}`)).toBeVisible();
    await expect(page.getByTestId(`breakeven-${A}`)).toContainText("starting point");
    const beB = money(await page.getByTestId(`breakeven-${B}`).innerText());
    const beC = money(await page.getByTestId(`breakeven-${C}`).innerText());
    expect(beB).toBeGreaterThan(0);
    expect(beC).toBeGreaterThan(0);
    expect(beC).toBeLessThan(beB); // the model's peak-only option breaks even at a lower waiting value
    await expect(page.getByTestId("incremental")).toContainText("worth it only if waiting is worth more than");
    await shot("04-compare");

    // 6. Cost breakdown and uncertainty.
    await expect(page.getByTestId("cost-table")).toContainText("Scheduled staff");
    await page.getByTestId("futures-uncertainty").locator("summary").click();
    await expect(page.getByTestId("futures-uncertainty")).toContainText("95% confidence intervals");
    await shot("05-uncertainty");

    // 7. Reproduce the peak-only result, and check provenance.
    await page.getByTestId(`node-${C}`).click();
    await page.getByTestId("reproduce").click();
    await expect(page.getByTestId("repro-status")).toContainText("Reproduced exactly");
    await page.getByText("Behind this result", { exact: true }).click();
    await expect(page.getByTestId("provenance")).toContainText("block-rates-csv@0.1.0");
    await expect(page.getByTestId("provenance")).toContainText("frontdesk-daily-SYNTHETIC.csv");
    await shot("06-reproduce");

    // 8. Export and re-import (desktop only), then reproduce from the imported file.
    if (vp.name === "desktop-1440") {
      const rows = await page.getByTestId("cost-table").locator("tbody tr").allInnerTexts();
      const downloadPromise = page.waitForEvent("download");
      await page.getByTestId("export").click();
      const path = await (await downloadPromise).path();
      await page.getByTestId("import-file").setInputFiles(path);
      await expect(page.getByText("Imported 4 scenario(s).")).toBeVisible();
      await page.getByTestId(`node-${D}`).click();
      await page.getByTestId("reproduce").click();
      await expect(page.getByTestId("repro-status")).toContainText("Reproduced exactly");
      await expect(page.getByTestId("staff-count-4")).toContainText("3 staff");
      const perf = existsSync(perfFile) ? JSON.parse(readFileSync(perfFile, "utf8")) : {};
      perf.recordedAt = new Date().toISOString();
      perf.browser = `${test.info().project.name}`;
      perf.desktop = { simulate4ScenariosMs: runMs, simulateAndCompareMs: compareMs, scenarios: 4, repeats: 30, days: 20, costTable: rows };
      writeFileSync(perfFile, JSON.stringify(perf, null, 2));
    } else {
      const perf = existsSync(perfFile) ? JSON.parse(readFileSync(perfFile, "utf8")) : {};
      perf[vp.name] = { simulate4ScenariosMs: runMs, simulateAndCompareMs: compareMs };
      writeFileSync(perfFile, JSON.stringify(perf, null, 2));
    }

    writeFileSync(`${dir}${vp.name}-overflow.json`, JSON.stringify(widths, null, 2));
    for (const [step, o] of Object.entries(widths)) expect.soft(o.scrollWidth, `horizontal overflow at ${vp.name} ${step}`).toBeLessThanOrEqual(o.clientWidth);
    expect(errors).toEqual([]);
  });
}
