import { empireEffects, hasFlag } from "./economy";
import type { ContentPack } from "../content/schema";
import { fleetArmed, fleetMaxSupply, fleetShipStats, refreshFleetStats, shipStats } from "./ships";
import type { EmpireId, Fleet, GameEvent, GameState, SystemId } from "./state";

/**
 * Logistics. Fleets carry a few turns of supply and spend one each turn they are
 * away from a resupply point: one of their empire's colonies (unless blockaded) or
 * a supply depot. There they refill and repair. Supply ships carry stores that keep
 * a fleet going in the field, reload its missiles and (with Field Repair) mend it;
 * tankers' fuel tanks add turns. Once supply runs out a fleet is slowed, hits less
 * hard, and wears down.
 */

/** Systems where `empireId`'s fleets resupply: its colonies (blockaded ones excepted) and supply depots. */
export function suppliedSystems(state: GameState, pack: ContentPack, empireId: EmpireId): Set<SystemId> {
  const supplied = new Set<SystemId>();
  for (const colony of state.colonies) if (colony.empireId === empireId && !colony.blockaded) supplied.add(colony.systemId);
  for (const outpost of state.outposts) if (outpost.empireId === empireId && outpost.depot) supplied.add(outpost.systemId);
  return supplied;
}

/** A fleet stopped at one of its empire's resupply points. */
export function fleetInSupply(fleet: Fleet, supplied: Set<SystemId>): boolean {
  return fleet.progress === 0 && supplied.has(fleet.systemId);
}

/** Supply stores a fleet's supply ships can hold, in ship-turns. */
export function fleetMaxStores(pack: ContentPack, state: GameState, fleet: Fleet): number {
  return fleetShipStats(pack, state, fleet).reduce((n, s) => n + s.stores, 0);
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

/**
 * Refill, repair, or wear down every fleet. Runs after movement, before combat.
 * At a resupply point a fleet refills its supply and its supply ships' stores and
 * repairs. In the field it spends a turn of supply; supply ships then hand out a
 * turn from their stores (one ship-turn per ship in the fleet) while they last, and
 * reload missiles with what's left.
 */
export function resolveSupply(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  updateBlockades(state, pack, events);
  const networks = new Map<EmpireId, Set<SystemId>>();
  for (const empire of state.empires) networks.set(empire.id, suppliedSystems(state, pack, empire.id));

  for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
    const empire = state.empires[fleet.empireId]!;
    const supplied = fleetInSupply(fleet, networks.get(fleet.empireId)!);
    const max = fleetMaxSupply(pack, state, fleet);
    // Supply ship crews (with Field Repair, while stores last) and hull techs like Damage
    // Control mend the whole fleet wherever it is.
    const fx = empireEffects(pack, empire);
    const crews = fleet.stores > 0 && hasFlag(pack, empire, "fieldRepair") ? pack.combat.supplyRepairPercent : 0;
    const mending = Math.max(fx.fieldRepairPercent, crews, fleetShipStats(pack, state, fleet).reduce((n, s) => Math.max(n, s.repair), 0));
    const repair = (percent: number) => {
      for (const ship of fleet.ships) {
        const hp = shipStats(pack, empire, ship).maxHp;
        ship.hp = Math.min(hp, ship.hp + Math.ceil((hp * percent) / 100));
      }
    };
    if (supplied) {
      fleet.supply = max;
      fleet.stores = fleetMaxStores(pack, state, fleet);
      // Rearm missiles and fix every knocked-out component.
      for (const ship of fleet.ships) {
        ship.salvos = 0;
        ship.damaged = [];
      }
      repair(Math.max(mending, pack.combat.dockRepairPercent));
      refreshFleetStats(pack, state, fleet);
      continue;
    }
    if (mending > 0) {
      repair(mending);
      // Repair crews also get one knocked-out component per ship working again.
      for (const ship of fleet.ships) if (ship.damaged.length > 0) ship.damaged = ship.damaged.slice(1);
    }
    const had = fleet.supply;
    // Solar Sails: no supply spent while between systems.
    const sailing = fleet.progress > 0 && hasFlag(pack, empire, "solarSails");
    if (sailing) {
      // nothing spent
    } else if (fleet.supply > 0) {
      fleet.supply -= 1;
    } else {
      const before = fleet.ships.length;
      for (const ship of fleet.ships) ship.hp -= Math.ceil((shipStats(pack, empire, ship).maxHp * pack.combat.attritionPercent) / 100);
      fleet.ships = fleet.ships.filter((ship) => ship.hp > 0);
      const lost = before - fleet.ships.length;
      if (lost > 0) events.push({ type: "attrition", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId, shipsLost: lost });
    }
    // Supply ships top the fleet up from their stores.
    const need = fleet.ships.length;
    if (fleet.supply < max && need > 0 && fleet.stores >= need) {
      fleet.supply += 1;
      fleet.stores -= need;
    }
    // Then they reload spent missile launchers: one ship-turn of stores per ship rearmed.
    for (const ship of fleet.ships) {
      if (fleet.stores < 1) break;
      if (ship.salvos > 0) {
        ship.salvos = 0;
        fleet.stores -= 1;
      }
    }
    if (had > 0 && fleet.supply === 0 && fleet.ships.length > 0) events.push({ type: "outOfSupply", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId });
    refreshFleetStats(pack, state, fleet);
  }
  state.fleets = state.fleets.filter((f) => f.ships.length > 0);
}
