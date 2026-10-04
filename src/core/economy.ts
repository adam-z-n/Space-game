import type { ContentPack, Effects } from "../content/schema";
import type { Colony, Empire, EmpireId, Focus, GameEvent, GameState, QueueItem, StarSystem } from "./state";
import { colonyOnBody, getSystem } from "./state";
import { designBuildable, designStats, getDesign, newFleet, refreshFleetStats } from "./ships";

/**
 * Colonies, production, research, food, credits and growth.
 * Integer math only, with floors applied in a fixed order, so every device agrees.
 * The UI calls the same functions to show forecasts, so what it shows is what happens.
 */

type Body = StarSystem["bodies"][number];
type Building = ContentPack["buildings"][number];
type Tech = ContentPack["techs"][number];

const EFFECT_KEYS = [
  "industry",
  "research",
  "food",
  "credits",
  "industryPercent",
  "researchPercent",
  "foodPercent",
  "creditsPercent",
  "growthPercent",
  "maxPop",
  "maxPopPercent",
  "minHabitability",
  "speed",
  "sensorRange",
  "supplyRange",
  "endurance",
  "damagePercent",
  "groundPercent",
  "defensePercent",
] as const;
export type Totals = Record<(typeof EFFECT_KEYS)[number], number>;

function sumEffects(list: readonly Effects[]): Totals {
  const total = Object.fromEntries(EFFECT_KEYS.map((k) => [k, 0])) as Totals;
  for (const effects of list) for (const key of EFFECT_KEYS) total[key] += effects[key] ?? 0;
  return total;
}

export function getTech(pack: ContentPack, id: string): Tech {
  const tech = pack.techs.find((t) => t.id === id);
  if (!tech) throw new Error(`unknown tech "${id}"`);
  return tech;
}

export function getBuilding(pack: ContentPack, id: string): Building {
  const building = pack.buildings.find((b) => b.id === id);
  if (!building) throw new Error(`unknown building "${id}"`);
  return building;
}

/** Species traits and difficulty bonuses: the empire-wide effects that don't come from research. */
function innateEffects(pack: ContentPack, empire: Empire): Effects[] {
  const species = pack.species.find((s) => s.id === empire.species)?.effects;
  const difficulty = empire.difficulty ? pack.difficulties.find((d) => d.id === empire.difficulty)?.effects : undefined;
  return [...(species ? [species] : []), ...(difficulty ? [difficulty] : [])];
}

/** Empire-wide modifiers: researched techs, species traits, and difficulty bonuses for AI empires. */
export function empireEffects(pack: ContentPack, empire: Empire): Totals {
  return sumEffects([...empire.techs.map((id) => getTech(pack, id).effects), ...innateEffects(pack, empire)]);
}

/** Modifiers acting on one colony: its buildings plus the empire's techs. */
export function colonyEffects(pack: ContentPack, empire: Empire, colony: Colony): Totals {
  return sumEffects([
    ...empire.techs.map((id) => getTech(pack, id).effects),
    ...colony.buildings.map((id) => getBuilding(pack, id).effects),
    ...innateEffects(pack, empire),
  ]);
}

const pct = (value: number, percent: number) => Math.floor((value * (100 + percent)) / 100);

export function findBody(state: GameState, systemId: number, bodyId: number): Body | undefined {
  return getSystem(state, systemId).bodies.find((b) => b.id === bodyId);
}

export function planetStats(pack: ContentPack, body: Body) {
  const type = pack.planetTypes.find((t) => t.id === body.planetType);
  const size = pack.planetSizes.find((s) => s.id === body.size);
  const richness = pack.richness.find((r) => r.id === body.richness);
  return {
    habitability: type?.habitability ?? 0,
    foodYield: type?.foodYield ?? 0,
    capacity: size?.capacity ?? 0,
    yieldPercent: richness?.yieldPercent ?? 100,
    groundDefense: type?.groundDefensePercent ?? 0,
  };
}

