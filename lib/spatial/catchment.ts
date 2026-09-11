/**
 * Two-step floating catchment area (2SFCA) accessibility.
 *
 * Step 1: each supply point looks at the demand within its catchment and
 * computes a supply-to-population ratio.
 * Step 2: each demand point sums the ratios of every supply point whose
 * catchment reaches it.
 *
 * The result is "supply per person" that accounts for competition — a
 * grocery store surrounded by 50,000 people counts for less than one
 * surrounded by 5,000. The enhanced variant (E2SFCA) replaces the hard
 * cutoff with a distance-decay weight.
 */

import { haversineKm } from "./stats";

export interface Point {
  lon: number;
  lat: number;
}

export interface Supply extends Point {
  /** Service capacity. 1 for a point of interest, trips per hour for a transit stop. */
  capacity: number;
}

export interface Demand extends Point {
  population: number;
}

export type Decay = "binary" | "gaussian";

export interface CatchmentOptions {
  /** Catchment radius in kilometres. */
  radiusKm: number;
  decay: Decay;
}

/**
 * Distance-decay weight. Binary is 1 inside the radius and 0 outside.
 * Gaussian falls to ~0.14 at the radius and is truncated beyond it, so the
 * two variants agree on which supply is reachable and differ only in how
 * much nearer supply is favoured.
 */
export function decayWeight(distanceKm: number, opts: CatchmentOptions): number {
  if (distanceKm > opts.radiusKm) return 0;
  if (opts.decay === "binary") return 1;
  const sigma = opts.radiusKm / 2;
  return Math.exp(-0.5 * (distanceKm / sigma) ** 2);
}

/** Degrees of latitude spanned by a distance, for coarse bounding-box prefilters. */
function latDegrees(km: number): number {
  return km / 110.574;
}

function lonDegrees(km: number, atLat: number): number {
  return km / (111.32 * Math.cos((atLat * Math.PI) / 180));
}

/**
 * Accessibility score per demand point, in units of capacity per person.
 * Multiply by 1000 for "per 1,000 residents".
 */
export function twoStepFca(
  demand: Demand[],
  supply: Supply[],
  opts: CatchmentOptions
): number[] {
  const dLat = latDegrees(opts.radiusKm);

  // Step 1: supply-to-demand ratio for every supply point.
  const ratios = new Array<number>(supply.length).fill(0);
  // Remember which demand points each supply point reaches, and with what
  // weight, so step 2 doesn't recompute distances.
  const reach: Array<Array<[number, number]>> = new Array(supply.length);

  for (let j = 0; j < supply.length; j++) {
    const s = supply[j];
    const dLon = lonDegrees(opts.radiusKm, s.lat);
    let weightedPop = 0;
    const reached: Array<[number, number]> = [];

    for (let i = 0; i < demand.length; i++) {
      const d = demand[i];
      if (Math.abs(d.lat - s.lat) > dLat || Math.abs(d.lon - s.lon) > dLon) {
        continue;
      }
      const dist = haversineKm(s.lon, s.lat, d.lon, d.lat);
      const wgt = decayWeight(dist, opts);
      if (wgt === 0) continue;
      weightedPop += wgt * d.population;
      reached.push([i, wgt]);
    }

    reach[j] = reached;
    ratios[j] = weightedPop > 0 ? s.capacity / weightedPop : 0;
  }

  // Step 2: sum reachable ratios at each demand point.
  const access = new Array<number>(demand.length).fill(0);
  for (let j = 0; j < supply.length; j++) {
    if (ratios[j] === 0) continue;
    for (const [i, wgt] of reach[j]) access[i] += wgt * ratios[j];
  }

  return access;
}

/** Count supply points (or sum their capacity) within a radius of a point. */
export function supplyWithin(
  origin: Point,
  supply: Supply[],
  radiusKm: number
): { count: number; capacity: number } {
  const dLat = latDegrees(radiusKm);
  const dLon = lonDegrees(radiusKm, origin.lat);
  let count = 0;
  let capacity = 0;
  for (const s of supply) {
    if (Math.abs(s.lat - origin.lat) > dLat || Math.abs(s.lon - origin.lon) > dLon) {
      continue;
    }
    if (haversineKm(origin.lon, origin.lat, s.lon, s.lat) <= radiusKm) {
      count++;
      capacity += s.capacity;
    }
  }
  return { count, capacity };
}
