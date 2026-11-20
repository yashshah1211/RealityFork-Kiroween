/**
 * The HTTP side of RealityFork's server, shared by the dev server (plugin.ts, `npm run dev`) and the production server
 * (prod.ts, `npm start`):
 *  - POST /api/plan    a draft, optionally tailored to the user's context answers
 *  - POST /api/revisit a fresh look at ONE path
 *  - POST /api/judge/session exchanges a judge code for an expiring session
 * Bodies are size-limited before parsing; replies are JSON with Cache-Control: no-store; logs carry locations and
 * counts only, never keys, questions, answers, model text or error excerpts; an unexpected exception is never echoed.
 *
 * The production server also serves the built app (dist/): only files inside it, with hashed assets cached for a year
 * and index.html never cached. Node built-ins only; the planner is passed in, so this module never loads the
 * TypeScript core itself (the dev server loads it through Vite).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type * as PlannerModule from "./planner";
import { JUDGE_ORIGIN, JUDGE_REQUIRED, JUDGE_SESSION_ROUTE, JUDGE_UNAVAILABLE, type JudgeAccess } from "./judge-access";

export const API_ROUTES = ["/api/plan", "/api/revisit", JUDGE_SESSION_ROUTE] as const;
export type ApiRoute = (typeof API_ROUTES)[number];
type Planner = ReturnType<typeof PlannerModule.createPlanner>;
type Limits = typeof PlannerModule.BODY_LIMITS;
/** What a request needs to be answered; loaded lazily by the dev server, ready at start in production. */
export interface ApiDeps { readonly planner: Planner; readonly limits: Limits; readonly judge?: JudgeAccess }

/** The API route a request URL names, or null. */
export const apiRoute = (url: string | undefined): ApiRoute | null => {
  const path = (url ?? "").split("?")[0];
  return (API_ROUTES as readonly string[]).includes(path ?? "") ? (path as ApiRoute) : null;
};

/** Read at most `limit` bytes. Returns null when the body is larger (the rest is drained, not kept). */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Answer one API request. Every failure becomes a JSON reply; nothing is thrown to the caller. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, route: ApiRoute, deps: () => ApiDeps | Promise<ApiDeps>): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") return send(405, { ok: false, code: "bad-input", message: "POST only" });
  try {
    const { planner, limits, judge } = await deps();
    const signIn = route === JUDGE_SESSION_ROUTE;
    if (signIn && !judge) return send(JUDGE_UNAVAILABLE.status, JUDGE_UNAVAILABLE);
    let reserve: PlannerModule.ReserveAttempt | undefined;
    if (judge) {
      if (req.headers.origin !== judge.origin) return send(JUDGE_ORIGIN.status, JUDGE_ORIGIN);
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
        return send(415, { ok: false, code: "bad-input", message: "Send an application/json request." });
      }
      if (!signIn) {
        const session = judge.authenticate(req.headers.cookie);
        if (!session) return send(JUDGE_REQUIRED.status, JUDGE_REQUIRED);
        reserve = (tokens) => judge.reserve(session, tokens);
      }
    }
    const raw = await readBody(req, signIn ? 512 : limits[route]);
    if (raw === null) return send(413, { ok: false, code: "bad-input", message: "This request holds too much text. Shorten some notes and try again." });
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      const message = route === "/api/plan" ? "Send JSON: {\"question\": \"What if…?\"}"
        : signIn ? "Send the access code as a JSON object." : "Send the path as JSON.";
      return send(400, { ok: false, code: "bad-input", message });
    }
    if (route === JUDGE_SESSION_ROUTE) {
      const signedIn = judge!.signIn(body.code);
      if (!signedIn.ok) return send(signedIn.status, signedIn);
      res.setHeader("Set-Cookie", signedIn.cookie);
      return send(200, { ok: true });
    }
    const kind = route === "/api/plan" ? "plan" : "revisit";
    const r = route === "/api/plan" ? await planner.plan(body.question, body.context, reserve) : await planner.revisit(body, reserve);
    // Log fixed metadata and counts only. Validation error strings can contain model output.
    const context = kind === "plan" && Array.isArray(body.context) ? ` context=${body.context.length}` : "";
    console.log(`[planner] ${kind}${context} ${r.ok
      ? `ok model=${r.model} attempts=${r.attempts} ms=${r.ms} adjustments=${r.warnings.length}`
      : `fail code=${r.code} status=${r.status} errors=${r.errors?.length ?? 0}`}`);
    send(r.ok ? 200 : r.status, r);
  } catch {
    // Unexpected exception text might include an upstream URL or credentials; never echo it to users.
    console.warn("[planner] unexpected server exception (details withheld)");
    send(500, { ok: false, code: "provider-error", message: "The AI planner encountered a server error. Please try again later or continue by hand." });
  }
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm", ".glb": "model/gltf-binary",
};

/** A file of the built app, or null. Never anything outside `root`: "..", encoded or not, cannot leave it. */
function fileIn(root: string, url: string | undefined): string | null {
  let path: string;
  try {
    path = decodeURIComponent((url ?? "/").split("?")[0]!.split("#")[0]!);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const full = resolve(join(root, path));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    const s = statSync(full);
    if (s.isFile()) return full;
    if (s.isDirectory()) {
      const index = join(full, "index.html");
      return statSync(index).isFile() ? index : null;
    }
  } catch {
    // Not there. The app routes by #hash, so a path without an extension still gets the app; anything else is a 404.
    if (!extname(path)) {
      const index = join(root, "index.html");
      try {
        return statSync(index).isFile() ? index : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return void res.end();
  }
  const file = fileIn(root, req.url);
  if (!file) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return void res.end("Not found");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
  // Vite names built assets by their content hash, so they can be cached for good; the page itself never is.
  const hashed = file.startsWith(join(root, "assets") + sep);
  res.setHeader("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

/** The production server serves the built app and API routes. prod.ts starts listening. */
export function createApp(o: { readonly root: string; readonly deps: () => ApiDeps | Promise<ApiDeps> }): Server {
  const root = resolve(o.root);
  return createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    const route = apiRoute(req.url);
    if (route) return void handleApi(req, res, route, o.deps);
    serveStatic(root, req, res);
  });
}
