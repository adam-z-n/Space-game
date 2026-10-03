import type { ContentPack, DesignData } from "../content/schema";
import { buildAdjacency, findPath, laneLength } from "./graph";
import {
  FOCUSES,
  MISSIONS,
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
  type ShipId,
  type QueueItem,
  type SystemId,
} from "./state";
import { buildBlocker, buyCost, colonizeBlocker, itemCost, newColony, techAvailable } from "./economy";
import { designBlocker, fleetCanColonize, fleetMaxSupply, fleetShipStats, refreshFleetStats } from "./ships";
import { fleetTroops } from "./defense";
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
  /** Scrap a fleet to stop paying its upkeep. Nothing is refunded. */
  | { type: "disbandFleet"; empireId: EmpireId; fleetId: FleetId }
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
  const adj = buildAdjacency(state.galaxy.systems.length, state.galaxy.lanes);
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
      return buildBlocker(pack, state.empires[command.empireId]!, colony, command.item);
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
      next.fleets = next.fleets.filter((f) => f.id !== command.fleetId);
      break;
    case "invade":
      findFleet(next, command.fleetId)!.invadeColonyId = command.colonyId;
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
