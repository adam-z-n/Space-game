import type { ContentPack, DesignData } from "../content/schema";
import { findPath, laneLength } from "./graph";
import { knownAdjacency } from "./vision";
import {
  FOCUSES,
  MISSIONS,
  OUTPOST_KINDS,
  SABOTAGE_MISSIONS,
  STANCES,
  TARGET_PRIORITIES,
  cloneState,
  colonyOnBody,
  findColony,
  findFleet,
  isInTransit,
  type BodyId,
  type Colony,
  type ColonyId,
  type EmpireId,
  type Fleet,
  type FleetId,
  type Focus,
  type FleetOrders,
  type GameState,
  type Outpost,
  type OutpostKind,
  type SabotageMission,
  type ShipId,
  type QueueItem,
  type SystemId,
} from "./state";
import { buildBlocker, buyCost, colonizeBlocker, empireEffects, itemCost, newColony, techAvailable } from "./economy";
import { designBlocker, designStats, fleetCanColonize, fleetMaxSupply, fleetShipStats, getDesign, refreshFleetStats } from "./ships";
import { suppliedSystems } from "./supply";
import { outpostBlocker, outpostDefense, outpostTechOk } from "./outposts";
import { colonyDefense, fleetTroops } from "./defense";
import { resolveTurn } from "./turn";

/**
 * Every change to the game, by the player or the AI, is one of these commands.
 * Commands are plain JSON so a game is fully described by its settings plus its
 * command log: that log is the save file, the replay, and later the multiplayer protocol.
 */
export type Command =
  /** Route a fleet to a destination; using the fleet's current system cancels its orders. */
  | { type: "moveFleet"; empireId: EmpireId; fleetId: FleetId; destinationId: SystemId }
  /** Mark an idle fleet as deliberately waiting (or clear that), so it leaves the attention queue. */
  | { type: "setHold"; empireId: EmpireId; fleetId: FleetId; hold: boolean }
  /** Use a colony ship in its current system to settle a planet. */
  | { type: "colonize"; empireId: EmpireId; fleetId: FleetId; bodyId: BodyId }
  | { type: "setFocus"; empireId: EmpireId; colonyId: ColonyId; focus: Focus }
  | { type: "queueBuild"; empireId: EmpireId; colonyId: ColonyId; item: QueueItem }
  /** Remove queue entry `index`. Progress on the first item is kept for whatever becomes first. */
  | { type: "dequeueBuild"; empireId: EmpireId; colonyId: ColonyId; index: number }
  /** Move queue entry `index` to the front. */
  | { type: "prioritizeBuild"; empireId: EmpireId; colonyId: ColonyId; index: number }
  /** Pay credits to finish the colony's current build; it completes when the turn resolves. */
  | { type: "buyBuild"; empireId: EmpireId; colonyId: ColonyId }
  | { type: "setResearch"; empireId: EmpireId; techId: string }
  /** Move every ship of `fleetId` into `intoFleetId` (same system, both stopped). */
  | { type: "mergeFleets"; empireId: EmpireId; fleetId: FleetId; intoFleetId: FleetId }
  /** Detach ships into a new fleet in the same system. */
  | { type: "splitFleet"; empireId: EmpireId; fleetId: FleetId; shipIds: ShipId[] }
  | { type: "setFleetOrders"; empireId: EmpireId; fleetId: FleetId; orders: FleetOrders }
  | { type: "renameFleet"; empireId: EmpireId; fleetId: FleetId; name: string }
  | { type: "createDesign"; empireId: EmpireId; design: Omit<DesignData, "id"> }
  /** Hide a design from build lists. Ships already built are unaffected. */
  | { type: "retireDesign"; empireId: EmpireId; designId: string }
  /**
   * Order a fleet carrying troops to land on a rival colony once its orbital defenses are down.
   * The fleet must be at (or heading for) the colony's system; null cancels the order.
   */
  | { type: "invade"; empireId: EmpireId; fleetId: FleetId; colonyId: ColonyId | null }
  /** Order a fleet with bomb bays to bombard a known rival colony in orbit each turn its defenses are down; null cancels. */
  | { type: "bombard"; empireId: EmpireId; fleetId: FleetId; colonyId: ColonyId | null }
  /** Use an outpost ship in its current system to build an outpost on an asteroid field or gas giant. */
  | { type: "buildOutpost"; empireId: EmpireId; fleetId: FleetId; bodyId: BodyId; kind: OutpostKind }
  /** Pay credits to turn a combat outpost into a supply depot. */
  | { type: "upgradeOutpost"; empireId: EmpireId; outpostId: number }
  /** Send a fleet's commandos against a known rival colony in (or on the way to) its system; null cancels. */
  | { type: "sabotage"; empireId: EmpireId; fleetId: FleetId; colonyId: ColonyId | null; mission: SabotageMission }
  /** Scrap a fleet to stop paying its upkeep. Inside supply, part of its build cost comes back as credits. */
  | { type: "disbandFleet"; empireId: EmpireId; fleetId: FleetId }
  /** Demolish a building for part of its cost back; its upkeep stops. */
  | { type: "scrapBuilding"; empireId: EmpireId; colonyId: ColonyId; buildingId: string }
  /** Place a colony's workers by hand (they must add up to its population); null returns control to the focus. */
  | { type: "setWorkers"; empireId: EmpireId; colonyId: ColonyId; workers: { farmers: number; industry: number; research: number } | null }
  | { type: "setTaxLevel"; empireId: EmpireId; taxLevel: string }
  /** Food to keep in store; the surplus above it is sold each turn. */
  | { type: "setFoodReserve"; empireId: EmpireId; reserve: number }
  /** Ends the orders phase for everyone and resolves the turn. */
  | { type: "endTurn" };

