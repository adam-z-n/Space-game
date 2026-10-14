import { describe, expect, it } from "vitest";
import { buildAdjacency, createInitialState, isConnected, type GameSettings } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();
const SEEDS = Array.from({ length: 25 }, (_, i) => `seed-${i}`);

const CASES = pack.galaxyTypes.flatMap((t) => pack.galaxySizes.map((g) => [t.id, g.id] as const));

describe.each(CASES)("galaxy generation (%s, %s)", (galaxyType, galaxySize) => {
  const size = pack.galaxySizes.find((g) => g.id === galaxySize)!;
  // Every seed for the standard map; a sample for the other types.
  const seeds = galaxyType === "standard" ? SEEDS : SEEDS.slice(0, 8);

  it.each(seeds)("produces a valid galaxy for %s", (seed) => {
    const settings: GameSettings = { seed, galaxySize, galaxyType, aiCount: 5 };
    const { galaxy, empires, fleets } = createInitialState(settings, pack);
    const n = galaxy.systems.length;

    expect(n).toBe(size.systems);
    galaxy.systems.forEach((s, i) => expect(s.id).toBe(i));
    expect(new Set(galaxy.systems.map((s) => s.name)).size).toBe(n);

    // Lanes: valid, normalized (a < b), unique, positive length.
    const keys = new Set<string>();
    for (const lane of galaxy.lanes) {
      expect(lane.a).toBeLessThan(lane.b);
      expect(lane.b).toBeLessThan(n);
      expect(lane.length).toBeGreaterThan(0);
      keys.add(`${lane.a}-${lane.b}`);
    }
    expect(keys.size).toBe(galaxy.lanes.length);

    const adj = buildAdjacency(n, galaxy.lanes);
    expect(isConnected(adj)).toBe(true);

    for (const system of galaxy.systems) {
      expect(system.bodies.length).toBeLessThanOrEqual(5);
      for (const body of system.bodies) {
        if (body.kind === "planet") {
          expect(pack.planetTypes.some((t) => t.id === body.planetType)).toBe(true);
          expect(pack.planetSizes.some((t) => t.id === body.size)).toBe(true);
          expect(pack.richness.some((t) => t.id === body.richness)).toBe(true);
        }
      }
    }

    // Body ids are unique across the galaxy, and fleet ids don't collide with them.
    const ids = [...galaxy.systems.flatMap((s) => s.bodies.map((b) => b.id)), ...fleets.map((f) => f.id)];
    expect(new Set(ids).size).toBe(ids.length);

    // Every empire gets a distinct home with the standard homeworld and its starting fleets.
    const homes = empires.map((e) => e.homeSystemId);
    expect(new Set(homes).size).toBe(6);
    for (const empire of empires) {
      const home = galaxy.systems[empire.homeSystemId]!;
      expect(home.bodies[0]).toMatchObject({ kind: "planet", planetType: "terran", size: "medium", richness: "normal" });
      expect(fleets.filter((f) => f.empireId === empire.id && f.systemId === home.id)).toHaveLength(pack.start.fleets.length);
    }

    // Homes are not crammed together: no lane joins two home systems.
    for (const home of homes) {
      for (const neighbor of adj[home]!) expect(homes).not.toContain(neighbor.id);
    }
  });
});

describe("galaxy types", () => {
  const galaxies = (galaxyType: string) => SEEDS.slice(0, 10).map((seed) => createInitialState({ seed, galaxySize: "medium", galaxyType, aiCount: 3 }, pack).galaxy);
  const emptyShare = (galaxyType: string) => {
    const systems = galaxies(galaxyType).flatMap((g) => g.systems);
    return systems.filter((x) => !x.bodies.some((b) => b.kind === "planet")).length / systems.length;
  };

  it("sparse maps have far more planet-free systems than dense ones", () => {
    const sparse = emptyShare("sparse");
    const standard = emptyShare("standard");
    const dense = emptyShare("dense");
    expect(sparse).toBeGreaterThan(standard + 0.15);
    expect(dense).toBeLessThan(standard - 0.1);
  });

  it("clusters are tightly linked inside and joined by few lanes", () => {
    for (const galaxy of galaxies("clusters")) {
      const adj = buildAdjacency(galaxy.systems.length, galaxy.lanes);
      // Long lanes (well over a cluster's width) are the links between clusters.
      const long = galaxy.lanes.filter((l) => l.length > 450).length;
      expect(long).toBeLessThan(galaxy.lanes.length / 4);
      expect(isConnected(adj)).toBe(true);
    }
  });

  it("rings leave the middle of the map empty", () => {
    for (const galaxy of galaxies("ring")) {
      const xs = galaxy.systems.map((x) => x.x);
      const ys = galaxy.systems.map((x) => x.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const rx = (Math.max(...xs) - Math.min(...xs)) / 2;
      const ry = (Math.max(...ys) - Math.min(...ys)) / 2;
      const inner = galaxy.systems.filter((x) => ((x.x - cx) / rx) ** 2 + ((x.y - cy) / ry) ** 2 < 0.2);
      expect(inner).toHaveLength(0);
    }
  });

  it("rejects unknown types", () => {
    expect(() => createInitialState({ seed: "x", galaxySize: "small", galaxyType: "donut", aiCount: 2 }, pack)).toThrow(/galaxy type/);
  });
});

describe("determinism", () => {
  it("same settings give an identical state", () => {
    const settings: GameSettings = { seed: "repeat", galaxySize: "medium", aiCount: 3 };
    expect(createInitialState(settings, pack)).toEqual(createInitialState(settings, pack));
  });

  it("different seeds give different galaxies", () => {
    const a = createInitialState({ seed: "one", galaxySize: "small", aiCount: 2 }, pack);
    const b = createInitialState({ seed: "two", galaxySize: "small", aiCount: 2 }, pack);
    expect(a.galaxy).not.toEqual(b.galaxy);
  });

  it("rejects bad settings", () => {
    expect(() => createInitialState({ seed: "x", galaxySize: "huge", aiCount: 2 }, pack)).toThrow(/galaxy size/);
    expect(() => createInitialState({ seed: "x", galaxySize: "small", aiCount: 1 }, pack)).toThrow(/AI count/);
    expect(() => createInitialState({ seed: "x", galaxySize: "small", aiCount: 6 }, pack)).toThrow(/AI count/);
  });
});
