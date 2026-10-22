import type { ContentPack } from "../content/schema";
import { empireEffects, findBody, getBuilding, learnTech, planetStats, refreshEmpireStats } from "./economy";
import { Rng } from "./rng";
import { fleetShipStats, refreshFleetStats, shipStats, type Weapon } from "./ships";
import type { Colony, Empire, EmpireId, Fleet, GameEvent, GameState } from "./state";

/**
 * Orbital and planetary defense, minefields, and invasion.
 *
 * A colony's defenses come from its buildings: orbital hit points, guns, a shield,
 * garrison troops and mines. In battle the defenses act like one ship that never
 * retreats. Once they are knocked to 0 hit points, troop transports in orbit can
 * land: ground combat weighs troops (attacker vs garrison plus militia), tech and
 * terrain. A captured colony changes hands with its buildings.
 */

export interface ColonyDefense {
  maxHp: number;
  shield: number;
  weapons: Weapon[];
  /** Garrison troops at full strength. */
  maxTroops: number;
  mines: number;
}

export function colonyDefense(pack: ContentPack, empire: Empire, colony: Colony): ColonyDefense {
  const pct = 100 + empireEffects(pack, empire).defensePercent;
  const cfg = pack.combat;
  // Every colony has planetary batteries that grow with its population; buildings add the rest.
  const result: ColonyDefense = { maxHp: colony.population * cfg.colonyDefenseHpPerPop, shield: 0, weapons: [], maxTroops: 0, mines: 0 };
  for (let i = 0; i < Math.floor(colony.population / cfg.colonyPopPerGun); i++) result.weapons.push({ damage: cfg.colonyGunDamage, accuracy: cfg.colonyGunAccuracy, range: 3, ammo: 0 });
  for (const id of colony.buildings) {
    const d = getBuilding(pack, id).defense;
    result.maxHp += d.hp ?? 0;
    result.shield += d.shield ?? 0;
    result.maxTroops += d.troops ?? 0;
    result.mines += d.mines ?? 0;
    for (const w of d.weapons ?? []) {
      for (let i = 0; i < w.count; i++) result.weapons.push({ damage: w.damage, accuracy: w.accuracy, range: 3, ammo: 0 });
    }
  }
  result.maxHp = Math.floor((result.maxHp * pct) / 100);
  result.weapons = result.weapons.map((w) => ({ ...w, damage: Math.floor((w.damage * pct) / 100) }));
  return result;
}

/** Defending troop strength: garrison plus militia, boosted by terrain and tech. */
export function defendingTroops(state: GameState, pack: ContentPack, colony: Colony): number {
  const empire = state.empires[colony.empireId]!;
  const body = findBody(state, colony.systemId, colony.bodyId);
  const terrain = body ? planetStats(pack, body).groundDefense : 0;
  const base = colony.troops + militia(pack, colony);
  return Math.floor((base * (100 + terrain + empireEffects(pack, empire).groundPercent)) / 100);
}

/** Militia the colony can raise now: its population, less those lost in recent fighting. */
export function militia(pack: ContentPack, colony: Colony): number {
  return Math.max(0, colony.population * pack.combat.militiaPerPop - colony.militiaLosses);
}

/** Troops a fleet can land, boosted by its empire's ground tech. */
export function fleetTroops(state: GameState, pack: ContentPack, fleet: Fleet): number {
  const empire = state.empires[fleet.empireId]!;
  const raw = fleetShipStats(pack, state, fleet).reduce((n, s) => n + s.troops, 0);
  return Math.floor((raw * (100 + empireEffects(pack, empire).groundPercent)) / 100);
}

/** Whether troops can land: the colony's orbital defenses are knocked out, or it has no guns to stop them. */
export function defensesDown(state: GameState, pack: ContentPack, colony: Colony): boolean {
  return colony.defenseHp <= 0 || colonyDefense(pack, state.empires[colony.empireId]!, colony).weapons.length === 0;
}

