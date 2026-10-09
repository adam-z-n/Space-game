import type { ContentPack, Formation } from "../content/schema";
import { empireEffects, hasFlag } from "./economy";
import { shortestPaths } from "./graph";
import { knownAdjacency } from "./vision";
import { Rng } from "./rng";
import { DAMAGEABLE_KINDS, combatShipCount, designStats, fleetArmed, fleetStealthy, getComponent, getDesign, refreshFleetStats, shipStats, type DesignStats, type Weapon } from "./ships";
import type { BattleReport, BattleShot, Colony, Empire, EmpireId, Fleet, FleetId, GameEvent, GameState, Ship, SystemId } from "./state";
import { colonyDefense, type ColonyDefense } from "./defense";
import { outpostDefense, outpostName } from "./outposts";

/**
 * Auto-resolved combat. A battle happens in any system holding ships of two
 * or more empires where at least one armed fleet is set to engage. Every empire
 * is hostile to every other for now (diplomacy is out of scope for v1).
 *
 * Each round every living ship fires each weapon at a target picked by weight
 * (formation role times the attacker's target priority). Shots in a round
 * resolve simultaneously. After each round fleets past their retreat threshold
 * withdraw, as do fleets on evade orders. All randomness comes from the seeded
 * game RNG, so battles replay identically.
 */

interface Combatant {
  ship: Ship;
  fleet: Fleet;
  stats: DesignStats;
  designName: string;
  formation: Formation;
  depleted: boolean;
  /** Accuracy and evasion from the crew's experience rank. */
  veteran: number;
  /** The design's component ids (empty for defenses), for battle damage. */
  parts: string[];
  empire: Empire | null;
}

/** Index into the content pack's ranks for an amount of experience. */
export function rankOf(pack: ContentPack, xp: number): number {
  let rank = 0;
  pack.combat.ranks.forEach((r, i) => {
    if (xp >= r.xp) rank = i;
  });
  return rank;
}

/** Accuracy and evasion a ship's experience is worth: rank times its hull's veteran bonus. */
export function veteranBonus(pack: ContentPack, hullId: string, xp: number): number {
  return rankOf(pack, xp) * (pack.hulls.find((h) => h.id === hullId)?.veteranBonus ?? 0);
}

/** The best command network alive in a fleet (0 without one). */
function commandBonus(fleet: Fleet, combatants: Map<number, Combatant>): number {
  return fleet.ships.reduce((n, s) => Math.max(n, s.hp > 0 ? combatants.get(s.id)!.stats.command : 0), 0);
}

export function resolveCombat(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const rng = new Rng(state.rngState);
  state.lastBattles = [];
  const bySystem = new Map<SystemId, Fleet[]>();
  for (const fleet of state.fleets) {
    if (fleet.progress > 0) continue;
    // Cloaked fleets stay out of battle unless they choose to attack.
    if (fleet.orders.mission === "evade" && fleetStealthy(pack, state, fleet)) continue;
    bySystem.set(fleet.systemId, [...(bySystem.get(fleet.systemId) ?? []), fleet]);
  }
  const systems = [...bySystem.keys()].sort((a, b) => a - b);
  for (const systemId of systems) {
    const fleets = bySystem.get(systemId)!.sort((a, b) => a.id - b.id);
    // Colonies with standing defenses, and combat outposts, take part as a ship that never retreats.
    const defended: Station[] = [
      ...state.colonies
        .filter((c) => c.systemId === systemId && c.defenseHp > 0)
        .sort((a, b) => a.id - b.id)
        .map((colony) => ({
          key: colony.id,
          empireId: colony.empireId,
          name: `Defenses of ${colony.name}`,
          hp: colony.defenseHp,
          defense: colonyDefense(pack, state.empires[colony.empireId]!, colony),
          colony,
          save: (hp: number) => (colony.defenseHp = hp),
        })),
      ...state.outposts
        .filter((o) => o.systemId === systemId && o.kind === "combat" && o.defenseHp > 0)
        .sort((a, b) => a.id - b.id)
        .map((outpost) => ({
          key: outpost.id,
          empireId: outpost.empireId,
          name: outpostName(pack, outpost),
          hp: outpost.defenseHp,
          defense: outpostDefense(pack, state.empires[outpost.empireId]!, outpost),
          colony: null,
          save: (hp: number) => (outpost.defenseHp = hp),
        })),
    ];
    const empires = new Set([...fleets.map((f) => f.empireId), ...defended.map((d) => d.empireId)]);
    if (empires.size < 2) continue;
    const fleetTriggers = fleets.some((f) => f.orders.mission === "engage" && fleetArmed(pack, state, f));
    const guns = defended.filter((d) => d.defense.weapons.length > 0 && fleets.some((f) => f.empireId !== d.empireId));
    if (!fleetTriggers && guns.length === 0) continue;
    fight(state, pack, rng, systemId, fleets, defended, events);
  }
  state.rngState = rng.state;
  state.fleets = state.fleets.filter((f) => f.ships.length > 0);
}

