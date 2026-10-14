import { BODY_KINDS, type ContentPack, type GalaxyLayout } from "../content/schema";
import { buildAdjacency, shortestPaths } from "./graph";
import type { Rng } from "./rng";
import type { Body, Galaxy, Lane, StarSystem, SystemId } from "./state";

/**
 * Procedural galaxy generation. Everything is integer math plus Math.sqrt
 * (which IEEE 754 requires to be exact), so a seed produces the same galaxy
 * on every device.
 */

/** Chance that a non-essential lane is kept. Lower = more chokepoints. */
const EXTRA_LANE_CHANCE = 0.45;

interface Point {
  x: number;
  y: number;
}

function dist2(p: Point, q: Point): number {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return dx * dx + dy * dy;
}

/** Draws a candidate star position (already shifted into positive coordinates), or null to reject. */
type Sampler = (rng: Rng) => Point | null;

/** Uniform over the ellipse with half-axes rx and ry; `keep` can carve out regions (e.g. a ring's hole). */
function ellipseSampler(rx: number, ry: number, keep: (v: number, full: number) => boolean = () => true): Sampler {
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  return (rng) => {
    const x = rng.int(-rx, rx);
    const y = rng.int(-ry, ry);
    // v / full is the squared normalized radius: 0 at the center, 1 on the rim.
    const v = x * x * ry2 + y * y * rx2;
    const full = rx2 * ry2;
    if (v > full || !keep(v, full)) return null;
    return { x: x + rx, y: y + ry };
  };
}

/** Scatter `count` stars in an ellipse with a minimum spacing, relaxing spacing if crowded. */
export function placeStars(rng: Rng, count: number, rx: number, ry: number, minDistance: number, sample: Sampler = ellipseSampler(rx, ry)): Point[] {
  const points: Point[] = [];
  let min = minDistance;
  while (points.length < count) {
    const min2 = min * min;
    for (let attempt = 0; attempt < count * 200 && points.length < count; attempt++) {
      const p = sample(rng);
      if (!p) continue;
      if (points.every((q) => dist2(p, q) >= min2)) points.push(p);
    }
    min = Math.floor(min * 0.9);
    if (min < 1) throw new Error("placeStars: cannot fit stars");
  }
  return points;
}

/** cos(2πk/64) × 1000 for k = 0..63, so spiral arms need no trig at run time (identical on every device). */
const COS64 = [
  1000, 995, 981, 957, 924, 882, 831, 773, 707, 634, 556, 471, 383, 290, 195, 98, 0, -98, -195, -290, -383, -471, -556, -634, -707, -773, -831, -882, -924, -957, -981, -995,
  -1000, -995, -981, -957, -924, -882, -831, -773, -707, -634, -556, -471, -383, -290, -195, -98, 0, 98, 195, 290, 383, 471, 556, 634, 707, 773, 831, 882, 924, 957, 981, 995,
];
/** Angle in 1/64ths of a turn, times 16 for smooth interpolation; returns cos and sin × 1000. */
function cosSin(angle16: number): [number, number] {
  const at = (a: number) => {
    const i = Math.floor(a / 16);
    const f = a - i * 16;
    const lo = COS64[((i % 64) + 64) % 64]!;
    const hi = COS64[(((i + 1) % 64) + 64) % 64]!;
    return Math.round(lo + ((hi - lo) * f) / 16);
  };
  return [at(angle16), at(angle16 - 16 * 16)]; // sin(θ) = cos(θ - quarter turn)
}

interface Layout {
  points: Point[];
  /** Cluster of each point (cluster layouts only): lanes inside a cluster are kept more often than between. */
  group?: number[];
}

const SPIRAL = { arms: 2, turns16: 44 * 16, corePercent: 8, jitterPercent: 6 };
const CLUSTER = { size: 6, radius: 180, gapPercent: 340, minStarDistance: 95, insideLaneChance: 0.7, betweenLaneChance: 0.04 };

