/**
 * Vite plugin: adds POST /api/plan (a draft, optionally tailored to the user's context answers) and
 * POST /api/revisit (a fresh look at ONE path) to the local dev server, with the same request handling as the
 * production server (http.ts, used by prod.ts for `npm start`).
 * Groq and judge-access settings are loaded server-side. Vite exposes only VITE_-prefixed values to the browser.
 * The adapter is loaded through Vite's SSR loader so it can use the TypeScript core package.
 */
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { apiRoute, handleApi } from "./http";
import { createJudgeAccess } from "./judge-access";
import type * as PlannerModule from "./planner";

export function plannerPlugin(repoRoot: string, webRoot: string): Plugin {
  let mode = "development";
  return {
    name: "realityfork-planner",
    apply: "serve",
    configResolved(c) {
      mode = c.mode;
    },
    configureServer(server) {
      const prefixes = ["GROQ_", "RF_JUDGE_"];
      const env = { ...loadEnv(mode, repoRoot, prefixes), ...loadEnv(mode, webRoot, prefixes), ...process.env };
      const apiKey = env.GROQ_API_KEY || undefined;
      const judge = apiKey ? createJudgeAccess(env) : undefined;
      let mod: typeof PlannerModule | null = null;
      let planner: ReturnType<typeof PlannerModule.createPlanner> | null = null;
      server.middlewares.use((req, res, next) => {
        const route = apiRoute(req.url);
        if (!route) return next();
        void handleApi(req, res, route, async () => {
          if (!mod) mod = (await server.ssrLoadModule("/server/planner.ts")) as typeof PlannerModule;
          planner ??= mod.createPlanner({ apiKey: judge ? apiKey : undefined, model: env.GROQ_MODEL });
          return { planner, limits: mod.BODY_LIMITS, ...(judge && { judge }) };
        });
      });
    },
  };
}
