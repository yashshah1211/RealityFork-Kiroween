/**
 * Visual-first journey: Imagine → Discover → Explore → Branch → Compare, with the AI endpoint mocked
 * (fixed proposals, no network, no key). Screenshots go to docs/validation/screenshots/experience/.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/experience/", import.meta.url));
mkdirSync(dir, { recursive: true });
const restaurant = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/restaurant-proposal.json", import.meta.url)), "utf8"));
const domains = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/domain-proposals.json", import.meta.url)), "utf8"));

async function mockPlanner(page: Page, proposal: unknown, delayMs = 0) {
  const calls = { n: 0 };
  await page.route("**/api/plan", async (route) => {
    calls.n++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal, model: "openai/gpt-oss-120b (mocked in this test)", warnings: [] }) });
  });
  return calls;
}
const overflow = (page: Page) => page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
const visiblePrimaries = (page: Page) => page.locator(".btn-primary:visible").allInnerTexts();
const node = (page: Page, name: string) => page.getByTestId(`branch-${name}`);

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test(`restaurant: question → AI futures → approve → explore → compare → branch again (${vp.name})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const calls = await mockPlanner(page, restaurant, 500);
    const widths: Record<string, { clientWidth: number; scrollWidth: number }> = {};
    const shot = async (step: string) => {
      await page.screenshot({ path: `${dir}${vp.name}-${step}.png`, fullPage: true, animations: "disabled" });
      widths[step] = await overflow(page);
    };

    // 1. Imagine: one question, one primary action.
    await page.goto("/");
    await expect(page.getByText("What if", { exact: true })).toBeVisible();
    expect(await visiblePrimaries(page)).toEqual(["Explore possibilities"]);
    await shot("01-imagine");
    await page.getByTestId("whatif-input").fill("…I started my own restaurant?");
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("plan-loading")).toBeVisible();
    await shot("02-imagining");

    // 2. Discover: futures as cards; nothing exists until one is chosen.
    await expect(page.getByTestId("future-card-2")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What if I started my own restaurant?");
    await expect(page.getByTestId("discover")).toContainText("AI-suggested");
    await expect(page.getByTestId("discover")).toContainText("not predictions");
    await expect(page.getByTestId("future-card-0")).toContainText("Type of place: café");
    await expect(page.getByTestId("future-card-0")).toContainText("Full control over the menu and atmosphere");
    await expect(page.getByTestId("future-card-1")).toContainText("Managing people becomes a large part of the job");
    await expect(page.getByTestId("map")).toHaveCount(0);
    expect((await visiblePrimaries(page)).every((t) => t.startsWith("Save and explore this future"))).toBe(true);
    await expect(page.getByTestId("discover-uncertainties")).not.toHaveAttribute("open", "");
    await shot("03-discover");
    // Leave one future out, rename another, then choose it (this is the approval).
    await page.getByTestId("include-future-2").click();
    await expect(page.getByTestId("include-future-2")).toHaveText("Left out");
    await page.getByTestId("discover-adjust").locator("summary").click();
    await page.getByTestId("plan-rename-0").fill("Tiny café");
    await expect(page.getByTestId("future-name-0")).toHaveText("Tiny café");
    await page.getByTestId("explore-future-0").click();

    // 3. Explore: a focused story for the chosen future, and the map of paths.
    await expect(page.getByTestId("story-title")).toHaveText("Tiny café");
    await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(3);
    await expect(node(page, "Keep my current job")).toHaveCount(0);
    await expect(node(page, "Tiny café")).toHaveAttribute("aria-current", "location");
    await expect(page.getByTestId("story-changes")).toContainText("Type of place: café");
    await expect(page.getByTestId("story-changes")).toContainText("Hire staff: no");
    await expect(page.getByTestId("story-upsides")).toContainText("Full control over the menu and atmosphere");
    await expect(page.getByTestId("story-challenges")).toContainText("Long hours leave little time for family");
    await expect(page.getByTestId("story-upsides")).toContainText("AI-suggested possibilities, not predictions");
    await expect(page.getByTestId("story-calc-profitPerMonth")).toContainText("needs Sales per month, Running costs per month");
    await expect(page.getByTestId("question-card")).toContainText("Sales per month");
    await expect(page.getByTestId("question-card")).toContainText("Helps work out: Profit per month");
    // The advanced editors exist but stay out of the way.
    await expect(page.getByTestId("define-panel")).toHaveCount(0);
    await expect(page.getByTestId("branch-panel")).toHaveCount(0);
    expect(await visiblePrimaries(page)).toEqual(["Save answer"]);
    await shot("04-explore");

    // One question at a time; numbers only from the user.
    await page.getByTestId("question-input").fill("9000");
    await page.getByTestId("save-answer").click();
    await expect(page.getByTestId("question-card")).toContainText("Running costs per month");
    await page.getByTestId("question-input").fill("7500");
    await page.getByTestId("question-input").press("Enter");
    await expect(page.getByTestId("story-calc-profitPerMonth")).toContainText("1,500 per month");
    await expect(page.getByTestId("story-calc-profitPerMonth")).toContainText("suggested formula");
    await expect(page.getByTestId("question-card")).toContainText("Start-up cost");
    await page.getByTestId("skip-question").click();
    await page.getByTestId("skip-question").click();
    await expect(page.getByTestId("compare-suggested")).toHaveText("Compare with “Full restaurant with staff”");
    await shot("05-answered");

    // The other future, answered the same way.
    await node(page, "Full restaurant with staff").click();
    await expect(page.getByTestId("story-title")).toHaveText("Full restaurant with staff");
    await page.getByTestId("question-input").fill("20000");
    await page.getByTestId("save-answer").click();
    await page.getByTestId("question-input").fill("17000");
    await page.getByTestId("save-answer").click();
    await expect(page.getByTestId("story-calc-profitPerMonth")).toContainText("3,000 per month");

    // 5. Compare, starting from the café.
    await node(page, "Tiny café").click();
    await page.getByTestId("compare-with").click();
    await page.getByTestId("compare-pick-Full restaurant with staff").click();
    await expect(page.getByTestId("compare-view")).toBeVisible();
    await expect(page.getByTestId("cmp-head-a")).toContainText("Tiny café");
    await expect(page.getByTestId("cmp-differ")).toContainText("Type of place");
    await expect(page.getByTestId("cmp-differ")).toContainText("full restaurant");
    await expect(page.getByTestId("cmp-calc-profitPerMonth")).toContainText("+1,500 per month");
    // The trade-off: the restaurant's upside favours the restaurant; its difficulty favours the café, and says where it was written.
    await expect(page.getByTestId("trade-for-b")).toContainText("Room to grow and take bigger bookings");
    await expect(page.getByTestId("trade-for-b")).toContainText("Could go well on “Full restaurant with staff”");
    await expect(page.getByTestId("trade-for-a")).toContainText("Managing people becomes a large part of the job");
    await expect(page.getByTestId("trade-for-a")).toContainText("Could be hard on “Full restaurant with staff”");
    await expect(page.getByTestId("cmp-either")).toContainText("Local competition changes");
    await expect(page.getByTestId("cmp-technical")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("compare-panel")).toBeHidden();
    await shot("06-compare");

    // 4. Branch again: change one decision of the full restaurant on a new path.
    await page.getByTestId("continue-b").click();
    await expect(page.getByTestId("story-title")).toHaveText("Full restaurant with staff");
    await page.getByTestId("change-hireStaff").click();
    // R18: the decision opens its own choices first (RF-01), on the shared "What if this changed?" sheet.
    await expect(page.getByTestId("whatif-sheet")).toContainText("stays exactly as it is");
    await expect(page.getByTestId("whatif-sheet").locator(".whatif-row").first()).toHaveAttribute("data-testid", "whatif-row-hireStaff");
    await page.getByTestId("whatif-choice-hireStaff-false").click();
    const newPath = "Full restaurant with staff · Hire staff: no";
    await expect(page.getByTestId("story-title")).toHaveText(newPath);
    await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(4);
    await expect(node(page, newPath)).toHaveAttribute("aria-current", "location");
    await expect(node(page, "Full restaurant with staff")).toHaveClass(/on-path/);
    await expect(node(page, "Tiny café")).not.toHaveClass(/on-path/);
    await expect(page.getByTestId("story-changes")).toContainText("Hire staff: no");
    // The new path started as a copy: the user's numbers came with it.
    await expect(page.getByTestId("story-calc-profitPerMonth")).toContainText("3,000 per month");
    await shot("07-branch-again");

    // Saved in the browser; one AI call for the whole journey.
    await page.reload();
    await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(4);
    expect(calls.n).toBe(1);

    writeFileSync(`${dir}${vp.name}-overflow.json`, JSON.stringify(widths, null, 2));
    for (const [step, o] of Object.entries(widths)) expect.soft(o.scrollWidth, `horizontal overflow at ${vp.name} ${step}`).toBeLessThanOrEqual(o.clientWidth);
    expect(errors).toEqual([]);
  });
}

test("relocation: the same journey for an unrelated question, by keyboard where it matters", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await mockPlanner(page, domains["What if I moved to another country?"]);
  await page.goto("/");
  // Keyboard: type the question and press Enter.
  await page.getByTestId("whatif-input").focus();
  await page.keyboard.type("What if I moved to another country?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("future-card-1")).toBeVisible();
  // Focus moved to the new stage's heading.
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.getByTestId("explore-future-1").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("story-title")).toHaveText("Move and look for work");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByTestId("story-changes")).toContainText("Job offer before moving: no");
  await expect(page.getByTestId("story-challenges")).toContainText("A period without income while searching");
  await expect(page.getByTestId("story-upsides")).toContainText("Nothing noted yet.");
  // Add your own thought.
  await page.getByTestId("add-upside").click();
  await page.getByTestId("add-upside-text").fill("Time to choose the right job");
  await page.getByTestId("add-upside-save").click();
  await expect(page.getByTestId("story-upsides")).toContainText("Time to choose the right job");
  await expect(page.getByTestId("story-upsides")).toContainText("Your own possibilities, not predictions");
  await expect(page.getByTestId("story-challenges")).toContainText("AI-suggested possibilities, not predictions");
  // Answer two questions; the formula appears only once its inputs are known.
  await expect(page.getByTestId("story-calc-savedPerMonth")).toContainText("needs");
  await page.getByTestId("question-input").fill("2600");
  await page.getByTestId("question-input").press("Enter");
  await page.getByTestId("question-input").fill("2100");
  await page.getByTestId("question-input").press("Enter");
  await expect(page.getByTestId("story-calc-savedPerMonth")).toContainText("500 per month");
  // Branch by naming a new path.
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-name").fill("Move to a cheaper city");
  await page.getByTestId("fork-create").click();
  await expect(page.getByTestId("story-title")).toHaveText("Move to a cheaper city");
  await expect(page.getByTestId("story")).toContainText("A path from");
  await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(5);
  await expect(page.getByTestId("map").locator(".edges path.lit")).toHaveCount(2);
  // Compare with the job-offer future.
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Move with a job offer").click();
  await expect(page.getByTestId("cmp-differ")).toContainText("Job offer before moving");
  await expect(page.getByTestId("cmp-not-comparable")).toContainText("add your numbers for");
  await page.screenshot({ path: `${dir}desktop-1440-08-relocation-compare.png`, fullPage: true, animations: "disabled" });
  await page.getByTestId("continue-a").click();
  await expect(page.getByTestId("story-title")).toHaveText("Move to a cheaper city");
  expect(calls.n).toBe(1);
});

test("reduced motion turns the entrance animations off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const anim = await page.locator(".stage").first().evaluate((el) => getComputedStyle(el).animationName);
  const draw = await page.locator(".motif-line").first().evaluate((el) => getComputedStyle(el).animationName);
  expect([anim, draw]).toEqual(["none", "none"]);
});

test("when the AI is unavailable, the journey continues by hand", async ({ page }) => {
  await page.route("**/api/plan", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "no-key", message: "The AI planner is not configured on this computer (GROQ_API_KEY is not set). You can still build the reality by hand." }) }));
  await page.goto("/");
  await page.getByTestId("whatif-input").fill("What if our street became car-free?");
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("plan-error")).toContainText("The AI guide isn't switched on here");
  await expect(page.getByTestId("retry-plan")).toHaveCount(0);
  await page.screenshot({ path: `${dir}desktop-09-ai-unavailable.png`, fullPage: true, animations: "disabled" });
  await page.getByTestId("change-question").click();
  await expect(page.getByTestId("whatif-input")).toHaveValue("What if our street became car-free?");
  await page.getByTestId("explore-possibilities").click();
  await page.getByTestId("map-it-myself").click();
  await expect(page.getByTestId("question")).toHaveText("What if our street became car-free?");
  await expect(page.getByTestId("define-panel")).toBeVisible();
  await expect(page.getByTestId("next-step")).toContainText("What matters in this situation?");
});
