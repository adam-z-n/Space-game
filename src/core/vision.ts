import { hasFlag } from "./economy";
import type { ContentPack } from "../content/schema";
import { buildAdjacency, knownLanes, laneLength, type Neighbor } from "./graph";
import { flagshipHull, fleetArmed, fleetStealthy, fleetStrength } from "./ships";
import { outpostSensorRange } from "./outposts";
import { defendingTroops } from "./defense";
import { fleetPosition, type EmpireId, type FleetPosition, type FleetSighting, type GameEvent, type GameState } from "./state";

/**
 * Fog of war. Every empire knows the star charts (systems and lanes), learns a
 * system's bodies by visiting it, and sees other fleets only within sensor range
 * of its home system or its own fleets. Outside that, it keeps last-known sightings.
 */

export interface Point {
  x: number;
  y: number;
}

/** Share of sensor range, in percent, at which cloaked fleets are detected. */
export const STEALTH_DETECTION_PERCENT = 33;

export function positionPoint(state: GameState, pos: FleetPosition): Point {
  const from = state.galaxy.systems[pos.systemId]!;
  if (pos.nextSystemId === null || pos.progress === 0) return { x: from.x, y: from.y };
  const to = state.galaxy.systems[pos.nextSystemId]!;
  const t = pos.progress / laneLength(state.galaxy, from.id, to.id)!;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

interface SensorSource extends Point {
  range: number;
}

export function sensorSources(state: GameState, pack: ContentPack, empireId: EmpireId): SensorSource[] {
  const empire = state.empires[empireId]!;
  const sources: SensorSource[] = [];
  for (const colony of state.colonies) {
    if (colony.empireId !== empireId) continue;
    const system = state.galaxy.systems[colony.systemId]!;
    // Sensor stations add to this colony only.
    const station = colony.buildings.reduce((n, id) => n + (pack.buildings.find((b) => b.id === id)?.effects.sensorRange ?? 0), 0);
    sources.push({ x: system.x, y: system.y, range: (colony.capital ? empire.capitalSensorRange : empire.colonySensorRange) + station });
  }
  for (const fleet of state.fleets) {
    if (fleet.empireId === empireId) sources.push({ ...positionPoint(state, fleetPosition(fleet)), range: fleet.sensorRange });
  }
  for (const outpost of state.outposts) {
    if (outpost.empireId !== empireId) continue;
    const system = state.galaxy.systems[outpost.systemId]!;
    sources.push({ x: system.x, y: system.y, range: outpostSensorRange(pack, empire, outpost) });
  }
  return sources;
}

export function inSensorRange(sources: readonly SensorSource[], p: Point): boolean {
  return sources.some((s) => {
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    return dx * dx + dy * dy <= s.range * s.range;
  });
}

/** The lane graph as `empireId` knows it: only lanes between charted systems. */
export function knownAdjacency(state: GameState, empireId: EmpireId): Neighbor[][] {
  const charted = new Set(state.empires[empireId]!.charted);
  return buildAdjacency(state.galaxy.systems.length, knownLanes(state.galaxy.lanes, charted));
}

/** Add systems in sensor range, and neighbors of explored systems, to an empire's charts. */
export function updateCharts(state: GameState, empireId: EmpireId, sources: readonly SensorSource[], surveyed = false): void {
  const empire = state.empires[empireId]!;
  const charted = new Set(empire.charted);
  const before = charted.size;
  // Galactic Survey: the whole map is charted.
  if (surveyed) for (const system of state.galaxy.systems) charted.add(system.id);
  for (const system of state.galaxy.systems) if (!charted.has(system.id) && inSensorRange(sources, system)) charted.add(system.id);
  // Visiting a system shows where its lanes lead.
  const explored = new Set(empire.explored);
  for (const lane of state.galaxy.lanes) {
    if (explored.has(lane.a)) charted.add(lane.b);
    if (explored.has(lane.b)) charted.add(lane.a);
  }
  for (const id of explored) charted.add(id);
  if (charted.size !== before || empire.charted.length !== before) empire.charted = [...charted].sort((a, b) => a - b);
}

/**
 * Refresh every empire's sightings for the current turn. Fleets in range are
 * stamped with state.turn; others keep their older entry. Sightings of fleets
 * that no longer exist are dropped once they come back into view.
 */
export function updateSightings(state: GameState, pack: ContentPack, events: GameEvent[] | null, eventTurn: number): void {
  for (const empire of state.empires) {
    const sources = sensorSources(state, pack, empire.id);
    updateCharts(state, empire.id, sources, hasFlag(pack, empire, "galacticSurvey"));
    const byId = new Map(empire.sightings.map((s) => [s.fleetId, s]));
    // Cloaked fleets show up only well inside sensor range (Tachyon Scanners see them at full range).
    const tachyon = hasFlag(pack, empire, "tachyonScanners");
    const close = tachyon ? sources : sources.map((s) => ({ ...s, range: Math.floor((s.range * STEALTH_DETECTION_PERCENT) / 100) }));
    for (const fleet of state.fleets) {
      if (fleet.empireId === empire.id) continue;
      const pos = fleetPosition(fleet);
      const stealthy = fleetStealthy(pack, state, fleet);
      if (!inSensorRange(stealthy ? close : sources, positionPoint(state, pos))) continue;
      const previous = byId.get(fleet.id);
      if (events && (!previous || previous.turn < state.turn - 1)) {
        events.push({ type: "fleetSighted", turn: eventTurn, empireId: empire.id, ownerId: fleet.empireId, fleetId: fleet.id, systemId: pos.systemId });
      }
      byId.set(fleet.id, {
        fleetId: fleet.id,
        empireId: fleet.empireId,
        name: fleet.name,
        ...pos,
        ships: fleet.ships.length,
        hull: flagshipHull(pack, state, fleet),
        // Sensor Spoofing: rivals read the fleet at half its strength.
        strength: Math.floor(fleetStrength(pack, state, fleet) / (hasFlag(pack, state.empires[fleet.empireId]!, "sensorSpoofing") ? 2 : 1)),
        armed: fleetArmed(pack, state, fleet),
        turn: state.turn,
      });
    }
    // A stale sighting whose spot is now in view but empty: the fleet has moved on.
    for (const [id, sighting] of byId) {
      if (sighting.turn !== state.turn && inSensorRange(sources, positionPoint(state, sighting))) byId.delete(id);
    }
    empire.sightings = [...byId.values()].sort((a: FleetSighting, b: FleetSighting) => a.fleetId - b.fleetId);

    // Colonies: same idea, keyed by colony id.
    const colonies = new Map(empire.colonySightings.map((c) => [c.colonyId, c]));
    for (const colony of state.colonies) {
      if (colony.empireId === empire.id) continue;
      const system = state.galaxy.systems[colony.systemId]!;
      if (!inSensorRange(sources, system)) continue;
      if (events && !colonies.has(colony.id)) {
        events.push({ type: "colonySighted", turn: eventTurn, empireId: empire.id, ownerId: colony.empireId, colonyId: colony.id, systemId: colony.systemId });
      }
      colonies.set(colony.id, {
        colonyId: colony.id,
        empireId: colony.empireId,
        systemId: colony.systemId,
        bodyId: colony.bodyId,
        name: colony.name,
        population: colony.population,
        defenseHp: colony.defenseHp,
        troops: defendingTroops(state, pack, colony),
        turn: state.turn,
      });
    }
    for (const [id, sighting] of colonies) {
      if (sighting.turn !== state.turn && inSensorRange(sources, state.galaxy.systems[sighting.systemId]!)) colonies.delete(id);
    }
    empire.colonySightings = [...colonies.values()].sort((a, b) => a.colonyId - b.colonyId);
  }
}
