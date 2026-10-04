import type { ContentPack } from "../content/schema";
import { laneLength } from "./graph";
import { updateSightings } from "./vision";
import { resolveEconomy } from "./economy";
import { checkVictory } from "./victory";
import { colonyDefense, regenerateDefenses, resolveBombardment, resolveInvasions, resolveMines, resolveSabotage } from "./defense";
import { resolveCombat } from "./combat";
import { fleetArmed, fleetStealthy } from "./ships";
import { regenerateOutposts, resolveOutpostRaids } from "./outposts";
import { resolveSupply, updateBlockades } from "./supply";
import type { EmpireId, GameEvent, GameState, SystemId } from "./state";

/**
 * Turn resolution, in the order the design fixes:
 * movement, supply, combat, invasions, then economy and growth.
 * Mutates `state` in place; callers pass a copy (see applyCommand).
 */
export function resolveTurn(state: GameState, pack: ContentPack): void {
  const events: GameEvent[] = [];
  resolveMovement(state, pack, events);
  resolveSupply(state, pack, events);
  resolveMines(state, pack, events);
  resolveCombat(state, pack, events);
  resolveOutpostRaids(state, pack, events);
  resolveBombardment(state, pack, events);
  resolveSabotage(state, pack, events);
  resolveInvasions(state, pack, events);
  // Blockades are settled by combat (defenses knocked out): re-check before the economy runs.
  updateBlockades(state, pack, events);
  resolveEconomy(state, pack, events);
  regenerateDefenses(state, pack);
  regenerateOutposts(state, pack);
  const resolved = state.turn;
  state.turn += 1;
  updateSightings(state, pack, events, resolved);
  checkVictory(state, pack, events, resolved);
  state.lastTurnEvents = events;
}

function markExplored(state: GameState, empireId: EmpireId, systemId: SystemId, events: GameEvent[]): void {
  const explored = state.empires[empireId]!.explored;
  if (explored.includes(systemId)) return;
  explored.push(systemId);
  explored.sort((a, b) => a - b);
  events.push({ type: "systemExplored", turn: state.turn, empireId, systemId });
}

/**
 * Fleets spend `speed` distance per turn along their route, passing through systems as they go.
 * A system held at the start of the turn by an armed hostile fleet, or by a hostile colony
 * whose guns are standing, stops any fleet entering it: nobody slips past a blockade or a
 * fortress, so chokepoints can be held.
 */
function resolveMovement(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const guards = new Map<SystemId, Set<EmpireId>>();
  const guard = (systemId: SystemId, empireId: EmpireId) => guards.set(systemId, (guards.get(systemId) ?? new Set()).add(empireId));
  for (const fleet of state.fleets) {
    if (fleet.progress > 0 || fleet.route.length > 0 || !fleetArmed(pack, state, fleet)) continue;
    guard(fleet.systemId, fleet.empireId);
  }
  for (const colony of state.colonies) {
    if (colony.defenseHp > 0 && colonyDefense(pack, state.empires[colony.empireId]!, colony).weapons.length > 0) guard(colony.systemId, colony.empireId);
  }
  for (const outpost of state.outposts) if (outpost.kind === "combat" && outpost.defenseHp > 0) guard(outpost.systemId, outpost.empireId);
  const fleets = state.fleets.slice().sort((a, b) => a.id - b.id);
  for (const fleet of fleets) {
    if (fleet.route.length === 0) continue;
    // Cloaked fleets slip past guards.
    const cloaked = fleetStealthy(pack, state, fleet);
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
        const guarded = !cloaked && [...(guards.get(next) ?? [])].some((e) => e !== fleet.empireId);
        if (guarded && fleet.route.length > 0) {
          events.push({ type: "fleetIntercepted", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: next });
          budget = 0;
        }
      }
    }
    if (fleet.route.length === 0) {
      events.push({ type: "fleetArrived", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId });
    }
  }
}



