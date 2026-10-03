import type { BattleReport, Body, BodyId, ColonyId, EmpireId, FleetId, FleetPosition, GameState, Lane, SystemId } from "./state";
import { colonyOnBody, fleetPosition } from "./state";
import type { ContentPack } from "../content/schema";
import { availableTechs, colonizeBlocker } from "./economy";
import { flagshipHull, fleetArmed, fleetCanColonize, fleetMaxSupply, fleetStrength } from "./ships";
import { suppliedSystems } from "./supply";
import { defendingTroops } from "./defense";
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
  /** Colonies the viewer knows about here: its own, plus rivals' current or last-known. */
  colonies: ColonyMarker[];
}

export interface ColonyMarker {
  colonyId: ColonyId;
  bodyId: BodyId;
  empireId: EmpireId;
  name: string;
  population: number;
  capital: boolean;
  own: boolean;
  seenTurn: number;
  /** Known for the viewer's own colonies only. */
  blockaded: boolean;
  /** Orbital defense hit points and ground troops, current for own colonies, as last seen for rivals. */
  defenseHp: number;
  troops: number;
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
  ships: number;
  /** Hull of the largest ship, for drawing the fleet. */
  hull: string;
  strength: number;
  armed: boolean;
  // Own fleets only:
  route: SystemId[] | null;
  speed: number | null;
  holding: boolean;
  /** Turns of supply left and the most it can hold; null for rivals. */
  supply: number | null;
  maxSupply: number | null;
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
  /** Systems where the viewer's fleets are supplied. */
  supplied: SystemId[];
  /** Battles the viewer took part in last turn. */
  battles: BattleReport[];
  /** The viewer's own minefields. */
  minefields: { systemId: SystemId; strength: number }[];
}

export function empireView(state: GameState, pack: ContentPack, viewerId: EmpireId): EmpireView {
  const viewer = state.empires[viewerId]!;
  const explored = new Set(viewer.explored);
  const markers = new Map<SystemId, ColonyMarker[]>();
  const addMarker = (systemId: SystemId, marker: ColonyMarker) => markers.set(systemId, [...(markers.get(systemId) ?? []), marker]);
  for (const c of state.colonies) {
    if (c.empireId !== viewerId) continue;
    addMarker(c.systemId, {
      colonyId: c.id,
      bodyId: c.bodyId,
      empireId: c.empireId,
      name: c.name,
      population: c.population,
      capital: c.capital,
      own: true,
      seenTurn: state.turn,
      blockaded: c.blockaded,
      defenseHp: c.defenseHp,
      troops: defendingTroops(state, pack, c),
    });
  }
  for (const c of viewer.colonySightings) {
    // Capitals sit on the homeworld, always the first body of the home system.
    const capital = state.empires[c.empireId]!.homeSystemId === c.systemId && state.galaxy.systems[c.systemId]!.bodies[0]?.id === c.bodyId;
    addMarker(c.systemId, {
      colonyId: c.colonyId,
      bodyId: c.bodyId,
      empireId: c.empireId,
      name: c.name,
      population: c.population,
      capital,
      own: false,
      seenTurn: c.turn,
      blockaded: false,
      defenseHp: c.defenseHp,
      troops: c.troops,
    });
  }

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
      colonies: (markers.get(s.id) ?? []).sort((a, b) => a.colonyId - b.colonyId),
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
      ships: fleet.ships.length,
      hull: flagshipHull(pack, state, fleet),
      strength: fleetStrength(pack, state, fleet),
      armed: fleetArmed(pack, state, fleet),
      route: [...fleet.route],
      speed: fleet.speed,
      holding: fleet.holding,
      supply: fleet.supply,
      maxSupply: fleetMaxSupply(pack, state, fleet),
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
      ships: s.ships,
      hull: s.hull,
      strength: s.strength,
      armed: s.armed,
      route: null,
      speed: null,
      holding: false,
      supply: null,
      maxSupply: null,
    });
  }

  const met = new Set<EmpireId>([viewerId, ...viewer.sightings.map((s) => s.empireId), ...viewer.colonySightings.map((c) => c.empireId)]);

  return {
    turn: state.turn,
    viewerId,
    systems,
    lanes: state.galaxy.lanes,
    fleets,
    empires: state.empires.map((e) => ({ id: e.id, name: e.name, color: e.color, met: met.has(e.id) })),
    sensors: sensorSources(state, pack, viewerId),
    supplied: [...suppliedSystems(state, pack, viewerId)].sort((a, b) => a - b),
    battles: state.lastBattles.filter((b) => b.empires.includes(viewerId)),
    minefields: state.minefields.filter((m) => m.empireId === viewerId).map((m) => ({ systemId: m.systemId, strength: m.strength })),
  };
}

