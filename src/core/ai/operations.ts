import { combatShipCount, fleetShipStats, fleetStrength } from "../ships";
import { commandCapacity, commandReady, commandUsed, findCommand, fleetPoints, freeOfficers, suggestedFlagship, supportedCommands, infiltratorGroup, markTechs, outpostPathBlocker, shipPoints } from "../command";
import { hasFlag } from "../economy";
import { colonyOnBody, type FleetOrders, type NavalCommand, type OutpostKind, type Ship, type SystemId } from "../state";
import { outpostBlocker, outpostConversionBlocker, outpostTechOk } from "../outposts";
import { defenseStrength, fleetAt, frontier, interior, moveTo, withinReach, type AiContext, type FleetInfo } from "./context";
import type { Strategy } from "./strategy";

/**
 * The operational layer: give every fleet a job, most urgent first.
 * Each step skips fleets already given an order this turn (ctx.busy).
 */
export function planOperations(ctx: AiContext, strategy: Strategy): void {
  placeCommands(ctx, strategy);
  setStandingOrders(ctx);
  resupply(ctx);
  colonize(ctx, strategy);
  buildOutposts(ctx);
  scout(ctx);
  defend(ctx, strategy);
  invade(ctx);
  siege(ctx, strategy);
  raid(ctx, strategy);
  depots(ctx, strategy);
  outpostMarks(ctx, strategy);
  attack(ctx, strategy);
  garrison(ctx, strategy);
  gather(ctx, strategy);
}

const free = (ctx: AiContext, f: FleetInfo) => !ctx.busy.has(f.fleet.id);

/** Warships a group can hold before it fights less well together; a fleet in a command is limited by points instead. */
const sizeLimit = (ctx: AiContext, info: FleetInfo) => (info.fleet.command ? Infinity : ctx.pack.combat.fleetSizeLimit);

/** Systems unarmed ships should stay out of: recent enemy warships and defended rival colonies. */
function dangerZones(ctx: AiContext): Set<SystemId> {
  return new Set([...ctx.recentEnemies.map((s) => s.systemId), ...ctx.rivalColonies.filter((c) => c.defenseHp > 0).map((c) => c.systemId)]);
}
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
  // Fleets that outgun every rival fleet seen lately go for flagships once the AI can, to break enemy fleets apart.
  const aim = hasFlag(ctx.pack, ctx.empire, "flagshipTargeting") && p.designStyle !== "raider";
  const strongest = Math.max(0, ...ctx.recentEnemies.map((s) => s.strength));
  for (const info of ctx.fleets) {
    if (!info.armed || info.colonize) continue;
    const o = info.fleet.orders;
    const priority = aim && info.fleet.command && info.strength > strongest ? "flagship" : wanted.targetPriority;
    if (o.mission !== wanted.mission || o.stance !== wanted.stance || o.targetPriority !== priority || o.retreatPercent !== wanted.retreatPercent) {
      ctx.commands.push({ type: "setFleetOrders", empireId: ctx.id, fleetId: info.fleet.id, orders: { ...wanted, targetPriority: priority } });
    }
  }
}