/** A colony's defenses or a combat outpost, fighting as one ship that never retreats. */
interface Station {
  /** Unique id (the colony's or outpost's), used as its ship id; its fleet id is the negation. */
  key: number;
  empireId: EmpireId;
  name: string;
  hp: number;
  defense: ColonyDefense;
  colony: Colony | null;
  save(hp: number): void;
}

function fight(
  state: GameState,
  pack: ContentPack,
  rng: Rng,
  systemId: SystemId,
  shipFleets: Fleet[],
  defended: Station[],
  events: GameEvent[],
): void {
  const cfg = pack.combat;
  const combatants = new Map<number, Combatant>();
  // A stand-in fleet per station: its id is the negated station key, its one "ship" uses the key.
  const stations = new Map<FleetId, Station>();
  const defenseFleets: Fleet[] = defended.map((station) => {
    const { key, defense } = station;
    const fleet: Fleet = {
      id: -key,
      empireId: station.empireId,
      name: station.name,
      ships: [{ id: key, designId: "", hp: station.hp, xp: 0, salvos: 0, damaged: [] }],
      orders: { mission: "engage", stance: "balanced", targetPriority: "warships", retreatPercent: 100 },
      supply: 1,
      stores: 0,
      speed: 0,
      sensorRange: 0,
      systemId,
      route: [],
      progress: 0,
      holding: true,
      invadeColonyId: null,
      bombardColonyId: null,
      sabotage: null,
    };
    stations.set(fleet.id, station);
    combatants.set(key, {
      ship: fleet.ships[0]!,
      fleet,
      stats: stationStats(defense),
      designName: station.name,
      formation: "front",
      depleted: false,
      veteran: 0,
      parts: [],
      empire: null,
    });
    return fleet;
  });
  const fleets = [...shipFleets, ...defenseFleets];
  const armed = (f: Fleet) => f.ships.some((s) => combatants.get(s.id)!.stats.armed);
  for (const fleet of shipFleets) {
    const empire = state.empires[fleet.empireId]!;
    const fx = empireEffects(pack, empire);
    for (const ship of fleet.ships) {
      const design = getDesign(empire, ship.designId);
      combatants.set(ship.id, {
        ship,
        fleet,
        stats: ship.damaged.length > 0 ? shipStats(pack, empire, ship) : designStats(pack, design, fx),
        designName: design.name,
        formation: design.formation,
        depleted: fleet.supply <= 0,
        veteran: veteranBonus(pack, design.hull, ship.xp),
        parts: design.components,
        empire,
      });
    }
  }
  const report: BattleReport = {
    id: state.nextId++,
    turn: state.turn,
    systemId,
    empires: [...new Set(fleets.map((f) => f.empireId))].sort((a, b) => a - b),
    ships: [...combatants.values()].map((c) => ({
      shipId: c.ship.id,
      fleetId: c.fleet.id,
      empireId: c.fleet.empireId,
      designName: c.designName,
      hp: c.ship.hp,
      maxHp: c.stats.maxHp,
    })),
    rounds: [],
    results: [],
  };
  const startHp = new Map(fleets.map((f) => [f.id, f.ships.reduce((n, s) => n + s.hp, 0)]));
  const retreated = new Set<FleetId>();
  const damageDealt = new Map<EmpireId, number>();
  const active = () => fleets.filter((f) => !retreated.has(f.id) && f.ships.length > 0);
  const living = (list: Fleet[]) => list.flatMap((f) => f.ships.map((s) => combatants.get(s.id)!));

  // Oversized fleets fight less well together; a command network lets a fleet run larger.
  // Only warships count: support ships ride along free.
  const oversize = new Map(
    fleets.map((f) => {
      if (stations.has(f.id)) return [f.id, 0];
      const limit = cfg.fleetSizeLimit + (commandBonus(f, combatants) > 0 ? cfg.commandSizeBonus : 0);
      return [f.id, Math.min(cfg.oversizePenaltyMax, Math.max(0, combatShipCount(pack, state, f) - limit) * cfg.oversizePenalty)];
    }),
  );
  const tractor = new Set(report.empires.filter((e) => hasFlag(pack, state.empires[e]!, "tractorBeams")));
  const hitAndRun = new Set(report.empires.filter((e) => hasFlag(pack, state.empires[e]!, "hitAndRun")));

  /** Apply a volley: damage, battle damage to components, kills. */
  const land = (volley: BattleShot[]) => {
    for (const shot of volley) {
      if (shot.damage === 0) continue;
      const target = combatants.get(shot.target)!;
      const wasAlive = target.ship.hp > 0;
      target.ship.hp -= shot.damage;
      if (wasAlive && target.ship.hp <= 0) shot.destroyed = true;
      const attackerEmpire = combatants.get(shot.attacker)!.fleet.empireId;
      damageDealt.set(attackerEmpire, (damageDealt.get(attackerEmpire) ?? 0) + shot.damage);
      // Heavy hits can knock out a component until the ship is repaired at a colony or depot.
      if (target.ship.hp > 0 && target.empire && rng.int(1, 100) <= Math.min(cfg.criticalMaxPercent, Math.floor((shot.damage * 100) / target.stats.maxHp))) {
        const working = target.parts.map((id, i) => ({ id, i })).filter(({ id, i }) => !target.ship.damaged.includes(i) && DAMAGEABLE_KINDS.has(getComponent(pack, id).kind));
        if (working.length > 0) {
          const hit = rng.pick(working);
          target.ship.damaged = [...target.ship.damaged, hit.i].sort((a, b) => a - b);
          target.stats = shipStats(pack, target.empire, target.ship);
          shot.knockedOut = getComponent(pack, hit.id).name;
        }
      }
    }
  };

  /** Every weapon of `fleet` in reach fires once at `targets`; missiles spend a salvo. */
  const volley = (fleet: Fleet, targets: Combatant[], disrupted: Set<number>, pointDefense: Map<FleetId, number>, command: Map<FleetId, number>, range: number, only?: (c: Combatant) => boolean): BattleShot[] => {
    const shots: BattleShot[] = [];
    for (const ship of fleet.ships) {
      if (disrupted.has(ship.id)) continue;
      const attacker = combatants.get(ship.id)!;
      if (only && !only(attacker)) continue;
      let launched = false;
      for (const weapon of attacker.stats.weapons) {
        if (weapon.range < range) continue; // out of reach at this range
        if (weapon.ammo > 0 && ship.salvos >= weapon.ammo) continue; // magazines empty
        if (weapon.ammo > 0) launched = true;
        shots.push(fire(pack, rng, fleet, attacker, weapon, targets, pointDefense, command, oversize));
      }
      if (launched) ship.salvos += 1;
    }
    return shots;
  };

  // Battles open at long range; each round the more maneuverable side moves the range toward its liking.
  let range = 3;
  for (let round = 0; round < cfg.rounds; round++) {
    const fighting = active();
    const sides = [...new Set(fighting.map((f) => f.empireId))].sort((a, b) => a - b);
    if (sides.length < 2 || !fighting.some(armed)) break;

    // Cyber attack: each side's suites may shut down enemy ships' weapons for this round.
    const disrupted = new Set<number>();
    for (const side of sides) {
      const cyber = living(fighting.filter((f) => f.empireId !== side)).reduce((n, c) => n + c.stats.cyber, 0);
      if (cyber === 0) continue;
      for (const fleet of fighting.filter((f) => f.empireId === side)) {
        if (stations.has(fleet.id)) continue;
        const firewall = fleet.ships.reduce((n, s) => n + combatants.get(s.id)!.stats.cyberDefense, 0);
        const chance = Math.min(cfg.cyberMax, cyber - firewall);
        if (chance <= 0) continue;
        for (const ship of fleet.ships) if (rng.int(1, 100) <= chance) disrupted.add(ship.id);
      }
    }

    // Point defense mounts per fleet, counted at the start of the round.
    const pointDefense = new Map(fighting.map((f) => [f.id, f.ships.reduce((n, s) => n + combatants.get(s.id)!.stats.pointDefense, 0)]));
    // Command networks coordinate their whole fleet while the command ship lives.
    const command = new Map(fighting.map((f) => [f.id, commandBonus(f, combatants)]));
    const shots: BattleShot[] = [];
    for (const fleet of fighting) {
      const enemies = living(fighting.filter((f) => f.empireId !== fleet.empireId));
      if (enemies.length > 0) shots.push(...volley(fleet, enemies, disrupted, pointDefense, command, range));
    }

    // Simultaneous resolution: every shot this round lands, then the dead are removed.
    land(shots);
    for (const fleet of fighting) fleet.ships = fleet.ships.filter((s) => s.hp > 0);

    const withdrew: FleetId[] = [];
    for (const fleet of active()) {
      const start = startHp.get(fleet.id)!;
      const now = fleet.ships.reduce((n, s) => n + s.hp, 0);
      const lostPercent = start > 0 ? Math.floor(((start - now) * 100) / start) : 0;
      if (stations.has(fleet.id)) continue; // defenses never withdraw
      const evading = fleet.orders.mission === "evade" || !armed(fleet);
      if (evading || (fleet.orders.retreatPercent < 100 && lostPercent >= fleet.orders.retreatPercent)) {
        retreated.add(fleet.id);
        withdrew.push(fleet.id);
      }
    }
    // Pursuit: a withdrawing fleet takes a parting volley from enemies more agile than it is
    // (all of them, if the enemy has tractor beams; none, with hit-and-run training).
    const pursuit: BattleShot[] = [];
    for (const id of withdrew) {
      const fleeing = fleets.find((f) => f.id === id)!;
      const pace = Math.min(...fleeing.ships.map((s) => combatants.get(s.id)!.stats.maneuver));
      const prey = living([fleeing]);
      for (const hunter of active()) {
        if (hunter.empireId === fleeing.empireId) continue;
        const grabbed = tractor.has(hunter.empireId);
        if (hitAndRun.has(fleeing.empireId) && !grabbed) continue;
        pursuit.push(...volley(hunter, prey, disrupted, pointDefense, command, range, (c) => grabbed || c.stats.maneuver > pace));
      }
    }
    land(pursuit);
    for (const fleet of fleets) fleet.ships = fleet.ships.filter((s) => s.hp > 0);
    report.rounds.push({ range, disrupted: [...disrupted].sort((a, b) => a - b), shots, retreated: withdrew, pursuit });
    range = nextRange(pack, range, active(), combatants, stations);
  }

  // Experience for every ship that came through: a battle survived, kills, and odds overcome.
  const kills = new Map<number, number>();
  for (const r of report.rounds) for (const shot of [...r.shots, ...r.pursuit]) if (shot.destroyed) kills.set(shot.attacker, (kills.get(shot.attacker) ?? 0) + 1);
  const sideHp = new Map<EmpireId, number>();
  for (const f of fleets) sideHp.set(f.empireId, (sideHp.get(f.empireId) ?? 0) + startHp.get(f.id)!);
  for (const fleet of shipFleets) {
    const enemyHp = [...sideHp].filter(([e]) => e !== fleet.empireId).reduce((n, [, hp]) => n + hp, 0);
    const outnumbered = enemyHp > (sideHp.get(fleet.empireId) ?? 0);
    const learning = 100 + empireEffects(pack, state.empires[fleet.empireId]!).xpPercent;
    for (const ship of fleet.ships) {
      if (ship.hp <= 0) continue;
      const earned = cfg.xpPerBattle + (kills.get(ship.id) ?? 0) * cfg.xpPerKill + (outnumbered ? cfg.xpOutnumbered : 0);
      ship.xp += Math.floor((earned * learning) / 100);
    }
  }

  // Outcome per empire.
  const survivors = active();
  for (const empireId of report.empires) {
    const mine = fleets.filter((f) => f.empireId === empireId);
    const lost = report.ships.filter((s) => s.empireId === empireId && !mine.some((f) => f.ships.some((x) => x.id === s.shipId))).length;
    report.results.push({
      empireId,
      shipsLost: lost,
      retreated: mine.filter((f) => retreated.has(f.id) && f.ships.length > 0).map((f) => f.id),
      damageDealt: damageDealt.get(empireId) ?? 0,
    });
    const holding = survivors.some((f) => f.empireId === empireId);
    const enemiesHolding = survivors.some((f) => f.empireId !== empireId);
    const outcome = holding && !enemiesHolding ? "won" : !holding && enemiesHolding ? "lost" : !holding ? "lost" : "draw";
    events.push({ type: "battle", turn: state.turn, empireId, systemId, battleId: report.id, outcome });
  }
  state.lastBattles.push(report);

  // Damage to defenses carries over; they repair slowly between battles.
  for (const [id, station] of stations) {
    const hp = Math.max(0, fleets.find((f) => f.id === id)!.ships[0]?.hp ?? 0);
    station.save(hp);
    const colony = station.colony;
    if (hp === 0 && colony) events.push({ type: "defensesDown", turn: state.turn, empireId: colony.empireId, colonyId: colony.id, systemId });
  }

  // Retreating fleets fall back to the nearest friendly or empty system.
  for (const fleet of shipFleets) {
    if (retreated.has(fleet.id) && fleet.ships.length > 0) {
      fleet.route = retreatRoute(state, pack, fleet);
      fleet.holding = false;
      fleet.invadeColonyId = null;
      fleet.bombardColonyId = null;
      fleet.sabotage = null;
    }
    refreshFleetStats(pack, state, fleet);
  }
}

