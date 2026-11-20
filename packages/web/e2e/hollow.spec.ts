import { expect, test, type Page } from "@playwright/test";

const LANDING = "/?preview=atlas&atlasDebug=1&atlasQuality=low";
const enter = (page: Page) => page.getByRole("button", { name: "Enter The Hollow" });
const entryLabel = (page: Page) => page.getByTestId("hollow-entry-label");
const leave = (page: Page) => page.getByRole("button", { name: "Return to Multiverse" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "The Hollow" });
const state = (page: Page) => page.evaluate(() => window.__rfAtlas?.stats().hollow);
const ready = (page: Page) => expect(dialog(page)).toHaveAttribute("data-phase", "exploring");
const well = (page: Page) => page.getByRole("button", { name: "Examine the well" });
const bell = (page: Page) => page.getByRole("button", { name: "Ring the tower bell" });

async function islandPoint(page: Page) {
  await enter(page).scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.__rfAtlas?.stats().settled)).toBe(true);
  const bounds = (await enter(page).boundingBox())!;
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function tapIsland(page: Page) {
  const point = await islandPoint(page);
  await page.touchscreen.tap(point.x, point.y);
}

async function lookBy(page: Page, x: number, y: number) {
  await page.mouse.move(620, 400);
  await page.mouse.down();
  await page.mouse.move(620 + x, 400 + y, { steps: 3 });
  await page.mouse.up();
}

async function approach(page: Page, prompt: ReturnType<typeof well>) {
  await page.keyboard.down("KeyW");
  try {
    await expect(prompt).toBeVisible({ timeout: 45_000 });
  } finally {
    await page.keyboard.up("KeyW");
  }
}

function observeEvent(page: Page, id: "well" | "bell") {
  return page.evaluate((id) => new Promise<{ vision: boolean; motes: number; angle: number; wave: number; bats: number; ghost: boolean }>((resolve) => {
    const seen = { vision: false, motes: 0, angle: 0, wave: 0, bats: 0, ghost: false };
    const start = performance.now();
    let active = false;
    function sample(now: number) {
      const world = window.__rfAtlas?.stats().hollow?.world;
      if (world?.event === id) {
        active = true;
        seen.vision ||= world.vision;
        seen.motes = Math.max(seen.motes, world.motes);
        seen.angle = Math.max(seen.angle, Math.abs(world.bellAngle));
        seen.wave = Math.max(seen.wave, world.waveRadius);
        seen.bats = Math.max(seen.bats, world.bats);
        seen.ghost ||= world.ghost;
      } else if (active || now - start > 18_000) {
        resolve(seen);
        return;
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }), id);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503,
    json: { ok: false, code: "no-key", message: "Planner unavailable in this browser test." },
  }));
});

test("the entire question field remains clickable across the entrance layout breakpoints", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING);
  const question = page.getByTestId("whatif-input");
  for (const width of [320, 390, 744, 760, 761, 768, 800, 960, 979, 980, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    await expect(enter(page)).toBeVisible();
    await expect(page.getByTestId("explore-possibilities")).toBeInViewport();
    await question.fill("The first line.\nThe second line.");
    const uncovered = await question.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return [0.02, 0.25, 0.5, 0.75, 0.98].every((x) => [0.02, 0.5, 0.98].every((y) =>
        document.elementFromPoint(rect.x + x * rect.width, rect.y + y * rect.height) === element));
    });
    expect(uncovered, `textarea hit targets at ${width}px`).toBe(true);
    if (width === 768) {
      expect(await question.evaluate((element) => document.elementFromPoint(609, 281) === element)).toBe(true);
    }
    await question.click({ position: { x: 2, y: 3 } });
    await expect(question).toBeFocused();
    expect(await question.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0);
    const box = (await question.boundingBox())!;
    await question.click({ position: { x: box.width - 3, y: box.height - 3 } });
    expect(await question.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(32);
    await page.getByTestId("explore-possibilities").focus();
    await page.keyboard.press("Tab");
    await expect(enter(page)).toBeFocused();
    await expect(entryLabel(page)).toBeVisible();
    await expect.poll(() => entryLabel(page).evaluate((element) => {
      const plaque = element.getBoundingClientRect();
      return [".whatif", ".hollow-secrets summary"].filter((selector) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return plaque.left < box.right && plaque.right > box.left && plaque.top < box.bottom && plaque.bottom > box.top;
      });
    }), { message: `plaque at ${width}px` }).toEqual([]);
    const plaque = (await entryLabel(page).boundingBox())!;
    expect(plaque.x).toBeGreaterThanOrEqual(0);
    expect(plaque.x + plaque.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(dialog(page)).toHaveCount(0);
  }
});

