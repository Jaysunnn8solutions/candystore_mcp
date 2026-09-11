/**
 * Row-standardized spatial weights from a precomputed adjacency list.
 *
 * Adjacency (queen contiguity: polygons sharing an edge or a vertex) is
 * computed once in the offline pipeline on the full-precision geometry and
 * stored on each tract, so the serving path never does polygon intersection.
 */

export interface Weights {
  /** Unit ids in matrix order. */
  ids: string[];
  /** id → row index. */
  index: Map<string, number>;
  /** neighbors[i] = row indices of unit i's neighbors. */
  neighbors: number[][];
  /** weights[i][k] = weight of neighbors[i][k]; each row sums to 1 (or is empty). */
  weights: number[][];
  /** Units with no neighbors. They contribute nothing to spatial lags. */
  islands: number[];
}

export function buildWeights(ids: string[], neighborIds: string[][]): Weights {
  if (ids.length !== neighborIds.length) {
    throw new Error("ids and neighborIds must be the same length");
  }
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));

  const neighbors: number[][] = [];
  const weights: number[][] = [];
  const islands: number[] = [];

  for (let i = 0; i < ids.length; i++) {
    const row: number[] = [];
    for (const nid of neighborIds[i]) {
      const j = index.get(nid);
      // Neighbors outside the study area (or self-references) are dropped.
      if (j !== undefined && j !== i) row.push(j);
    }
    neighbors.push(row);
    if (row.length === 0) {
      islands.push(i);
      weights.push([]);
    } else {
      weights.push(row.map(() => 1 / row.length));
    }
  }

  return { ids, index, neighbors, weights, islands };
}

/** Spatial lag: for each unit, the weighted mean of its neighbors' values. */
export function spatialLag(values: number[], w: Weights): number[] {
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    const nb = w.neighbors[i];
    const wt = w.weights[i];
    let s = 0;
    for (let k = 0; k < nb.length; k++) s += wt[k] * values[nb[k]];
    out[i] = s;
  }
  return out;
}