/** Rough combat strength of a colony's defenses, comparable with fleetStrength. */
export function defenseStrength(pack: ContentPack, empire: Empire, colony: Colony): number {
  const d = colonyDefense(pack, empire, colony);
  const dpr = d.weapons.reduce((n, w) => n + (w.damage * w.accuracy) / 100, 0);
  return Math.round((dpr * (colony.defenseHp + d.shield * 6)) / 4);
}

/** Economy phase: defenses repair and garrisons refill; colony minefields are topped up. */
export function regenerateDefenses(state: GameState, pack: ContentPack): void {
  for (const colony of state.colonies) {
    const empire = state.empires[colony.empireId]!;
    const d = colonyDefense(pack, empire, colony);
    if (d.mines > 0) addMines(state, pack, colony.systemId, colony.empireId, Math.ceil(d.mines / 5), d.mines);
    if (colony.blockaded) continue; // no repairs under siege
    colony.militiaLosses = Math.max(0, colony.militiaLosses - pack.combat.militiaRegenPerTurn);
    // Knocked-out defenses stay down while enemy ships of any kind are in orbit (transports left alone, say).
    const watched = state.fleets.some((f) => f.empireId !== colony.empireId && f.systemId === colony.systemId && f.progress === 0);
    if (!(watched && colony.defenseHp <= 0)) colony.defenseHp = Math.min(d.maxHp, colony.defenseHp + Math.ceil((d.maxHp * pack.combat.defenseRepairPercent) / 100));
    colony.troops = Math.min(d.maxTroops, colony.troops + Math.ceil((d.maxTroops * pack.combat.garrisonRegenPercent) / 100));
  }
}

export function addMines(state: GameState, pack: ContentPack, systemId: number, empireId: EmpireId, amount: number, cap = pack.combat.maxMines): void {
  let field = state.minefields.find((m) => m.systemId === systemId && m.empireId === empireId);
  if (!field) {
    field = { systemId, empireId, strength: 0 };
    state.minefields.push(field);
    state.minefields.sort((a, b) => a.systemId - b.systemId || a.empireId - b.empireId);
  }
  field.strength = Math.min(Math.max(cap, field.strength), field.strength + amount);
}

/**
 * Supply phase: minelayers waiting in a system lay mines there; then every
 * minefield takes its chance at each hostile ship stopped in its system.
 */
export function resolveMines(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
    if (fleet.progress > 0 || fleet.route.length > 0) continue;
    const laid = fleetShipStats(pack, state, fleet).reduce((n, s) => n + s.mines, 0);
    if (laid > 0) addMines(state, pack, fleet.systemId, fleet.empireId, laid);
  }
  if (state.minefields.length === 0) return;

  const rng = new Rng(state.rngState);
  for (const field of state.minefields) {
    const victims = state.fleets.filter((f) => f.empireId !== field.empireId && f.progress === 0 && f.systemId === field.systemId).sort((a, b) => a.id - b.id);
    for (const fleet of victims) {
      const empire = state.empires[fleet.empireId]!;
      let hits = 0;
      const before = fleet.ships.length;
      for (const ship of fleet.ships) {
        if (field.strength <= 0) break;
        if (rng.int(1, 100) > pack.combat.mineHitPercent) continue;
        hits++;
        field.strength -= 1;
        const damage = Math.max(1, pack.combat.mineDamage - shipStats(pack, empire, ship).shield);
        ship.hp -= damage;
      }
      fleet.ships = fleet.ships.filter((s) => s.hp > 0);
      if (hits > 0) {
        events.push({ type: "mineHits", turn: state.turn, empireId: fleet.empireId, systemId: field.systemId, hits, shipsLost: before - fleet.ships.length });
        refreshFleetStats(pack, state, fleet);
      }
    }
  }
  state.rngState = rng.state;
  state.minefields = state.minefields.filter((m) => m.strength > 0);
  state.fleets = state.fleets.filter((f) => f.ships.length > 0);
}

