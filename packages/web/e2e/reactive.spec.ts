/**
 * R15: context-aware, reactive futures, with BOTH AI endpoints mocked (fixed replies, no network, no key).
 * Question → at most two optional context questions → tailored futures → answers change a path (what changed,
 * Known / Calculated / Possible) → an explicit, previewed, approved fresh look at ONE path. The mocks record every
 * request body, so the tests also check what is sent and how many requests each journey costs.
 * Screenshots go to docs/validation/screenshots/reactive/.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../docs/validation/screenshots/reactive/", import.meta.url));
mkdirSync(dir, { recursive: true });
const fx = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/reactive-proposals.json", import.meta.url)), "utf8"));
const MODEL = "openai/gpt-oss-120b (mocked in this test)";
/** Statements RealityFork must never show as facts. */
const CLAIMS = /visas? (is|are) available|you (are |'re )?eligible|you qualify|guaranteed to|is legally permitted/i;

type Body = Record<string, unknown>;
type Sent = { plan: Body[]; revisit: Body[] };
type Request = { suggestions: { id: string; text: string }[] };

/** Drafts: `first` without context, `tailored` with it. A fresh look: `revisit(request)`, or an error. */
async function mockAi(page: Page, o: { first: unknown; tailored: unknown; revisit?: (req: Request) => unknown }): Promise<Sent> {
  const sent: Sent = { plan: [], revisit: [] };
  await page.route("**/api/plan", async (route) => {
    const body = route.request().postDataJSON() as Body;
    sent.plan.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: body.context ? o.tailored : o.first, model: MODEL, warnings: [] }) });
  });
  await page.route("**/api/revisit", async (route) => {
    const body = route.request().postDataJSON() as Body;
    sent.revisit.push(body);
    const suggestion = o.revisit?.(body as unknown as Request);
    await route.fulfill({
      status: suggestion ? 200 : 502, contentType: "application/json",
      body: JSON.stringify(suggestion ? { ok: true, suggestion, model: MODEL, warnings: [] } : { ok: false, code: "provider-error", message: "No fresh look in this test." }),
    });
  });
  return sent;
}

/** The reply a careful model could give after "my employer allows remote work": questions, not claims. */
const relocationLook = (req: Request) => ({
  summary: "Because your employer permits remote work, this path now needs a closer look at work authorization and living costs.",
  reconsider: req.suggestions.filter((s) => s.text.startsWith("Your employer may not agree")).map((s) => ({ id: s.id, reason: "You told us your employer permits remote work." })),
  add: [
    {
      text: "Your income could continue through the move", trigger: "your employer keeps employing you while you live in Germany",
      mechanism: "Your pay would not depend on finding a German employer.", downstream: "The move could be paid for without a gap in income.",
      uncertainty: "Whether working from Germany is permitted for you, and how your employer handles pay abroad.", tone: "upside", about: ["employerAllowsAbroad"],
    },
    {
      text: "Your working hours could shift", trigger: "your team works in a different time zone",
      mechanism: "Meetings set for your team's daytime may fall early or late in Germany.", downstream: "",
      uncertainty: "Where your team is based and how flexible meeting times are.", tone: "uncertain", about: [],
    },
  ],
  questions: ["Is working from Germany legally permitted for you?", "How will the time-zone difference affect your working hours?"],
  evidence: ["Your employer's written approval to work from Germany"],
});

const overflow = (page: Page) => page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
const visiblePrimaries = (page: Page) => page.locator(".btn-primary:visible").allInnerTexts();
const node = (page: Page, name: string) => page.getByTestId(`branch-${name}`);
const ask = async (page: Page, question: string) => {
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(question);
  await page.getByTestId("explore-possibilities").click();
};

