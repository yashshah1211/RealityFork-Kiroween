/**
 * Identifies the JavaScript runtime that produced a result. Not part of any hash.
 *
 * Reproducibility limits: uniform draws use 32-bit integer arithmetic and are
 * bit-identical on every conforming engine. Exponential draws and statistics use
 * Math.log, Math.sqrt, Math.exp and floating-point summation. ECMAScript requires
 * only Math.sqrt to be correctly rounded; Math.log/exp/pow are "implementation-
 * approximated". Results can therefore differ in the last bits between engines or
 * engine versions, and a result hash can change even though the model is unchanged.
 */
export interface RuntimeInfo {
  readonly name: "node" | "browser" | "unknown";
  readonly version: string;
}

export function describeRuntime(): RuntimeInfo {
  const g = globalThis as unknown as {
    process?: { versions?: { node?: string } };
    navigator?: { userAgent?: string };
  };
  if (g.process?.versions?.node) return { name: "node", version: g.process.versions.node };
  if (g.navigator?.userAgent) return { name: "browser", version: g.navigator.userAgent };
  return { name: "unknown", version: "unknown" };
}
