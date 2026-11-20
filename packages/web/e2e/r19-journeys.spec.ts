/**
 * R19 first-use journeys, played as a user would and COUNTED: every typed entry and every click is one action, and an
 * entry that re-types information already in the user's question is marked as a repeat.
 *
 *   R19_MODE=baseline  the unchanged build (before R19): only the manual paths exist.
 *   R19_MODE=after     the R19 build: the same manual paths (ignoring the new panel) plus the assisted paths.
 *
 * The counts are written to docs/validation/r19-actions-<mode>.json by the run itself; the report reads them from
 * there. Draft replies are deterministic fixtures (no live model); every other /api request is refused and counted.
 * Screenshots: docs/validation/screenshots/r19/<mode>-*.png
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const MODE = process.env.R19_MODE === "after" ? "after" : "baseline";
/**
 * The recorder writes evidence files and screenshots, so it runs only when a mode is chosen on purpose. A plain full-suite
 * run skips it: otherwise it would overwrite the committed baseline (docs/validation/r19-actions-baseline.json and the
 * baseline-*.png screenshots, measured on 29c014b) with whatever build is being tested.
 */
const EXPLICIT = process.env.R19_MODE === "baseline" || process.env.R19_MODE === "after";
test.skip(!EXPLICIT, "set R19_MODE=baseline or R19_MODE=after to record the first-use journeys (it writes docs/validation/r19-actions-<mode>.json)");
const shotsDir = here("../../../docs/validation/screenshots/r19/");
mkdirSync(shotsDir, { recursive: true });
const audit = JSON.parse(readFileSync(here("./fixtures/audit-proposals.json"), "utf8"));
const r19 = JSON.parse(readFileSync(here("./fixtures/r19-proposals.json"), "utf8"));
const MODEL = "openai/gpt-oss-120b (mocked in this test)";

export const QUESTION_A = "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?";
export const QUESTION_B = "What if I studied two hours daily instead of one hour for exams four weeks away?";
export const QUESTION_C = "What if my college replaced written exams with team-based projects?";

// ---------- the recorder ----------

interface Step { n: number; kind: "type" | "click"; what: string; repeat?: string }
class Journey {
  steps: Step[] = [];
  reachedAt: Record<string, number> = {};
  constructor(readonly page: Page) {}
  async type(target: Locator, text: string, what: string, repeat?: string) {
    await target.fill(text);
    this.steps.push({ n: this.steps.length + 1, kind: "type", what, ...(repeat ? { repeat } : {}) });
  }
  async click(target: Locator, what: string) {
    await target.click();
    this.steps.push({ n: this.steps.length + 1, kind: "click", what });
  }
  /** The user can now see the consequence they came for: record how many actions it took. */
  reached(what: string) {
    this.reachedAt[what] = this.steps.length;
  }
  summary() {
    return {
      actions: this.steps.length,
      typed: this.steps.filter((s) => s.kind === "type").length,
      clicks: this.steps.filter((s) => s.kind === "click").length,
      repeatedEntries: this.steps.filter((s) => s.repeat).length,
      reachedAt: this.reachedAt,
      steps: this.steps,
    };
  }
}

const results: Record<string, unknown> = {};
const out = here(`../../../docs/validation/r19-actions-${MODE}.json`);
test.afterAll(() => {
  if (!EXPLICIT) return;
  writeFileSync(out, `${JSON.stringify({ mode: MODE, recordedAt: new Date().toISOString(), note: "Written by packages/web/e2e/r19-journeys.spec.ts from the steps each journey took. Draft replies are deterministic fixtures; no live model.", ...results }, null, 2)}\n`);
});

// ---------- helpers ----------

