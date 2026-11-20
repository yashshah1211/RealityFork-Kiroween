import { expect, test, type Page } from "@playwright/test";

const LANDING = "/?preview=atlas&atlasDebug=1&atlasQuality=low";
const modal = (page: Page) => page.locator(".hollow-dialog");
const prompt = (page: Page, name: string) => modal(page).getByRole("button", { name });
const state = (page: Page) => page.evaluate(() => window.__rfAtlas?.stats().hollow?.world);
const resources = (page: Page) => page.evaluate(() => {
  const { geometries, textures } = window.__rfAtlas!.stats();
  return { geometries, textures };
});

async function walkUntil(page: Page, key: string, axis: number, target: number, less: boolean) {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(({ axis, target, less }) => {
      const value = window.__rfAtlas?.stats().hollow?.world?.position[axis];
      return value !== undefined && (less ? value < target : value > target);
    }, { axis, target, less }, { timeout: 55_000 });
  } catch (error) {
    throw new Error(`Could not reach ${target} on axis ${axis} with ${key}. Last pose ${JSON.stringify(await state(page))}`, { cause: error });
  } finally {
    await page.keyboard.up(key);
  }
}

async function turn(page: Page, dx: number, dy = 0) {
  const start = dx > 0 ? 158 : 1036;
  await page.mouse.move(start, 410);
  await page.mouse.down();
  await page.mouse.move(start + dx, 410 + dy, { steps: 10 });
  await page.mouse.up();
}

async function arrive(page: Page) {
  await page.goto(LANDING);
  await page.getByRole("button", { name: "Enter The Hollow" }).press("Enter");
  await expect(modal(page)).toHaveAttribute("data-phase", "exploring");
}

async function threshold(page: Page, area: "courtyard" | "bookshop") {
  await expect(modal(page)).toHaveAttribute("data-area", area);
  await expect.poll(async () => (await state(page))?.doorway).toBeNull();
  await expect(modal(page)).toBeVisible();
}

function trackFade(page: Page, to: "courtyard" | "bookshop") {
  return page.evaluate((to) => new Promise<{ cover: boolean; reveal: boolean; maximum: number }>((resolve) => {
    const seen = { cover: false, reveal: false, maximum: 0 };
    const start = performance.now();
    function sample() {
      const world = window.__rfAtlas?.stats().hollow?.world;
      seen.cover ||= world?.doorway === "cover";
      seen.reveal ||= world?.doorway === "reveal";
      seen.maximum = Math.max(seen.maximum, world?.fade ?? 0);
      if ((world?.area === to && !world.doorway) || performance.now() - start > 18_000) resolve(seen);
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }), to);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503,
    json: { ok: false, code: "no-key", message: "Planner unavailable in this browser test." },
  }));
});

