import type { ContentPack, DesignData, ShipRole, WeaponSpecial } from "../content/schema";
import { empireEffects, hasFlag, type Totals } from "./economy";
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
  /** Longest range it fires at: 1 short, 2 medium, 3 long. */
  range: number;
  special?: WeaponSpecial;
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
  /** Ground troops carried. */
  troops: number;
  /** Percent of hull repaired per turn across the fleet, even outside supply. */
  repair: number;
  /** Mine strength laid per turn while waiting in a system. */
  mines: number;
  colonize: boolean;
  armed: boolean;
  role: ShipRole;
  /** Expected damage per combat round. */
  damagePerRound: number;
  /** Combat agility: sets the battle range and adds evasion. */
  maneuver: number;
  pointDefense: number;
  /** Penalty to missiles and fighters aimed at this ship. */
  jamming: number;
  cyber: number;
  cyberDefense: number;
  /** Damage per turn to a colony under bombardment. */
  bombard: number;
  /** Carries an outpost kit. */
  outpost: boolean;
  commandos: number;
  stealth: boolean;
  /** Supply stores carried, in ship-turns. */
  stores: number;
  /** Fleet-wide accuracy bonus from a command network. */
  command: number;
}

/** Stats for a design, including the empire's tech bonuses. */
export function designStats(pack: ContentPack, design: Pick<ShipDesign, "hull" | "components">, fx: Totals): DesignStats {
  const hull = getHull(pack, design.hull);
  const parts = design.components.map((id) => getComponent(pack, id));
  const sum = (
    key:
      | "hp"
      | "shield"
      | "speed"
      | "sensorRange"
      | "fuel"
      | "cost"
      | "troops"
      | "repair"
      | "mines"
      | "accuracyBonus"
      | "jamming"
      | "pointDefense"
      | "cyber"
      | "cyberDefense"
      | "maneuver"
      | "bombard"
      | "commandos"
      | "stealth"
      | "stores"
      | "command",
  ) => parts.reduce((n, c) => n + c[key], 0);
  const aim = sum("accuracyBonus");
  const weapons: Weapon[] = parts
    .filter((c) => c.kind === "weapon" || c.kind === "hangar")
    .flatMap((c) =>
      Array.from({ length: c.shots + (c.kind === "hangar" ? fx.hangarShots : 0) }, () => ({
        damage: Math.floor((c.damage * (100 + fx.damagePercent)) / 100),
        accuracy: Math.min(100, c.accuracy + aim),
        range: c.range,
        ...(c.special ? { special: c.special } : {}),
      })),
    );
  const colonize = parts.some((c) => c.kind === "colony");
  const armed = weapons.length > 0;
  const outpost = parts.some((c) => c.kind === "outpost");
  const transport = colonize || outpost || parts.some((c) => c.kind === "troops");
  const role: ShipRole = transport ? "transport" : armed ? "combat" : parts.some((c) => c.kind === "sensor") ? "recon" : "support";
  return {
    cost: Math.max(1, Math.floor(((hull.cost + sum("cost")) * (100 + fx.shipCostPercent)) / 100)),
    upkeep: Math.floor((hull.upkeep * (100 + fx.shipUpkeepPercent)) / 100),
    maxHp: Math.floor((hull.structure * (100 + fx.structurePercent)) / 100) + sum("hp"),
    shield: sum("shield"),
    weapons,
    speed: hull.speed + sum("speed") + fx.speed,
    sensorRange: hull.sensorRange + sum("sensorRange") + fx.sensorRange,
    evasion: hull.evasion + fx.shipEvasion,
    endurance: hull.endurance + fx.endurance,
    fuel: sum("fuel"),
    troops: sum("troops"),
    repair: sum("repair"),
    mines: sum("mines"),
    colonize,
    armed,
    role,
    damagePerRound: weapons.reduce((n, w) => n + (w.damage * w.accuracy) / 100, 0),
    maneuver: hull.maneuver + sum("maneuver") + fx.maneuver,
    pointDefense: sum("pointDefense"),
    jamming: sum("jamming"),
    cyber: sum("cyber"),
    cyberDefense: sum("cyberDefense"),
    bombard: Math.floor((sum("bombard") * (100 + fx.damagePercent)) / 100),
    outpost,
    commandos: sum("commandos"),
    stealth: sum("stealth") > 0,
    stores: Math.floor((sum("stores") * (100 + fx.storesPercent)) / 100),
    command: sum("command") > 0 ? sum("command") + fx.commandBonus : 0,
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
  const slots = hullSlots(pack, empire, hull.id);
  if (design.components.length > slots) return `only ${slots} slots`;
  for (const id of design.components) {
    if (!componentAvailable(pack, empire, id)) return `component "${id}" not available`;
    const part = getComponent(pack, id);
    if (!componentFits(pack, empire, hull.id, id)) {
      return hull.slots < part.minSlots ? `${part.name} needs a hull with at least ${part.minSlots} slots` : `${part.name} only fits hulls of ${part.maxSlots} slots or fewer`;
    }
  }
  if (empire.designs.some((d) => !d.obsolete && d.name.toLowerCase() === name.toLowerCase())) return "a design with that name exists";
  return null;
}

/** Component slots on a hull for this empire (Miniaturization adds one). */
export function hullSlots(pack: ContentPack, empire: Empire, hullId: string): number {
  return getHull(pack, hullId).slots + empireEffects(pack, empire).slots;
}

/** Whether a component suits the hull's size (by its base slots). Stealth Hulls lift the cloaking size limit. */
export function componentFits(pack: ContentPack, empire: Empire, hullId: string, componentId: string): boolean {
  const hull = getHull(pack, hullId);
  const part = getComponent(pack, componentId);
  if (hull.slots < part.minSlots) return false;
  return hull.slots <= part.maxSlots || (part.stealth > 0 && hasFlag(pack, empire, "stealthHulls"));
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

/** The hull of a fleet's largest ship (most slots, then structure): what the fleet looks like from afar. */
export function flagshipHull(pack: ContentPack, state: GameState, fleet: Fleet): string {
  const empire = state.empires[fleet.empireId]!;
  let best: string | null = null;
  for (const ship of fleet.ships) {
    const hull = getHull(pack, getDesign(empire, ship.designId).hull);
    const current = best ? getHull(pack, best) : null;
    if (!current || hull.slots > current.slots || (hull.slots === current.slots && hull.structure > current.structure)) best = hull.id;
  }
  return best ?? pack.hulls[0]!.id;
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
/** A new fleet of freshly built ships; `xp` is the crews' starting experience (a military academy trains them). */
export function newFleet(state: GameState, pack: ContentPack, empire: Empire, designIds: string[], systemId: number, xp = 0): Fleet {
  const first = getDesign(empire, designIds[0]!);
  const count = (empire.shipsBuilt[first.id] ?? 0) + 1;
  empire.shipsBuilt[first.id] = count;
  const fx = empireEffects(pack, empire);
  const ships: Ship[] = designIds.map((designId) => ({
    id: state.nextId++,
    designId,
    hp: designStats(pack, getDesign(empire, designId), fx).maxHp,
    xp,
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
    invadeColonyId: null,
    bombardColonyId: null,
    sabotage: null,
    stores: 0,
  };
  fleet.orders = defaultOrders(fleetArmed(pack, state, fleet));
  fleet.supply = fleetMaxSupply(pack, state, fleet);
  fleet.stores = fleetShipStats(pack, state, fleet).reduce((n, s) => n + s.stores, 0);
  refreshFleetStats(pack, state, fleet);
  return fleet;
}

export function startingDesigns(pack: ContentPack): ShipDesign[] {
  return pack.startingDesigns.map((d) => ({ ...d, components: [...d.components], obsolete: false }));
}

/** A fleet made only of cloaked ships: hard to see, slips past blockades. */
export function fleetStealthy(pack: ContentPack, state: GameState, fleet: Fleet): boolean {
  const stats = fleetShipStats(pack, state, fleet);
  return stats.length > 0 && stats.every((s) => s.stealth);
}
