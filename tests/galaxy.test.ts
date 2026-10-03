import { describe, expect, it } from "vitest";
import { buildAdjacency, createInitialState, isConnected, type GameSettings } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();
const SEEDS = Array.from({ length: 25 }, (_, i) => `seed-${i}`);

describe.each(pack.galaxySizes.map((g) => g.id))("galaxy generation (%s)", (galaxySize) => {
  const size = pack.galaxySizes.find((g) => g.id === galaxySize)!;

  it.each(SEEDS)("produces a valid galaxy for %s", (seed) => {
    const settings: GameSettings = { seed, galaxySize, aiCount: 5 };
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