test("the city lights and plaque respond to keyboard focus without motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING);
  await expect(enter(page)).toBeVisible();
  await expect(entryLabel(page)).toBeHidden();
  await page.getByTestId("explore-possibilities").focus();
  await page.keyboard.press("Tab");
  await expect(enter(page)).toBeFocused();
  await expect(enter(page)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(entryLabel(page).getByText("Press Enter")).toBeVisible();
  await expect(entryLabel(page)).toHaveCSS("outline-style", "solid");
  await expect.poll(() => page.evaluate(() =>
    window.__rfAtlas?.stats().landing?.islands.find(({ id }) => id === "city")?.glow)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__rfAtlas?.stats().landing?.islands.find(({ id }) => id === "city")?.lift)).toBe(0);
  await page.keyboard.press("Space");
  await ready(page);
  await page.keyboard.press("Escape");
  await expect(enter(page)).toBeFocused();
});

test("the landing secrets can all be discovered once using only the keyboard", async ({ page }) => {
  await page.goto(LANDING);
  const summary = page.getByText("Find landing secrets", { exact: true });
  await expect(summary).toBeVisible();
  for (let i = 0; i < 12 && !await summary.evaluate((el) => el === document.activeElement); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  const discoveries = page.getByTestId("imagine-band").getByRole("status");
  for (const [index, name] of ["Awaken the city island", "Scatter the bats", "Light the pumpkin", "Invite the shy ghost", "Trace the moon"].entries()) {
    const button = page.getByRole("button", { name });
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await page.keyboard.press(index % 2 ? "Space" : "Enter");
    await expect(discoveries).toHaveText(`Secrets discovered · ${index + 1}/5`);
    await page.keyboard.press("Enter");
    await expect(button).toBeFocused();
    await expect(discoveries).toHaveText(`Secrets discovered · ${index + 1}/5`);
  }
  expect((await page.evaluate(() => window.__rfAtlas?.stats().landing?.discoveries))?.sort()).toEqual(
    ["Bat Whisperer", "Island Awakening", "Moon Magic", "Pumpkin Trick", "Shy Ghost"]);
});

test("the courtyard Escape hint describes the exit before any drag", async ({ page }) => {
  await page.goto(LANDING);
  await enter(page).press("Enter");
  await ready(page);
  const hint = dialog(page).locator(".hollow-guide");
  await expect(hint).toContainText("Esc to return to the Multiverse");
  await page.mouse.move(620, 440);
  await page.mouse.down();
  await expect(hint).toContainText("Esc to release look");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(hint).toContainText("Esc to return to the Multiverse");
  await page.mouse.up();
  await page.mouse.down();
  await expect(hint).toContainText("Esc to release look");
  await page.keyboard.down("Escape");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  await expect(hint).toContainText("Esc to return to the Multiverse");
  await page.mouse.up();
  await page.mouse.down();
  await expect(hint).toContainText("Esc to release look");
  await page.mouse.up();
  await expect(hint).toContainText("Esc to return to the Multiverse");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(enter(page)).toBeFocused();
});

test("flies toward the city, explores at eye level and lights the bookshop", async ({ page }) => {
  await page.goto(LANDING);
  await expect(enter(page)).toBeVisible();
  await expect(entryLabel(page)).toBeHidden();
  const island = await islandPoint(page);
  await page.mouse.move(island.x, island.y);
  await expect(entryLabel(page).getByText("Click to enter")).toBeVisible();
  await page.getByTestId("whatif-input").hover();
  await expect(entryLabel(page)).toBeHidden();
  await page.mouse.move(island.x, island.y);
  await expect(entryLabel(page)).toBeVisible();
  const path = page.evaluate(() => new Promise<number[][]>((resolve) => {
    const eyes: number[][] = [];
    const start = performance.now();
    function sample(now: number) {
      const hollow = window.__rfAtlas?.stats().hollow;
      if (hollow?.phase === "approach") eyes.push(hollow.approachEye);
      if (hollow?.phase === "exploring" || now - start > 20_000) resolve(eyes);
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  await page.mouse.click(island.x, island.y);
  await expect(leave(page)).toBeVisible();
  await ready(page);
  const eyes = await path;
  expect(eyes.length).toBeGreaterThan(1);
  expect(Math.hypot(...eyes.at(-1)!.map((axis, i) => axis - eyes[0]![i]!))).toBeGreaterThan(10);
  const initial = (await state(page))!.world!;
  expect(initial.position[1]).toBe(1.68);
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(page.locator(".hollow-viewport canvas")).toHaveCount(1);
  await expect(page.locator(".im-scene canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Listen at the bookshop" })).toHaveCount(0);
  const scroll = await page.evaluate(() => window.scrollY);
  await page.keyboard.down("ArrowUp");
  try {
    await expect(page.getByRole("button", { name: "Listen at the bookshop" })).toBeVisible();
  } finally {
    await page.keyboard.up("ArrowUp");
  }
  await page.getByRole("button", { name: "Listen at the bookshop" }).click();
  await expect.poll(async () => (await state(page))?.world?.bookshopLight).toBe(1);
  await expect(dialog(page).getByRole("status")).toHaveText("A violet light stirs between the shelves.");

  await page.keyboard.down("ArrowUp");
  try {
    // Keep walking into the storefront to exercise collision with real level geometry.
    await expect.poll(async () => (await state(page))?.world?.position[2]).toBeLessThan(-6.5);
  } finally {
    await page.keyboard.up("ArrowUp");
  }
  expect((await state(page))!.world!.position[2]).toBeGreaterThan(-6.74);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);

  await page.mouse.move(620, 440);
  await page.mouse.down();
  await page.mouse.move(690, 474, { steps: 4 });
  await expect.poll(async () => (await state(page))?.looking).toBe(true);
  await expect(dialog(page).locator(".hollow-guide")).toContainText("Esc to release look");
  expect((await state(page))!.world!.yaw).not.toBe(initial.yaw);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await state(page))?.looking).toBe(false);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator(".hollow-guide")).toContainText("Esc to return to the Multiverse");
  await page.mouse.up();
  await leave(page).click();
  await expect(enter(page)).toBeFocused();
});