const RELOCATION = "What if I moved to another country?";
const ANSWERS = [
  { question: "Which country are you thinking of moving to?", answer: "Germany" },
  { question: "How would you earn a living there?", answer: "existing remote job" },
];
const REMOTE = "Remote relocation to Germany";
const YES = `${REMOTE} · Employer agrees to me working from Germany: yes`;
const NO = `${REMOTE} · Employer agrees to me working from Germany: no`;

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test(`A. relocation: context → tailored futures → answers change a path → approved fresh look (${vp.name})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const sent = await mockAi(page, { first: fx["relocation-first"], tailored: fx["relocation-tailored"], revisit: relocationLook });
    const widths: Record<string, { clientWidth: number; scrollWidth: number }> = {};
    const shot = async (step: string) => {
      await page.screenshot({ path: `${dir}${vp.name}-A${step}.png`, fullPage: true, animations: "disabled" });
      widths[step] = await overflow(page);
    };

    // 1. At most two optional questions, one at a time, with the original question kept on screen.
    await ask(page, RELOCATION);
    await expect(page.getByTestId("context-question")).toHaveText("Which country are you thinking of moving to?");
    await expect(page.getByTestId("context-question")).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(RELOCATION);
    await expect(page.getByTestId("context-step")).toContainText("Question 1 of 2");
    await expect(page.getByTestId("context-step")).toContainText("Rules, costs and language differ");
    expect(await visiblePrimaries(page)).toEqual(["Continue"]);
    await page.getByTestId("context-example-Germany").click();
    await expect(page.getByTestId("context-input")).toHaveValue("Germany");
    await shot("01-context-question");
    await page.getByTestId("context-continue").click();
    await expect(page.getByTestId("context-question")).toHaveText("How would you earn a living there?");
    await expect(page.getByTestId("context-question")).toBeFocused();
    await page.getByTestId("context-input").fill("existing remote job"); // free text, not one of the examples
    await expect(page.getByTestId("context-continue")).toHaveText("Show possible futures");
    await page.getByTestId("context-continue").click();

    // 2. Futures tailored to the answers: the second and last draft request carries them.
    await expect(page.getByTestId("future-name-0")).toHaveText(REMOTE);
    await expect(page.getByTestId("context-summary")).toContainText("Based on what you told us:");
    await expect(page.getByTestId("context-summary")).toContainText("Germany");
    await expect(page.getByTestId("context-summary")).toContainText("existing remote job");
    expect(sent.plan).toEqual([{ question: RELOCATION }, { question: RELOCATION, context: ANSWERS }]);
    expect(await page.getByTestId("discover").innerText()).not.toMatch(CLAIMS);
    await shot("02-tailored-futures");

    // 3. Explore: Known first; numbers come only from the user and recalculate deterministically.
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText(REMOTE);
    const known = page.getByTestId("story-known");
    await expect(known).toContainText("Known");
    await expect(known).toContainText("Germany");
    await expect(known).toContainText("existing remote job");
    await expect(page.getByTestId("story-calculated")).toContainText("Calculated");
    await expect(page.locator(".badge.possible")).toHaveText("Possible");
    expect(await visiblePrimaries(page)).toEqual(["Save answer"]);
    await page.getByTestId("question-input").fill("4000");
    await page.getByTestId("save-answer").click();
    await page.getByTestId("question-input").fill("2500");
    await page.getByTestId("save-answer").click();
    const changed = page.getByTestId("what-changed");
    await expect(changed).toContainText("Monthly income: 4,000 per month");
    await expect(changed).toContainText("Living costs in Germany: 2,500 per month");
    await expect(changed).toContainText("Left each month can now be worked out: 1,500 per month");
    // The count sits with its action, which stays reachable while a question is still open (user-testing regression 1).
    await expect(page.getByTestId("fresh-look-prompt")).toContainText("One AI suggestion may need a fresh look");
    await expect(page.getByTestId("ask-fresh-look")).toHaveCount(1);
    await expect(page.getByTestId("story-calc-leftEachMonth")).toContainText("1,500 per month");
    await expect(page.getByTestId("story-either")).toContainText("may need a fresh look");
    await expect(known).toContainText("Monthly income: 4,000 per month");
    await expect(page.getByTestId("question-card")).toContainText("Employer agrees to me working from Germany");
    await shot("03-what-changed");

    // 4. Not sure about the employer? Explore both, as two new paths. This path stays as it is.
    await page.getByTestId("explore-both").click();
    await expect(page.getByTestId("story-title")).toHaveText(YES);
    await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(6);
    await expect(node(page, NO)).toHaveCount(1);
    await expect(page.getByTestId("fresh-look")).toContainText("2 AI suggestions may need a fresh look");
    expect(await visiblePrimaries(page)).toEqual(["Ask AI to take another look"]);
    // Tell RealityFork something new about this path.
    await page.getByTestId("add-known").click();
    await page.getByTestId("add-known-text").fill("My employer allows me to work remotely");
    await page.getByTestId("add-known-save").click();
    await expect(page.getByTestId("what-changed")).toContainText("You told us: My employer allows me to work remotely");
    await expect(page.getByTestId("fresh-look")).toContainText("4 AI suggestions may need a fresh look");
    expect(sent.revisit).toHaveLength(0); // nothing is sent without the explicit action
    await shot("04-fresh-look-offered");

    // 5. The explicit action: one request, carrying only this path.
    await page.getByTestId("ask-fresh-look").click();
    await expect(page.getByTestId("revisit-summary")).toHaveText("Because your employer permits remote work, this path now needs a closer look at work authorization and living costs.");
    await expect(page.getByTestId("revisit-summary")).toBeFocused();
    await expect(page.getByTestId("revisit-reconsider")).toContainText("Your employer may not agree to you working from another country");
    await expect(page.getByTestId("revisit-add")).toContainText("Your income could continue through the move if your employer keeps employing you while you live in Germany.");
    await expect(page.getByTestId("revisit-add")).toContainText("Why: Your pay would not depend on finding a German employer.");
    await expect(page.getByTestId("revisit-verify")).toContainText("Is working from Germany legally permitted for you?");
    await expect(page.getByTestId("revisit-preview")).toContainText("not predictions or advice");
    expect(sent.revisit).toHaveLength(1);
    const req = sent.revisit[0]! as { path: unknown; context: unknown; known: unknown; assumptions: { key: string; value: unknown; source: string }[] };
    expect(req.path).toEqual({ name: YES, description: "" });
    expect(req.context).toEqual(ANSWERS);
    expect(req.known).toEqual([{ question: "", answer: "My employer allows me to work remotely" }]);
    expect(Object.fromEntries(req.assumptions.map((a) => [a.key, [a.value, a.source]]))).toEqual({
      keepRemoteJob: [true, "ai"], employerAllowsAbroad: [true, "user"], monthlyIncome: [4000, "user"], livingCosts: [2500, "user"],
    });
    for (const other of ["Find a job in Germany first", "Stay and keep working remotely", NO, "As things are"]) expect(JSON.stringify(req)).not.toContain(other);
    // Nothing changed before approval.
    await expect(page.getByTestId("story-challenges")).toContainText("Your employer may not agree");
    await shot("05-fresh-look-preview");
    await page.getByTestId("revisit-apply").click();

    // 6. Applied to this path only: set aside (kept, with the reason), new possibilities, things to verify.
    await expect(page.getByTestId("revisit-preview")).toHaveCount(0);
    await expect(page.getByTestId("story-challenges")).not.toContainText("Your employer may not agree");
    await expect(page.getByTestId("story-upsides")).toContainText("Your income could continue through the move if your employer keeps employing you while you live in Germany.");
    await expect(page.getByTestId("story-upsides")).toContainText("Then: The move could be paid for without a gap in income.");
    await expect(page.getByTestId("story-set-aside")).toContainText("Set aside after another look (1)");
    await expect(page.getByTestId("story-to-verify")).toContainText("Is working from Germany legally permitted for you?");
    await expect(page.getByTestId("story-to-verify")).toContainText("Find out: Your employer's written approval to work from Germany");
    await expect(page.getByTestId("fresh-look")).toHaveCount(0);
    await expect(page.locator("[data-testid^=stale-]")).toHaveCount(0);
    expect(await page.getByTestId("story").innerText()).not.toMatch(CLAIMS);
    await page.getByTestId("story-set-aside").locator("summary").click();
    await expect(page.getByTestId("story-set-aside")).toContainText("You told us your employer permits remote work.");
    await shot("06-after-fresh-look");

    // 7. Branches stay independent: the "no" path and the parent are untouched.
    await node(page, NO).click();
    await expect(page.getByTestId("story-title")).toHaveText(NO);
    await expect(page.getByTestId("story-challenges")).toContainText("Your employer may not agree");
    await expect(page.getByTestId("story")).not.toContainText("Your income could continue through the move");
    await expect(page.getByTestId("story-known")).not.toContainText("My employer allows me to work remotely");
    await expect(page.getByTestId("story-set-aside")).toHaveCount(0);
    await node(page, REMOTE).click();
    await expect(page.getByTestId("story-title")).toHaveText(REMOTE);
    await expect(page.getByTestId("story")).not.toContainText("Your income could continue through the move");
    await expect(page.getByTestId("story-known")).not.toContainText("My employer allows me to work remotely");

    // Saved in the browser. Three AI requests in total, each started by the user.
    await page.reload();
    await expect(page.getByTestId("map").locator(".mnode")).toHaveCount(6);
    expect([sent.plan.length, sent.revisit.length]).toEqual([2, 1]);
    writeFileSync(`${dir}${vp.name}-A-overflow.json`, JSON.stringify(widths, null, 2));
    for (const [step, o] of Object.entries(widths)) expect.soft(o.scrollWidth, `horizontal overflow at ${vp.name} ${step}`).toBeLessThanOrEqual(o.clientWidth);
    expect(errors).toEqual([]);
  });
}

test("B. restaurant: the place and an unknown budget shape the futures; the unknown stays unknown; context is editable later", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await mockAi(page, { first: fx["restaurant-first"], tailored: fx["restaurant-tailored"] });
  const question = "What if I opened a restaurant?";
  await ask(page, question);
  await expect(page.getByTestId("context-question")).toHaveText("Where would the restaurant be?");
  await page.getByTestId("context-input").fill("Mumbai");
  await page.getByTestId("context-input").press("Enter");
  await expect(page.getByTestId("context-question")).toHaveText("Do you know your budget yet?");
  await page.getByTestId("context-example-Not yet known").click();
  await page.getByTestId("context-continue").click();
  await expect(page.getByTestId("future-name-0")).toHaveText("Cloud kitchen for delivery");
  await expect(page.getByTestId("context-summary")).toContainText("Mumbai");
  await expect(page.getByTestId("context-summary")).toContainText("Not yet known");
  expect(sent.plan[1]).toEqual({ question, context: [{ question: "Where would the restaurant be?", answer: "Mumbai" }, { question: "Do you know your budget yet?", answer: "Not yet known" }] });
  await page.screenshot({ path: `${dir}desktop-1440-B01-tailored-futures.png`, fullPage: true, animations: "disabled" });

  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-title")).toHaveText("Cloud kitchen for delivery");
  // The budget is not invented: it stays unknown, and what needs it says so.
  await expect(page.getByTestId("question-card")).toContainText("Start-up budget");
  await page.getByTestId("skip-question").click();
  await page.getByTestId("question-input").fill("400000");
  await page.getByTestId("save-answer").click();
  await page.getByTestId("question-input").fill("350000");
  await page.getByTestId("save-answer").click();
  await expect(page.getByTestId("story-calc-profitPerMonth")).toContainText("50,000 per month");
  await expect(page.getByTestId("story-calc-monthsToEarnBackTheBudget")).toContainText("needs Start-up budget");
  await expect(page.getByTestId("what-changed")).toContainText("Profit per month can now be worked out: 50,000 per month");
  await expect(page.getByTestId("what-changed")).toContainText("Months to earn back the budget still needs Start-up budget");
  await expect(page.getByTestId("story-unknowns")).toContainText("Start-up budget");
  // A suggestion that depends on the costs may need a fresh look; the user can carry on without AI.
  await expect(page.getByTestId("fresh-look")).toContainText("One AI suggestion may need a fresh look");
  await expect(page.getByTestId("fresh-look")).toContainText("Running costs per month changed since it was suggested.");
  await page.getByTestId("continue-without-ai").click();
  await expect(page.getByTestId("compare-suggested")).toBeVisible();

  // Edit the context later. It applies to every path; the original question is kept.
  await page.getByTestId("known-context-0-edit").click();
  await page.getByTestId("known-context-0-input").fill("Pune");
  await page.getByTestId("known-context-0-save").click();
  await expect(page.getByTestId("story-known")).toContainText("Pune");
  await expect(page.getByTestId("what-changed")).toContainText("Now: Pune (was Mumbai)");
  await expect(page.getByTestId("question")).toHaveText(question);
  await expect(page.getByTestId("fresh-look")).toContainText("suggested before you told us something new");
  await page.screenshot({ path: `${dir}desktop-1440-B02-context-edited.png`, fullPage: true, animations: "disabled" });
  await node(page, "Small café").click();
  await expect(page.getByTestId("story-known")).toContainText("Pune");
  await expect(page.getByTestId("story-known")).not.toContainText("Mumbai");
  expect([sent.plan.length, sent.revisit.length]).toEqual([2, 0]);
});

test("C. university: skipping both questions costs no extra request; answering one later tailors the futures", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await mockAi(page, { first: fx["university-first"], tailored: fx["university-tailored"] });
  const question = "What if my university replaced written exams with project-based assessment?";
  await ask(page, question);
  await expect(page.getByTestId("context-question")).toHaveText("What is your role at the university?");
  await page.getByTestId("context-skip").click();
  await expect(page.getByTestId("context-question")).toHaveText("Which subject area is this about?");
  await expect(page.getByTestId("context-skip")).toHaveText("Skip and show the futures");
  await page.getByTestId("context-skip").click();
  await expect(page.getByTestId("future-name-0")).toHaveText("Projects replace exams");
  await expect(page.getByTestId("context-summary")).toContainText("These futures are general.");
  expect(sent.plan).toEqual([{ question }]);
  await page.screenshot({ path: `${dir}desktop-1440-C01-skipped-both.png`, fullPage: true, animations: "disabled" });

  // Changing your mind: answer one question; one more request, with that answer only.
  await page.getByTestId("tailor-futures").click();
  await expect(page.getByTestId("context-question")).toHaveText("What is your role at the university?");
  await page.getByTestId("context-example-Student").click();
  await page.getByTestId("context-continue").click();
  await page.getByTestId("context-skip").click();
  await expect(page.getByTestId("context-summary")).toContainText("Based on what you told us:");
  await expect(page.getByTestId("context-summary")).toContainText("Student");
  expect(sent.plan[1]).toEqual({ question, context: [{ question: "What is your role at the university?", answer: "Student" }] });

  await page.getByTestId("explore-future-0").click();
  // No formulas in this situation: nothing is calculated and no number is shown.
  await expect(page.getByTestId("story-calculated")).toHaveCount(0);
  await expect(page.getByTestId("story-known")).toContainText("Student");
  await expect(page.getByTestId("story-upsides")).toContainText("Less pressure from single high-stakes exams");
  // A yes/no question can be explored both ways; the dependent suggestion is flagged in the new path.
  await expect(page.getByTestId("question-card")).toContainText("Projects done in groups");
  await page.getByTestId("explore-both").click();
  await expect(page.getByTestId("story-title")).toHaveText("Projects replace exams · Projects done in groups: yes");
  await expect(page.getByTestId("story-challenges")).toContainText("Group members may contribute unevenly");
  await expect(page.getByTestId("story-challenges").locator(".tag.fresh")).toHaveCount(1);
  await node(page, "Projects replace exams").click();
  await expect(page.locator(".tag.fresh")).toHaveCount(0);
  expect([sent.plan.length, sent.revisit.length]).toEqual([2, 0]);
  await page.screenshot({ path: `${dir}desktop-1440-C02-explore-both.png`, fullPage: true, animations: "disabled" });
});

test("a fresh look that claims eligibility is refused in the browser, without showing the claim, and nothing changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await mockAi(page, {
    first: fx["relocation-first"], tailored: fx["relocation-tailored"],
    revisit: () => ({ summary: "Because you are eligible for a digital nomad visa, this path is simple.", reconsider: [], add: [], questions: [], evidence: [] }),
  });
  await ask(page, RELOCATION);
  await page.getByTestId("context-input").fill("Germany");
  await page.getByTestId("context-continue").click();
  await page.getByTestId("context-skip").click();
  await page.getByTestId("explore-future-0").click();
  for (let i = 0; i < 3; i++) await page.getByTestId("skip-question").click();
  await page.getByTestId("add-known").click();
  await page.getByTestId("add-known-text").fill("My employer allows me to work remotely");
  await page.getByTestId("add-known-save").click();
  const before = await page.getByTestId("story").innerText();
  await page.getByTestId("ask-fresh-look").click();
  await expect(page.getByTestId("revisit-error")).toContainText("The AI's suggestions didn't pass our checks");
  await expect(page.getByTestId("revisit-error")).toContainText("states eligibility");
  await expect(page.getByTestId("revisit-error")).toContainText("Nothing in this path was changed.");
  expect(await page.locator("body").innerText()).not.toMatch(/digital nomad/i);
  await page.getByTestId("revisit-dismiss").click();
  expect(await page.getByTestId("story").innerText()).toBe(before);
  expect(sent.revisit).toHaveLength(1);
});

/**
 * Regressions from user testing: (1) a fact added while questions remain flagged suggestions but offered no way to ask
 * for a fresh look; (2) a fact that plainly answers an open question left it "Still unknown" with no way to connect them.
 * Uses the assumption label and the sentence from the report.
 */
test.describe("user-testing regressions", () => {
  const REPORTED_FACT = "My employer has explicitly approved me working remotely from Germany.";
  const LABEL = "Employer allows work from abroad";
  const tailored = () => {
    const p = structuredClone(fx["relocation-tailored"]) as { variables: { key: string; label: string }[] };
    p.variables = p.variables.map((v) => (v.key === "employerAllowsAbroad" ? { ...v, label: LABEL } : v));
    return p;
  };
  async function tellOnRemotePath(page: Page) {
    const sent = await mockAi(page, { first: fx["relocation-first"], tailored: tailored(), revisit: relocationLook });
    await ask(page, RELOCATION);
    await page.getByTestId("context-input").fill("Germany");
    await page.getByTestId("context-continue").click();
    await page.getByTestId("context-input").fill("existing remote job");
    await page.getByTestId("context-continue").click();
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText(REMOTE);
    // No question answered yet: every number is still unknown, as in the report.
    await expect(page.getByTestId("question-card")).toBeVisible();
    await page.getByTestId("add-known").click();
    await page.getByTestId("add-known-text").fill(REPORTED_FACT);
    await page.getByTestId("add-known-save").click();
    await expect(page.getByTestId("story-known")).toContainText(REPORTED_FACT);
    return sent;
  }

  for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
    test(`1. after a new fact, "Ask AI to take another look" is offered even while questions remain (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const sent = await tellOnRemotePath(page);
      await expect(page.locator("[data-testid^=stale-]")).toHaveCount(4);
      // Exactly one action, visible without scrolling, next to the count it refers to.
      await expect(page.getByTestId("ask-fresh-look")).toHaveCount(1);
      await expect(page.getByTestId("ask-fresh-look")).toBeInViewport();
      await expect(page.getByTestId("fresh-look-prompt")).toContainText("4 AI suggestions may need a fresh look");
      await expect(page.getByTestId("question-card")).toBeVisible(); // answering questions stays available
      await page.screenshot({ path: `${dir}${vp.name}-R1-fresh-look-with-open-questions.png`, fullPage: true, animations: "disabled" });
      expect(sent.revisit).toHaveLength(0);
      await page.getByTestId("ask-fresh-look").click();
      await expect(page.getByTestId("revisit-preview")).toBeVisible();
      expect(sent.revisit).toHaveLength(1);
      expect((sent.revisit[0] as { known: unknown }).known).toEqual([{ question: "", answer: REPORTED_FACT }]);
    });
  }

  test("2. a fact that matches an open question is offered as its answer; nothing changes until the user chooses", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const sent = await tellOnRemotePath(page);
    // Not changed silently: still unknown, still no value.
    await expect(page.getByTestId("story-unknowns")).toContainText(LABEL);
    await expect(page.getByTestId("story-known")).not.toContainText(`${LABEL}: yes`);
    // The matching question comes next and quotes what the user said.
    const card = page.getByTestId("question-card");
    await expect(card).toContainText(LABEL);
    await expect(card.getByTestId("question-told")).toContainText(REPORTED_FACT);
    await page.screenshot({ path: `${dir}desktop-1440-R2-fact-offered-as-answer.png`, fullPage: true, animations: "disabled" });
    await card.getByTestId("answer-true").click();
    await expect(page.getByTestId("story-unknowns")).not.toContainText(LABEL);
    await expect(page.getByTestId("story-known")).toContainText(`${LABEL}: yes`);
    await expect(page.getByTestId("what-changed")).toContainText(`${LABEL}: yes`);
    await page.getByTestId("all-details").click();
    await expect(page.getByTestId("value-source-employerAllowsAbroad")).toHaveText("Set by you");
    // The connection is deterministic: no AI request was made for it.
    expect([sent.plan.length, sent.revisit.length]).toEqual([2, 0]);
  });

  test("2b. a skipped question comes back when the user later says something that matches it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockAi(page, { first: fx["relocation-first"], tailored: tailored(), revisit: relocationLook });
    await ask(page, RELOCATION);
    await page.getByTestId("context-input").fill("Germany");
    await page.getByTestId("context-continue").click();
    await page.getByTestId("context-skip").click();
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText(REMOTE);
    for (const label of ["Monthly income", "Living costs in Germany", LABEL]) {
      await expect(page.getByTestId("question-card")).toContainText(label);
      await expect(page.getByTestId("question-told")).toHaveCount(0);
      await page.getByTestId("skip-question").click();
    }
    await expect(page.getByTestId("question-card")).toHaveCount(0);
    await page.getByTestId("add-known").click();
    await page.getByTestId("add-known-text").fill(REPORTED_FACT);
    await page.getByTestId("add-known-save").click();
    await expect(page.getByTestId("question-card")).toContainText(LABEL);
    await expect(page.getByTestId("question-told")).toContainText(REPORTED_FACT);
    await expect(page.getByTestId("ask-fresh-look")).toHaveCount(1);
  });
});