/**
 * Invasion phase (after combat): fleets ordered to invade land their troops if
 * they are in orbit and the colony's orbital defenses are down. Fleets of one
 * empire landing on the same colony fight together. Troop ships are spent either way.
 */
export function resolveInvasions(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const rng = new Rng(state.rngState);
  const landings = new Map<number, Fleet[]>();
  for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
    const targetId = fleet.invadeColonyId;
    if (targetId === null) continue;
    const colony = state.colonies.find((c) => c.id === targetId);
    if (!colony || colony.empireId === fleet.empireId) {
      fleet.invadeColonyId = null; // target gone or already ours
      continue;
    }
    if (fleet.progress > 0 || fleet.systemId !== colony.systemId || fleetTroops(state, pack, fleet) === 0) continue; // keep waiting
    if (!defensesDown(state, pack, colony)) continue; // its guns still stand
    landings.set(colony.id, [...(landings.get(colony.id) ?? []), fleet]);
  }

  for (const [colonyId, fleets] of [...landings].sort((a, b) => a[0] - b[0])) {
    const colony = state.colonies.find((c) => c.id === colonyId)!;
    // Only the first attacking empire lands this turn; others keep waiting.
    const attackerId = fleets[0]!.empireId;
    const attackers = fleets.filter((f) => f.empireId === attackerId);
    let defense = defendingTroops(state, pack, colony);
    const landing = chooseLanding(state, pack, attackers, defense);
    if (landing.ships.size === 0) {
      events.push({ type: "invasionWaiting", turn: state.turn, empireId: attackerId, colonyId, systemId: colony.systemId, troops: landing.available, needed: landing.needed });
      continue;
    }
    let attack = landing.troops;
    const startAttack = attack;
    const startDefense = defense;
    for (let round = 0; round < 20 && attack > 0 && defense > 0; round++) {
      const toDefender = Math.ceil((attack * rng.int(20, 40)) / 100);
      const toAttacker = Math.ceil((defense * rng.int(20, 40)) / 100);
      defense -= toDefender;
      attack -= toAttacker;
    }
    // Landed troop ships are spent whether or not they win; the rest stay in orbit.
    for (const fleet of attackers) {
      const before = fleet.ships.length;
      fleet.ships = fleet.ships.filter((s) => !landing.ships.has(s.id));
      if (fleet.ships.length !== before) refreshFleetStats(pack, state, fleet);
      if (fleetTroops(state, pack, fleet) === 0) {
        fleet.invadeColonyId = null;
        fleet.invadeAllOut = false;
      }
    }
    const defenderId = colony.empireId;
    const captured = defense <= 0 && attack > 0;
    if (captured) {
      captureColony(state, pack, colony, attackerId, attack, events);
      captureTech(state, pack, rng, attackerId, defenderId, colony, events);
    } else {
      // The defenders hold, but lose garrison and militia in proportion; both take turns to recover.
      const lostShare = startDefense > 0 ? (startDefense - Math.max(0, defense)) / startDefense : 0;
      colony.troops = Math.floor(colony.troops * (1 - lostShare));
      colony.militiaLosses = Math.min(colony.population * pack.combat.militiaPerPop, colony.militiaLosses + Math.ceil(militia(pack, colony) * lostShare));
    }
    for (const empireId of [attackerId, defenderId]) {
      events.push({
        type: "invasion",
        turn: state.turn,
        empireId,
        attackerId,
        defenderId,
        colonyId,
        systemId: colony.systemId,
        captured,
        attackingTroops: startAttack,
        defendingTroops: startDefense,
      });
    }
  }
  state.rngState = rng.state;
  state.fleets = state.fleets.filter((f) => f.ships.length > 0);
}

