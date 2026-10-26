import { buildOptions, buyCost, colonyOutput, findBody, itemCost, planetStats, prospectiveMaxPop } from "../economy";
import { combatShipCount, designStats, fleetShipStats, getDesign } from "../ships";
import type { Colony, Focus, QueueItem } from "../state";
import type { AiContext, FleetInfo } from "./context";
import { designWhere, guardFor, raidsCloaked, shadeDesign } from "./designs";
import { outpostTargets } from "./operations";
import type { Strategy } from "./strategy";

/**
 * Most warships an AI empire keeps (built or queued). Past this its strength has to come from
 * better designs; it also keeps late, open-ended games quick to play.
 */
export const AI_MAX_WARSHIPS = 60;

/** Most cloaked raiders (Shades) a raiding AI keeps. */
export const AI_SHADES = 6;

/** Siege ships and commando ships an AI empire keeps while at war (once researched). */
export const AI_SIEGE = { bombers: 2, infiltrators: 1 };

/**
 * What to build, how to work each colony, and how to stay solvent.
 */
export function planProduction(ctx: AiContext, strategy: Strategy, warshipId: string | null): void {
  const { pack, empire, personality: p } = ctx;
  manageFocus(ctx);
  // Plan against steady income: credits from idle industry vanish as soon as something is queued.
  const eco = ctx.economy;
  const steadyNet = steadyCredits(ctx);
  const margin = 2 + Math.floor(ctx.colonies.length / 3) + (empire.credits < 0 ? 4 : 0);
  // A healthy treasury is runway: every 40 credits banked can carry one more upkeep for a long while.
  const runway = Math.max(0, Math.floor((empire.credits - 60) / 40));
  const room = { upkeep: steadyNet - margin + runway };
  // At war (or under attack) and short of warships, a big treasury pays for them faster: one more upkeep per 25 banked.
  const warRunway = Math.max(0, Math.floor((empire.credits - 60) / 25)) - runway;
  // Warship upkeep may only use a share of income that depends on temperament.
  const fleetBudget = Math.floor((eco.income * (25 + p.military * 3)) / 100) + Math.floor(runway / 2);
  let fleetRoom = fleetBudget - ctx.economy.shipUpkeep;
  avoidDebt(ctx, strategy, room);

  const fx = ctx.fx;
  // Ships queued, batches counted in full.
  const queuedOf = (test: (item: QueueItem) => boolean) => ctx.colonies.reduce((n, c) => n + c.queue.filter(test).reduce((k, q) => k + (q.count ?? 1), 0), 0);
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

  const colonyDesign = designWhere(ctx, (s) => s.colonize && !s.habitat);
  const habitatDesign = designWhere(ctx, (s) => s.habitat);
  const scoutDesign = designWhere(ctx, (s) => s.role === "recon");
  const troopDesign = designWhere(ctx, (s) => s.troops > 0 && !s.colonize);
  const outpostDesign = designWhere(ctx, (s) => s.outpost);
  // A supply ship for the strike force when going to war.
  const supplyDesign = designWhere(ctx, (s) => s.stores > 0 && !s.armed);
  // Support ships are counted ship by ship: once merged into a strike force their fleet is armed.
  const afloat = (test: (s: ReturnType<typeof designStats>) => boolean) => ctx.fleets.reduce((n, f) => n + fleetShipStats(pack, ctx.state, f.fleet).filter(test).length, 0);
  let suppliers = afloat((s) => s.stores > 0 && !s.armed) + queuedOf((q) => isShip(q, (s) => s.stores > 0 && !s.armed));
  const wantSuppliers = strategy.posture === "attack" && strategy.warTarget !== null && supplyDesign ? 1 : 0;
  // One outpost ship at a time, while there are free asteroid fields or gas giants in supply range.
  let outposters = ctx.fleets.filter((f) => f.outpost).length + queuedOf((q) => isShip(q, (s) => s.outpost));
  // Conversions of our own outposts need an outpost ship too, whatever the count.
  const outpostJobs = outpostTargets(ctx);
  const roomForOutposts = ctx.state.outposts.filter((o) => o.empireId === ctx.id).length < ctx.colonies.length;
  const wantOutposters = outpostDesign && outpostJobs.some((t) => t.convert || roomForOutposts) ? 1 : 0;
  // Invasion force: enough troops for the nearest war-target colony's last known defenders, with a margin.
  const carriedTroops = ctx.fleets.reduce((n, f) => n + f.troops, 0) + queuedOf((q) => isShip(q, (s) => s.troops > 0)) * (troopDesign ? designStats(pack, troopDesign, fx).troops : 0);
  let troopsWanted = 0;
  if (strategy.posture === "attack" && strategy.warTarget !== null && ctx.capital && troopDesign) {
    const fromCapital = ctx.dist(ctx.capital.systemId);
    const target = ctx.rivalColonies.filter((c) => c.empireId === strategy.warTarget).sort((a, b) => fromCapital[a.systemId]! - fromCapital[b.systemId]! || a.colonyId - b.colonyId)[0];
    if (target) troopsWanted = Math.ceil((target.troops * 3) / 2) + 2;
  }
  let troopShortfall = troopsWanted - carriedTroops;
  // Siege ships and commandos ride with strike forces once researched.
  // In the endgame drive plague bombers take over from ordinary ones once available.
  const plainBomber = designWhere(ctx, (s) => s.bombard > 0 && s.armed && !s.cracker && s.plague === 0);
  const plagueBomber = strategy.endgame ? designWhere(ctx, (s) => s.plague > 0 && s.armed) : null;
  const bomberDesign = plagueBomber ?? plainBomber;
  const infiltratorDesign = designWhere(ctx, (s) => s.commandos > 0 && s.stealth && !s.armed);
  const atWar = strategy.posture === "attack" && strategy.targetColony !== null;
  let bombers = afloat((s) => s.bombard > 0) + queuedOf((q) => isShip(q, (s) => s.bombard > 0));
  const wantBombers = atWar && bomberDesign ? AI_SIEGE.bombers : 0;
  let infiltrators = afloat((s) => s.commandos > 0 && !s.armed) + queuedOf((q) => isShip(q, (s) => s.commandos > 0 && !s.armed));
  const wantInfiltrators = atWar && infiltratorDesign && strategy.targetColony!.defenseHp > 0 ? AI_SIEGE.infiltrators : 0;
  // Minelayers: defensive temperaments keep one (two for the most defensive), and anyone under attack.
  const minelayerDesign = designWhere(ctx, (s) => s.mines > 0 && !s.armed);
  let minelayers = afloat((s) => s.mines > 0 && !s.armed) + queuedOf((q) => isShip(q, (s) => s.mines > 0 && !s.armed));
  const wantMinelayers = minelayerDesign && (p.defense >= 5 || strategy.posture === "defend") ? (p.defense >= 7 ? 2 : 1) : 0;
  let settlers = ctx.fleets.filter((f) => f.colonize && !f.habitat).length + queuedOf((q) => isShip(q, (s) => s.colonize && !s.habitat));
  // One habitat ship at a time, when a free gas giant is known and the treasury can stand it.
  let habitats = ctx.fleets.filter((f) => f.habitat).length + queuedOf((q) => isShip(q, (s) => s.habitat));
  const wantHabitats = habitatDesign && strategy.colonyTargets.some((t) => t.habitat) && empire.credits > 150 ? 1 : 0;
  let scouts = ctx.fleets.filter((f) => f.recon).length + queuedOf((q) => isShip(q, (s) => s.role === "recon"));
  const wantSettlers = Math.min(1 + Math.floor(p.expansion / 4), strategy.colonyTargets.filter((t) => !t.habitat).length);
  const unexplored = ctx.state.galaxy.systems.length - empire.explored.length;
  const wantScouts = unexplored > 0 ? 1 + (p.expansion >= 7 ? 1 : 0) : 0;
  const urgent = strategy.posture === "defend" || strategy.posture === "attack";

  // Warp gates: the capital and the colony nearest the war target, once researched and affordable.
  const gate = pack.buildings.find((b) => b.warpGate);
  const gateItem: QueueItem | null = gate ? { kind: "building", id: gate.id } : null;
  const gateUpkeep = gate?.upkeep ?? 0;
  const gateSites = new Set<number>();
  if (gate && empire.credits > 200 && ctx.capital && ctx.colonies.length >= 4) {
    gateSites.add(ctx.capital.id);
    const target = strategy.targetColony;
    if (target) {
      const d = ctx.dist(target.systemId);
      const front = ctx.colonies.filter((c) => c.systemId !== ctx.capital!.systemId).sort((a, b) => d[a.systemId]! - d[b.systemId]! || a.id - b.id)[0];
      if (front) gateSites.add(front.id);
    }
  }

  // Planets already being settled this turn (by colony ship or a colony base queued below).
  let queuedGuards = 0;
  let queuedShades = 0;
  const shade = raidsCloaked(ctx) ? shadeDesign(ctx) : null;
  const settling = new Set(ctx.commands.flatMap((c) => (c.type === "colonize" ? [c.bodyId] : [])));
  for (const colony of ctx.colonies) {
    if (colony.queue.length > 0) continue;
    const options = buildOptions(ctx.state, pack, empire, colony);
    const can = (item: QueueItem | null): item is QueueItem => !!item && options.some((o) => o.kind === item.kind && o.id === item.id);
    const warRoom = room.upkeep + (urgent && deficit > 0 ? warRunway : 0);
    const affordable = !!warStats && warStats.upkeep <= warRoom && warStats.upkeep <= fleetRoom + (urgent ? warRunway : 0) && warshipsAfloat + queuedWar < AI_MAX_WARSHIPS;
    // One warship in three is its Guard twin (Screen formation) once the AI has one, to shield flagships.
    const guard = warship ? guardFor(ctx, warship) : null;
    const guards = ctx.fleets.reduce((n, f) => n + f.fleet.ships.filter((s) => s.designId === guard?.id).length, 0) + queuedGuards;
    // Raiding temperaments make one warship in three a cloaked raider (Shade), up to AI_SHADES.
    const shades = ctx.fleets.reduce((n, f) => n + f.fleet.ships.filter((s) => s.designId === shade?.id).length, 0) + queuedShades;
    const warDesign =
      shade && shades < AI_SHADES && shades * 3 < warshipsAfloat + queuedWar ? shade : guard && guards * 3 < warshipsAfloat + queuedWar ? guard : warship;
    const warItem = warDesign && affordable ? ({ kind: "ship", id: warDesign.id } as QueueItem) : null;
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
    } else if (habitats < wantHabitats && big && !urgent && habitatDesign && can({ kind: "ship", id: habitatDesign.id })) {
      pick = { kind: "ship", id: habitatDesign.id };
      habitats++;
    } else if (troopShortfall > 0 && big && troopDesign && can({ kind: "ship", id: troopDesign.id })) {
      // A batch covers the shortfall in one queue entry.
      const each = Math.max(1, designStats(pack, troopDesign, fx).troops);
      const count = Math.min(5, Math.ceil(troopShortfall / each));
      pick = count > 1 ? { kind: "ship", id: troopDesign.id, count } : { kind: "ship", id: troopDesign.id };
      troopShortfall -= each * count;
    } else if (infiltrators < wantInfiltrators && big && infiltratorDesign && can({ kind: "ship", id: infiltratorDesign.id })) {
      pick = { kind: "ship", id: infiltratorDesign.id };
      infiltrators++;
    } else if (bombers < wantBombers && big && bomberDesign && can({ kind: "ship", id: bomberDesign.id }) && designStats(pack, bomberDesign, fx).upkeep <= room.upkeep) {
      pick = { kind: "ship", id: bomberDesign.id };
      room.upkeep -= designStats(pack, bomberDesign, fx).upkeep;
      bombers++;
    } else if (suppliers < wantSuppliers && big && supplyDesign && can({ kind: "ship", id: supplyDesign.id })) {
      pick = { kind: "ship", id: supplyDesign.id };
      suppliers++;
    } else if (minelayers < wantMinelayers && big && minelayerDesign && can({ kind: "ship", id: minelayerDesign.id }) && designStats(pack, minelayerDesign, fx).upkeep <= room.upkeep) {
      pick = { kind: "ship", id: minelayerDesign.id };
      room.upkeep -= designStats(pack, minelayerDesign, fx).upkeep;
      minelayers++;
    } else if (outposters < wantOutposters && big && !urgent && outpostDesign && can({ kind: "ship", id: outpostDesign.id })) {
      pick = { kind: "ship", id: outpostDesign.id };
      outposters++;
    } else if (scouts < wantScouts && colony.capital && scoutDesign && can({ kind: "ship", id: scoutDesign.id })) {
      pick = { kind: "ship", id: scoutDesign.id };
      scouts++;
    } else if (gateSites.has(colony.id) && can(gateItem) && gateUpkeep <= room.upkeep) {
      // Warp gates at the capital and the colony nearest the war target, so fleets can jump to the front.
      pick = gateItem;
    } else {
      // Warlike temperaments short of warships keep a warship's upkeep free of new buildings.
      const keep = deficit > 0 && p.military >= 6 && warStats ? warStats.upkeep : 0;
      pick = bestBuilding(ctx, colony, options, room.upkeep - keep);
      if (!pick && deficit > 0 && big && can(warItem)) pick = warItem;
    }
    if (!pick) continue;
    if (pick.kind === "building") room.upkeep -= pack.buildings.find((b) => b.id === pick!.id)!.upkeep;
    if (pick === warItem) {
      room.upkeep -= warStats!.upkeep;
      fleetRoom -= warStats!.upkeep;
      deficit -= perWarship;
      queuedWar++;
      if (pick.id === guard?.id) queuedGuards++;
      if (pick.id === shade?.id) queuedShades++;
    }
    ctx.commands.push({ type: "queueBuild", empireId: ctx.id, colonyId: colony.id, item: pick });
  }

  // Buy with surplus credits, keeping a reserve that grows with the empire. Urgent builds first.
  // Credits already committed this turn (outpost marks, depots) are gone before any buying.
  const committed = ctx.commands.reduce(
    (n, c) =>
      n +
      (c.type === "upgradeOutpostMark" ? ctx.pack.outposts.marks[ctx.state.outposts.find((o) => o.id === c.outpostId)!.mark]!.cost : 0) +
      (c.type === "upgradeOutpost" ? ctx.pack.outposts.depot.cost : 0),
    0,
  );
  let spendable = empire.credits - committed - (30 + ctx.colonies.length * 8);
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

