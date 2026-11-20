import { expect, test, type Page } from "@playwright/test";
import type { AtlasScene } from "../src/atlas/scene/AtlasScene";

const LANDING = "/?preview=atlas&atlasDebug=1&atlasQuality=low";
const VIEW = { width: 1440, height: 900 };
const SHORT = { timeout: 5_000 };
type Landing = NonNullable<ReturnType<AtlasScene["stats"]>["landing"]>;

async function state(page: Page): Promise<Landing> {
  return (await page.evaluate(() => window.__rfAtlas?.stats().landing))!;
}

async function open(page: Page, quality = "low") {
  await page.goto(LANDING.replace("atlasQuality=low", `atlasQuality=${quality}`));
  await expect(page.locator(".im-scene canvas")).toHaveCSS("opacity", "1");
  await expect.poll(() => page.evaluate(() => window.__rfAtlas?.stats().settled)).toBe(true);
}

async function coordinate(page: Page, fraction: number[], dx = 0, dy = 0) {
  const box = (await page.getByTestId("imagine-world").boundingBox())!;
  return { x: box.x + fraction[0]! * box.width + dx, y: box.y + fraction[1]! * box.height + dy };
}

async function clickProp(page: Page, prop: "portal" | "pumpkin" | "moon", touch = false) {
  const { x, y } = await coordinate(page, (await state(page)).points[prop]!);
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function clickIsland(page: Page, id: string, touch = false) {
  const island = (await state(page)).islands.find((item) => item.id === id)!;
  const { x, y } = await coordinate(page, island.point);
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function awakenCity(page: Page) {
  const secrets = page.getByText("Find landing secrets", { exact: true });
  await secrets.click();
  await page.getByRole("button", { name: "Awaken the city island" }).click();
  await secrets.click();
}

const discoveries = (page: Page) => page.getByTestId("imagine-band").getByRole("status");

test.beforeEach(async ({ page }) => {
  // Keep question-entry smoke tests independent of service credentials and the network.
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503,
    json: { ok: false, code: "no-key", message: "Planner unavailable in the browser test." },
  }));
});

test("island shimmers, lifts and tilts, sweeps with light on activation, and ignores a drag", async ({ page }) => {
  await page.setViewportSize(VIEW);
  await open(page);
  const city = (await state(page)).islands.find(({ id }) => id === "city")!;
  const { x, y } = await coordinate(page, city.point, 20, 6);
  await page.mouse.move(x, y);
  await expect.poll(async () => (await state(page)).islands.find(({ id }) => id === "city")!.lift, SHORT).toBeGreaterThan(0.45);
  const [, roll] = (await state(page)).islands.find(({ id }) => id === "city")!.tilt;
  expect(roll).toBeLessThan(-0.004);
  expect((await state(page)).islands.find(({ id }) => id === "city")!.shimmer).toBeGreaterThan(0.3);

  const input = page.getByTestId("whatif-input");
  await input.hover();
  await expect.poll(async () => (await state(page)).islands.every(({ lift, tilt }) => lift === 0 && tilt.every((axis) => axis === 0)), SHORT).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y, { steps: 3 });
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.up();
  await input.click();
  await expect(input).toBeFocused();
  expect((await state(page)).lastActivation).toBeNull();
  await expect(discoveries(page)).toBeEmpty();
  await Promise.all([
    page.waitForFunction(() => (window.__rfAtlas?.stats().landing?.islands.find(({ id }) => id === "energy")?.sweep ?? 0) > 0.3, null, SHORT),
    clickIsland(page, "energy"),
  ]);
  await expect(discoveries(page)).toHaveText("Secrets discovered · 1/5");
  await expect(discoveries(page)).toHaveCSS("opacity", "1");
  await input.click();
  await expect(discoveries(page)).toHaveCSS("opacity", "0.58");
  await input.press("Tab");
  await expect(page.getByTestId("explore-possibilities")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("whatif-help")).toContainText("Type a situation first");
});