/** Why `empire` can't colonize `body`, or null if it can (ignoring who is there). */
export function colonizeBlocker(pack: ContentPack, empire: Empire, body: Body): string | null {
  if (body.kind !== "planet") return "only planets can be colonized";
  const minimum = pack.economy.minHabitability + empireEffects(pack, empire).minHabitability;
  if (planetStats(pack, body).habitability < minimum) return `too hostile (needs habitability ${minimum})`;
  return null;
}

export function maxPopulation(pack: ContentPack, body: Body, effects: Totals): number {
  const { capacity, habitability } = planetStats(pack, body);
  const base = Math.floor((capacity * habitability * (100 + effects.maxPopPercent)) / 10000);
  return Math.max(1, base) + effects.maxPop;
}

/** Population the colony could reach if it were founded now (for colonization choices). */
export function prospectiveMaxPop(pack: ContentPack, empire: Empire, body: Body): number {
  return maxPopulation(pack, body, empireEffects(pack, empire));
}

export interface Workers {
  farmers: number;
  industry: number;
  research: number;
}

/** Assign workers from a focus: feed the colony first (if the planet can), then follow the focus. */
export function allocateWorkers(population: number, focus: Focus, foodYield: number, foodPerPop: number): Workers {
  if (focus === "food") return foodYield > 0 ? { farmers: population, industry: 0, research: 0 } : { farmers: 0, industry: population, research: 0 };
  const farmers = foodYield > 0 ? Math.min(population, Math.ceil((population * foodPerPop) / foodYield)) : 0;
  const rest = population - farmers;
  switch (focus) {
    case "industry":
      return { farmers, industry: rest, research: 0 };
    case "research":
      return { farmers, industry: 0, research: rest };
    case "balanced":
      return { farmers, industry: Math.ceil(rest / 2), research: Math.floor(rest / 2) };
  }
}

export interface ColonyOutput {
  workers: Workers;
  industry: number;
  research: number;
  food: number;
  /** Food this colony eats. */
  foodEaten: number;
  credits: number;
  upkeep: number;
  maxPop: number;
  /** Growth points this turn (before starvation). */
  growth: number;
}

export function colonyOutput(state: GameState, pack: ContentPack, colony: Colony): ColonyOutput {
  const empire = state.empires[colony.empireId]!;
  const body = findBody(state, colony.systemId, colony.bodyId)!;
  const stats = planetStats(pack, body);
  const fx = colonyEffects(pack, empire, colony);
  const eco = pack.economy;
  const pop = colony.population;
  const workers = allocateWorkers(pop, colony.focus, stats.foodYield, eco.foodPerPop);
  const debt = empire.credits < 0 ? eco.debtPenaltyPercent : 0;

  const rawIndustry = Math.floor((workers.industry * eco.workerIndustry * stats.yieldPercent) / 100) + eco.colonyBaseIndustry + fx.industry;
  const rawResearch = workers.research * eco.workerResearch + fx.research;
  const industry = Math.max(0, pct(pct(rawIndustry, fx.industryPercent), -debt));
  const research = Math.max(0, pct(pct(rawResearch, fx.researchPercent), -debt));
  const food = Math.max(0, pct(workers.farmers * stats.foodYield + fx.food, fx.foodPercent));
  const credits = colony.blockaded ? 0 : Math.max(0, pct(Math.floor((pop * eco.taxPercentPerPop) / 100) + fx.credits, fx.creditsPercent));
  const upkeep = colony.buildings.reduce((sum, id) => sum + getBuilding(pack, id).upkeep, 0);
  const maxPop = maxPopulation(pack, body, fx);
  const growth = pop >= maxPop ? 0 : pct(eco.growthBase + Math.floor((pop * (maxPop - pop) * eco.growthRate) / maxPop), fx.growthPercent);

  return { workers, industry, research, food, foodEaten: pop * eco.foodPerPop, credits, upkeep, maxPop, growth };
}

