import { colonyOnBody, type FleetOrders, type SystemId } from "../state";
import { fleetAt, moveTo, withinReach, type AiContext, type FleetInfo } from "./context";
import type { Strategy } from "./strategy";

/**
 * The operational layer: give every fleet a job, most urgent first.
 * Each step skips fleets already given an order this turn (ctx.busy).
 */
export function planOperations(ctx: AiContext, strategy: Strategy): void {
  setStandingOrders(ctx);
  resupply(ctx);
  colonize(ctx, strategy);
  scout(ctx);
  defend(ctx, strategy);
  attack(ctx, strategy);
  garrison(ctx, strategy);
  gather(ctx);
}

const free = (ctx: AiContext, f: FleetInfo) => !ctx.busy.has(f.fleet.id);
const warships = (ctx: AiContext) => ctx.fleets.filter((f) => f.armed && !f.colonize && free(ctx, f));

function nearest(ctx: AiContext, from: SystemId, candidates: SystemId[]): SystemId | null {
  const d = ctx.dist(from);
  let best: SystemId | null = null;
  for (const c of candidates) if (d[c] !== Infinity && (best === null || d[c]! < d[best]! || (d[c] === d[best] && c < best))) best = c;
  return best;
}

/** Personality decides how fleets fight: stance, what to shoot, when to run. */
function setStandingOrders(ctx: AiContext): void {
  const p = ctx.personality;
  const wanted: FleetOrders = {
    mission: "engage",
    stance: p.aggression >= 7 ? "aggressive" : p.caution >= 7 ? "cautious" : "balanced",
    targetPriority: p.designStyle === "raider" ? "transports" : "warships",
    retreatPercent: Math.min(80, 20 + p.caution * 6),
  };
  for (const info of ctx.fleets) {
    if (!info.armed || info.colonize) continue;
    const o = info.fleet.orders;
    if (o.mission !== wanted.mission || o.stance !== wanted.stance || o.targetPriority !== wanted.targetPriority || o.retreatPercent !== wanted.retreatPercent) {
      ctx.commands.push({ type: "setFleetOrders", empireId: ctx.id, fleetId: info.fleet.id, orders: wanted });
    }
  }
}

/** Damaged fleets and fleets about to run dry head for the nearest own colony. */
function resupply(ctx: AiContext): void {
  const docks = ctx.colonies.map((c) => c.systemId);
  const hurt = 30 + ctx.personality.caution * 4;
  for (const info of warships(ctx)) {
    const at = fleetAt(info);
    const dry = !ctx.supplied.has(at) && info.fleet.supply <= 1;
    const damaged = info.hpPercent < hurt && !docks.includes(at);
    if (!dry && !damaged) continue;
    const dock = nearest(ctx, at, docks);
    if (dock !== null) moveTo(ctx, info, dock);
  }
}

function colonize(ctx: AiContext, strategy: Strategy): void {
  const claimed = new Set<number>();
  const settlers = ctx.fleets.filter((f) => f.colonize && free(ctx, f));
  // Keep heading for targets that are still open.
  for (const info of settlers) {
    if (info.fleet.route.length === 0) continue;
    const dest = info.fleet.route[info.fleet.route.length - 1]!;
    const target = strategy.colonyTargets.find((t) => t.systemId === dest && !claimed.has(t.bodyId));
    if (target) {
      claimed.add(target.bodyId);
      ctx.busy.add(info.fleet.id);
    }
  }
  for (const info of settlers) {
    if (ctx.busy.has(info.fleet.id) || info.fleet.progress > 0) continue;
    const at = info.fleet.systemId;
    const here = strategy.colonyTargets
      .filter((t) => t.systemId === at && !claimed.has(t.bodyId) && !colonyOnBody(ctx.state, t.bodyId))
      .sort((a, b) => b.value - a.value || a.bodyId - b.bodyId)[0];
    if (here) {
      claimed.add(here.bodyId);
      ctx.busy.add(info.fleet.id);
      ctx.commands.push({ type: "colonize", empireId: ctx.id, fleetId: info.fleet.id, bodyId: here.bodyId });
      continue;
    }
    // Best value per distance, avoiding systems where enemy warships were just seen.
    const danger = new Set(ctx.recentEnemies.map((s) => s.systemId));
    const d = ctx.dist(at);
    let best: (typeof strategy.colonyTargets)[number] | null = null;
    let bestScore = -1;
    for (const t of strategy.colonyTargets) {
      if (claimed.has(t.bodyId) || danger.has(t.systemId) || d[t.systemId] === Infinity) continue;
      if (ctx.routeCrosses(at, t.systemId, danger)) continue;
      const score = Math.floor((t.value * 10000) / (d[t.systemId]! + 100));
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      claimed.add(best.bodyId);
      moveTo(ctx, info, best.systemId);
    } else {
      ctx.busy.add(info.fleet.id);
    }
  }
}

