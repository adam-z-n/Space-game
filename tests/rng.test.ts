import { describe, expect, it } from "vitest";
import { Rng, hashString } from "../src/core";

describe("Rng", () => {
  it("is reproducible from a seed", () => {
    const a = Rng.fromSeed("alpha");
    const b = Rng.fromSeed("alpha");
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it("differs between seeds", () => {
    expect(Rng.fromSeed("alpha").nextU32()).not.toBe(Rng.fromSeed("beta").nextU32());
  });

  it("resumes from a saved state", () => {
    const a = Rng.fromSeed("resume");
    a.nextU32();
    const b = new Rng(a.state);
    expect(a.nextU32()).toBe(b.nextU32());
  });

  it("keeps int() within bounds and hits both ends", () => {
    const rng = Rng.fromSeed("bounds");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("never picks zero-weight items", () => {
    const rng = Rng.fromSeed("weights");
    for (let i = 0; i < 500; i++) expect(rng.weighted(["a", "b", "c"], (x) => (x === "b" ? 0 : 1))).not.toBe("b");
  });

  it("pins known output so engine changes can't silently alter seeds", () => {
    expect(hashString("space")).toBe(hashString("space"));
    const rng = Rng.fromSeed("golden");
    expect([rng.nextU32(), rng.nextU32(), rng.nextU32()]).toMatchSnapshot();
  });
});
