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
  })
  .partial()
  .strict();
export type Effects = z.infer<typeof EffectsSchema>;

export const SHIP_ROLES = ["combat", "transport", "recon", "support"] as const;

const ShipTemplate = z.object({
  id,
  name: z.string().min(1),
  role: z.enum(SHIP_ROLES),
  description: z.string(),
  /** Industry to build. */
  cost: z.number().int().positive(),
  /** Credits per turn. */
  upkeep: z.number().int().nonnegative(),
  /** Distance units per turn. */
  speed: z.number().int().positive(),
  /** Distance within which this ship sees other fleets. */
  sensorRange: z.number().int().nonnegative(),
  /** Can found a colony (consumed in the process). */
  colonize: z.boolean().default(false),
  /** Tech needed to build it. */
  requires: id.optional(),
});

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
  template: id,
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
    shipTemplates: z.array(ShipTemplate).min(1),
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
    unique("shipTemplates", pack.shipTemplates.map((t) => t.id));

    const techIds = new Set(pack.techs.map((t) => t.id));
    const fieldIds = new Set(pack.researchFields.map((f) => f.id));
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
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
    pack.shipTemplates.forEach((t, i) => {
      if (t.requires && !techIds.has(t.requires)) issue(["shipTemplates", i, "requires"], `unknown tech "${t.requires}"`);
    });
    const buildingIds = new Set(pack.buildings.map((b) => b.id));
    pack.start.capitalBuildings.forEach((b, i) => {
      if (!buildingIds.has(b)) issue(["start", "capitalBuildings", i], `unknown building "${b}"`);
    });
    const templateIds = new Set(pack.shipTemplates.map((t) => t.id));
    pack.start.fleets.forEach((f, i) => {
      if (!templateIds.has(f.template)) issue(["start", "fleets", i, "template"], `unknown ship template "${f.template}"`);
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
