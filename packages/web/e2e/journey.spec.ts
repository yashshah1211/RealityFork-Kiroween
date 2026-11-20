import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shots = fileURLToPath(new URL("../../../docs/validation/screenshots/", import.meta.url));
mkdirSync(shots, { recursive: true });
const snap = (page: Page, name: string) => page.screenshot({ path: `${shots}${name}.png`, fullPage: true });

test("load → fork → edit → run → compare → reproduce → import CSV → apply estimate → export/import", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/#staffing");
  await expect(page.getByText("See when demand is highest. Explore when extra staff would help most.")).toBeVisible();
  await snap(page, "00-empty");

  // Load and run the baseline.
  await page.getByTestId("load-example").click();
  const baseNode = page.getByTestId("node-Front desk (today)");
  await expect(baseNode).toBeVisible();
  await page.getByTestId("run").click();
  await expect(baseNode).toContainText("Simulated");
  await expect(page.getByTestId("outcome-meanWait")).toBeVisible();
  await snap(page, "01-baseline");

  // Fork, try an invalid edit, then a valid one.
  await page.getByTestId("fork-name").fill("Add one staff member");
  await page.getByTestId("fork").click();
  const altNode = page.getByTestId("node-Add one staff member");
  await expect(altNode).toContainText("Draft");
  const servers = page.getByTestId("param-servers");
  await servers.fill("2.5");
  await servers.press("Enter");
  await expect(page.getByText("Must be a whole number")).toBeVisible();
  await servers.fill("3");
  await servers.press("Enter");
  await expect(page.getByText("was 2")).toBeVisible();
  await expect(altNode).toContainText("Staff on duty 2 → 3");

  // Run and compare with the parent.
  await page.getByTestId("run").click();
  await expect(altNode).toContainText("Simulated");
  await expect(page.getByTestId("comparison")).toBeVisible();
  await expect(page.getByTestId("cmp-meanWait")).toContainText("Average wait before service is lower in the simulation");
  await expect(page.getByTestId("cmp-utilization")).toContainText("80.0% → 53.3%");
  await expect(page.getByTestId("comparison")).toContainText("not predictions");
  // Explicit trade-off: +1 staff member at $30/h, waiting change and break-even from the results.
  await expect(page.getByTestId("tradeoff-staffing")).toContainText("+$30.00");
  await expect(page.getByTestId("tradeoff-breakeven")).toContainText("Break-even");
  await expect(page.getByTestId("tradeoff-net")).toContainText("not a cash saving");
  await expect(page.getByTestId("cmp-costPerHour")).toHaveCount(0);
  await snap(page, "02-compare");

  // Parent is untouched and locked.
  await baseNode.click();
  await expect(page.getByTestId("param-servers")).toHaveValue("2");
  await expect(page.getByTestId("param-servers")).toBeDisabled();

  // A branch with two changes shows one-change-at-a-time effects and the interaction.
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
  await expect(page.getByTestId("sens-interaction")).toContainText("Interaction");
  await expect(page.getByTestId("sens-params.servers")).toBeVisible();
  await snap(page, "03-sensitivity");

  // Reproduce.
  await altNode.click();
  await page.getByTestId("reproduce").click();
  await expect(page.getByTestId("repro-status")).toContainText("Reproduced exactly");
  await page.getByText("Behind this result", { exact: true }).click();
  await snap(page, "04-reproduce");

  // Import the synthetic CSV, inspect the estimates and apply them to a new fork of the baseline.
  await baseNode.click();
  await page.getByTestId("open-data").click();
  await page.getByTestId("load-demo-csv").click();
  await expect(page.getByTestId("data-panel")).toContainText("frontdesk-arrivals-SYNTHETIC.csv");
  await expect(page.getByTestId("window-start")).toHaveValue("2026-03-02T00:00:00.000Z");
  await page.getByTestId("estimate").click();
  await expect(page.getByTestId("est-lambda")).toContainText("per hour");
  await expect(page.getByTestId("estimate-report")).toContainText("λ̂ = n / T");
  await snap(page, "05-csv-estimate");
  await page.getByTestId("apply-estimate").click();
  const dataNode = page.getByTestId("node-Demand measured from data");
  await expect(dataNode).toContainText("synthetic data");
  await expect(page.getByTestId("detail")).toContainText("frontdesk-arrivals-SYNTHETIC.csv");
  await page.getByTestId("run").click();
  await expect(dataNode).toContainText("Simulated");
  await page.getByText("Behind this result", { exact: true }).click();
  await expect(page.getByTestId("provenance")).toContainText("queue-inputs-csv@1.1.0");
  await expect(page.getByTestId("provenance")).toContainText("sha256");
  await snap(page, "06-data-fork");

  // State survives a reload (validated localStorage bundle).
  await page.reload();
  await expect(page.getByTestId("node-Demand measured from data")).toBeVisible();

  // Export, then re-import in the browser and reproduce from the imported file.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.getByTestId("import-file").setInputFiles(path);
  await expect(page.getByText("Imported 4 scenario(s).")).toBeVisible();
  await page.getByTestId("node-Add one staff member").click();
  await page.getByTestId("reproduce").click();
  await expect(page.getByTestId("repro-status")).toContainText("Reproduced exactly");

  expect(errors).toEqual([]);
});

test("invalid CSV import shows clear errors and does not create a scenario", async ({ page }) => {
  await page.goto("/#staffing");
  await page.getByTestId("load-example").click();
  await page.getByTestId("open-data").click();
  await page.getByTestId("csv-file").setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("arrival_time,service_minutes\n2026-03-02T01:00:00,30\nnot-a-date,5\n"),
  });
  await page.getByTestId("map-arrival").selectOption("arrival_time");
  await page.getByTestId("window-start").fill("2026-03-02T00:00:00Z");
  await page.getByTestId("window-end").fill("2026-03-02T10:00:00Z");
  await page.getByTestId("estimate").click();
  await expect(page.getByTestId("estimate-report")).toContainText("no valid arrivals fall inside the observation window");
  await expect(page.getByTestId("estimate-report")).toContainText("no time zone offset");
  await expect(page.getByTestId("apply-estimate")).toHaveCount(0);
  await snap(page, "07-csv-error");
});
