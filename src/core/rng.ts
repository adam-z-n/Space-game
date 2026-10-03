/**
 * Deterministic random numbers for rules code.
 *
 * Rules code must never call Math.random. All randomness comes from an Rng whose
 * state is a single uint32, so it can live inside GameState and be serialized.
 * Only integer arithmetic is used, so results match across JS engines and devices.
 */

/** Hash a string seed to a uint32 (FNV-1a). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private s: number;

  constructor(state: number) {
    this.s = state >>> 0;
  }

  static fromSeed(seed: string): Rng {
    return new Rng(hashString(seed));
  }

  /** Current state, for storing back into GameState. */
  get state(): number {
    return this.s;
  }

  /** Next uint32 (mulberry32). */
  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max ${max} < min ${min}`);
    const span = max - min + 1;
    return min + (this.nextU32() % span);
  }

  /** Float in [0, 1). */
  float(): number {
    return this.nextU32() / 0x100000000;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty list");
    return items[this.int(0, items.length - 1)]!;
  }

  /** Pick by integer weights. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += weight(item);
    if (total <= 0) throw new Error("Rng.weighted: no positive weights");
    let roll = this.int(0, total - 1);
    for (const item of items) {
      roll -= weight(item);
      if (roll < 0) return item;
    }
    return items[items.length - 1]!;
  }

  /** Fisher-Yates shuffle, returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Derive an independent stream, e.g. one per generation stage. */
  fork(label: string): Rng {
    return new Rng((this.nextU32() ^ hashString(label)) >>> 0);
  }
}
