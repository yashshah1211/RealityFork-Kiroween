/**
 * npm run r19:reread: recompute the "figureReading" of the two recorded real replies with the CURRENT code. No provider is
 * contacted and nothing needs a key. The recorded replies themselves (`proposal`, `calls`, `usage`, timings) are never touched:
 * only the derived reading is refreshed, so the report quotes what the app says now, not what it said when the reply was recorded.
 * The script refuses to run if a recorded reply is missing, and it checks that it left every recorded field byte-identical.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Proposal } from "@realityfork/core";
import { figureEvidence } from "./r19-live-evidence";

const file = fileURLToPath(new URL("../../../docs/validation/r19-live-drafts.json", import.meta.url));
const data = JSON.parse(readFileSync(file, "utf8")) as { model: string; results: { id: string; question: string; ok: boolean; proposal?: Proposal; figureReading?: unknown }[]; [k: string]: unknown };
const recorded = JSON.stringify(data.results.map(({ figureReading: _drop, ...raw }) => raw));
for (const r of data.results) {
  if (!r.ok || !r.proposal) throw new Error(`recorded reply ${r.id} is missing`);
  r.figureReading = await figureEvidence(r.question, r.proposal, data.model);
}
const after = JSON.stringify(data.results.map(({ figureReading: _drop, ...raw }) => raw));
if (after !== recorded) throw new Error("the recorded replies changed: refusing to write");
data.figureReadingRecomputedAt = new Date().toISOString();
data.figureReadingNote = "figureReading was recomputed from the saved replies by packages/web/server/r19-live-reread.ts with the final code. No provider was contacted; proposal, calls and usage are exactly as recorded.";
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Recomputed figureReading for ${data.results.length} recorded replies; recorded fields unchanged; provider requests made now: 0.`);
