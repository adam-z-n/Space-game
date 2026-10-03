import type { ContentPack } from "../content/schema";
import { laneLength } from "./graph";
import { flagshipHull, fleetArmed, fleetStrength } from "./ships";
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
  return sources;
}

export function inSensorRange(sources: readonly SensorSource[], p: Point): boolean {
  return sources.some((s) => {
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    return dx * dx + dy * dy <= s.range * s.range;
  });
}

/**
 * Refresh every empire's sightings for the current turn. Fleets in range are
 * stamped with state.turn; others keep their older entry. Sightings of fleets
 * that no longer exist are dropped once they come back into view.
 */
export function updateSightings(state: GameState, pack: ContentPack, events: GameEvent[] | null, eventTurn: number): void {
  for (const empire of state.empires) {
    const sources = sensorSources(state, pack, empire.id);
    const byId = new Map(empire.sightings.map((s) => [s.fleetId, s]));
    for (const fleet of state.fleets) {
      if (fleet.empireId === empire.id) continue;
      const pos = fleetPosition(fleet);
      if (!inSensorRange(sources, positionPoint(state, pos))) continue;
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
        strength: fleetStrength(pack, state, fleet),
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
