import type { ContentPack, DesignData, ShipRole } from "../content/schema";
import { empireEffects, type Totals } from "./economy";
import type { Empire, Fleet, FleetOrders, GameState, Ship, ShipDesign } from "./state";

/**
 * Ship designs (a hull plus components) and fleets (stacks of ships).
 * Design stats are derived from content data every time, so balance changes
 * to hulls and components apply to existing ships.
 */

type Hull = ContentPack["hulls"][number];
type Component = ContentPack["components"][number];

export function getHull(pack: ContentPack, id: string): Hull {
  const hull = pack.hulls.find((h) => h.id === id);
  if (!hull) throw new Error(`unknown hull "${id}"`);
  return hull;
}

export function getComponent(pack: ContentPack, id: string): Component {
  const component = pack.components.find((c) => c.id === id);
  if (!component) throw new Error(`unknown component "${id}"`);
  return component;
}

export function getDesign(empire: Empire, id: string): ShipDesign {
  const design = empire.designs.find((d) => d.id === id);
  if (!design) throw new Error(`empire ${empire.id} has no design "${id}"`);
  return design;
}

export interface Weapon {
  damage: number;
  accuracy: number;
}

export interface DesignStats {
  cost: number;
  upkeep: number;
  maxHp: number;
  shield: number;
  weapons: Weapon[];
  speed: number;
  sensorRange: number;
  evasion: number;
  endurance: number;
  /** Extra turns of supply this ship adds to its fleet. */
  fuel: number;
  colonize: boolean;
  armed: boolean;
  role: ShipRole;
  /** Expected damage per combat round. */
  damagePerRound: number;
}

/** Stats for a design, including the empire's tech bonuses. */
export function designStats(pack: ContentPack, design: Pick<ShipDesign, "hull" | "components">, fx: Totals): DesignStats {
  const hull = getHull(pack, design.hull);
  const parts = design.components.map((id) => getComponent(pack, id));
  const sum = (key: "hp" | "shield" | "speed" | "sensorRange" | "fuel" | "cost") => parts.reduce((n, c) => n + c[key], 0);
  const weapons = parts
    .filter((c) => c.kind === "weapon")
    .map((c) => ({ damage: Math.floor((c.damage * (100 + fx.damagePercent)) / 100), accuracy: c.accuracy }));
  const colonize = parts.some((c) => c.kind === "colony");
  const armed = weapons.length > 0;
  const role: ShipRole = colonize ? "transport" : armed ? "combat" : parts.some((c) => c.kind === "fuel") ? "support" : parts.some((c) => c.kind === "sensor") ? "recon" : "support";
  return {
    cost: hull.cost + sum("cost"),
    upkeep: hull.upkeep,
    maxHp: hull.structure + sum("hp"),
    shield: sum("shield"),
    weapons,
    speed: hull.speed + sum("speed") + fx.speed,
    sensorRange: hull.sensorRange + sum("sensorRange") + fx.sensorRange,
    evasion: hull.evasion,
    endurance: hull.endurance + fx.endurance,
    fuel: sum("fuel"),
    colonize,
    armed,
    role,
    damagePerRound: weapons.reduce((n, w) => n + (w.damage * w.accuracy) / 100, 0),
  };
}

export function shipStats(pack: ContentPack, empire: Empire, ship: Ship): DesignStats {
  return designStats(pack, getDesign(empire, ship.designId), empireEffects(pack, empire));
}

export function hullAvailable(pack: ContentPack, empire: Empire, hullId: string): boolean {
  const hull = pack.hulls.find((h) => h.id === hullId);
  return !!hull && (!hull.requires || empire.techs.includes(hull.requires));
}

export function componentAvailable(pack: ContentPack, empire: Empire, componentId: string): boolean {
  const component = pack.components.find((c) => c.id === componentId);
  return !!component && (!component.requires || empire.techs.includes(component.requires));
}

/** Why a design can't be saved, or null. */
export function designBlocker(pack: ContentPack, empire: Empire, design: Omit<DesignData, "id">): string | null {
  const name = design.name.trim();
  if (name.length === 0 || name.length > 30) return "name must be 1-30 characters";
  if (!hullAvailable(pack, empire, design.hull)) return "hull not available";
  const hull = getHull(pack, design.hull);
  if (design.components.length > hull.slots) return `only ${hull.slots} slots`;
  for (const id of design.components) if (!componentAvailable(pack, empire, id)) return `component "${id}" not available`;
  if (empire.designs.some((d) => !d.obsolete && d.name.toLowerCase() === name.toLowerCase())) return "a design with that name exists";
  return null;
}

