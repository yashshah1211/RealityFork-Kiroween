import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./http";
import { createJudgeAccess, type JudgeAccess } from "./judge-access";
import { BODY_LIMITS, createPlanner } from "./planner";

const origin = "https://judge.example";
const startTime = Date.parse("2026-11-19T12:00:00Z");
const cutoff = Date.parse("2027-01-30T12:00:00Z");
const question = "What if our neighborhood held a monthly seed swap?";
const planBody = { question };
const revisitBody = {
  question, path: { name: "Community hall", description: "An indoor seed swap." },
  context: [], known: [], assumptions: [], suggestions: [], change: "The hall is available on Sundays.",
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const newCode = () => "RF-" + randomBytes(24).toString("base64url");
const key = "gsk_judge_fixture_only";
const secret = Buffer.alloc(32, 7).toString("base64url");
const proposal = JSON.parse(readFileSync(new URL("../e2e/fixtures/sprint-live-drafts.json", import.meta.url), "utf8")).cafe.proposal;
const suggestion = {
  summary: "Because the hall is available on Sundays, the swap could take place indoors.",
  reconsider: [], add: [], questions: [], evidence: [],
};
const okReply = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
const config = (codes: readonly string[]) => ({
  RF_JUDGE_ORIGIN: origin,
  RF_JUDGE_SESSION_SECRET: secret,
  RF_JUDGE_INVITE_SHA256: codes.map(hash).join(", "),
});

describe("database-free judge AI access with mocked Groq", () => {
  let clock: number;
  let code: string;
  let root: string;
  type App = { server: Server; judge: JudgeAccess | undefined; base: string };
  const apps = new Set<App>();
  const provider = vi.fn<typeof fetch>();

  async function start(env = config([code]), apiKey = key): Promise<App> {
    const judge = apiKey ? createJudgeAccess(env, () => clock) : undefined;
    const planner = createPlanner({ apiKey: judge ? apiKey : undefined, fetchImpl: provider, minIntervalMs: 0, maxPerHour: 100 });
    const server = createApp({ root, deps: () => ({ planner, limits: BODY_LIMITS, judge }) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const app = { server, judge, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    apps.add(app);
    return app;
  }

  async function stop(app: App) {
    await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    apps.delete(app);
  }

  const post = (app: App, path: string, data: unknown, cookie = "", source = origin, contentType = "application/json") => fetch(app.base + path, {
    method: "POST",
    headers: { Origin: source, Cookie: cookie, "Content-Type": contentType },
    body: JSON.stringify(data),
  });
  const login = (app: App, invite: unknown) => post(app, "/api/judge/session", { code: invite });

  async function signIn(app: App, invite = code) {
    const response = await login(app, invite);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
    const header = response.headers.get("set-cookie")!;
    return { header, cookie: header.split(";")[0]! };
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rf-judge-test-app-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>RealityFork</title>");
  });
  beforeEach(() => {
    clock = startTime;
    code = newCode();
    provider.mockReset();
    provider.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return okReply(body.response_format.json_schema.name.includes("revisit") ? suggestion : proposal);
    });
  });
  afterEach(async () => { await Promise.all([...apps].map(stop)); });
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  it("keeps the public app open and blocks unauthorized AI, foreign origins, and non-JSON POSTs", async () => {
    const app = await start();
    const { cookie } = await signIn(app);
    expect(await (await fetch(app.base + "/?preview=atlas")).text()).toContain("RealityFork");
    for (const [path, body] of [["/api/plan", planBody], ["/api/revisit", revisitBody]] as const) {
      const response = await post(app, path, body);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "judge-required" });
      expect((await post(app, path, body, cookie, "https://foreign.example")).status).toBe(403);
      expect((await post(app, path, body, cookie, origin, "text/plain")).status).toBe(415);
      expect((await post(app, path, [], cookie)).status).toBe(400);
    }
    expect((await post(app, "/api/judge/session", { code }, "", "null")).status).toBe(403);
    expect((await post(app, "/api/judge/session", { code }, "", origin, "text/plain")).status).toBe(415);
    expect(provider).not.toHaveBeenCalled();
  });

  it("issues the secure cookie and supports both mocked AI flows after validating the input", async () => {
    const app = await start();
    const { cookie, header } = await signIn(app);
    expect(header).toMatch(/^__Host-rf-judge=v1\.[A-Za-z0-9_-]{43}\.\d{10}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict$/);
    expect(header).not.toContain(hash(code));
    expect(header).not.toContain(code);
    expect((await post(app, "/api/plan", { question: "" }, cookie)).status).toBe(400);
    expect((await post(app, "/api/revisit", {}, cookie)).status).toBe(400);
    expect((await post(app, "/api/plan", { question: "x".repeat(8001) }, cookie)).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();

    const plan = await post(app, "/api/plan", planBody, cookie);
    expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject({ ok: true, model: "openai/gpt-oss-120b", proposal });
    const revisit = await post(app, "/api/revisit", revisitBody, cookie);
    expect(revisit.status).toBe(200);
    expect(await revisit.json()).toMatchObject({ ok: true, suggestion });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed or tampered cookies and expires at 24 hours or the judging cutoff", async () => {
    const app = await start();
    const { cookie } = await signIn(app);
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
    const extended = cookie.replace(/\.\d{10}\./, `.${startTime / 1000 + 86_401}.`);
    for (const invalid of [tampered, extended, "__Host-rf-judge=malformed"]) {
      expect((await post(app, "/api/plan", planBody, invalid)).status).toBe(401);
    }
    clock += 86_400_000;
    expect((await post(app, "/api/revisit", revisitBody, cookie)).status).toBe(401);

    clock = cutoff - 4500;
    const last = await signIn(app);
    expect(last.header).toContain("Max-Age=5;");
    clock = cutoff;
    expect((await post(app, "/api/plan", planBody, last.cookie)).status).toBe(401);
    expect((await login(app, code)).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it("invalidates rotated and revoked invites and supports signing-key rotation", async () => {
    const kept = newCode();
    const revoked = newCode();
    const old = await start(config([code, kept, revoked]));
    const rotatedSession = await signIn(old);
    const keptSession = await signIn(old, kept);
    const revokedSession = await signIn(old, revoked);
    await stop(old);
    const replacement = newCode();
    const updated = await start(config([kept, replacement]));
    expect((await post(updated, "/api/plan", planBody, rotatedSession.cookie)).status).toBe(401);
    expect((await post(updated, "/api/revisit", revisitBody, revokedSession.cookie)).status).toBe(401);
    expect((await login(updated, code)).status).toBe(401);
    expect((await login(updated, revoked)).status).toBe(401);
    expect((await post(updated, "/api/plan", planBody, keptSession.cookie)).status).toBe(200);
    await signIn(updated, replacement);
    const rekeyed = await start({ ...config([kept]), RF_JUDGE_SESSION_SECRET: randomBytes(32).toString("base64url") });
    expect((await post(rekeyed, "/api/plan", planBody, keptSession.cookie)).status).toBe(401);
    await signIn(rekeyed, kept);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("throttles failed logins without locking out valid codes", async () => {
    const app = await start();
    for (let i = 0; i < 30; i++) {
      expect((await login(app, i % 2 ? newCode() : "bad format")).status).toBe(401);
    }
    expect((await login(app, newCode())).status).toBe(429);
    await signIn(app);
    expect((await login(app, newCode())).status).toBe(429);
    clock += 60_000;
    expect((await login(app, newCode())).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it("charges the validation retry independently and denies a retry after the budget is exhausted", async () => {
    const app = await start();
    const { cookie } = await signIn(app);
    provider.mockResolvedValueOnce(okReply({}));
    const draft = await post(app, "/api/plan", planBody, cookie);
    expect(await draft.json()).toMatchObject({ ok: true, attempts: 2 });
    for (let i = 0; i < 3; i++) {
      expect((await post(app, "/api/revisit", revisitBody, cookie)).status).toBe(200);
    }
    provider.mockResolvedValueOnce(okReply({}));
    const rejected = await post(app, "/api/plan", planBody, cookie);
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toMatchObject({ code: "quota" });
    expect(provider).toHaveBeenCalledTimes(6);
  });

  it("rechecks the session before retrying and withholds secrets from error responses and logs", async () => {
    const app = await start();
    const { cookie } = await signIn(app);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      provider.mockResolvedValueOnce(new Response(`upstream echoed ${key}`, { status: 500 }));
      const fail = await post(app, "/api/plan", planBody, cookie);
      expect(fail.status).toBe(502);
      expect(await fail.text()).not.toContain(key);
      provider.mockImplementationOnce(async () => {
        clock += 86_400_000;
        return okReply({});
      });
      expect((await post(app, "/api/plan", planBody, cookie)).status).toBe(401);
      expect(provider).toHaveBeenCalledTimes(2);
      const output = JSON.stringify(log.mock.calls);
      for (const value of [key, code, secret, hash(code), cookie, question]) expect(output).not.toContain(value);
    } finally {
      log.mockRestore();
    }
  });

  it("admits six concurrent attempts per invite across sessions and resets quota on server restart", async () => {
    const app = await start();
    const { cookie } = await signIn(app);
    clock += 1000;
    const second = await signIn(app);
    expect(second.cookie).not.toBe(cookie);
    const responses = await Promise.all(Array.from({ length: 12 }, (_, n) =>
      post(app, "/api/revisit", { ...revisitBody, tokens: 0, remainingAttempts: 999 }, n % 2 ? cookie : second.cookie)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(6);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(6);
    expect(provider).toHaveBeenCalledTimes(6);

    await stop(app);
    const restarted = await start();
    expect((await post(restarted, "/api/revisit", revisitBody, cookie)).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(7);
  });

  it("enforces the 24-attempt global cap under concurrency and resets it at UTC midnight", async () => {
    clock = Date.parse("2026-11-19T23:59:59Z");
    const codes = Array.from({ length: 5 }, newCode);
    const judge = createJudgeAccess(config(codes), () => clock)!;
    const sessions = codes.map((invite) => {
      const signed = judge.signIn(invite);
      if (!signed.ok) throw new Error("Test sign-in failed");
      return judge.authenticate(signed.cookie)!;
    });
    const attempts = await Promise.all(sessions.flatMap((session) =>
      Array.from({ length: 6 }, () => Promise.resolve().then(() => judge.reserve(session, 1)))));
    expect(attempts.filter((failure) => failure === null)).toHaveLength(24);
    expect(attempts.filter((failure) => failure?.status === 429)).toHaveLength(6);
    clock += 1000;
    expect(judge.reserve(sessions[0]!, 1)).toBeNull();
  });

  it("reserves the whole serialized provider request and completion allowance against the global token cap", async () => {
    const another = newCode();
    const app = await start(config([code, another]));
    const { cookie } = await signIn(app);
    const second = await signIn(app, another);
    const session = app.judge!.authenticate(second.cookie)!;
    expect((await post(app, "/api/plan", planBody, cookie)).status).toBe(200);
    const sentBody = String(provider.mock.calls[0]![1]!.body);
    const estimated = Buffer.byteLength(sentBody) + 512 + Number(JSON.parse(sentBody).max_completion_tokens);
    expect(app.judge!.reserve(session, 150_001 - estimated)).toMatchObject({ status: 429 });
    expect(app.judge!.reserve(session, 150_000 - estimated)).toBeNull();
    expect((await post(app, "/api/revisit", revisitBody, second.cookie)).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("keeps AI disabled when the Groq key or judge configuration is missing", async () => {
    const valid = config([code]);
    for (const env of [config([]), { ...valid, RF_JUDGE_ORIGIN: origin + "/" }, { ...valid, RF_JUDGE_SESSION_SECRET: "short" }]) {
      expect(createJudgeAccess(env)).toBeUndefined();
    }
    for (const app of [await start(valid, ""), await start(config([]))]) {
      for (const [path, body] of [["/api/plan", planBody], ["/api/revisit", revisitBody]] as const) {
        const response = await post(app, path, body);
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: "no-key" });
      }
      expect((await login(app, code)).status).toBe(503);
    }
    expect(provider).not.toHaveBeenCalled();
  });
});
