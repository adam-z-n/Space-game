import type { Galaxy, Lane, SystemId } from "./state";

/** Lane graph helpers. Neighbor lists are sorted by system id so iteration order is stable. */

export interface Neighbor {
  id: SystemId;
  length: number;
}

export function buildAdjacency(systemCount: number, lanes: readonly Lane[]): Neighbor[][] {
  const adj: Neighbor[][] = Array.from({ length: systemCount }, () => []);
  for (const lane of lanes) {
    adj[lane.a]!.push({ id: lane.b, length: lane.length });
    adj[lane.b]!.push({ id: lane.a, length: lane.length });
  }
  for (const list of adj) list.sort((p, q) => p.id - q.id);
  return adj;
}

export function laneLength(galaxy: Galaxy, a: SystemId, b: SystemId): number | undefined {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return galaxy.lanes.find((l) => l.a === lo && l.b === hi)?.length;
}

/**
 * Shortest distances from `from` to every system (Dijkstra).
 * Ties break toward the lower system id, so paths are deterministic.
 */
export function shortestPaths(
  adj: readonly Neighbor[][],
  from: SystemId,
): { dist: number[]; prev: (SystemId | -1)[] } {
  const n = adj.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<SystemId | -1>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  // O(n^2) Dijkstra: galaxies are at most a couple hundred systems.
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i]! < Infinity && (u === -1 || dist[i]! < dist[u]!)) u = i;
    }
    if (u === -1) break;
    done[u] = true;
    for (const { id: v, length } of adj[u]!) {
      const d = dist[u]! + length;
      if (d < dist[v]! || (d === dist[v]! && u < prev[v]!)) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  return { dist, prev };
}

/** Path from `from` to `to`, excluding `from`. Empty if from === to; undefined if unreachable. */
export function findPath(adj: readonly Neighbor[][], from: SystemId, to: SystemId): { path: SystemId[]; length: number } | undefined {
  const { dist, prev } = shortestPaths(adj, from);
  if (dist[to] === Infinity) return undefined;
  const path: SystemId[] = [];
  for (let at: SystemId | -1 = to; at !== from && at !== -1; at = prev[at]!) path.push(at);
  path.reverse();
  return { path, length: dist[to]! };
}

export function isConnected(adj: readonly Neighbor[][]): boolean {
  if (adj.length === 0) return true;
  const seen = new Array<boolean>(adj.length).fill(false);
  const stack: SystemId[] = [0];
  seen[0] = true;
  let count = 1;
  while (stack.length > 0) {
    const u = stack.pop()!;
    for (const { id } of adj[u]!) {
      if (!seen[id]) {
        seen[id] = true;
        count++;
        stack.push(id);
      }
    }
  }
  return count === adj.length;
}

/** Lanes whose both ends are in `known`. */
export function knownLanes(lanes: readonly Lane[], known: ReadonlySet<SystemId>): Lane[] {
  return lanes.filter((l) => known.has(l.a) && known.has(l.b));
}
