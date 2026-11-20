/**
 * R18: reproductions of the seven P1 audit findings, as complete user journeys. AI replies are mocked; examples and
 * the validated simulator run for real. Screenshots go to docs/validation/screenshots/audit/.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/audit/", import.meta.url));
mkdirSync(dir, { recursive: true });
const audit = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/audit-proposals.json", import.meta.url)), "utf8"));
const MODEL = "openai/gpt-oss-120b (mocked in this test)";

async function mockAi(page: Page, first: unknown, look?: unknown) {
  await page.route("**/api/plan", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: first, model: MODEL, warnings: [] }) }));
  await page.route("**/api/revisit", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, suggestion: look, model: MODEL, warnings: [] }) }));
}
const ask = async (page: Page, question: string) => {
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(question);
  await page.getByTestId("explore-possibilities").click();
};
const node = (page: Page, name: string) => page.getByTestId(`branch-${name}`);
const whatIfOn = (page: Page, text: string) => page.getByTestId("story").locator("li", { hasText: text }).getByRole("button", { name: /^What if this changed\?/ });
const answerNumber = async (page: Page, label: string, value: string) => {
  await expect(page.getByTestId("question-card")).toContainText(label);
  await page.getByTestId("question-input").fill(value);
  await page.getByTestId("save-answer").click();
};
const shot = (page: Page, name: string) => page.screenshot({ path: `${dir}${name}.png`, fullPage: true, animations: "disabled" });

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test(`A / RF-01: the rent control changes rent; the child recalculates; the parent keeps £1,500 (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await page.getByTestId("example-move-city").click();
    await node(page, "Move to London").click();
    await expect(page.getByTestId("change-rent")).toContainText("Rent: £1,500 per month");
    await page.getByTestId("change-rent").click();
    // The editor is for rent, with its current value and unit; nothing else is offered in its place.
    const sheet = page.getByTestId("whatif-sheet");
    await expect(sheet.locator(".whatif-row").first()).toHaveAttribute("data-testid", "whatif-row-rent");
    await expect(page.getByTestId("whatif-row-rent")).toContainText("now: £1,500 per month");
    await expect(sheet.locator(".whatif-list").first().locator(".whatif-row")).toHaveCount(1);
    await expect(page.getByTestId("whatif-text")).toBeVisible();
    await page.getByTestId("whatif-input-rent").fill("1200");
    await shot(page, `${vp.name}-A1-rent-editor`);
    await page.getByTestId("whatif-create-rent").click();

    await expect(page.getByTestId("story-title")).toHaveText("Move to London · Rent: £1,200 per month");
    await expect(page.getByTestId("story-changes")).toContainText("Rent: £1,200 per month");
    await expect(page.getByTestId("whatif-changed")).toContainText("Rent: £1,200 per month (was £1,500 per month)");
    await expect(page.getByTestId("whatif-calculated")).toContainText("Saved each month: £1,000 per month (was £700 per month)");
    await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("£1,000 per month");
    await shot(page, `${vp.name}-A2-rent-child`);
    await page.getByTestId("whatif-compare").click();
    await expect(page.getByTestId("cmp-differ")).toContainText("Rent");
    await expect(page.getByTestId("cmp-differ")).toContainText("£1,500 per month");
    await expect(page.getByTestId("cmp-differ")).toContainText("£1,200 per month");
    await expect(page.getByTestId("cmp-calc-monthlySavings")).toContainText("+£300 per month");
    await page.getByTestId("continue-a").click();
    await expect(page.getByTestId("story-title")).toHaveText("Move to London");
    await expect(page.getByTestId("change-rent")).toContainText("Rent: £1,500 per month");
    await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("£700 per month");
    // A choice opens its own choices first, not a number field or another assumption.
    await page.getByTestId("change-city").click();
    await expect(sheet.locator(".whatif-row").first()).toHaveAttribute("data-testid", "whatif-row-city");
    await expect(sheet.locator(".whatif-list").first().locator(".whatif-row")).toHaveCount(1);
    await expect(page.getByTestId("whatif-choice-city-Mumbai")).toBeVisible();
    await expect(page.getByTestId("whatif-choice-city-London")).toHaveCount(0);
  });
}

test("B / RF-04: a described change counts as a change everywhere, after a reload and after an approved look", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const STATEMENT = "I split the two hours into four focused sessions with breaks.";
  await mockAi(page, audit["exam-length"], {
    summary: "Because the two hours are split into sessions with breaks, fatigue could build up less on this path.", reconsider: [], questions: [], evidence: [],
    add: [{ text: "Concentration could stay steadier across the exam", trigger: "the time is split into focused sessions with breaks", mechanism: "Short breaks can let attention recover between sessions.", downstream: "", uncertainty: "Whether breaks are allowed in your exam rules.", tone: "upside", about: ["breaksAllowed"] }],
  });
  await ask(page, "What if my exams were two hours long?");
  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-title")).toHaveText("Two-hour exams");
  await whatIfOn(page, "Less fatigue towards the end of the exam").click();
  await page.getByTestId("whatif-text").fill(STATEMENT);
  await page.getByTestId("whatif-text-create").click();

  const check = async () => {
    await expect(page.getByTestId("story-changes")).not.toContainText("Nothing is different yet");
    await expect(page.getByTestId("story-changes")).toContainText(STATEMENT);
    await expect(node(page, STATEMENT.slice(0, 57).trimEnd() + "…")).toContainText("Exploring");
  };
  await check();
  await shot(page, "desktop-1440-B1-described-change");
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Two-hour exams").click();
  await expect(page.getByTestId("cmp-differ")).toContainText(STATEMENT);
  await expect(page.getByTestId("cmp-differ")).toContainText("Only in");
  await expect(page.getByTestId("cmp-differ")).not.toContainText("They make the same choices so far");
  await shot(page, "desktop-1440-B2-described-change-compare");
  await page.getByTestId("continue-a").click();
  await page.reload();
  await node(page, STATEMENT.slice(0, 57).trimEnd() + "…").click();
  await check();
  await page.getByTestId("ask-fresh-look").click();
  await page.getByTestId("revisit-apply").click();
  await check();
  // The parent is unchanged.
  await node(page, "Two-hour exams").click();
  await expect(page.getByTestId("story-known")).not.toContainText(STATEMENT);
});

test("C / RF-03: Compare shows both simulated waits, their difference, wages, and a path that was not simulated", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("example-cafe-queue").click();
  await expect(page.getByTestId("story-title")).toHaveText("One barista");
  await page.getByTestId("story-simulated").getByTestId("run-sim-queueWait").click();
  await expect(page.getByTestId("story-simulated")).toContainText("min");
  await node(page, "Two baristas").click();
  await page.getByTestId("story-simulated").getByTestId("run-sim-queueWait").click();
  await expect(page.getByTestId("story-simulated")).toContainText("min");
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-One barista").click();
  const sim = page.getByTestId("cmp-simulated");
  await expect(sim).toContainText("Average wait before being served");
  await expect(sim.getByTestId("cmp-sim-a-queueWait")).toContainText("min");
  await expect(sim.getByTestId("cmp-sim-b-queueWait")).toContainText("min");
  await expect(sim).toContainText("queue.mmc@1.1.0");
  await expect(sim.getByTestId("cmp-sim-diff-queueWait")).toContainText("B − A");
  await expect(sim).toContainText("model estimate");
  await expect(page.getByTestId("cmp-calc-wageCost")).toContainText("£36");
  await expect(page.getByTestId("cmp-calc-wageCost")).toContainText("£72");
  await shot(page, "desktop-1440-C1-cafe-compare");
  // A third path that has not been simulated is named as such, never shown as zero.
  await page.getByTestId("continue-a").click();
  await page.getByTestId("change-baristas").click();
  await page.getByTestId("whatif-input-baristas").fill("3");
  await page.getByTestId("whatif-create-baristas").click();
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Two baristas").click();
  await expect(page.getByTestId("cmp-sim-a-queueWait")).toContainText("Not simulated yet");
  await expect(page.getByTestId("cmp-sim-a-queueWait")).not.toContainText("0 min");
  await expect(page.getByTestId("cmp-sim-diff-queueWait")).toHaveCount(0);
});

test("RF-05: a suggestion carried over from Mumbai is not presented as established in London", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await node(page, "Move to London").click();
  await expect(page.getByTestId("story")).toContainText("Close to family and friends");
  await expect(page.getByTestId("story").locator("li", { hasText: "Close to family and friends" })).toContainText("carried over from “Stay in Mumbai”");
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Stay in Mumbai").click();
  const row = page.getByTestId("cmp-either").locator("li", { hasText: "Close to family and friends" });
  await expect(row).toContainText("not re-checked");
  await expect(page.getByTestId("cmp-either")).toContainText("Listed in both");
  await expect(page.getByTestId("cmp-either")).not.toContainText("In both");
  await shot(page, "desktop-1440-RF05-carried-over");
  // The technical comparison says the same.
  await page.getByTestId("cmp-technical").locator("summary").click();
  await expect(page.getByTestId("compare-panel").locator("li", { hasText: "Close to family and friends" })).toContainText("not re-checked");
  // Nothing was removed: Mumbai keeps it untagged, London keeps its copy.
  await page.getByTestId("continue-b").click();
  await expect(page.getByTestId("story").locator("li", { hasText: "Close to family and friends" })).not.toContainText("not re-checked");
});

test("D / RF-02: six saved maps, each edited, all reopen after a reload with their edits", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const examples = ["move-city", "solar", "cafe-queue", "move-city", "solar", "cafe-queue"];
  for (const [i, ex] of examples.entries()) {
    await page.getByTestId(`example-${ex}`).click();
    await page.getByTestId("add-upside").click();
    await page.getByTestId("add-upside-text").fill(`My edit ${i + 1}`);
    await page.getByTestId("add-upside-save").click();
    await expect(page.getByTestId("story-upsides")).toContainText(`My edit ${i + 1}`);
    await page.getByTestId("home").click();
  }
  await page.reload();
  await expect(page.getByTestId("all-maps")).toContainText("6");
  await page.getByTestId("all-maps").locator("summary").click();
  await shot(page, "desktop-1440-D1-all-maps");
  const found = new Set<string>();
  for (let i = 0; i < 6; i++) {
    // Going home re-renders the list closed; open it again before choosing the next map.
    if (!(await page.getByTestId("all-maps").evaluate((el) => (el as HTMLDetailsElement).open))) await page.getByTestId("all-maps").locator("summary").click();
    await page.getByTestId("all-maps").locator("button.continue-link").nth(i).click();
    const text = await page.getByTestId("story").innerText();
    const m = text.match(/My edit (\d)/);
    if (m) found.add(m[1]!);
    await page.getByTestId("home").click();
  }
  expect([...found].sort()).toEqual(["1", "2", "3", "4", "5", "6"]);

  // Export, remove everything, import: all six maps come back with their edits.
  await page.getByTestId("more-menu").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-realities").click();
  const file = await (await download).path();
  await page.getByTestId("more-menu").click();
  await page.getByTestId("reset-realities").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("Remove all 6 maps from this browser?");
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("all-maps")).toHaveCount(0);
  await page.getByTestId("import-realities-file").setInputFiles(file);
  await expect(page.getByTestId("notice")).toContainText("Restored 6 realities");
  await expect(page.getByTestId("all-maps")).toContainText("All your maps (6)");
  await page.getByTestId("all-maps").locator("summary").click();
  await expect(page.getByTestId("all-maps").locator("button.continue-link")).toHaveCount(6);
  const back = new Set<string>();
  for (let i = 0; i < 6; i++) {
    if (!(await page.getByTestId("all-maps").evaluate((el) => (el as HTMLDetailsElement).open))) await page.getByTestId("all-maps").locator("summary").click();
    await page.getByTestId("all-maps").locator("button.continue-link").nth(i).click();
    const m = (await page.getByTestId("story").innerText()).match(/My edit (\d)/);
    if (m) back.add(m[1]!);
    await page.getByTestId("home").click();
  }
  expect([...back].sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
});

test("E / RF-06 + RF-07: bookstore figures keep ₹ and the month, come from the user, and the result is labelled", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAi(page, audit.bookstore);
  await ask(page, "What if I opened a bookstore with ₹20,000 per month sales, ₹8,000 rent and ₹4,000 other costs?");
  await page.getByTestId("explore-future-0").click();
  await answerNumber(page, "Sales per month", "20000");
  await answerNumber(page, "Rent", "₹8,000");
  await answerNumber(page, "Other costs", "4000");
  const calc = page.getByTestId("story-calc-shopProfit");
  await expect(calc).toContainText("Shop profit");
  await expect(calc).not.toContainText("shopProfit");
  await expect(calc).toContainText("₹8,000 per month");
  await expect(calc).toContainText("Sales per month (from you)");
  await expect(page.getByTestId("story-known")).toContainText("Sales per month: ₹20,000 per month");
  await expect(page.getByTestId("story-known")).toContainText("Rent: ₹8,000 per month");
  await shot(page, "desktop-1440-E1-bookstore");
});

test("RF-06: a typed starting value is the user's; example figures are illustrative, never 'your numbers'", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill("What if I rented a bigger flat?");
  await page.getByTestId("start-blank").click();
  await page.getByTestId("var-label").fill("Monthly rent");
  await page.getByTestId("var-unit").fill("£ per month");
  await page.getByTestId("var-start").fill("1200");
  await page.getByTestId("add-variable").click();
  await expect(page.getByTestId("story-known")).toContainText("Monthly rent: £1,200 per month");
  await page.getByTestId("home").click();
  await page.getByTestId("example-move-city").click();
  await node(page, "Move to London").click();
  await expect(page.getByTestId("story-calculated")).not.toContainText("your numbers");
  await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("example figure");
  await expect(page.getByTestId("story-known")).not.toContainText("Rent:");
  await expect(page.getByTestId("map-kind")).toContainText("its figures are illustrative");
  // In the advanced editor, the same value says where it came from.
  await page.getByTestId("all-details").click();
  await expect(page.getByTestId("value-source-rent")).toContainText("Example figure");
  // The user's own number replaces it, and only then is it theirs.
  await page.getByTestId("value-rent").fill("£1,350");
  await page.getByTestId("value-rent").press("Enter");
  await expect(page.getByTestId("value-source-rent")).toHaveText("Set by you");
  await expect(page.getByTestId("story-known")).toContainText("Rent: £1,350 per month");
  await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("Rent (from you)");
  await shot(page, "desktop-1440-RF06-example-provenance");
});

test("390 px: every repaired view fits the screen (rent editor, described change, simulated comparison, all maps, bookstore)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = async (step: string) => {
    await shot(page, `mobile-390-fit-${step}`);
    const o = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect.soft(o.scroll, `horizontal overflow at ${step}`).toBeLessThanOrEqual(o.client);
  };
  // RF-01 + RF-07: the rent editor, the new path and its comparison.
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await node(page, "Move to London").click();
  await page.getByTestId("change-rent").click();
  await fits("1-rent-editor");
  await page.getByTestId("whatif-input-rent").fill("£1,200");
  await page.getByTestId("whatif-create-rent").click();
  await expect(page.getByTestId("story-title")).toHaveText("Move to London · Rent: £1,200 per month");
  await fits("2-rent-child");
  await page.getByTestId("whatif-compare").click();
  await expect(page.getByTestId("cmp-calc-monthlySavings")).toContainText("+£300 per month");
  await fits("3-rent-compare");
  // RF-03: both waits, the difference and an unsimulated path, side by side with wages.
  await page.getByTestId("home").click();
  await page.getByTestId("example-cafe-queue").click();
  await page.getByTestId("story-simulated").getByTestId("run-sim-queueWait").click();
  await expect(page.getByTestId("story-simulated")).toContainText("min");
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Two baristas").click();
  await expect(page.getByTestId("cmp-sim-b-queueWait")).toContainText("Not simulated yet");
  await page.getByTestId("cmp-run-b-queueWait").click();
  await expect(page.getByTestId("cmp-sim-diff-queueWait")).toContainText("B − A", { timeout: 60_000 });
  await fits("4-cafe-compare");
  // RF-02: more maps than the recent list holds.
  for (const ex of ["solar", "move-city", "cafe-queue"]) {
    await page.getByTestId("home").click();
    await page.getByTestId(`example-${ex}`).click();
  }
  await page.getByTestId("home").click();
  await expect(page.getByTestId("all-maps")).toContainText("All your maps (5)");
  await page.getByTestId("all-maps").locator("summary").click();
  await fits("5-all-maps");
  // RF-04: a described change.
  await mockAi(page, audit["exam-length"]);
  await ask(page, "What if my exams were two hours long?");
  await page.getByTestId("explore-future-0").click();
  await whatIfOn(page, "Less fatigue towards the end of the exam").click();
  await page.getByTestId("whatif-text").fill("I split the two hours into four focused sessions with breaks.");
  await page.getByTestId("whatif-text-create").click();
  await expect(page.getByTestId("story-changes")).toContainText("Exploring");
  await fits("6-described-change");
  // RF-06 + RF-07: the bookstore's figures and result. (Home first: a reload reopens the map that was open.)
  await page.getByTestId("home").click();
  await page.unrouteAll();
  await mockAi(page, audit.bookstore);
  await ask(page, "What if I opened a bookstore with ₹20,000 per month sales, ₹8,000 rent and ₹4,000 other costs?");
  await page.getByTestId("explore-future-0").click();
  await answerNumber(page, "Sales per month", "20000");
  await answerNumber(page, "Rent", "₹8,000");
  await answerNumber(page, "Other costs", "4000");
  await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
  await fits("7-bookstore");
});
