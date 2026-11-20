import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Failure } from "./planner";

export const JUDGE_SESSION_ROUTE = "/api/judge/session";
const COOKIE = "__Host-rf-judge";
const INVITE_CODE = /^RF-[A-Za-z0-9_-]{32}$/;
const SIGNED_TOKEN = /^(v1\.([A-Za-z0-9_-]{43})\.(\d{10}))\.([A-Za-z0-9_-]{43})$/;
const ACCESS_END = Date.parse("2027-01-30T12:00:00Z") / 1000;
const SESSION_SECONDS = 86_400;
const FAILED_LOGINS_PER_MINUTE = 30;
const INVITE_DAILY_ATTEMPTS = 6;
const GLOBAL_DAILY_ATTEMPTS = 24;
const GLOBAL_DAILY_TOKENS = 150_000;

export const JUDGE_REQUIRED = { ok: false, status: 401, code: "judge-required", message: "Enter a judge access code to use the AI guide." } as const;
export const JUDGE_UNAVAILABLE = { ok: false, status: 503, code: "judge-unavailable", message: "Judge access is temporarily unavailable. You can continue by hand." } as const;
export const JUDGE_ORIGIN = { ok: false, status: 403, code: "judge-origin", message: "Open RealityFork directly to use judge access." } as const;
const INVALID_INVITE = { ok: false, status: 401, code: "judge-invite", message: "That access code is invalid or expired." } as const;
const LOGIN_LIMIT = { ok: false, status: 429, code: "judge-login-limit", message: "Too many sign-in attempts. Try again in a minute." } as const;
const INVITE_LIMIT = { ok: false, status: 429, code: "quota", message: "This judge invite has used its AI allowance for today." } as const;
const GLOBAL_LIMIT = { ok: false, status: 429, code: "quota", message: "The demo has used its AI allowance for today." } as const;

interface Session {
  readonly inviteId: string;
  readonly expires: number;
}

export class JudgeAccess {
  private readonly invites: ReadonlyMap<string, Buffer>;
  private loginMinute = -1;
  private failedLogins = 0;
  private usageDay = -1;
  private readonly inviteAttempts = new Map<string, number>();
  private globalAttempts = 0;
  private globalTokens = 0;

  constructor(readonly origin: string, private readonly secret: Buffer, hashes: readonly string[], private readonly now: () => number) {
    // Keep the configured hashes out of cookies. Invite IDs are stable for this signing key.
    this.invites = new Map(hashes.map((hash) => [this.sign("invite", hash), Buffer.from(hash, "hex")]));
  }

  private sign(scope: "invite" | "session", value: string) {
    return createHmac("sha256", this.secret).update(`realityfork-judge:${scope}:${value}`).digest("base64url");
  }

  private isActive(session: Session, now: number): boolean {
    return now < session.expires && session.expires <= ACCESS_END && this.invites.has(session.inviteId);
  }

  private failedSignIn(now: number): Failure {
    const minute = Math.floor(now / 60);
    if (minute !== this.loginMinute) {
      this.loginMinute = minute;
      this.failedLogins = 0;
    }
    if (this.failedLogins >= FAILED_LOGINS_PER_MINUTE) return LOGIN_LIMIT;
    this.failedLogins += 1;
    return INVALID_INVITE;
  }

  signIn(code: unknown): { ok: true; cookie: string } | Failure {
    const now = Math.floor(this.now() / 1000);
    if (now >= ACCESS_END || typeof code !== "string" || !INVITE_CODE.test(code)) return this.failedSignIn(now);
    const candidate = createHash("sha256").update(code).digest();
    let inviteId: string | undefined;
    for (const [id, hash] of this.invites) {
      if (timingSafeEqual(candidate, hash)) inviteId = id;
    }
    // Even when the failure window is full, a valid code can still sign in.
    if (!inviteId) return this.failedSignIn(now);
    const expires = Math.min(now + SESSION_SECONDS, ACCESS_END);
    const payload = `v1.${inviteId}.${expires}`;
    return {
      ok: true,
      cookie: `${COOKIE}=${payload}.${this.sign("session", payload)}; Path=/; Max-Age=${expires - now}; HttpOnly; Secure; SameSite=Strict`,
    };
  }

  authenticate(header: string | undefined): Session | null {
    const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    const match = value && SIGNED_TOKEN.exec(value.slice(COOKIE.length + 1));
    if (!match) return null;
    const [, payload, inviteId, expires, signature] = match;
    if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(this.sign("session", payload!)))) return null;
    const session = { inviteId: inviteId!, expires: Number(expires) };
    return this.isActive(session, Math.floor(this.now() / 1000)) ? session : null;
  }

  reserve(session: Session, tokens: number): Failure | null {
    const now = Math.floor(this.now() / 1000);
    // Recheck immediately before every provider attempt, including a validation retry.
    if (!this.isActive(session, now)) return JUDGE_REQUIRED;
    const day = Math.floor(now / 86_400);
    if (day !== this.usageDay) {
      this.usageDay = day;
      this.inviteAttempts.clear();
      this.globalAttempts = 0;
      this.globalTokens = 0;
    }
    const used = this.inviteAttempts.get(session.inviteId) ?? 0;
    // Keep the checks and charges synchronous so concurrent requests cannot oversubscribe this process.
    if (this.globalAttempts >= GLOBAL_DAILY_ATTEMPTS || this.globalTokens + tokens > GLOBAL_DAILY_TOKENS) return GLOBAL_LIMIT;
    if (used >= INVITE_DAILY_ATTEMPTS) return INVITE_LIMIT;
    this.inviteAttempts.set(session.inviteId, used + 1);
    this.globalAttempts += 1;
    this.globalTokens += tokens;
    return null;
  }
}

export function createJudgeAccess(env: NodeJS.ProcessEnv, now = Date.now): JudgeAccess | undefined {
  const { RF_JUDGE_INVITE_SHA256: invites, RF_JUDGE_ORIGIN: origin, RF_JUDGE_SESSION_SECRET: secret } = env;
  if (!invites || !origin || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return undefined;
  const key = Buffer.from(secret, "base64url");
  if (key.toString("base64url") !== secret) return undefined;
  const hashes = invites.split(",").map((hash) => hash.trim().toLowerCase());
  if (hashes.length > 16 || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) return undefined;
  try {
    const site = new URL(origin);
    const local = site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname);
    if ((!local && site.protocol !== "https:") || site.origin !== origin) return undefined;
  } catch {
    return undefined;
  }
  return new JudgeAccess(origin, key, hashes, now);
}