export interface EmpireEconomy {
  industry: number;
  research: number;
  foodProduced: number;
  foodEaten: number;
  income: number;
  buildingUpkeep: number;
  shipUpkeep: number;
  /** Industry converted to credits by colonies with empty queues. */
  idleCredits: number;
  /** Net credits per turn. */
  netCredits: number;
  netFood: number;
}

export function empireEconomy(state: GameState, pack: ContentPack, empireId: EmpireId): EmpireEconomy {
  const totals: EmpireEconomy = {
    industry: 0,
    research: 0,
    foodProduced: 0,
    foodEaten: 0,
    income: 0,
    buildingUpkeep: 0,
    shipUpkeep: 0,
    idleCredits: 0,
    netCredits: 0,
    netFood: 0,
  };
  for (const colony of state.colonies) {
    if (colony.empireId !== empireId) continue;
    const out = colonyOutput(state, pack, colony);
    totals.industry += out.industry;
    totals.research += out.research;
    totals.foodProduced += out.food;
    totals.foodEaten += out.foodEaten;
    totals.income += out.credits;
    totals.buildingUpkeep += out.upkeep;
    if (colony.queue.length === 0) totals.idleCredits += Math.floor((out.industry * pack.economy.idleIndustryCreditsPercent) / 100);
  }
  const empire = state.empires[empireId]!;
  const fx = empireEffects(pack, empire);
  for (const fleet of state.fleets) {
    if (fleet.empireId !== empireId) continue;
    for (const ship of fleet.ships) totals.shipUpkeep += designStats(pack, getDesign(empire, ship.designId), fx).upkeep;
  }
  totals.netCredits = totals.income + totals.idleCredits - totals.buildingUpkeep - totals.shipUpkeep;
  totals.netFood = totals.foodProduced - totals.foodEaten;
  return totals;
}

// ---------- availability ----------

export function techAvailable(pack: ContentPack, empire: Empire, techId: string): boolean {
  const tech = pack.techs.find((t) => t.id === techId);
  return !!tech && !empire.techs.includes(techId) && tech.requires.every((r) => empire.techs.includes(r));
}

export function availableTechs(pack: ContentPack, empire: Empire): Tech[] {
  return pack.techs.filter((t) => techAvailable(pack, empire, t.id));
}

/** Ship queue items name one of the owning empire's designs. */
export function itemCost(pack: ContentPack, empire: Empire, item: QueueItem): number {
  if (item.kind === "colonyBase") return pack.economy.colonyBaseCost;
  return item.kind === "building" ? getBuilding(pack, item.id).cost : designStats(pack, getDesign(empire, item.id), empireEffects(pack, empire)).cost;
}

export function itemName(pack: ContentPack, empire: Empire, item: QueueItem, state?: GameState, systemId?: number): string {
  if (item.kind === "colonyBase") {
    const target = state && systemId !== undefined ? ` on ${bodyName(getSystem(state, systemId), item.bodyId!)}` : "";
    return `Colony Base${target}`;
  }
  return item.kind === "building" ? getBuilding(pack, item.id).name : getDesign(empire, item.id).name;
}

/** Why `item` can't be added to `colony`'s queue, or null. */
export function buildBlocker(state: GameState, pack: ContentPack, empire: Empire, colony: Colony, item: QueueItem): string | null {
  if (item.kind === "colonyBase") {
    const body = item.bodyId === undefined ? undefined : findBody(state, colony.systemId, item.bodyId);
    if (!body) return "no such planet in this system";
    if (colonyOnBody(state, body.id)) return "planet already colonized";
    const blocker = colonizeBlocker(pack, empire, body);
    if (blocker) return blocker;
    const queued = state.colonies.some((c) => c.empireId === empire.id && c.queue.some((q) => q.kind === "colonyBase" && q.bodyId === body.id));
    return queued ? "already queued" : null;
  }
  if (item.kind === "building") {
    const building = pack.buildings.find((b) => b.id === item.id);
    if (!building || !building.buildable) return "unknown building";
    if (building.requires && !empire.techs.includes(building.requires)) return `needs ${building.requires}`;
    if (colony.buildings.includes(item.id) || colony.queue.some((q) => q.kind === "building" && q.id === item.id)) return "already built or queued";
    return null;
  }
  const design = empire.designs.find((d) => d.id === item.id);
  if (!design) return "unknown design";
  if (!designBuildable(pack, empire, design)) return "design is obsolete or needs research";
  return null;
}