export type CommandResult = { ok: true; state: GameState } | { ok: false; error: string };

export interface RoutePlan {
  systemId: SystemId;
  route: SystemId[];
  progress: number;
  /** Distance left to travel. */
  distance: number;
  /** Turns until arrival (0 if already there). */
  turns: number;
}

/** Work out a fleet's route to a destination, choosing whether to continue or turn back if mid-lane. */
export function planMove(state: GameState, fleetId: FleetId, destinationId: SystemId): RoutePlan | string {
  const fleet = findFleet(state, fleetId);
  if (!fleet) return `no fleet ${fleetId}`;
  if (!state.galaxy.systems[destinationId]) return `no system ${destinationId}`;
  // Fleets can only plan routes along lanes on their empire's star charts.
  const adj = knownAdjacency(state, fleet.empireId);
  const plan = (systemId: SystemId, route: SystemId[], progress: number, distance: number): RoutePlan => ({
    systemId,
    route,
    progress,
    distance,
    turns: Math.ceil(distance / fleet.speed),
  });

  if (!isInTransit(fleet)) {
    const found = findPath(adj, fleet.systemId, destinationId);
    if (!found) return "destination unreachable";
    return plan(fleet.systemId, found.path, 0, found.length);
  }

  // Mid-lane from A toward B: compare pressing on through B with turning back to A.
  const a = fleet.systemId;
  const b = fleet.route[0]!;
  const length = laneLength(state.galaxy, a, b)!;
  const ahead = findPath(adj, b, destinationId);
  const behind = findPath(adj, a, destinationId);
  if (!ahead || !behind) return "destination unreachable";
  const aheadTotal = length - fleet.progress + ahead.length;
  const behindTotal = fleet.progress + behind.length;
  if (aheadTotal <= behindTotal) return plan(a, [b, ...ahead.path], fleet.progress, aheadTotal);
  return plan(b, [a, ...behind.path], length - fleet.progress, behindTotal);
}

function ownFleet(state: GameState, empireId: EmpireId, fleetId: FleetId): Fleet | string {
  const fleet = findFleet(state, fleetId);
  if (!fleet) return `no fleet ${fleetId}`;
  if (fleet.empireId !== empireId) return "fleet belongs to another empire";
  return fleet;
}

function ownColony(state: GameState, empireId: EmpireId, colonyId: ColonyId): Colony | string {
  const colony = findColony(state, colonyId);
  if (!colony) return `no colony ${colonyId}`;
  if (colony.empireId !== empireId) return "colony belongs to another empire";
  return colony;
}