/** One weapon's shot: pick a target, let screens and point defense have their say, roll to hit. */
function fire(
  pack: ContentPack,
  rng: Rng,
  fleet: Fleet,
  attacker: Combatant,
  weapon: Weapon,
  enemies: Combatant[],
  pointDefense: Map<FleetId, number>,
  command: Map<FleetId, number>,
  oversize: Map<FleetId, number>,
): BattleShot {
  const cfg = pack.combat;
  const fighters = weapon.special === "fighters";
  let target = rng.weighted(enemies, (e) => targetWeight(pack, fleet, e, fighters));
  // Screens move in to take fire meant for the support ships behind them (fighters slip past).
  if (!fighters && target.formation === "support") {
    const screens = enemies.filter((e) => e.fleet.empireId === target.fleet.empireId && e.formation === "screen");
    if (screens.length > 0 && rng.int(1, 100) <= cfg.screenInterceptPercent) target = rng.pick(screens);
  }
  const guided = weapon.special === "missile" || fighters;
  // Point defense anywhere in the target's fleet can shoot down missiles and fighters.
  if (guided) {
    const pd = pointDefense.get(target.fleet.id) ?? 0;
    const stop = Math.min(cfg.pointDefenseMax, pd * cfg.pointDefensePercent);
    if (stop > 0 && rng.int(1, 100) <= stop) return { attacker: attacker.ship.id, target: target.ship.id, damage: 0, destroyed: false, intercepted: true };
  }
  const evasion =
    target.stats.evasion +
    target.stats.maneuver * cfg.maneuverEvasion +
    (target.formation === "support" ? cfg.supportEvasion : 0) +
    (guided ? target.stats.jamming : 0) +
    target.veteran +
    Math.floor((command.get(target.fleet.id) ?? 0) / 2) -
    (oversize.get(target.fleet.id) ?? 0);
  const accuracy = weapon.accuracy + attacker.veteran + (command.get(fleet.id) ?? 0) - (oversize.get(fleet.id) ?? 0);
  const chance = Math.max(5, accuracy - evasion);
  let damage = 0;
  if (rng.int(1, 100) <= chance) {
    const shield = weapon.special === "pierce" ? 0 : target.stats.shield;
    damage = Math.max(1, weapon.damage - shield);
    damage = Math.floor((damage * cfg.stanceDamage[fleet.orders.stance]) / 100);
    damage = Math.floor((damage * cfg.stanceDefense[target.fleet.orders.stance]) / 100);
    if (attacker.depleted) damage = Math.floor((damage * (100 - cfg.outOfSupplyDamagePercent)) / 100);
    damage = Math.max(1, damage);
  }
  return { attacker: attacker.ship.id, target: target.ship.id, damage, destroyed: false };
}

