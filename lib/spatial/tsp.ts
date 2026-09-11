/**
 * Visit ordering: a small traveling-salesman heuristic.
 *
 * Nearest-neighbour construction from a fixed start, then 2-opt
 * improvement (reverse any segment whose reversal shortens the route)
 * until no improvement remains. Distances are great-circle, so this is a
 * planning aid, not turn-by-turn routing.
 */

import { haversineKm } from "./stats";
import type { Point } from "./catchment";

export interface RouteOptions {
  /** Index of the point to start from. Defaults to 0. */
  start?: number;
  /** Return to the start at the end. */
  roundTrip?: boolean;
}

export interface Route {
  /** Visit order as indices into the input, beginning with `start`. */
  order: number[];
  /** Distance of each leg; includes the return leg for a round trip. */
  legsKm: number[];
  totalKm: number;
}

export function distanceMatrix(points: Point[]): number[][] {
  const n = points.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(points[i].lon, points[i].lat, points[j].lon, points[j].lat);
      m[i][j] = d;
      m[j][i] = d;
    }
  }
  return m;
}

export function routeLength(order: number[], dist: number[][], roundTrip: boolean): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) total += dist[order[i - 1]][order[i]];
  if (roundTrip && order.length > 1) total += dist[order[order.length - 1]][order[0]];
  return total;
}

export function planRoute(points: Point[], opts: RouteOptions = {}): Route {
  const n = points.length;
  const start = opts.start ?? 0;
  const roundTrip = opts.roundTrip ?? false;
  if (n === 0) return { order: [], legsKm: [], totalKm: 0 };
  if (start < 0 || start >= n) throw new Error("start index out of range");

  const dist = distanceMatrix(points);

  // Nearest neighbour.
  const visited = new Array<boolean>(n).fill(false);
  const order = [start];
  visited[start] = true;
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && dist[last][j] < bestD) {
        bestD = dist[last][j];
        best = j;
      }
    }
    visited[best] = true;
    order.push(best);
  }

  // 2-opt. The start stays fixed at position 0; for an open path the last
  // node may move, for a round trip the closing edge is part of the tour.
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 1000) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = order[i - 1];
        const b = order[i];
        const c = order[j];
        const d = j + 1 < n ? order[j + 1] : roundTrip ? order[0] : -1;
        const before = dist[a][b] + (d === -1 ? 0 : dist[c][d]);
        const after = dist[a][c] + (d === -1 ? 0 : dist[b][d]);
        if (after < before - 1e-9) {
          // Reverse order[i..j].
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const t = order[lo];
            order[lo] = order[hi];
            order[hi] = t;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }

  const legsKm: number[] = [];
  for (let i = 1; i < n; i++) legsKm.push(dist[order[i - 1]][order[i]]);
  if (roundTrip && n > 1) legsKm.push(dist[order[n - 1]][order[0]]);

  return { order, legsKm, totalKm: routeLength(order, dist, roundTrip) };
}
