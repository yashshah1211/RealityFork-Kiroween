/**
 * R18.1: truthful branches and data safety, as complete browser journeys on the repaired build.
 *
 *  P1  "Explore another path" → "Or describe what is different" keeps the description as the change, everywhere.
 *  P2  Example, AI, user-written and unrecorded possibilities are each called what they are.
 *  P3  Typed amounts follow one stated policy; ambiguous input is refused with a message, never reinterpreted.
 *  P4  Unit spellings (₹/month, ₹ per month, minutes, min) are one unit; other periods and currencies are not.
 *  P5  Importing a file never replaces a map that is already saved.
 *
 * AI replies are mocked and every other /api request is refused and counted, so nothing can reach a live provider.
 * Screenshots go to docs/validation/screenshots/r18-1/. The number matrix is written from what the browser stored
 * (docs/validation/r18-1-number-matrix.json); nothing in it is typed by hand.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const dir = here("../../../docs/validation/screenshots/r18-1/");
mkdirSync(dir, { recursive: true });
const audit = JSON.parse(readFileSync(here("./fixtures/audit-proposals.json"), "utf8"));
/** Files saved by earlier versions of RealityFork (packages/core/test/fixtures). */
const oldFile = (name: string) => here(`../../core/test/fixtures/${name}`);
const MODEL = "openai/gpt-oss-120b (mocked in this test)";
const STORE_KEY = "realityfork.realities.v1";
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
] as const;

const STATEMENT = "I split the two hours into four focused sessions with breaks.";
/** Names made from a described change are cut at 57 characters (unchanged since R17). */
const SHORT = `${STATEMENT.slice(0, 57).trimEnd()}…`;
const HYPOTHETICAL = "A change being explored on this path (a hypothetical, not a known fact):";
const LOOK = {
  summary: "Because the two hours are split into sessions with breaks, fatigue could build up less on this path.", reconsider: [], questions: [], evidence: [],
  add: [{ text: "Concentration could stay steadier across the exam", trigger: "the time is split into focused sessions with breaks", mechanism: "Short breaks can let attention recover between sessions.", downstream: "", uncertainty: "Whether breaks are allowed in your exam rules.", tone: "upside", about: ["breaksAllowed"] }],
};

// ---------- what the browser has saved ----------

interface SBranch {
  id: string; parentId: string | null; name: string; fingerprint: string;
  values: Record<string, string | number | boolean | null>; sources?: Record<string, string>;
  facts?: { id: string; question: string; answer: string }[];
  possibilities: { id: string; text: string; note: string; source?: string; tone?: string }[];
}
interface SReality { id: string; question: string; variables: { key: string; label: string; unit: string; kind: string }[]; branches: SBranch[] }
interface Stored { activeId: string | null; edited: Record<string, string>; realities: SReality[] }

/** The saved copy in localStorage: the bundle is the exported format; edit times sit beside it. */
const stored = (page: Page): Promise<Stored> =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return { activeId: null, edited: {}, realities: [] };
    const o = JSON.parse(raw);
    return { activeId: o.activeId ?? null, edited: o.edited ?? {}, realities: JSON.parse(o.bundle).realities };
  }, STORE_KEY) as Promise<Stored>;
const openMap = (s: Stored): SReality => {
  const r = s.realities.find((x) => x.id === s.activeId);
  if (!r) throw new Error("no map is open");
  return r;
};
const pathNamed = (r: SReality, name: string): SBranch => {
  const b = r.branches.find((x) => x.name === name);
  if (!b) throw new Error(`no path called “${name}” in ${r.branches.map((x) => x.name).join(" | ")}`);
  return b;
};
/** The saved value of one assumption in one path of the open map. */
const savedValue = async (page: Page, path: string, key: string) => pathNamed(openMap(await stored(page)), path).values[key] ?? null;

// ---------- helpers ----------

interface Seen { refused: string[]; plan: unknown[]; revisit: { known: { question: string; answer: string }[]; change: string }[]; errors: string[] }

/** Refuse every /api request except the mocks given, and remember what happened. Also collects browser errors. */
async function guardApi(page: Page, mocks: { plan?: unknown; look?: unknown } = {}): Promise<Seen> {
  const seen: Seen = { refused: [], plan: [], revisit: [], errors: [] };
  page.on("pageerror", (e) => seen.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/i.test(m.text() + (m.location().url ?? ""))) seen.errors.push(`console: ${m.text()}`);
  });
  await page.route("**/api/**", (route) => {
    seen.refused.push(route.request().url());
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "No AI request is allowed in this test." }) });
  });
  // The last route registered for a URL wins, so these are tried before the catch-all above.
  if (mocks.plan) {
    await page.route("**/api/plan", (route) => {
      seen.plan.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: mocks.plan, model: MODEL, warnings: [] }) });
    });
  }
  if (mocks.look) {
    await page.route("**/api/revisit", (route) => {
      seen.revisit.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, suggestion: mocks.look, model: MODEL, warnings: [] }) });
    });
  }
  return seen;
}
const clean = (seen: Seen) => {
  expect(seen.refused, "no unexpected /api request").toEqual([]);
  expect(seen.errors, "no browser errors").toEqual([]);
};

const ask = async (page: Page, question: string) => {
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(question);
  await page.getByTestId("explore-possibilities").click();
};
const node = (page: Page, name: string) => page.getByTestId(`branch-${name}`);
const whatIfOn = (page: Page, text: string) => page.getByTestId("story").locator("li", { hasText: text }).getByRole("button", { name: /^What if this changed\?/ });
const shot = (page: Page, name: string) => page.screenshot({ path: `${dir}${name}.png`, fullPage: true, animations: "disabled" });
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
async function fits(page: Page, step: string) {
  const o = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect.soft(o.scroll, `horizontal overflow at ${step}`).toBeLessThanOrEqual(o.client);
}
const startBlank = async (page: Page, question: string) => {
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(question);
  await page.getByTestId("start-blank").click();
};
const answerNumber = async (page: Page, label: string, typed: string) => {
  await expect(page.getByTestId("question-card")).toContainText(label);
  await page.getByTestId("question-input").fill(typed);
  await page.getByTestId("save-answer").click();
};

// ================================================================================================
// P1. A path the user describes keeps what they described.
// ================================================================================================