/**
 * The range for the next round. Each side wants the range where its guns most outdo
 * the enemy's; the side with the higher maneuver (its slowest armed line ship) gets
 * its way by one step a round. When they are matched, the range closes.
 */
function nextRange(pack: ContentPack, range: number, fighting: Fleet[], combatants: Map<number, Combatant>, stations: Map<FleetId, Station>): number {
  const sides = [...new Set(fighting.map((f) => f.empireId))].sort((a, b) => a - b);
  if (sides.length < 2) return range;
  const firepower = (side: number, at: number) =>
    fighting
      .filter((f) => f.empireId === side)
      .flatMap((f) => f.ships.map((s) => combatants.get(s.id)!))
      .reduce((n, c) => n + c.stats.weapons.filter((w) => w.range >= at).reduce((m, w) => m + (w.damage * w.accuracy) / 100, 0), 0);
  const plans = sides.map((side) => {
    let best = range;
    let bestEdge = -Infinity;
    // Ties go to the longer range: no reason to close in for nothing.
    for (const at of [3, 2, 1]) {
      const enemy = sides.filter((s) => s !== side).reduce((n, s) => n + firepower(s, at), 0);
      const edge = firepower(side, at) - enemy;
      if (edge > bestEdge) {
        bestEdge = edge;
        best = at;
      }
    }
    // Agility: the slowest armed ship that isn't hanging back. Fixed defenses don't maneuver.
    const line = fighting
      .filter((f) => f.empireId === side && !stations.has(f.id))
      .flatMap((f) => f.ships.map((s) => combatants.get(s.id)!))
      .filter((c) => c.stats.armed && c.formation !== "support");
    // A command network lets the fleet maneuver as one: +1.
    const coordinated = fighting.some((f) => f.empireId === side && commandBonus(f, combatants) > 0);
    const agility = line.length > 0 ? Math.min(...line.map((c) => c.stats.maneuver)) + (coordinated ? 1 : 0) : -1;
    return { want: best, agility };
  });
  const top = Math.max(...plans.map((p) => p.agility));
  const leaders = plans.filter((p) => p.agility === top);
  const want = leaders.length === 1 ? leaders[0]!.want : Math.min(...leaders.map((p) => p.want), range - 1);
  if (want < range) return Math.max(1, range - 1);
  if (want > range) return Math.min(3, range + 1);
  return range;
}

