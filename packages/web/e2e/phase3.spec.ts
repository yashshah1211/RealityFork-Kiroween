/**
 * Phase 3: the whole product in the new design, through the real app and the real RealityStore.
 *
 * AI replies are FIXTURES (e2e/fixtures/phase3-proposals.json, checked by validateProposal and validateRevisit in
 * src/reality/phase3.fixtures.test.ts), served by intercepting POST /api/plan and POST /api/revisit. No request reaches a
 * provider and no live model is tested here. Every other /api request is refused and recorded, every request must stay
 * on this server, and every figure is typed by the test, as a user would. Nothing is written to docs/: the evidence
 * screenshots come from docs/validation/full-experience/capture-phase3.mjs.
 *
 * - A custom question (an independent gaming company) from Discover to a saved, reopened and re-imported map: universe,
 *   ancestry, figures, facts, unknowns, consequences, the fresh look and Compare.
 * - An unusual question (the cello at sixty) on a phone: the open-sky universe, and a question field that looks editable.
 * - Content kinds kept apart (Known, Calculated, Possible, Unknown, Not applicable; no Simulated without a model).
 * - Discover when the AI guide fails: unavailable, busy, a draft that fails the checks, cancelling, mapping it by hand.
 * - The library, the More menu, help, confirmations, toasts and files, by keyboard where it matters.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { details, GPU, PREVIEW, settle, stats } from "./atlas-helpers";

test.use({ launchOptions: { args: GPU } });

const FX = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/phase3-proposals.json", import.meta.url)), "utf8")) as Record<string, unknown>;
const MODEL = "fixture: phase3-proposals.json (mocked, no AI request)";
const GAMING = "What if I started my own independent gaming company?";
const CELLO = "What if I learned to play the cello at sixty?";
const STUDIO = "Self-funded indie studio";
const CHILD = "Self-funded indie studio · Where the work happens: Spare room at home";
const FRIENDS = "Two friends could help with art and music";
const REVISIT = FX["gaming-revisit"] as { summary: string; reconsider: { match: string; reason: string }[]; add: { text: string; trigger: string }[] } & Record<string, unknown>;

const norm = (q: string) => q.trim().replace(/^what if\s+/i, "").replace(/\?+$/, "").toLowerCase();
/** The fixture for a planner request: the gaming draft before and after the user's answers, or the cello draft. */
function draftFor(body: { question?: string; context?: unknown[] }) {
  const q = norm(body.question ?? "");
  if (q === norm(GAMING)) return body.context?.length ? FX["gaming-tailored"] : FX["gaming-first"];
  if (q === norm(CELLO)) return FX.cello;
  return undefined;
}

type Seen = { plan: { question: string; context: number }[]; revisit: number; refused: string[]; foreign: string[]; errors: string[] };
/**
 * Serve the fixtures, refuse and record anything else, and record what leaves this server and every page error.
 * `failPlan` answers the first planner requests with the given replies instead (then the fixtures again).
 */
