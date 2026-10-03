import type { BodyKind, Formation } from "../content/schema";

/**
 * The complete game state. Plain JSON data only (no classes, Maps, or functions),
 * so it can be cloned, saved, hashed, and sent over a network unchanged.
 */

export const STATE_VERSION = 6;

export type SystemId = number;
export type EmpireId = number;
export type FleetId = number;
export type ColonyId = number;
export type BodyId = number;
export type ShipId = number;

export interface GameSettings {
  seed: string;
  galaxySize: string;
  /** Number of AI empires (2-5). */
  aiCount: number;
  /** AI also plays empire 0; for batch testing and spectating. */
  allAI?: boolean;
  /** Content difficulty id for AI empires; defaults to "normal". */
  difficulty?: string;
  /** Overrides the content pack's turn limit. */
  turnLimit?: number;
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
  /** AI personality id (content); null for human players. */
  personality: string | null;
  /** Difficulty id whose effects apply to this empire; null for human players. */
  difficulty: string | null;
  homeSystemId: SystemId;
  /** Systems this empire has visited, ascending. Their bodies are known. */
  explored: SystemId[];
  /** Sensor ranges of the capital and other colonies (tech bonuses included). */
  capitalSensorRange: number;
  colonySensorRange: number;
  /** Last-known positions of other empires' fleets, by fleet id. */
  sightings: FleetSighting[];
  /** Last-known colonies of other empires, by colony id. */
  colonySightings: ColonySighting[];
  /** Treasury. Negative means in debt. */
  credits: number;
  /** Stored food, shared by all colonies. */
  food: number;
  /** Researched tech ids, in the order completed. */
  techs: string[];
  /** Tech being researched, or null. Points bank up while nothing is chosen. */
  research: { current: string | null; progress: number };
  /** Counts fleets created per design, for naming. */
  shipsBuilt: Record<string, number>;
  /** Ship designs: the content pack's starting designs plus the player's own. */
  designs: ShipDesign[];
  eliminated: boolean;
}

export const FOCUSES = ["balanced", "industry", "research", "food"] as const;
export type Focus = (typeof FOCUSES)[number];

export interface QueueItem {
  kind: "building" | "ship";
  /** Building or ship template id. */
  id: string;
}

export interface Colony {
  id: ColonyId;
  empireId: EmpireId;
  systemId: SystemId;
  bodyId: BodyId;
  name: string;
  capital: boolean;
  population: number;
  /** Points toward the next population; see economy.growthThreshold. */
  growth: number;
  focus: Focus;
  buildings: string[];
  queue: QueueItem[];
  /** Industry invested in queue[0]. */
  progress: number;
  /** An enemy warship sits in orbit with no defender: no supply projection and no trade income. */
  blockaded: boolean;
  /** Orbital defense hit points left (max comes from buildings); 0 means defenses are down. */
  defenseHp: number;
  /** Garrison troops (militia from population comes on top). */
  troops: number;
}

export interface ColonySighting {
  colonyId: ColonyId;
  empireId: EmpireId;
  systemId: SystemId;
  bodyId: BodyId;
  name: string;
  population: number;
  /** Orbital defense hit points and ground troops (garrison plus militia) as observed. */
  defenseHp: number;
  troops: number;
  turn: number;
}

/** Where a fleet is: in a system, or `progress` distance along the lane toward `nextSystemId`. */
export interface FleetPosition {
  systemId: SystemId;
  nextSystemId: SystemId | null;
  progress: number;
}

export interface FleetSighting extends FleetPosition {
  fleetId: FleetId;
  empireId: EmpireId;
  name: string;
  ships: number;
  /** Rough combat strength as observed (see fleetStrength). */
  strength: number;
  armed: boolean;
  /** Turn this was observed. Equal to the current turn while the fleet is in sensor range. */
  turn: number;
}

export interface ShipDesign {
  id: string;
  name: string;
  hull: string;
  components: string[];
  formation: Formation;
  /** Hidden from build lists; existing ships keep working. */
  obsolete: boolean;
}

export interface Ship {
  id: ShipId;
  designId: string;
  hp: number;
}

export const STANCES = ["aggressive", "balanced", "cautious"] as const;
export type Stance = (typeof STANCES)[number];
export const TARGET_PRIORITIES = ["warships", "transports", "any"] as const;
export type TargetPriority = (typeof TARGET_PRIORITIES)[number];
export const MISSIONS = ["engage", "evade"] as const;
export type Mission = (typeof MISSIONS)[number];

export interface FleetOrders {
  /** engage: fight hostiles it meets. evade: try to slip away after the first round. */
  mission: Mission;
  stance: Stance;
  targetPriority: TargetPriority;
  /** Withdraw once this percent of the fleet's starting hit points is lost (100 = never). */
  retreatPercent: number;
}

export interface Fleet {
  id: FleetId;
  empireId: EmpireId;
  name: string;
  ships: Ship[];
  orders: FleetOrders;
  /** Turns of onboard supply left; refilled inside supply range. */
  supply: number;
  /** Cached from ships and techs (see refreshFleetStats); slowest ship, out-of-supply penalty included. */
  speed: number;
  /** System the fleet is at, or the one it departed from when in transit. */
  systemId: SystemId;
  /** Systems still to visit; route[0] is the next hop. Empty when idle. */
  route: SystemId[];
  /** Distance travelled along the lane toward route[0]. 0 means "in system". */
  progress: number;
  /** Cached: best sensor range among its ships. */
  sensorRange: number;
  /** Player told this fleet to stay put; idle holding fleets don't need attention. */
  holding: boolean;
  /** Land this fleet's troops on this colony once its orbital defenses are down. */
  invadeColonyId: ColonyId | null;
}