/**
 * R16: a consequence explains why. Uses the question and the information from the real-world test in the R16 brief,
 * with a mocked careful reply (a deterministic stand-in for the model; the live result is recorded separately).
 */
test.describe("R16: conditional consequences", () => {
  const QUESTION = "What if I moved to Germany while keeping my current remote job?";
  const EXPECTATION = "I expect the cost of living in Germany to be higher than in my current city.";
  const careful = () => ({
    summary: "Because you expect living costs in Germany to be higher, this path could leave you less money each month on the same salary.",
    reconsider: [],
    add: [
      {
        text: "Monthly savings could shrink", trigger: "living costs in Germany turn out higher while your salary stays the same",
        mechanism: "Rent, insurance and daily costs would take a larger share of the same income.", downstream: "Housing choices or savings goals may need to change.",
        uncertainty: "Your actual rent, health insurance, taxes and salary after the move.", tone: "challenge", about: ["livingCosts", "monthlyIncome"],
      },
      {
        text: "A smaller or shared home could keep costs closer to what you pay now", trigger: "you choose housing to offset higher prices",
        mechanism: "Rent is the living cost you choose most directly.", downstream: "You might trade space or location for a lower monthly cost.",
        uncertainty: "Rents for the homes you would accept in the city you choose.", tone: "uncertain", about: ["livingCosts"],
      },
      {
        text: "Keeping your remote salary could soften higher prices", trigger: "you keep your remote job and your pay after the move",
        mechanism: "Your income would not drop while you adjust to the new costs.", downstream: "",
        uncertainty: "Whether your employer agrees, and whether your pay changes if you live abroad.", tone: "upside", about: ["keepRemoteJob"],
      },
    ],
    questions: ["What would rent and health insurance cost in the city you are considering?"],
    evidence: ["Recent rent listings for the area you would live in"],
  });
  const TASKS = ["Investigate housing costs.", "Check health insurance requirements.", "Assess whether salary covers expenses.", "Consider German language classes."];
  const TASK_RE = /^(Investigate|Check|Assess|Consider|Compare|Plan|Research)\b/m;

  async function openRemotePath(page: Page, revisit: (req: Request) => unknown) {
    const sent = await mockAi(page, { first: fx["relocation-tailored"], tailored: fx["relocation-tailored"], revisit });
    await ask(page, QUESTION);
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText(REMOTE);
    return sent;
  }

  for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
    test(`a fresh look adds consequences that say why, not research tasks (${vp.name})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const sent = await openRemotePath(page, careful);
      const widths: { clientWidth: number; scrollWidth: number }[] = [];

      // 1. First-draft suggestions keep their one-line R15 form (R16 adds causes to fresh looks only).
      await expect(page.getByTestId("story-upsides")).toContainText("Income continues from the first day");
      await expect(page.locator("details.cons-why")).toHaveCount(0);

      // 2. Tell RealityFork the expectation from the real-world test, then ask for another look.
      await page.getByTestId("add-known").click();
      await page.getByTestId("add-known-text").fill(EXPECTATION);
      await page.getByTestId("add-known-save").click();
      await page.getByTestId("ask-fresh-look").click();
      const preview = page.getByTestId("revisit-preview");
      await expect(preview).toBeVisible();
      await expect(page.getByTestId("revisit-add")).toContainText("Monthly savings could shrink if living costs in Germany turn out higher while your salary stays the same.");
      await expect(page.getByTestId("revisit-add")).toContainText("Why: Rent, insurance and daily costs would take a larger share of the same income.");
      await expect(page.getByTestId("revisit-add")).toContainText("Then: Housing choices or savings goals may need to change.");
      // Things to find out stay separate from consequences.
      await expect(page.getByTestId("revisit-verify")).toContainText("What would rent and health insurance cost in the city you are considering?");
      expect(await page.getByTestId("revisit-add").innerText()).not.toMatch(TASK_RE);
      expect((sent.revisit[0] as { known: unknown }).known).toEqual([{ question: "", answer: EXPECTATION }]);
      await page.screenshot({ path: `${dir}${vp.name}-R16-01-fresh-look-consequences.png`, fullPage: true, animations: "disabled" });
      widths.push(await overflow(page));

      // 3. Approved: the consequence joins this path with its cause; its unknown inputs stay explicitly unresolved.
      await page.getByTestId("revisit-apply").click();
      const challenges = page.getByTestId("story-challenges");
      await expect(challenges).toContainText("Monthly savings could shrink if living costs in Germany turn out higher while your salary stays the same.");
      const added = challenges.locator("li.cons", { hasText: "Monthly savings could shrink" }).locator("details.cons-why");
      await added.locator("summary").click();
      await expect(added).toContainText("Depends on: Living costs in Germany (not known yet); Monthly income (not known yet)");
      await expect(added).toContainText("What could change this: Your actual rent, health insurance, taxes and salary after the move.");
      await expect(page.getByTestId("story-either")).toContainText("A smaller or shared home could keep costs closer to what you pay now if you choose housing to offset higher prices.");
      expect(await page.getByTestId("story").innerText()).not.toMatch(CLAIMS);
      await page.screenshot({ path: `${dir}${vp.name}-R16-02-consequence-in-path.png`, fullPage: true, animations: "disabled" });
      widths.push(await overflow(page));

      // 4. What could change the outcome: a consequence that rests on a decision offers that decision on a new path.
      const salary = page.getByTestId("story-upsides").locator("li.cons", { hasText: "Keeping your remote salary could soften higher prices" }).locator("details.cons-why");
      await salary.locator("summary").click();
      await expect(salary).toContainText("Depends on: Keep my current remote job: yes");
      // (R17) "What if this changed?" offers the decision it depends on, first, on a new path.
      await page.getByTestId("story-upsides").locator("li.cons", { hasText: "Keeping your remote salary could soften higher prices" }).getByRole("button", { name: /^What if this changed\?/ }).click();
      await expect(page.getByTestId("whatif-sheet")).toBeVisible();
      await expect(page.getByTestId("whatif-sheet").locator(".whatif-list").first()).toContainText("Keep my current remote job");
      await expect(page.getByTestId("whatif-choice-keepRemoteJob-false")).toBeVisible();
      await page.getByTestId("whatif-cancel").click();

      // Saved and still explained after a reload; one draft and one look in total.
      await page.reload();
      await node(page, REMOTE).click(); // a reload reopens the map at its starting point
      await expect(page.getByTestId("story-challenges")).toContainText("Then: Housing choices or savings goals may need to change.");
      expect([sent.plan.length, sent.revisit.length]).toEqual([1, 1]);
      for (const o of widths) expect.soft(o.scrollWidth, `horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(o.clientWidth);
      expect(errors).toEqual([]);
    });
  }

  test("a look made of research tasks is refused in the browser and changes nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const sent = await openRemotePath(page, () => ({ ...careful(), add: TASKS.map((text) => ({ ...careful().add[0]!, text })) }));
    await page.getByTestId("add-known").click();
    await page.getByTestId("add-known-text").fill(EXPECTATION);
    await page.getByTestId("add-known-save").click();
    const before = await page.getByTestId("story").innerText();
    await page.getByTestId("ask-fresh-look").click();
    await expect(page.getByTestId("revisit-error")).toContainText("The AI's suggestions didn't pass our checks");
    await expect(page.getByTestId("revisit-error")).toContainText("is a task or advice, not a consequence");
    await expect(page.getByTestId("revisit-error")).not.toContainText("housing costs");
    await page.getByTestId("revisit-dismiss").click();
    expect(await page.getByTestId("story").innerText()).toBe(before);
    expect(sent.revisit).toHaveLength(1);
  });
});
