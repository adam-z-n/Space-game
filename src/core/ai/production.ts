import { buildOptions, buyCost, colonyOutput, findBody, itemCost, planetStats, prospectiveMaxPop } from "../economy";
import { combatShipCount, designStats } from "../ships";
import type { Colony, Focus, QueueItem } from "../state";
import type { AiContext } from "./context";
import { designWhere } from "./designs";
import { outpostTargets } from "./operations";
import type { Strategy } from "./strategy";

/**
 * Most warships an AI empire keeps (built or queued). Past this its strength has to come from
 * better designs; it also keeps late, open-ended games quick to play.
 */
export const AI_MAX_WARSHIPS = 60;

/**
 * What to build, how to work each colony, and how to stay solvent.
 */
export function planProduction(ctx: AiContext, strategy: Strategy, warshipId: string | null): void {
  const { pack, empire, personality: p } = ctx;
  manageFocus(ctx);
  // Plan against taxes only: credits from idle industry vanish as soon as something is queued.
  const eco = ctx.economy;
  const steadyNet = eco.income - eco.buildingUpkeep - eco.shipUpkeep;
  const margin = 2 + Math.floor(ctx.colonies.length / 3) + (empire.credits < 0 ? 4 : 0);
  // A healthy treasury is runway: every 40 credits banked can carry one more upkeep for a long while.
  const runway = Math.max(0, Math.floor((empire.credits - 60) / 40));
  const room = { upkeep: steadyNet - margin + runway };
  // Warship upkeep may only use a share of income that depends on temperament.
  const fleetBudget = Math.floor((eco.income * (25 + p.military * 3)) / 100) + Math.floor(runway / 2);
  let fleetRoom = fleetBudget - ctx.economy.shipUpkeep;
  avoidDebt(ctx, strategy, room);

  const fx = ctx.fx;
  const queuedOf = (test: (item: QueueItem) => boolean) => ctx.colonies.reduce((n, c) => n + c.queue.filter(test).length, 0);
  const isShip = (item: QueueItem, test: (s: ReturnType<typeof designStats>) => boolean) => {
    if (item.kind !== "ship") return false;
    const design = empire.designs.find((d) => d.id === item.id);
    return !!design && test(designStats(pack, design, fx));
  };

  const warship = warshipId ? empire.designs.find((d) => d.id === warshipId) ?? null : null;
  const warStats = warship ? designStats(pack, warship, fx) : null;
  const perWarship = warStats ? Math.max(1, Math.round((warStats.damagePerRound * (warStats.maxHp + warStats.shield * 6)) / 4)) : 1;
  let queuedWar = queuedOf((q) => isShip(q, (s) => s.armed && !s.colonize));
  const warshipsAfloat = ctx.fleets.reduce((n, f) => n + combatShipCount(pack, ctx.state, f.fleet), 0);
  let deficit = strategy.wantedStrength - ctx.ownStrength - queuedWar * perWarship;

  const colonyDesign = designWhere(ctx, (s) => s.colonize);
  const scoutDesign = designWhere(ctx, (s) => s.role === "recon");
  const troopDesign = designWhere(ctx, (s) => s.troops > 0 && !s.colonize);
  const outpostDesign = designWhere(ctx, (s) => s.outpost);
  // A supply ship for the strike force when going to war.
  const supplyDesign = designWhere(ctx, (s) => s.stores > 0 && !s.armed);
  let suppliers = ctx.fleets.filter((f) => f.supplier).length + queuedOf((q) => isShip(q, (s) => s.stores > 0 && !s.armed));
  const wantSuppliers = strategy.posture === "attack" && strategy.warTarget !== null && supplyDesign ? 1 : 0;
  // One outpost ship at a time, while there are free asteroid fields or gas giants in supply range.
  let outposters = ctx.fleets.filter((f) => f.outpost).length + queuedOf((q) => isShip(q, (s) => s.outpost));
  const wantOutposters = outpostDesign && ctx.state.outposts.filter((o) => o.empireId === ctx.id).length < ctx.colonies.length && outpostTargets(ctx).length > 0 ? 1 : 0;
  // Invasion force: enough troops for the nearest war-target colony's last known defenders, with a margin.
  const carriedTroops = ctx.fleets.reduce((n, f) => n + f.troops, 0) + queuedOf((q) => isShip(q, (s) => s.troops > 0)) * (troopDesign ? designStats(pack, troopDesign, fx).troops : 0);
  let troopsWanted = 0;
  if (strategy.posture === "attack" && strategy.warTarget !== null && ctx.capital && troopDesign) {
    const fromCapital = ctx.dist(ctx.capital.systemId);
    const target = ctx.rivalColonies.filter((c) => c.empireId === strategy.warTarget).sort((a, b) => fromCapital[a.systemId]! - fromCapital[b.systemId]! || a.colonyId - b.colonyId)[0];
    if (target) troopsWanted = Math.ceil((target.troops * 3) / 2) + 2;
  }
  let troopShortfall = troopsWanted - carriedTroops;
  let settlers = ctx.fleets.filter((f) => f.colonize).length + queuedOf((q) => isShip(q, (s) => s.colonize));
  let scouts = ctx.fleets.filter((f) => f.recon).length + queuedOf((q) => isShip(q, (s) => s.role === "recon"));
  const wantSettlers = Math.min(1 + Math.floor(p.expansion / 4), strategy.colonyTargets.length);
  const unexplored = ctx.state.galaxy.systems.length - empire.explored.length;
  const wantScouts = unexplored > 0 ? 1 + (p.expansion >= 7 ? 1 : 0) : 0;
  const urgent = strategy.posture === "defend" || strategy.posture === "attack";

  // Planets already being settled this turn (by colony ship or a colony base queued below).
  const settling = new Set(ctx.commands.flatMap((c) => (c.type === "colonize" ? [c.bodyId] : [])));
  for (const colony of ctx.colonies) {
    if (colony.queue.length > 0) continue;
    const options = buildOptions(ctx.state, pack, empire, colony);
    const can = (item: QueueItem | null): item is QueueItem => !!item && options.some((o) => o.kind === item.kind && o.id === item.id);
    const affordable = !!warStats && warStats.upkeep <= room.upkeep && warStats.upkeep <= fleetRoom && warshipsAfloat + queuedWar < AI_MAX_WARSHIPS;
    const warItem = warship && affordable ? ({ kind: "ship", id: warship.id } as QueueItem) : null;
    const big = colony.population >= 3;
    let pick: QueueItem | null = null;

    // A colony base settles a planet in the same system without a colony ship.
    const base = options
      .filter((o) => o.kind === "colonyBase" && !settling.has(o.bodyId!))
      .map((o) => ({ item: o, pop: prospectiveMaxPop(pack, empire, ctx.state.galaxy.systems[colony.systemId]!.bodies.find((b) => b.id === o.bodyId)!) }))
      .filter((o) => o.pop >= 3)
      .sort((a, b) => b.pop - a.pop || a.item.bodyId! - b.item.bodyId!)[0];

    if (urgent && deficit > 0 && big && can(warItem)) pick = warItem;
    else if (base && colony.population >= 2 && p.expansion >= 3) {
      pick = base.item;
      settling.add(base.item.bodyId!);
    }
    else if (settlers < wantSettlers && big && colonyDesign && can({ kind: "ship", id: colonyDesign.id })) {
      pick = { kind: "ship", id: colonyDesign.id };
      settlers++;
    } else if (troopShortfall > 0 && big && troopDesign && can({ kind: "ship", id: troopDesign.id })) {
      pick = { kind: "ship", id: troopDesign.id };
      troopShortfall -= designStats(pack, troopDesign, fx).troops;
    } else if (suppliers < wantSuppliers && big && supplyDesign && can({ kind: "ship", id: supplyDesign.id })) {
      pick = { kind: "ship", id: supplyDesign.id };
      suppliers++;
    } else if (outposters < wantOutposters && big && !urgent && outpostDesign && can({ kind: "ship", id: outpostDesign.id })) {
      pick = { kind: "ship", id: outpostDesign.id };
      outposters++;
    } else if (scouts < wantScouts && colony.capital && scoutDesign && can({ kind: "ship", id: scoutDesign.id })) {
      pick = { kind: "ship", id: scoutDesign.id };
      scouts++;
    } else {
      pick = bestBuilding(ctx, colony, options, room.upkeep);
      if (!pick && deficit > 0 && big && can(warItem)) pick = warItem;
    }
    if (!pick) continue;
    if (pick.kind === "building") room.upkeep -= pack.buildings.find((b) => b.id === pick!.id)!.upkeep;
    if (pick === warItem) {
      room.upkeep -= warStats!.upkeep;
      fleetRoom -= warStats!.upkeep;
      deficit -= perWarship;
      queuedWar++;
    }
    ctx.commands.push({ type: "queueBuild", empireId: ctx.id, colonyId: colony.id, item: pick });
  }

  // Buy with surplus credits, keeping a reserve that grows with the empire. Urgent builds first.
  let spendable = empire.credits - (30 + ctx.colonies.length * 8);
  const order = [...ctx.colonies].sort((a, b) => Number(b.capital) - Number(a.capital) || a.id - b.id);
  for (const colony of order) {
    const first = colony.queue[0];
    if (!first) continue;
    const isWar = isShip(first, (s) => s.armed);
    if (isWar && (fleetRoom < 0 || (!urgent && deficit <= 0))) continue;
    const cost = buyCost(pack, empire, colony);
    if (cost !== null && cost <= spendable) {
      spendable -= cost;
      ctx.commands.push({ type: "buyBuild", empireId: ctx.id, colonyId: colony.id });
    }
  }
}