export function designBuildable(pack: ContentPack, empire: Empire, design: ShipDesign): boolean {
  return !design.obsolete && hullAvailable(pack, empire, design.hull) && design.components.every((c) => componentAvailable(pack, empire, c));
}

// ---------- fleets ----------

export function defaultOrders(armed: boolean): FleetOrders {
  return armed
    ? { mission: "engage", stance: "balanced", targetPriority: "warships", retreatPercent: 50 }
    : { mission: "evade", stance: "cautious", targetPriority: "any", retreatPercent: 25 };
}

export function fleetShipStats(pack: ContentPack, state: GameState, fleet: Fleet): DesignStats[] {
  const empire = state.empires[fleet.empireId]!;
  const fx = empireEffects(pack, empire);
  return fleet.ships.map((ship) => designStats(pack, getDesign(empire, ship.designId), fx));
}

/** Turns of supply a full fleet carries: its shortest-legged ship plus any fuel tanks aboard. */
export function fleetMaxSupply(pack: ContentPack, state: GameState, fleet: Fleet): number {
  const stats = fleetShipStats(pack, state, fleet);
  if (stats.length === 0) return 0;
  return Math.min(...stats.map((s) => s.endurance)) + stats.reduce((n, s) => n + s.fuel, 0);
}

export function fleetArmed(pack: ContentPack, state: GameState, fleet: Fleet): boolean {
  return fleetShipStats(pack, state, fleet).some((s) => s.armed);
}

export function fleetCanColonize(pack: ContentPack, state: GameState, fleet: Fleet): boolean {
  return fleetShipStats(pack, state, fleet).some((s) => s.colonize);
}

/**
 * A rough combat strength: expected damage per round times durability, summed.
 * Used for sightings, odds estimates and the AI. Not used to resolve combat.
 */
export function fleetStrength(pack: ContentPack, state: GameState, fleet: Fleet): number {
  const empire = state.empires[fleet.empireId]!;
  const fx = empireEffects(pack, empire);
  let total = 0;
  for (const ship of fleet.ships) {
    const s = designStats(pack, getDesign(empire, ship.designId), fx);
    total += (s.damagePerRound * (ship.hp + s.shield * 6)) / 4;
  }
  return Math.round(total);
}

/** Recompute cached speed and sensor range. Out-of-supply fleets are slowed. */
export function refreshFleetStats(pack: ContentPack, state: GameState, fleet: Fleet): void {
  const stats = fleetShipStats(pack, state, fleet);
  if (stats.length === 0) {
    fleet.speed = 0;
    fleet.sensorRange = 0;
    return;
  }
  const slowest = Math.min(...stats.map((s) => s.speed));
  const depleted = fleet.supply <= 0;
  fleet.speed = depleted ? Math.floor((slowest * (100 - pack.combat.outOfSupplySpeedPercent)) / 100) : slowest;
  fleet.sensorRange = Math.max(...stats.map((s) => s.sensorRange));
}

/** Create a fleet of new, fully repaired ships. Callers push it into state.fleets. */
export function newFleet(state: GameState, pack: ContentPack, empire: Empire, designIds: string[], systemId: number): Fleet {
  const first = getDesign(empire, designIds[0]!);
  const count = (empire.shipsBuilt[first.id] ?? 0) + 1;
  empire.shipsBuilt[first.id] = count;
  const fx = empireEffects(pack, empire);
  const ships: Ship[] = designIds.map((designId) => ({
    id: state.nextId++,
    designId,
    hp: designStats(pack, getDesign(empire, designId), fx).maxHp,
  }));
  const fleet: Fleet = {
    id: state.nextId++,
    empireId: empire.id,
    name: `${first.name} ${count}`,
    ships,
    orders: defaultOrders(false),
    supply: 0,
    speed: 0,
    sensorRange: 0,
    systemId,
    route: [],
    progress: 0,
    holding: false,
  };
  fleet.orders = defaultOrders(fleetArmed(pack, state, fleet));
  fleet.supply = fleetMaxSupply(pack, state, fleet);
  refreshFleetStats(pack, state, fleet);
  return fleet;
}

export function startingDesigns(pack: ContentPack): ShipDesign[] {
  return pack.startingDesigns.map((d) => ({ ...d, components: [...d.components], obsolete: false }));
}
