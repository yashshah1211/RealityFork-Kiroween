/**
 * R17: "What if this changed?". From a suggestion, change one assumption (the user's own value or choice) or describe a
 * change; a new path appears, the original stays as it is, and the new path shows what the change does: what the user
 * changed, what formulas recalculate, and which possibilities may no longer hold (not recalculated). The same mechanism
 * in three unrelated situations. AI replies are mocked; screenshots go to docs/validation/screenshots/counterfactual/.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/counterfactual/", import.meta.url));
mkdirSync(dir, { recursive: true });
const fx = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/reactive-proposals.json", import.meta.url)), "utf8"));
const MODEL = "openai/gpt-oss-120b (mocked in this test)";
/** Invented figures or odds RealityFork must never show. */
const INVENTED = /\d\s?%|probabilit|likely to|will (?:definitely|certainly)/i;

async function mockAi(page: Page, first: unknown, look?: unknown) {
  const sent = { plan: 0, revisit: 0 };
  await page.route("**/api/plan", async (route) => {
    sent.plan++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: first, model: MODEL, warnings: [] }) });
  });
  await page.route("**/api/revisit", async (route) => {
    sent.revisit++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, suggestion: look, model: MODEL, warnings: [] }) });
  });
  return sent;
}
const ask = async (page: Page, question: string) => {
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(question);
  await page.getByTestId("explore-possibilities").click();
};
const node = (page: Page, name: string) => page.getByTestId(`branch-${name}`);
const answerNumber = async (page: Page, label: string, value: string) => {
  await expect(page.getByTestId("question-card")).toContainText(label);
  await page.getByTestId("question-input").fill(value);
  await page.getByTestId("save-answer").click();
};
const whatIfOn = (page: Page, text: string) => page.getByTestId("story").locator("li", { hasText: text }).getByRole("button", { name: /^What if this changed\?/ });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const REMOTE = "Remote relocation to Germany";
const SAVINGS = "Monthly savings could shrink";
const look = {
  summary: "Because you expect living costs in Germany to be higher, this path could leave you less money each month.",
  reconsider: [], questions: ["What would rent and health insurance cost in the city you are considering?"], evidence: [],
  add: [{
    text: SAVINGS, trigger: "living costs in Germany turn out higher while your income stays the same",
    mechanism: "Essential costs would take a larger share of the same income.", downstream: "Housing choices or savings goals may need to change.",
    uncertainty: "Your actual rent, insurance, taxes and income after the move.", tone: "challenge", about: ["livingCosts", "monthlyIncome"],
  }],
};

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test(`relocation: a higher income on a new path recalculates what is calculable and flags the rest (${vp.name})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const sent = await mockAi(page, fx["relocation-tailored"], look);
    const shifts: number[] = [];

    // Question → future → the user's numbers → a conditional consequence from another look.
    await ask(page, "What if I moved to Germany while keeping my remote job?");
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText(REMOTE);
    await answerNumber(page, "Monthly income", "4000");
    await answerNumber(page, "Living costs in Germany", "4500");
    await expect(page.getByTestId("story-calc-leftEachMonth")).toContainText("-500 per month");
    await page.getByTestId("add-known").click();
    await page.getByTestId("add-known-text").fill("Living costs will be higher.");
    await page.getByTestId("add-known-save").click();
    await page.getByTestId("ask-fresh-look").click();
    await page.getByTestId("revisit-apply").click();
    await expect(page.getByTestId("story-challenges")).toContainText(`${SAVINGS} if living costs in Germany turn out higher while your income stays the same.`);

    // The intervention: "What if this changed?" offers what the AI linked the consequence to, first.
    await whatIfOn(page, SAVINGS).click();
    const sheet = page.getByTestId("whatif-sheet");
    await expect(sheet).toContainText("The AI linked it to");
    await expect(page.getByTestId("whatif-row-monthlyIncome")).toContainText("now: 4,000 per month");
    await expect(page.getByTestId("whatif-row-livingCosts")).toContainText("now: 4,500 per month");
    await expect(sheet).toContainText(`“${REMOTE}” stays exactly as it is`);
    await page.getByTestId("whatif-input-monthlyIncome").fill("5000");
    await page.screenshot({ path: `${dir}${vp.name}-01-what-if-sheet.png`, fullPage: true, animations: "disabled" });
    shifts.push(await overflow(page));
    await page.getByTestId("whatif-create-monthlyIncome").click();

    // A new path appears; it says what the change does, in three kinds.
    const child = `${REMOTE} · Monthly income: 5,000 per month`;
    await expect(page.getByTestId("story-title")).toHaveText(child);
    await expect(node(page, child)).toHaveAttribute("aria-current", "location");
    const note = page.getByTestId("whatif-note");
    await expect(note).toContainText(`Compared with “${REMOTE}”, which stays as it was`);
    await expect(note).toContainText("not a prediction");
    await expect(page.getByTestId("whatif-changed")).toContainText("Monthly income: 5,000 per month (was 4,000 per month)");
    await expect(page.getByTestId("whatif-calculated")).toContainText("Left each month: 500 per month (was -500 per month)");
    await expect(page.getByTestId("whatif-reconsider")).toContainText(`${SAVINGS} (depends on Monthly income)`);
    await expect(page.getByTestId("whatif-reconsider")).toContainText("Not recalculated");
    // The consequence keeps its words and is flagged; the AI's follow-up is offered, not run.
    await expect(page.getByTestId("story-challenges")).toContainText(`${SAVINGS} if living costs in Germany turn out higher`);
    await expect(page.getByTestId("story-challenges").locator(".tag.fresh")).toHaveCount(1);
    await expect(page.getByTestId("ask-fresh-look")).toHaveCount(1);
    expect(await page.getByTestId("story").innerText()).not.toMatch(INVENTED);
    await page.screenshot({ path: `${dir}${vp.name}-02-new-path-what-changes.png`, fullPage: true, animations: "disabled" });
    shifts.push(await overflow(page));

    // Compare the two outcomes, then come back to the new path.
    await page.getByTestId("whatif-compare").click();
    await expect(page.getByTestId("cmp-head-a")).toContainText(REMOTE);
    await expect(page.getByTestId("cmp-differ")).toContainText("Monthly income");
    await expect(page.getByTestId("cmp-calc-leftEachMonth")).toContainText("+1,000 per month");
    // The new path is a copy, so the challenge is listed in both: it favours neither choice, and is marked as possibly stale in B.
    const stale = page.getByTestId("cmp-either").locator("li", { hasText: SAVINGS });
    await expect(stale).toContainText("Listed in both · could be hard");
    await expect(stale).toContainText("may need a fresh look in B");
    await expect(page.getByTestId("cmp-not-recalculated")).toBeVisible();
    await page.screenshot({ path: `${dir}${vp.name}-03-compare.png`, fullPage: true, animations: "disabled" });
    shifts.push(await overflow(page));
    await page.getByTestId("continue-b").click();
    await expect(page.getByTestId("whatif-note")).toBeVisible();

    // The original path is unchanged.
    await node(page, REMOTE).click();
    await expect(page.getByTestId("story-calc-leftEachMonth")).toContainText("-500 per month");
    await expect(page.getByTestId("story-known")).toContainText("Monthly income: 4,000 per month");
    await expect(page.getByTestId("whatif-note")).toHaveCount(0);
    await expect(page.getByTestId("story-challenges").locator(".tag.fresh")).toHaveCount(0);
    expect(sent).toEqual({ plan: 1, revisit: 1 });
    for (const s of shifts) expect.soft(s, `horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test("restaurant: cheaper premises on a new path; profit recalculates from the user's numbers; nothing is invented", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await mockAi(page, fx["restaurant-tailored"]);
  await ask(page, "What if I opened a small restaurant?");
  await page.getByTestId("explore-future-1").click();
  await expect(page.getByTestId("story-title")).toHaveText("Small café");
  await page.getByTestId("skip-question").click(); // the budget stays unknown
  await answerNumber(page, "Sales per month", "300000");
  await answerNumber(page, "Running costs per month", "280000");
  await expect(page.getByTestId("story-calc-profitPerMonth")).toContainText("20,000 per month");

  await whatIfOn(page, "Finding an affordable space with enough passers-by").click();
  await expect(page.getByTestId("whatif-row-monthlyCosts")).toContainText("now: 280,000 per month");
  await page.getByTestId("whatif-input-monthlyCosts").fill("250000");
  await page.getByTestId("whatif-create-monthlyCosts").click();

  await expect(page.getByTestId("story-title")).toHaveText("Small café · Running costs per month: 250,000 per month");
  await expect(page.getByTestId("whatif-changed")).toContainText("Running costs per month: 250,000 per month (was 280,000 per month)");
  await expect(page.getByTestId("whatif-calculated")).toContainText("Profit per month: 50,000 per month (was 20,000 per month)");
  await expect(page.getByTestId("whatif-calculated")).toContainText("Months to earn back the budget needs Start-up budget");
  await expect(page.getByTestId("whatif-reconsider")).toContainText("Finding an affordable space with enough passers-by (depends on Running costs per month)");
  // Sales are the user's own number, carried over unchanged; no demand or revenue is invented.
  await expect(page.getByTestId("story-known")).toContainText("Sales per month: 300,000 per month");
  expect(await page.getByTestId("story").innerText()).not.toMatch(INVENTED);
  await page.screenshot({ path: `${dir}desktop-1440-04-restaurant.png`, fullPage: true, animations: "disabled" });
  await page.getByTestId("whatif-compare").click();
  await expect(page.getByTestId("cmp-calc-profitPerMonth")).toContainText("+30,000 per month");
  expect(sent).toEqual({ plan: 1, revisit: 0 });
});

