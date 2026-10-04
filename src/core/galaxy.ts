import { BODY_KINDS, type ContentPack } from "../content/schema";
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

/** Scatter `count` stars in an ellipse with a minimum spacing, relaxing spacing if crowded. */
export function placeStars(rng: Rng, count: number, rx: number, ry: number, minDistance: number): Point[] {
  const points: Point[] = [];
  let min = minDistance;
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  while (points.length < count) {
    const min2 = min * min;
    for (let attempt = 0; attempt < count * 200 && points.length < count; attempt++) {
      const x = rng.int(-rx, rx);
      const y = rng.int(-ry, ry);
      if (x * x * ry2 + y * y * rx2 > rx2 * ry2) continue;
      const p = { x: x + rx, y: y + ry };
      if (points.every((q) => dist2(p, q) >= min2)) points.push(p);
    }
    min = Math.floor(min * 0.9);
    if (min < 1) throw new Error("placeStars: cannot fit stars");
  }
  return points;
}

/**
 * Lanes: start from the Gabriel graph (planar, no crossings, always connected),
 * keep its minimum spanning tree so every system is reachable, then keep
 * a random share of the remaining edges to form loops and chokepoints.
 */
export function buildLanes(rng: Rng, points: readonly Point[]): Lane[] {
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
    const keepExtra = rng.chance(EXTRA_LANE_CHANCE);
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

export function generateGalaxy(rng: Rng, pack: ContentPack, sizeId: string, firstId: number): GeneratedGalaxy {
  const size = pack.galaxySizes.find((g) => g.id === sizeId);
  if (!size) throw new Error(`unknown galaxy size "${sizeId}"`);

  let id = firstId;
  const nextId = () => id++;

  const points = placeStars(rng.fork("stars"), size.systems, size.radiusX, size.radiusY, size.minStarDistance);
  const lanes = buildLanes(rng.fork("lanes"), points);
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
      bodies: rollBodies(bodyRng, pack, starType, nextId, bodyRng.int(1, 100) <= size.emptyPercent),
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