test("the well respects range and text focus, then plays and replays one vision", async ({ page }) => {
  await page.goto(LANDING);
  await expect(enter(page)).toBeVisible();
  // The landing uploads six WebP textures asynchronously. Sample the settled landing on both sides of the visit.
  await page.waitForLoadState("networkidle");
  await expect.poll(() => page.evaluate(() => window.__rfAtlas?.stats().settled)).toBe(true);
  const resources = () => page.evaluate(() => {
    const { geometries, textures } = window.__rfAtlas!.stats();
    return { geometries, textures };
  });
  const baseline = await resources();
  await enter(page).press("Enter");
  await ready(page);
  await expect(well(page)).toHaveCount(0);
  await page.keyboard.press("f");
  expect((await state(page))?.world?.event).toBeNull();
  await lookBy(page, -84, -48);
  await approach(page, well(page));
  expect((await state(page))?.world?.wellGlow).toBeGreaterThan(0);
  await dialog(page).evaluate((element) => {
    const field = document.createElement("input");
    field.id = "hollow-test-field";
    element.append(field);
    field.focus();
  });
  await page.keyboard.type("f");
  await expect(page.locator("#hollow-test-field")).toHaveValue("f");
  expect((await state(page))?.world?.event).toBeNull();
  await page.locator("#hollow-test-field").evaluate((element) => element.remove());

  const event = observeEvent(page, "well");
  await page.keyboard.press("f");
  await expect(dialog(page).getByRole("status")).toContainText("one road becomes three");
  await expect(well(page)).toHaveCount(0);
  await page.keyboard.press("f");
  expect(await event).toMatchObject({ vision: true, motes: 16 });
  await expect(well(page)).toBeVisible();
  expect((await state(page))?.world).toMatchObject({ event: null, vision: false, motes: 0 });
  await well(page).click();
  await expect.poll(async () => (await state(page))?.world?.event).toBe("well");
  await leave(page).click();
  await expect(enter(page)).toBeFocused();
  expect(await state(page)).toBeNull();
  expect(await resources()).toEqual(baseline);
});

