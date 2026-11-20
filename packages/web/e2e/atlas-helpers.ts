/** Shared helpers for the 3D Explore preview specs (atlas*.spec.ts). */
import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const shots = fileURLToPath(new URL("../../../docs/validation/screenshots/atlas-3d/", import.meta.url));
export const evidence = fileURLToPath(new URL("../../../docs/validation/atlas-3d/", import.meta.url));
mkdirSync(shots, { recursive: true });
mkdirSync(evidence, { recursive: true });
/** Run Chromium on the machine GPU (ANGLE/D3D11). Without these flags headless Chromium uses SwiftShader. */
export const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
export const PREVIEW = "/?preview=atlas&atlasDebug=1";
/**
 * A file itself being downloaded. In development, Vite also serves a small module for every `?url` import that only
 * names the file (its address has a query); those are not downloads of the file.
 */
const isDownloadOf = (u: string | URL, part: string) => {
  const url = typeof u === "string" ? new URL(u) : u;
  return url.pathname.includes(part) && url.search === "";
};
export const isLondonDownload = (u: string | URL) => isDownloadOf(u, "london_island") && (typeof u === "string" ? new URL(u) : u).pathname.endsWith(".glb");
export const isDracoDownload = (u: string | URL) => isDownloadOf(u, "draco_");

export type Stats = {
  frames: number; settled: boolean; quality: string; model: { state: string }; gpu: string;
  universe: string;
  islands: { id: string; visual: string | null; family: string; props: string[]; hypothetical: boolean; visible: boolean }[];
};
export const stats = (page: Page) => page.evaluate(() => (window as unknown as { __rfAtlas?: { stats: () => unknown } }).__rfAtlas?.stats() as Stats | undefined);

/** Refuse and record every /api request; record every request that leaves this server. */
export async function guard(page: Page) {
  const api: string[] = [];
  const foreign: string[] = [];
  const all: string[] = [];
  page.on("request", (r) => {
    all.push(r.url());
    if (!r.url().startsWith("http://localhost:5179/") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) foreign.push(r.url());
  });
  await page.route("**/api/**", (route) => {
    api.push(route.request().url());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked", message: "No AI request is expected in this test." }) });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return { api, foreign, all, errors };
}

export async function settle(page: Page, opts: { model?: boolean } = {}) {
  await expect.poll(async () => {
    const s = await stats(page);
    return !!s && s.frames > 20 && s.settled && (!opts.model || s.model.state === "ready" || s.model.state === "failed");
  }, { timeout: 45_000, intervals: [200] }).toBe(true);
  // Let the label fades finish.
  await page.waitForTimeout(400);
}

export async function openExample(page: Page, id: "move-city" | "solar", url = PREVIEW) {
  await page.goto(url);
  await page.getByTestId(`example-${id}`).click();
  await expect(page.getByTestId("atlas")).toBeVisible({ timeout: 30_000 });
}

/** The card opens compact; "Details" shows every figure, what the user told us, the possibilities and another AI look. */
export async function details(page: Page) {
  const t = page.getByTestId("atlas-details");
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
}
export const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}${name}.png` });