test("explores all three bookshop objects, leaves, revisits and returns to the landing form", async ({ page }, info) => {
  await page.goto(LANDING);
  const question = page.getByTestId("whatif-input");
  await question.fill("What if I kept the bookshop open?");
  await page.getByRole("button", { name: "Enter The Hollow" }).press("Enter");
  await expect(modal(page)).toHaveAttribute("data-phase", "exploring");
  const canvas = await page.locator(".hollow-viewport canvas").elementHandle();
  await expect(prompt(page, "Enter Bookshop")).toHaveCount(0);
  await walkUntil(page, "KeyW", 2, -5.8, true);
  await expect(prompt(page, "Enter Bookshop")).toBeVisible();
  const baseline = await resources(page);
  const entry = trackFade(page, "bookshop");
  await page.keyboard.press("f");
  await threshold(page, "bookshop");
  expect(await entry).toMatchObject({ reveal: true, maximum: 1 });
  await expect(page.getByRole("heading", { name: "The Whispering Bookshop" })).toBeVisible();
  await expect(modal(page).locator(".hollow-guide")).toContainText("Esc to return to the courtyard");
  expect(await canvas!.evaluate((canvas) => canvas.isConnected)).toBe(true);
  expect((await state(page))?.position[1]).toBe(1.68);
  await expect(prompt(page, "Open the Floating Book")).toHaveCount(0);

  await walkUntil(page, "KeyW", 2, 0.68, true);
  expect((await state(page))!.position[2]).toBeGreaterThanOrEqual(0.51);
  await expect.poll(async () => (await state(page))?.room?.bookLift).toBeGreaterThan(0.05);
  await page.keyboard.press("f");
  await expect(modal(page).getByRole("status")).toContainText("Both pages remember");
  await expect.poll(async () => (await state(page))?.room?.bookLift).toBeGreaterThan(0.42);

  await walkUntil(page, "KeyD", 0, 1.68, false);
  await walkUntil(page, "KeyW", 2, -1.08, true);
  await expect(prompt(page, "Read the Keeper’s Desk")).toBeVisible();
  await page.keyboard.press("f");
  const notes = modal(page).getByRole("group", { name: "Mara’s three choices" });
  await expect(notes.getByRole("heading")).toHaveText(["Sell the bookshop", "Keep the shop open", "Share the keys with the community"]);
  await expect(notes).toContainText("Pay the overdue bill");
  await expect.poll(async () => (await state(page))?.room?.deskReveal).toBeGreaterThan(0.65);

  await walkUntil(page, "KeyS", 2, 0.77, false);
  await walkUntil(page, "KeyA", 0, -2.05, true);
  await walkUntil(page, "KeyW", 2, 0.18, true);
  await turn(page, -383);
  await expect(prompt(page, "Search the Whispering Shelf")).toBeVisible();
  await prompt(page, "Search the Whispering Shelf").click();
  await expect(modal(page).getByRole("status")).toContainText("Behind the false spines");
  await expect.poll(async () => (await state(page))?.room?.shelfSlide).toBeGreaterThan(0.65);
  await page.screenshot({ path: info.outputPath("brass-key.png") });

  await page.mouse.move(620, 410);
  await page.mouse.down();
  await expect(modal(page).locator(".hollow-guide")).toContainText("Esc to release look");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(modal(page)).toHaveAttribute("data-area", "bookshop");
  await expect(modal(page).locator(".hollow-guide")).toContainText("Esc to return to the courtyard");

  const exit = trackFade(page, "courtyard");
  await page.keyboard.press("Escape");
  await threshold(page, "courtyard");
  expect(await exit).toMatchObject({ reveal: true, maximum: 1 });
  expect((await state(page))?.room).toBeNull();
  await expect.poll(async () => (await state(page))?.bookshopLight).toBe(1);
  expect(await resources(page)).toEqual(baseline);
  await turn(page, -766);
  await prompt(page, "Enter Bookshop").click();
  await threshold(page, "bookshop");
  await page.keyboard.press("Escape");
  await threshold(page, "courtyard");
  expect(await resources(page)).toEqual(baseline);
  expect(await canvas!.evaluate((canvas) => canvas.parentElement?.className)).toBe("hollow-viewport");
  await turn(page, -766);
  await prompt(page, "Enter Bookshop").click();
  await threshold(page, "bookshop");
  await prompt(page, "Return to Multiverse").click();
  await expect(page.getByRole("button", { name: "Enter The Hollow" })).toBeFocused();
  await expect(question).toHaveValue("What if I kept the bookshop open?");
  const request = page.waitForRequest((req) => req.url().endsWith("/api/plan") && req.method() === "POST");
  await page.getByTestId("explore-possibilities").click();
  expect((await request).postDataJSON()).toMatchObject({ question: "What if I kept the bookshop open?" });
});