/** Damaged fleets, and fleets that need to start home to resupply, head for the nearest colony or depot. */
function resupply(ctx: AiContext): void {
  const docks = [...ctx.supplied].sort((a, b) => a - b);
  const hurt = 30 + ctx.personality.caution * 4;
  for (const info of warships(ctx)) {
    const at = fleetAt(info);
    const home = nearest(ctx, at, docks);
    const turnsHome = home === null ? 0 : Math.ceil(ctx.dist(at)[home]! / Math.max(1, info.fleet.speed));
    // Supply on hand plus what supply ships can still hand out.
    const left = info.fleet.supply + Math.floor(info.fleet.stores / Math.max(1, info.fleet.ships.length));
    const dry = !ctx.supplied.has(at) && left <= turnsHome + 1;
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
    const target = strategy.colonyTargets.find((t) => t.systemId === dest && !claimed.has(t.bodyId) && t.habitat === info.habitat);
    if (target) {
      claimed.add(target.bodyId);
      ctx.busy.add(info.fleet.id);
    }
  }
  for (const info of settlers) {
    if (ctx.busy.has(info.fleet.id) || info.fleet.progress > 0) continue;
    const at = info.fleet.systemId;
    const here = strategy.colonyTargets
      // In orbit the fleet sees any outpost on the body.
      .filter((t) => t.systemId === at && t.habitat === info.habitat && !claimed.has(t.bodyId) && !colonyOnBody(ctx.state, t.bodyId) && !ctx.state.outposts.some((o) => o.bodyId === t.bodyId))
      .sort((a, b) => b.value - a.value || a.bodyId - b.bodyId)[0];
    if (here) {
      claimed.add(here.bodyId);
      ctx.busy.add(info.fleet.id);
      ctx.commands.push({ type: "colonize", empireId: ctx.id, fleetId: info.fleet.id, bodyId: here.bodyId });
      continue;
    }
    // Best value per distance, avoiding systems where enemy warships were just seen.
    const danger = dangerZones(ctx);
    const d = ctx.dist(at);
    let best: (typeof strategy.colonyTargets)[number] | null = null;
    let bestScore = -1;
    for (const t of strategy.colonyTargets) {
      if (t.habitat !== info.habitat || claimed.has(t.bodyId) || danger.has(t.systemId) || d[t.systemId] === Infinity) continue;
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
  const danger = dangerZones(ctx);
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

/**
 * Gather at the home of the naval command nearest the target (only fleets in a command may attack),
 * form a fleet there within the command's points, then strike a rival colony we can beat.
 */
function attack(ctx: AiContext, strategy: Strategy): void {
  if (strategy.posture !== "attack") return;
  // In the endgame drive raiders fight as one massed fleet and invade like everyone else.
  const raider = ctx.personality.designStyle === "raider" && !strategy.endgame;
  const pool = warships(ctx);
  if (pool.length === 0 || !ctx.capital) return;
  const total = pool.reduce((n, f) => n + f.strength, 0);
  // The endgame drive also steadies cautious temperaments: a 20% edge is enough.
  const nerve = strategy.endgame ? Math.min(120, 100 + ctx.personality.caution * 10) : 100 + ctx.personality.caution * 10;
  // Known warships there plus the colony's orbital defenses as last seen.
  const guardAt = (systemId: SystemId) =>
    ctx.recentEnemies.filter((s) => s.systemId === systemId).reduce((n, s) => n + s.strength, 0) +
    ctx.rivalColonies.filter((c) => c.systemId === systemId).reduce((n, c) => n + defenseStrength(c.defenseHp), 0);
  const lead = [...pool].sort((a, b) => b.strength - a.strength || a.fleet.id - b.fleet.id)[0]!;

  const candidates = ctx.rivalColonies
    .filter((c) => raider || c.empireId === strategy.warTarget)
    .filter((c) => withinReach(ctx, lead, c.systemId))
    .map((c) => ({ colony: c, guard: guardAt(c.systemId), d: ctx.dist(ctx.capital!.systemId)[c.systemId]! }))
    .filter((c) => Math.floor((c.guard * nerve) / 100) < total)
    .sort((a, b) => (raider ? a.guard - b.guard : 0) || a.d - b.d || a.colony.colonyId - b.colony.colonyId);
  const target = candidates[0];
  if (!target) return;
  // Strike forces already under way to the target (or fighting there) carry on; otherwise the
  // regrouping below would call them back to staging every turn and they would never arrive.
  const underway = { strength: 0, eta: 0, troops: 0 };
  for (const info of pool) {
    if ((info.fleet.route.at(-1) ?? info.fleet.systemId) !== target.colony.systemId) continue;
    ctx.busy.add(info.fleet.id);
    underway.strength += info.strength;
    underway.troops += info.troops;
    underway.eta = Math.max(underway.eta, Math.ceil(ctx.dist(fleetAt(info))[target.colony.systemId]! / Math.max(1, info.fleet.speed)));
  }

  // Raiders strike in small packs from wherever they are: each drilled fleet goes for the target on its
  // own, and groups idle at any command's home form into new packs there.
  if (raider) {
    raidPacks(ctx, pool, target.colony.systemId);
    return;
  }

  // Every ready command that can reach the target forms fleets at its home; the one nearest the target is
  // the staging point for troops and support ships.
  const toTarget = ctx.dist(target.colony.systemId);
  const bases = ctx.empire.navalCommands
    .filter((c) => commandReady(ctx.state, c) && toTarget[c.homeSystemId!] !== Infinity)
    .sort((a, b) => toTarget[a.homeSystemId!]! - toTarget[b.homeSystemId!]! || a.id - b.id);
  if (bases.length === 0) return;
  let staging = bases[0]!.homeSystemId!;
  const needed = Math.floor((target.guard * nerve) / 100) + 1;
  const rules = ctx.pack.combat.command;
  const drilledNow = (info: FleetInfo) => !!info.fleet.command && !ctx.formedNow.has(info.fleet.id) && info.fleet.command.cohesion >= AI_LAUNCH_COHESION;
  const troopsNeeded = Math.ceil((target.colony.troops * ctx.pack.combat.invasionMarginPercent * 6) / 500) + 1;

  // Campaigns: fleets idle at one of our colonies away from any command home (a colony just taken, say) push
  // on to the target if they are still strong and steady enough, rather than going home first. Short of
  // troops, they hold there and the troop ships come to them.
  const homeSystems = new Set(bases.map((b) => b.homeSystemId!));
  const ownHomeOf = (info: FleetInfo) => (info.fleet.command ? (findCommand(ctx.empire, info.fleet.command.commandId)?.homeSystemId ?? null) : null);
  let forward: { info: FleetInfo; room: number } | undefined;
  const fronts = new Map<SystemId, FleetInfo[]>();
  for (const info of pool) {
    const at = info.fleet.systemId;
    if (!info.idle || !info.fleet.command || ctx.busy.has(info.fleet.id) || homeSystems.has(at) || !ctx.colonies.some((c) => c.systemId === at)) continue;
    // Only worth it if the target is no farther from here than from the fleet's own home.
    const home = ownHomeOf(info);
    if (home !== null && toTarget[home]! < toTarget[at]!) continue;
    fronts.set(at, [...(fronts.get(at) ?? []), info]);
  }
  for (const [at, fleets] of [...fronts].sort((a, b) => toTarget[a[0]]! - toTarget[b[0]]! || a[0] - b[0])) {
    const strength = fleets.reduce((n, f) => n + f.strength, 0);
    if (!fleets.every((f) => withinReach(ctx, f, target.colony.systemId)) || strength * 100 < needed * CAMPAIGN.strengthPercent) continue;
    // Below the cohesion to go on (troop ships just joined, say), they hold and drill.
    const steady = fleets.every((f) => f.fleet.command!.cohesion >= CAMPAIGN.cohesion);
    const troops = fleets.reduce((n, f) => n + f.troops, 0);
    if (steady && (landed(ctx, troops) >= troopsNeeded || underway.troops > 0)) {
      for (const info of fleets) {
        moveTo(ctx, info, target.colony.systemId);
        if (info.troops > 0) ctx.commands.push({ type: "invade", empireId: ctx.id, fleetId: info.fleet.id, colonyId: target.colony.colonyId });
      }
      underway.strength += strength;
      underway.troops += troops;
    } else {
      // Hold here; the first such colony is where troop ships gather now.
      for (const info of fleets) ctx.busy.add(info.fleet.id);
      if (forward) continue;
      const lead = [...fleets].sort((a, b) => b.strength - a.strength || a.fleet.id - b.fleet.id)[0]!;
      const own = findCommand(ctx.empire, lead.fleet.command!.commandId)!;
      forward = { info: lead, room: commandCapacity(ctx.state, ctx.pack, ctx.empire, own) - commandUsed(ctx.state, ctx.pack, ctx.empire, own) };
      staging = at;
    }
  }

  // Strength in fleets waiting at command homes (formed or forming this turn), and ships joining each this turn.
  let ready = pool.filter((f) => f.idle && f.fleet.command && !ctx.busy.has(f.fleet.id)).reduce((n, f) => n + f.strength, 0);
  const joining = new Map<number, number>();
  const anchors = new Map<SystemId, { info: FleetInfo; room: number }>();
  for (const base of bases) {
    const home = base.homeSystemId!;
    const atBase = pool.filter((f) => f.idle && f.fleet.systemId === home && !ctx.busy.has(f.fleet.id));
    let room = pointsLeft(ctx, base);
    let officers = officersLeft(ctx, base);
    // The fleet that leads here: this command's strongest fleet at home.
    let anchor = atBase.filter((f) => f.fleet.command?.commandId === base.id).sort((a, b) => b.strength - a.strength || a.fleet.id - b.fleet.id)[0];
    const groups = atBase.filter((f) => !f.fleet.command).sort((a, b) => b.strength - a.strength || a.fleet.id - b.fleet.id);
    for (const info of groups) {
      // Once strong enough (with a margin), no more ships join: the rest stay as home guards.
      if (ready >= Math.floor((needed * 5) / 4)) break;
      // Groups join a fleet still drilling (little lost), else form a second fleet if an officer is free,
      // else join the drilled fleet anyway (it drills again).
      const intoAnchor = anchor && (!drilledNow(anchor) || officers <= 0);
      if (intoAnchor) {
        const kept = trimTo(ctx, info, room, false);
        if (!kept) continue;
        room -= kept.points;
        ready += kept.strength;
        joining.set(anchor!.fleet.id, (joining.get(anchor!.fleet.id) ?? 0) + kept.ships);
        ctx.busy.add(info.fleet.id);
        ctx.commands.push({ type: "mergeFleets", empireId: ctx.id, fleetId: info.fleet.id, intoFleetId: anchor!.fleet.id });
      } else if (officers > 0) {
        // A group too big for the points left leaves its extra ships behind as a group of their own.
        const kept = trimTo(ctx, info, room, true);
        if (!kept) continue;
        room -= kept.points;
        ready += kept.strength;
        officers--;
        const flagship = suggestedFlagship(ctx.pack, ctx.state, info.fleet)!;
        ctx.commands.push({ type: "formFleet", empireId: ctx.id, fleetId: info.fleet.id, flagshipId: flagship.id });
        ctx.formedNow.add(info.fleet.id);
        if (!anchor || kept.strength > anchor.strength) anchor = info;
      }
    }
    if (anchor) anchors.set(home, { info: anchor, room });
  }

  // Troop transports, commandos and supply ships ride along with a strike fleet: one at the command home where
  // they are, else they gather where the strongest strike fleet waits (on a campaign, at the colony where it holds).
  if (!forward) {
    const strongest = [...anchors].sort((a, b) => b[1].info.strength - a[1].info.strength || toTarget[a[0]]! - toTarget[b[0]]! || a[0] - b[0])[0];
    if (strongest) staging = strongest[0];
  }
  const leader = forward ?? anchors.get(staging);
  const transports = ctx.fleets.filter(
    (f) => (f.troops > 0 || f.supplier || f.commandos > 0) && !f.armed && !f.fleet.command && !infiltratorGroup(ctx.pack, ctx.state, f.fleet) && free(ctx, f),
  );
  let carried = ctx.fleets.filter((f) => f.fleet.command && f.troops > 0 && !ctx.busy.has(f.fleet.id) && f.idle).reduce((n, f) => n + f.troops, 0);
  // Only what the strike needs joins: troops for a safe landing (with a margin), one supply ship, one
  // commando team. Every ship that joins costs cohesion, so a steady trickle would keep it from launching.
  const joinedNow = new Set<number>();
  let supplied = (leader?.info.fleet.stores ?? 0) > 0;
  let commandos = (leader?.info.commandos ?? 0) > 0;
  for (const info of transports) {
    // Stopped at staging counts even with a course plotted (say, a retreat after a skirmish there):
    // merging into the strike force cancels it.
    const host = info.fleet.progress === 0 ? (info.fleet.systemId === staging ? leader : anchors.get(info.fleet.systemId)) : undefined;
    if (host) {
      const wanted = (info.troops > 0 && landed(ctx, carried) < troopsNeeded) || (info.supplier && !supplied) || (info.commandos > 0 && !commandos);
      if (!wanted) continue;
      const points = fleetPoints(ctx.pack, ctx.state, info.fleet);
      if (points > host.room) {
        if (info.fleet.systemId !== staging) moveTo(ctx, info, staging);
        continue;
      }
      host.room -= points;
      carried += info.troops;
      supplied ||= info.supplier;
      commandos ||= info.commandos > 0;
      joining.set(host.info.fleet.id, (joining.get(host.info.fleet.id) ?? 0) + info.fleet.ships.length);
      joinedNow.add(info.fleet.id);
      ctx.busy.add(info.fleet.id);
      ctx.commands.push({ type: "mergeFleets", empireId: ctx.id, fleetId: info.fleet.id, intoFleetId: host.info.fleet.id });
    } else {
      moveTo(ctx, info, staging);
    }
  }

  // Launch: every drilled fleet that can reach the target counts. Once together with any strike under way
  // they are strong enough, they go, timed to arrive together: the farthest first, the rest when their
  // own trip matches (within a turn).
  const cohesionAfter = (info: FleetInfo) => {
    const c = info.fleet.command!.cohesion;
    return Math.max(Math.min(c, rules.cohesionStart), c - rules.cohesionPerShip * (joining.get(info.fleet.id) ?? 0));
  };
  const eta = (info: FleetInfo) => Math.ceil(ctx.dist(fleetAt(info))[target.colony.systemId]! / Math.max(1, info.fleet.speed));
  // Strikes leave from command homes (fleets back from resupply call there first, for troops and reinforcements).
  const homes = new Set(bases.map((b) => b.homeSystemId!));
  const launchers = pool.filter(
    (f) => f.idle && !ctx.busy.has(f.fleet.id) && homes.has(f.fleet.systemId) && drilledNow(f) && cohesionAfter(f) >= AI_LAUNCH_COHESION && withinReach(ctx, f, target.colony.systemId),
  );
  // While troop ships are still on their way to staging (or joining this turn), a strike that would carry
  // none waits for them. Troop ships stuck at staging (no points to join) don't hold it up.
  // Fleets at home carrying troops but still drilling count as on their way too.
  // Only troop ships really on their way count: joining this turn, or under way (or just ordered) to staging.
  const bound = (f: FleetInfo) =>
    f.fleet.route.at(-1) === staging || ctx.commands.some((c) => c.type === "moveFleet" && c.fleetId === f.fleet.id && c.destinationId === staging);
  const troopsComing = transports.some((f) => f.troops > 0 && (joinedNow.has(f.fleet.id) || bound(f))) || waitingCarriers(ctx, homes, launchers);
  const troopsAboard = underway.troops + launchers.reduce((n, f) => n + f.troops, 0);
  // A strike under way without troops is joined by the next drilled fleet carrying them, however strong it already is.
  const bringTroops = underway.strength > 0 && underway.troops === 0 && launchers.some((f) => f.troops > 0);
  const waiting = pool.filter((f) => f.idle && f.fleet.command && !ctx.busy.has(f.fleet.id));
  const offered = launchers.reduce((n, f) => n + f.strength, 0);
  if (bringTroops) {
    for (const info of launchers) if (info.troops > 0) {
      moveTo(ctx, info, target.colony.systemId);
      ctx.commands.push({ type: "invade", empireId: ctx.id, fleetId: info.fleet.id, colonyId: target.colony.colonyId });
    }
  } else if (launchers.length > 0 && underway.strength < needed && underway.strength + offered >= needed && !(troopsAboard === 0 && troopsComing)) {
    const arrival = Math.max(underway.eta, ...launchers.map(eta));
    for (const info of launchers) {
      if (eta(info) < arrival - 1) continue;
      moveTo(ctx, info, target.colony.systemId);
      if (info.troops > 0) ctx.commands.push({ type: "invade", empireId: ctx.id, fleetId: info.fleet.id, colonyId: target.colony.colonyId });
    }
  }
  // Fleets not launching wait at their own command's home, drilling; fleets elsewhere head there.
  const ownHome = (info: FleetInfo) => (info.fleet.command ? (findCommand(ctx.empire, info.fleet.command.commandId)?.homeSystemId ?? null) : null);
  for (const info of waiting) if (!ctx.busy.has(info.fleet.id) && ownHome(info) === info.fleet.systemId) ctx.busy.add(info.fleet.id);
  // Groups stay at a home where they can join a fleet or form one; others head for the nearest home where they can.
  const canJoin = (base: NavalCommand) => anchors.has(base.homeSystemId!) || officersLeft(ctx, base) > 0;
  for (const info of pool) {
    if (ctx.busy.has(info.fleet.id)) continue;
    const d = ctx.dist(fleetAt(info));
    const own = ownHome(info);
    if (own !== null && d[own] !== Infinity) {
      moveTo(ctx, info, own);
      continue;
    }
    const here = bases.find((b) => b.homeSystemId === info.fleet.systemId);
    if (info.idle && here && canJoin(here)) {
      ctx.busy.add(info.fleet.id);
      continue;
    }
    const reachable = bases.filter((b) => d[b.homeSystemId!] !== Infinity);
    const pick = (list: NavalCommand[]) => list.sort((a, b) => d[a.homeSystemId!]! - d[b.homeSystemId!]! || a.id - b.id)[0];
    const dest = pick(reachable.filter(canJoin)) ?? pick(reachable);
    if (dest) moveTo(ctx, info, dest.homeSystemId!);
    else ctx.busy.add(info.fleet.id);
  }
}

/** A command's free officers, less those taken by fleets ordered to form at its home this turn. */
function officersLeft(ctx: AiContext, base: NavalCommand): number {
  const forming = ctx.commands.filter((c) => c.type === "formFleet" && ctx.state.fleets.find((f) => f.id === c.fleetId)?.systemId === base.homeSystemId).length;
  return freeOfficers(ctx.state, ctx.pack, ctx.empire, base) - forming;
}

/** Points a command has left, less those taken by fleets formed or merged at its home this turn. */
function pointsLeft(ctx: AiContext, base: NavalCommand): number {
  let taken = 0;
  for (const c of ctx.commands) {
    if (c.type !== "formFleet" && c.type !== "mergeFleets") continue;
    const fleet = ctx.state.fleets.find((f) => f.id === c.fleetId);
    if (!fleet || fleet.systemId !== base.homeSystemId || fleet.command) continue;
    const split = ctx.commands.find((x) => x.type === "splitFleet" && x.fleetId === fleet.id);
    const gone = new Set(split?.type === "splitFleet" ? split.shipIds : []);
    taken += fleet.ships.filter((ship) => !gone.has(ship.id)).reduce((n, ship) => n + shipPoints(ctx.pack, ctx.empire, ship), 0);
  }
  return commandCapacity(ctx.state, ctx.pack, ctx.empire, base) - commandUsed(ctx.state, ctx.pack, ctx.empire, base) - taken;
}

/** Fleets at a command home carrying troops that aren't ready to launch yet (still drilling). */
function waitingCarriers(ctx: AiContext, homes: Set<SystemId>, launchers: FleetInfo[]): boolean {
  return ctx.fleets.some((f) => f.fleet.command && f.troops > 0 && f.idle && homes.has(f.fleet.systemId) && !launchers.includes(f) && !ctx.busy.has(f.fleet.id));
}

/**
 * Fit a group into `room` command points: keep its strongest ships (its flagship first, if it is to lead)
 * and order the rest detached, as a group of their own. The kept part keeps the group's id. Null if
 * nothing (or no armed flagship, when `lead`) fits.
 */
function trimTo(ctx: AiContext, info: FleetInfo, room: number, lead: boolean): { points: number; strength: number; ships: number } | null {
  const { pack, state, empire } = ctx;
  const fleet = info.fleet;
  const flagship = lead ? suggestedFlagship(pack, state, fleet) : undefined;
  if (lead && !flagship) return null;
  const solo = (ship: Ship) => fleetStrength(pack, state, { ...fleet, ships: [ship] });
  const order = [...fleet.ships].sort((a, b) => Number(b === flagship) - Number(a === flagship) || solo(b) - solo(a) || a.id - b.id);
  const keep: Ship[] = [];
  let points = 0;
  for (const ship of order) {
    const cost = shipPoints(pack, empire, ship);
    if (points + cost > room) continue;
    keep.push(ship);
    points += cost;
  }
  if (keep.length === 0 || (flagship && !keep.includes(flagship))) return null;
  if (keep.length < fleet.ships.length) {
    const kept = new Set(keep.map((s) => s.id));
    ctx.commands.push({ type: "splitFleet", empireId: ctx.id, fleetId: fleet.id, shipIds: fleet.ships.filter((s) => !kept.has(s.id)).map((s) => s.id) });
  }
  return { points, strength: keep.reduce((n, s) => n + solo(s), 0), ships: keep.length };
}

/** Raider packs: launch every drilled fleet at the target, and form idle groups at command homes. */
function raidPacks(ctx: AiContext, pool: FleetInfo[], targetSystem: SystemId): void {
  for (const info of pool) {
    if (!info.idle || ctx.busy.has(info.fleet.id)) continue;
    const command = info.fleet.command;
    if (command) {
      if (command.cohesion >= AI_LAUNCH_COHESION) moveTo(ctx, info, targetSystem);
      else ctx.busy.add(info.fleet.id);
      continue;
    }
    const home = ctx.empire.navalCommands.find((c) => c.homeSystemId === info.fleet.systemId);
    if (!home || !commandReady(ctx.state, home) || officersLeft(ctx, home) <= 0) continue;
    const kept = trimTo(ctx, info, pointsLeft(ctx, home), true);
    if (!kept) continue;
    const flagship = suggestedFlagship(ctx.pack, ctx.state, info.fleet)!;
    ctx.commands.push({ type: "formFleet", empireId: ctx.id, fleetId: info.fleet.id, flagshipId: flagship.id });
    ctx.formedNow.add(info.fleet.id);
    ctx.busy.add(info.fleet.id);
  }
}

/** Cohesion (percent) a strike fleet waits for before it launches. */
export const AI_LAUNCH_COHESION = 80;

/** A campaign fleet pushes on from a colony it holds with this much cohesion and strength (percent of what the next target needs). */
export const CAMPAIGN = { cohesion: 60, strengthPercent: 75 };

/** Fleets with troops sitting at a known rival colony keep an invasion order on it. */
function invade(ctx: AiContext): void {
  for (const info of ctx.fleets) {
    if (info.troops === 0 || !info.fleet.command || !free(ctx, info) || info.fleet.progress > 0 || info.fleet.route.length > 0) continue;
    const colony = ctx.rivalColonies.filter((c) => c.systemId === info.fleet.systemId).sort((a, b) => a.troops - b.troops || a.colonyId - b.colonyId)[0];
    if (!colony || info.fleet.invadeColonyId === colony.colonyId) continue;
    ctx.busy.add(info.fleet.id);
    ctx.commands.push({ type: "invade", empireId: ctx.id, fleetId: info.fleet.id, colonyId: colony.colonyId });
  }
}

/** Ground troops a fleet lands, with the empire's ground-combat bonus. */
const landed = (ctx: AiContext, raw: number) => Math.floor((raw * (100 + ctx.fx.groundPercent)) / 100);

/**
 * Siege: over a rival colony whose orbital defenses are down, bombers pound it while the troops in
 * orbit are too few for a safe landing, and stop once they are enough, or once it is down to a couple
 * of colonists (its people are the prize; in the endgame drive they bomb on regardless).
 * Without bombers, a landing that is close to even goes in all-out rather than waiting forever.
 */
function siege(ctx: AiContext, strategy: Strategy): void {
  const inOrbit = new Map<SystemId, FleetInfo[]>();
  for (const info of ctx.fleets) {
    // Fleets already ordered away this turn (say, home to resupply) take no part.
    // Only fleets in a naval command may bomb or invade.
    if (info.fleet.progress > 0 || info.fleet.route.length > 0 || !free(ctx, info) || !info.fleet.command) continue;
    inOrbit.set(info.fleet.systemId, [...(inOrbit.get(info.fleet.systemId) ?? []), info]);
  }
  const handled = new Set<number>();
  const targets = [...ctx.rivalColonies].sort((a, b) => a.troops - b.troops || a.colonyId - b.colonyId);
  for (const colony of targets) {
    const fleets = (inOrbit.get(colony.systemId) ?? []).filter((f) => !handled.has(f.fleet.id));
    if (fleets.length === 0) continue;
    const troops = landed(ctx, fleets.reduce((n, f) => n + f.troops, 0));
    const short = troops < Math.ceil((colony.troops * ctx.pack.combat.invasionMarginPercent) / 100);
    const bombers = fleets.filter((f) => f.bombard > 0);
    for (const info of bombers) {
      handled.add(info.fleet.id);
      // Bomb the prize down, not out: stop at a couple of colonists unless this is the endgame drive.
      const spare = strategy.endgame || colony.population > SIEGE.minPopulation;
      const want = short && spare && colony.defenseHp <= 0 ? colony.colonyId : null;
      if (info.fleet.bombardColonyId !== want) ctx.commands.push({ type: "bombard", empireId: ctx.id, fleetId: info.fleet.id, colonyId: want });
    }
    if (short && bombers.length === 0 && troops * 100 >= colony.troops * SIEGE.allOutPercent) {
      for (const info of fleets) {
        if (info.troops === 0 || info.fleet.invadeColonyId !== colony.colonyId || info.fleet.invadeAllOut) continue;
        ctx.commands.push({ type: "invade", empireId: ctx.id, fleetId: info.fleet.id, colonyId: colony.colonyId, allOut: true });
      }
    }
  }
}

/** Troops, in percent of the defenders, worth an all-out landing when no bombers can soften the target. */
export const SIEGE = { allOutPercent: 110, minPopulation: 2 };

/** Commandos (cloaked infiltrators) go ahead of the strike force: they knock out the defenses, then thin the garrison. */
function raid(ctx: AiContext, strategy: Strategy): void {
  const target = strategy.targetColony;
  if (strategy.posture !== "attack" || !target) return;
  for (const info of ctx.fleets) {
    if (info.commandos === 0 || !free(ctx, info)) continue;
    // Cloaked infiltrators go ahead on their own; other commandos ride with the strike fleet (see attack)
    // and strike once it is at or bound for the target.
    if (infiltratorGroup(ctx.pack, ctx.state, info.fleet)) moveTo(ctx, info, target.systemId);
    else if (!info.fleet.command || (info.fleet.route.at(-1) ?? info.fleet.systemId) !== target.systemId) continue;
    const mission = target.defenseHp > 0 ? "defenses" : "garrison";
    const order = info.fleet.sabotage;
    if (order?.colonyId !== target.colonyId || order.mission !== mission) {
      ctx.commands.push({ type: "sabotage", empireId: ctx.id, fleetId: info.fleet.id, colonyId: target.colonyId, mission });
    }
  }
}

/** Going to war, turn the combat outpost nearest the target into a supply depot if it is closer than any colony. */
function depots(ctx: AiContext, strategy: Strategy): void {
  const target = strategy.targetColony;
  const cost = ctx.pack.outposts.depot.cost;
  if (strategy.posture !== "attack" || !target || !outpostTechOk(ctx.pack, ctx.empire, "depot")) return;
  if (ctx.empire.credits < cost + 100 + ctx.colonies.length * 10) return;
  const toTarget = ctx.dist(target.systemId);
  const nearestSupply = Math.min(...[...ctx.supplied].map((s) => toTarget[s]!), Infinity);
  const outpost = ctx.state.outposts
    .filter((o) => o.empireId === ctx.id && o.kind === "combat" && !o.depot && o.defenseHp > 0)
    .sort((a, b) => toTarget[a.systemId]! - toTarget[b.systemId]! || a.id - b.id)[0];
  if (outpost && toTarget[outpost.systemId]! < nearestSupply) ctx.commands.push({ type: "upgradeOutpost", empireId: ctx.id, outpostId: outpost.id });
}

/**
 * With credits to spare, raise the combat outpost or depot nearest a rival to its next mark, if its way home
 * is clear. One a turn; defensive temperaments keep a smaller reserve.
 */
function outpostMarks(ctx: AiContext, strategy: Strategy): void {
  if (ctx.rivalColonies.length === 0) return;
  const known = markTechs(ctx.pack, ctx.empire);
  const reserve = 150 + ctx.colonies.length * 15 - ctx.personality.defense * 10;
  const facing = ctx.rivalColonies.filter((c) => strategy.warTarget === null || c.empireId === strategy.warTarget).map((c) => c.systemId);
  const front = (systemId: SystemId) => Math.min(...facing.map((f) => ctx.dist(systemId)[f]!), Infinity);
  const candidates = ctx.state.outposts
    .filter((o) => o.empireId === ctx.id && o.kind === "combat" && o.defenseHp > 0)
    .filter((o) => {
      const mark = ctx.pack.outposts.marks[o.mark];
      return !!mark && known >= mark.weaponsTechs && ctx.empire.credits >= mark.cost + reserve;
    })
    .sort((a, b) => front(a.systemId) - front(b.systemId) || a.mark - b.mark || a.id - b.id);
  for (const outpost of candidates) {
    if (outpostPathBlocker(ctx.state, ctx.pack, ctx.id, outpost.systemId)) continue;
    ctx.commands.push({ type: "upgradeOutpostMark", empireId: ctx.id, outpostId: outpost.id });
    return;
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

/**
 * Base new naval commands, and move displaced ones, at a colony facing the war target (or the largest
 * colony when at peace): fleets form only where commands are based.
 */
function placeCommands(ctx: AiContext, strategy: Strategy): void {
  const taken = new Set(ctx.empire.navalCommands.map((c) => c.homeSystemId).filter((s): s is SystemId => s !== null));
  const facing = ctx.rivalColonies.filter((c) => strategy.warTarget === null || c.empireId === strategy.warTarget).map((c) => c.systemId);
  const front = (systemId: SystemId) => Math.min(...facing.map((f) => ctx.dist(systemId)[f]!), Infinity);
  const population = (systemId: SystemId) => ctx.colonies.filter((c) => c.systemId === systemId).reduce((n, c) => n + c.population, 0);
  const sites = [...new Set(ctx.colonies.map((c) => c.systemId))]
    .filter((s) => !taken.has(s) && !ctx.hostile.has(s))
    .sort((a, b) => front(a) - front(b) || population(b) - population(a) || a - b);
  for (const command of ctx.empire.navalCommands) {
    if (command.homeSystemId !== null) continue;
    const site = sites.shift();
    if (site !== undefined) ctx.commands.push({ type: "placeCommand", empireId: ctx.id, commandId: command.id, systemId: site });
  }
  if (ctx.empire.navalCommands.length < supportedCommands(ctx.state, ctx.pack, ctx.id)) {
    const site = sites.shift();
    if (site !== undefined) ctx.commands.push({ type: "placeCommand", empireId: ctx.id, commandId: null, systemId: site });
  }
}

/** Everything left goes home and forms up; raiders keep small packs (except in the endgame drive). */
function gather(ctx: AiContext, strategy: Strategy): void {
  if (!ctx.capital) return;
  const home = ctx.capital.systemId;
  // Stay within the fleet size limit (larger with a command network aboard); only warships count.
  const limit = (info: FleetInfo) => sizeLimit(ctx, info);
  const style = ctx.personality.designStyle === "raider" && !strategy.endgame ? 4 : Infinity;
  const idle = warships(ctx).filter((f) => f.idle);
  const bySystem = new Map<SystemId, FleetInfo[]>();
  for (const info of idle) bySystem.set(info.fleet.systemId, [...(bySystem.get(info.fleet.systemId) ?? []), info]);
  for (const [systemId, group] of [...bySystem].sort((a, b) => a[0] - b[0])) {
    // A fleet in a command anchors the group (groups merge into it while its command has points).
    group.sort((a, b) => Number(!!b.fleet.command) - Number(!!a.fleet.command) || b.strength - a.strength || a.fleet.id - b.fleet.id);
    const anchor = group[0]!;
    const count = (info: FleetInfo) => combatShipCount(ctx.pack, ctx.state, info.fleet);
    let ships = count(anchor);
    const maxShips = Math.min(style, limit(anchor));
    // At a command's home with an officer to spare, a group forms into a fleet, so it is drilled when war comes.
    const base = ctx.empire.navalCommands.find((c) => c.homeSystemId === systemId && commandReady(ctx.state, c));
    let formed: { points: number } | null = null;
    if (!anchor.fleet.command && base && officersLeft(ctx, base) > 0) {
      formed = trimTo(ctx, anchor, pointsLeft(ctx, base), true);
      if (formed) {
        ctx.commands.push({ type: "formFleet", empireId: ctx.id, fleetId: anchor.fleet.id, flagshipId: suggestedFlagship(ctx.pack, ctx.state, anchor.fleet)!.id });
        ctx.formedNow.add(anchor.fleet.id);
      }
    }
    const own = anchor.fleet.command ? findCommand(ctx.empire, anchor.fleet.command.commandId) : formed ? base : undefined;
    let room = own ? pointsLeft(ctx, own) : Infinity;
    ctx.busy.add(anchor.fleet.id);
    for (const other of group.slice(1)) {
      ctx.busy.add(other.fleet.id);
      if (other.fleet.command) continue;
      const points = own ? fleetPoints(ctx.pack, ctx.state, other.fleet) : 0;
      if (ships + count(other) > maxShips || points > room) continue;
      ships += count(other);
      room -= points;
      ctx.commands.push({ type: "mergeFleets", empireId: ctx.id, fleetId: other.fleet.id, intoFleetId: anchor.fleet.id });
    }
    if (systemId !== home && !ctx.colonies.some((c) => c.systemId === systemId) && !ctx.supplied.has(systemId)) {
      // Regroup at the nearest command home (where fleets form), else the capital.
      const d = ctx.dist(systemId);
      const bases = ctx.empire.navalCommands.map((c) => c.homeSystemId).filter((h): h is SystemId => h !== null && d[h] !== Infinity);
      const base = bases.sort((a, b) => d[a]! - d[b]! || a - b)[0] ?? home;
      moveTo(ctx, anchor, base);
    }
  }
}

/**
 * Outpost targets inside the empire's supply network: free asteroid fields
 * (mining when researched, else combat) and gas giants (combat), away from danger.
 * Plus at most one conversion of an outpost of ours (none while enemy warships are inside our space):
 * a mining outpost on the front becomes a combat outpost, and a plain combat outpost on an asteroid field
 * deep in our space becomes a mining outpost.
 */
export function outpostTargets(ctx: AiContext): { systemId: SystemId; bodyId: number; kind: OutpostKind; convert: boolean }[] {
  const danger = dangerZones(ctx);
  const rivals = new Set(ctx.rivalColonies.map((c) => c.systemId));
  const targets: { systemId: SystemId; bodyId: number; kind: OutpostKind; convert: boolean }[] = [];
  // Within easy reach of a colony.
  const near = new Set<SystemId>();
  for (const colony of ctx.colonies) ctx.dist(colony.systemId).forEach((d, id) => d <= 400 && near.add(id));
  for (const systemId of [...near].sort((a, b) => a - b)) {
    if (danger.has(systemId) || rivals.has(systemId) || !ctx.empire.explored.includes(systemId)) continue;
    for (const body of ctx.state.galaxy.systems[systemId]!.bodies) {
      const kind = (["mining", "combat"] as const).find((k) => outpostBlocker(ctx.state, ctx.pack, ctx.empire, body, k) === null);
      if (kind) targets.push({ systemId, bodyId: body.id, kind, convert: false });
    }
  }
  if (ctx.recentEnemies.some((s) => ctx.supplied.has(s.systemId))) return targets;
  for (const outpost of ctx.state.outposts.filter((o) => o.empireId === ctx.id).sort((a, b) => a.id - b.id)) {
    const body = ctx.state.galaxy.systems[outpost.systemId]!.bodies.find((b) => b.id === outpost.bodyId);
    if (!body) continue;
    let kind: OutpostKind | null = null;
    if (outpost.kind === "mining" && frontier(ctx, outpost.systemId)) kind = "combat";
    else if (outpost.kind === "combat" && !outpost.depot && outpost.mark === 0 && body.kind === "asteroids" && interior(ctx, outpost.systemId)) kind = "mining";
    if (kind && outpostConversionBlocker(ctx.state, ctx.pack, ctx.empire, body, kind) === null) {
      targets.push({ systemId: outpost.systemId, bodyId: body.id, kind, convert: true });
      break;
    }
  }
  return targets;
}

function buildOutposts(ctx: AiContext): void {
  const builders = ctx.fleets.filter((f) => f.outpost && free(ctx, f));
  if (builders.length === 0) return;
  const targets = outpostTargets(ctx);
  const claimed = new Set<number>();
  for (const info of builders) {
    if (info.fleet.progress > 0) continue;
    const at = info.fleet.systemId;
    const here = targets.find((t) => t.systemId === at && !claimed.has(t.bodyId));
    ctx.busy.add(info.fleet.id);
    if (here) {
      claimed.add(here.bodyId);
      ctx.commands.push({ type: "buildOutpost", empireId: ctx.id, fleetId: info.fleet.id, bodyId: here.bodyId, kind: here.kind });
      continue;
    }
    const open = targets.filter((t) => !claimed.has(t.bodyId));
    const dest = nearest(ctx, at, open.map((t) => t.systemId));
    if (dest === null) continue;
    claimed.add(open.find((t) => t.systemId === dest)!.bodyId);
    moveTo(ctx, info, dest);
  }
}
