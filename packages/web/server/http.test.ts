/**
 * Release readiness: the production server (http.ts, started by prod.ts) answers like the dev server and serves the
 * built app safely. The provider is always a fake that replays a RECORDED LIVE reply (sprint-live-drafts.json): no
 * request leaves this computer, and the key used here is not a real one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp, type ApiDeps } from "./http";
import { BODY_LIMITS, createPlanner } from "./planner";

const live = JSON.parse(readFileSync(new URL("../e2e/fixtures/sprint-live-drafts.json", import.meta.url), "utf8"));
const FAKE_KEY = "test-key-not-real";

let root: string;
let server: Server;
let base: string;
let deps: ApiDeps;
const providerCalls: { url: string; auth: string | null }[] = [];

/** The provider's reply shape, around the recorded proposal. */
const fakeProvider: typeof fetch = async (input, init) => {
  providerCalls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(live.cafe.proposal) } }], usage: { total_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "rf-dist-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>RealityFork</title><div id=root></div>");
  writeFileSync(join(root, "assets", "index-abc123.js"), "console.log('app')");
  writeFileSync(join(root, "assets", "sim.worker-def456.js"), "self.onmessage=()=>{}");
  writeFileSync(join(root, "assets", "index-abc123.css"), "body{}");
  writeFileSync(join(tmpdir(), "rf-secret-outside.txt"), "outside the app");
  deps = { planner: createPlanner({ apiKey: FAKE_KEY, fetchImpl: fakeProvider, minIntervalMs: 0 }), limits: BODY_LIMITS };
  server = createApp({ root, deps: () => deps });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(root, { recursive: true, force: true });
  rmSync(join(tmpdir(), "rf-secret-outside.txt"), { force: true });
});

const post = (path: string, body: string) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });

describe("the production server serves the built app", () => {
  it("the page, its script, its worker and its styles, each with its type; hashed assets are cached, the page is not", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(await page.text()).toContain("<div id=root>");
    for (const [path, type] of [["/assets/index-abc123.js", "text/javascript; charset=utf-8"], ["/assets/sim.worker-def456.js", "text/javascript; charset=utf-8"], ["/assets/index-abc123.css", "text/css; charset=utf-8"]] as const) {
      const r = await fetch(`${base}${path}`);
      expect(r.status, path).toBe(200);
      expect(r.headers.get("content-type"), path).toBe(type);
      expect(r.headers.get("cache-control"), path).toBe("public, max-age=31536000, immutable");
    }
    expect((await fetch(`${base}/`)).headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("a path without a file extension gets the app (it routes by #hash); a missing asset is a 404, not the app", async () => {
    expect((await fetch(`${base}/staffing`)).status).toBe(200);
    expect(await (await fetch(`${base}/staffing`)).text()).toContain("<div id=root>");
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it("nothing outside the built app can be read, however the path is written", async () => {
    for (const path of ["/../rf-secret-outside.txt", "/%2e%2e/rf-secret-outside.txt", "/assets/%2e%2e/%2e%2e/rf-secret-outside.txt", "/..%2frf-secret-outside.txt", "/%2e%2e%5crf-secret-outside.txt", "/%00", "/%E0%A4%A"]) {
      const r = await fetch(`${base}${path}`);
      const text = await r.text();
      expect(text, path).not.toContain("outside the app");
    }
  });

  it("only GET and HEAD for the app", async () => {
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    const head = await fetch(`${base}/assets/index-abc123.js`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});

describe("the production server answers the AI routes like the dev server", () => {
  it("a draft goes through the real planner to the provider and back, checked; the key goes only to the provider and never into a reply or a log", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await post("/api/plan", JSON.stringify({ question: live.cafe.question }));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ ok: true, model: "openai/gpt-oss-120b" });
    expect(body.proposal.branches.map((b: { name: string }) => b.name)).toEqual(live.cafe.proposal.branches.map((b: { name: string }) => b.name));
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toEqual({ url: "https://api.groq.com/openai/v1/chat/completions", auth: `Bearer ${FAKE_KEY}` });
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
    const logged = logs.mock.calls.flat().join(" ");
    expect(logged).toMatch(/\[planner\] plan ok model=openai\/gpt-oss-120b/);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain(live.cafe.question);
    logs.mockRestore();
  });

  it("refuses what it should, as JSON: GET, an oversized body, a body that is not a JSON object", async () => {
    const get = await fetch(`${base}/api/plan`);
    expect([get.status, (await get.json()).code]).toEqual([405, "bad-input"]);
    const big = await post("/api/plan", JSON.stringify({ question: "x".repeat(BODY_LIMITS["/api/plan"]) }));
    expect([big.status, (await big.json()).code]).toEqual([413, "bad-input"]);
    for (const bad of ["not json", "[1,2]", "null"]) {
      const r = await post("/api/plan", bad);
      expect([r.status, (await r.json()).code], bad).toEqual([400, "bad-input"]);
    }
    const revisit = await post("/api/revisit", "{}");
    expect(revisit.status).toBe(400);
  });

  it("without a key the app still loads and the AI routes say so, so the manual flow is offered", async () => {
    const before = deps;
    deps = { planner: createPlanner({ apiKey: undefined }), limits: BODY_LIMITS };
    const r = await post("/api/plan", JSON.stringify({ question: "What if I moved?" }));
    expect([r.status, (await r.json()).code]).toEqual([503, "no-key"]);
    expect((await fetch(`${base}/`)).status).toBe(200);
    deps = before;
  });

  it("an unexpected failure is a generic 500, with nothing of the exception in the reply", async () => {
    const before = deps;
    deps = { planner: { ...before.planner, plan: () => Promise.reject(new Error(`boom ${FAKE_KEY} https://internal.example`)) }, limits: BODY_LIMITS };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await post("/api/plan", JSON.stringify({ question: "What if?" }));
    const text = await r.text();
    expect(r.status).toBe(500);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain("internal.example");
    expect(warn.mock.calls.flat().join(" ")).not.toContain(FAKE_KEY);
    warn.mockRestore();
    deps = before;
  });
});
