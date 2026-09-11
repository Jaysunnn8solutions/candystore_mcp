/**
 * Global and local Moran's I, implemented from the formulas rather than
 * imported, so the serving path stays a few kilobytes of TypeScript.
 *
 * Global I asks "do similar values cluster in space?" Local I (Anselin's
 * LISA) asks that per unit, and classifies each unit as part of a
 * high-high or low-low cluster, a high-low or low-high outlier, or not
 * significant.
 */

import { mean, normalTwoSidedP, seededRandom } from "./stats";
import { spatialLag, type Weights } from "./weights";

export interface GlobalMoran {
  I: number;
  /** E[I] = -1 / (n - 1) under the null of no spatial autocorrelation. */
  expected: number;
  variance: number;
  z: number;
  /** Two-sided p-value under the normality assumption. */
  p: number;
  n: number;
}

export type Cluster = "HH" | "LL" | "HL" | "LH" | "ns";

export interface LocalMoran {
  I: number[];
  /** Pseudo p-values from conditional permutation. */
  p: number[];
  cluster: Cluster[];
  /** Standardized input values, exposed so callers can explain a cluster. */
  z: number[];
  lag: number[];
}

export function globalMoran(values: number[], w: Weights): GlobalMoran {
  const n = values.length;
  const m = mean(values);
  const z = values.map((v) => v - m);

  let sumZ2 = 0;
  for (const zi of z) sumZ2 += zi * zi;

  // S0 = sum of all weights; S1 and S2 are the standard variance terms.
  let S0 = 0;
  let S1 = 0;
  let num = 0;
  const rowSums = new Array<number>(n).fill(0);
  const colSums = new Array<number>(n).fill(0);

  // Build a lookup of w_ji for the symmetric term in S1.
  const rowMaps: Array<Map<number, number>> = w.neighbors.map((nb, i) => {
    const map = new Map<number, number>();
    nb.forEach((j, k) => map.set(j, w.weights[i][k]));
    return map;
  });

  for (let i = 0; i < n; i++) {
    const nb = w.neighbors[i];
    const wt = w.weights[i];
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k];
      const wij = wt[k];
      const wji = rowMaps[j].get(i) ?? 0;
      S0 += wij;
      S1 += 0.5 * (wij + wji) * (wij + wji);
      rowSums[i] += wij;
      colSums[j] += wij;
      num += wij * z[i] * z[j];
    }
  }

  let S2 = 0;
  for (let i = 0; i < n; i++) S2 += (rowSums[i] + colSums[i]) ** 2;

  const expected = n > 1 ? -1 / (n - 1) : 0;

  if (sumZ2 === 0 || S0 === 0 || n < 3) {
    return { I: 0, expected, variance: 0, z: 0, p: 1, n };
  }

  const I = (n / S0) * (num / sumZ2);
  const variance =
    (n * n * S1 - n * S2 + 3 * S0 * S0) / ((n - 1) * (n + 1) * S0 * S0) -
    expected * expected;
  const zScore = variance > 0 ? (I - expected) / Math.sqrt(variance) : 0;

  return { I, expected, variance, z: zScore, p: normalTwoSidedP(zScore), n };
}

export interface LocalMoranOptions {
  permutations?: number;
  alpha?: number;
  seed?: number;
}

export function localMoran(
  values: number[],
  w: Weights,
  opts: LocalMoranOptions = {}
): LocalMoran {
  const permutations = opts.permutations ?? 199;
  const alpha = opts.alpha ?? 0.05;
  const rng = seededRandom(opts.seed ?? 42);

  const n = values.length;
  const m = mean(values);
  const z = values.map((v) => v - m);
  let m2 = 0;
  for (const zi of z) m2 += zi * zi;
  m2 /= n;

  const lag = spatialLag(z, w);
  const I = new Array<number>(n).fill(0);
  const p = new Array<number>(n).fill(1);
  const cluster = new Array<Cluster>(n).fill("ns");

  if (m2 === 0) return { I, p, cluster, z, lag };

  for (let i = 0; i < n; i++) {
    const nb = w.neighbors[i];
    if (nb.length === 0) continue;

    I[i] = (z[i] / m2) * lag[i];

    // Conditional randomization: hold z_i fixed, draw k values for the
    // neighbor slots from the other n-1 units without replacement.
    const k = nb.length;
    const others: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i) others.push(z[j]);

    let extreme = 0;
    const obs = I[i];
    for (let perm = 0; perm < permutations; perm++) {
      // Partial Fisher–Yates: only the first k positions need shuffling.
      for (let a = 0; a < k; a++) {
        const b = a + Math.floor(rng() * (others.length - a));
        const tmp = others[a];
        others[a] = others[b];
        others[b] = tmp;
      }
      let lagPerm = 0;
      for (let a = 0; a < k; a++) lagPerm += others[a];
      lagPerm /= k;
      const Ip = (z[i] / m2) * lagPerm;
      // One-sided in the direction of the observed statistic.
      if (obs >= 0 ? Ip >= obs : Ip <= obs) extreme++;
    }
    p[i] = (extreme + 1) / (permutations + 1);

    if (p[i] <= alpha) {
      if (z[i] > 0 && lag[i] > 0) cluster[i] = "HH";
      else if (z[i] < 0 && lag[i] < 0) cluster[i] = "LL";
      else if (z[i] > 0 && lag[i] < 0) cluster[i] = "HL";
      else if (z[i] < 0 && lag[i] > 0) cluster[i] = "LH";
    }
  }

  return { I, p, cluster, z, lag };
}