export function validateCommand(state: GameState, command: Command, pack: ContentPack): string | null {
  switch (command.type) {
    case "moveFleet": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (fleet.speed <= 0) return "fleet cannot move";
      const plan = planMove(state, command.fleetId, command.destinationId);
      return typeof plan === "string" ? plan : null;
    }
    case "setHold": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (command.hold && fleet.route.length > 0) return "fleet is moving";
      return null;
    }
    case "colonize": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (!fleetCanColonize(pack, state, fleet)) return "fleet has no colony ship";
      if (isInTransit(fleet)) return "fleet is between systems";
      const body = state.galaxy.systems[fleet.systemId]!.bodies.find((b) => b.id === command.bodyId);
      if (!body) return "planet is not in the fleet's system";
      if (colonyOnBody(state, body.id)) return "planet already colonized";
      return colonizeBlocker(pack, state.empires[command.empireId]!, body);
    }
    case "setFocus": {
      const colony = ownColony(state, command.empireId, command.colonyId);
      if (typeof colony === "string") return colony;
      return FOCUSES.includes(command.focus) ? null : `unknown focus ${command.focus}`;
    }
    case "queueBuild": {
      const colony = ownColony(state, command.empireId, command.colonyId);
      if (typeof colony === "string") return colony;
      if (colony.queue.length >= 10) return "queue is full";
      return buildBlocker(state, pack, state.empires[command.empireId]!, colony, command.item);
    }
    case "dequeueBuild":
    case "prioritizeBuild": {
      const colony = ownColony(state, command.empireId, command.colonyId);
      if (typeof colony === "string") return colony;
      return Number.isInteger(command.index) && command.index >= 0 && command.index < colony.queue.length ? null : "no such queue entry";
    }
    case "buyBuild": {
      const colony = ownColony(state, command.empireId, command.colonyId);
      if (typeof colony === "string") return colony;
      const cost = buyCost(pack, state.empires[command.empireId]!, colony);
      if (cost === null) return "nothing to buy";
      if (state.empires[command.empireId]!.credits < cost) return "not enough credits";
      return null;
    }
    case "mergeFleets": {
      const from = ownFleet(state, command.empireId, command.fleetId);
      if (typeof from === "string") return from;
      const into = ownFleet(state, command.empireId, command.intoFleetId);
      if (typeof into === "string") return into;
      if (from.id === into.id) return "same fleet";
      if (isInTransit(from) || isInTransit(into) || from.systemId !== into.systemId) return "fleets must be stopped in the same system";
      return null;
    }
    case "splitFleet": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (isInTransit(fleet)) return "fleet is between systems";
      const ids = new Set(command.shipIds);
      if (ids.size === 0 || ids.size !== command.shipIds.length) return "pick ships to detach";
      if (![...ids].every((id) => fleet.ships.some((s) => s.id === id))) return "ship not in fleet";
      if (ids.size === fleet.ships.length) return "can't detach every ship";
      return null;
    }
    case "setFleetOrders": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      const o = command.orders;
      if (!MISSIONS.includes(o.mission) || !STANCES.includes(o.stance) || !TARGET_PRIORITIES.includes(o.targetPriority)) return "invalid orders";
      if (!Number.isInteger(o.retreatPercent) || o.retreatPercent < 0 || o.retreatPercent > 100) return "retreat threshold must be 0-100";
      return null;
    }
    case "renameFleet": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      const name = command.name.trim();
      return name.length > 0 && name.length <= 30 ? null : "name must be 1-30 characters";
    }
    case "createDesign":
      return designBlocker(pack, state.empires[command.empireId]!, command.design);
    case "retireDesign": {
      const design = state.empires[command.empireId]!.designs.find((d) => d.id === command.designId);
      return design && !design.obsolete ? null : "no such design";
    }
    case "setResearch":
      return techAvailable(pack, state.empires[command.empireId]!, command.techId) ? null : "tech not available";
    case "disbandFleet": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      return typeof fleet === "string" ? fleet : null;
    }
    case "scrapBuilding": {
      const colony = ownColony(state, command.empireId, command.colonyId);
      if (typeof colony === "string") return colony;
      if (!colony.buildings.includes(command.buildingId)) return "no such building here";
      return pack.buildings.find((b) => b.id === command.buildingId)?.buildable ? null : "that building can't be scrapped";
    }
    case "setWorkers": {
      const colony = ownColony(state, command.empireId, command.colonyId);
      if (typeof colony === "string") return colony;
      const w = command.workers;
      if (w === null) return null;
      const counts = [w.farmers, w.industry, w.research];
      if (!counts.every((n) => Number.isInteger(n) && n >= 0)) return "worker counts must be whole numbers";
      return counts.reduce((a, b) => a + b, 0) === colony.population ? null : `workers must add up to the population (${colony.population})`;
    }
    case "setTaxLevel":
      return pack.taxLevels.some((t) => t.id === command.taxLevel) ? null : `unknown tax level ${command.taxLevel}`;
    case "setFoodReserve":
      return Number.isInteger(command.reserve) && command.reserve >= 0 && command.reserve <= pack.economy.foodStockCap ? null : `reserve must be 0-${pack.economy.foodStockCap}`;
    case "invade": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (command.colonyId === null) return null;
      if (fleetTroops(state, pack, fleet) === 0) return "fleet carries no troops";
      // Only colonies the empire knows about can be targeted (no peeking through fog).
      const known = state.empires[command.empireId]!.colonySightings.find((c) => c.colonyId === command.colonyId);
      if (!known) return "no known rival colony there";
      const destination = fleet.route.length > 0 ? fleet.route[fleet.route.length - 1] : fleet.systemId;
      if (destination !== known.systemId) return "fleet must be at or heading for that system";
      return null;
    }
    case "bombard": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (command.colonyId === null) return null;
      if (!fleetShipStats(pack, state, fleet).some((s) => s.bombard > 0)) return "fleet has no bomb bays";
      const known = state.empires[command.empireId]!.colonySightings.find((c) => c.colonyId === command.colonyId);
      if (!known) return "no known rival colony there";
      const destination = fleet.route.length > 0 ? fleet.route[fleet.route.length - 1] : fleet.systemId;
      if (destination !== known.systemId) return "fleet must be at or heading for that system";
      return null;
    }
    case "buildOutpost": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (!fleetShipStats(pack, state, fleet).some((s) => s.outpost)) return "fleet has no outpost kit";
      if (isInTransit(fleet)) return "fleet is between systems";
      if (!OUTPOST_KINDS.includes(command.kind)) return `unknown outpost type ${command.kind}`;
      const body = state.galaxy.systems[fleet.systemId]!.bodies.find((b) => b.id === command.bodyId);
      if (!body) return "that body is not in the fleet's system";
      return outpostBlocker(state, pack, state.empires[command.empireId]!, body, command.kind);
    }
    case "upgradeOutpost": {
      const outpost = state.outposts.find((o) => o.id === command.outpostId);
      if (!outpost || outpost.empireId !== command.empireId) return "no such outpost";
      if (outpost.kind !== "combat" || outpost.depot) return "only combat outposts can become depots";
      const empire = state.empires[command.empireId]!;
      if (!outpostTechOk(pack, empire, "depot")) return "depots need research";
      return empire.credits >= pack.outposts.depot.cost ? null : "not enough credits";
    }
    case "sabotage": {
      const fleet = ownFleet(state, command.empireId, command.fleetId);
      if (typeof fleet === "string") return fleet;
      if (command.colonyId === null) return null;
      if (!SABOTAGE_MISSIONS.includes(command.mission)) return `unknown mission ${command.mission}`;
      if (!fleetShipStats(pack, state, fleet).some((s) => s.commandos > 0)) return "fleet carries no commandos";
      const known = state.empires[command.empireId]!.colonySightings.find((c) => c.colonyId === command.colonyId);
      if (!known) return "no known rival colony there";
      const destination = fleet.route.length > 0 ? fleet.route[fleet.route.length - 1] : fleet.systemId;
      if (destination !== known.systemId) return "fleet must be at or heading for that system";
      return null;
    }
    case "endTurn":
      return state.outcome ? "the game is over" : null;
    default:
      return `unknown command ${(command as { type: string }).type}`;
  }
}

