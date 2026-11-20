/**
 * Performance measurements for the 3D Explore preview. Not part of the normal test run: it runs only with
 * RF_ATLAS_PERF=1, and writes what it measured (nothing else) to docs/validation/atlas-3d/performance-<label>.json and
 * .md. Label: RF_ATLAS_PERF_LABEL (default "headless"); run with `--headed` for a visible browser window.
 *
 *   RF_ATLAS_PERF=1 npx playwright test e2e/atlas-perf.spec.ts
 *   RF_ATLAS_PERF=1 RF_ATLAS_PERF_LABEL=headed npx playwright test e2e/atlas-perf.spec.ts --headed
 *
 * Frame times are the intervals between animation frames, which the browser caps at the display rate (60 Hz here),
 * so a 16.7 ms median means "kept up", not "took 16.7 ms". CPU time is the JavaScript time per frame (scene update and
 * draw-call submission), not GPU time. One machine, one browser: this is not a claim about other devices.
 */
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { evidence, GPU, guard, settle, stats } from "./atlas-helpers";

test.skip(process.env.RF_ATLAS_PERF !== "1", "Set RF_ATLAS_PERF=1 to measure.");
test.use({ launchOptions: { args: GPU } });
const LABEL = process.env.RF_ATLAS_PERF_LABEL ?? "headless";

type Row = Record<string, unknown>;
const rows: Row[] = [];

async function measure(page: Page, scenario: string, ms: number, act?: () => Promise<void>) {
  await page.evaluate(() => window.__rfAtlas?.reset());
  const r0 = (await stats(page)) as unknown as { renders: number };
  if (act) await act();
  else await page.waitForTimeout(ms);
  const s = (await page.evaluate(() => window.__rfAtlas?.stats())) as unknown as Record<string, unknown> & { renders: number; size: number[]; model: unknown };
  const mem = await page.evaluate(() => window.__rfAtlas?.memory());
  const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  const row: Row = {
    scenario, seconds: ms / 1000, viewport: s.size.join("×"), quality: s.quality, pixelRatio: +Number(s.pixelRatio).toFixed(2),
    frames: s.frames, drawnFrames: s.renders - r0.renders,
    medianFrameMs: s.medianFrameMs, p95FrameMs: s.p95FrameMs, maxFrameMs: s.maxFrameMs, framesOver50ms: s.longFrames,
    medianCpuMs: s.medianCpuMs, p95CpuMs: s.p95CpuMs,
    drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs,
    gpuEstimate: mem, jsHeapMB: heap === null ? null : +(heap / 1e6).toFixed(1), gpu: s.gpu,
  };
  rows.push(row);
  return row;
}

