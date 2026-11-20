/**
 * npm run r19:live: R19's ONLY live-model step. At most TWO provider requests in total, one per scenario:
 *   A  What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?
 *   B  What if I studied two hours daily instead of one hour for exams four weeks away?
 *
 * Opt-in: nothing happens unless RF_LIVE=1 (so `npm test` and the default suites never reach a provider).
 * The budget is enforced in code: each question gets one attempt (maxAttempts: 1, so an invalid reply is NOT retried), and
 * the fetch wrapper below refuses a third provider call. Free GroqCloud tier only (the planner refuses any other model).
 *
 * It records what was sent (the user message, which is the question) and what came back, never headers or the key, and it
 * runs R19's local figure reader on each real draft: do the real model's labels and units line up with the user's own
 * numbers? The saved drafts are replayed in the browser by packages/web/e2e/r19-live-replay.spec.ts (a recorded real reply,
 * served by a mock: the report calls that "recorded-real", not live).
 *
 *   RF_LIVE=1 npm run r19:live
 *
 * Output: docs/validation/r19-live-drafts.json
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createPlanner, type PlanResult } from "./planner";
import { figureEvidence } from "./r19-live-evidence";

if (process.env.RF_LIVE !== "1") {
  console.log("R19 live step not run: set RF_LIVE=1 to make up to 2 provider requests. Nothing was sent.");
  process.exit(0);
}

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const env = { ...loadEnv("development", repoRoot, "GROQ_"), ...loadEnv("development", webRoot, "GROQ_") };
const apiKey = process.env.GROQ_API_KEY || env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || env.GROQ_MODEL || "openai/gpt-oss-120b";
if (!apiKey) {
  console.log("No GROQ_API_KEY is configured: nothing was sent.");
  process.exit(0);
}

const BUDGET = 2;
const CASES = [
  { id: "A", question: "What if I opened a weekend bookstore with ₹20,000 per month in sales, ₹8,000 rent and ₹4,000 other monthly expenses?" },
  { id: "B", question: "What if I studied two hours daily instead of one hour for exams four weeks away?" },
] as const;

const providerCalls: { n: number; at: string; status: number; ms: number; userMessage: string }[] = [];
const countingFetch: typeof fetch = async (input, init) => {
  if (providerCalls.length >= BUDGET) throw new Error(`R19 live budget of ${BUDGET} provider requests is used: refusing another`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { role: string; content: string }[] };
  const userMessage = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const t0 = Date.now();
  const entry = { n: providerCalls.length + 1, at: new Date(t0).toISOString(), status: 0, ms: 0, userMessage };
  providerCalls.push(entry);
  const res = await fetch(input, init);
  entry.status = res.status;
  entry.ms = Date.now() - t0;
  return res;
};

const planner = createPlanner({ apiKey, model, minIntervalMs: 10_000, maxAttempts: 1, fetchImpl: countingFetch });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: unknown[] = [];
for (const [i, c] of CASES.entries()) {
  if (i > 0) await sleep(12_000);
  const result: PlanResult = await planner.plan(c.question);
  if (result.ok) {
    console.log(`${c.id}: ok (attempts ${result.attempts}, ${result.ms} ms), ${result.proposal.variables.length} assumptions, ${result.proposal.branches.length} futures`);
    results.push({
      id: c.id, question: c.question, ok: true, model: result.model, attempts: result.attempts, ms: result.ms, usage: result.usage, warnings: result.warnings,
      proposal: result.proposal, figureReading: await figureEvidence(c.question, result.proposal, model),
    });
  } else {
    console.log(`${c.id}: ${result.code}: ${result.message}`);
    results.push({ id: c.id, question: c.question, ok: false, code: result.code, status: result.status, message: result.message, errors: result.errors ?? [] });
  }
}

const out = fileURLToPath(new URL("../../../docs/validation/r19-live-drafts.json", import.meta.url));
writeFileSync(out, `${JSON.stringify({
  recordedAt: new Date().toISOString(), model, keyPresent: true,
  note: "Written by packages/web/server/r19-live.ts. Real GroqCloud replies (free tier). The key and request headers are never recorded.",
  providerRequests: providerCalls.length, budget: BUDGET, calls: providerCalls, results,
}, null, 2)}\n`);
console.log(`Provider requests made: ${providerCalls.length} of ${BUDGET}. Wrote ${out}`);
