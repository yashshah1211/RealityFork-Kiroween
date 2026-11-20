/**
 * RealityFork's production server (`npm run build`, then `npm start`): the built app and the two AI routes from one
 * Node process, so it runs on any Node host without the Vite dev server.
 *
 * Environment (read here only; never sent to the browser or logged):
 *   GROQ_API_KEY  GroqCloud free-tier key. It is usable only when judge access is configured.
 *   GROQ_MODEL    optional: openai/gpt-oss-120b (default) or openai/gpt-oss-20b. Any other value stops the server.
 *   PORT          default 8080. HOST defaults to 0.0.0.0 when PORT is set (hosting platforms), else 127.0.0.1.
 * Locally: `node --env-file=.env.local packages/web/dist-server/prod.js`.
 *
 * The planner's limits apply to the whole server, shared by every visitor: one AI request per 10 s and 20 per hour.
 */
import { fileURLToPath } from "node:url";
import { BODY_LIMITS, createPlanner } from "./planner";
import { createApp } from "./http";
import { createJudgeAccess } from "./judge-access";

const root = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const apiKey = process.env.GROQ_API_KEY || undefined;
const judge = apiKey ? createJudgeAccess(process.env) : undefined;
let planner: ReturnType<typeof createPlanner>;
try {
  planner = createPlanner({ apiKey: judge ? apiKey : undefined, model: process.env.GROQ_MODEL || undefined });
} catch {
  console.error("[server] cannot start: GROQ_MODEL must be an allowed model");
  process.exit(1);
}
const server = createApp({ root, deps: () => ({ planner, limits: BODY_LIMITS, ...(judge && { judge }) }) });
server.listen(port, host, () => {
  console.log(`[server] RealityFork on http://${host}:${port} (AI planner ${judge ? "configured for judge access" : "disabled"})`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
