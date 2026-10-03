import type { Command } from "./commands";
import { buildAdjacency, shortestPaths } from "./graph";
import type { EmpireId, GameState, SystemId } from "./state";

/**
 * Placeholder AI for M1: send idle fleets to the nearest unexplored system.
 * The AI only reads state and returns ordinary commands, the same ones the player uses.
 * The real strategic/operational AI arrives in M5.
 */
export function planAiTurn(state: GameState, empireId: EmpireId): Command[] {
  const empire = state.empires[empireId]!;
  const adj = buildAdjacency(state.galaxy.systems.length, state.galaxy.lanes);
  const explored = new Set(empire.explored);

  // Systems already targeted by this empire's moving fleets.
  const claimed = new Set<SystemId>();
  for (const fleet of state.fleets) {
    if (fleet.empireId === empireId && fleet.route.length > 0) claimed.add(fleet.route[fleet.route.length - 1]!);
  }

  const commands: Command[] = [];
  const idle = state.fleets.filter((f) => f.empireId === empireId && f.route.length === 0).sort((a, b) => a.id - b.id);
  for (const fleet of idle) {
    const { dist } = shortestPaths(adj, fleet.systemId);
    let target = -1;
    for (let i = 0; i < dist.length; i++) {
      if (explored.has(i) || claimed.has(i) || dist[i] === Infinity) continue;
      if (target === -1 || dist[i]! < dist[target]!) target = i;
    }
    if (target === -1) continue;
    claimed.add(target);
    commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: target });
  }
  return commands;
}
