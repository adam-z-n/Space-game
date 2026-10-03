import type { Body, EmpireId, FleetId, FleetPosition, GameState, Lane, SystemId } from "./state";
import { fleetPosition } from "./state";
import { positionPoint, sensorSources } from "./vision";

/**
 * What one empire is allowed to know. The UI renders only this, never raw
 * GameState, so fog of war can't leak through the interface. The same view is
 * what a remote player would receive in multiplayer.
 */

export interface SystemView {
  id: SystemId;
  name: string;
  x: number;
  y: number;
  starType: string;
  explored: boolean;
  /** Known only once explored. */
  bodies: Body[] | null;
  /** Whose home this is, if the viewer has explored it. */
  homeOf: EmpireId | null;
}

export interface FleetView {
  id: FleetId;
  empireId: EmpireId;
  name: string;
  own: boolean;
  position: FleetPosition;
  x: number;
  y: number;
  /** Turn the position was observed; less than the current turn means last-known only. */
  seenTurn: number;
  // Own fleets only:
  route: SystemId[] | null;
  speed: number | null;
  holding: boolean;
}

export interface EmpireSummary {
  id: EmpireId;
  name: string;
  color: string;
  /** The viewer has seen one of this empire's fleets or explored its home. */
  met: boolean;
}

export interface EmpireView {
  turn: number;
  viewerId: EmpireId;
  systems: SystemView[];
  lanes: Lane[];
  fleets: FleetView[];
  empires: EmpireSummary[];
  /** The viewer's sensor coverage, for drawing. */
  sensors: { x: number; y: number; range: number }[];
}

export function empireView(state: GameState, viewerId: EmpireId): EmpireView {
  const viewer = state.empires[viewerId]!;
  const explored = new Set(viewer.explored);
  const homes = new Map(state.empires.map((e) => [e.homeSystemId, e.id]));

  const systems: SystemView[] = state.galaxy.systems.map((s) => {
    const known = explored.has(s.id);
    return {
      id: s.id,
      name: s.name,
      x: s.x,
      y: s.y,
      starType: s.starType,
      explored: known,
      bodies: known ? s.bodies : null,
      homeOf: known ? (homes.get(s.id) ?? null) : null,
    };
  });

  const fleets: FleetView[] = [];
  for (const fleet of state.fleets) {
    if (fleet.empireId !== viewerId) continue;
    const position = fleetPosition(fleet);
    fleets.push({
      id: fleet.id,
      empireId: fleet.empireId,
      name: fleet.name,
      own: true,
      position,
      ...positionPoint(state, position),
      seenTurn: state.turn,
      route: [...fleet.route],
      speed: fleet.speed,
      holding: fleet.holding,
    });
  }
  for (const s of viewer.sightings) {
    const position = { systemId: s.systemId, nextSystemId: s.nextSystemId, progress: s.progress };
    fleets.push({
      id: s.fleetId,
      empireId: s.empireId,
      name: s.name,
      own: false,
      position,
      ...positionPoint(state, position),
      seenTurn: s.turn,
      route: null,
      speed: null,
      holding: false,
    });
  }

  const met = new Set<EmpireId>([viewerId, ...viewer.sightings.map((s) => s.empireId)]);
  for (const system of systems) if (system.homeOf !== null) met.add(system.homeOf);

  return {
    turn: state.turn,
    viewerId,
    systems,
    lanes: state.galaxy.lanes,
    fleets,
    empires: state.empires.map((e) => ({ id: e.id, name: e.name, color: e.color, met: met.has(e.id) })),
    sensors: sensorSources(state, viewerId),
  };
}

/** Full-knowledge view, for debugging and spectating AI games. */
export function omniscientView(state: GameState, viewerId: EmpireId): EmpireView {
  const view = empireView(state, viewerId);
  const homes = new Map(state.empires.map((e) => [e.homeSystemId, e.id]));
  return {
    ...view,
    systems: state.galaxy.systems.map((s) => ({ ...s, explored: true, homeOf: homes.get(s.id) ?? null })),
    fleets: state.fleets.map((f) => {
      const position = fleetPosition(f);
      return {
        id: f.id,
        empireId: f.empireId,
        name: f.name,
        own: f.empireId === viewerId,
        position,
        ...positionPoint(state, position),
        seenTurn: state.turn,
        route: [...f.route],
        speed: f.speed,
        holding: f.holding,
      };
    }),
    empires: view.empires.map((e) => ({ ...e, met: true })),
  };
}

export type AttentionItem = { type: "idleFleet"; fleetId: FleetId; systemId: SystemId };

/** Things the player probably wants to handle before ending the turn. */
export function attentionItems(state: GameState, empireId: EmpireId): AttentionItem[] {
  return state.fleets
    .filter((f) => f.empireId === empireId && f.route.length === 0 && !f.holding)
    .sort((a, b) => a.id - b.id)
    .map((f) => ({ type: "idleFleet", fleetId: f.id, systemId: f.systemId }));
}