test("Escape cancels the incoming doorway and repeated Escape leaves focus on the entrance", async ({ page }) => {
  await arrive(page);
  await walkUntil(page, "KeyW", 2, -5.8, true);
  await prompt(page, "Enter Bookshop").evaluate((button) => {
    // Trigger dialog cancellation in the same task, while the lazy doorway is still loading.
    (button as HTMLButtonElement).click();
    button.closest("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  await threshold(page, "courtyard");
  await expect(prompt(page, "Enter Bookshop")).toBeVisible();
  await prompt(page, "Enter Bookshop").click();
  await threshold(page, "bookshop");
  await page.keyboard.press("Escape");
  await threshold(page, "courtyard");
  await page.keyboard.down("Escape");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  await expect(modal(page)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Enter The Hollow" })).toBeFocused();
});

test("a lost context inside the bookshop restores the painted landing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await arrive(page);
  await walkUntil(page, "KeyW", 2, -5.8, true);
  await prompt(page, "Enter Bookshop").click();
  await threshold(page, "bookshop");
  await page.locator(".hollow-viewport canvas").evaluate((element) => {
    (element as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.getByTestId("imagine")).toHaveClass(/flat/);
  await expect(modal(page)).toHaveCount(0);
  await expect(page.getByTestId("whatif-input")).toBeVisible();
});

test.describe("touch bookshop", () => {
  test.use({ viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });

  test("touch walks through the door, reveals a still passage and exits through the same door", async ({ page }) => {
    await arrive(page);
    const cdp = await page.context().newCDPSession(page);
    const holdForward = async (name: string) => {
      const button = (await prompt(page, "Walk forward").boundingBox())!;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{
        x: button.x + button.width / 2, y: button.y + button.height / 2,
      }] });
      try {
        await expect(prompt(page, name)).toBeVisible({ timeout: 55_000 });
      } finally {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
    };
    await holdForward("Enter Bookshop");
    const entry = trackFade(page, "bookshop");
    await prompt(page, "Enter Bookshop").tap();
    await threshold(page, "bookshop");
    expect((await entry).maximum).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await holdForward("Open the Floating Book");
    await prompt(page, "Open the Floating Book").tap();
    await expect.poll(async () => (await state(page))?.room?.bookLift).toBeCloseTo(0.546);
    await expect(modal(page).getByRole("status")).toContainText("Both pages remember");
    // Three short drags turn around without depending on how fast the browser renders held keys.
    for (let i = 0; i < 3; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 286, y: 345 }] });
      for (const x of [223, 160, 97, 30]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: 345 }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await expect.poll(async () => Math.abs(((await state(page))?.yaw ?? 0) - Math.PI)).toBeLessThan(0.15);
    await holdForward("Return to the courtyard");
    await prompt(page, "Return to the courtyard").tap();
    await threshold(page, "courtyard");
    expect((await state(page))?.room).toBeNull();
  });

  test("all three desk notes fit at phone and tablet widths", async ({ page }, info) => {
    await arrive(page);
    await walkUntil(page, "KeyW", 2, -5.8, true);
    await prompt(page, "Enter Bookshop").tap();
    await threshold(page, "bookshop");
    await walkUntil(page, "KeyW", 2, 0.68, true);
    await walkUntil(page, "KeyD", 0, 1.68, false);
    await walkUntil(page, "KeyW", 2, -1.08, true);
    const desk = prompt(page, "Read the Keeper’s Desk");
    await expect(desk, JSON.stringify(await state(page))).toBeVisible({ timeout: 7000 });
    await desk.tap();
    const notes = modal(page).getByRole("group", { name: "Mara’s three choices" });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 700 });
      await expect(notes).toBeInViewport({ ratio: 1 });
      await expect(notes.getByRole("heading")).toHaveCount(3);
      await page.screenshot({ path: info.outputPath("desk-" + width + ".png") });
      const [papers, movement, back] = await Promise.all(
        [notes, modal(page).locator(".hollow-move"), prompt(page, "Return to Multiverse")].map((el) => el.boundingBox()));
      expect(papers!.y).toBeGreaterThanOrEqual(back!.y + back!.height);
      expect(papers!.y + papers!.height).toBeLessThanOrEqual(movement!.y);
      expect(await notes.evaluate((el) => [...el.querySelectorAll("article")].every((note) =>
        note.scrollWidth <= note.clientWidth && note.scrollHeight <= note.clientHeight))).toBe(true);
    }
  });
});

async function reachDesk(page: Page) {
  await walkUntil(page, "KeyW", 2, -5.8, true);
  await prompt(page, "Enter Bookshop").click();
  await threshold(page, "bookshop");
  await walkUntil(page, "KeyW", 2, 0.68, true);
  await walkUntil(page, "KeyD", 0, 1.68, false);
  await walkUntil(page, "KeyW", 2, -1.08, true);
  await prompt(page, "Read the Keeper’s Desk").click();
}