function scout(ctx: AiContext): void {
  const explored = new Set(ctx.empire.explored);
  const claimed = new Set<SystemId>();
  for (const info of ctx.fleets) if (info.recon && info.fleet.route.length > 0) claimed.add(info.fleet.route[info.fleet.route.length - 1]!);
  const danger = new Set(ctx.recentEnemies.map((s) => s.systemId));
  for (const info of ctx.fleets) {
    if (!info.recon || !free(ctx, info)) continue;
    ctx.busy.add(info.fleet.id);
    if (!info.idle) continue;
    const d = ctx.dist(info.fleet.systemId);
    let target = -1;
    for (let i = 0; i < d.length; i++) {
      if (explored.has(i) || claimed.has(i) || d[i] === Infinity) continue;
      if (danger.has(i) || ctx.routeCrosses(info.fleet.systemId, i, danger)) continue;
      if (target === -1 || d[i]! < d[target]!) target = i;
    }
    if (target === -1) {
      // Everything explored: keep watch next to the nearest known rival colony.
      const watch = nearest(ctx, info.fleet.systemId, ctx.rivalColonies.map((c) => c.systemId));
      if (watch !== null) {
        const post = ctx.adj[watch]!.map((n) => n.id).find((s) => !ctx.rivalColonies.some((c) => c.systemId === s));
        if (post !== undefined) moveTo(ctx, info, post);
      }
      continue;
    }
    claimed.add(target);
    moveTo(ctx, info, target);
  }
}

/** Meet hostile warships inside our supply zone with enough force, nearest fleets first. */
function defend(ctx: AiContext, strategy: Strategy): void {
  if (strategy.threat === 0 && !ctx.colonies.some((c) => c.blockaded)) return;
  const bySystem = new Map<SystemId, number>();
  for (const s of ctx.recentEnemies) if (ctx.supplied.has(s.systemId) || ctx.colonies.some((c) => c.systemId === s.systemId)) bySystem.set(s.systemId, (bySystem.get(s.systemId) ?? 0) + s.strength);
  const colonySystems = new Set(ctx.colonies.map((c) => c.systemId));
  const threats = [...bySystem].sort((a, b) => Number(colonySystems.has(b[0])) - Number(colonySystems.has(a[0])) || b[1] - a[1] || a[0] - b[0]);
  const margin = 120 + ctx.personality.caution * 5;
  for (const [systemId, strength] of threats) {
    const needed = Math.floor((strength * margin) / 100);
    const pool = warships(ctx).sort((a, b) => ctx.dist(fleetAt(a))[systemId]! - ctx.dist(fleetAt(b))[systemId]! || a.fleet.id - b.fleet.id);
    const picked: FleetInfo[] = [];
    let total = 0;
    for (const info of pool) {
      if (total >= needed) break;
      picked.push(info);
      total += info.strength;
    }
    if (total >= needed) {
      for (const info of picked) moveTo(ctx, info, systemId);
    } else if (ctx.personality.defense >= 6 && colonySystems.has(systemId)) {
      // Not enough to win in the open: turtles still man the walls of a threatened colony.
      for (const info of picked) if (fleetAt(info) === systemId) ctx.busy.add(info.fleet.id);
    }
  }
}