test("the bell pull animates the bell, light, bats and ghost, then restores the square", async ({ page }) => {
  await page.goto(LANDING);
  await enter(page).press("Enter");
  await ready(page);
  await expect(bell(page)).toHaveCount(0);
  await lookBy(page, 44, 0);
  await approach(page, bell(page));
  const pose = (await state(page))!.world!;
  expect(pose.position[2]).toBeGreaterThan(1);
  const event = observeEvent(page, "bell");
  await page.keyboard.press("f");
  await expect(dialog(page).getByRole("status")).toContainText("In the belfry");
  expect((await state(page))?.world).toMatchObject({ position: pose.position, yaw: pose.yaw, pitch: pose.pitch });
  const seen = await event;
  expect(seen).toMatchObject({ bats: 4, ghost: true });
  expect(seen.angle).toBeGreaterThan(0.2);
  expect(seen.wave).toBeGreaterThan(19);
  await expect(bell(page)).toBeVisible();
  expect((await state(page))?.world).toMatchObject({ event: null, bellAngle: 0, waveRadius: 0, bats: 0, ghost: false });
});

test("interrupts and repeats visits with one canvas, releases resources and preserves question and secrets", async ({ page }) => {
  await page.addInitScript(() => {
    const original = EventTarget.prototype.addEventListener;
    const signals = new Set<AbortSignal>();
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this === window && type === "keydown" && typeof options === "object" && options.signal) signals.add(options.signal);
      return original.call(this, type, listener, options);
    };
    Object.assign(window, { hollowSignals: signals });
  });
  const activeListeners = () => page.evaluate(() =>
    [...(window as unknown as { hollowSignals: Set<AbortSignal> }).hollowSignals].filter((signal) => !signal.aborted).length);
  await page.goto(LANDING);
  await expect(enter(page)).toBeVisible();
  const question = page.getByTestId("whatif-input");
  await question.fill("What if I ran a bookshop?");
  const canvas = await page.locator(".im-scene canvas").elementHandle();
  // The island is still moving into position when the entrance first appears.
  await expect.poll(async () => {
    const point = await page.evaluate(() => {
      const city = window.__rfAtlas!.stats().landing!.islands.find(({ id }) => id === "city")!.point!;
      const area = document.querySelector(".im-scene")!.getBoundingClientRect();
      return { x: area.x + city[0]! * area.width, y: area.y + city[1]! * area.height };
    });
    await page.mouse.move(point.x, point.y);
    return page.evaluate(() => window.__rfAtlas!.stats().landing!.hover);
  }).toBe("city");
  await page.getByText("Find landing secrets", { exact: true }).click();
  await page.getByRole("button", { name: "Awaken the city island" }).click();
  await page.getByText("Find landing secrets", { exact: true }).click();
  await expect(page.getByTestId("imagine-band").getByRole("status")).toHaveText("Secrets discovered · 1/5");
  const baseline = await page.evaluate(() => {
    const { geometries, textures } = window.__rfAtlas!.stats();
    return { geometries, textures };
  });
  const cancellation = page.waitForFunction(() => {
    if (window.__rfAtlas?.stats().hollow?.phase !== "approach") return false;
    document.querySelector<HTMLButtonElement>(".hollow-return")!.click();
    return true;
  });
  await enter(page).press("Enter");
  await cancellation;
  await expect(dialog(page)).toHaveCount(0);
  expect(await activeListeners()).toBe(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (let cycle = 0; cycle < 3; cycle++) {
    await enter(page).press("Enter");
    await ready(page);
    expect((await state(page))!.world!.bookshopLight).toBe(0);
    expect(await activeListeners()).toBe(1);
    expect(await canvas!.evaluate((element) => element.parentElement?.className)).toBe("hollow-viewport");
    expect(await page.evaluate(() => window.__rfAtlas!.stats().drawCalls)).toBeLessThanOrEqual(10);
    await leave(page).click();
    await expect(enter(page)).toBeFocused();
    expect(await activeListeners()).toBe(0);
    expect(await canvas!.evaluate((element) => element.parentElement?.className)).toBe("im-scene");
    expect(await state(page)).toBeNull();
    expect(await page.evaluate(() => {
      const { geometries, textures } = window.__rfAtlas!.stats();
      return { geometries, textures };
    })).toEqual(baseline);
  }
  await expect(question).toHaveValue("What if I ran a bookshop?");
  await expect(page.getByTestId("imagine-band").getByRole("status")).toHaveText("Secrets discovered · 1/5");
  const request = page.waitForRequest((req) => req.url().endsWith("/api/plan") && req.method() === "POST");
  await page.getByTestId("explore-possibilities").click();
  expect((await request).postDataJSON()).toMatchObject({ question: "What if I ran a bookshop?" });
});