test("Mara’s chapter preserves the draft and compares immutable paths through the well", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto(LANDING);
  await page.getByTestId("example-cafe-queue").click();
  await expect(page.getByTestId("atlas-question")).toContainText("barista");
  await page.getByTestId("home").click();
  const maps = () => page.evaluate(() => localStorage.getItem("realityfork.realities.v1"));
  const before = await maps();
  expect(before).toContain("barista");
  const requests: string[] = [];
  page.on("request", req => { if (req.url().includes("/api/")) requests.push(req.url()); });
  const draft = page.getByTestId("whatif-input");
  await draft.fill("Could I take a shorter working week?");
  const enter = page.getByRole("button", { name: "Enter The Hollow" });
  await expect(enter).toBeVisible();
  const baseline = await resources(page);
  await enter.press("Enter");
  await expect(modal(page)).toHaveAttribute("data-phase", "exploring");
  await reachDesk(page);
  const shot = (name: string) => page.screenshot({ path: info.outputPath(name + ".png"), animations: "disabled" });
  await shot("01-desk");
  await prompt(page, "Begin Mara’s Story").click();
  const chapter = page.locator(".chapter-page");
  const confirm = chapter.getByRole("button", { name: "Confirm decision" });
  const choose = async (label: string) => {
    await chapter.getByRole("radio", { name: new RegExp(label) }).check();
    await confirm.click();
  };
  await expect(confirm).toBeDisabled();
  await shot("02-first-decision");
  const pose = (await state(page))!.position;
  await page.keyboard.press("KeyW");
  await chapter.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chapter.getByRole("heading", { name: "The keys change hands" })).toBeVisible();
  expect((await state(page))!.position).toEqual(pose);
  await page.keyboard.press("Escape");
  await expect(chapter).toHaveCount(0);
  await expect(modal(page)).toHaveAttribute("data-area", "bookshop");
  await expect(modal(page).getByRole("heading", { name: "Bookshop memory archive" })).toBeVisible();
  const guide = modal(page).getByText("Find a landmark", { exact: true });
  await guide.focus();
  await page.keyboard.press("Enter");
  await expect(modal(page).locator(".chapter-directions p")).toContainText("Whispering Well");
  await page.keyboard.press("Enter");
  await shot("03-desk-inscription");
  await walkUntil(page, "KeyA", 0, -0.85, true);
  await walkUntil(page, "KeyW", 2, -2.85, true);
  await expect(prompt(page, "Look into the Forking Mirror")).toBeVisible();
  await shot("03b-bookshop-mirror");
  await prompt(page, "Look into the Forking Mirror").click();
  await expect(chapter).toContainText("The glass holds one path");
  await prompt(page, "Close chapter and explore").click();
  await prompt(page, "Mara’s ledger").click();
  await prompt(page, "Visit the Whispering Well").click();
  await threshold(page, "courtyard");
  await shot("04-well-and-shop");
  await prompt(page, "Examine the well").click();
  await expect(chapter.getByRole("heading", { name: "Where will the books go?" })).toBeVisible();
  await shot("05-second-decision");
  await choose("Give the crates");
  await expect(chapter).toContainText("Two crates in the schoolroom");
  await expect(chapter.locator(".chapter-state")).toContainText("Pupils on school days");
  await shot("06-reality-report");
  const signs = async () => (await state(page))?.signs;
  expect(await signs()).toEqual({ shop: "Bookshop sold · Memory archive", lending: "Schoolroom · Pupils on school days" });
  await prompt(page, "Fork at decision 2").click();
  await choose("Open a market-day library");
  await expect(chapter.locator(".chapter-state")).toContainText("Hall stewards unpack each week");
  expect(await signs()).toEqual({ shop: "Bookshop sold · Memory archive", lending: "Village hall · Weekly public lending" });
  await prompt(page, "Return to the village").click();
  await prompt(page, "Return to Multiverse").click();
  await expect(draft).toHaveValue("Could I take a shorter working week?");
  expect(await resources(page)).toEqual(baseline);
  await enter.press("Enter");
  await expect(modal(page)).toHaveAttribute("data-phase", "exploring");
  await walkUntil(page, "KeyW", 2, -1.65, true);
  await turn(page, -165);
  await shot("hall-from-courtyard");
  await turn(page, 165);
  await walkUntil(page, "KeyW", 2, -5.8, true);
  await prompt(page, "Enter bookshop memory archive").click();
  await threshold(page, "bookshop");
  await prompt(page, "Mara’s ledger").click();
  await expect(chapter).toContainText("A library for market day");
  await prompt(page, "Rewind to decision 1").click();
  await choose("Keep the shop open");
  await prompt(page, "Visit the Whispering Well").click();
  await threshold(page, "courtyard");
  await prompt(page, "Examine the well").click();
  await choose("Open on fewer days");
  await expect(chapter).not.toContainText("Protect daily browsing");
  await expect(chapter.locator(".chapter-state")).toContainText("Shortened public week");
  expect(await signs()).toEqual({ shop: "A shorter week on the door", lending: null });
  await shot("shorter-week");
  await prompt(page, "Fork at decision 2").click();
  await choose("Teach evening classes");
  await expect(chapter.locator(".chapter-state")).toContainText("Daily browsing");
  expect(await signs()).toEqual({ shop: "Lamplight after closing", lending: null });
  await prompt(page, "Rewind to decision 1").click();
  await choose("Share the keys");
  await prompt(page, "Visit the Whispering Well").click();
  await prompt(page, "Examine the well").click();
  await choose("Collect members");
  await expect(chapter.locator(".chapter-state")).toContainText("Public browsing, member loans");
  expect(await signs()).toEqual({ shop: "The members’ lending ledger", lending: null });
  await prompt(page, "Fork at decision 2").click();
  await choose("Draw up a volunteer rota");
  expect(await signs()).toEqual({ shop: "Many hands at the counter", lending: null });
  await prompt(page, "Compare timelines").click();
  await chapter.getByLabel("Right timeline").selectOption("start/sell/hall");
  await expect(chapter).toContainText("Stewards unpack the crates each week");
  await expect(chapter).toContainText("Time freed by volunteers");
  await expect(chapter).not.toContainText(/Weekly setup|One shared shift/);
  await chapter.getByLabel("Right timeline").selectOption("start/sell/school");
  await expect(chapter).toContainText("Pupils on school days");
  await expect(chapter).toContainText("Open village lending");
  await expect(chapter.getByLabel("Left timeline")).toHaveValue("start/share/rota");
  await shot("07-forking-mirror");
  await chapter.getByLabel("Left timeline").selectOption("start/sell/school");
  await expect(chapter.getByLabel("Right timeline")).toHaveValue("start/share/rota");
  await prompt(page, "Open left timeline").click();
  await expect(chapter).toContainText("Two crates in the schoolroom");
  expect(await signs()).toEqual({ shop: "Bookshop sold · Memory archive", lending: "Schoolroom · Pupils on school days" });
  await prompt(page, "Explore Your Own What-If").click();
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("Could I take a shorter working week?");
  expect(await maps()).toBe(before);
  expect(requests).toEqual([]);
  expect(await state(page)).toBeUndefined();
  // Remount the landing in the same document, as when returning from a real map.
  await page.locator(".continue-link").first().click();
  await page.getByTestId("home").click();
  await enter.press("Enter");
  await expect(modal(page)).toHaveAttribute("data-phase", "exploring");
  await walkUntil(page, "KeyW", 2, -1.65, true);
  await turn(page, 145);
  await shot("schoolroom-from-courtyard");
  await prompt(page, "Mara’s ledger").click();
  await expect(chapter).toContainText("Two crates in the schoolroom");
});