/** Combat stats for a colony's defenses acting as one ship. */
function stationStats(defense: ColonyDefense): DesignStats {
  return {
    cost: 0,
    upkeep: 0,
    maxHp: defense.maxHp,
    shield: defense.shield,
    weapons: defense.weapons,
    speed: 0,
    sensorRange: 0,
    evasion: 0,
    endurance: 0,
    fuel: 0,
    troops: 0,
    repair: 0,
    mines: 0,
    colonize: false,
    armed: defense.weapons.length > 0,
    role: "combat",
    damagePerRound: defense.weapons.reduce((n, w) => n + (w.damage * w.accuracy) / 100, 0),
    maneuver: 0,
    pointDefense: 0,
    jamming: 0,
    cyber: 0,
    cyberDefense: 0,
    bombard: 0,
    outpost: false,
    commandos: 0,
    stealth: false,
    stores: 0,
    command: 0,
  };
}

function targetWeight(pack: ContentPack, attacker: Fleet, target: Combatant, fighters: boolean): number {
  // Fighters hunt the ships hanging back: support formations and transports.
  const hunted = fighters && (target.formation === "support" || target.stats.role === "transport" || target.stats.role === "support");
  const base = pack.combat.formationWeight[target.formation] * (hunted ? pack.combat.fighterSupportWeight : 1);
  const priority = attacker.orders.targetPriority;
  if (priority === "warships" && target.stats.armed) return base * 3;
  if (priority === "transports" && (target.stats.role === "transport" || target.stats.role === "support")) return base * 3;
  return base;
}

