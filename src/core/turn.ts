import type { ContentPack } from "../content/schema";
import { laneLength } from "./graph";
import { updateSightings } from "./vision";
import type { EmpireId, GameEvent, GameState, SystemId } from "./state";

/**
 * Turn resolution, in the order the design fixes:
 * movement, supply, combat, invasions, then economy and growth.
 * Mutates `state` in place; callers pass a copy (see applyCommand).
 */
export function resolveTurn(state: GameState, pack: ContentPack): void {
  const events: GameEvent[] = [];
  resolveMovement(state, events);
  resolveSupply(state, pack, events);
  resolveCombat(state, pack, events);
  resolveInvasions(state, pack, events);
  resolveEconomy(state, pack, events);
  const resolved = state.turn;
  state.turn += 1;
  updateSightings(state, events, resolved);
  state.lastTurnEvents = events;
}

function markExplored(state: GameState, empireId: EmpireId, systemId: SystemId, events: GameEvent[]): void {
  const explored = state.empires[empireId]!.explored;
  if (explored.includes(systemId)) return;
  explored.push(systemId);
  explored.sort((a, b) => a - b);
  events.push({ type: "systemExplored", turn: state.turn, empireId, systemId });
}

/** Fleets spend `speed` distance per turn along their route, passing through systems as they go. */
function resolveMovement(state: GameState, events: GameEvent[]): void {
  const fleets = state.fleets.slice().sort((a, b) => a.id - b.id);
  for (const fleet of fleets) {
    if (fleet.route.length === 0) continue;
    let budget = fleet.speed;
    while (budget > 0 && fleet.route.length > 0) {
      const next = fleet.route[0]!;
      const remaining = laneLength(state.galaxy, fleet.systemId, next)! - fleet.progress;
      if (budget < remaining) {
        fleet.progress += budget;
        budget = 0;
      } else {
        budget -= remaining;
        fleet.systemId = next;
        fleet.route.shift();
        fleet.progress = 0;
        markExplored(state, fleet.empireId, next, events);
      }
    }
    if (fleet.route.length === 0) {
      events.push({ type: "fleetArrived", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId });
    }
  }
}

// Later milestones fill these in (M3 economy, M4 supply and combat, M6 invasions).
function resolveSupply(_state: GameState, _pack: ContentPack, _events: GameEvent[]): void {}
function resolveCombat(_state: GameState, _pack: ContentPack, _events: GameEvent[]): void {}
function resolveInvasions(_state: GameState, _pack: ContentPack, _events: GameEvent[]): void {}
function resolveEconomy(_state: GameState, _pack: ContentPack, _events: GameEvent[]): void {}