test("the characters, lanterns and moon react and all five secrets are counted once", async ({ page }) => {
  await page.setViewportSize(VIEW);
  await open(page);
  const candle = await coordinate(page, (await state(page)).points.candles!, -24);
  await page.mouse.move(candle.x, candle.y);
  await expect.poll(async () => (await state(page)).wind, SHORT).toBeGreaterThan(0.15);

  await Promise.all([
    page.waitForFunction(() => {
      const scene = window.__rfAtlas?.stats().landing;
      return (scene?.pumpkinGlow ?? 0) > 1.8 && (scene?.pumpkinExpression ?? 0) > 0;
    }, null, SHORT),
    clickProp(page, "pumpkin"),
  ]);
  await expect(discoveries(page)).toHaveText("Secrets discovered · 1/5");
  await clickProp(page, "pumpkin");
  await expect(discoveries(page)).toHaveText("Secrets discovered · 1/5");
  await Promise.all([
    page.waitForFunction(() => window.__rfAtlas?.stats().landing?.ghost, null, SHORT),
    clickProp(page, "pumpkin"),
  ]);
  const ghost = await coordinate(page, (await state(page)).points.ghost!, 24);
  await Promise.all([
    page.waitForFunction(() => Math.abs(window.__rfAtlas?.stats().landing?.ghostLean ?? 0) > 0.08, null, SHORT),
    page.mouse.move(ghost.x, ghost.y),
  ]);
  await expect(discoveries(page)).toHaveText("Secrets discovered · 2/5");
  await expect.poll(async () => (await state(page)).ghost, SHORT).toBe(false);

  const portal = await coordinate(page, (await state(page)).points.portal!);
  await page.mouse.move(portal.x, portal.y);
  await expect.poll(async () => (await state(page)).portalGlow, SHORT).toBeGreaterThan(0.48);
  await Promise.all([
    page.waitForFunction(() => (window.__rfAtlas?.stats().landing?.portalGlow ?? 0) > 0.6, null, SHORT),
    clickProp(page, "portal"),
  ]);
  await expect(discoveries(page)).toHaveText("Secrets discovered · 3/5");

  const moon = await coordinate(page, (await state(page)).points.moon!);
  await page.mouse.move(moon.x, moon.y);
  await expect.poll(async () => (await state(page)).moonGlow, SHORT).toBeGreaterThan(1.35);
  await Promise.all([
    page.waitForFunction(() => window.__rfAtlas?.stats().landing?.star, null, SHORT),
    clickProp(page, "moon"),
  ]);
  await expect(discoveries(page)).toHaveText("Secrets discovered · 4/5");
  await clickProp(page, "moon");
  await expect(discoveries(page)).toHaveText("Secrets discovered · 4/5");

  await page.mouse.move(20, 400);
  const before = (await state(page)).points.bats;
  const i = before.findIndex(([x, y]) => x! > 0.03 && x! < 0.97 && y! > 0.03 && y! < 0.3);
  expect(i).toBeGreaterThanOrEqual(0);
  const bat = await coordinate(page, before[i]!);
  await page.mouse.move(bat.x + 5, bat.y);
  await expect.poll(async () => (await state(page)).points.bats[i]![0], SHORT).toBeLessThan(before[i]![0]! - 0.008);
  await page.mouse.move(20, 400);
  await expect.poll(async () => (await state(page)).points.bats[i]![0], SHORT).toBeCloseTo(before[i]![0]!, 3);
  await Promise.all([
    page.waitForFunction(({ index, y }) => (window.__rfAtlas?.stats().landing?.points.bats[index]?.[1] ?? 1) < y, { index: i, y: before[i]![1]! - 0.02 }, SHORT),
    page.mouse.click(bat.x, bat.y),
  ]);
  await expect.poll(async () => (await state(page)).lastActivation, SHORT).toBe("@bat");
  await expect(discoveries(page)).toHaveText("Secrets discovered · 5/5");
  expect((await state(page)).discoveries).toEqual(["Pumpkin Trick", "Shy Ghost", "Island Awakening", "Moon Magic", "Bat Whisperer"]);
  await page.mouse.move(20, 400);
  await expect.poll(async () => (await state(page)).points.bats.every(([x, y], j) =>
    Math.hypot(x! - before[j]![0]!, y! - before[j]![1]!) < 0.004,
  ), SHORT).toBe(true);
});

