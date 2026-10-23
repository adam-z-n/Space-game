import type { ContentPack, PersonalityData } from "../../content/schema";
import { planMove, type Command } from "../commands";
import { fleetOrderBlocker, knownHostileSystems } from "../command";
import { empireEconomy, empireEffects, type EmpireEconomy, type Totals } from "../economy";
import { shortestPaths, type Neighbor } from "../graph";
import { knownAdjacency } from "../vision";
import { fleetArmed, fleetCanColonize, fleetMaxSupply, fleetShipStats, fleetStrength } from "../ships";
import { suppliedSystems } from "../supply";
import type { Colony, ColonySighting, Empire, EmpireId, Fleet, FleetSighting, GameState, SystemId } from "../state";

/**
 * Everything one AI empire knows and derives at the start of its turn.
 * Built only from that empire's own state and its sightings: the AI never
 * reads rival fleets or colonies directly, so it plays under fog of war.
 */
export interface FleetInfo {
  fleet: Fleet;
  strength: number;
  armed: boolean;
  colonize: boolean;
  /** Its colony ship is a gas giant habitat ship. */
  habitat: boolean;
  /** Carries an outpost kit. */
  outpost: boolean;
  /** An unarmed supply ship (stores for the field). */
  supplier: boolean;
  recon: boolean;
  /** Ground troops aboard (0 for most fleets). */
  troops: number;
  /** Bombardment per turn its bomb bays deal. */
  bombard: number;
  /** Commando teams aboard. */
  commandos: number;
  maxSupply: number;
  /** Current hit points as a fraction of full, in percent. */
  hpPercent: number;
  idle: boolean;
}

export interface AiContext {
  state: GameState;
  pack: ContentPack;
  empire: Empire;
  id: EmpireId;
  personality: PersonalityData;
  fx: Totals;
  adj: Neighbor[][];
  /** Lane distances from a system (cached). */
  dist(from: SystemId): number[];
  /** Whether the shortest route from `from` to `to` passes through any of `avoid` (endpoints excluded). */
  routeCrosses(from: SystemId, to: SystemId, avoid: Set<SystemId>): boolean;
  supplied: Set<SystemId>;
  fleets: FleetInfo[];
  colonies: Colony[];
  capital: Colony | undefined;
  economy: EmpireEconomy;
  /** Armed rival fleets seen in a system in the last few turns. */
  recentEnemies: FleetSighting[];
  rivalColonies: ColonySighting[];
  /** Best known strength per rival: the sum of its fleets seen in the last 15 turns. */
  rivalStrength: Map<EmpireId, number>;
  ownStrength: number;
  /** Our colonies' orbital defenses, on the fleet-strength scale. */
  ownDefense: number;
  commands: Command[];
  /** Fleets already given an order this turn. */
  busy: Set<number>;
  /** Systems where this empire knows of enemies (armed groups can't enter them). */
  hostile: Set<SystemId>;
  /** Groups ordered to form into fleets this turn (they may attack once the orders apply). */
  formedNow: Set<number>;
}

export function buildContext(state: GameState, pack: ContentPack, empireId: EmpireId): AiContext {
  const empire = state.empires[empireId]!;
  const personality = pack.aiPersonalities.find((p) => p.id === empire.personality) ?? pack.aiPersonalities[0]!;
  const adj = knownAdjacency(state, empireId);
  const cache = new Map<SystemId, ReturnType<typeof shortestPaths>>();
  const paths = (from: SystemId) => {
    let p = cache.get(from);
    if (!p) {
      p = shortestPaths(adj, from);
      cache.set(from, p);
    }
    return p;
  };
  const dist = (from: SystemId) => paths(from).dist;
  const routeCrosses = (from: SystemId, to: SystemId, avoid: Set<SystemId>) => {
    const { prev } = paths(from);
    for (let at = prev[to]!; at !== -1 && at !== from; at = prev[at]!) if (avoid.has(at)) return true;
    return false;
  };

  const fleets: FleetInfo[] = state.fleets
    .filter((f) => f.empireId === empireId)
    .sort((a, b) => a.id - b.id)
    .map((fleet) => {
      const stats = fleetShipStats(pack, state, fleet);
      const maxHp = stats.reduce((n, s) => n + s.maxHp, 0);
      const hp = fleet.ships.reduce((n, s) => n + s.hp, 0);
      return {
        fleet,
        strength: fleetStrength(pack, state, fleet),
        armed: fleetArmed(pack, state, fleet),
        colonize: fleetCanColonize(pack, state, fleet),
        habitat: stats.some((s) => s.colonize && s.habitat),
        outpost: stats.some((s) => s.outpost),
        supplier: stats.some((s) => s.stores > 0) && !stats.some((s) => s.armed),
        recon: stats.every((s) => s.role === "recon"),
        troops: stats.reduce((n, s) => n + s.troops, 0),
        bombard: stats.reduce((n, s) => n + s.bombard, 0),
        commandos: stats.reduce((n, s) => n + s.commandos, 0),
        maxSupply: fleetMaxSupply(pack, state, fleet),
        hpPercent: maxHp > 0 ? Math.floor((hp * 100) / maxHp) : 0,
        idle: fleet.progress === 0 && fleet.route.length === 0,
      };
    });
  const colonies = state.colonies.filter((c) => c.empireId === empireId).sort((a, b) => a.id - b.id);

  const rivalStrength = new Map<EmpireId, number>();
  for (const s of empire.sightings) {
    if (s.turn >= state.turn - 15 && s.armed) rivalStrength.set(s.empireId, (rivalStrength.get(s.empireId) ?? 0) + s.strength);
  }

  return {
    state,
    pack,
    empire,
    id: empireId,
    personality,
    fx: empireEffects(pack, empire),
    adj,
    dist,
    routeCrosses,
    supplied: suppliedSystems(state, pack, empireId),
    fleets,
    colonies,
    capital: colonies.find((c) => c.capital) ?? colonies[0],
    economy: empireEconomy(state, pack, empireId),
    recentEnemies: empire.sightings.filter((s) => s.turn >= state.turn - 3 && s.armed && s.nextSystemId === null),
    rivalColonies: empire.colonySightings,
    rivalStrength,
    ownStrength: fleets.filter((f) => f.armed && !f.colonize).reduce((n, f) => n + f.strength, 0),
    ownDefense: colonies.reduce((n, c) => n + defenseStrength(c.defenseHp), 0),
    commands: [],
    busy: new Set(),
    hostile: knownHostileSystems(state, pack, empireId),
    formedNow: new Set(),
  };
}