/** Apply a command to a copy of the state. The input state is never modified. */
export function applyCommand(state: GameState, command: Command, pack: ContentPack): CommandResult {
  const error = validateCommand(state, command, pack);
  if (error) return { ok: false, error };

  const next = cloneState(state);
  switch (command.type) {
    case "moveFleet": {
      const plan = planMove(next, command.fleetId, command.destinationId) as RoutePlan;
      const fleet = findFleet(next, command.fleetId)!;
      fleet.systemId = plan.systemId;
      fleet.route = plan.route;
      fleet.progress = plan.progress;
      fleet.holding = false;
      fleet.invadeColonyId = null; // re-issue after moving
      fleet.bombardColonyId = null;
      fleet.sabotage = null;
      break;
    }
    case "setHold":
      findFleet(next, command.fleetId)!.holding = command.hold;
      break;
    case "colonize": {
      const fleet = findFleet(next, command.fleetId)!;
      const empire = next.empires[command.empireId]!;
      next.colonies.push(newColony(next, empire, fleet.systemId, command.bodyId, pack.economy.colonyPopulation, false));
      // The first colony ship in the fleet is used up.
      const stats = fleetShipStats(pack, next, fleet);
      const used = fleet.ships[stats.findIndex((s) => s.colonize)]!;
      fleet.ships = fleet.ships.filter((s) => s.id !== used.id);
      if (fleet.ships.length === 0) next.fleets = next.fleets.filter((f) => f.id !== fleet.id);
      else refreshFleetStats(pack, next, fleet);
      break;
    }
    case "setFocus":
      findColony(next, command.colonyId)!.focus = command.focus;
      break;
    case "queueBuild":
      findColony(next, command.colonyId)!.queue.push({ ...command.item });
      break;
    case "dequeueBuild": {
      const colony = findColony(next, command.colonyId)!;
      colony.queue.splice(command.index, 1);
      if (colony.queue.length === 0) colony.progress = 0;
      break;
    }
    case "prioritizeBuild": {
      const colony = findColony(next, command.colonyId)!;
      const [item] = colony.queue.splice(command.index, 1);
      colony.queue.unshift(item!);
      break;
    }
    case "buyBuild": {
      const colony = findColony(next, command.colonyId)!;
      const empire = next.empires[command.empireId]!;
      empire.credits -= buyCost(pack, empire, colony)!;
      colony.progress = itemCost(pack, empire, colony.queue[0]!);
      break;
    }
    case "mergeFleets": {
      const from = findFleet(next, command.fleetId)!;
      const into = findFleet(next, command.intoFleetId)!;
      // Merged fleets carry the lower supply of the two, capped at the new maximum.
      into.ships.push(...from.ships);
      into.supply = Math.min(into.supply, from.supply, fleetMaxSupply(pack, next, into));
      into.holding = into.holding && from.holding;
      next.fleets = next.fleets.filter((f) => f.id !== from.id);
      refreshFleetStats(pack, next, into);
      break;
    }
    case "splitFleet": {
      const fleet = findFleet(next, command.fleetId)!;
      const empire = next.empires[command.empireId]!;
      const ids = new Set(command.shipIds);
      const detached = fleet.ships.filter((s) => ids.has(s.id));
      fleet.ships = fleet.ships.filter((s) => !ids.has(s.id));
      const count = (empire.shipsBuilt["__fleet"] ?? 0) + 1;
      empire.shipsBuilt["__fleet"] = count;
      const created: Fleet = {
        ...fleet,
        id: next.nextId++,
        name: `Task Force ${count}`,
        ships: detached,
        route: [],
        holding: false,
        orders: { ...fleet.orders },
      };
      created.supply = Math.min(fleet.supply, fleetMaxSupply(pack, next, created));
      fleet.supply = Math.min(fleet.supply, fleetMaxSupply(pack, next, fleet));
      refreshFleetStats(pack, next, fleet);
      refreshFleetStats(pack, next, created);
      next.fleets.push(created);
      break;
    }
    case "setFleetOrders":
      findFleet(next, command.fleetId)!.orders = { ...command.orders };
      break;
    case "renameFleet":
      findFleet(next, command.fleetId)!.name = command.name.trim();
      break;
    case "createDesign": {
      const d = command.design;
      next.empires[command.empireId]!.designs.push({
        id: `design-${next.nextId++}`,
        name: d.name.trim(),
        hull: d.hull,
        components: [...d.components],
        formation: d.formation,
        obsolete: false,
      });
      break;
    }
    case "disbandFleet":
      next.empires[command.empireId]!.credits += scrapValue(next, pack, findFleet(next, command.fleetId)!);
      next.fleets = next.fleets.filter((f) => f.id !== command.fleetId);
      break;
    case "scrapBuilding": {
      const colony = findColony(next, command.colonyId)!;
      colony.buildings.splice(colony.buildings.indexOf(command.buildingId), 1);
      const building = pack.buildings.find((b) => b.id === command.buildingId)!;
      next.empires[command.empireId]!.credits += Math.floor((building.cost * pack.economy.scrapRefundPercent) / 100);
      const defense = colonyDefense(pack, next.empires[command.empireId]!, colony);
      colony.defenseHp = Math.min(colony.defenseHp, defense.maxHp);
      colony.troops = Math.min(colony.troops, defense.maxTroops);
      break;
    }
    case "setWorkers":
      findColony(next, command.colonyId)!.workers = command.workers && { ...command.workers };
      break;
    case "setTaxLevel":
      next.empires[command.empireId]!.taxLevel = command.taxLevel;
      break;
    case "setFoodReserve":
      next.empires[command.empireId]!.foodReserve = command.reserve;
      break;
    case "invade":
      findFleet(next, command.fleetId)!.invadeColonyId = command.colonyId;
      break;
    case "bombard":
      findFleet(next, command.fleetId)!.bombardColonyId = command.colonyId;
      break;
    case "buildOutpost": {
      const fleet = findFleet(next, command.fleetId)!;
      const empire = next.empires[command.empireId]!;
      const outpost: Outpost = { id: next.nextId++, empireId: empire.id, systemId: fleet.systemId, bodyId: command.bodyId, kind: command.kind, depot: false, defenseHp: 0 };
      outpost.defenseHp = outpostDefense(pack, empire, outpost).maxHp;
      next.outposts.push(outpost);
      // The first outpost ship in the fleet is used up.
      const stats = fleetShipStats(pack, next, fleet);
      const used = fleet.ships[stats.findIndex((s) => s.outpost)]!;
      fleet.ships = fleet.ships.filter((s) => s.id !== used.id);
      if (fleet.ships.length === 0) next.fleets = next.fleets.filter((f) => f.id !== fleet.id);
      else refreshFleetStats(pack, next, fleet);
      break;
    }
    case "upgradeOutpost": {
      const outpost = next.outposts.find((o) => o.id === command.outpostId)!;
      outpost.depot = true;
      next.empires[command.empireId]!.credits -= pack.outposts.depot.cost;
      break;
    }
    case "sabotage":
      findFleet(next, command.fleetId)!.sabotage = command.colonyId === null ? null : { colonyId: command.colonyId, mission: command.mission };
      break;
    case "retireDesign":
      next.empires[command.empireId]!.designs.find((d) => d.id === command.designId)!.obsolete = true;
      break;
    case "setResearch":
      next.empires[command.empireId]!.research.current = command.techId;
      break;
    case "endTurn":
      resolveTurn(next, pack);
      break;
  }
  return { ok: true, state: next };
}

/**
 * Credits returned for scrapping a fleet: part of its ships' build cost, but only
 * inside the empire's supply network, where there are yards to take the parts.
 */
export function scrapValue(state: GameState, pack: ContentPack, fleet: Fleet): number {
  if (isInTransit(fleet) || !suppliedSystems(state, pack, fleet.empireId).has(fleet.systemId)) return 0;
  const empire = state.empires[fleet.empireId]!;
  const fx = empireEffects(pack, empire);
  const cost = fleet.ships.reduce((n, ship) => n + designStats(pack, getDesign(empire, ship.designId), fx).cost, 0);
  return Math.floor((cost * pack.economy.scrapRefundPercent) / 100);
}