function layoutStars(rng: Rng, kind: GalaxyLayout, count: number, rx: number, ry: number, minDistance: number): Layout {
  switch (kind) {
    case "scatter":
      return { points: placeStars(rng, count, rx, ry, minDistance) };
    case "ring":
      // An ellipse with its middle hollowed out: inside 55% of the radius is empty space.
      return { points: placeStars(rng, count, rx, ry, minDistance, ellipseSampler(rx, ry, (v, full) => v * 100 >= full * 30)) };
    case "spiral": {
      const jitter = Math.floor((Math.max(rx, ry) * SPIRAL.jitterPercent) / 100);
      const sample: Sampler = (r) => {
        if (r.int(1, 100) <= SPIRAL.corePercent) {
          const qx = Math.floor(rx / 4);
          const qy = Math.floor(ry / 4);
          const p = ellipseSampler(qx, qy)(r);
          return p && { x: p.x - qx + rx, y: p.y - qy + ry };
        }
        // Along an arm: angle grows with distance from the core.
        const arm = r.int(0, SPIRAL.arms - 1);
        const t = r.int(150, 1000); // per mille of the radius
        const [c, s] = cosSin(Math.floor((arm * 64 * 16) / SPIRAL.arms) + Math.floor((SPIRAL.turns16 * t) / 1000));
        const x = Math.round((((c * t) / 1000) * rx) / 1000) + r.int(-jitter, jitter);
        const y = Math.round((((s * t) / 1000) * ry) / 1000) + r.int(-jitter, jitter);
        if (x < -rx || x > rx || y < -ry || y > ry) return null;
        return { x: x + rx, y: y + ry };
      };
      return { points: placeStars(rng, count, rx, ry, minDistance, sample) };
    }
    case "clusters": {
      // Cluster centers spread far apart, then a handful of stars packed around each.
      const clusters = Math.max(2, Math.round(count / CLUSTER.size));
      const centers = placeStars(rng, clusters, rx - CLUSTER.radius, ry - CLUSTER.radius, Math.floor((CLUSTER.radius * CLUSTER.gapPercent) / 100)).map((c) => ({ x: c.x + CLUSTER.radius, y: c.y + CLUSTER.radius }));
      const points: Point[] = [];
      const group: number[] = [];
      centers.forEach((center, k) => {
        const n = Math.floor((count * (k + 1)) / clusters) - Math.floor((count * k) / clusters);
        const sample = ellipseSampler(CLUSTER.radius, CLUSTER.radius);
        const local = placeStars(rng, n, CLUSTER.radius, CLUSTER.radius, Math.min(minDistance, CLUSTER.minStarDistance), (r) => {
          const p = sample(r);
          return p && { x: p.x - CLUSTER.radius + center.x, y: p.y - CLUSTER.radius + center.y };
        });
        for (const p of local) {
          points.push(p);
          group.push(k);
        }
      });
      return { points, group };
    }
  }
}

/**
 * Lanes: start from the Gabriel graph (planar, no crossings, always connected),
 * keep its minimum spanning tree so every system is reachable, then keep
 * a random share of the remaining edges to form loops and chokepoints.
 */
export function buildLanes(rng: Rng, points: readonly Point[], group?: readonly number[]): Lane[] {
  const n = points.length;
  const candidates: { a: number; b: number; d2: number }[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const d2 = dist2(points[a]!, points[b]!);
      let gabriel = true;
      for (let k = 0; k < n && gabriel; k++) {
        if (k === a || k === b) continue;
        if (dist2(points[a]!, points[k]!) + dist2(points[b]!, points[k]!) < d2) gabriel = false;
      }
      if (gabriel) candidates.push({ a, b, d2 });
    }
  }
  candidates.sort((p, q) => p.d2 - q.d2 || p.a - q.a || p.b - q.b);

  // Kruskal's MST with union-find.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };

  const lanes: Lane[] = [];
  for (const edge of candidates) {
    const ra = find(edge.a);
    const rb = find(edge.b);
    const inTree = ra !== rb;
    if (inTree) parent[ra] = rb;
    // Roll for every edge (even tree edges) so the stream doesn't depend on tree shape.
    const chance = !group ? EXTRA_LANE_CHANCE : group[edge.a] === group[edge.b] ? CLUSTER.insideLaneChance : CLUSTER.betweenLaneChance;
    const keepExtra = rng.chance(chance);
    if (inTree || keepExtra) {
      lanes.push({ a: edge.a, b: edge.b, length: Math.round(Math.sqrt(edge.d2)) });
    }
  }
  lanes.sort((p, q) => p.a - q.a || p.b - q.b);
  return lanes;
}

