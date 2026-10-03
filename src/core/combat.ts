import type { ContentPack, Formation } from "../content/schema";
import { empireEffects } from "./economy";
import { buildAdjacency, shortestPaths } from "./graph";
import { Rng } from "./rng";
import { designStats, fleetArmed, getDesign, refreshFleetStats, type DesignStats } from "./ships";
import { suppliedSystems } from "./supply";
import type { BattleReport, BattleShot, EmpireId, Fleet, FleetId, GameEvent, GameState, Ship, SystemId } from "./state";

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
}

export function resolveCombat(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const rng = new Rng(state.rngState);
  state.lastBattles = [];
  const bySystem = new Map<SystemId, Fleet[]>();
  for (const fleet of state.fleets) {
    if (fleet.progress > 0) continue;
    bySystem.set(fleet.systemId, [...(bySystem.get(fleet.systemId) ?? []), fleet]);
  }
  const systems = [...bySystem.keys()].sort((a, b) => a - b);
  for (const systemId of systems) {
    const fleets = bySystem.get(systemId)!.sort((a, b) => a.id - b.id);
    const empires = new Set(fleets.map((f) => f.empireId));
    if (empires.size < 2) continue;
    const triggers = fleets.some((f) => f.orders.mission === "engage" && fleetArmed(pack, state, f));
    if (!triggers) continue;
    fight(state, pack, rng, systemId, fleets, events);
  }
  state.rngState = rng.state;
  state.fleets = state.fleets.filter((f) => f.ships.length > 0);
}

function fight(state: GameState, pack: ContentPack, rng: Rng, systemId: SystemId, fleets: Fleet[], events: GameEvent[]): void {
  const cfg = pack.combat;
  const combatants = new Map<number, Combatant>();
  for (const fleet of fleets) {
    const empire = state.empires[fleet.empireId]!;
    const fx = empireEffects(pack, empire);
    for (const ship of fleet.ships) {
      const design = getDesign(empire, ship.designId);
      combatants.set(ship.id, {
        ship,
        fleet,
        stats: designStats(pack, design, fx),
        designName: design.name,
        formation: design.formation,
        depleted: fleet.supply <= 0,
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

  for (let round = 0; round < cfg.rounds; round++) {
    const fighting = active();
    const sides = new Set(fighting.map((f) => f.empireId));
    if (sides.size < 2 || !fighting.some((f) => fleetArmed(pack, state, f))) break;

    const shots: BattleShot[] = [];
    for (const fleet of fighting) {
      const enemies = fighting.filter((f) => f.empireId !== fleet.empireId).flatMap((f) => f.ships.map((s) => combatants.get(s.id)!));
      if (enemies.length === 0) continue;
      for (const ship of fleet.ships) {
        const attacker = combatants.get(ship.id)!;
        for (const weapon of attacker.stats.weapons) {
          const target = rng.weighted(enemies, (e) => targetWeight(pack, fleet, e));
          const chance = Math.max(5, weapon.accuracy - target.stats.evasion);
          const hit = rng.int(1, 100) <= chance;
          let damage = 0;
          if (hit) {
            damage = Math.max(1, weapon.damage - target.stats.shield);
            damage = Math.floor((damage * cfg.stanceDamage[fleet.orders.stance]) / 100);
            damage = Math.floor((damage * cfg.stanceDefense[target.fleet.orders.stance]) / 100);
            if (attacker.depleted) damage = Math.floor((damage * (100 - cfg.outOfSupplyDamagePercent)) / 100);
            damage = Math.max(1, damage);
          }
          shots.push({ attacker: ship.id, target: target.ship.id, damage, destroyed: false });
        }
      }
    }

    // Simultaneous resolution: every shot this round lands, then the dead are removed.
    for (const shot of shots) {
      if (shot.damage === 0) continue;
      const target = combatants.get(shot.target)!;
      const wasAlive = target.ship.hp > 0;
      target.ship.hp -= shot.damage;
      if (wasAlive && target.ship.hp <= 0) shot.destroyed = true;
      const attackerEmpire = combatants.get(shot.attacker)!.fleet.empireId;
      damageDealt.set(attackerEmpire, (damageDealt.get(attackerEmpire) ?? 0) + shot.damage);
    }
    for (const fleet of fighting) fleet.ships = fleet.ships.filter((s) => s.hp > 0);

    const withdrew: FleetId[] = [];
    for (const fleet of active()) {
      const start = startHp.get(fleet.id)!;
      const now = fleet.ships.reduce((n, s) => n + s.hp, 0);
      const lostPercent = start > 0 ? Math.floor(((start - now) * 100) / start) : 0;
      const evading = fleet.orders.mission === "evade" || !fleetArmed(pack, state, fleet);
      if (evading || (fleet.orders.retreatPercent < 100 && lostPercent >= fleet.orders.retreatPercent)) {
        retreated.add(fleet.id);
        withdrew.push(fleet.id);
      }
    }
    report.rounds.push({ shots, retreated: withdrew });
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

  // Retreating fleets head for the nearest friendly supplied system.
  for (const fleet of fleets) {
    if (retreated.has(fleet.id) && fleet.ships.length > 0) {
      fleet.route = retreatRoute(state, pack, fleet);
      fleet.holding = false;
    }
    refreshFleetStats(pack, state, fleet);
  }
}

function targetWeight(pack: ContentPack, attacker: Fleet, target: Combatant): number {
  const base = pack.combat.formationWeight[target.formation];
  const priority = attacker.orders.targetPriority;
  if (priority === "warships" && target.stats.armed) return base * 3;
  if (priority === "transports" && (target.stats.role === "transport" || target.stats.role === "support")) return base * 3;
  return base;
}

function retreatRoute(state: GameState, pack: ContentPack, fleet: Fleet): SystemId[] {
  const adj = buildAdjacency(state.galaxy.systems.length, state.galaxy.lanes);
  const { dist, prev } = shortestPaths(adj, fleet.systemId);
  const supplied = suppliedSystems(state, pack, fleet.empireId);
  const hostile = new Set(state.fleets.filter((f) => f.empireId !== fleet.empireId && f.progress === 0).map((f) => f.systemId));
  let best = -1;
  for (let i = 0; i < dist.length; i++) {
    if (i === fleet.systemId || !supplied.has(i) || hostile.has(i) || dist[i] === Infinity) continue;
    if (best === -1 || dist[i]! < dist[best]!) best = i;
  }
  if (best === -1) {
    // Nowhere safe: fall back one lane to the nearest neighbor.
    const neighbor = adj[fleet.systemId]![0];
    return neighbor ? [neighbor.id] : [];
  }
  const path: SystemId[] = [];
  for (let at: number = best; at !== fleet.systemId && at !== -1; at = prev[at]!) path.push(at);
  return path.reverse();
}