/** Credits per turn the empire can count on: taxes, mining and food sales, less all upkeep (idle industry aside). */
export function steadyCredits(ctx: AiContext): number {
  const e = ctx.economy;
  return e.income + e.miningIncome + e.foodSales - e.buildingUpkeep - e.shipUpkeep - e.outpostUpkeep;
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

function defenseValue(d: { hp?: number; shield?: number; weapons?: { damage: number; accuracy: number; count: number }[]; troops?: number; mines?: number; satellites?: number }): number {
  const dpr = (d.weapons ?? []).reduce((n, w) => n + (w.damage * w.accuracy * w.count) / 100, 0);
  // Hunter-killer satellites: a shot each a turn (about 6 damage, 70% hits) that keeps firing after the main defenses fall.
  return Math.floor((d.hp ?? 0) / 4 + dpr * 4 + (d.troops ?? 0) * 2 + (d.shield ?? 0) * 10 + (d.mines ?? 0) / 2 + (d.satellites ?? 0) * 17);
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
  const steadyNet = steadyCredits(ctx);
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
  scrapForDebt(ctx, steadyNet);
}

/**
 * In debt and still losing credits each turn: scrap enough ships to cover the shortfall, at most a quarter of
 * the fleets a turn. Loose groups go first, then unarmed support ships, then fleets, the least strength per
 * credit of upkeep first; never the last warships at the capital, nor ships given orders this turn.
 */
function scrapForDebt(ctx: AiContext, steadyNet: number): void {
  if (ctx.empire.credits >= 0 || steadyNet >= 0) return;
  const { pack, empire } = ctx;
  // Fleets only moved or given standing orders can still go; any other order this turn (merging, forming,
  // invading...) would fail once they are gone.
  const ordered = new Set(
    ctx.commands.filter((c) => c.type !== "moveFleet" && c.type !== "setFleetOrders").flatMap((c) => [..."fleetId" in c ? [c.fleetId] : [], ..."intoFleetId" in c ? [c.intoFleetId] : []]),
  );
  const upkeep = (info: FleetInfo) => info.fleet.ships.reduce((n, ship) => n + designStats(pack, getDesign(empire, ship.designId), ctx.fx).upkeep, 0);
  const capital = ctx.capital?.systemId;
  const guards = ctx.fleets.filter((f) => f.armed && !f.colonize && f.fleet.systemId === capital && f.fleet.progress === 0);
  const tier = (info: FleetInfo) => (info.fleet.command ? 2 : info.armed ? 0 : 1);
  const candidates = ctx.fleets
    .filter((f) => !f.colonize && !f.outpost && !f.recon && (f.armed || f.supplier || f.troops > 0) && !ordered.has(f.fleet.id) && upkeep(f) > 0)
    .filter((f) => !(guards.length === 1 && guards[0] === f))
    .sort((a, b) => tier(a) - tier(b) || a.strength * upkeep(b) - b.strength * upkeep(a) || a.fleet.id - b.fleet.id);
  const most = Math.max(1, Math.floor(ctx.fleets.filter((f) => f.armed).length / 4));
  let saved = 0;
  let scrapped = 0;
  for (const info of candidates) {
    if (saved >= -steadyNet || scrapped >= most) break;
    saved += upkeep(info);
    scrapped++;
    ctx.busy.add(info.fleet.id);
    ctx.commands.push({ type: "disbandFleet", empireId: ctx.id, fleetId: info.fleet.id });
  }
}
