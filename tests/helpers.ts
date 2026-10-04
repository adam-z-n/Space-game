import raw from "../content/default/pack.json";
import { loadContentPack, type Fleet, type GameState } from "../src/core";

/**
 * The default pack plus unarmed test hulls with round-number speeds and huge
 * endurance, so movement and vision tests aren't affected by supply or combat.
 */
export const testPack = loadContentPack({
  ...raw,
  hulls: [
    ...raw.hulls,
    { id: "test60", name: "Test 60", description: "", slots: 2, structure: 10, cost: 1, upkeep: 0, speed: 60, sensorRange: 0, evasion: 0, maneuver: 2, endurance: 99 },
    { id: "test100", name: "Test 100", description: "", slots: 2, structure: 10, cost: 1, upkeep: 0, speed: 100, sensorRange: 120, evasion: 0, maneuver: 2, endurance: 99 },
  ],
  // No planetary batteries: they would shoot at the unarmed test fleets.
  combat: { ...raw.combat, colonyDefenseHpPerPop: 0, colonyPopPerGun: 1000 },
  presentation: {
    ...raw.presentation,
    hullSprites: { ...raw.presentation.hullSprites, test60: raw.presentation.hullSprites.corvette, test100: raw.presentation.hullSprites.corvette },
  },
});

/** Give every empire the test designs and return a one-ship fleet of `hull`. */
export function testFleet(state: GameState, opts: { id: number; empireId: number; systemId: number; hull: "test60" | "test100"; name?: string }): Fleet {
  for (const empire of state.empires) {
    for (const hull of ["test60", "test100"]) {
      if (!empire.designs.some((d) => d.id === hull)) empire.designs.push({ id: hull, name: hull, hull, components: [], formation: "support", obsolete: false });
    }
  }
  const speed = opts.hull === "test60" ? 60 : 100;
  return {
    id: opts.id,
    empireId: opts.empireId,
    name: opts.name ?? `Test ${opts.id}`,
    ships: [{ id: opts.id * 10, designId: opts.hull, hp: 10 }],
    orders: { mission: "evade", stance: "cautious", targetPriority: "any", retreatPercent: 25 },
    supply: 99,
    speed,
    sensorRange: opts.hull === "test60" ? 0 : 120,
    systemId: opts.systemId,
    route: [],
    progress: 0,
    holding: false,
    invadeColonyId: null,
    bombardColonyId: null,
    sabotage: null,
  };
}

/**
 * Keep one capital per empire, moved to the given systems, with sensors off so
 * it doesn't affect vision tests. Empires need a colony or they are eliminated.
 */
export function relocateCapitals(state: GameState, systems: number[]): void {
  state.colonies = state.colonies.filter((c) => c.capital && c.empireId < systems.length);
  for (const colony of state.colonies) {
    colony.systemId = systems[colony.empireId]!;
    // No defenses either: they would shoot at test fleets.
    colony.buildings = colony.buildings.filter((id) => id === "capitol");
    colony.defenseHp = 0;
    colony.troops = 0;
    const system = state.galaxy.systems[colony.systemId]!;
    if (!system.bodies.some((b) => b.id === colony.bodyId)) {
      system.bodies.push({ id: colony.bodyId, kind: "planet", planetType: "terran", size: "medium", richness: "normal" });
    }
  }
  for (const empire of state.empires) {
    empire.capitalSensorRange = 0;
    empire.colonySensorRange = 0;
  }
}

/** Put every system on every empire's star charts, so tests can route fleets anywhere. */
export function chartAll(state: GameState): void {
  for (const empire of state.empires) empire.charted = state.galaxy.systems.map((s) => s.id);
}
