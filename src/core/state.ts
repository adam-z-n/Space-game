import type { BodyKind } from "../content/schema";

/**
 * The complete game state. Plain JSON data only (no classes, Maps, or functions),
 * so it can be cloned, saved, hashed, and sent over a network unchanged.
 */

export const STATE_VERSION = 1;

export type SystemId = number;
export type EmpireId = number;
export type FleetId = number;

export interface GameSettings {
  seed: string;
  galaxySize: string;
  /** Number of AI empires (2-5). */
  aiCount: number;
}

export interface Body {
  id: number;
  kind: BodyKind;
  /** Content ids; only set for planets. */
  planetType?: string;
  size?: string;
  richness?: string;
}

export interface StarSystem {
  id: SystemId;
  name: string;
  x: number;
  y: number;
  starType: string;
  bodies: Body[];
}

export interface Lane {
  a: SystemId;
  b: SystemId;
  /** Integer distance units; travel time is length / fleet speed. */
  length: number;
}

export interface Galaxy {
  systems: StarSystem[];
  lanes: Lane[];
}

export interface Empire {
  id: EmpireId;
  name: string;
  color: string;
  isAI: boolean;
  homeSystemId: SystemId;
  /** Systems this empire has visited, ascending. Basis for fog of war later. */
  explored: SystemId[];
  eliminated: boolean;
}

export interface Fleet {
  id: FleetId;
  empireId: EmpireId;
  name: string;
  /** Distance units per turn. */
  speed: number;
  /** System the fleet is at, or the one it departed from when in transit. */
  systemId: SystemId;
  /** Systems still to visit; route[0] is the next hop. Empty when idle. */
  route: SystemId[];
  /** Distance travelled along the lane toward route[0]. 0 means "in system". */
  progress: number;
}

export type GameEvent =
  | { type: "fleetArrived"; turn: number; empireId: EmpireId; fleetId: FleetId; systemId: SystemId }
  | { type: "systemExplored"; turn: number; empireId: EmpireId; systemId: SystemId };

export interface GameState {
  version: number;
  contentPack: { id: string; version: string };
  settings: GameSettings;
  turn: number;
  /** RNG state carried between turns for resolution randomness. */
  rngState: number;
  galaxy: Galaxy;
  empires: Empire[];
  fleets: Fleet[];
  nextId: number;
  /** Events produced by the most recent turn resolution (the turn report). */
  lastTurnEvents: GameEvent[];
}

export function getSystem(state: GameState, id: SystemId): StarSystem {
  const system = state.galaxy.systems[id];
  if (!system || system.id !== id) throw new Error(`no system ${id}`);
  return system;
}

export function getEmpire(state: GameState, id: EmpireId): Empire {
  const empire = state.empires[id];
  if (!empire || empire.id !== id) throw new Error(`no empire ${id}`);
  return empire;
}

export function findFleet(state: GameState, id: FleetId): Fleet | undefined {
  return state.fleets.find((f) => f.id === id);
}

export function isInTransit(fleet: Fleet): boolean {
  return fleet.progress > 0;
}

export function cloneState(state: GameState): GameState {
  // JSON round trip doubles as a guard that state stays plain data.
  return JSON.parse(JSON.stringify(state)) as GameState;
}
