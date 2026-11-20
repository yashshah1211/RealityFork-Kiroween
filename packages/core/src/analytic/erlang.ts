/**
 * Exact steady-state results for the M/M/c queue (FIFO, infinite capacity).
 * Erlang B by the stable recursion B(0) = 1, B(k) = a·B(k-1) / (k + a·B(k-1)),
 * then Erlang C = B / (1 - ρ(1 - B)). Requires ρ = λ/(cμ) < 1.
 */
export interface MmcAnalytic {
  readonly rho: number;
  readonly erlangC: number;
  /** Mean wait in queue Wq. */
  readonly wq: number;
  readonly lq: number;
  /** Mean time in system W = Wq + 1/μ. */
  readonly w: number;
  readonly l: number;
}

export function erlangB(servers: number, offeredLoad: number): number {
  let b = 1;
  for (let k = 1; k <= servers; k++) b = (offeredLoad * b) / (k + offeredLoad * b);
  return b;
}

export function mmcAnalytic(lambda: number, mu: number, servers: number): MmcAnalytic {
  if (!(lambda > 0 && mu > 0) || !Number.isInteger(servers) || servers < 1) {
    throw new RangeError("mmcAnalytic requires lambda > 0, mu > 0 and an integer servers >= 1");
  }
  const a = lambda / mu;
  const rho = a / servers;
  if (!(rho < 1)) throw new RangeError(`unstable system: rho = ${rho} >= 1 has no steady state`);
  const b = erlangB(servers, a);
  const erlangC = b / (1 - rho * (1 - b));
  const wq = erlangC / (servers * mu - lambda);
  const w = wq + 1 / mu;
  return { rho, erlangC, wq, lq: lambda * wq, w, l: lambda * w };
}