test("measure the preview on this machine", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Load: from choosing the example to the London model drawn (download, Draco decode, parse, shader compile).
  await page.goto("/?preview=atlas&atlasDebug=1");
  const t0 = Date.now();
  await page.getByTestId("example-move-city").click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  const tAtlas = Date.now() - t0;
  await expect.poll(async () => (await stats(page))?.model.state, { timeout: 60_000, intervals: [100] }).toBe("ready");
  const tModel = Date.now() - t0;
  const glb = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("london_island")).map((e) => ({ bytes: (e as PerformanceResourceTiming).encodedBodySize, ms: Math.round(e.duration) })));
  await settle(page);
  // Selecting the London path builds its full copy; the time to submit its first frame (CPU side) is recorded.
  await page.getByTestId("atlas-down").click();
  await settle(page);
  const s0 = (await page.evaluate(() => window.__rfAtlas?.stats())) as unknown as { londonFirstFrameMs: number | null; model: { ms: number } };
  const load = { openTo3dMs: tAtlas, openToLondonReadyMs: tModel, loaderMs: s0.model.ms, glb, firstLondonFrameMs: s0.londonFirstFrameMs };
  await measure(page, "London in focus, idle", 5000);
  await measure(page, "moving between futures (6 transitions)", 0, async () => {
    for (const id of ["atlas-down", "atlas-up", "atlas-up", "atlas-down", "atlas-overview", "atlas-focus"]) {
      await page.getByTestId(id).click();
      await page.waitForTimeout(1600);
    }
  });
  await page.getByTestId("atlas-overview").click();
  await settle(page);
  await measure(page, "overview, idle", 4000);
  await page.getByTestId("atlas-focus").click();
  await page.getByTestId("home").click();
  await page.getByTestId("example-solar").click();
  await settle(page);
  await measure(page, "solar (open landscapes only), idle", 5000);

  // Forced low quality: no shadows, pixel ratio 1, lighter London copies, no idle animation (idle frames not redrawn).
  const low = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await low.goto("/?preview=atlas&atlasDebug=1&atlasQuality=low");
  await low.getByTestId("example-move-city").click();
  await expect.poll(async () => (await stats(low))?.model.state, { timeout: 60_000 }).toBe("ready");
  await low.getByTestId("atlas-down").click();
  await settle(low);
  await measure(low, "low quality, London in focus, idle", 5000);
  await low.close();

  // A phone-sized viewport with a 3x screen (emulated on this machine: not a phone GPU).
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  await phone.goto("/?preview=atlas&atlasDebug=1");
  await phone.getByTestId("example-move-city").click();
  await expect.poll(async () => (await stats(phone))?.model.state, { timeout: 60_000 }).toBe("ready");
  await phone.getByTestId("atlas-down").click();
  await settle(phone);
  await measure(phone, "390×844 at 3× (emulated), London in focus, idle", 5000);
  await ctx.close();

  expect(g.api).toEqual([]);
  const out = { label: LABEL, browser: browser.version(), measuredAt: new Date().toISOString(), load, rows };
  writeFileSync(`${evidence}performance-${LABEL}.json`, JSON.stringify(out, null, 2));
  const md = [
    `# 3D Explore preview: measured performance (${LABEL})`,
    "",
    `Generated by e2e/atlas-perf.spec.ts on ${out.measuredAt.slice(0, 16).replace("T", " ")} UTC. Chromium ${out.browser}, GPU: ${String(rows[0]?.gpu ?? "")}.`,
    "Frame intervals are capped by the display rate (60 Hz): 16.7 ms means the browser kept up. CPU is JavaScript time per frame, not GPU time.",
    "One machine and one browser: not a claim about other devices. Phone row: a phone-sized viewport emulated on this machine.",
    "",
    "## Loading the London model",
    "",
    `- Example chosen to 3D view on screen: ${load.openTo3dMs} ms`,
    `- Example chosen to London model ready (download, Draco decode, parse, shader compile): ${load.openToLondonReadyMs} ms (loader: ${load.loaderMs} ms)`,
    `- GLB transfer: ${load.glb.map((x) => `${(x.bytes / 1e6).toFixed(2)} MB in ${x.ms} ms (local server)`).join("; ")}`,
    `- First frame with the full model: ${load.firstLondonFrameMs === null ? "n/a" : `${Math.round(load.firstLondonFrameMs)} ms`}`,
    "",
    "## Frames",
    "",
    "| Scenario | Quality | Frames (drawn) | Median / p95 / max frame ms | Frames over 50 ms | Median / p95 CPU ms | Draw calls | Triangles | GPU estimate (geometry + textures) | JS heap |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => {
      const m = r.gpuEstimate as { geometryMB: number; textureMB: number; shadowMB: number; framebufferMB: number } | undefined;
      return `| ${r.scenario} (${r.viewport}, DPR ${r.pixelRatio}) | ${r.quality} | ${r.frames} (${r.drawnFrames}) | ${r.medianFrameMs} / ${r.p95FrameMs} / ${r.maxFrameMs} | ${r.framesOver50ms} | ${r.medianCpuMs} / ${r.p95CpuMs} | ${r.drawCalls} | ${r.triangles} | ${m ? `${m.geometryMB} + ${m.textureMB} MB (+ shadow ${m.shadowMB}, frame ${m.framebufferMB})` : "n/a"} | ${r.jsHeapMB ?? "n/a"} MB |`;
    }),
    "",
  ].join("\n");
  writeFileSync(`${evidence}performance-${LABEL}.md`, md);
});
