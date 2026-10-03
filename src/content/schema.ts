import { z } from "zod";

/**
 * Content pack schema. A theme is a content pack over the fixed rules engine:
 * everything here is data, validated when the pack loads.
 */

const id = z.string().regex(/^[a-z][a-zA-Z0-9_-]*$/, "ids are lowercase-first identifiers");
const weight = z.number().int().nonnegative();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colors are #rrggbb");

export const BODY_KINDS = ["planet", "asteroids", "gasGiant", "anomaly"] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

const GalaxySize = z.object({
  id,
  name: z.string().min(1),
  systems: z.number().int().min(8).max(200),
  /** Half-width and half-height of the elliptical galaxy, in distance units. */
  radiusX: z.number().int().positive(),
  radiusY: z.number().int().positive(),
  /** Minimum distance between two stars. */
  minStarDistance: z.number().int().positive(),
});

const StarType = z.object({
  id,
  name: z.string().min(1),
  color,
  weight,
  minBodies: z.number().int().min(0).max(5),
  maxBodies: z.number().int().min(0).max(5),
});

const PlanetType = z.object({
  id,
  name: z.string().min(1),
  /** Base habitability 0-100 for a typical species; species traits will modify this later. */
  habitability: z.number().int().min(0).max(100),
  /** Food produced per farmer. 0 means colonies here can't feed themselves. */
  foodYield: z.number().int().nonnegative(),
  weight,
});

const PlanetSize = z.object({
  id,
  name: z.string().min(1),
  /** Relative population capacity. */
  capacity: z.number().int().positive(),
  weight,
});

const Richness = z.object({
  id,
  name: z.string().min(1),
  /** Yield multiplier in percent (100 = normal). */
  yieldPercent: z.number().int().positive(),
  weight,
});

const EmpireTemplate = z.object({
  name: z.string().min(1),
  color,
});

/**
 * Modifiers granted by buildings (to their colony) and techs (to every colony
 * or the whole empire). Flat yields are per colony; percents stack additively.
 */
export const EffectsSchema = z
  .object({
    industry: z.number().int(),
    research: z.number().int(),
    food: z.number().int(),
    credits: z.number().int(),
    industryPercent: z.number().int(),
    researchPercent: z.number().int(),
    foodPercent: z.number().int(),
    creditsPercent: z.number().int(),
    growthPercent: z.number().int(),
    /** Flat max population. */
    maxPop: z.number().int(),
    maxPopPercent: z.number().int(),
    /** Change to the minimum habitability a planet needs to be colonized (negative = more planets). */
    minHabitability: z.number().int(),
    /** Added to every ship's speed. */
    speed: z.number().int(),
    /** Added to every ship's and colony's sensor range. */
    sensorRange: z.number().int(),
    /** Added to the supply range of every colony (lane distance). */
    supplyRange: z.number().int(),
    /** Added to every ship's endurance (turns of onboard supply). */
    endurance: z.number().int(),
    /** Added to every weapon's damage, in percent. */
    damagePercent: z.number().int(),
  })
  .partial()
  .strict();
export type Effects = z.infer<typeof EffectsSchema>;

export const SHIP_ROLES = ["combat", "transport", "recon", "support"] as const;
export type ShipRole = (typeof SHIP_ROLES)[number];
/** Who takes fire first: front line ships are targeted most, support least. */
export const FORMATIONS = ["front", "screen", "support"] as const;
export type Formation = (typeof FORMATIONS)[number];

const Hull = z.object({
  id,
  name: z.string().min(1),
  description: z.string(),
  slots: z.number().int().min(1).max(12),
  /** Hit points before armor. */
  structure: z.number().int().positive(),
  cost: z.number().int().positive(),
  /** Credits per turn. */
  upkeep: z.number().int().nonnegative(),
  speed: z.number().int().positive(),
  sensorRange: z.number().int().nonnegative(),
  /** Percent subtracted from enemy hit chance. */
  evasion: z.number().int().min(0).max(90),
  /** Turns a ship can operate outside supply. */
  endurance: z.number().int().nonnegative(),
  requires: id.optional(),
});

export const COMPONENT_KINDS = ["weapon", "armor", "shield", "engine", "sensor", "colony", "fuel"] as const;

const Component = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(COMPONENT_KINDS),
  description: z.string(),
  cost: z.number().int().nonnegative(),
  /** Weapons: damage per hit and percent chance to hit. */
  damage: z.number().int().nonnegative().default(0),
  accuracy: z.number().int().min(0).max(100).default(0),
  /** Armor: extra hit points. */
  hp: z.number().int().nonnegative().default(0),
  /** Shields: damage blocked per hit. */
  shield: z.number().int().nonnegative().default(0),
  speed: z.number().int().nonnegative().default(0),
  sensorRange: z.number().int().nonnegative().default(0),
  /** Fuel: extra turns of supply for the whole fleet. */
  fuel: z.number().int().nonnegative().default(0),
  requires: id.optional(),
});

