import { describe, expect, it } from "vitest";
import { BENCHMARK_CASES, BENCHMARK_CONFIG, runMmcCase } from "../src/benchmark/mmc";

/**
 * Analytical M/M/c benchmark (R3.3–R3.5). Seeded and therefore deterministic.
 * Do not change seeds, tolerances or replication counts to make this pass.
 */
describe("M/M/c analytical benchmark", () => {
  it("design meets the spec minimums", () => {
    expect(BENCHMARK_CONFIG.replications).toBeGreaterThanOrEqual(30);
    for (const c of BENCHMARK_CASES) {
      expect((BENCHMARK_CONFIG.horizon - BENCHMARK_CONFIG.warmup) * c.mu).toBeGreaterThanOrEqual(10_000);
      expect(c.lambda / (c.servers * c.mu)).toBeCloseTo(0.8, 12);
    }
  });

  for (const c of BENCHMARK_CASES) {
    it(`${c.id}: every statistical and precision check passes`, () => {
      const r = runMmcCase(c);
      const failed = r.checks.filter((k) => !k.passed);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
      expect(r.perCheckConfidence).toBeCloseTo(1 - 0.01 / 6, 12);
    });
  }
});
