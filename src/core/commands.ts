import type { ContentPack } from "../content/schema";
import { buildAdjacency, findPath, laneLength } from "./graph";
import { cloneState, findFleet, isInTransit, type EmpireId, type Fleet, type FleetId, type GameState, type SystemId } from "./state";
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

export function validateCommand(state: GameState, command: Command): string | null {
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
    case "endTurn":
      return null;
    default:
      return `unknown command ${(command as { type: string }).type}`;
  }
}

/** Apply a command to a copy of the state. The input state is never modified. */
export function applyCommand(state: GameState, command: Command, pack: ContentPack): CommandResult {
  const error = validateCommand(state, command);
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
    case "endTurn":
      resolveTurn(next, pack);
      break;
  }
  return { ok: true, state: next };
}