test("three distinct islands awaken the portal once, and later triples still trace a constellation", async ({ page }) => {
  await page.setViewportSize(VIEW);
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /THREE\.WebGLProgram|Shader Error/.test(message.text())) shaderErrors.push(message.text());
  });
  await open(page);
  await clickIsland(page, "now");
  await expect.poll(async () => (await state(page)).lastActivation, SHORT).toBe("now");
  await awakenCity(page);
  await expect.poll(async () => (await state(page)).lastActivation, SHORT).toBe("city");
  await awakenCity(page);
  expect((await state(page)).finalePlayed).toBe(false);
  await expect(discoveries(page)).toHaveText("Secrets discovered · 1/5");

  const [finale] = await Promise.all([
    page.evaluate(() => new Promise<{ stages: string[]; energy: boolean; glow: number; ghost: boolean }>((resolve) => {
      const start = performance.now();
      const stages = new Set<string>();
      let energy = false, glow = 0, ghost = false;
      const sample = (time: number) => {
        const current = window.__rfAtlas?.stats().landing;
        if (current?.finaleStage) {
          stages.add(current.finaleStage);
          energy ||= current.energy;
          glow = Math.max(glow, current.doorway);
          ghost ||= current.finaleStage === "crossing" && current.ghost;
        }
        if ((stages.size && !current?.finaleStage) || time - start > 14_000) resolve({ stages: [...stages], energy, glow, ghost });
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })),
    clickIsland(page, "energy"),
  ]);
  expect(finale.stages).toEqual(["constellation", "energy", "doorway", "crossing", "calm"]);
  expect(finale.energy).toBe(true);
  expect(finale.glow).toBeGreaterThan(0.7);
  expect(finale.ghost).toBe(true);
  await expect(discoveries(page)).toHaveText("Secrets discovered · 2/5");
  expect((await state(page)).doorway).toBe(0);
  expect((await state(page)).ghost).toBe(false);

  await clickIsland(page, "now");
  await awakenCity(page);
  await Promise.all([
    page.waitForFunction(() => window.__rfAtlas?.stats().landing?.constellation, null, SHORT),
    clickIsland(page, "energy"),
  ]);
  expect((await state(page)).finaleStage).toBeNull();
  expect((await state(page)).energy).toBe(false);
  expect(shaderErrors).toEqual([]);
});

test("high quality animates islands and the existing bat batch at rest", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await open(page, "high");
  const before = await state(page);
  expect(before.points.bats).toHaveLength(3);
  await expect.poll(async () => {
    const latest = await state(page);
    return Math.abs(latest.islands[0]!.point[1]! - before.islands[0]!.point[1]!);
  }, SHORT).toBeGreaterThan(0.0002);
  await expect.poll(async () => {
    const latest = await state(page);
    return latest.points.bats.some(([x, y], i) => Math.hypot(x! - before.points.bats[i]![0]!, y! - before.points.bats[i]![1]!) > 0.002);
  }, SHORT).toBe(true);
});