interface Seen { refused: string[]; plan: { question: string; context?: unknown }[]; errors: string[] }
/** Refuse every /api request except the draft mock; remember what was asked. `delays[i]` holds the i-th reply back. */
async function mockPlans(page: Page, drafts: unknown[], delays: number[] = []): Promise<Seen> {
  const seen: Seen = { refused: [], plan: [], errors: [] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/i.test(m.text() + (m.location().url ?? ""))) seen.errors.push(m.text());
  });
  await page.route("**/api/**", (route) => {
    seen.refused.push(route.request().url());
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "No AI request is allowed here." }) });
  });
  let n = 0;
  await page.route("**/api/plan", async (route) => {
    seen.plan.push(route.request().postDataJSON());
    const i = n++;
    const wait = delays[i] ?? 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: drafts[Math.min(i, drafts.length - 1)], model: MODEL, warnings: [] }) });
  });
  return seen;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${shotsDir}${MODE}-${name}.png`, fullPage: true, animations: "disabled" });
const text = async (l: Locator) => (await l.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const card = (page: Page) => page.getByTestId("question-card");

/** What the first screen after the draft says about proposed versus saved content, and whether the question can be edited. */
async function discoverFacts(page: Page) {
  return {
    includeToggle: await text(page.getByTestId("include-future-0")),
    exploreButton: await text(page.getByTestId("explore-future-0")),
    approvalNote: await text(page.getByTestId("approval-note")),
    questionEditable:
      (await page.getByTestId("edit-question").count()) > 0 ||
      (await page.locator("main textarea, main input[type=text]").evaluateAll((els, q) => els.some((e) => (e as HTMLInputElement).value.includes(q)), "bookstore")),
    askAgain: await text(page.getByTestId("retry-plan")),
    saysNumbersComeFromYou: (await text(page.getByTestId("discover"))).includes("Every number will come from you"),
  };
}

// ---------- Scenario A: financial ----------

test(`A (${MODE}): bookstore, answering the questions by hand`, async ({ page }) => {
  const seen = await mockPlans(page, [audit.bookstore]);
  const j = new Journey(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await j.type(page.getByTestId("whatif-input"), QUESTION_A, "the question");
  await j.click(page.getByTestId("explore-possibilities"), "Explore possibilities");
  await expect(page.getByTestId("future-card-0")).toBeVisible();
  const discover = await discoverFacts(page);
  await shot(page, "A1-discover");
  await j.click(page.getByTestId("explore-future-0"), "open the first future");
  await expect(card(page)).toContainText("Sales per month");
  await shot(page, "A2-first-question");
  // Each figure was already in the question.
  for (const [label, value] of [["Sales per month", "20000"], ["Rent", "8000"], ["Other costs", "4000"]] as const) {
    await expect(card(page)).toContainText(label);
    await j.type(page.getByTestId("question-input"), value, `${label} (already in the question)`, label);
    await j.click(page.getByTestId("save-answer"), "Save answer");
  }
  await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
  j.reached("Shop profit ₹8,000 per month");
  await shot(page, "A3-result");
  // The prompt the user sees right after typing the figures the AI had already seen.
  const freshLookOffered = (await page.getByTestId("ask-fresh-look").count()) > 0;
  const freshLookText = await text(page.getByTestId("next-step"));
  if (freshLookOffered) await page.getByTestId("continue-without-ai").click();
  const nextHeading = await text(page.getByTestId("next-step").locator("h3").first());
  // Every comparison or branching action visible together in the next-step area, and which of them is styled as primary.
  const nextActions = await page.getByTestId("next-step").locator("button:visible").evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute("data-testid"), text: (e.textContent ?? "").replace(/\s+/g, " ").trim(), primary: e.classList.contains("btn-primary") })),
  );
  const openQuestionsOnMap = await text(page.getByTestId("story-known")).then(() => page.evaluate(() => Boolean(document.body.innerText.match(/Open questions and things worth finding out/))));
  results.A = { ...j.summary(), question: QUESTION_A, discover, afterRetyping: { freshLookOffered, freshLookText: freshLookText.slice(0, 160), nextHeading, openQuestionsStillListed: openQuestionsOnMap, nextActions }, aiRequests: seen.plan.length, refused: seen.refused.length };
  expect(seen.refused).toEqual([]);
  expect(seen.errors).toEqual([]);
});

// ---------- Scenario B: education ----------

test(`B (${MODE}): study plan, answering the questions by hand`, async ({ page }) => {
  const seen = await mockPlans(page, [r19.education]);
  const j = new Journey(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await j.type(page.getByTestId("whatif-input"), QUESTION_B, "the question");
  await j.click(page.getByTestId("explore-possibilities"), "Explore possibilities");
  await expect(page.getByTestId("future-card-0")).toBeVisible();
  const discover = await discoverFacts(page);
  await shot(page, "B1-discover");
  await j.click(page.getByTestId("explore-future-0"), "open “Study two hours daily”");
  await expect(card(page)).toContainText("Study hours per day");
  await j.type(page.getByTestId("question-input"), "2", "Study hours per day (already in the question)", "Study hours per day");
  await j.click(page.getByTestId("save-answer"), "Save answer");
  await expect(card(page)).toContainText("Weeks until the exams");
  await j.type(page.getByTestId("question-input"), "4", "Weeks until the exams (already in the question)", "Weeks until the exams");
  await j.click(page.getByTestId("save-answer"), "Save answer");
  await expect(page.getByTestId("story-calc-totalStudyHours")).toContainText("56 hours");
  j.reached("Total study hours 56 hours in “Study two hours daily”");
  await shot(page, "B2-first-future");
  // The other future needs the same two entries again, with one hour instead of two.
  await j.click(page.getByTestId("branch-Keep one hour daily"), "open “Keep one hour daily”");
  await expect(card(page)).toContainText("Study hours per day");
  await j.type(page.getByTestId("question-input"), "1", "Study hours per day (already in the question)", "Study hours per day");
  await j.click(page.getByTestId("save-answer"), "Save answer");
  await expect(card(page)).toContainText("Weeks until the exams");
  await j.type(page.getByTestId("question-input"), "4", "Weeks until the exams (already in the question)", "Weeks until the exams");
  await j.click(page.getByTestId("save-answer"), "Save answer");
  await expect(page.getByTestId("story-calc-totalStudyHours")).toContainText("28 hours");
  j.reached("Total study hours 28 hours in “Keep one hour daily” (both futures filled)");
  await shot(page, "B3-both-futures");
  results.B = { ...j.summary(), question: QUESTION_B, discover, aiRequests: seen.plan.length, refused: seen.refused.length };
  expect(seen.refused).toEqual([]);
  expect(seen.errors).toEqual([]);
});

// ---------- Scenario C: qualitative ----------

test(`C (${MODE}): team projects instead of written exams`, async ({ page }) => {
  const seen = await mockPlans(page, [r19.projects]);
  const j = new Journey(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await j.type(page.getByTestId("whatif-input"), QUESTION_C, "the question");
  await j.click(page.getByTestId("explore-possibilities"), "Explore possibilities");
  await expect(page.getByTestId("future-card-0")).toBeVisible();
  const discover = await discoverFacts(page);
  const extraPanels = await page.locator("[data-testid^=figures]").count();
  await shot(page, "C1-discover");
  await j.click(page.getByTestId("explore-future-0"), "open the first future");
  await expect(page.getByTestId("story-title")).toHaveText("Team projects replace exams");
  await expect(page.getByTestId("story-upsides")).toContainText("Teamwork skills could be practised more");
  j.reached("the first future's possibilities");
  await shot(page, "C2-story");
  results.C = { ...j.summary(), question: QUESTION_C, discover, figuresPanelsShown: extraPanels, aiRequests: seen.plan.length, refused: seen.refused.length };
  expect(seen.refused).toEqual([]);
  expect(seen.errors).toEqual([]);
});

// ---------- repeated actions in the next-step area ----------

test(`Next-step actions (${MODE}): a map with one path and every number known`, async ({ page }) => {
  const seen = await mockPlans(page, [audit.bookstore]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill("What if I rented a bigger flat?");
  await page.getByTestId("start-blank").click();
  await page.getByTestId("var-label").fill("Monthly rent");
  await page.getByTestId("var-unit").fill("£ per month");
  await page.getByTestId("var-start").fill("1200");
  await page.getByTestId("add-variable").click();
  await expect(page.getByTestId("story-known")).toContainText("Monthly rent: £1,200 per month");
  await page.getByTestId("all-details").click(); // close the editor so only the next-step area is judged
  const nextActions = await page.getByTestId("next-step").locator("button:visible").evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute("data-testid"), text: (e.textContent ?? "").replace(/\s+/g, " ").trim().replace(/^[↳⇄]\s*/, ""), primary: e.classList.contains("btn-primary") })),
  );
  await shot(page, "E1-one-path-next-step");
  results.nextStepOnePath = { heading: await text(page.getByTestId("next-step").locator("h3").first()), nextActions };
  expect(seen.refused).toEqual([]);
});

// ---------- the correction flow ----------

test(`Ask again (${MODE}): what it does with the wording and with the draft on screen`, async ({ page }) => {
  const seen = await mockPlans(page, [audit.bookstore, audit.bookstore], [0, 1500]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(QUESTION_A);
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("future-card-0")).toBeVisible();
  const wordingEditableBeforeAsking = (await page.getByTestId("edit-question").count()) > 0;
  const askAgain = page.getByTestId("retry-plan");
  const buttonText = await text(askAgain);
  await askAgain.click();
  // While the replacement is on its way: is the current draft still there? (Baseline: replaced by a loading screen. R19: kept, dimmed.)
  await expect(page.getByTestId(MODE === "after" ? "plan-busy" : "plan-loading")).toBeVisible();
  const draftVisibleWhileWaiting = await page.getByTestId("future-card-0").isVisible();
  await shot(page, "D1-ask-again-waiting");
  await expect(page.getByTestId("future-card-0")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("plan-busy")).toHaveCount(0);
  results.askAgain = {
    buttonText,
    requests: seen.plan.length,
    secondRequestQuestion: seen.plan[1]?.question,
    sameQuestionAsFirst: seen.plan[1]?.question === seen.plan[0]?.question,
    firstRequestQuestion: seen.plan[0]?.question,
    draftVisibleWhileWaiting,
    wordingEditableBeforeAsking,
  };
  expect(seen.refused).toEqual([]);
});

// ---------- R19: the same questions, with the figures read from the question ----------

if (MODE === "after") {
  /** The panel the user sees after the draft: tick state and the words, so the report can quote what was on screen. */
  const panelFacts = async (page: Page) => ({
    heading: await text(page.getByTestId("figures-panel").locator("h2")),
    rows: await page.locator("[data-testid^=figure-row-]").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim())),
    confirmDisabled: await page.getByTestId("figures-confirm").isDisabled(),
  });

  test(`A assisted (${MODE}): bookstore, one confirmation instead of typing three amounts`, async ({ page }) => {
    const seen = await mockPlans(page, [audit.bookstore]);
    const j = new Journey(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await j.type(page.getByTestId("whatif-input"), QUESTION_A, "the question");
    await j.click(page.getByTestId("explore-possibilities"), "Explore possibilities");
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    const panel = await panelFacts(page);
    await shot(page, "A1-figures-panel");
    // R20A: "₹8,000 rent" does not say per month, so it is not ticked for the user: one more click, nothing retyped.
    await expect(page.getByTestId("figure-use-1")).not.toBeChecked();
    await j.click(page.getByTestId("figure-use-1"), "tick the rent (its period is not written next to it)");
    await j.click(page.getByTestId("figures-confirm"), "Use these figures");
    await expect(page.getByTestId("figures-summary")).toContainText("Using 3 figures from your question");
    const buttonAfterConfirm = await text(page.getByTestId("explore-future-0"));
    const otherButton = await text(page.getByTestId("explore-future-1"));
    await shot(page, "A2-figures-confirmed");
    await j.click(page.getByTestId("explore-future-0"), "Save and explore the first future");
    await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹8,000 per month");
    j.reached("Shop profit ₹8,000 per month");
    const known = await text(page.getByTestId("story-known"));
    await shot(page, "A3-result");
    // The other future was not given the amounts.
    await page.getByTestId("branch-Don't open it").click();
    const otherFutureQuestion = await text(card(page));
    results.A_assisted = { ...j.summary(), question: QUESTION_A, panel, buttonAfterConfirm, otherButton, known: known.slice(0, 600), otherFutureAsks: otherFutureQuestion.slice(0, 120), aiRequests: seen.plan.length, refused: seen.refused.length };
    expect(seen.plan).toHaveLength(1);
    expect(seen.refused).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test(`B assisted (${MODE}): study plan, two hours and one hour go to their own futures and the weeks both share go to both`, async ({ page }) => {
    const seen = await mockPlans(page, [r19.education]);
    const j = new Journey(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await j.type(page.getByTestId("whatif-input"), QUESTION_B, "the question");
    await j.click(page.getByTestId("explore-possibilities"), "Explore possibilities");
    await expect(page.getByTestId("figures-panel")).toBeVisible();
    const panel = await panelFacts(page);
    await shot(page, "B1-figures-panel");
    // R20A: "one hour" borrows its period from "two hours daily", so it is not ticked for the user. The weeks are the same in the
    // two futures being compared, so they go to both by default: the weeks no longer have to be typed again (R19's 'shared' path).
    await expect(page.getByTestId("figure-use-1")).not.toBeChecked();
    await expect(page.getByTestId("figure-target-2")).toHaveValue("all");
    await j.click(page.getByTestId("figure-use-1"), "tick “one hour” (its period is taken from “two hours daily”)");
    await j.click(page.getByTestId("figures-confirm"), "Use these figures");
    await j.click(page.getByTestId("explore-future-0"), "Save and explore “Study two hours daily”");
    await expect(page.getByTestId("story-calc-totalStudyHours")).toContainText("56 hours");
    j.reached("Total study hours 56 hours in “Study two hours daily”");
    await shot(page, "B2-first-future");
    await j.click(page.getByTestId("branch-Keep one hour daily"), "open “Keep one hour daily”");
    const hoursAlreadyThere = await text(page.getByTestId("story-known"));
    await expect(card(page)).not.toContainText("Weeks until the exams");
    await expect(page.getByTestId("story-calc-totalStudyHours")).toContainText("28 hours");
    j.reached("Total study hours 28 hours in “Keep one hour daily” (both futures filled)");
    await shot(page, "B3-both-futures");
    results.B_assisted = { ...j.summary(), question: QUESTION_B, panel, otherFutureKnown: hoursAlreadyThere.slice(0, 400), aiRequests: seen.plan.length, refused: seen.refused.length };
    expect(seen.plan).toHaveLength(1);
    expect(seen.refused).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
}
