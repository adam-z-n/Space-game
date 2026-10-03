import type { ContentPack } from "../content/schema";
import type { Command } from "./commands";
import { availableTechs, buildOptions, buyCost, colonizeBlocker, empireEconomy, empireEffects, prospectiveMaxPop } from "./economy";
import { buildAdjacency, shortestPaths } from "./graph";
import { componentAvailable, designStats, fleetArmed, fleetCanColonize, fleetShipStats, fleetStrength, hullAvailable } from "./ships";
import { suppliedSystems } from "./supply";
import { colonyOnBody, type Colony, type EmpireId, type Fleet, type GameState, type ShipDesign, type SystemId } from "./state";

/**
 * Placeholder AI (the real strategic/operational AI is Milestone 5).
 * Explores with scouts, researches the cheapest tech, expands with colony ships,
 * fills build queues, keeps a warship design current, gathers warships into a
 * main fleet, intercepts weaker intruders inside its supply zone, and blockades
 * rival colonies when clearly stronger. It reads only its own empire's knowledge
 * (explored systems, sightings) and issues ordinary commands.
 */

const WARSHIP_PREFIX = "Warship Mk ";

export function planAiTurn(state: GameState, pack: ContentPack, empireId: EmpireId): Command[] {
  const empire = state.empires[empireId]!;
  const adj = buildAdjacency(state.galaxy.systems.length, state.galaxy.lanes);
  const explored = new Set(empire.explored);
  const commands: Command[] = [];
  const myFleets = state.fleets.filter((f) => f.empireId === empireId).sort((a, b) => a.id - b.id);
  const myColonies = state.colonies.filter((c) => c.empireId === empireId).sort((a, b) => a.id - b.id);
  const capital = myColonies.find((c) => c.capital) ?? myColonies[0];
  const supplied = suppliedSystems(state, pack, empireId);
  const isRecon = (f: Fleet) => fleetShipStats(pack, state, f).every((s) => s.role === "recon");

  // Research: cheapest available, ties by pack order.
  if (empire.research.current === null) {
    const options = availableTechs(pack, empire).sort((a, b) => a.cost - b.cost);
    if (options[0]) commands.push({ type: "setResearch", empireId, techId: options[0].id });
  }

  // Keep one up-to-date warship design.
  const warship = bestWarshipDesign(state, pack, empireId);
  if (warship.create) commands.push({ type: "createDesign", empireId, design: warship.create });

  // ---------- colonization ----------
  const knownTaken = new Set(empire.colonySightings.map((c) => c.bodyId));
  const targets: { systemId: SystemId; bodyId: number; value: number }[] = [];
  for (const systemId of empire.explored) {
    for (const body of state.galaxy.systems[systemId]!.bodies) {
      if (colonizeBlocker(pack, empire, body) !== null || knownTaken.has(body.id)) continue;
      if (colonyOnBody(state, body.id)?.empireId === empireId) continue;
      targets.push({ systemId, bodyId: body.id, value: prospectiveMaxPop(pack, empire, body) });
    }
  }
  const claimed = new Set<number>();
  for (const fleet of myFleets) {
    if (fleetCanColonize(pack, state, fleet) && fleet.route.length > 0) {
      const dest = fleet.route[fleet.route.length - 1]!;
      const target = targets.find((t) => t.systemId === dest && !claimed.has(t.bodyId));
      if (target) claimed.add(target.bodyId);
    }
  }

  // ---------- threats and opportunities, from sightings only ----------
  const recentFleets = empire.sightings.filter((s) => s.turn >= state.turn - 2 && s.armed && s.nextSystemId === null);
  const threats = recentFleets.filter((s) => supplied.has(s.systemId)).sort((a, b) => b.strength - a.strength || a.fleetId - b.fleetId);
  const threatStrength = threats.reduce((n, s) => n + s.strength, 0);

  const scouting = new Set<SystemId>();
  for (const fleet of myFleets) if (isRecon(fleet) && fleet.route.length > 0) scouting.add(fleet.route[fleet.route.length - 1]!);

  // Warships: gather idle ones at the capital into the strongest fleet there.
  const warFleets = myFleets.filter((f) => fleetArmed(pack, state, f) && !fleetCanColonize(pack, state, f));
  const atCapital = warFleets.filter((f) => capital && f.systemId === capital.systemId && f.progress === 0 && f.route.length === 0);
  const main = [...warFleets].sort((a, b) => fleetStrength(pack, state, b) - fleetStrength(pack, state, a) || a.id - b.id)[0];
  const merged = new Set<number>();
  if (main && main.progress === 0 && main.route.length === 0) {
    for (const fleet of atCapital) {
      if (fleet.id !== main.id && fleet.systemId === main.systemId) {
        commands.push({ type: "mergeFleets", empireId, fleetId: fleet.id, intoFleetId: main.id });
        merged.add(fleet.id);
      }
    }
  }
  const mainStrength = main ? warFleets.filter((f) => f.id === main.id || merged.has(f.id)).reduce((n, f) => n + fleetStrength(pack, state, f), 0) : 0;

  for (const fleet of myFleets) {
    if (merged.has(fleet.id) || fleet.progress > 0) continue;
    const { dist } = shortestPaths(adj, fleet.systemId);

    if (fleetCanColonize(pack, state, fleet)) {
      if (fleet.route.length > 0) continue;
      const here = targets
        .filter((t) => t.systemId === fleet.systemId && !claimed.has(t.bodyId) && !colonyOnBody(state, t.bodyId))
        .sort((a, b) => b.value - a.value || a.bodyId - b.bodyId)[0];
      if (here) {
        claimed.add(here.bodyId);
        commands.push({ type: "colonize", empireId, fleetId: fleet.id, bodyId: here.bodyId });
        continue;
      }
      let best: (typeof targets)[number] | null = null;
      let bestScore = -1;
      for (const t of targets) {
        if (claimed.has(t.bodyId) || dist[t.systemId] === Infinity) continue;
        const score = Math.floor((t.value * 10000) / (dist[t.systemId]! + 100));
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best) {
        claimed.add(best.bodyId);
        commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: best.systemId });
      }
      continue;
    }

    if (isRecon(fleet)) {
      if (fleet.route.length > 0) continue;
      let target = -1;
      for (let i = 0; i < dist.length; i++) {
        if (explored.has(i) || scouting.has(i) || dist[i] === Infinity) continue;
        if (target === -1 || dist[i]! < dist[target]!) target = i;
      }
      if (target !== -1) {
        scouting.add(target);
        commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: target });
      }
      continue;
    }

    if (fleet.id !== main?.id || !capital) continue;

    // Main fleet: low on supply or badly hurt -> go home.
    const stats = fleetShipStats(pack, state, fleet);
    const hp = fleet.ships.reduce((n, s) => n + s.hp, 0);
    const maxHp = stats.reduce((n, s) => n + s.maxHp, 0);
    if (!supplied.has(fleet.systemId) && fleet.supply <= 1) {
      if (fleet.systemId !== capital.systemId) commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: capital.systemId });
      continue;
    }
    if (hp * 2 < maxHp) {
      if (fleet.systemId !== capital.systemId && fleet.route.at(-1) !== capital.systemId) {
        commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: capital.systemId });
      }
      continue;
    }

    // Intercept the biggest intruder we can beat.
    const intruder = threats.find((t) => mainStrength * 10 >= t.strength * 13 && dist[t.systemId] !== Infinity);
    if (intruder) {
      if (fleet.route.at(-1) !== intruder.systemId && fleet.systemId !== intruder.systemId) {
        commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: intruder.systemId });
      }
      continue;
    }

    // Blockade the nearest known rival colony within supply reach, if clearly stronger than what guards it.
    if (fleet.route.length === 0 && threats.length === 0 && mainStrength >= 120) {
      const reach = fleet.supply * fleet.speed;
      let target: SystemId | null = null;
      for (const colony of empire.colonySightings) {
        const guard = recentFleets.filter((s) => s.systemId === colony.systemId).reduce((n, s) => n + s.strength, 0);
        if (mainStrength * 10 < guard * 15 || dist[colony.systemId] === Infinity) continue;
        if (!nearSupply(colony.systemId, supplied, adj, reach)) continue;
        if (target === null || dist[colony.systemId]! < dist[target]!) target = colony.systemId;
      }
      if (target !== null && target !== fleet.systemId) {
        commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: target });
        continue;
      }
    }

    // Otherwise stay home when idle.
    if (fleet.route.length === 0 && fleet.systemId !== capital.systemId && threats.length === 0 && !empire.colonySightings.some((c) => c.systemId === fleet.systemId)) {
      commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: capital.systemId });
    }
  }

  // ---------- production ----------
  const colonyShips = myFleets.filter((f) => fleetCanColonize(pack, state, f)).length;
  let queuedColonyShips = myColonies.reduce((n, c) => n + c.queue.filter((q) => q.kind === "ship" && isColonyDesign(state, pack, empireId, q.id)).length, 0);
  const scouts = myFleets.filter(isRecon).length;
  const unexplored = state.galaxy.systems.length - empire.explored.length;
  const openTargets = targets.filter((t) => !claimed.has(t.bodyId)).length;
  const warStrength = warFleets.reduce((n, f) => n + fleetStrength(pack, state, f), 0);
  const wantedStrength = 30 * myColonies.length + 2 * state.turn + threatStrength;
  const warshipDesign = warship.existing;
  let queuedWarships = myColonies.reduce((n, c) => n + c.queue.filter((q) => q.kind === "ship" && q.id === warshipDesign?.id).length, 0);
  // Only build warships the treasury can carry.
  const netCredits = empireEconomy(state, pack, empireId).netCredits;
  const warshipUpkeep = warshipDesign ? designStats(pack, warshipDesign, empireEffects(pack, empire)).upkeep : 0;
  // Upkeep of buildings already queued, which the treasury will soon carry.
  let committedUpkeep = myColonies.reduce((n, c) => n + c.queue.filter((q) => q.kind === "building").reduce((m, q) => m + pack.buildings.find((b) => b.id === q.id)!.upkeep, 0), 0);

  for (const colony of myColonies) {
    if (colony.queue.length > 0) continue;
    const options = buildOptions(pack, empire, colony);
    const affordable = netCredits - queuedWarships * warshipUpkeep >= warshipUpkeep || empire.credits > 150;
    const wantWarship = !!warshipDesign && affordable && warStrength < wantedStrength && queuedWarships < 2 && colony.population >= 3 && (colony.capital || threatStrength > 0);
    const pick = choosePick(state, pack, empireId, colony, options, {
      upkeepRoom: netCredits - committedUpkeep - (empire.credits < 0 ? 5 : 1),
      warshipId: wantWarship ? warshipDesign!.id : null,
      wantColonyShip: colonyShips + queuedColonyShips < Math.min(2, openTargets) && colony.population >= 3,
      wantScout: scouts < 2 && unexplored > 0 && colony.capital,
    });
    if (pick) {
      committedUpkeep += pick.kind === "building" ? pack.buildings.find((b) => b.id === pick.id)!.upkeep : 0;
      if (pick.kind === "ship" && isColonyDesign(state, pack, empireId, pick.id)) queuedColonyShips++;
      if (pick.kind === "ship" && pick.id === warshipDesign?.id) queuedWarships++;
      commands.push({ type: "queueBuild", empireId, colonyId: colony.id, item: pick });
    }
  }

  // Spend surplus credits finishing builds, keeping a reserve. Capital first, then by id.
  let spendable = empire.credits - 60;
  for (const colony of [...myColonies].sort((a, b) => Number(b.capital) - Number(a.capital) || a.id - b.id)) {
    if (colony.queue.length === 0) continue;
    const cost = buyCost(pack, empire, colony);
    if (cost !== null && cost <= spendable) {
      spendable -= cost;
      commands.push({ type: "buyBuild", empireId, colonyId: colony.id });
    }
  }
  return commands;
}