/**
 * Which troop ships land on a colony held by `defense` troops. All-out orders land every one.
 * Otherwise the biggest land first until their troops reach the safety margin (125% of the
 * defenders: a near-certain win) and the rest stay in orbit; if all of them together fall
 * short, none land and they wait for reinforcements.
 */
export function chooseLanding(state: GameState, pack: ContentPack, fleets: Fleet[], defense: number): { ships: Set<number>; troops: number; available: number; needed: number } {
  const boost = 100 + empireEffects(pack, state.empires[fleets[0]!.empireId]!).groundPercent;
  const troopsOf = (raw: number) => Math.floor((raw * boost) / 100);
  const carriers: { id: number; raw: number }[] = [];
  for (const fleet of [...fleets].sort((a, b) => a.id - b.id)) {
    fleetShipStats(pack, state, fleet).forEach((stats, i) => {
      if (stats.troops > 0) carriers.push({ id: fleet.ships[i]!.id, raw: stats.troops });
    });
  }
  carriers.sort((a, b) => b.raw - a.raw || a.id - b.id);
  const allRaw = carriers.reduce((n, c) => n + c.raw, 0);
  const needed = Math.ceil((defense * pack.combat.invasionMarginPercent) / 100);
  const available = troopsOf(allRaw);
  if (fleets.some((f) => f.invadeAllOut)) return { ships: new Set(carriers.map((c) => c.id)), troops: available, available, needed };
  if (available < needed) return { ships: new Set(), troops: 0, available, needed };
  const picked: { id: number; raw: number }[] = [];
  let raw = 0;
  for (const c of carriers) {
    if (troopsOf(raw) >= needed) break;
    picked.push(c);
    raw += c.raw;
  }
  return { ships: new Set(picked.map((c) => c.id)), troops: troopsOf(raw), available, needed };
}

function captureColony(state: GameState, pack: ContentPack, colony: Colony, newOwner: EmpireId, survivors: number, events: GameEvent[]): void {
  const oldOwner = colony.empireId;
  const wasCapital = colony.capital;
  const capitalOnly = new Set(pack.start.capitalBuildings.filter((id) => !getBuilding(pack, id).buildable));
  colony.empireId = newOwner;
  colony.capital = false;
  colony.buildings = colony.buildings.filter((id) => !capitalOnly.has(id));
  colony.population = Math.max(1, colony.population - Math.ceil((colony.population * pack.combat.captureLossPercent) / 100));
  colony.queue = [];
  colony.progress = 0;
  colony.focus = "balanced";
  colony.growth = 0;
  colony.blockaded = false;
  colony.defenseHp = 0;
  colony.troops = Math.min(colonyDefense(pack, state.empires[newOwner]!, colony).maxTroops, survivors);
  const explored = state.empires[newOwner]!.explored;
  if (!explored.includes(colony.systemId)) {
    explored.push(colony.systemId);
    explored.sort((a, b) => a - b);
  }
  if (wasCapital) moveCapital(state, pack, oldOwner, events);
}

/** The largest remaining colony becomes the new seat of government. */
function moveCapital(state: GameState, pack: ContentPack, empireId: EmpireId, events: GameEvent[]): void {
  const capitalOnly = pack.start.capitalBuildings.filter((id) => !getBuilding(pack, id).buildable);
  const remaining = state.colonies.filter((c) => c.empireId === empireId).sort((a, b) => b.population - a.population || a.id - b.id);
  const next = remaining[0];
  if (!next) return;
  next.capital = true;
  for (const id of capitalOnly) if (!next.buildings.includes(id)) next.buildings.push(id);
  state.empires[empireId]!.homeSystemId = next.systemId;
  events.push({ type: "capitalMoved", turn: state.turn, empireId, colonyId: next.id, systemId: next.systemId });
}

