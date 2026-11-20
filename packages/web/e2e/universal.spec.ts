/**
 * Universal-platform acceptance test, by hand (no AI): a brand-new situation (not an example) is described,
 * given assumptions and a formula in "All details", branched into two independent realities (plus a nested
 * one), explored on the map, compared, given speculative outcomes, exported, removed and restored.
 * Then the cross-domain examples, the simulator example and the staffing tool are checked.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/universal/", import.meta.url));
mkdirSync(dir, { recursive: true });

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

const node = (page: Page, name: string) => page.getByTestId(`branch-${name}`);
const overflow = (page: Page) => page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));

async function addNumber(page: Page, label: string, unit: string, start: string) {
  await page.getByTestId("var-label").fill(label);
  await page.getByTestId("var-kind").selectOption("number");
  await page.getByTestId("var-unit").fill(unit);
  await page.getByTestId("var-start").fill(start);
  await page.getByTestId("add-variable").click();
  await expect(page.getByTestId("define-panel")).toContainText(label);
}

async function newPath(page: Page, name: string) {
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-name").fill(name);
  await page.getByTestId("fork-create").click();
  await expect(page.getByTestId("story-title")).toHaveText(name);
}

async function setNumber(page: Page, key: string, v: string) {
  await page.getByTestId(`value-${key}`).fill(v);
  await page.getByTestId(`value-${key}`).press("Enter");
}

for (const vp of VIEWPORTS) {
  test(`acceptance: a brand-new situation at ${vp.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const widths: Record<string, { clientWidth: number; scrollWidth: number }> = {};
    const shot = async (step: string) => {
      await page.screenshot({ path: `${dir}${vp.name}-${step}.png`, fullPage: true, animations: "disabled" });
      widths[step] = await overflow(page);
    };

    // 1–2. Open and type a situation that is not an example; start a blank map.
    await page.goto("/");
    await expect(page.getByText("What if", { exact: true })).toBeVisible();
    await shot("01-home");
    await page.getByTestId("whatif-input").fill("our family adopted a dog?");
    await page.getByTestId("start-blank").click();
    await expect(page.getByTestId("question")).toHaveText("What if our family adopted a dog?");
    await expect(node(page, "Today")).toBeVisible();

    // 3. Define its assumptions and a calculated outcome (the editor opens straight away).
    await expect(page.getByTestId("define-panel")).toBeVisible();
    await addNumber(page, "Monthly food cost", "£ per month", "40");
    await page.getByTestId("var-label").fill("Dog size");
    await page.getByTestId("var-kind").selectOption("category");
    await page.getByTestId("var-options").fill("small, large");
    await page.getByTestId("var-start").fill("small");
    await page.getByTestId("add-variable").click();
    await expect(page.getByTestId("var-dogSize")).toContainText("one of: small, large");
    await addNumber(page, "Vet bills", "£ per year", "");
    await page.getByTestId("f-label").fill("Yearly cost");
    await page.getByTestId("f-expr").fill("monthlyFood * 12 + vetBills");
    await expect(page.getByTestId("f-check")).toContainText("unknown name: monthlyFood");
    await expect(page.getByTestId("add-formula")).toBeDisabled();
    await page.getByTestId("f-expr").fill("monthlyFoodCost * 12 + vetBills");
    await page.getByTestId("f-unit").fill("£");
    await page.getByTestId("add-formula").click();
    await expect(page.getByTestId("formula-yearlyCost")).toBeVisible();
    await shot("02-define");

    // The starting reality cannot calculate the yearly cost yet: the vet bills are unknown.
    await expect(page.getByTestId("story-calc-yearlyCost")).toContainText("needs Vet bills");
    await expect(page.getByTestId("question-card")).toContainText("Vet bills");
    await page.getByTestId("tab-branch").click();
    await expect(page.getByTestId("calc-yearlyCost")).toContainText("Needs: Vet bills");

    // 4. Two alternative realities.
    await newPath(page, "Small dog");
    await node(page, "Today").click();
    await newPath(page, "Large dog");

    // 5. Modify each independently (in All details, which stays open).
    await setNumber(page, "monthlyFoodCost", "90");
    await page.getByTestId("value-dogSize").selectOption("large");
    await setNumber(page, "vetBills", "600");
    await expect(page.getByTestId("calc-yearlyCost")).toContainText("£1,680");
    await expect(page.getByTestId("story-calc-yearlyCost")).toContainText("£1,680");
    await page.getByTestId("possibility-text").fill("Needs a bigger car");
    await page.getByTestId("possibility-likelihood").selectOption("likely");
    await page.getByTestId("add-possibility").click();
    await expect(page.getByTestId("speculative")).toContainText("Needs a bigger car");

    await node(page, "Small dog").click();
    await setNumber(page, "vetBills", "250");
    await expect(page.getByTestId("calc-yearlyCost")).toContainText("£730");
    await page.getByTestId("possibility-text").fill("More walks for everyone");
    await page.getByTestId("add-possibility").click();
    await node(page, "Today").click();
    await expect(page.getByTestId("value-monthlyFoodCost")).toHaveValue("40");
    await expect(page.getByTestId("calc-yearlyCost")).toContainText("Needs: Vet bills");

    // 6. Branch an existing branch, and navigate the history on the map.
    await node(page, "Large dog").click();
    await newPath(page, "Large dog with a walker");
    await expect(page.getByTestId("branch-panel")).toContainText("Branched from");
    await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(4);
    await expect(page.getByTestId("map").locator(".edges path")).toHaveCount(3);
    await expect(page.getByTestId("map").locator(".edges path.lit")).toHaveCount(2);
    await page.getByTestId("branch-panel").getByRole("button", { name: "Large dog", exact: true }).click();
    await expect(page.getByTestId("branch-name")).toHaveValue("Large dog");
    await shot("03-map");

    // 7. Compare two alternatives.
    await node(page, "Small dog").click();
    await page.getByTestId("compare-with").click();
    await page.getByTestId("compare-pick-Large dog").click();
    await expect(page.getByTestId("compare-view")).toBeVisible();
    await expect(page.getByTestId("cmp-calc-yearlyCost")).toContainText("+£950");
    await expect(page.getByTestId("cmp-differ")).toContainText("Dog size");
    await expect(page.getByTestId("compare-view")).toContainText("More walks for everyone");
    await expect(page.getByTestId("compare-view")).toContainText("Needs a bigger car");
    await page.getByTestId("cmp-technical").locator("summary").click();
    await expect(page.getByTestId("cmp-yearlyCost")).toContainText("+£950");
    await shot("04-compare");

    // 9. Export, remove, restore.
    await page.getByTestId("more-menu").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("export-realities").click();
    const path = await (await download).path();
    await page.getByTestId("more-menu").click();
    await page.getByTestId("reset-realities").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("Remove your map from this browser?");
    await page.getByTestId("confirm-accept").click();
    await expect(page.getByTestId("whatif-input")).toBeVisible();
    await expect(page.getByTestId("open-What if our family adopted a dog?")).toHaveCount(0);
    await page.getByTestId("import-realities-file").setInputFiles(path);
    await expect(page.getByTestId("notice")).toContainText("Restored 1 reality");
    await page.getByTestId("open-What if our family adopted a dog?").click();
    await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(4);
    await node(page, "Large dog").click();
    await expect(page.getByTestId("story-changes")).toContainText("Monthly food cost: £90 per month");
    await expect(page.getByTestId("story-either")).toContainText("Needs a bigger car");
    await page.getByTestId("all-details").click();
    await expect(page.getByTestId("value-monthlyFoodCost")).toHaveValue("90");
    await expect(page.getByTestId("speculative")).toContainText("Needs a bigger car");

    // Saved in the browser as well: survives a reload.
    await page.reload();
    await expect(page.getByTestId("question")).toHaveText("What if our family adopted a dog?");

    writeFileSync(`${dir}${vp.name}-overflow.json`, JSON.stringify(widths, null, 2));
    for (const [step, o] of Object.entries(widths)) expect.soft(o.scrollWidth, `horizontal overflow at ${vp.name} ${step}`).toBeLessThanOrEqual(o.clientWidth);
    expect(errors).toEqual([]);
  });
}

test("cross-domain examples use the same primitives; the simulator example runs", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(3);
  await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("£650 per month");
  await node(page, "Move to London").click();
  await expect(page.getByTestId("story-calc-yearlySavings")).toContainText("needs One-off moving and visa costs");
  await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("suggested formula");
  await node(page, "Stay in Mumbai").click();
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Move to London").click();
  await expect(page.getByTestId("cmp-calc-monthlySavings")).toContainText("+£50 per month");
  await page.screenshot({ path: `${dir}desktop-1440-05-example-move.png`, fullPage: true, animations: "disabled" });

  await page.getByTestId("home").click();
  await page.getByTestId("example-solar").click();
  await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(4);
  await expect(page.getByTestId("story-calc-paybackYears")).toContainText("8.3 years");
  await node(page, "Shaded roof, no export payments").click();
  await expect(page.getByTestId("story-calc-paybackYears")).toContainText("doesn't apply with these numbers");
  await page.screenshot({ path: `${dir}desktop-1440-06-example-solar.png`, fullPage: true, animations: "disabled" });

  await page.getByTestId("home").click();
  await page.getByTestId("example-cafe-queue").click();
  await page.getByTestId("run-sim-queueWait").click();
  await expect(page.getByTestId("sim-queueWait")).toContainText("likely range", { timeout: 30_000 });
  await expect(page.getByTestId("sim-queueWait")).toContainText("queue.mmc@1.1.0");
  await page.screenshot({ path: `${dir}desktop-1440-07-example-cafe.png`, fullPage: true, animations: "disabled" });

  // The specialized staffing tool is still reachable.
  await page.getByTestId("home").click();
  await page.getByTestId("more-menu").click();
  await page.getByTestId("open-staffing").click();
  await expect(page.getByText("See when demand is highest. Explore when extra staff would help most.")).toBeVisible();
});