/** Full-knowledge view, for debugging and spectating AI games. */
export function omniscientView(state: GameState, pack: ContentPack, viewerId: EmpireId): EmpireView {
  const view = empireView(state, pack, viewerId);
  return {
    ...view,
    systems: state.galaxy.systems.map((s) => ({
      ...s,
      explored: true,
      colonies: state.colonies
        .filter((c) => c.systemId === s.id)
        .map((c) => ({
          colonyId: c.id,
          bodyId: c.bodyId,
          empireId: c.empireId,
          name: c.name,
          population: c.population,
          capital: c.capital,
          own: c.empireId === viewerId,
          seenTurn: state.turn,
          blockaded: c.blockaded,
          defenseHp: c.defenseHp,
          troops: defendingTroops(state, pack, c),
        })),
    })),
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
        ships: f.ships.length,
        hull: flagshipHull(pack, state, f),
        strength: fleetStrength(pack, state, f),
        armed: fleetArmed(pack, state, f),
        route: [...f.route],
        speed: f.speed,
        holding: f.holding,
        supply: f.supply,
        maxSupply: fleetMaxSupply(pack, state, f),
      };
    }),
    empires: view.empires.map((e) => ({ ...e, met: true })),
    battles: state.lastBattles,
  };
}

export type AttentionItem =
  | { type: "chooseResearch" }
  | { type: "emptyQueue"; colonyId: ColonyId; systemId: SystemId }
  | { type: "canColonize"; fleetId: FleetId; systemId: SystemId }
  | { type: "idleFleet"; fleetId: FleetId; systemId: SystemId };

/** Things the player probably wants to handle before ending the turn, most important first. */
export function attentionItems(state: GameState, pack: ContentPack, empireId: EmpireId): AttentionItem[] {
  const empire = state.empires[empireId]!;
  const items: AttentionItem[] = [];
  if (empire.research.current === null && availableTechs(pack, empire).length > 0) items.push({ type: "chooseResearch" });
  for (const colony of state.colonies) {
    if (colony.empireId === empireId && colony.queue.length === 0) items.push({ type: "emptyQueue", colonyId: colony.id, systemId: colony.systemId });
  }
  const idle = state.fleets.filter((f) => f.empireId === empireId && f.route.length === 0 && !f.holding).sort((a, b) => a.id - b.id);
  for (const fleet of idle) {
    const canSettle =
      fleetCanColonize(pack, state, fleet) &&
      state.galaxy.systems[fleet.systemId]!.bodies.some((b) => !colonyOnBody(state, b.id) && colonizeBlocker(pack, empire, b) === null);
    items.push({ type: canSettle ? "canColonize" : "idleFleet", fleetId: fleet.id, systemId: fleet.systemId });
  }
  return items;
}

export interface OddsEstimate {
  /** Combined strength of armed rival fleets known at the destination. */
  enemyStrength: number;
  /** How old the newest relevant intel is, in turns; null when nothing is known. */
  intelAge: number | null;
  verdict: "unopposed" | "favorable" | "even" | "unfavorable" | "unknown";
  /** Systems on the way where known armed rivals will stop the fleet. */
  blockedAt: SystemId[];
}

/**
 * Fog-aware pre-battle odds: compares a fleet's strength with what the viewer
 * knows is at the destination (and on the way). Intel older than a few turns
 * counts but is flagged by its age.
 */
export function estimateOdds(view: EmpireView, ownStrength: number, route: SystemId[]): OddsEstimate {
  const destination = route[route.length - 1];
  const known = (systemId: SystemId) =>
    view.fleets.filter((f) => !f.own && f.armed && f.position.progress === 0 && f.position.systemId === systemId && f.seenTurn >= view.turn - 5);
  const blockedAt = route.slice(0, -1).filter((id) => known(id).length > 0);
  if (destination === undefined) return { enemyStrength: 0, intelAge: null, verdict: "unopposed", blockedAt };
  const enemies = known(destination);
  const enemyStrength = enemies.reduce((n, f) => n + f.strength, 0);
  const intelAge = enemies.length > 0 ? view.turn - Math.max(...enemies.map((f) => f.seenTurn)) : null;
  const inSensors = view.sensors.some((s) => {
    const sys = view.systems[destination]!;
    const dx = s.x - sys.x;
    const dy = s.y - sys.y;
    return dx * dx + dy * dy <= s.range * s.range;
  });
  let verdict: OddsEstimate["verdict"];
  if (enemyStrength === 0) verdict = inSensors ? "unopposed" : "unknown";
  else if (ownStrength * 10 >= enemyStrength * 15) verdict = "favorable";
  else if (ownStrength * 10 >= enemyStrength * 8) verdict = "even";
  else verdict = "unfavorable";
  return { enemyStrength, intelAge, verdict, blockedAt };
}