/** A colony bombed out of existence: the planet is free to settle again (unless the plague killed it). */
function destroyColony(state: GameState, pack: ContentPack, colony: Colony, attackerId: EmpireId, blighted: boolean, events: GameEvent[]): void {
  state.colonies = state.colonies.filter((c) => c.id !== colony.id);
  if (blighted) {
    const body = findBody(state, colony.systemId, colony.bodyId);
    if (body) body.blight = pack.combat.blightTurns;
  }
  for (const empireId of [attackerId, colony.empireId]) {
    events.push({ type: "colonyDestroyed", turn: state.turn, empireId, attackerId, ownerId: colony.empireId, colonyId: colony.id, systemId: colony.systemId, name: colony.name, blighted });
  }
  if (colony.capital) moveCapital(state, pack, colony.empireId, events);
}

/**
 * Bombardment phase (after combat, before invasions): fleets ordered to bombard a
 * colony whose orbital defenses are down hit its population, garrison, militia and
 * buildings, softening it for invasion. Kept up long enough it wipes the colony out. Plague bombs kill
 * three times as fast and leave the planet blighted; a planet cracker destroys the colony at once.
 */
export function resolveBombardment(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const rng = new Rng(state.rngState);
  const damage = new Map<number, { attackerId: EmpireId; amount: number; plague: number; cracker: boolean }>();
  for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
    const targetId = fleet.bombardColonyId;
    if (targetId === null) continue;
    const colony = state.colonies.find((c) => c.id === targetId);
    if (!colony || colony.empireId === fleet.empireId) {
      fleet.bombardColonyId = null;
      continue;
    }
    if (fleet.progress > 0 || fleet.systemId !== colony.systemId || colony.defenseHp > 0) continue;
    const stats = fleetShipStats(pack, state, fleet);
    const amount = stats.reduce((n, s) => n + s.bombard, 0);
    if (amount === 0) continue;
    const plague = stats.reduce((n, s) => n + s.plague, 0);
    const cracker = stats.some((s) => s.cracker);
    const entry = damage.get(colony.id);
    if (!entry) damage.set(colony.id, { attackerId: fleet.empireId, amount, plague, cracker });
    else if (entry.attackerId === fleet.empireId) {
      entry.amount += amount;
      entry.plague += plague;
      entry.cracker ||= cracker;
    }
  }
  for (const [colonyId, { attackerId, amount, plague, cracker }] of [...damage].sort((a, b) => a[0] - b[0])) {
    const colony = state.colonies.find((c) => c.id === colonyId)!;
    const cfg = pack.combat;
    // Plague bombs count three times over against the population.
    const populationLost = cracker ? colony.population : Math.max(1, Math.floor((amount + plague * 2) / cfg.bombardDamagePerPop));
    if (populationLost >= colony.population) {
      destroyColony(state, pack, colony, attackerId, plague > 0 && !cracker, events);
      continue;
    }
    colony.population -= populationLost;
    colony.growth = 0;
    colony.troops = Math.max(0, colony.troops - Math.floor(amount / 4));
    colony.militiaLosses = Math.min(colony.population * cfg.militiaPerPop, colony.militiaLosses + Math.floor(amount / 10));
    // Heavy bombing levels a building now and then.
    let buildingLost: string | null = null;
    const targets = colony.buildings.filter((id) => getBuilding(pack, id).buildable);
    if (targets.length > 0 && rng.int(1, 100) <= Math.min(60, amount * 2)) {
      buildingLost = rng.pick(targets);
      colony.buildings.splice(colony.buildings.indexOf(buildingLost), 1);
    }
    for (const empireId of [attackerId, colony.empireId]) {
      events.push({ type: "bombarded", turn: state.turn, empireId, attackerId, colonyId, systemId: colony.systemId, populationLost, buildingLost });
    }
  }
  state.rngState = rng.state;
}

/** Chance, in percent, that a commando raid succeeds against a colony. */
export function sabotageChance(state: GameState, pack: ContentPack, commandos: number, colony: Colony, attacker: Empire): number {
  return sabotageOdds(commandos, defendingTroops(state, pack, colony), empireEffects(pack, attacker).sabotagePercent);
}

