import { laneLength } from "./graph";
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

export function sensorSources(state: GameState, empireId: EmpireId): SensorSource[] {
  const empire = state.empires[empireId]!;
  const home = state.galaxy.systems[empire.homeSystemId]!;
  const sources: SensorSource[] = [{ x: home.x, y: home.y, range: empire.homeSensorRange }];
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
export function updateSightings(state: GameState, events: GameEvent[] | null, eventTurn: number): void {
  for (const empire of state.empires) {
    const sources = sensorSources(state, empire.id);
    const byId = new Map(empire.sightings.map((s) => [s.fleetId, s]));
    for (const fleet of state.fleets) {
      if (fleet.empireId === empire.id) continue;
      const pos = fleetPosition(fleet);
      if (!inSensorRange(sources, positionPoint(state, pos))) continue;
      const previous = byId.get(fleet.id);
      if (events && (!previous || previous.turn < state.turn - 1)) {
        events.push({ type: "fleetSighted", turn: eventTurn, empireId: empire.id, ownerId: fleet.empireId, fleetId: fleet.id, systemId: pos.systemId });
      }
      byId.set(fleet.id, { fleetId: fleet.id, empireId: fleet.empireId, name: fleet.name, ...pos, turn: state.turn });
    }
    // A stale sighting whose spot is now in view but empty: the fleet has moved on.
    for (const [id, sighting] of byId) {
      if (sighting.turn !== state.turn && inSensorRange(sources, positionPoint(state, sighting))) byId.delete(id);
    }
    empire.sightings = [...byId.values()].sort((a: FleetSighting, b: FleetSighting) => a.fleetId - b.fleetId);
  }
}