async function serve(page: Page, failPlan: { status: number; body: unknown }[] = [], delayMs = 0): Promise<Seen> {
  const seen: Seen = { plan: [], revisit: 0, refused: [], foreign: [], errors: [] };
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("http://localhost:5179/") && !u.startsWith("data:") && !u.startsWith("blob:")) seen.foreign.push(u);
  });
  page.on("pageerror", (e) => seen.errors.push(e.message));
  // A failed reply the test asked for is logged by the browser as a failed resource; nothing else may be.
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource: the server responded with a status of (429|503)/.test(m.text()) && seen.errors.push(m.text()));
  const fails = [...failPlan];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    if (path === "/api/plan") {
      seen.plan.push({ question: String(body.question ?? ""), context: Array.isArray(body.context) ? body.context.length : 0 });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const fail = fails.shift();
      if (fail) return route.fulfill({ status: fail.status, contentType: "application/json", body: JSON.stringify(fail.body) });
      const proposal = draftFor(body as { question?: string; context?: unknown[] });
      if (proposal) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal, model: MODEL, warnings: [] }) });
    }
    if (path === "/api/revisit") {
      seen.revisit++;
      // The fresh look names the suggestions it reconsiders by their text; their ids come from this request.
      const suggestions = (body.suggestions ?? []) as { id: string; text: string }[];
      const suggestion = { ...REVISIT, reconsider: REVISIT.reconsider.flatMap((x) => suggestions.filter((s) => s.text === x.match).map((s) => ({ id: s.id, reason: x.reason }))) };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, suggestion, model: MODEL, warnings: [] }) });
    }
    seen.refused.push(`${path} ${String(body.question ?? "")}`);
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked", message: "No such request is expected in this test." }) });
  });
  return seen;
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const calc = (page: Page, label: string) => page.locator('[data-testid^="atlas-calc-"]').filter({ hasText: label });
async function openSection(page: Page, testid: string) {
  await details(page);
  const d = page.getByTestId(testid);
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator("summary").first().click();
}
async function answer(page: Page, key: string, value: string) {
  await details(page);
  await page.getByTestId(`atlas-ask-${key}`).click();
  await page.getByTestId("question-input").fill(value);
  await page.getByTestId("save-answer").click();
  await expect(page.getByTestId(`atlas-ask-${key}`)).toHaveCount(0);
}
/** The child path, reached from the start of a reopened map through the world's own labels. */
async function goToChild(page: Page) {
  await expect(page.getByTestId("atlas-title")).toHaveText("As things are");
  await page.getByTestId(`atlas-node-${STUDIO}`).click();
  await expect(page.getByTestId("atlas-title")).toHaveText(STUDIO);
  await page.getByTestId(`atlas-node-${CHILD}`).click();
  await expect(page.getByTestId("atlas-title")).toHaveText(CHILD);
}
/** What must survive saving, reopening and importing: ancestry, the user's figures and words, the set-aside, the universe. */
async function expectChildIntact(page: Page) {
  await details(page);
  await expect(page.getByTestId("atlas-parent")).toHaveText(STUDIO);
  await expect(page.getByTestId(`atlas-crumb-${STUDIO}`)).toBeVisible();
  await expect(page.getByTestId("atlas-crumb-As things are")).toBeVisible();
  await expect(page.getByTestId("atlas-crumb-current")).toHaveText(CHILD);
  await openSection(page, "atlas-known");
  await expect(page.getByTestId("atlas-known-value-savings")).toContainText("Savings available: 18,000");
  await expect(page.getByTestId("atlas-known-value-savings")).toContainText(`from “${STUDIO}”`);
  await expect(page.getByTestId("atlas-known-value-monthlyCosts")).toContainText("Monthly costs: 1,500 per month");
  await expect(page.getByTestId("atlas-known-value-workspace")).toContainText("Where the work happens: Spare room at home");
  await expect(page.getByTestId("atlas-known")).toContainText(FRIENDS);
  await expect(page.getByTestId("atlas-known")).toContainText("Small story-driven games");
  await expect(calc(page, "Months the savings last")).toContainText("12 months");
  await openSection(page, "atlas-possible");
  await expect(page.getByTestId("atlas-possible")).toContainText(REVISIT.add[0]!.text);
  await expect(page.getByTestId("atlas-set-aside")).toContainText("Savings run out before the game is finished");
  await settle(page);
  const s = (await stats(page))!;
  expect(s.universe).toBe("business");
  await expect(page.getByTestId("atlas-scenery-name")).toHaveText("Shops and studios, a studio");
}

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("custom question: gaming company from Discover to a saved, reopened and re-imported map", async ({ page }) => {
    test.setTimeout(240_000);
    const seen = await serve(page, [], 600);
    await page.goto(PREVIEW);
    await page.getByTestId("whatif-input").fill(GAMING);
    await page.getByTestId("explore-possibilities").click();
    // Loading can be cancelled; here it is allowed to finish.
    await expect(page.getByTestId("plan-loading")).toBeVisible();
    await expect(page.getByTestId("cancel-plan")).toBeVisible();

    // Two optional questions, one at a time: one answered, one skipped. The answer is the only reason for a second draft.
    await expect(page.getByTestId("context-step")).toContainText("Question 1 of 2");
    await expect(page.getByTestId("context-step")).toContainText("What kind of games would you like to make?");
    await page.getByTestId("context-example-Small story-driven games").click();
    await page.getByTestId("context-continue").click();
    await expect(page.getByTestId("context-step")).toContainText("Question 2 of 2");
    await page.getByTestId("context-skip").click();

    // Discover: three AI-suggested futures; nothing is saved before one is chosen.
    await expect(page.getByTestId("future-card-2")).toBeVisible();
    await expect(page.getByTestId("discover")).toContainText("AI-suggested");
    await expect(page.getByTestId("discover")).toContainText("not predictions");
    await expect(page.getByTestId("future-card-0")).toContainText(STUDIO);
    await expect(page.getByTestId("future-card-0")).toContainText("Decided in this future");
    await expect(page.getByTestId("future-card-0")).toContainText("How the work is paid for: Own savings");
    await expect(page.getByTestId("future-card-0")).toContainText("Full creative control over the story and its world");
    await expect(page.getByTestId("context-summary")).toContainText("Small story-driven games");
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain("independent gaming company");
    expect(seen.plan).toEqual([{ question: GAMING, context: 0 }, { question: GAMING, context: 1 }]);

    // Choosing a future is the approval: the map opens in the business universe, a studio.
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("atlas")).toBeVisible();
    await expect(page.getByTestId("atlas-title")).toHaveText(STUDIO);
    await expect(page.getByTestId("atlas-kind")).toHaveText("A map the AI drafted and you accepted");
    await settle(page);
    let s = (await stats(page))!;
    expect(s.universe).toBe("business");
    await expect(page.getByTestId("atlas-scenery-name")).toHaveText("Shops and studios, a studio");
    await expect(page.getByTestId("atlas-world")).toContainText("Illustrative scenery");

    // Calculated only once every input is the user's: no number before, one after (every figure is in the card's Details).
    await details(page);
    await expect(calc(page, "Months the savings last")).toContainText("needs");
    await expect(calc(page, "Months the savings last")).not.toContainText("months");
    await answer(page, "savings", "18000");
    await answer(page, "monthlyCosts", "1500");
    await expect(calc(page, "Months the savings last")).toContainText("12 months");
    await expect(page.getByTestId("atlas-simulated")).toHaveCount(0);

    // A child path with one change, through the branch sheet.
    await page.getByTestId("atlas-branch").click();
    await page.getByTestId("fork-choice-workspace-Spare room at home").click();
    await expect(page.getByTestId("atlas-title")).toHaveText(CHILD);
    await expect(page.getByTestId("atlas-parent")).toHaveText(STUDIO);
    await expect(page.getByTestId("atlas-changes")).toContainText("Where the work happens: Spare room at home");

    // Facts: the context answer (every path), figures from the parent, the change, and something the user adds.
    await openSection(page, "atlas-known");
    await page.getByTestId("atlas-add-known").click();
    await page.getByTestId("atlas-known-text").fill(FRIENDS);
    await page.getByTestId("atlas-known-save").click();
    await expect(page.getByTestId("atlas-known")).toContainText(FRIENDS);
    await expect(page.getByTestId("atlas-known-context-0")).toContainText("every path");
    // Unknowns are questions, not zeros.
    await expect(page.getByTestId("atlas-unknown")).toContainText("Months until the first release");
    await expect(page.getByTestId("atlas-unknown")).toContainText("Team size");
    await expect(page.getByTestId("atlas-ask-savings")).toHaveCount(0);
    await expect(calc(page, "Months the savings last")).toContainText("12 months");

    // Consequences: the parent's suggestions came before the figures, so a fresh look is offered; nothing changes until
    // the user applies it, and the reconsidered suggestion is set aside, not deleted.
    await openSection(page, "atlas-possible");
    await expect(page.getByTestId("atlas-possible")).toContainText("Savings run out before the game is finished");
    await expect(page.getByTestId("atlas-fresh-look")).toBeVisible();
    expect(seen.revisit).toBe(0);
    await page.getByTestId("atlas-ask-fresh-look").click();
    await expect(page.getByTestId("revisit-preview")).toBeVisible();
    await expect(page.getByTestId("revisit-summary")).toHaveText(REVISIT.summary);
    await expect(page.getByTestId("revisit-reconsider")).toContainText("Savings run out before the game is finished");
    await expect(page.getByTestId("revisit-add")).toContainText(`if ${REVISIT.add[0]!.trigger}`);
    await expect(page.getByTestId("revisit-preview")).toContainText("Nothing changes until you choose");
    await expect(page.getByTestId("revisit-preview")).toContainText(MODEL);
    await page.getByTestId("revisit-apply").click();
    await openSection(page, "atlas-possible");
    for (const a of REVISIT.add) await expect(page.getByTestId("atlas-possible")).toContainText(a.text);
    await expect(page.getByTestId("atlas-set-aside")).toContainText("Savings run out before the game is finished");
    expect(seen.revisit).toBe(1);

    // Compare with the parent, then back to Explore on the same path.
    await page.getByTestId("atlas-compare").click();
    await page.getByTestId(`compare-pick-${STUDIO}`).click();
    await expect(page.getByTestId("compare-view")).toBeVisible();
    await expect(page.getByTestId("cmp-differ")).toContainText("Where the work happens");
    await expect(page.getByTestId("compare-view")).toContainText(FRIENDS);
    await expect(page.getByTestId("compare-view")).toContainText("12 months");
    await page.getByTestId("compare-back").click();
    await expect(page.getByTestId("atlas-title")).toHaveText(CHILD);

    // Saved as it went: after a reload the map reopens by itself, at its start; it is also listed on the start screen.
    await expect(page.getByTestId("saved-note")).toContainText("Saved in this browser");
    await page.reload();
    await expect(page.getByTestId("atlas")).toBeVisible();
    await expect(page.getByTestId("atlas-title")).toHaveText("As things are");
    await page.getByTestId("home").click();
    await page.getByTestId(`open-${GAMING}`).click();
    await expect(page.getByTestId("atlas")).toBeVisible();
    await goToChild(page);
    await expectChildIntact(page);

    // The library lists it with its universe, saves it to a file, removes it only after a confirmation, and opens the file.
    await page.getByTestId("more-menu").click();
    await page.getByTestId("more-library").click();
    await expect(page.getByTestId("library")).toBeVisible();
    const card = page.locator('[data-testid^="library-map-"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("AI-drafted, accepted by you");
    await expect(card).toContainText("5 paths");
    await expect(card).toContainText("Drawn as shops and studios, a studio (illustrative)");
    const download = page.waitForEvent("download");
    await page.getByTestId("library-export").click();
    const dl = await download;
    expect(dl.suggestedFilename()).toBe("realityfork-realities.json");
    const file = readFileSync((await dl.path())!, "utf8");
    for (const words of [CHILD, FRIENDS, "Spare room at home", GAMING]) expect(file).toContain(words);
    await expect(page.getByTestId("toast")).toContainText("Saved 1 map to a file");
    await page.getByTestId("library-reset").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("Remove your map from this browser?");
    await page.getByTestId("confirm-cancel").click();
    await expect(card).toHaveCount(1);
    await page.getByTestId("library-reset").click();
    await page.getByTestId("confirm-accept").click();
    await expect(page.getByTestId("library-empty")).toBeVisible();
    await expect(page.getByTestId("toast")).toContainText("Your map was removed from this browser.");
    await page.getByTestId("import-realities-file").setInputFiles({ name: "realityfork-realities.json", mimeType: "application/json", buffer: Buffer.from(file) });
    await expect(page.getByTestId("notice")).toContainText("Restored 1 reality from the file.");
    await expect(card).toHaveCount(1);
    await card.locator('[data-testid^="library-open-"]').click();
    await expect(page.getByTestId("atlas")).toBeVisible();
    await goToChild(page);
    await expectChildIntact(page);

    s = (await stats(page))!;
    expect(s.gpu).not.toContain("SwiftShader");
    expect(seen.plan).toHaveLength(2);
    expect(seen.revisit).toBe(1);
    expect(seen.refused).toEqual([]);
    expect(seen.foreign).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("phone 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test("the question field looks editable at 390 and 375, and an unusual question opens under the open sky", async ({ page }) => {
    test.setTimeout(180_000);
    const seen = await serve(page);
    for (const size of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.goto(PREVIEW);
      const field = page.locator(".whatif-field");
      await expect(field).toBeVisible();
      await expect(field).toContainText("Type your own question");
      const look = await field.evaluate((el) => {
        const cs = getComputedStyle(el);
        const input = el.querySelector("textarea")!;
        return { border: parseFloat(cs.borderTopWidth), color: cs.borderTopColor, fontPx: parseFloat(getComputedStyle(input).fontSize), height: el.getBoundingClientRect().height };
      });
      expect(look.border).toBeGreaterThanOrEqual(1);
      expect(look.color).not.toBe("rgba(0, 0, 0, 0)");
      // 16px or more, so a phone does not zoom into the field; a field tall enough to look like one.
      expect(look.fontPx).toBeGreaterThanOrEqual(16);
      expect(look.height).toBeGreaterThanOrEqual(88);
      // Anywhere in the frame starts typing (the caption too), and the caption follows what is in it.
      await field.locator(".whatif-caption").click();
      await expect(page.getByTestId("whatif-input")).toBeFocused();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      // The 3D world has room on the landing (it once collapsed to zero width here).
      await expect.poll(async () => (await page.getByTestId("imagine-world").boundingBox())?.width ?? 0).toBeGreaterThan(size.width - 2);
    }
    await page.getByTestId("whatif-input").fill(CELLO);
    await expect(page.locator(".whatif-field")).toContainText("Your question");
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("future-card-2")).toBeVisible();
    await expect(page.getByTestId("context-step")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.getByTestId("explore-future-1").click();
    await expect(page.getByTestId("atlas-title")).toHaveText("Teach myself at home");
    await settle(page);
    expect((await stats(page))!.universe).toBe("neutral");
    await expect(page.getByTestId("atlas-scenery-name")).toHaveText(/open sky/i);
    await details(page);
    await expect(calc(page, "Yearly cost of learning")).toContainText("needs Monthly cost of learning");
    await answer(page, "monthlyCost", "40");
    await expect(calc(page, "Yearly cost of learning")).toContainText("480 per year");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(seen.plan).toEqual([{ question: CELLO, context: 0 }]);
    expect(seen.revisit).toBe(0);
    expect(seen.refused).toEqual([]);
    expect(seen.foreign).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("tablet 1024", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("content kinds stay apart: known, calculated, unknown, not applicable (never 0), possible; no simulation without a model", async ({ page }) => {
    test.setTimeout(150_000);
    const seen = await serve(page);
    await page.goto(PREVIEW);
    await page.getByTestId("whatif-input").fill(GAMING);
    await page.getByTestId("explore-possibilities").click();
    // Skipping both optional questions shows the first draft without another request.
    await page.getByTestId("context-skip").click();
    await page.getByTestId("context-skip").click();
    await expect(page.getByTestId("future-card-1")).toBeVisible();
    expect(seen.plan).toHaveLength(1);
    await page.getByTestId("explore-future-1").click();
    await expect(page.getByTestId("atlas-title")).toHaveText("Publisher-backed team");
    // The publisher pays: savings do not apply on this path. That is not 0 and not unknown.
    await details(page);
    await page.getByTestId("atlas-ask-savings").click();
    await page.getByTestId("not-applicable").click();
    await openSection(page, "atlas-known");
    await expect(page.getByTestId("atlas-known-na-savings")).toContainText("Savings available: doesn't apply to this path");
    await expect(page.getByTestId("atlas-ask-savings")).toHaveCount(0);
    await answer(page, "monthlyCosts", "1500");
    await expect(page.getByTestId("atlas-known-value-monthlyCosts")).toContainText("Monthly costs: 1,500 per month");
    await expect(calc(page, "Months the savings last")).toContainText("doesn't apply here");
    await expect(calc(page, "Months the savings last")).not.toContainText(/\b0 months/);
    await expect(page.getByTestId("atlas-unknown")).toContainText("Team size");
    await openSection(page, "atlas-possible");
    await expect(page.getByTestId("atlas-possible")).toContainText("Possibilities to think with, not predictions.");
    await expect(page.getByTestId("atlas-possible")).toContainText("Deadlines and milestones set by the publisher");
    await expect(page.getByTestId("atlas-simulated")).toHaveCount(0);
    // It applies after all: back to a question, and the calculation waits for it again. (Known starts folded again
    // after the question sheet closes, so it is opened first, as a user would.)
    await openSection(page, "atlas-known");
    await page.getByTestId("atlas-known-na-savings").getByRole("button", { name: "It applies" }).click();
    await expect(page.getByTestId("atlas-ask-savings")).toBeVisible();
    await expect(calc(page, "Months the savings last")).toContainText("needs Savings available");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(seen.revisit).toBe(0);
    expect(seen.refused).toEqual([]);
    expect(seen.foreign).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("Discover when the AI guide fails", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("unavailable, then busy, then a retry that works", async ({ page }) => {
    const seen = await serve(page, [
      { status: 503, body: { ok: false, code: "unavailable", message: "The AI guide could not be reached (test reply)." } },
      { status: 429, body: { ok: false, code: "rate-limited", message: "Too many drafts at once (test reply)." } },
    ]);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill(CELLO);
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("plan-error")).toContainText("We couldn't reach the AI guide");
    await expect(page.getByTestId("plan-error")).toContainText("The AI guide could not be reached (test reply).");
    await expect(page.getByTestId("map-it-myself")).toBeVisible();
    await page.getByTestId("retry-plan").click();
    await expect(page.getByTestId("plan-error")).toContainText("The AI guide is busy for a moment");
    await page.getByTestId("retry-plan").click();
    await expect(page.getByTestId("future-card-0")).toContainText("Weekly lessons with a teacher");
    expect(seen.plan).toHaveLength(3);
    expect(seen.errors).toEqual([]);
  });

  test("a draft that fails the checks is never shown or saved; mapping it by hand still works", async ({ page }) => {
    const broken = { ...(FX.cello as Record<string, unknown>), branches: [] };
    const seen = await serve(page, [{ status: 200, body: { ok: true, proposal: broken, model: MODEL, warnings: [] } }]);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill(CELLO);
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("plan-error")).toContainText("The AI's draft didn't pass our checks");
    await expect(page.getByTestId("plan-error")).toContainText("The draft failed RealityFork's checks");
    await expect(page.getByTestId("future-card-0")).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain("cello");
    await page.getByTestId("map-it-myself").click();
    await expect(page.getByTestId("question")).toHaveText(CELLO);
    expect(seen.plan).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });

  test("loading can be cancelled, and the question is kept", async ({ page }) => {
    const seen = await serve(page, [], 20_000);
    await page.goto("/");
    await page.getByTestId("whatif-input").fill(CELLO);
    await page.getByTestId("explore-possibilities").click();
    await expect(page.getByTestId("plan-loading")).toBeVisible();
    await page.getByTestId("cancel-plan").click();
    await expect(page.getByTestId("whatif-input")).toHaveValue(CELLO);
    await expect(page.getByTestId("plan-loading")).toHaveCount(0);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("library and shared surfaces", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("More menu and help by keyboard; empty library; remove one map after a confirmation; a broken file changes nothing", async ({ page }) => {
    const seen = await serve(page);
    await page.goto("/");
    // The More menu opens from the keyboard, moves with the arrow keys and closes with Escape back on its button.
    await page.getByTestId("more-menu").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("more-library")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    expect(focused).toBeTruthy();
    expect(focused).not.toBe("more-menu");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("more-library")).toBeHidden();
    await expect(page.getByTestId("more-menu")).toBeFocused();
    // Help explains every kind of content and closes with Escape.
    await page.getByTestId("more-menu").click();
    await page.getByTestId("more-help").click();
    for (const kind of ["Known", "Calculated", "Simulated", "Possible", "AI-suggested"]) await expect(page.getByTestId("help-dialog")).toContainText(kind);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("help-dialog")).toBeHidden();
    // An empty library says how a map gets there.
    await page.getByTestId("more-menu").click();
    await page.getByTestId("more-library").click();
    await expect(page.getByTestId("library-empty")).toContainText("No maps in this browser yet");
    // A file that is not a RealityFork file is refused and nothing is added.
    await page.getByTestId("import-realities-file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("{ not a map") });
    await expect(page.getByTestId("error")).toBeVisible();
    await expect(page.getByTestId("library-empty")).toBeVisible();
    await page.getByTestId("library-ask").click();
    await expect(page.getByTestId("whatif-input")).toBeVisible();
    // One example map, removed from the library only after the dialog is accepted (Escape keeps it).
    await page.getByTestId("example-cafe-queue").click();
    await expect(page.getByTestId("question")).toContainText("barista");
    await page.getByTestId("saved-open-library").click();
    const card = page.locator('[data-testid^="library-map-"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("A copy of an example");
    await card.locator('[data-testid^="library-remove-"]').click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await expect(page.getByTestId("confirm-cancel")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    await expect(card).toHaveCount(1);
    await card.locator('[data-testid^="library-remove-"]').click();
    await page.getByTestId("confirm-accept").click();
    await expect(page.getByTestId("toast")).toContainText("The map was removed from this browser.");
    await expect(page.getByTestId("library-empty")).toBeVisible();
    expect(seen.plan).toHaveLength(0);
    expect(seen.refused).toEqual([]);
    expect(seen.foreign).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test("a screen that fails to draw says so, keeps the maps, and goes back to the start", async ({ page }) => {
    const seen = await serve(page);
    await page.goto("/");
    await page.getByTestId("example-cafe-queue").click();
    await expect(page.getByTestId("question")).toContainText("barista");
    await page.getByTestId("home").click();
    await expect(page.getByTestId("whatif-input")).toBeVisible();
    const saved = await page.evaluate(() => window.localStorage.getItem("realityfork.realities.v1"));
    expect(saved).toContain("barista");
    // The failure is injected from outside the app: date formatting throws, so the library throws while it draws.
    await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!;
      (window as unknown as { restoreFormat: () => void }).restoreFormat = () => void Object.defineProperty(Intl.DateTimeFormat.prototype, "format", original);
      Object.defineProperty(Intl.DateTimeFormat.prototype, "format", { configurable: true, get: () => () => { throw new Error("Injected test failure: date formatting is unavailable"); } });
    });
    await page.getByTestId("more-menu").click();
    await page.getByTestId("more-library").click();
    await expect(page.getByTestId("stage-error")).toContainText("This screen could not be shown");
    await expect(page.getByTestId("stage-error")).toContainText("Your maps are saved in this browser and were not changed.");
    await expect(page.getByTestId("stage-error")).toContainText("Injected test failure: date formatting is unavailable");
    await expect(page.getByRole("heading", { name: "This screen could not be shown" })).toBeFocused();
    expect(await page.evaluate(() => window.localStorage.getItem("realityfork.realities.v1"))).toBe(saved);
    await page.evaluate(() => (window as unknown as { restoreFormat: () => void }).restoreFormat());
    await page.getByTestId("stage-error-home").click();
    await expect(page.getByTestId("whatif-input")).toBeVisible();
    await expect(page.locator('[data-testid^="open-What if our café"]')).toHaveCount(1);
    // The only errors are the injected one and, in a development build, React's report that the stage boundary caught it
    // (production React does not print that report).
    const caught = (e: string) => e.startsWith("The above error occurred in the <") && e.includes("using the error boundary you provided, StageBoundary.");
    if (process.env.RF_E2E_PROD !== "1") expect(seen.errors.some(caught)).toBe(true);
    expect(seen.errors.filter((e) => !e.includes("Injected test failure") && !caught(e))).toEqual([]);
    expect(seen.refused).toEqual([]);
    expect(seen.foreign).toEqual([]);
  });

  test("saved maps that cannot be checked are never loaded silently: the library says so, and starting fresh asks first", async ({ page }) => {
    const seen = await serve(page);
    await page.addInitScript(() => {
      if (sessionStorage.getItem("rf-phase3-seeded")) return;
      sessionStorage.setItem("rf-phase3-seeded", "1");
      localStorage.setItem("realityfork.realities.v1", "{ this is not a saved map");
    });
    await page.goto("/");
    await expect(page.getByTestId("start-fresh")).toBeVisible();
    await page.getByTestId("more-menu").click();
    await page.getByTestId("more-library").click();
    await expect(page.getByTestId("library-load-error")).toBeVisible();
    await page.getByTestId("start-fresh").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("Start fresh in this browser?");
    await page.getByTestId("confirm-accept").click();
    await expect(page.getByTestId("start-fresh")).toHaveCount(0);
    await expect(page.getByTestId("library-load-error")).toHaveCount(0);
    expect(seen.errors).toEqual([]);
  });
});