for (const vp of VIEWPORTS) {
  test(`P1 / the failing route: “Explore another path” → describe → the description is the change everywhere (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const seen = await guardApi(page, { plan: audit["exam-length"], look: LOOK });
    await ask(page, "What if my exams were two hours long?");
    await page.getByTestId("explore-future-0").click();
    await expect(page.getByTestId("story-title")).toHaveText("Two-hour exams");
    const parentBefore = pathNamed(openMap(await stored(page)), "Two-hour exams");

    // The exact route of the audit: Explore another path from here → describe what is different.
    await page.getByTestId("branch-from-here").click();
    const sheet = page.getByTestId("fork-sheet");
    await expect(sheet).toContainText("Or describe what is different");
    await expect(sheet).toContainText("Or start an unchanged copy");
    await expect(sheet).toContainText("The name is only a label. Nothing is different on the copy until you change an assumption.");
    await expect(sheet).toContainText("Saved on the new path as a change you are exploring, not as a known fact.");
    await shot(page, `after-P1-1-path-sheet-${vp.name}`);
    await fits(page, "the path sheet");
    await page.getByTestId("fork-describe").fill(STATEMENT);
    await page.getByTestId("fork-describe-create").click();

    // What the page says about the new path: header, chips, map, Known, "what this change does".
    const check = async (when: string) => {
      await expect(page.getByTestId("story-title"), when).toHaveText(SHORT);
      await expect(page.getByTestId("story-changes"), when).not.toContainText("Nothing is different yet");
      await expect(page.getByTestId("story-exploring"), when).toHaveText(`Exploring: ${STATEMENT}`);
      await expect(page.getByTestId("story-changes"), when).not.toContainText("You told us");
      await expect(page.getByTestId("story-known"), when).toContainText(`Change you are exploring (a what-if, not a known fact): ${STATEMENT}`);
      await expect(node(page, SHORT), when).toContainText(`Exploring: ${STATEMENT.slice(0, 20)}`);
      await expect(node(page, SHORT), when).not.toContainText("Nothing changed yet");
    };
    await check("right after creating it");
    // It also says what this change does, and does not do.
    await expect(page.getByTestId("whatif-changed")).toContainText(`Exploring: ${STATEMENT}`);
    await expect(page.getByTestId("whatif-calculated")).toContainText("This map has no calculations, so nothing here is worked out with numbers.");
    await expect(page.getByTestId("whatif-reconsider")).toContainText("made before this change");
    await expect(page.getByTestId("whatif-reconsider")).toContainText("Not recalculated");
    // The parent's suggestion is carried over and marked as possibly out of date, not rewritten or removed.
    await expect(page.getByTestId("story").locator("li", { hasText: "Less fatigue towards the end of the exam" })).toContainText("may need a fresh look");
    await shot(page, `after-P1-2-described-path-${vp.name}`);
    await fits(page, "the described path");

    // Saved as one intervention: no value, source or structured assumption was invented; the parent is untouched.
    const s1 = await stored(page);
    const r1 = openMap(s1);
    const child = pathNamed(r1, SHORT);
    const parent = pathNamed(r1, "Two-hour exams");
    expect(child.parentId).toBe(parent.id);
    expect(child.facts).toHaveLength(1);
    expect(child.facts![0]).toMatchObject({ question: "What is different on this path?", answer: STATEMENT });
    expect(child.values).toEqual(parent.values);
    expect(child.sources ?? {}).toEqual(parent.sources ?? {});
    expect(parent).toEqual(parentBefore);
    expect(parent.fingerprint).toBe(parentBefore.fingerprint);
    await node(page, "Two-hour exams").click();
    await expect(page.getByTestId("story-known")).not.toContainText(STATEMENT);
    await expect(page.getByTestId("story-changes")).not.toContainText("Exploring");
    await expect(page.getByTestId("story").locator("li", { hasText: "Less fatigue towards the end of the exam" })).not.toContainText("may need a fresh look");

    // Compare: the narrative difference is a difference, worded as a what-if.
    await node(page, SHORT).click();
    await page.getByTestId("compare-with").click();
    await page.getByTestId("compare-pick-Two-hour exams").click();
    await expect(page.getByTestId("cmp-differ")).not.toContainText("They make the same choices so far");
    await expect(page.getByTestId("cmp-told")).toContainText(`Only in “${SHORT}”: Exploring “${STATEMENT}”`);
    await expect(page.getByTestId("cmp-told")).not.toContainText("You told us");
    await shot(page, `after-P1-3-compare-${vp.name}`);
    await fits(page, "compare");
    await page.getByTestId("continue-a").click();

    // After a reload the map reopens; the change is still there.
    await page.reload();
    await node(page, SHORT).click();
    await check("after a reload");

    // After the user asks for, previews and approves another AI look: the request called the sentence a hypothetical.
    await page.getByTestId("ask-fresh-look").click();
    await expect(page.getByTestId("revisit-preview")).toBeVisible();
    await shot(page, `after-P1-4-fresh-look-preview-${vp.name}`);
    await page.getByTestId("revisit-apply").click();
    await check("after an approved fresh look");
    expect(seen.revisit).toHaveLength(1);
    const sent = seen.revisit[0]!;
    expect(sent.known).toContainEqual({ question: HYPOTHETICAL, answer: STATEMENT });
    expect(sent.known.map((k) => k.question)).not.toContain("What is different on this path?");
    expect(sent.change).toMatch(/a hypothetical, not a known fact/);
    await expect(page.getByTestId("story").locator("li", { hasText: "Concentration could stay steadier across the exam" })).toBeVisible();

    // The parent is still exactly what it was, after all of it.
    const r2 = openMap(await stored(page));
    expect(pathNamed(r2, "Two-hour exams")).toEqual(parentBefore);
    expect(pathNamed(r2, SHORT).facts).toEqual(child.facts);
    await fits(page, "after the fresh look");
    clean(seen);
  });
}

test("P1 / one sentence is one path however it is entered; a name-only copy says nothing changed; a tapped choice is a value change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page, { plan: audit["exam-length"], look: LOOK });
  await ask(page, "What if my exams were two hours long?");
  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-title")).toHaveText("Two-hour exams");

  // 1. The same sentence through “What if this changed?”...
  await whatIfOn(page, "Less fatigue towards the end of the exam").click();
  await page.getByTestId("whatif-text").fill(STATEMENT);
  await page.getByTestId("whatif-text-create").click();
  await expect(page.getByTestId("story-title")).toHaveText(SHORT);
  const first = openMap(await stored(page));
  const childId = pathNamed(first, SHORT).id;

  // 2. ...and through “Explore another path → describe” is the same path, not a second one.
  await node(page, "Two-hour exams").click();
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-describe").fill(STATEMENT);
  await page.getByTestId("fork-describe-create").click();
  await expect(page.getByTestId("story-title")).toHaveText(SHORT);
  const second = openMap(await stored(page));
  expect(second.branches).toHaveLength(first.branches.length);
  expect(pathNamed(second, SHORT).id).toBe(childId);

  // 3. A copy that only has a name: its header, map and comparison say nothing is different, and that is true.
  await node(page, "Two-hour exams").click();
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-name").fill("Working draft");
  await page.getByTestId("fork-create").click();
  await expect(page.getByTestId("story-title")).toHaveText("Working draft");
  await expect(page.getByTestId("story-changes")).toContainText("Nothing is different yet");
  await expect(node(page, "Working draft")).toContainText("Nothing changed yet");
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Two-hour exams").click();
  await expect(page.getByTestId("cmp-differ")).toContainText("They make the same choices so far");
  await shot(page, "after-P1-5-name-only-copy-compare-desktop-1440");
  await page.getByTestId("continue-a").click();
  const draft = pathNamed(openMap(await stored(page)), "Working draft");
  expect(draft.facts ?? []).toEqual([]);
  expect(draft.values).toEqual(pathNamed(openMap(await stored(page)), "Two-hour exams").values);

  // 4. A tap on another choice goes through the same operation and is a value, from the user.
  await node(page, "Two-hour exams").click();
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-choice-breaksAllowed-true").click();
  await expect(page.getByTestId("story-title")).toHaveText("Two-hour exams · Breaks allowed during the exam: yes");
  await expect(page.getByTestId("change-breaksAllowed")).toContainText("Breaks allowed during the exam: yes");
  const tapped = pathNamed(openMap(await stored(page)), "Two-hour exams · Breaks allowed during the exam: yes");
  expect(tapped.values.breaksAllowed).toBe(true);
  expect(tapped.sources?.breaksAllowed).toBe("user");
  expect(tapped.facts ?? []).toEqual([]);
  clean(seen);
});

test("P1 / describing a change on a map with calculations invents no number and changes no calculation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page);
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await node(page, "Move to London").click();
  await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("£700 per month");
  const london = pathNamed(openMap(await stored(page)), "Move to London");

  const lower = "I negotiate a lower rent with my landlord";
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-describe").fill(lower);
  await page.getByTestId("fork-describe-create").click();
  await expect(page.getByTestId("story-title")).toHaveText(lower);
  await expect(page.getByTestId("story-exploring")).toHaveText(`Exploring: ${lower}`);
  // No assumption chip: nothing about rent became a number.
  await expect(page.getByTestId("change-rent")).toHaveCount(0);
  await expect(page.getByTestId("story-calc-monthlySavings")).toContainText("£700 per month");
  await expect(page.getByTestId("whatif-calculated")).toContainText("No calculated result changes.");
  await expect(page.getByTestId("whatif-changed")).not.toContainText("Rent");
  await shot(page, "after-P1-6-lower-rent-described-desktop-1440");

  const child = pathNamed(openMap(await stored(page)), lower);
  expect(child.values).toEqual(london.values);
  expect(child.values.rent).toBe(1500);
  expect(child.sources?.rent).toBe("example");
  expect(child.facts).toHaveLength(1);

  // Compare says the words differ and the savings do not.
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Move to London").click();
  await expect(page.getByTestId("cmp-told")).toContainText(`Exploring “${lower}”`);
  await expect(page.getByTestId("cmp-calc-monthlySavings")).toContainText("£700 per month");
  await expect(page.getByTestId("cmp-calc-monthlySavings")).not.toContainText("+£");
  await expect(page.getByTestId("cmp-calc-monthlySavings")).not.toContainText("−£");
  await shot(page, "after-P1-7-lower-rent-compare-desktop-1440");
  clean(seen);
});

// ================================================================================================
// P2. Who wrote a possibility is said only as far as it is recorded.
// ================================================================================================

const importFile = async (page: Page, path: string) => page.getByTestId("import-realities-file").setInputFiles(path);

test("P2 / an example's possibilities are the example's, what the user adds is theirs, and an AI map's are the AI's", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page, { plan: audit["exam-length"] });
  const list = (id: "story-upsides" | "story-challenges" | "story-either") => page.getByTestId(id);
  const caption = (id: "story-upsides" | "story-challenges" | "story-either") => list(id).locator(".caption");

  // 1. An example's own possibilities were not written by the user.
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await expect(page.getByTestId("story-title")).toHaveText("Stay in Mumbai");
  await expect(caption("story-either")).toHaveText("Possibilities that came with this example, not predictions");
  await expect(list("story-either")).not.toContainText("Your own");
  await expect(list("story-either").locator(".tag.origin")).toHaveCount(0);
  await shot(page, "after-P2-1-example-caption-desktop-1440");

  // 2. What the user adds is theirs, and the example's list keeps its own caption.
  await page.getByTestId("add-upside").click();
  await page.getByTestId("add-upside-text").fill("My sister lives in Croydon");
  await page.getByTestId("add-upside-save").click();
  await expect(caption("story-upsides")).toHaveText("Your own possibilities, not predictions");
  await expect(caption("story-either")).toHaveText("Possibilities that came with this example, not predictions");
  const mumbai = pathNamed(openMap(await stored(page)), "Stay in Mumbai");
  expect(mumbai.possibilities.map((p) => [p.text, p.source])).toEqual([["Close to family and friends", "example"], ["My sister lives in Croydon", "user"]]);
  await shot(page, "after-P2-2-user-thought-desktop-1440");

  // 3. After a reload the same words are shown, and the advanced view tags each item.
  await page.reload();
  await expect(caption("story-upsides")).toHaveText("Your own possibilities, not predictions");
  await expect(caption("story-either")).toHaveText("Possibilities that came with this example, not predictions");
  await page.getByTestId("all-details").click();
  const panel = page.getByTestId("branch-panel");
  await expect(panel.locator("li", { hasText: "Close to family and friends" })).toContainText("from the example");
  await expect(panel.locator("li", { hasText: "My sister lives in Croydon" })).toContainText("written by you");
  await shot(page, "after-P2-3-advanced-tags-desktop-1440");

  // The technical comparison's footer does not call every possibility the user's own judgement, or every figure theirs.
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-name").fill("Copy for comparing");
  await page.getByTestId("fork-create").click();
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Stay in Mumbai").click();
  await page.getByTestId("cmp-technical").locator("summary").click();
  const footer = page.getByTestId("compare-panel").locator(".disclaimer");
  await expect(footer).toHaveText("Calculated differences are arithmetic on the assumptions in each path. They are not predictions, and possibilities are judgements, not calculations.");
  await expect(page.getByTestId("compare-panel")).not.toContainText("your own judgements");
  await page.getByTestId("continue-a").click();
  await page.getByTestId("home").click();

  // 4. An AI map: the AI's suggestions are the AI's. A thought the user adds to one of its lists marks each item.
  await page.getByTestId("home").click();
  await page.getByTestId("whatif-input").fill("What if my exams were two hours long?");
  await page.getByTestId("explore-possibilities").click();
  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-title")).toHaveText("Two-hour exams");
  for (const id of ["story-upsides", "story-challenges", "story-either"] as const) await expect(caption(id)).toHaveText("AI-suggested possibilities, not predictions");
  await expect(page.getByTestId("story")).not.toContainText("Your own possibilities");
  await page.getByTestId("add-upside").click();
  await page.getByTestId("add-upside-text").fill("I would revise in shorter blocks");
  await page.getByTestId("add-upside-save").click();
  await expect(caption("story-upsides")).toHaveText("AI-suggested and your own possibilities, not predictions");
  await expect(list("story-upsides").locator("li", { hasText: "Less fatigue towards the end of the exam" })).toContainText("suggested by the AI");
  await expect(list("story-upsides").locator("li", { hasText: "I would revise in shorter blocks" })).toContainText("written by you");
  await expect(caption("story-challenges")).toHaveText("AI-suggested possibilities, not predictions");
  await shot(page, "after-P2-4-ai-and-user-desktop-1440");
  const exam = pathNamed(openMap(await stored(page)), "Two-hour exams");
  // The AI's suggestions carry no recorded source (they are recognised by their note); only the user's thought does.
  expect(exam.possibilities.filter((p) => p.source === "user").map((p) => p.text)).toEqual(["I would revise in shorter blocks"]);
  expect(exam.possibilities.some((p) => p.source === "example")).toBe(false);
  clean(seen);
});

test("P2 / maps saved before provenance was recorded are not credited to anyone, and importing them rewrites nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page);
  await page.goto("/");

  // 6e4b8f2: saved before tones and origins existed.
  await importFile(page, oldFile("realities-6e4b8f2.json"));
  await expect(page.getByTestId("notice")).toHaveText(/^Restored 2 realities from the file\./);
  await page.getByTestId("open-What if I moved from Mumbai to London?").click();
  await expect(page.getByTestId("story-title")).toHaveText("Stay in Mumbai");
  await expect(page.getByTestId("story-either").locator(".caption")).toHaveText("Possibilities (who wrote them was not recorded), not predictions");
  await expect(page.getByTestId("story-either")).not.toContainText("Your own");
  await expect(page.getByTestId("story-either")).not.toContainText("example, not");
  await shot(page, "after-P2-5-unrecorded-old-file-desktop-1440");

  // 5b17057: an AI map from before R15, with one thought the user typed (saved without a source).
  await page.getByTestId("home").click();
  await importFile(page, oldFile("realities-5b17057.json"));
  await expect(page.getByTestId("notice")).toHaveText(/^Restored 1 reality from the file\./);
  await page.getByTestId("open-What if I started my own restaurant?").click();
  await node(page, "Small café, owner-run · Hire staff: yes").click();
  const up = page.getByTestId("story-upsides");
  await expect(up.locator(".caption")).toHaveText("Possibilities from more than one source (marked on each), not predictions");
  await expect(up.locator("li", { hasText: "Full control over the menu and atmosphere" })).toContainText("suggested by the AI");
  // The user's own thought was saved without a source, so it is not claimed as theirs.
  await expect(up.locator("li", { hasText: "Time off at weekends" })).toContainText("origin not recorded");
  await expect(up).not.toContainText("written by you");
  await shot(page, "after-P2-6-unrecorded-beside-ai-desktop-1440");

  // Importing relabelled nothing in storage: every branch fingerprint is the one in the file.
  const fileFingerprints = (name: string) =>
    (JSON.parse(readFileSync(oldFile(name), "utf8")) as { realities: { id: string; branches: { id: string; fingerprint: string }[] }[] }).realities.flatMap((r) => r.branches.map((b) => [r.id, b.id, b.fingerprint]));
  const savedFingerprints = (await stored(page)).realities.flatMap((r) => r.branches.map((b) => [r.id, b.id, b.fingerprint]));
  expect(savedFingerprints).toEqual([...fileFingerprints("realities-6e4b8f2.json"), ...fileFingerprints("realities-5b17057.json")]);
  expect((await stored(page)).realities.flatMap((r) => r.branches.flatMap((b) => b.possibilities)).some((p) => p.source !== undefined)).toBe(false);
  clean(seen);
});

// ================================================================================================
// P3. Typed amounts. One policy: read what is unambiguous, refuse what is not, never reinterpret.
// ================================================================================================

type Expect = number | null | "refused";
interface Case { typed: string; expect: Expect; why: string }
interface Observed { typed: string; why: string; expected: Expect; outcome: "stored" | "refused" | "no change"; stored: string | number | boolean | null; message: string; ok: boolean }

/** Every way the audit and the brief typed an amount, for a field whose unit is “₹ per month”. */
const RUPEE_CASES: Case[] = [
  { typed: "1500", expect: 1500, why: "plain digits" },
  { typed: "1,500", expect: 1500, why: "comma groups of three, as the app itself shows amounts" },
  { typed: "20,000", expect: 20000, why: "comma groups of three" },
  { typed: "1,234,567.5", expect: 1234567.5, why: "grouped, with a decimal" },
  { typed: "1,00,000", expect: 100000, why: "lakh grouping" },
  { typed: "2 500", expect: 2500, why: "a space between groups of three" },
  { typed: "1.5", expect: 1.5, why: "dot as the decimal point" },
  { typed: "1.50", expect: 1.5, why: "dot decimal with a trailing zero" },
  { typed: "0.285", expect: 0.285, why: "dot decimal below one" },
  { typed: "₹20,000", expect: 20000, why: "the field's own currency symbol, before" },
  { typed: "20,000 ₹", expect: 20000, why: "the field's own currency symbol, after" },
  { typed: "₹ 8,000", expect: 8000, why: "the field's own currency symbol and a space" },
  { typed: "-500", expect: -500, why: "negative" },
  { typed: "−500", expect: -500, why: "negative, written with the minus sign" },
  { typed: "+500", expect: 500, why: "explicit plus" },
  { typed: "0", expect: 0, why: "zero is a value, not unknown" },
  { typed: "-0", expect: 0, why: "negative zero is zero" },
  { typed: "", expect: null, why: "empty means unknown" },
  { typed: "999,999,999,999,999", expect: 999999999999999, why: "the largest amount accepted is just below 10^15" },
  { typed: "1,5", expect: "refused", why: "a comma that does not separate thousands (was read as 15)" },
  { typed: "0,285", expect: "refused", why: "a decimal comma (was read as 285)" },
  { typed: "1.500", expect: "refused", why: "1.5 or 1,500 depending on the writer's country" },
  { typed: "2.500", expect: "refused", why: "2.5 or 2,500 depending on the writer's country" },
  { typed: "€2.500", expect: "refused", why: "another currency, and ambiguous (was read as 2.5)" },
  { typed: "€2,500", expect: "refused", why: "another currency" },
  { typed: "$20", expect: "refused", why: "another currency" },
  { typed: "1.200,50", expect: "refused", why: "European grouping and decimals (was read as 1.2005)" },
  { typed: "1.200.300", expect: "refused", why: "dots used to group thousands" },
  { typed: "1,000,00", expect: "refused", why: "commas that are not groups of three" },
  { typed: "abc", expect: "refused", why: "letters" },
  { typed: "12abc", expect: "refused", why: "digits followed by letters" },
  { typed: "1e3", expect: "refused", why: "an exponent (was read as 1000)" },
  { typed: "50%", expect: "refused", why: "a percentage is not an amount" },
  { typed: "(500)", expect: "refused", why: "brackets" },
  { typed: "1.2.3", expect: "refused", why: "two decimal points" },
  { typed: "1000000000000000", expect: "refused", why: "10^15 or more" },
  { typed: "99999999999999999999", expect: "refused", why: "very large" },
];
/** The same typing into a field whose unit names no currency. */
const NO_UNIT_CASES: Case[] = [
  { typed: "5", expect: 5, why: "plain digits" },
  { typed: "1,500", expect: 1500, why: "comma groups of three" },
  { typed: "-5", expect: -5, why: "negative" },
  { typed: "1,5", expect: "refused", why: "a comma that does not separate thousands" },
  { typed: "1.500", expect: "refused", why: "ambiguous" },
  { typed: "₹5", expect: "refused", why: "a currency symbol on a field with no currency: none is guessed" },
  { typed: "£5", expect: "refused", why: "a currency symbol on a field with no currency: none is guessed" },
];

const MATRIX_FILE = here("../../../docs/validation/r18-1-number-matrix.json");
/** Merge one surface's observations into the generated matrix file. */
function recordMatrix(surface: string, field: string, rows: Observed[]) {
  let all: { surfaces?: Record<string, unknown> } = {};
  try { all = JSON.parse(readFileSync(MATRIX_FILE, "utf8")); } catch { /* first surface written */ }
  const file = {
    recordedAt: new Date().toISOString(),
    note: "Generated by packages/web/e2e/truth.spec.ts from what the browser stored after each entry. Nothing here is typed by hand.",
    surfaces: { ...(all.surfaces ?? {}), [surface]: { field, cases: rows } },
  };
  writeFileSync(MATRIX_FILE, `${JSON.stringify(file, null, 2)}\n`);
}
const judge = (c: Case, outcome: Observed["outcome"], stored: Observed["stored"], baseline: Observed["stored"]) =>
  c.expect === "refused" ? outcome === "refused" && stored === baseline : outcome === "stored" && stored === c.expect;

test("P3 / All details: every way of typing an amount is stored as written or refused with a message (₹ per month)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page, { plan: audit.bookstore });
  await ask(page, "What if I opened a bookstore with ₹20,000 per month sales, ₹8,000 rent and ₹4,000 other costs?");
  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-title")).toHaveText("Open the bookstore");
  await page.getByTestId("all-details").click();
  const input = page.getByTestId("value-monthlySales");
  const error = page.locator(".assump", { has: input }).locator(".field-error");
  const type = async (typed: string) => {
    await input.fill(typed);
    await input.press("Enter");
  };
  const BASELINE = 7777;
  const rows: Observed[] = [];
  for (const c of RUPEE_CASES) {
    // Start every case from a known saved value, so “refused” visibly leaves it alone and “stored” visibly changes it.
    await type(String(BASELINE));
    await expect.poll(() => savedValue(page, "Open the bookstore", "monthlySales"), { timeout: 10_000 }).toBe(BASELINE);
    await expect(error).toHaveCount(0);
    await type(c.typed);
    await expect
      .poll(async () => ((await error.count()) > 0 || (await savedValue(page, "Open the bookstore", "monthlySales")) !== BASELINE ? "settled" : "waiting"), { timeout: 8_000 })
      .toBe("settled")
      .catch(() => undefined);
    const refused = (await error.count()) > 0;
    const stored = await savedValue(page, "Open the bookstore", "monthlySales");
    const outcome = refused ? "refused" : stored !== BASELINE ? "stored" : "no change";
    rows.push({ typed: c.typed, why: c.why, expected: c.expect, outcome, stored, message: refused ? squash(await error.innerText()) : "", ok: judge(c, outcome, stored, BASELINE) });
  }
  recordMatrix("All details", "Sales per month (₹ per month)", rows);
  expect(rows.filter((r) => !r.ok), "every case behaves as the policy says").toEqual([]);
  // Every refusal says what to do, in words.
  for (const r of rows.filter((x) => x.outcome === "refused")) expect(r.message.length, `message for “${r.typed}”`).toBeGreaterThan(20);

  // Refusals sit beside the field they belong to and leave the page whole.
  await type("1,5");
  await expect(error).toBeVisible();
  await expect(error).toContainText("comma that does not separate thousands");
  await shot(page, "after-P3-1-all-details-refusal-desktop-1440");
  clean(seen);
});

test("P3 / start a blank map: an amount typed as a starting value follows the same policy, with and without a currency", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page);
  await startBlank(page, "What if I tried every number format?");

  const run = async (unit: string, cases: Case[], prefix: string) => {
    const rows: Observed[] = [];
    for (const [i, c] of cases.entries()) {
      const label = `${prefix} ${i + 1}`;
      await page.getByTestId("var-label").fill(label);
      await page.getByTestId("var-unit").fill(unit);
      await page.getByTestId("var-start").fill(c.typed);
      await page.getByTestId("add-variable").click();
      const added = async () => openMap(await stored(page)).variables.find((v) => v.label === label);
      const refusal = page.getByTestId("var-start-error");
      await expect
        .poll(async () => ((await refusal.count()) > 0 || (await added()) ? "settled" : "waiting"), { timeout: 8_000 })
        .toBe("settled")
        .catch(() => undefined);
      const variable = await added();
      const refused = (await refusal.count()) > 0 && !variable;
      const savedStart = variable ? pathNamed(openMap(await stored(page)), openMap(await stored(page)).branches[0]!.name).values[variable.key] ?? null : null;
      const outcome = refused ? "refused" : variable ? "stored" : "no change";
      // A refused entry adds nothing: there is no variable and so no value (reported as null, judged by the variable's absence).
      rows.push({
        typed: c.typed, why: c.why, expected: c.expect, outcome, stored: savedStart, message: refused ? squash(await refusal.innerText()) : "",
        ok: c.expect === "refused" ? refused && !variable : outcome === "stored" && savedStart === c.expect,
      });
    }
    return rows;
  };
  const rupees = await run("₹ per month", RUPEE_CASES, "Rupee case");
  recordMatrix("Start a blank map: starting value", "a new assumption with unit “₹ per month”", rupees);
  const plain = await run("", NO_UNIT_CASES, "Plain case");
  recordMatrix("Start a blank map: starting value, unit with no currency", "a new assumption with no unit", plain);
  expect(rupees.filter((r) => !r.ok), "₹ per month").toEqual([]);
  expect(plain.filter((r) => !r.ok), "no unit").toEqual([]);
  // A currency symbol on a field with no currency is explained, not guessed.
  const noCurrency = plain.find((r) => r.typed === "₹5")!;
  expect(noCurrency.message).toBe("This value has no currency, so enter just the number.");
  // The map holds exactly the entries that were accepted.
  const accepted = [...rupees, ...plain].filter((r) => r.outcome === "stored").length;
  expect(openMap(await stored(page)).variables).toHaveLength(accepted);
  await page.getByTestId("var-label").fill("Visits");
  await page.getByTestId("var-start").fill("1,5");
  await page.getByTestId("add-variable").click();
  await expect(page.getByTestId("var-start-error")).toContainText("comma");
  await shot(page, "after-P3-2-define-start-refusal-desktop-1440");
  clean(seen);
});

test("P3 / question card: a refused amount leaves the question open and stores nothing; accepted amounts keep the calculation exact", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page, { plan: audit.bookstore });
  await ask(page, "What if I opened a bookstore with ₹20,000 per month sales, ₹8,000 rent and ₹4,000 other costs?");
  await page.getByTestId("explore-future-0").click();
  const card = page.getByTestId("question-card");
  await expect(card).toContainText("Sales per month");
  const rows: Observed[] = [];
  for (const typed of ["1,5", "1.500", "€2.500", "€2,500", "0,285", "1.200,50", "abc", "1e3", "99999999999999999999"]) {
    await page.getByTestId("question-input").fill(typed);
    await page.getByTestId("save-answer").click();
    const error = card.locator(".field-error");
    await expect(error).toBeVisible();
    const savedNow = await savedValue(page, "Open the bookstore", "monthlySales");
    rows.push({ typed, why: "refused on the first question", expected: "refused", outcome: "refused", stored: savedNow, message: squash(await error.innerText()), ok: savedNow === null });
    await expect(card).toContainText("Sales per month");
  }
  await shot(page, "after-P3-3-question-card-refusal-desktop-1440");
  // The amounts the audit used, typed the way the app shows them.
  const accepted: [string, string, number][] = [["Sales per month", "₹20,000", 20000], ["Rent", "1,500", 1500], ["Other costs", "4000", 4000]];
  const keys: Record<string, string> = { "Sales per month": "monthlySales", Rent: "rent", "Other costs": "otherCosts" };
  for (const [label, typed, want] of accepted) {
    await answerNumber(page, label, typed);
    await expect.poll(() => savedValue(page, "Open the bookstore", keys[label]!), { timeout: 10_000 }).toBe(want);
    rows.push({ typed, why: `${label}, accepted`, expected: want, outcome: "stored", stored: await savedValue(page, "Open the bookstore", keys[label]!), message: "", ok: true });
  }
  expect(rows.filter((r) => !r.ok)).toEqual([]);
  await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹14,500 per month");

  // A refusal later, in the editor, leaves the existing calculation and the saved value exactly as they were.
  await page.getByTestId("all-details").click();
  const rent = page.getByTestId("value-rent");
  for (const typed of ["1,5", "€2.500"]) {
    await rent.fill(typed);
    await rent.press("Enter");
    await expect(page.locator(".assump", { has: rent }).locator(".field-error")).toBeVisible();
    await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹14,500 per month");
    expect(await savedValue(page, "Open the bookstore", "rent")).toBe(1500);
  }
  await rent.fill("₹2,000");
  await rent.press("Enter");
  await expect(page.getByTestId("story-calc-shopProfit")).toContainText("₹14,000 per month");
  expect(await savedValue(page, "Open the bookstore", "rent")).toBe(2000);
  clean(seen);
});

test("P3 / What if this changed?: a refused amount creates no path; an accepted one creates exactly the path typed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page);
  await page.goto("/");
  await page.getByTestId("example-move-city").click();
  await node(page, "Move to London").click();
  const london = pathNamed(openMap(await stored(page)), "Move to London");
  expect(london.values.rent).toBe(1500);
  const rows: Observed[] = [];
  const openRent = async () => {
    await page.getByTestId("change-rent").click();
    await expect(page.getByTestId("whatif-row-rent")).toBeVisible();
  };

  await openRent();
  const paths = () => stored(page).then((s) => openMap(s).branches.length);
  const count = await paths();
  for (const typed of ["1,2", "1.200", "€1,200", "$1200", "abc", "", "1500"]) {
    await page.getByTestId("whatif-input-rent").fill(typed);
    await page.getByTestId("whatif-create-rent").click();
    const error = page.getByTestId("whatif-row-rent").locator(".field-error");
    await expect(error).toBeVisible();
    await expect(page.getByTestId("story-title")).toHaveText("Move to London");
    const same = (await paths()) === count;
    rows.push({ typed, why: "refused: no path is created", expected: "refused", outcome: "refused", stored: london.values.rent ?? null, message: squash(await error.innerText()), ok: same });
  }
  await shot(page, "after-P3-4-what-if-refusal-desktop-1440");
  expect(rows.filter((r) => !r.ok)).toEqual([]);

  const accepted: [string, number][] = [["£1,200", 1200], ["1,350", 1350], ["0", 0], ["1.5", 1.5], ["2 500", 2500]];
  for (const [typed, want] of accepted) {
    await openRent().catch(async () => {
      await page.getByTestId("story-parent").click();
      await openRent();
    });
    await page.getByTestId("whatif-input-rent").fill(typed);
    await page.getByTestId("whatif-create-rent").click();
    await expect(page.getByTestId("story-parent")).toHaveText("Move to London");
    const made = openMap(await stored(page)).branches.filter((b) => b.parentId === london.id).at(-1)!;
    rows.push({ typed, why: "accepted: a new path with exactly this rent", expected: want, outcome: "stored", stored: made.values.rent ?? null, message: "", ok: made.values.rent === want && made.sources?.rent === "user" });
    await page.getByTestId("story-parent").click();
  }
  recordMatrix("What if this changed? (rent, £ per month)", "Rent on “Move to London”", rows);
  expect(rows.filter((r) => !r.ok)).toEqual([]);
  // The original path still has the example's rent.
  expect(pathNamed(openMap(await stored(page)), "Move to London")).toEqual(london);
  clean(seen);
});

/** What each input does on a field that wants a number in ₹ per month, on the two surfaces that cannot hold an empty answer. */
const BOOKSTORE_Q = "What if I opened a bookstore with ₹20,000 per month sales, ₹8,000 rent and ₹4,000 other costs?";
const TYPED_EXPECT: [string, Expect, string][] = [
  ["1,5", "refused", "a comma that does not separate thousands"],
  ["1.5", 1.5, "dot decimal"],
  ["1,500", 1500, "comma thousands"],
  ["1.500", "refused", "1.5 or 1,500 depending on the writer's country"],
  ["€2.500", "refused", "another currency, and ambiguous"],
  ["€2,500", "refused", "another currency"],
  ["₹20,000", 20000, "the field's own currency symbol"],
  ["-500", -500, "negative"],
  ["0", 0, "zero is a value"],
  ["", "refused", "no answer: the card and the sheet need a number (leaving it unknown is “Skip for now”)"],
  ["abc", "refused", "letters"],
  ["99999999999999999999", "refused", "very large"],
  ["0,285", "refused", "a decimal comma"],
  ["1.200,50", "refused", "European grouping and decimals"],
  ["1e3", "refused", "an exponent"],
  ["$20", "refused", "another currency"],
];

test("P3 / question card: every input in the matrix is refused with the question left open, or stored exactly as typed", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page, { plan: audit.bookstore });
  const KEYS: Record<string, string> = { "Sales per month": "monthlySales", Rent: "rent", "Other costs": "otherCosts" };
  const card = page.getByTestId("question-card");
  let maps = 0;
  const openBookstore = async () => {
    if (maps++ === 0) await ask(page, BOOKSTORE_Q);
    else {
      await page.getByTestId("home").click();
      await page.getByTestId("whatif-input").fill(BOOKSTORE_Q);
      await page.getByTestId("explore-possibilities").click();
    }
    await page.getByTestId("explore-future-0").click();
    await expect(card).toContainText("Sales per month");
  };
  await openBookstore();
  const rows: Observed[] = [];
  for (const [typed, want, why] of TYPED_EXPECT) {
    // Each accepted answer uses up a question; a fresh map supplies the next ones.
    if ((await card.count()) === 0) await openBookstore();
    const label = (await card.locator(".q-prompt strong").innerText()).trim();
    const key = KEYS[label];
    expect(key, `a question about ${label}`).toBeDefined();
    await page.getByTestId("question-input").fill(typed);
    await page.getByTestId("save-answer").click();
    const error = card.locator(".field-error");
    await expect
      .poll(async () => ((await error.count()) > 0 || (await savedValue(page, "Open the bookstore", key!)) !== null ? "settled" : "waiting"), { timeout: 8_000 })
      .toBe("settled")
      .catch(() => undefined);
    const refused = (await error.count()) > 0;
    const stored = await savedValue(page, "Open the bookstore", key!);
    const outcome = refused ? "refused" : stored !== null ? "stored" : "no change";
    rows.push({ typed, why: `${why} (${label})`, expected: want, outcome, stored, message: refused ? squash(await error.innerText()) : "", ok: want === "refused" ? refused && stored === null : outcome === "stored" && stored === want });
    if (refused) {
      // The same question is still open and nothing was saved for it.
      await expect(card.locator(".q-prompt strong")).toHaveText(label);
      if (typed === "1.200,50") await shot(page, "after-P3-5-question-card-european-desktop-1440");
    }
  }
  recordMatrix("Question card", "Sales per month, Rent and Other costs (₹ per month)", rows);
  expect(rows.filter((r) => !r.ok), "every input behaves as the policy says").toEqual([]);
  clean(seen);
});

test("P3 / What if this changed? on a rupee amount: refused input creates no path; accepted input creates exactly the path typed", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page, { plan: audit.bookstore });
  await ask(page, BOOKSTORE_Q);
  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-title")).toHaveText("Open the bookstore");
  const start = pathNamed(openMap(await stored(page)), "Open the bookstore");
  expect(start.values.monthlySales).toBeNull();
  const open = async () => {
    await whatIfOn(page, "Slow months could squeeze the margin").click();
    await expect(page.getByTestId("whatif-row-monthlySales")).toBeVisible();
  };
  const rows: Observed[] = [];
  let onChild = false;
  for (const [typed, want, why] of TYPED_EXPECT) {
    if (onChild) {
      await page.getByTestId("story-parent").click();
      await expect(page.getByTestId("story-title")).toHaveText("Open the bookstore");
      onChild = false;
    }
    if ((await page.getByTestId("whatif-row-monthlySales").count()) === 0) await open();
    const before = openMap(await stored(page)).branches.map((b) => b.id);
    await page.getByTestId("whatif-input-monthlySales").fill(typed);
    await page.getByTestId("whatif-create-monthlySales").click();
    const error = page.getByTestId("whatif-row-monthlySales").locator(".field-error");
    await expect
      .poll(async () => ((await error.count()) > 0 || (await page.getByTestId("story-title").innerText()) !== "Open the bookstore" ? "settled" : "waiting"), { timeout: 8_000 })
      .toBe("settled")
      .catch(() => undefined);
    const refused = (await error.count()) > 0;
    const made = openMap(await stored(page)).branches.filter((b) => !before.includes(b.id));
    const child = made[0];
    const stored1 = child ? child.values.monthlySales ?? null : null;
    const outcome = refused ? "refused" : child ? "stored" : "no change";
    rows.push({
      typed, why: `${why} (Sales per month on a new path)`, expected: want, outcome, stored: stored1, message: refused ? squash(await error.innerText()) : "",
      ok: want === "refused" ? refused && made.length === 0 : made.length === 1 && child!.parentId === start.id && stored1 === want && child!.sources?.monthlySales === "user",
    });
    if (!refused && child) onChild = true;
    if (refused && typed === "1,5") await shot(page, "after-P3-6-what-if-rupee-refusal-desktop-1440");
  }
  recordMatrix("What if this changed? (sales, ₹ per month)", "Sales per month on “Open the bookstore”", rows);
  expect(rows.filter((r) => !r.ok), "every input behaves as the policy says").toEqual([]);
  // The path the user started from never changed.
  expect(pathNamed(openMap(await stored(page)), "Open the bookstore")).toEqual(start);
  clean(seen);
});

// ================================================================================================
// P4. Unit spellings are one unit; periods, currencies and dimensions are not merged; unknown stays unknown.
// ================================================================================================

test("P4 / ₹/month = ₹ per month, £, €, minutes = min; a different period, currency or dimension is not merged", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page);
  await startBlank(page, "What if I compared unit spellings?");

  const addVar = async (label: string, unit: string, start: string) => {
    await page.getByTestId("var-label").fill(label);
    await page.getByTestId("var-unit").fill(unit);
    await page.getByTestId("var-start").fill(start);
    await page.getByTestId("add-variable").click();
    await expect.poll(async () => openMap(await stored(page)).variables.some((v) => v.label === label), { timeout: 10_000 }).toBe(true);
  };
  const addFormula = async (label: string, expression: string) => {
    await page.getByTestId("f-label").fill(label);
    await page.getByTestId("f-expr").fill(expression);
    await page.getByTestId("add-formula").click();
    await expect(page.getByTestId(`formula-${label.replace(/\s+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase())}`)).toBeVisible();
  };
  const UNITS: [string, string, string][] = [
    ["Income", "₹/month", "20000"], ["Bonus", "₹ per month", "5000"],
    ["Pocket money", "£/month", "100"], ["Allowance", "£ per month", "50"],
    ["Salary", "€/month", "3000"], ["Tips", "€ per month", "200"],
    ["Travel", "minutes", "40"], ["Wait", "min", "5"],
    ["Yearly fee", "£ per year", "600"], ["Hours worked", "hours", "2"],
    ["Dollar rent", "$ per month", "10"], ["Visits", "", "3"],
  ];
  for (const [label, unit, start] of UNITS) await addVar(label, unit, start);
  const FORMULAS: [string, string][] = [
    ["Total pay", "income + bonus"], ["Total allowance", "pocketMoney + allowance"], ["Total euros", "salary + tips"], ["Total time", "travel + wait"], ["Pay gap", "income - bonus"],
    ["Rupees plus pounds", "income + allowance"], ["Pounds month plus year", "pocketMoney + yearlyFee"], ["Minutes plus hours", "travel + hoursWorked"],
    ["Pounds plus dollars", "pocketMoney + dollarRent"], ["Visits plus fee", "visits + yearlyFee"],
  ];
  for (const [label, expression] of FORMULAS) await addFormula(label, expression);
  await page.getByTestId("all-details").click();
  const calc = async (key: string) => squash(await page.getByTestId(`story-calc-${key}`).innerText());

  // Equivalent spellings combine; the number is shown with the first spelling, exactly as typed.
  expect(await calc("totalPay")).toContain("₹25,000/month");
  expect(await calc("totalAllowance")).toContain("£150/month");
  expect(await calc("totalEuros")).toContain("€3,200/month");
  expect(await calc("totalTime")).toContain("45 minutes");
  expect(await calc("payGap")).toContain("₹15,000/month");
  for (const key of ["totalPay", "totalAllowance", "totalEuros", "totalTime", "payGap"]) expect(await calc(key), key).not.toContain("units don't match");

  // A different period, currency or dimension is not merged: no number, and the units are named.
  expect(await calc("rupeesPlusPounds")).toContain("units don't match (₹/month, £ per month)");
  expect(await calc("poundsMonthPlusYear")).toContain("units don't match (£/month, £ per year)");
  expect(await calc("minutesPlusHours")).toContain("units don't match (minutes, hours)");
  expect(await calc("poundsPlusDollars")).toContain("units don't match (£/month, $ per month)");
  for (const key of ["rupeesPlusPounds", "poundsMonthPlusYear", "minutesPlusHours", "poundsPlusDollars"]) expect(await calc(key), key).not.toMatch(/\d{3}/);

  // A number with no unit stays without one: nothing is borrowed from the amount beside it.
  const visits = await calc("visitsPlusFee");
  expect(visits).toContain("603");
  expect(visits).toContain("no unit given");
  expect(visits).not.toMatch(/[£₹€$]/);
  await shot(page, "after-P4-1-unit-results-desktop-1440");

  // Nothing about the user's units was rewritten: the map holds exactly what was typed, and no formula was given a unit.
  const r = openMap(await stored(page));
  expect(r.variables.map((v) => [v.label, v.unit])).toEqual(UNITS.map(([label, unit]) => [label, unit]));
  expect((r as unknown as { formulas: { unit: string }[] }).formulas.map((f) => f.unit)).toEqual(FORMULAS.map(() => ""));

  // Comparison: equivalent spellings compare as numbers with their difference; the others say why they cannot.
  await page.getByTestId("branch-from-here").click();
  await page.getByTestId("fork-name").fill("Higher bonus");
  await page.getByTestId("fork-create").click();
  await page.getByTestId("all-details").click();
  await page.getByTestId("tab-branch").click();
  await page.getByTestId("value-bonus").fill("6000");
  await page.getByTestId("value-bonus").press("Enter");
  await expect(page.getByTestId("story-calc-totalPay")).toContainText("₹26,000/month");
  await page.getByTestId("all-details").click();
  await page.getByTestId("compare-with").click();
  await page.getByTestId("compare-pick-Today").click();
  const pay = page.getByTestId("cmp-calc-totalPay");
  await expect(pay).toContainText("₹26,000/month");
  await expect(pay).toContainText("₹25,000/month");
  await expect(pay).toContainText("₹1,000/month");
  await expect(page.getByTestId("cmp-mixed-units")).toContainText("different units");
  for (const label of ["Rupees plus pounds", "Pounds month plus year", "Minutes plus hours", "Pounds plus dollars"]) await expect(page.getByTestId("cmp-mixed-units")).toContainText(label);
  await shot(page, "after-P4-2-unit-compare-desktop-1440");
  clean(seen);
});

// ================================================================================================
// P5. Importing never replaces a saved map. Disposable data only.
// ================================================================================================

const addKnown = async (page: Page, text: string) => {
  await page.getByTestId("add-known").click();
  await page.getByTestId("add-known-text").fill(text);
  await page.getByTestId("add-known-save").click();
  await expect(page.getByTestId("story-known")).toContainText(text);
};
/** Save every map to a file with the app's own export and return the file's path. */
const exportFile = async (page: Page) => {
  // The menu is a <details>: open it only if it is closed. Choosing “Save all maps” closes it again by itself.
  const menu = page.locator("details.more");
  if (!(await menu.evaluate((el) => (el as HTMLDetailsElement).open))) await page.getByTestId("more-menu").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-realities").click();
  const file = await (await download).path();
  await expect(menu).not.toHaveAttribute("open", "");
  return file;
};
const freshBrowser = async (browser: Browser, vp: { width: number; height: number }) => {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, baseURL: "http://localhost:5179" });
  const page = await context.newPage();
  const seen = await guardApi(page);
  await page.goto("/");
  return { context, page, seen };
};

for (const vp of VIEWPORTS) {
  test(`P5 / the failing route: an older file imported over a map edited since keeps both, and says so (${vp.name})`, async ({ page, browser }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const seen = await guardApi(page);
    const Q = "What if import overwrote my edits?";
    await startBlank(page, Q);
    await addKnown(page, "Version one: written before the export");
    await page.getByTestId("home").click();
    const older = await exportFile(page);

    await page.getByTestId(`open-${Q}`).click();
    await addKnown(page, "Version two: written AFTER the export");
    await page.getByTestId("home").click();
    const before = await stored(page);
    const original = before.realities[0]!;
    expect(before.realities).toHaveLength(1);
    expect(Object.keys(before.edited)).toEqual([original.id]);
    expect(original.branches[0]!.facts!.map((f) => f.answer)).toEqual(["Version one: written before the export", "Version two: written AFTER the export"]);

    // Import the older export.
    await importFile(page, older);
    const notice = page.getByTestId("notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Restored 1 reality from the file.");
    await expect(notice).toContainText("1 map differs from the saved map with the same ID, so it was added as a separate copy");
    await expect(notice).toContainText("Nothing you saved was changed.");
    await shot(page, `after-P5-1-conflict-notice-${vp.name}`);
    await fits(page, "the import notice and the two maps");

    // The saved map is exactly what it was, with the same edit time; the older version is a separate map beside it.
    const after = await stored(page);
    expect(after.realities).toHaveLength(2);
    expect(after.realities[0]).toEqual(original);
    expect(after.edited).toEqual(before.edited);
    const copy = after.realities[1]!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.question).toBe(original.question);
    expect(copy.branches[0]!.facts!.map((f) => f.answer)).toEqual(["Version one: written before the export"]);
    expect(after.edited[copy.id]).toBeUndefined();
    await expect(notice).toContainText(`(map ${copy.id.slice(-6)})`);

    // Both are listed and told apart; the saved one shows when it was edited, the copy shows no time.
    const links = page.getByTestId(`open-${Q}`);
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toContainText(`map ${original.id.slice(-6)}`);
    await expect(links.nth(0)).toContainText("edited");
    await expect(links.nth(1)).toContainText(`map ${copy.id.slice(-6)}`);
    await expect(links.nth(1)).not.toContainText("edited");
    await shot(page, `after-P5-2-two-maps-listed-${vp.name}`);
    await fits(page, "the home list");

    // The newer work is in the saved map; the older version is in the copy.
    await links.nth(0).click();
    await expect(page.getByTestId("story-known")).toContainText("Version one: written before the export");
    await expect(page.getByTestId("story-known")).toContainText("Version two: written AFTER the export");
    await page.getByTestId("home").click();
    await page.getByTestId(`open-${Q}`).nth(1).click();
    await expect(page.getByTestId("story-known")).toContainText("Version one: written before the export");
    await expect(page.getByTestId("story-known")).not.toContainText("Version two");
    await page.getByTestId("home").click();

    // The same file again adds nothing: no pile of copies.
    await importFile(page, older);
    await expect(page.getByTestId("notice")).toHaveText(/^Nothing new: every map in the file is already saved exactly as it is\./);
    expect((await stored(page)).realities).toHaveLength(2);
    // A file of maps that are all saved exactly as they are changes nothing either.
    await importFile(page, await exportFile(page));
    await expect(page.getByTestId("notice")).toHaveText(/^Nothing new/);
    const settled = await stored(page);
    expect(settled.realities).toEqual(after.realities);
    expect(settled.edited).toEqual(before.edited);

    // A normal import into a browser that has none of these maps restores them as they were, with no conflict message.
    const fresh = await freshBrowser(browser, vp);
    await importFile(fresh.page, older);
    await expect(fresh.page.getByTestId("notice")).toHaveText(/^Restored 1 reality from the file\.\s*OK$/);
    const restored = await stored(fresh.page);
    expect(restored.realities).toHaveLength(1);
    expect(restored.realities[0]!.id).toBe(original.id);
    expect(restored.realities[0]!.branches[0]!.facts!.map((f) => f.answer)).toEqual(["Version one: written before the export"]);
    expect(restored.edited).toEqual({});
    await shot(fresh.page, `after-P5-3-normal-import-${vp.name}`);
    clean(fresh.seen);
    await fresh.context.close();
    clean(seen);
  });
}

test("P5 / files saved by earlier versions import beside each other; two maps that share an ID are both kept", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await guardApi(page);
  await page.goto("/");
  const fileMaps = (name: string) => (JSON.parse(readFileSync(oldFile(name), "utf8")) as { realities: { id: string; question: string; branches: { id: string; fingerprint: string }[] }[] }).realities;

  await importFile(page, oldFile("realities-6e4b8f2.json"));
  await expect(page.getByTestId("notice")).toHaveText(/^Restored 2 realities from the file\.\s*OK$/);
  await importFile(page, oldFile("realities-5b17057.json"));
  await expect(page.getByTestId("notice")).toHaveText(/^Restored 1 reality from the file\.\s*OK$/);
  // 4e4bdfe holds a different map that was also saved with the ID “id1”. It used to replace the restaurant map.
  await importFile(page, oldFile("realities-4e4bdfe.json"));
  const notice = page.getByTestId("notice");
  await expect(notice).toContainText("Restored 1 reality from the file.");
  await expect(notice).toContainText("1 map differs from the saved map with the same ID, so it was added as a separate copy");
  await expect(notice).toContainText("Nothing you saved was changed.");
  await shot(page, "after-P5-4-older-files-same-id-desktop-1440");

  const s = await stored(page);
  expect(s.realities.map((r) => r.question)).toEqual([
    "What if I moved from Mumbai to London?", "What if our family adopted a dog?", "What if I started my own restaurant?", "What if I moved to another country?",
  ]);
  // Every branch of every file is saved with the fingerprint the file gave it: nothing was rewritten or lost.
  const want = [...fileMaps("realities-6e4b8f2.json"), ...fileMaps("realities-5b17057.json"), ...fileMaps("realities-4e4bdfe.json")].flatMap((r) => r.branches.map((b) => b.fingerprint));
  expect(s.realities.flatMap((r) => r.branches.map((b) => b.fingerprint))).toEqual(want);
  expect(s.realities.filter((r) => r.id === "id1")).toHaveLength(1);
  for (const q of s.realities.map((r) => r.question)) await expect(page.getByTestId(`open-${q}`)).toHaveCount(1);

  // Every path of every map still opens.
  for (const r of s.realities) {
    await page.getByTestId(`open-${r.question}`).click();
    for (const b of r.branches) {
      await node(page, b.name).click();
      await expect(page.getByTestId("story-title")).toHaveText(b.name);
    }
    await page.getByTestId("home").click();
  }
  // Each file again: nothing is new.
  for (const name of ["realities-6e4b8f2.json", "realities-5b17057.json", "realities-4e4bdfe.json"]) {
    await importFile(page, oldFile(name));
    await expect(page.getByTestId("notice")).toHaveText(/^Nothing new: every map in the file is already saved exactly as it is\./);
    expect((await stored(page)).realities).toHaveLength(4);
  }
  // And the whole set exports and imports whole.
  const all = await exportFile(page);
  const fresh = await freshBrowserFor(page, all);
  expect(fresh).toEqual((await stored(page)).realities);
  clean(seen);
});

/** Import a file into a brand-new browser context and return what it saved. */
async function freshBrowserFor(page: Page, file: string): Promise<SReality[]> {
  const context = await page.context().browser()!.newContext({ viewport: { width: 1440, height: 900 }, baseURL: "http://localhost:5179" });
  const p = await context.newPage();
  const seen = await guardApi(p);
  await p.goto("/");
  await importFile(p, file);
  await expect(p.getByTestId("notice")).toContainText("Restored 4 realities from the file.");
  const out = (await stored(p)).realities;
  clean(seen);
  await context.close();
  return out;
}

// ================================================================================================
// 390 px: the longest new messages and the new rows fit the screen.
// ================================================================================================

test("390 px: refusal messages, mixed provenance tags and unit mismatches fit the screen", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = await guardApi(page, { plan: audit.bookstore });

  // The question card with the longest refusal (European grouping).
  await ask(page, "What if I opened a bookstore with ₹20,000 per month sales, ₹8,000 rent and ₹4,000 other costs?");
  await page.getByTestId("explore-future-0").click();
  await page.getByTestId("question-input").fill("1.200,50");
  await page.getByTestId("save-answer").click();
  await expect(page.getByTestId("question-card").locator(".field-error")).toContainText("European number formatting");
  await shot(page, "after-fit-1-question-refusal-mobile-390");
  await fits(page, "question card refusal");
  await page.getByTestId("question-input").fill("1,5");
  await page.getByTestId("save-answer").click();
  await expect(page.getByTestId("question-card").locator(".field-error")).toContainText("comma that does not separate thousands");
  await fits(page, "question card, decimal comma");

  // The define panel's refusal and the unit-mismatch rows.
  await page.getByTestId("home").click();
  await page.getByTestId("whatif-input").fill("What if I mixed unit spellings?");
  await page.getByTestId("start-blank").click();
  await page.getByTestId("var-label").fill("Visits");
  await page.getByTestId("var-start").fill("1.500");
  await page.getByTestId("add-variable").click();
  await expect(page.getByTestId("var-start-error")).toContainText("could mean 1.5 or 1500");
  await shot(page, "after-fit-2-define-refusal-mobile-390");
  await fits(page, "define panel refusal");
  for (const [label, unit, start] of [["Income", "₹/month", "20000"], ["Allowance", "£ per month", "50"], ["Bonus", "₹ per month", "5000"]]) {
    await page.getByTestId("var-label").fill(label!);
    await page.getByTestId("var-unit").fill(unit!);
    await page.getByTestId("var-start").fill(start!);
    await page.getByTestId("add-variable").click();
    await expect.poll(async () => openMap(await stored(page)).variables.some((v) => v.label === label), { timeout: 10_000 }).toBe(true);
  }
  for (const [label, expression] of [["Total pay", "income + bonus"], ["Rupees plus pounds", "income + allowance"]]) {
    await page.getByTestId("f-label").fill(label!);
    await page.getByTestId("f-expr").fill(expression!);
    await page.getByTestId("add-formula").click();
  }
  await page.getByTestId("all-details").click();
  await expect(page.getByTestId("story-calc-totalPay")).toContainText("₹25,000/month");
  await expect(page.getByTestId("story-calc-rupeesPlusPounds")).toContainText("units don't match (₹/month, £ per month)");
  await shot(page, "after-fit-3-unit-results-mobile-390");
  await fits(page, "unit results");

  // The what-if row's refusal on an example.
  await page.getByTestId("home").click();
  await page.getByTestId("example-move-city").click();
  await node(page, "Move to London").click();
  await page.getByTestId("change-rent").click();
  await page.getByTestId("whatif-input-rent").fill("€1,200");
  await page.getByTestId("whatif-create-rent").click();
  await expect(page.getByTestId("whatif-row-rent").locator(".field-error")).toContainText("This is in £ per month");
  await shot(page, "after-fit-4-what-if-refusal-mobile-390");
  await fits(page, "what-if refusal");

  // Mixed provenance tags (an older AI map with one thought saved without a source).
  await page.getByTestId("home").click();
  await importFile(page, oldFile("realities-5b17057.json"));
  await page.getByTestId("open-What if I started my own restaurant?").click();
  await node(page, "Small café, owner-run · Hire staff: yes").click();
  await expect(page.getByTestId("story-upsides").locator("li", { hasText: "Time off at weekends" })).toContainText("origin not recorded");
  await shot(page, "after-fit-5-mixed-provenance-mobile-390");
  await fits(page, "mixed provenance");
  clean(seen);
});
