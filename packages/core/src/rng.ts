/**
 * Seeded, named random streams.
 *
 * - splitmix32 mixes seeds; xoshiro128** generates 32-bit outputs.
 * - uniform() = next() / 2^32, which lies in [0, 1) with resolution 2^-32.
 * - Stream seed = f(masterSeed, fnv1a32(streamName), replication).
 *
 * All arithmetic is 32-bit integer arithmetic (Math.imul, >>>), so uniform draws are
 * bit-identical on every conforming JS engine. Transforms that use Math.log are
 * deterministic per runtime but are not guaranteed bit-identical across engines.
 */

const TWO_POW_32 = 4294967296;

/** 32-bit FNV-1a hash of a string (UTF-16 code units). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One splitmix32 step: returns [output, nextState]. */
function splitmix32(state: number): [number, number] {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z = (z ^ (z >>> 16)) >>> 0;
  return [z, next];
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export interface RandomStream {
  readonly name: string;
  /** Uniform in [0, 1). */
  uniform(): number;
  /** Exponential with the given rate (> 0), by inverse transform. */
  exponential(rate: number): number;
  /** Number of uniform draws consumed so far (useful for CRN diagnostics). */
  readonly draws: number;
}

class Xoshiro128ss implements RandomStream {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private count = 0;

  constructor(readonly name: string, seed: number, rawState?: readonly [number, number, number, number]) {
    let st = seed >>> 0;
    const words: number[] = [];
    if (rawState) {
      words.push(...rawState.map((w) => w >>> 0));
    } else {
      for (let i = 0; i < 4; i++) {
        const [out, next] = splitmix32(st);
        words.push(out);
        st = next;
      }
    }
    this.s0 = words[0]!;
    this.s1 = words[1]!;
    this.s2 = words[2]!;
    this.s3 = words[3]!;
    // Guard the (practically impossible) all-zero state, which is a fixed point.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  get draws(): number {
    return this.count;
  }

  /** Raw 32-bit output. Exposed for reference-vector testing. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  uniform(): number {
    this.count++;
    return this.nextUint32() / TWO_POW_32;
  }

  exponential(rate: number): number {
    if (!(rate > 0) || !Number.isFinite(rate)) {
      throw new RangeError(`exponential rate must be finite and > 0, got ${rate}`);
    }
    // u in [0,1) so (1 - u) in (0,1]; log is finite and the result is >= 0.
    return -Math.log(1 - this.uniform()) / rate;
  }
}

/** Deterministically derive a 32-bit stream seed. */
export function deriveStreamSeed(masterSeed: number, streamName: string, replication: number): number {
  if (!Number.isInteger(masterSeed) || masterSeed < 0 || masterSeed > 0xffffffff) {
    throw new RangeError(`masterSeed must be an integer in [0, 2^32), got ${masterSeed}`);
  }
  if (!Number.isInteger(replication) || replication < 0) {
    throw new RangeError(`replication must be a non-negative integer, got ${replication}`);
  }
  let [a, st] = splitmix32(masterSeed >>> 0);
  [a, st] = splitmix32((st ^ fnv1a32(streamName)) >>> 0);
  [a] = splitmix32((st ^ Math.imul(replication + 1, 0x9e3779b1)) >>> 0);
  return a >>> 0;
}

export function createStream(masterSeed: number, streamName: string, replication = 0): RandomStream {
  return new Xoshiro128ss(streamName, deriveStreamSeed(masterSeed, streamName, replication));
}

/** Create one stream per name for a given replication. */
export function createStreams(
  masterSeed: number,
  streamNames: readonly string[],
  replication: number,
): Record<string, RandomStream> {
  const out: Record<string, RandomStream> = {};
  for (const name of streamNames) out[name] = createStream(masterSeed, name, replication);
  return out;
}

/**
 * Test-only constructor from a raw xoshiro128** state, used to check the generator
 * against the reference implementation's published outputs.
 */
export function xoshiro128ssFromState(state: readonly [number, number, number, number]): {
  nextUint32(): number;
} {
  return new Xoshiro128ss("raw", 0, state);
}