/**
 * Queue a move unless the fleet is already there or already heading there, or the command rules forbid it:
 * a fleet committed to its course carries on, a fleet stopped away from home heads for the nearest colony
 * or outpost instead, and an armed group stays out of enemy space.
 */
export function moveTo(ctx: AiContext, info: FleetInfo, systemId: SystemId): void {
  const f = info.fleet;
  ctx.busy.add(f.id);
  const heading = f.route.length > 0 ? f.route[f.route.length - 1] : f.progress === 0 ? f.systemId : undefined;
  if (heading === systemId) return;
  if (f.progress === 0 && f.systemId === systemId && f.route.length === 0) return;
  // Formed this turn at a command's home: the move is checked once the fleet exists.
  if (!ctx.formedNow.has(f.id) && typeof planMove(ctx.state, f.id, systemId, ctx.pack, ctx.hostile) === "string") {
    if (f.command && f.progress === 0 && fleetOrderBlocker(ctx.state, ctx.pack, f, systemId)) {
      const posts = [...new Set([...ctx.colonies.map((c) => c.systemId), ...ctx.state.outposts.filter((o) => o.empireId === ctx.id).map((o) => o.systemId)])];
      const d = ctx.dist(f.systemId);
      const post = posts.filter((s) => d[s] !== Infinity).sort((a, b) => d[a]! - d[b]! || a - b)[0];
      if (post !== undefined && post !== heading) ctx.commands.push({ type: "moveFleet", empireId: ctx.id, fleetId: f.id, destinationId: post });
    }
    return;
  }
  ctx.commands.push({ type: "moveFleet", empireId: ctx.id, fleetId: f.id, destinationId: systemId });
}

/** Where a fleet is (or will be once it reaches the next system). */
export function fleetAt(info: FleetInfo): SystemId {
  return info.fleet.progress > 0 ? info.fleet.route[0]! : info.fleet.systemId;
}

/** Can this fleet reach `systemId` and still get back into supply? */
export function withinReach(ctx: AiContext, info: FleetInfo, systemId: SystemId): boolean {
  const from = fleetAt(info);
  if (ctx.dist(from)[systemId] === Infinity) return false;
  if (ctx.supplied.has(systemId)) return true;
  // Distance from the target back to the nearest supplied system, plus the trip out, must fit in its supply.
  const back = Math.min(...[...ctx.supplied].map((s) => ctx.dist(systemId)[s]!), Infinity);
  const out = Math.min(...[...ctx.supplied].map((s) => ctx.dist(s)[systemId]!), Infinity);
  const turns = Math.ceil((out + back) / Math.max(1, info.fleet.speed));
  return turns <= info.maxSupply;
}

/** A colony's orbital defenses (as last seen), on the same scale as fleet strength. */
export function defenseStrength(defenseHp: number): number {
  return Math.floor((Math.max(0, defenseHp) * 6) / 5);
}

/** 0-10 personality value as a percent multiplier around 100 (5 = 100%). */
export function lean(value: number): number {
  return 50 + value * 10;
}