/** Gather at a staging system on our side of the border, then strike a rival colony we can beat. */
function attack(ctx: AiContext, strategy: Strategy): void {
  if (strategy.posture !== "attack") return;
  const raider = ctx.personality.designStyle === "raider";
  const pool = warships(ctx);
  if (pool.length === 0 || !ctx.capital) return;
  const total = pool.reduce((n, f) => n + f.strength, 0);
  const nerve = 100 + ctx.personality.caution * 10;
  const guardAt = (systemId: SystemId) => ctx.recentEnemies.filter((s) => s.systemId === systemId).reduce((n, s) => n + s.strength, 0);
  const lead = [...pool].sort((a, b) => b.strength - a.strength || a.fleet.id - b.fleet.id)[0]!;

  const candidates = ctx.rivalColonies
    .filter((c) => raider || c.empireId === strategy.warTarget)
    .filter((c) => withinReach(ctx, lead, c.systemId))
    .map((c) => ({ colony: c, guard: guardAt(c.systemId), d: ctx.dist(ctx.capital!.systemId)[c.systemId]! }))
    .filter((c) => Math.floor((c.guard * nerve) / 100) < total)
    .sort((a, b) => (raider ? a.guard - b.guard : 0) || a.d - b.d || a.colony.colonyId - b.colony.colonyId);
  const target = candidates[0];
  if (!target) return;

  // Staging: the supplied system closest to the target.
  const staging = nearest(ctx, target.colony.systemId, [...ctx.supplied]) ?? ctx.capital.systemId;
  const needed = Math.floor((target.guard * nerve) / 100) + 1;
  const atStaging = pool.filter((f) => f.idle && f.fleet.systemId === staging);
  const ready = atStaging.reduce((n, f) => n + f.strength, 0);
  if (raider || ready >= needed) {
    for (const info of raider ? pool : atStaging) moveTo(ctx, info, target.colony.systemId);
  }
  if (!raider) {
    for (const info of pool) if (!ctx.busy.has(info.fleet.id)) moveTo(ctx, info, staging);
  }
}

/** Defensive personalities post warships on border systems facing the war target. */
function garrison(ctx: AiContext, strategy: Strategy): void {
  if (ctx.personality.defense < 6 || ctx.rivalColonies.length === 0) return;
  const borders = [...ctx.supplied]
    .filter((s) => ctx.adj[s]!.some((n) => !ctx.supplied.has(n.id)))
    .sort((a, b) => a - b);
  const facing = ctx.rivalColonies.filter((c) => strategy.warTarget === null || c.empireId === strategy.warTarget).map((c) => c.systemId);
  const ranked = borders
    .map((s) => ({ s, d: Math.min(...facing.map((f) => ctx.dist(s)[f]!), Infinity) }))
    .sort((a, b) => a.d - b.d || a.s - b.s)
    .slice(0, Math.max(1, Math.floor(ctx.personality.defense / 3)));
  const pool = warships(ctx).filter((f) => f.idle);
  for (const post of ranked) {
    const info = pool.shift();
    if (!info) break;
    moveTo(ctx, info, post.s);
  }
}

/** Everything left goes home and forms up; raiders keep small packs. */
function gather(ctx: AiContext): void {
  if (!ctx.capital) return;
  const home = ctx.capital.systemId;
  const maxShips = ctx.personality.designStyle === "raider" ? 4 : 99;
  const idle = warships(ctx).filter((f) => f.idle);
  const bySystem = new Map<SystemId, FleetInfo[]>();
  for (const info of idle) bySystem.set(info.fleet.systemId, [...(bySystem.get(info.fleet.systemId) ?? []), info]);
  for (const [systemId, group] of [...bySystem].sort((a, b) => a[0] - b[0])) {
    group.sort((a, b) => b.strength - a.strength || a.fleet.id - b.fleet.id);
    const anchor = group[0]!;
    let ships = anchor.fleet.ships.length;
    ctx.busy.add(anchor.fleet.id);
    for (const other of group.slice(1)) {
      ctx.busy.add(other.fleet.id);
      if (ships + other.fleet.ships.length > maxShips) continue;
      ships += other.fleet.ships.length;
      ctx.commands.push({ type: "mergeFleets", empireId: ctx.id, fleetId: other.fleet.id, intoFleetId: anchor.fleet.id });
    }
    if (systemId !== home && !ctx.colonies.some((c) => c.systemId === systemId) && !ctx.supplied.has(systemId)) {
      ctx.commands.push({ type: "moveFleet", empireId: ctx.id, fleetId: anchor.fleet.id, destinationId: home });
    }
  }
}
