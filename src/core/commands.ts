import type { ContentPack } from "../content/schema";
import { buildAdjacency, findPath, laneLength } from "./graph";
import { cloneState, findFleet, isInTransit, type EmpireId, type FleetId, type GameState, type SystemId } from "./state";
import { resolveTurn } from "./turn";

/**
 * Every change to the game, by the player or the AI, is one of these commands.
 * Commands are plain JSON so a game is fully described by its settings plus its
 * command log: that log is the save file, the replay, and later the multiplayer protocol.
 */
export type Command =
  /** Route a fleet to a destination; using the fleet's current system cancels its orders. */
  | { type: "moveFleet"; empireId: EmpireId; fleetId: FleetId; destinationId: SystemId }
  /** Ends the orders phase for everyone and resolves the turn. */
  | { type: "endTurn" };

export type CommandResult = { ok: true; state: GameState } | { ok: false; error: string };

/** Compute a fleet's new route, choosing whether to continue or turn back if mid-lane. */
function planRoute(state: GameState, fleetId: FleetId, destinationId: SystemId): Pick<GameState["fleets"][number], "systemId" | "route" | "progress"> | string {
  const fleet = findFleet(state, fleetId)!;
  const adj = buildAdjacency(state.galaxy.systems.length, state.galaxy.lanes);

  if (!isInTransit(fleet)) {
    const found = findPath(adj, fleet.systemId, destinationId);
    if (!found) return "destination unreachable";
    return { systemId: fleet.systemId, route: found.path, progress: 0 };
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
  if (aheadTotal <= behindTotal) {
    return { systemId: a, route: [b, ...ahead.path], progress: fleet.progress };
  }
  return { systemId: b, route: [a, ...behind.path], progress: length - fleet.progress };
}

export function validateCommand(state: GameState, command: Command): string | null {
  switch (command.type) {
    case "moveFleet": {
      const fleet = findFleet(state, command.fleetId);
      if (!fleet) return `no fleet ${command.fleetId}`;
      if (fleet.empireId !== command.empireId) return "fleet belongs to another empire";
      if (!state.galaxy.systems[command.destinationId]) return `no system ${command.destinationId}`;
      const plan = planRoute(state, command.fleetId, command.destinationId);
      return typeof plan === "string" ? plan : null;
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
      const plan = planRoute(next, command.fleetId, command.destinationId) as Exclude<ReturnType<typeof planRoute>, string>;
      Object.assign(findFleet(next, command.fleetId)!, plan);
      break;
    }
    case "endTurn":
      resolveTurn(next, pack);
      break;
  }
  return { ok: true, state: next };
}