function nearSupply(systemId: SystemId, supplied: Set<SystemId>, adj: ReturnType<typeof buildAdjacency>, reach: number): boolean {
  const { dist } = shortestPaths(adj, systemId);
  for (const s of supplied) if (dist[s]! <= reach) return true;
  return false;
}

function isColonyDesign(state: GameState, pack: ContentPack, empireId: EmpireId, designId: string): boolean {
  const empire = state.empires[empireId]!;
  const design = empire.designs.find((d) => d.id === designId);
  return !!design && designStats(pack, design, empireEffects(pack, empire)).colonize;
}

/**
 * The best warship the empire can build now: biggest hull, best weapon in 60% of the slots,
 * best armor (or shield) in the rest. Returns the design to create if it doesn't exist yet.
 */
function bestWarshipDesign(state: GameState, pack: ContentPack, empireId: EmpireId): { existing: ShipDesign | null; create: Parameters<typeof makeCreate>[0] | null } {
  const empire = state.empires[empireId]!;
  const hull = pack.hulls.filter((h) => hullAvailable(pack, empire, h.id)).sort((a, b) => b.slots - a.slots || b.structure - a.structure)[0];
  const parts = pack.components.filter((c) => componentAvailable(pack, empire, c.id));
  const weapon = parts.filter((c) => c.kind === "weapon").sort((a, b) => b.damage * b.accuracy - a.damage * a.accuracy || a.id.localeCompare(b.id))[0];
  const armor = parts.filter((c) => c.kind === "armor").sort((a, b) => b.hp - a.hp)[0];
  const shield = parts.filter((c) => c.kind === "shield").sort((a, b) => b.shield - a.shield)[0];
  if (!hull || !weapon) return { existing: empire.designs.find((d) => d.id === "frigate") ?? null, create: null };
  const weapons = Math.max(1, Math.ceil(hull.slots * 0.6));
  const components: string[] = Array.from({ length: weapons }, () => weapon.id);
  for (let i = weapons; i < hull.slots; i++) components.push(shield && i % 2 === 1 ? shield.id : (armor?.id ?? weapon.id));
  const same = (d: ShipDesign) => !d.obsolete && d.hull === hull.id && d.components.join() === components.join();
  const existing = empire.designs.find(same);
  if (existing) return { existing, create: null };
  const mark = empire.designs.filter((d) => d.name.startsWith(WARSHIP_PREFIX)).length + 1;
  const fallback = empire.designs.filter((d) => !d.obsolete && d.name.startsWith(WARSHIP_PREFIX)).at(-1) ?? empire.designs.find((d) => d.id === "frigate") ?? null;
  return { existing: fallback, create: makeCreate({ name: `${WARSHIP_PREFIX}${mark}`, hull: hull.id, components, formation: "front" }) };
}