/** Raid odds from commando teams, defending troops and the attacker's bonuses (so the UI can estimate from sightings). */
export function sabotageOdds(commandos: number, defenders: number, bonus = 0): number {
  return Math.max(10, Math.min(90, 30 + commandos * 15 + bonus - Math.floor(defenders / 2)));
}

/**
 * Special operations phase (after bombardment, before invasions): fleets with
 * commandos ordered to sabotage a rival colony in their system strike once a
 * turn. Success knocks out half the orbital defenses, halves the garrison and
 * scatters militia, or wrecks a building. Failure costs a commando ship.
 */
export function resolveSabotage(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const rng = new Rng(state.rngState);
  for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
    const order = fleet.sabotage;
    if (!order) continue;
    const colony = state.colonies.find((c) => c.id === order.colonyId);
    if (!colony || colony.empireId === fleet.empireId) {
      fleet.sabotage = null;
      continue;
    }
    if (fleet.progress > 0 || fleet.systemId !== colony.systemId) continue;
    const stats = fleetShipStats(pack, state, fleet);
    const commandos = stats.reduce((n, s) => n + s.commandos, 0);
    if (commandos === 0) continue;
    const success = rng.int(1, 100) <= sabotageChance(state, pack, commandos, colony, state.empires[fleet.empireId]!);
    if (success) {
      if (order.mission === "defenses") {
        const max = colonyDefense(pack, state.empires[colony.empireId]!, colony).maxHp;
        colony.defenseHp = Math.max(0, colony.defenseHp - Math.ceil(max / 2));
      } else if (order.mission === "garrison") {
        colony.troops = Math.floor(colony.troops / 2);
        colony.militiaLosses = Math.min(colony.population * pack.combat.militiaPerPop, colony.militiaLosses + Math.ceil((colony.population * pack.combat.militiaPerPop) / 3));
      } else {
        const targets = colony.buildings.filter((id) => getBuilding(pack, id).buildable);
        if (targets.length > 0) {
          const hit = rng.pick(targets);
          colony.buildings.splice(colony.buildings.indexOf(hit), 1);
        }
      }
    } else {
      // The team is caught: one of the ships carrying commandos is lost.
      const index = stats.findIndex((s) => s.commandos > 0);
      fleet.ships.splice(index, 1);
      refreshFleetStats(pack, state, fleet);
    }
    for (const empireId of [fleet.empireId, colony.empireId]) {
      events.push({ type: "sabotage", turn: state.turn, empireId, attackerId: fleet.empireId, colonyId: colony.id, systemId: colony.systemId, mission: order.mission, success });
    }
  }
  state.rngState = rng.state;
  state.fleets = state.fleets.filter((f) => f.ships.length > 0);
}

/**
 * Conquest can teach: a captured colony has a chance (25% plus Data Theft) to yield
 * one tech its old owner knew and the conqueror doesn't, the cheapest first. It may
 * come from a school the conqueror is locked out of; taking it doesn't commit them.
 */
export function captureTech(state: GameState, pack: ContentPack, rng: Rng, attackerId: EmpireId, defenderId: EmpireId, colony: Colony, events: GameEvent[]): void {
  const attacker = state.empires[attackerId]!;
  const defender = state.empires[defenderId]!;
  const chance = pack.combat.techCapturePercent + empireEffects(pack, attacker).techCapturePercent;
  if (rng.int(1, 100) > chance) return;
  const candidates = defender.techs
    .filter((id) => !attacker.techs.includes(id))
    .map((id) => pack.techs.find((t) => t.id === id)!)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const tech = candidates[0];
  if (!tech) return;
  learnTech(pack, attacker, tech.id, false);
  refreshEmpireStats(state, pack, attacker);
  events.push({ type: "techCaptured", turn: state.turn, empireId: attackerId, techId: tech.id, fromEmpireId: defenderId, colonyId: colony.id, systemId: colony.systemId });
}