const Design = z.object({
  id,
  name: z.string().min(1),
  hull: id,
  components: z.array(id),
  formation: z.enum(FORMATIONS),
});
export type DesignData = z.infer<typeof Design>;

const Building = z.object({
  id,
  name: z.string().min(1),
  description: z.string(),
  cost: z.number().int().positive(),
  upkeep: z.number().int().nonnegative(),
  effects: EffectsSchema,
  requires: id.optional(),
  /** Only granted to capitals at game start, never built. */
  buildable: z.boolean().default(true),
});

const Tech = z.object({
  id,
  name: z.string().min(1),
  field: id,
  description: z.string(),
  cost: z.number().int().positive(),
  requires: z.array(id).default([]),
  effects: EffectsSchema.default({}),
});

const ResearchField = z.object({ id, name: z.string().min(1) });

const Combat = z.object({
  rounds: z.number().int().positive(),
  /** Damage dealt and taken, in percent, by stance. */
  stanceDamage: z.object({ aggressive: z.number().int(), balanced: z.number().int(), cautious: z.number().int() }),
  stanceDefense: z.object({ aggressive: z.number().int(), balanced: z.number().int(), cautious: z.number().int() }),
  /** Relative chance each formation is picked as a target. */
  formationWeight: z.object({ front: z.number().int().positive(), screen: z.number().int().positive(), support: z.number().int().positive() }),
  /** Damage penalty, in percent, for fleets out of supply. */
  outOfSupplyDamagePercent: z.number().int().min(0).max(100),
  /** Speed penalty, in percent, for fleets out of supply. */
  outOfSupplySpeedPercent: z.number().int().min(0).max(100),
  /** Hit points lost per turn (percent of max) while out of supply. */
  attritionPercent: z.number().int().min(0).max(100),
  /** Hit points repaired per turn (percent of max): in supply, and at a friendly colony. */
  repairPercent: z.number().int().min(0).max(100),
  dockRepairPercent: z.number().int().min(0).max(100),
});

const scale = z.number().int().min(0).max(10);

/** An AI temperament: data, not code, so themes can ship their own rivals. */
const Personality = z.object({
  id,
  name: z.string().min(1),
  description: z.string(),
  /** Appetites on a 0-10 scale. */
  expansion: scale,
  military: scale,
  research: scale,
  economy: scale,
  /** Willingness to start fights and hit rival colonies. */
  aggression: scale,
  /** Higher = needs better odds, retreats sooner. */
  caution: scale,
  /** Garrisons colonies and holds chokepoints. */
  defense: scale,
  /** raider: small fast hulls; line: balanced warships; fortress: heavy armor and shields. */
  designStyle: z.enum(["raider", "line", "fortress"]),
  /** Weight per research field id (missing fields count as 1). */
  researchFields: z.record(z.string(), z.number().int().min(0).max(10)),
});
export type PersonalityData = z.infer<typeof Personality>;

const Difficulty = z.object({
  id,
  name: z.string().min(1),
  description: z.string(),
  /** Applied to AI empires only. */
  effects: EffectsSchema,
});

const Victory = z.object({
  /** The game ends after this many turns; highest score wins. */
  turnLimit: z.number().int().positive(),
  /** Holding this share of all population wins outright... */
  dominationPercent: z.number().int().min(1).max(100),
  /** ...once the game has run this long. */
  dominationMinTurn: z.number().int().nonnegative(),
  score: z.object({
    population: z.number().int().nonnegative(),
    colony: z.number().int().nonnegative(),
    tech: z.number().int().nonnegative(),
    /** Points per 10 strength of warships. */
    military: z.number().int().nonnegative(),
  }),
});