test.describe("Mara’s pocket ledger", () => {
  test.use({ viewport: { width: 390, height: 740 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  test("touch choices fit both narrow widths and context loss safely closes an open chapter", async ({ page }, info) => {
    await arrive(page);
    await reachDesk(page);
    await prompt(page, "Begin Mara’s Story").tap();
    const chapter = page.locator(".chapter-page");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 740 });
      await chapter.getByRole("radio", { name: /Keep the shop open/ }).tap();
      const commit = prompt(page, "Confirm decision");
      await commit.scrollIntoViewIfNeeded();
      await expect(commit).toBeInViewport({ ratio: 1 });
      await expect(chapter.getByRole("button", { name: "Close chapter and explore" })).toBeInViewport({ ratio: 1 });
      expect(await chapter.evaluate(el => el.clientWidth === el.scrollWidth)).toBe(true);
      await chapter.getByRole("heading").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("choice-" + width + ".png") });
    }
    await prompt(page, "Confirm decision").tap();
    await prompt(page, "Visit the Whispering Well").tap();
    await threshold(page, "courtyard");
    await prompt(page, "Examine the well").tap();
    await chapter.getByRole("radio", { name: /Open on fewer days/ }).tap();
    await prompt(page, "Confirm decision").tap();
    await expect(chapter).toContainText("A shorter week on the door");
    await prompt(page, "Fork at decision 2").tap();
    await chapter.getByRole("radio", { name: /Teach evening classes/ }).tap();
    await prompt(page, "Confirm decision").tap();
    await prompt(page, "Compare timelines").tap();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 740 });
      await chapter.locator(".mirror-differences dd").last().scrollIntoViewIfNeeded();
      const identities = chapter.locator(".mirror-identities");
      await expect(identities).toBeInViewport({ ratio: 1 });
      await expect(identities.locator("b")).toHaveText(["Lamplight after closing", "A shorter week on the door"]);
      expect(await chapter.locator("article").evaluate(el => el.clientWidth === el.scrollWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath("mirror-" + width + ".png") });
    }
    await page.locator(".hollow-viewport canvas").evaluate(el => {
      (el as HTMLCanvasElement).getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
    });
    await expect(page.getByTestId("imagine")).toHaveClass(/flat/);
    await expect(chapter).toHaveCount(0);
    await expect(page.getByTestId("whatif-input")).toBeEditable();
  });
});