test("university: a different assessment model, then a change in the user's own words; no numbers anywhere", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await mockAi(page, fx["university-tailored"]);
  await ask(page, "What if my university replaced written exams with project-based assessment?");
  await page.getByTestId("explore-future-0").click();
  const parent = "Projects replace exams";
  await expect(page.getByTestId("story-title")).toHaveText(parent);

  // A different choice, through the same sheet.
  await whatIfOn(page, "Deadlines across the term may overlap").click();
  await expect(page.getByTestId("whatif-row-assessmentMix")).toContainText("now: projects only");
  await page.getByTestId("whatif-choice-assessmentMix-mixed").click();
  await expect(page.getByTestId("story-title")).toHaveText(`${parent} · How your work is assessed: mixed`);
  await expect(page.getByTestId("whatif-changed")).toContainText("How your work is assessed: mixed (was projects only)");
  await expect(page.getByTestId("whatif-calculated")).toContainText("This map has no calculations");
  await expect(page.getByTestId("whatif-reconsider")).toContainText("Deadlines across the term may overlap (depends on How your work is assessed)");
  await expect(page.getByTestId("whatif-reconsider")).toContainText("Less pressure from single high-stakes exams");
  await page.screenshot({ path: `${dir}desktop-1440-05-university-choice.png`, fullPage: true, animations: "disabled" });

  // A change with no matching assumption: described in the user's words, never turned into a value.
  await node(page, parent).click();
  await whatIfOn(page, "Group members may contribute unevenly").click();
  await page.getByTestId("whatif-text").fill("Each project is limited to two people");
  await page.getByTestId("whatif-text-create").click();
  await expect(page.getByTestId("story-title")).toHaveText("Each project is limited to two people");
  await expect(page.getByTestId("story-known")).toContainText("Change you are exploring (a what-if, not a known fact): Each project is limited to two people");
  await expect(page.getByTestId("whatif-changed")).toContainText("Exploring: Each project is limited to two people");
  await expect(page.getByTestId("whatif-reconsider")).toContainText("AI suggestions here were made before this change");
  await expect(page.getByTestId("fresh-look-prompt")).toContainText("suggested before you told us something new");
  expect(await page.getByTestId("story").innerText()).not.toMatch(INVENTED);
  await page.screenshot({ path: `${dir}desktop-1440-06-university-described.png`, fullPage: true, animations: "disabled" });
  await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(6);
  expect(sent).toEqual({ plan: 1, revisit: 0 });
});