test.describe("touch landing", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const width of [320, 390]) {
    test(`at ${width}px the portal and moon respond to taps and the question flow remains reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await open(page);
      const input = page.getByTestId("whatif-input");
      await expect(input).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect((await state(page)).points.pumpkin).toBeNull();
      await clickProp(page, "portal", true);
      await expect.poll(async () => (await state(page)).lastActivation, SHORT).toBe("@portal");
      await clickProp(page, "portal", true);
      await expect.poll(async () => (await state(page)).ghost, SHORT).toBe(true);
      await clickProp(page, "moon", true);
      await expect.poll(async () => (await state(page)).star, SHORT).toBe(true);
      await expect(discoveries(page)).toHaveText("Secrets discovered · 3/5");
      await clickIsland(page, "city", true);
      await Promise.all([
        page.waitForFunction(() => window.__rfAtlas?.stats().landing?.constellation, null, SHORT),
        clickIsland(page, "energy", true),
      ]);

      await input.tap();
      await input.fill("What if I ran a bookshop?");
      const request = page.waitForRequest((req) => req.url().endsWith("/api/plan") && req.method() === "POST");
      await page.getByTestId("explore-possibilities").tap();
      expect((await request).postDataJSON()).toMatchObject({ question: "What if I ran a bookshop?" });
    });
  }
});

test("reduced motion updates live and returning from Explore installs a fresh listener set", async ({ page }) => {
  await page.setViewportSize(VIEW);
  await page.addInitScript(() => {
    const signals = new Set<AbortSignal>();
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if (type === "pointerdown" && this === window && typeof options === "object" && options.capture && options.passive && options.signal) signals.add(options.signal);
      return add.call(this, type, callback, options);
    };
    Object.assign(window, { landingSignals: signals });
  });
  const listeners = () => page.evaluate(() => Array.from((window as unknown as { landingSignals: Set<AbortSignal> }).landingSignals, ({ aborted }) => aborted));
  await open(page);
  expect((await listeners()).filter((aborted) => !aborted)).toHaveLength(1);
  await clickProp(page, "portal");
  await expect.poll(async () => (await state(page)).portalGlow, SHORT).toBeGreaterThan(0.56);
  await awakenCity(page);
  await clickIsland(page, "energy");
  await expect.poll(async () => (await state(page)).finalePlayed, SHORT).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await state(page)).motion, SHORT).toBe(false);
  expect((await state(page)).portalGlow).toBe(0.42);
  expect((await state(page)).finaleStage).toBeNull();
  expect((await state(page)).energy).toBe(false);
  await clickProp(page, "moon");
  await expect.poll(async () => (await state(page)).star, SHORT).toBe(false);
  await expect.poll(async () => (await state(page)).islands.every(({ lift, tilt }) => lift === 0 && tilt.every((axis) => axis === 0))).toBe(true);

  await page.getByTestId("example-solar").click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  await expect(page.getByTestId("imagine-world")).toHaveCount(0);
  expect((await listeners()).every(Boolean)).toBe(true);
  expect(await state(page)).toBeUndefined();
  await page.getByTestId("home").click();
  await expect(page.locator(".im-scene canvas")).toHaveCSS("opacity", "1");
  expect((await listeners()).filter((aborted) => !aborted)).toHaveLength(1);
  expect((await state(page)).lastActivation).toBeNull();
  expect((await state(page)).finalePlayed).toBe(false);
  await expect(discoveries(page)).toBeEmpty();
});

test("a lost WebGL context falls back and removes the landing scene", async ({ page }) => {
  await open(page);
  await page.locator(".im-scene canvas").evaluate((canvas) => {
    (canvas as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.getByTestId("imagine")).toHaveClass(/flat/);
  await expect(page.getByTestId("imagine-world")).toHaveCount(0);
  await expect(discoveries(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__rfAtlas)).toBeUndefined();
  await page.getByTestId("whatif-input").fill("What if we switched to solar?");
  await expect(page.getByTestId("whatif-input")).toHaveValue("What if we switched to solar?");
});

test("the painted fallback and accessible question work without WebGL from the start", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl") || type === "experimental-webgl") return null;
      return Reflect.apply(original, this, [type, ...rest]);
    } as typeof original;
  });
  await page.goto(LANDING);
  await expect(page.getByTestId("imagine")).toHaveClass(/flat/);
  await expect(page.locator(".im-world .motif")).toBeVisible();
  await expect(page.getByTestId("imagine-world")).toHaveCount(0);
  await expect(discoveries(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "What if" })).toBeVisible();
});
