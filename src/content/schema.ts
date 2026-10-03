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

const StartingFleet = z.object({
  name: z.string().min(1),
  /** Distance units per turn. */
  speed: z.number().int().positive(),
  /** Distance within which this fleet sees other fleets. */
  sensorRange: z.number().int().nonnegative(),
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
    start: z.object({
      homeworldPlanetType: id,
      homeworldSize: id,
      homeworldRichness: id,
      /** Distance within which a home system sees fleets. */
      homeSensorRange: z.number().int().nonnegative(),
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