/** Most value per industry among buildings the treasury can carry. */
function bestBuilding(ctx: AiContext, colony: Colony, options: QueueItem[], upkeepRoom: number): QueueItem | null {
  const { pack, personality: p } = ctx;
  const out = colonyOutput(ctx.state, pack, colony);
  const wInd = 5 + Math.floor((p.military + p.economy) / 2);
  const wRes = 5 + p.research;
  const hungry = ctx.economy.netFood < 0 ? 6 : 1;
  const exposure = colonyExposure(ctx, colony);
  let best: QueueItem | null = null;
  let bestScore = 0;
  for (const item of options) {
    if (item.kind !== "building") continue;
    const b = pack.buildings.find((x) => x.id === item.id)!;
    if (b.upkeep > upkeepRoom) continue;
    if (colony.population < 3 && b.cost > 40) continue;
    const e = b.effects;
    const value =
      ((e.industry ?? 0) + Math.floor(((e.industryPercent ?? 0) * out.industry) / 100)) * wInd +
      ((e.research ?? 0) + Math.floor(((e.researchPercent ?? 0) * out.research) / 100)) * wRes +
      (e.food ?? 0) * 3 * hungry +
      (e.credits ?? 0) * 6 +
      (e.maxPop ?? 0) * 8 * (out.maxPop - colony.population <= 1 ? 2 : 1) +
      defenseValue(b.defense) * exposure * (2 + p.defense) / 10 -
      b.upkeep * 8;
    const score = Math.floor((value * 1000) / itemCost(pack, ctx.empire, item));
    if (value > 0 && score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

/** How threatened a colony is: 0 (deep in our space) to 3 (rivals or their warships next door). */
function colonyExposure(ctx: AiContext, colony: Colony): number {
  const d = ctx.dist(colony.systemId);
  const nearRival = ctx.rivalColonies.some((c) => d[c.systemId]! <= 450);
  const nearShips = ctx.recentEnemies.some((s) => d[s.systemId]! <= 350);
  let exposure = (nearRival ? 1 : 0) + (nearShips ? 1 : 0) + (colony.blockaded ? 1 : 0);
  if (colony.capital) exposure = Math.max(exposure, 1);
  return exposure;
}

function defenseValue(d: { hp?: number; shield?: number; weapons?: { damage: number; accuracy: number; count: number }[]; troops?: number; mines?: number }): number {
  const dpr = (d.weapons ?? []).reduce((n, w) => n + (w.damage * w.accuracy * w.count) / 100, 0);
  return Math.floor((d.hp ?? 0) / 4 + dpr * 4 + (d.troops ?? 0) * 2 + (d.shield ?? 0) * 10 + (d.mines ?? 0) / 2);
}

/** Capital stays balanced; other colonies lean to the personality, or to food when the stock is running out. */
function manageFocus(ctx: AiContext): void {
  const { pack, empire, personality: p } = ctx;
  const starving = empire.food < 15 && ctx.economy.netFood < 0;
  let fed = !starving;
  for (const colony of ctx.colonies) {
    const body = findBody(ctx.state, colony.systemId, colony.bodyId)!;
    const canFarm = planetStats(pack, body).foodYield > 0;
    let focus: Focus = "balanced";
    if (!fed && canFarm && !colony.capital) {
      focus = "food";
      fed = true;
    } else if (!colony.capital) {
      if (p.research >= 8) focus = "research";
      else if (p.military >= 8 || p.economy >= 8) focus = "industry";
    }
    if (colony.focus !== focus) ctx.commands.push({ type: "setFocus", empireId: ctx.id, colonyId: colony.id, focus });
  }
}

/** Out of money: stop adding upkeep, cancel queued upkeep buildings, and in deep debt scrap the weakest warship group. */
function avoidDebt(ctx: AiContext, strategy: Strategy, room: { upkeep: number }): void {
  const steadyNet = ctx.economy.income - ctx.economy.buildingUpkeep - ctx.economy.shipUpkeep;
  // Raise taxes while the treasury runs dry; lower them again once it has recovered.
  const tax = ctx.empire.taxLevel;
  if (tax === "normal" && ctx.empire.credits < 20 && steadyNet <= 0) ctx.commands.push({ type: "setTaxLevel", empireId: ctx.id, taxLevel: "high" });
  else if (tax === "high" && ctx.empire.credits > 80 + ctx.colonies.length * 10) ctx.commands.push({ type: "setTaxLevel", empireId: ctx.id, taxLevel: "normal" });
  if (ctx.empire.credits >= 0 || steadyNet > 0) return;
  for (const colony of ctx.colonies) {
    for (let i = colony.queue.length - 1; i >= 0; i--) {
      const item = colony.queue[i]!;
      if (item.kind === "building" && ctx.pack.buildings.find((b) => b.id === item.id)!.upkeep > 0) {
        ctx.commands.push({ type: "dequeueBuild", empireId: ctx.id, colonyId: colony.id, index: i });
        room.upkeep += 1;
      }
    }
  }
  if (ctx.empire.credits < -60 || (ctx.empire.credits < -20 && strategy.threat === 0)) {
    const weakest = ctx.fleets.filter((f) => f.armed && !f.colonize && !ctx.busy.has(f.fleet.id)).sort((a, b) => a.strength - b.strength || a.fleet.id - b.fleet.id)[0];
    if (weakest) {
      ctx.busy.add(weakest.fleet.id);
      ctx.commands.push({ type: "disbandFleet", empireId: ctx.id, fleetId: weakest.fleet.id });
    }
  }
}