export type GameEvent =
  | { type: "fleetArrived"; turn: number; empireId: EmpireId; fleetId: FleetId; systemId: SystemId }
  | { type: "systemExplored"; turn: number; empireId: EmpireId; systemId: SystemId }
  /** `empireId` spotted a fleet of `ownerId` that was not in sensor range last turn. */
  | { type: "fleetSighted"; turn: number; empireId: EmpireId; ownerId: EmpireId; fleetId: FleetId; systemId: SystemId }
  | { type: "colonySighted"; turn: number; empireId: EmpireId; ownerId: EmpireId; colonyId: ColonyId; systemId: SystemId }
  | { type: "colonyFounded"; turn: number; empireId: EmpireId; colonyId: ColonyId; systemId: SystemId }
  | { type: "buildingCompleted"; turn: number; empireId: EmpireId; colonyId: ColonyId; systemId: SystemId; buildingId: string }
  | { type: "shipCompleted"; turn: number; empireId: EmpireId; colonyId: ColonyId; systemId: SystemId; fleetId: FleetId }
  | { type: "techResearched"; turn: number; empireId: EmpireId; techId: string }
  | { type: "populationGrew"; turn: number; empireId: EmpireId; colonyId: ColonyId; systemId: SystemId; population: number }
  | { type: "starvation"; turn: number; empireId: EmpireId }
  | { type: "inDebt"; turn: number; empireId: EmpireId; credits: number }
  | { type: "battle"; turn: number; empireId: EmpireId; systemId: SystemId; battleId: number; outcome: "won" | "lost" | "draw" }
  | { type: "outOfSupply"; turn: number; empireId: EmpireId; fleetId: FleetId; systemId: SystemId }
  | { type: "attrition"; turn: number; empireId: EmpireId; fleetId: FleetId; systemId: SystemId; shipsLost: number }
  | { type: "fleetIntercepted"; turn: number; empireId: EmpireId; fleetId: FleetId; systemId: SystemId }
  | { type: "blockaded"; turn: number; empireId: EmpireId; colonyId: ColonyId; systemId: SystemId }
  | { type: "empireEliminated"; turn: number; empireId: EmpireId; eliminatedId: EmpireId }
  /** Sent to both sides. */
  | {
      type: "invasion";
      turn: number;
      empireId: EmpireId;
      attackerId: EmpireId;
      defenderId: EmpireId;
      colonyId: ColonyId;
      systemId: SystemId;
      captured: boolean;
      attackingTroops: number;
      defendingTroops: number;
    }
  | { type: "defensesDown"; turn: number; empireId: EmpireId; colonyId: ColonyId; systemId: SystemId }
  | { type: "mineHits"; turn: number; empireId: EmpireId; systemId: SystemId; hits: number; shipsLost: number }
  | { type: "capitalMoved"; turn: number; empireId: EmpireId; colonyId: ColonyId; systemId: SystemId }
  | { type: "gameOver"; turn: number; empireId: EmpireId; winnerId: EmpireId; reason: GameOutcome["reason"] };

export interface Minefield {
  systemId: SystemId;
  empireId: EmpireId;
  strength: number;
}

export interface GameOutcome {
  winnerId: EmpireId;
  reason: "domination" | "turnLimit" | "elimination";
  turn: number;
}

export interface BattleShip {
  shipId: ShipId;
  fleetId: FleetId;
  empireId: EmpireId;
  designName: string;
  hp: number;
  maxHp: number;
}

export interface BattleShot {
  attacker: ShipId;
  target: ShipId;
  /** 0 on a miss. */
  damage: number;
  destroyed: boolean;
}

export interface BattleReport {
  id: number;
  turn: number;
  systemId: SystemId;
  empires: EmpireId[];
  ships: BattleShip[];
  rounds: { shots: BattleShot[]; retreated: FleetId[] }[];
  /** Per empire: ships lost and fleets that withdrew. */
  results: { empireId: EmpireId; shipsLost: number; retreated: FleetId[]; damageDealt: number }[];
}

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
  colonies: Colony[];
  nextId: number;
  /** Events produced by the most recent turn resolution (the turn report). */
  lastTurnEvents: GameEvent[];
  /** Battles fought in the most recent turn resolution, for reports and replay. */
  lastBattles: BattleReport[];
  /** Set when the game ends; no further turns resolve. */
  outcome: GameOutcome | null;
  /** Mines each empire keeps in a system; they hit other empires' ships that stop there. */
  minefields: Minefield[];
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

export function findColony(state: GameState, id: ColonyId): Colony | undefined {
  return state.colonies.find((c) => c.id === id);
}

export function colonyOnBody(state: GameState, bodyId: BodyId): Colony | undefined {
  return state.colonies.find((c) => c.bodyId === bodyId);
}

export function isInTransit(fleet: Fleet): boolean {
  return fleet.progress > 0;
}

export function fleetPosition(fleet: Fleet): FleetPosition {
  return fleet.progress > 0
    ? { systemId: fleet.systemId, nextSystemId: fleet.route[0]!, progress: fleet.progress }
    : { systemId: fleet.systemId, nextSystemId: null, progress: 0 };
}

export function cloneState(state: GameState): GameState {
  // JSON round trip doubles as a guard that state stays plain data.
  return JSON.parse(JSON.stringify(state)) as GameState;
}
