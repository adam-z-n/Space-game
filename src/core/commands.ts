import type { ContentPack } from "../content/schema";
import { buildAdjacency, findPath, laneLength } from "./graph";
import {
  FOCUSES,
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
  type GameState,
  type QueueItem,
  type SystemId,
} from "./state";
import { buildBlocker, buyCost, colonizeBlocker, getShipTemplate, itemCost, newColony, techAvailable } from "./economy";
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
      if (!getShipTemplate(pack, fleet.templateId).colonize) return "not a colony ship";
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
      const cost = buyCost(pack, colony);
      if (cost === null) return "nothing to buy";
      if (state.empires[command.empireId]!.credits < cost) return "not enough credits";
      return null;
    }
    case "setResearch":
      return techAvailable(pack, state.empires[command.empireId]!, command.techId) ? null : "tech not available";
    case "endTurn":
      return null;
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
      break;
    }
    case "setHold":
      findFleet(next, command.fleetId)!.holding = command.hold;
      break;
    case "colonize": {
      const fleet = findFleet(next, command.fleetId)!;
      const empire = next.empires[command.empireId]!;
      next.colonies.push(newColony(next, empire, fleet.systemId, command.bodyId, pack.economy.colonyPopulation, false));
      next.fleets = next.fleets.filter((f) => f.id !== fleet.id);
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
      next.empires[command.empireId]!.credits -= buyCost(pack, colony)!;
      colony.progress = itemCost(pack, colony.queue[0]!);
      break;
    }
    case "setResearch":
      next.empires[command.empireId]!.research.current = command.techId;
      break;
    case "endTurn":
      resolveTurn(next, pack);
      break;
  }
  return { ok: true, state: next };
}
