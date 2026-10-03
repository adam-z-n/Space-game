import type { ContentPack } from "../content/schema";
import type { Command } from "./commands";
import { availableTechs, buildOptions, buyCost, colonizeBlocker, getShipTemplate, prospectiveMaxPop } from "./economy";
import { buildAdjacency, shortestPaths } from "./graph";
import { colonyOnBody, type Colony, type EmpireId, type Fleet, type GameState, type SystemId } from "./state";

/**
 * Placeholder AI for M3: explore with scouts, research the cheapest tech,
 * expand with colony ships, and fill build queues with simple priorities.
 * It reads only what its empire knows (explored systems, its own sightings)
 * and issues ordinary commands. The real strategic/operational AI is M5.
 */
export function planAiTurn(state: GameState, pack: ContentPack, empireId: EmpireId): Command[] {
  const empire = state.empires[empireId]!;
  const adj = buildAdjacency(state.galaxy.systems.length, state.galaxy.lanes);
  const explored = new Set(empire.explored);
  const commands: Command[] = [];
  const myFleets = state.fleets.filter((f) => f.empireId === empireId).sort((a, b) => a.id - b.id);
  const myColonies = state.colonies.filter((c) => c.empireId === empireId).sort((a, b) => a.id - b.id);
  const role = (f: Fleet) => getShipTemplate(pack, f.templateId);

  // Research: cheapest available, ties by pack order.
  if (empire.research.current === null) {
    const options = availableTechs(pack, empire).sort((a, b) => a.cost - b.cost);
    if (options[0]) commands.push({ type: "setResearch", empireId, techId: options[0].id });
  }

  // Colonization targets: explored planets we could settle that nobody we know of holds.
  const knownTaken = new Set(empire.colonySightings.map((c) => c.bodyId));
  const targets: { systemId: SystemId; bodyId: number; value: number }[] = [];
  for (const systemId of empire.explored) {
    for (const body of state.galaxy.systems[systemId]!.bodies) {
      if (colonizeBlocker(pack, empire, body) !== null || knownTaken.has(body.id)) continue;
      const mine = colonyOnBody(state, body.id)?.empireId === empireId;
      if (!mine) targets.push({ systemId, bodyId: body.id, value: prospectiveMaxPop(pack, empire, body) });
    }
  }
  const claimed = new Set<number>();
  for (const fleet of myFleets) {
    if (role(fleet).colonize && fleet.route.length > 0) {
      const dest = fleet.route[fleet.route.length - 1]!;
      const target = targets.find((t) => t.systemId === dest && !claimed.has(t.bodyId));
      if (target) claimed.add(target.bodyId);
    }
  }

  // Exploration targets already claimed by moving scouts.
  const scouting = new Set<SystemId>();
  for (const fleet of myFleets) if (role(fleet).role === "recon" && fleet.route.length > 0) scouting.add(fleet.route[fleet.route.length - 1]!);

  for (const fleet of myFleets) {
    if (fleet.route.length > 0) continue;
    const template = role(fleet);
    const { dist } = shortestPaths(adj, fleet.systemId);

    if (template.colonize) {
      // Settle here if there's a target in this system (and our colonize wouldn't fail), else head for the best nearby one.
      const here = targets
        .filter((t) => t.systemId === fleet.systemId && !claimed.has(t.bodyId) && !colonyOnBody(state, t.bodyId))
        .sort((a, b) => b.value - a.value || a.bodyId - b.bodyId)[0];
      if (here) {
        claimed.add(here.bodyId);
        commands.push({ type: "colonize", empireId, fleetId: fleet.id, bodyId: here.bodyId });
        continue;
      }
      // Score: value per distance. Integer math keeps it deterministic.
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

    if (template.role === "recon") {
      let target = -1;
      for (let i = 0; i < dist.length; i++) {
        if (explored.has(i) || scouting.has(i) || dist[i] === Infinity) continue;
        if (target === -1 || dist[i]! < dist[target]!) target = i;
      }
      if (target !== -1) {
        scouting.add(target);
        commands.push({ type: "moveFleet", empireId, fleetId: fleet.id, destinationId: target });
      }
    }
    // Warships wait at home until combat exists (M4).
  }

  // Production: one decision per idle queue.
  const colonyShips = myFleets.filter((f) => role(f).colonize).length;
  let queuedColonyShips = myColonies.reduce((n, c) => n + c.queue.filter((q) => q.kind === "ship" && getShipTemplate(pack, q.id).colonize).length, 0);
  const scouts = myFleets.filter((f) => role(f).role === "recon").length;
  const unexplored = state.galaxy.systems.length - empire.explored.length;
  const openTargets = targets.filter((t) => !claimed.has(t.bodyId)).length;

  for (const colony of myColonies) {
    if (colony.queue.length > 0) continue;
    const options = buildOptions(pack, empire, colony);
    const pick = choosePick(pack, colony, options, {
      wantColonyShip: colonyShips + queuedColonyShips < Math.min(2, openTargets) && colony.population >= 3,
      wantScout: scouts < 2 && unexplored > 0 && colony.capital,
    });
    if (pick) {
      if (pick.kind === "ship" && getShipTemplate(pack, pick.id).colonize) queuedColonyShips++;
      commands.push({ type: "queueBuild", empireId, colonyId: colony.id, item: pick });
    }
  }

  // Spend surplus credits finishing builds, keeping a reserve. Capital first, then by id.
  let spendable = empire.credits - 60;
  for (const colony of [...myColonies].sort((a, b) => Number(b.capital) - Number(a.capital) || a.id - b.id)) {
    const queued = colony.queue.length > 0 || commands.some((c) => c.type === "queueBuild" && c.colonyId === colony.id);
    if (!queued || colony.queue.length === 0) continue;
    const cost = buyCost(pack, colony);
    if (cost !== null && cost <= spendable) {
      spendable -= cost;
      commands.push({ type: "buyBuild", empireId, colonyId: colony.id });
    }
  }
  return commands;
}

function choosePick(
  pack: ContentPack,
  colony: Colony,
  options: ReturnType<typeof buildOptions>,
  wants: { wantColonyShip: boolean; wantScout: boolean },
): ReturnType<typeof buildOptions>[number] | null {
  if (wants.wantColonyShip) {
    const ship = options.find((o) => o.kind === "ship" && getShipTemplate(pack, o.id).colonize);
    if (ship) return ship;
  }
  if (wants.wantScout) {
    const scout = options.find((o) => o.kind === "ship" && getShipTemplate(pack, o.id).role === "recon");
    if (scout) return scout;
  }
  // Cheapest building first; small colonies skip expensive ones.
  const buildings = options
    .filter((o) => o.kind === "building")
    .map((o) => ({ o, cost: pack.buildings.find((b) => b.id === o.id)!.cost }))
    .filter((b) => colony.population >= 3 || b.cost <= 40)
    .sort((a, b) => a.cost - b.cost);
  return buildings[0]?.o ?? null;
}