/**
 * Where a beaten fleet falls back to: the nearest system that is friendly (one of its
 * empire's colonies) or empty (no colony it knows of), with no hostile fleet in it,
 * avoiding hostile systems on the way. It uses only what its empire knows.
 */
function retreatRoute(state: GameState, pack: ContentPack, fleet: Fleet): SystemId[] {
  const empire = state.empires[fleet.empireId]!;
  const adj = knownAdjacency(state, fleet.empireId);
  const rivalColonies = new Set(empire.colonySightings.map((c) => c.systemId));
  const hostileFleets = new Set(state.fleets.filter((f) => f.empireId !== fleet.empireId && f.progress === 0 && f.route.length === 0).map((f) => f.systemId));
  const own = new Set(state.colonies.filter((c) => c.empireId === fleet.empireId).map((c) => c.systemId));
  const unsafe = (id: SystemId) => hostileFleets.has(id) || (rivalColonies.has(id) && !own.has(id));
  // Paths may not run through unsafe systems (other than the one being left).
  const safeAdj = adj.map((list, from) => (from !== fleet.systemId && unsafe(from) ? [] : list));
  const { dist, prev } = shortestPaths(safeAdj, fleet.systemId);
  let best = -1;
  for (let i = 0; i < dist.length; i++) {
    if (i === fleet.systemId || unsafe(i) || dist[i] === Infinity) continue;
    // Prefer friendly systems at equal distance; otherwise the closest refuge wins.
    if (best === -1 || dist[i]! < dist[best]! || (dist[i] === dist[best] && own.has(i) && !own.has(best))) best = i;
  }
  if (best === -1) {
    // Surrounded: fall back along the first lane that leads anywhere.
    const neighbor = adj[fleet.systemId]![0];
    return neighbor ? [neighbor.id] : [];
  }
  const path: SystemId[] = [];
  for (let at: number = best; at !== fleet.systemId && at !== -1; at = prev[at]!) path.push(at);
  return path.reverse();
}
