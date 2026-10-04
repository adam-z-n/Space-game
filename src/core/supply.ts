import type { ContentPack } from "../content/schema";
import { empireEffects } from "./economy";
import { buildAdjacency, shortestPaths } from "./graph";
import { fleetArmed, fleetMaxSupply, fleetShipStats, refreshFleetStats, shipStats } from "./ships";
import type { EmpireId, Fleet, GameEvent, GameState, SystemId } from "./state";

/**
 * Logistics. Colonies project supply along lanes. Fleets inside supply are
 * refilled and repaired; outside it they burn a turn of onboard supply per
 * turn, and once empty they are slowed, hit less hard, and wear down.
 */

/** Systems where `empireId`'s fleets are supplied. Blockaded colonies project nothing. */
export function suppliedSystems(state: GameState, pack: ContentPack, empireId: EmpireId): Set<SystemId> {
  const empire = state.empires[empireId]!;
  const bonus = empireEffects(pack, empire).supplyRange;
  const adj = buildAdjacency(state.galaxy.systems.length, state.galaxy.lanes);
  const supplied = new Set<SystemId>();
  for (const colony of state.colonies) {
    if (colony.empireId !== empireId || colony.blockaded) continue;
    const range = (colony.capital ? pack.economy.capitalSupplyRange : pack.economy.colonySupplyRange) + bonus;
    const { dist } = shortestPaths(adj, colony.systemId);
    dist.forEach((d, systemId) => {
      if (d <= range) supplied.add(systemId);
    });
  }
  // Supply depots project supply too.
  for (const outpost of state.outposts) {
    if (outpost.empireId !== empireId || !outpost.depot) continue;
    const { dist } = shortestPaths(adj, outpost.systemId);
    dist.forEach((d, systemId) => {
      if (d <= pack.outposts.depot.supplyRange + bonus) supplied.add(systemId);
    });
  }
  return supplied;
}

export function fleetInSupply(fleet: Fleet, supplied: Set<SystemId>): boolean {
  if (supplied.has(fleet.systemId)) return true;
  return fleet.progress > 0 && supplied.has(fleet.route[0]!);
}

/** Armed fleets of other empires sitting in each system, with no armed defender of the colony's owner. */
export function updateBlockades(state: GameState, pack: ContentPack, events: GameEvent[] | null): void {
  const armedHere = new Map<SystemId, Set<EmpireId>>();
  for (const fleet of state.fleets) {
    if (fleet.progress > 0 || !fleetArmed(pack, state, fleet)) continue;
    const set = armedHere.get(fleet.systemId) ?? new Set<EmpireId>();
    set.add(fleet.empireId);
    armedHere.set(fleet.systemId, set);
  }
  for (const colony of state.colonies.slice().sort((a, b) => a.id - b.id)) {
    const present = armedHere.get(colony.systemId);
    const hostile = !!present && [...present].some((e) => e !== colony.empireId);
    const defended = (!!present && present.has(colony.empireId)) || colony.defenseHp > 0;
    const blockaded = hostile && !defended;
    if (blockaded && !colony.blockaded && events) {
      events.push({ type: "blockaded", turn: state.turn, empireId: colony.empireId, colonyId: colony.id, systemId: colony.systemId });
    }
    colony.blockaded = blockaded;
  }
}

/** Refill, repair, or wear down every fleet. Runs after movement, before combat. */
export function resolveSupply(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  updateBlockades(state, pack, events);
  const networks = new Map<EmpireId, Set<SystemId>>();
  for (const empire of state.empires) networks.set(empire.id, suppliedSystems(state, pack, empire.id));

  for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
    const empire = state.empires[fleet.empireId]!;
    const supplied = fleetInSupply(fleet, networks.get(fleet.empireId)!);
    // Repair tenders mend the whole fleet wherever it is.
    const tender = fleetShipStats(pack, state, fleet).reduce((n, s) => Math.max(n, s.repair), 0);
    if (tender > 0 && !supplied) {
      for (const ship of fleet.ships) {
        const max = shipStats(pack, empire, ship).maxHp;
        ship.hp = Math.min(max, ship.hp + Math.ceil((max * tender) / 100));
      }
    }
    if (supplied) {
      fleet.supply = fleetMaxSupply(pack, state, fleet);
      const docked =
        fleet.progress === 0 &&
        (state.colonies.some((c) => c.empireId === fleet.empireId && c.systemId === fleet.systemId) ||
          state.outposts.some((o) => o.empireId === fleet.empireId && o.systemId === fleet.systemId && o.depot));
      const percent = Math.max(tender, docked ? pack.combat.dockRepairPercent : pack.combat.repairPercent);
      for (const ship of fleet.ships) {
        const max = shipStats(pack, empire, ship).maxHp;
        ship.hp = Math.min(max, ship.hp + Math.ceil((max * percent) / 100));
      }
    } else if (fleet.supply > 0) {
      fleet.supply -= 1;
      if (fleet.supply === 0) events.push({ type: "outOfSupply", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId });
    } else {
      const before = fleet.ships.length;
      for (const ship of fleet.ships) ship.hp -= Math.ceil((shipStats(pack, empire, ship).maxHp * pack.combat.attritionPercent) / 100);
      fleet.ships = fleet.ships.filter((ship) => ship.hp > 0);
      const lost = before - fleet.ships.length;
      if (lost > 0) events.push({ type: "attrition", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId, shipsLost: lost });
    }
    refreshFleetStats(pack, state, fleet);
  }
  state.fleets = state.fleets.filter((f) => f.ships.length > 0);
}