const Economy = z.object({
  startingCredits: z.number().int(),
  startingFood: z.number().int().nonnegative(),
  capitalPopulation: z.number().int().positive(),
  colonyPopulation: z.number().int().positive(),
  /** Credits per population per turn, in percent (50 = half a credit per population). */
  taxPercentPerPop: z.number().int().nonnegative(),
  /** Food eaten per population per turn. */
  foodPerPop: z.number().int().nonnegative(),
  workerIndustry: z.number().int().nonnegative(),
  /** Industry every colony makes regardless of workers, so new colonies can build. */
  colonyBaseIndustry: z.number().int().nonnegative(),
  workerResearch: z.number().int().nonnegative(),
  /** Growth points needed for one population. */
  growthThreshold: z.number().int().positive(),
  /** Growth points every colony below max gets per turn. */
  growthBase: z.number().int().nonnegative(),
  /** Scales logistic growth: pop * (max - pop) * rate / max. */
  growthRate: z.number().int().nonnegative(),
  /** Growth points lost per turn while the empire is starving. */
  starvationLoss: z.number().int().nonnegative(),
  /** Planets below this habitability can't be colonized. */
  minHabitability: z.number().int().min(0).max(100),
  colonySensorRange: z.number().int().nonnegative(),
  /** Lane distance within which colonies supply fleets. */
  colonySupplyRange: z.number().int().nonnegative(),
  capitalSupplyRange: z.number().int().nonnegative(),
  capitalSensorRange: z.number().int().nonnegative(),
  foodStockCap: z.number().int().nonnegative(),
  /** Share of industry turned into credits when a colony has nothing to build. */
  idleIndustryCreditsPercent: z.number().int().min(0).max(100),
  /** Credits per point of industry when buying the rest of a build outright. */
  buyCreditsPerIndustry: z.number().int().positive(),
  /** Industry and research lost while the treasury is negative. */
  debtPenaltyPercent: z.number().int().min(0).max(100),
});

const StartingFleet = z.object({
  /** Design ids from startingDesigns; each becomes one ship. */
  ships: z.array(id).min(1),
});

