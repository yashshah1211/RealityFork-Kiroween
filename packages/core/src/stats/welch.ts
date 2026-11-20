/**
 * Welch's graphical procedure for choosing a warm-up period.
 * Input: one time series per replication (equal-width bins).
 * Output: the across-replication mean per bin, and its centered moving average with
 * window w (the window shrinks near the start, as in Law & Kelton).
 */
export interface WelchCurve {
  readonly ensembleMean: readonly number[];
  readonly movingAverage: readonly number[];
  readonly window: number;
}

export function welchCurve(series: readonly (readonly number[])[], window: number): WelchCurve {
  if (series.length === 0) throw new RangeError("welchCurve needs at least one replication");
  if (!Number.isInteger(window) || window < 0) throw new RangeError("window must be a non-negative integer");
  const m = Math.min(...series.map((s) => s.length));
  const ensembleMean = new Array<number>(m).fill(0);
  for (const s of series) for (let i = 0; i < m; i++) ensembleMean[i]! += s[i]! / series.length;
  const movingAverage: number[] = [];
  for (let i = 0; i < m - window; i++) {
    const half = Math.min(i, window);
    let sum = 0;
    for (let k = i - half; k <= i + half; k++) sum += ensembleMean[k]!;
    movingAverage.push(sum / (2 * half + 1));
  }
  return { ensembleMean, movingAverage, window };
}
