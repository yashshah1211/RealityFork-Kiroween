import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`Atlas toolbar fits and works at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize(viewport);
    await page.goto("/?preview=atlas&atlasQuality=low");
    await page.getByTestId("example-solar").click();
    const atlas = page.getByTestId("atlas");
    await expect(atlas).toBeVisible({ timeout: 10_000 });
    const toolbar = atlas.getByRole("toolbar", { name: "Move between futures" });
    const scenery = toolbar.getByTestId("atlas-scenery").locator("summary");
    const checkControls = async () => {
      for (const control of await toolbar.locator("button:enabled:not(.atlas-recenter), summary").all()) {
        await expect(control).toBeInViewport({ ratio: 1, timeout: 2_000 });
      }
    };

    const down = toolbar.getByTestId("atlas-down");
    await expect(down).toBeEnabled();
    await checkControls();
    await page.getByTestId("atlas-hide-panel").click();
    await checkControls();
    await page.getByTestId("atlas-show-panel").click();

    await scenery.click();
    const sceneryOption = toolbar.getByTestId("atlas-scenery-auto");
    await sceneryOption.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await expect(sceneryOption).toBeInViewport({ ratio: 1, timeout: 2_000 });
    await page.keyboard.press("Escape");
    await expect(scenery).toBeFocused();
    await down.click();
    await expect(atlas.getByTestId("atlas-title")).toHaveText("Electricity prices rise 30%");
    await checkControls();
    await page.keyboard.press("ArrowUp");
    await expect(atlas.getByTestId("atlas-title")).toHaveText("4 kW system, today's prices");
  });
}

test("Explore and Compare show exact saved GBP and INR amounts", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await page.getByTestId("branch-Move to London").click();
  await page.getByTestId("all-details").click();
  await page.getByTestId("tab-define").click();
  await page.getByTestId("var-label").fill("Local fees");
  await page.getByTestId("var-unit").fill("₹");
  await page.getByTestId("add-variable").click();
  await page.getByTestId("tab-branch").click();

  const known = page.getByTestId("story-known");
  const localFees = page.getByTestId("value-localFees");
  await expect(localFees).toHaveValue("");
  await expect(localFees).toHaveAttribute("placeholder", "unknown");
  await expect(known.getByTestId("known-value-localFees")).toHaveCount(0);

  const amounts = [
    { key: "rent", label: "Rent", input: "£1,250.75", shown: "£1,250.75 per month" },
    { key: "movingCost", label: "One-off moving and visa costs", input: "£10,000.25", shown: "£10,000.25" },
    { key: "localFees", label: "Local fees", input: "₹2,345.67", shown: "₹2,345.67" },
  ];
  for (const { key, input } of amounts) {
    const field = page.getByTestId(`value-${key}`);
    await field.fill(input);
    await field.press("Enter");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  }
  const commute = page.getByTestId("value-commuteMinutes");
  await commute.fill("35.5");
  await commute.press("Enter");

  const expectKnownValues = async () => {
    for (const { key, label, shown } of amounts) {
      await expect(known.getByTestId(`known-value-${key}`).locator(".known-text")).toHaveText(`${label}: ${shown}`, { timeout: 2_000 });
    }
    await expect(known.getByTestId("known-value-commuteMinutes").locator(".known-text")).toHaveText("Commute each way: 35.5 minutes");
  };
  await expectKnownValues();
  await page.reload();
  await page.getByTestId("branch-Move to London").click();
  await expectKnownValues();

  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Stay in Mumbai").click();
  const technical = page.getByTestId("cmp-technical");
  await technical.locator("summary").click();
  for (const { label, shown } of amounts) {
    const summary = page.getByTestId("cmp-differ").locator("li", { has: page.getByText(label, { exact: true }) });
    const row = technical.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) });
    await expect(summary.locator(".differ-a")).toHaveText(shown, { timeout: 2_000 });
    await expect(row.getByRole("cell").nth(1)).toHaveText(shown, { timeout: 2_000 });
  }
  const unknownFees = technical.getByRole("row").filter({ has: page.getByRole("cell", { name: "Local fees", exact: true }) });
  await expect(unknownFees.getByRole("cell").nth(2)).toHaveText("unknown");
});