function makeCreate(design: { name: string; hull: string; components: string[]; formation: "front" | "screen" | "support" }) {
  return design;
}

function choosePick(
  state: GameState,
  pack: ContentPack,
  empireId: EmpireId,
  colony: Colony,
  options: ReturnType<typeof buildOptions>,
  wants: { upkeepRoom: number; warshipId: string | null; wantColonyShip: boolean; wantScout: boolean },
): ReturnType<typeof buildOptions>[number] | null {
  const empire = state.empires[empireId]!;
  const fx = empireEffects(pack, empire);
  const shipRole = (id: string) => {
    const design = empire.designs.find((d) => d.id === id);
    return design ? designStats(pack, design, fx) : null;
  };
  if (wants.warshipId && options.some((o) => o.kind === "ship" && o.id === wants.warshipId)) return { kind: "ship", id: wants.warshipId };
  if (wants.wantColonyShip) {
    const ship = options.find((o) => o.kind === "ship" && shipRole(o.id)?.colonize);
    if (ship) return ship;
  }
  if (wants.wantScout) {
    const scout = options.find((o) => o.kind === "ship" && shipRole(o.id)?.role === "recon");
    if (scout) return scout;
  }
  // Cheapest building the treasury can carry; small colonies skip expensive ones.
  const buildings = options
    .filter((o) => o.kind === "building")
    .map((o) => ({ o, cost: pack.buildings.find((b) => b.id === o.id)!.cost, upkeep: pack.buildings.find((b) => b.id === o.id)!.upkeep }))
    .filter((b) => colony.population >= 3 || b.cost <= 40)
    .filter((b) => b.upkeep <= wants.upkeepRoom)
    .sort((a, b) => a.cost - b.cost);
  return buildings[0]?.o ?? null;
}