export const ContentPackSchema = z
  .object({
    id,
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    galaxySizes: z.array(GalaxySize).min(1),
    starTypes: z.array(StarType).min(1),
    bodyKindWeights: z.object({
      planet: weight,
      asteroids: weight,
      gasGiant: weight,
      anomaly: weight,
    }),
    planetTypes: z.array(PlanetType).min(1),
    planetSizes: z.array(PlanetSize).min(1),
    richness: z.array(Richness).min(1),
    systemNames: z.array(z.string().min(1)).min(1),
    empires: z.array(EmpireTemplate).min(6),
    economy: Economy,
    researchFields: z.array(ResearchField).min(1),
    techs: z.array(Tech),
    buildings: z.array(Building),
    combat: Combat,
    victory: Victory,
    aiPersonalities: z.array(Personality).min(1),
    difficulties: z.array(Difficulty).min(1),
    hulls: z.array(Hull).min(1),
    components: z.array(Component).min(1),
    /** Designs every empire starts with. */
    startingDesigns: z.array(Design).min(1),
    start: z.object({
      homeworldPlanetType: id,
      homeworldSize: id,
      homeworldRichness: id,
      capitalBuildings: z.array(id),
      fleets: z.array(StartingFleet),
    }),
  })
  .superRefine((pack, ctx) => {
    const unique = (path: string, ids: string[]) => {
      const seen = new Set<string>();
      for (const value of ids) {
        if (seen.has(value)) ctx.addIssue({ code: "custom", path: [path], message: `duplicate id "${value}"` });
        seen.add(value);
      }
    };
    unique("galaxySizes", pack.galaxySizes.map((g) => g.id));
    unique("starTypes", pack.starTypes.map((s) => s.id));
    unique("planetTypes", pack.planetTypes.map((p) => p.id));
    unique("planetSizes", pack.planetSizes.map((p) => p.id));
    unique("richness", pack.richness.map((r) => r.id));
    unique("systemNames", pack.systemNames);
    unique("researchFields", pack.researchFields.map((f) => f.id));
    unique("techs", pack.techs.map((t) => t.id));
    unique("buildings", pack.buildings.map((b) => b.id));
    unique("hulls", pack.hulls.map((t) => t.id));
    unique("components", pack.components.map((t) => t.id));
    unique("startingDesigns", pack.startingDesigns.map((t) => t.id));
    unique("aiPersonalities", pack.aiPersonalities.map((t) => t.id));
    unique("difficulties", pack.difficulties.map((t) => t.id));

    const techIds = new Set(pack.techs.map((t) => t.id));
    const fieldIds = new Set(pack.researchFields.map((f) => f.id));
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (!pack.difficulties.some((d) => d.id === "normal")) issue(["difficulties"], `needs a "normal" difficulty`);
    pack.aiPersonalities.forEach((p, i) => {
      for (const field of Object.keys(p.researchFields)) if (!fieldIds.has(field)) issue(["aiPersonalities", i, "researchFields"], `unknown research field "${field}"`);
    });
    pack.techs.forEach((tech, i) => {
      if (!fieldIds.has(tech.field)) issue(["techs", i, "field"], `unknown research field "${tech.field}"`);
      for (const req of tech.requires) if (!techIds.has(req)) issue(["techs", i, "requires"], `unknown tech "${req}"`);
    });
    // Every tech must be reachable: no cycles in prerequisites.
    const resolved = new Set<string>();
    let progress = true;
    while (progress) {
      progress = false;
      for (const tech of pack.techs) {
        if (!resolved.has(tech.id) && tech.requires.every((r) => resolved.has(r))) {
          resolved.add(tech.id);
          progress = true;
        }
      }
    }
    for (const tech of pack.techs) if (!resolved.has(tech.id) && tech.requires.every((r) => techIds.has(r))) issue(["techs"], `${tech.id}: prerequisite cycle`);
    pack.buildings.forEach((b, i) => {
      if (b.requires && !techIds.has(b.requires)) issue(["buildings", i, "requires"], `unknown tech "${b.requires}"`);
    });
    pack.hulls.forEach((t, i) => {
      if (t.requires && !techIds.has(t.requires)) issue(["hulls", i, "requires"], `unknown tech "${t.requires}"`);
    });
    pack.components.forEach((t, i) => {
      if (t.requires && !techIds.has(t.requires)) issue(["components", i, "requires"], `unknown tech "${t.requires}"`);
    });
    const hullById = new Map(pack.hulls.map((h) => [h.id, h]));
    const componentIds = new Set(pack.components.map((c) => c.id));
    pack.startingDesigns.forEach((d, i) => {
      const hull = hullById.get(d.hull);
      if (!hull) issue(["startingDesigns", i, "hull"], `unknown hull "${d.hull}"`);
      else if (d.components.length > hull.slots) issue(["startingDesigns", i], `${d.id}: ${d.components.length} components but ${hull.slots} slots`);
      for (const c of d.components) if (!componentIds.has(c)) issue(["startingDesigns", i, "components"], `unknown component "${c}"`);
    });
    const buildingIds = new Set(pack.buildings.map((b) => b.id));
    pack.start.capitalBuildings.forEach((b, i) => {
      if (!buildingIds.has(b)) issue(["start", "capitalBuildings", i], `unknown building "${b}"`);
    });
    const designIds = new Set(pack.startingDesigns.map((t) => t.id));
    pack.start.fleets.forEach((f, i) => {
      for (const d of f.ships) if (!designIds.has(d)) issue(["start", "fleets", i, "ships"], `unknown design "${d}"`);
    });

    const refs: [string, string, { id: string }[]][] = [
      ["homeworldPlanetType", pack.start.homeworldPlanetType, pack.planetTypes],
      ["homeworldSize", pack.start.homeworldSize, pack.planetSizes],
      ["homeworldRichness", pack.start.homeworldRichness, pack.richness],
    ];
    for (const [field, ref, list] of refs) {
      if (!list.some((item) => item.id === ref)) {
        ctx.addIssue({ code: "custom", path: ["start", field], message: `unknown id "${ref}"` });
      }
    }

    for (const star of pack.starTypes) {
      if (star.minBodies > star.maxBodies) {
        ctx.addIssue({ code: "custom", path: ["starTypes"], message: `${star.id}: minBodies > maxBodies` });
      }
    }

    const largest = Math.max(...pack.galaxySizes.map((g) => g.systems));
    if (pack.systemNames.length < largest) {
      ctx.addIssue({
        code: "custom",
        path: ["systemNames"],
        message: `need at least ${largest} system names for the largest galaxy, have ${pack.systemNames.length}`,
      });
    }

    for (const [field, list] of [
      ["starTypes", pack.starTypes],
      ["planetTypes", pack.planetTypes],
      ["planetSizes", pack.planetSizes],
      ["richness", pack.richness],
    ] as const) {
      if (!list.some((item) => item.weight > 0)) {
        ctx.addIssue({ code: "custom", path: [field], message: "needs at least one positive weight" });
      }
    }
    if (!Object.values(pack.bodyKindWeights).some((w) => w > 0)) {
      ctx.addIssue({ code: "custom", path: ["bodyKindWeights"], message: "needs at least one positive weight" });
    }
  });

export type ContentPack = z.infer<typeof ContentPackSchema>;

export class ContentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid content pack:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ContentError";
  }
}

/** Validate raw pack data (parsed JSON). Throws ContentError listing every problem. */
export function loadContentPack(raw: unknown): ContentPack {
  const result = ContentPackSchema.safeParse(raw);
  if (!result.success) {
    throw new ContentError(result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`));
  }
  return result.data;
}