test.describe("touch travel", () => {
  test.use({ viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });

  test("fits a narrow screen and offers touch walk and look with an immediate arrival", async ({ page }) => {
    await page.goto(LANDING);
    await expect(page.getByTestId("whatif-input")).toBeVisible();
    await expect(enter(page)).toBeVisible();
    const motionPhases = await page.locator(".hollow-dialog").evaluateHandle((element) => {
      const phases: string[] = [];
      new MutationObserver((mutations) => {
        for (const mutation of mutations) if (mutation.oldValue) phases.push(mutation.oldValue);
      }).observe(element, { attributeFilter: ["data-phase"], attributeOldValue: true });
      return phases;
    });
    await tapIsland(page);
    await expect(entryLabel(page).getByText("Tap to enter")).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await tapIsland(page);
    await ready(page);
    expect(await motionPhases.jsonValue()).not.toContain("approach");
    expect(await motionPhases.jsonValue()).not.toContain("reveal");
    const before = (await state(page))!.world!;
    const after = await dialog(page).boundingBox();
    expect(after).toMatchObject({ x: 0, y: 0, width: 320, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(leave(page)).toBeInViewport();
    await page.getByRole("button", { name: "Walk forward" }).tap();
    await expect.poll(async () => (await state(page))?.world?.position[2]).toBeLessThan(before.position[2]!);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 100, y: 290 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 170, y: 320 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => (await state(page))?.world?.yaw).not.toBe(before.yaw);
    await leave(page).tap();
    await expect(enter(page)).toBeVisible();
  });

  test("a tap outside the island clears the entry preview at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(LANDING);
    await tapIsland(page);
    await expect(entryLabel(page).getByText("Tap to enter")).toBeVisible();
    await page.getByTestId("whatif-input").tap();
    await expect(entryLabel(page)).toBeHidden();
    await tapIsland(page);
    await expect(entryLabel(page).getByText("Tap to enter")).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await tapIsland(page);
    await ready(page);
  });

  test("touch activates the well and reduced motion shows a still vision", async ({ page }) => {
    await page.goto(LANDING);
    await tapIsland(page);
    await expect(entryLabel(page).getByText("Tap to enter")).toBeVisible();
    await tapIsland(page);
    await ready(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 174, y: 310 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 90, y: 262 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => (await state(page))?.world?.yaw).toBeGreaterThan(0.47);
    const forward = (await page.getByRole("button", { name: "Walk forward" }).boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
      { x: forward.x + forward.width / 2, y: forward.y + forward.height / 2 },
    ] });
    try {
      await expect(well(page)).toBeVisible({ timeout: 40_000 });
    } finally {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    const event = observeEvent(page, "well");
    await well(page).tap();
    await expect(dialog(page).getByRole("status")).toContainText("one road becomes three");
    expect(await event).toMatchObject({ vision: true, motes: 0 });
    await leave(page).tap();
    await expect(enter(page)).toBeVisible();
  });
});

test("the painted landing replaces a lost exploration context and keeps the question", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING);
  const question = page.getByTestId("whatif-input");
  await question.fill("A question to keep");
  await enter(page).press("Enter");
  await ready(page);
  await page.locator(".hollow-viewport canvas").evaluate((element) => {
    (element as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.getByTestId("imagine")).toHaveClass(/flat/);
  await expect(dialog(page)).toHaveCount(0);
  await expect(enter(page)).toHaveCount(0);
  await expect(question).toHaveValue("A question to keep");
});

test("the courtyard entry is absent without WebGL and outside the existing preview", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("imagine")).toHaveClass(/flat/);
  await expect(enter(page)).toHaveCount(0);
  await page.addInitScript(() => {
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type.includes("webgl") ? null : Reflect.apply(context, this, [type, ...args]);
    } as typeof context;
  });
  await page.goto(LANDING);
  await expect(page.getByTestId("imagine")).toHaveClass(/flat/);
  await expect(enter(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "What if" })).toBeVisible();
});