export function buildOptions(state: GameState, pack: ContentPack, empire: Empire, colony: Colony): QueueItem[] {
  const items: QueueItem[] = [
    ...getSystem(state, colony.systemId).bodies.map((b) => ({ kind: "colonyBase" as const, id: "colony_base", bodyId: b.id })),
    ...pack.buildings.map((b) => ({ kind: "building" as const, id: b.id })),
    ...empire.designs.map((d) => ({ kind: "ship" as const, id: d.id })),
  ];
  return items.filter((item) => buildBlocker(state, pack, empire, colony, item) === null);
}

/** Credits to finish the colony's current build this turn, or null if there's nothing to buy. */
export function buyCost(pack: ContentPack, empire: Empire, colony: Colony): number | null {
  const item = colony.queue[0];
  if (!item) return null;
  const remaining = itemCost(pack, empire, item) - colony.progress;
  return remaining > 0 ? remaining * pack.economy.buyCreditsPerIndustry : null;
}

/** Turns until each queue item completes at the colony's current industry (Infinity if no industry). */
export function queueForecast(state: GameState, pack: ContentPack, colony: Colony): number[] {
  const industry = colonyOutput(state, pack, colony).industry;
  const empire = state.empires[colony.empireId]!;
  const invested = colony.progress;
  let needed = 0;
  return colony.queue.map((item) => {
    needed += itemCost(pack, empire, item);
    if (industry <= 0) return Infinity;
    return Math.max(1, Math.ceil((needed - invested) / industry));
  });
}

// ---------- fleets ----------