function rollPlanet(rng: Rng, pack: ContentPack, id: number): Body {
  return {
    id,
    kind: "planet",
    planetType: rng.weighted(pack.planetTypes, (t) => t.weight).id,
    size: rng.weighted(pack.planetSizes, (s) => s.weight).id,
    richness: rng.weighted(pack.richness, (r) => r.weight).id,
  };
}

function rollBodies(rng: Rng, pack: ContentPack, starType: ContentPack["starTypes"][number], nextId: () => number, empty: boolean): Body[] {
  const count = rng.int(starType.minBodies, starType.maxBodies);
  const bodies: Body[] = [];
  // Empty systems have no planets: only gas giants, asteroid fields, anomalies or nothing.
  const kinds = empty ? BODY_KINDS.filter((k) => k !== "planet") : BODY_KINDS;
  for (let i = 0; i < count; i++) {
    const kind = rng.weighted(kinds, (k) => pack.bodyKindWeights[k]);
    bodies.push(kind === "planet" ? rollPlanet(rng, pack, nextId()) : { id: nextId(), kind });
  }
  return bodies;
}

/**
 * Pick home systems spread across the map: a random first home, then repeatedly
 * the system whose nearest existing home is farthest away by lane distance.
 */
export function pickHomeSystems(rng: Rng, galaxy: Galaxy, count: number): SystemId[] {
  const n = galaxy.systems.length;
  if (count > n) throw new Error("more empires than systems");
  const adj = buildAdjacency(n, galaxy.lanes);
  const homes: SystemId[] = [rng.int(0, n - 1)];
  const nearest = shortestPaths(adj, homes[0]!).dist.slice();
  while (homes.length < count) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (homes.includes(i)) continue;
      if (best === -1 || nearest[i]! > nearest[best]!) best = i;
    }
    homes.push(best);
    const d = shortestPaths(adj, best).dist;
    for (let i = 0; i < n; i++) nearest[i] = Math.min(nearest[i]!, d[i]!);
  }
  return homes;
}

export interface GeneratedGalaxy {
  galaxy: Galaxy;
  nextId: number;
}

export function generateGalaxy(rng: Rng, pack: ContentPack, sizeId: string, firstId: number, typeId: string): GeneratedGalaxy {
  const size = pack.galaxySizes.find((g) => g.id === sizeId);
  if (!size) throw new Error(`unknown galaxy size "${sizeId}"`);

  let id = firstId;
  const nextId = () => id++;

  const type = pack.galaxyTypes.find((t) => t.id === typeId);
  if (!type) throw new Error(`unknown galaxy type "${typeId}"`);
  const rx = Math.floor((size.radiusX * type.spreadPercent) / 100);
  const ry = Math.floor((size.radiusY * type.spreadPercent) / 100);
  const { points, group } = layoutStars(rng.fork("stars"), type.layout, size.systems, rx, ry, size.minStarDistance);
  const lanes = buildLanes(rng.fork("lanes"), points, group);
  const names = rng.fork("names").shuffle(pack.systemNames);
  const bodyRng = rng.fork("bodies");

  const systems: StarSystem[] = points.map((p, i) => {
    const starType = bodyRng.weighted(pack.starTypes, (s) => s.weight);
    return {
      id: i,
      name: names[i]!,
      x: p.x,
      y: p.y,
      starType: starType.id,
      bodies: rollBodies(bodyRng, pack, starType, nextId, bodyRng.int(1, 100) <= type.emptyPercent),
    };
  });

  return { galaxy: { systems, lanes }, nextId: id };
}

/** Make sure a home system contains the pack's standard homeworld as its first body. */
export function installHomeworld(system: StarSystem, pack: ContentPack, bodyId: number): void {
  const homeworld: Body = {
    id: bodyId,
    kind: "planet",
    planetType: pack.start.homeworldPlanetType,
    size: pack.start.homeworldSize,
    richness: pack.start.homeworldRichness,
  };
  system.bodies = [homeworld, ...system.bodies].slice(0, 5);
}