export function refreshEmpireStats(state: GameState, pack: ContentPack, empire: Empire): void {
  const fx = empireEffects(pack, empire);
  empire.capitalSensorRange = pack.economy.capitalSensorRange + fx.sensorRange;
  empire.colonySensorRange = pack.economy.colonySensorRange + fx.sensorRange;
  for (const fleet of state.fleets) if (fleet.empireId === empire.id) refreshFleetStats(pack, state, fleet);
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function bodyName(system: StarSystem, bodyId: number): string {
  const index = system.bodies.findIndex((b) => b.id === bodyId);
  return `${system.name} ${ROMAN[index] ?? index + 1}`;
}

export function newColony(state: GameState, empire: Empire, systemId: number, bodyId: number, population: number, capital: boolean): Colony {
  return {
    id: state.nextId++,
    empireId: empire.id,
    systemId,
    bodyId,
    name: bodyName(getSystem(state, systemId), bodyId),
    capital,
    population,
    growth: 0,
    focus: "balanced",
    buildings: [],
    queue: [],
    progress: 0,
    blockaded: false,
    defenseHp: 0,
    troops: 0,
  };
}

// ---------- turn resolution ----------

export function resolveEconomy(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const turn = state.turn;
  const eco = pack.economy;
  for (const empire of state.empires) {
    if (empire.eliminated) continue;
    const colonies = state.colonies.filter((c) => c.empireId === empire.id).sort((a, b) => a.id - b.id);
    // Compute every output before changing anything, so order within the empire doesn't matter.
    const outputs = colonies.map((colony) => colonyOutput(state, pack, colony));
    const summary = empireEconomy(state, pack, empire.id);

    // Production.
    colonies.forEach((colony, i) => {
      const industry = outputs[i]!.industry;
      if (colony.queue.length === 0) return;
      colony.progress += industry;
      while (colony.queue.length > 0) {
        const item = colony.queue[0]!;
        const cost = itemCost(pack, empire, item);
        if (colony.progress < cost) break;
        colony.progress -= cost;
        colony.queue.shift();
        if (item.kind === "colonyBase") {
          // The target may have been taken (or become unreachable) since it was queued.
          const body = findBody(state, colony.systemId, item.bodyId!);
          if (body && !colonyOnBody(state, body.id) && colonizeBlocker(pack, empire, body) === null) {
            const founded = newColony(state, empire, colony.systemId, body.id, pack.economy.colonyPopulation, false);
            state.colonies.push(founded);
            events.push({ type: "colonyFounded", turn, empireId: empire.id, colonyId: founded.id, systemId: colony.systemId });
          }
        } else if (item.kind === "building") {
          colony.buildings.push(item.id);
          events.push({ type: "buildingCompleted", turn, empireId: empire.id, colonyId: colony.id, systemId: colony.systemId, buildingId: item.id });
        } else {
          const fleet = newFleet(state, pack, empire, [item.id], colony.systemId);
          state.fleets.push(fleet);
          events.push({ type: "shipCompleted", turn, empireId: empire.id, colonyId: colony.id, systemId: colony.systemId, fleetId: fleet.id });
        }
      }
      if (colony.queue.length === 0) colony.progress = 0;
    });

    // Credits.
    empire.credits += summary.netCredits;
    if (empire.credits < 0) events.push({ type: "inDebt", turn, empireId: empire.id, credits: empire.credits });

    // Food.
    empire.food = Math.min(eco.foodStockCap, empire.food + summary.netFood);
    const starving = empire.food < 0;
    if (starving) {
      empire.food = 0;
      events.push({ type: "starvation", turn, empireId: empire.id });
    }

    // Research.
    empire.research.progress += summary.research;
    const current = empire.research.current;
    if (current !== null) {
      const cost = getTech(pack, current).cost;
      if (empire.research.progress >= cost) {
        empire.research.progress -= cost;
        empire.techs.push(current);
        empire.research.current = null;
        refreshEmpireStats(state, pack, empire);
        events.push({ type: "techResearched", turn, empireId: empire.id, techId: current });
      }
    }

    // Growth.
    colonies.forEach((colony, i) => {
      const out = outputs[i]!;
      if (starving) {
        colony.growth -= eco.starvationLoss;
        if (colony.growth < 0) {
          if (colony.population > 1) {
            colony.population -= 1;
            colony.growth += eco.growthThreshold;
          } else {
            colony.growth = 0;
          }
        }
        return;
      }
      if (colony.population >= out.maxPop) {
        colony.growth = 0;
        return;
      }
      colony.growth += out.growth;
      if (colony.growth >= eco.growthThreshold) {
        colony.growth -= eco.growthThreshold;
        colony.population += 1;
        if (colony.population >= out.maxPop) colony.growth = 0;
        events.push({ type: "populationGrew", turn, empireId: empire.id, colonyId: colony.id, systemId: colony.systemId, population: colony.population });
      }
    });
  }
}

/** Names of the buildings, components and hulls a tech unlocks, for the research screens. */
export function techUnlocks(pack: ContentPack, techId: string): { buildings: string[]; components: string[]; hulls: string[] } {
  return {
    buildings: pack.buildings.filter((b) => b.requires === techId).map((b) => b.id),
    components: pack.components.filter((c) => c.requires === techId).map((c) => c.id),
    hulls: pack.hulls.filter((h) => h.requires === techId).map((h) => h.id),
  };
}

/** The empire's colonies that could add `buildingId` to their queue right now (not built, not queued). */
export function coloniesMissing(state: GameState, pack: ContentPack, empireId: EmpireId, buildingId: string): Colony[] {
  const empire = state.empires[empireId]!;
  return state.colonies
    .filter((c) => c.empireId === empireId && c.queue.length < 10 && buildBlocker(state, pack, empire, c, { kind: "building", id: buildingId }) === null)
    .sort((a, b) => a.id - b.id);
}
