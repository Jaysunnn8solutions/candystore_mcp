/**
 * Small numeric helpers. Kept dependency-free so the serving path never
 * pulls in a stats library for a handful of formulas.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation. */
export function stddev(xs: number[], m = mean(xs)): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

/**
 * Standardize to z-scores. A constant series has no spread, so every value
 * maps to 0 rather than NaN — downstream composites then simply ignore it.
 */
export function zscores(xs: number[]): number[] {
  const m = mean(xs);
  const sd = stddev(xs, m);
  if (!Number.isFinite(sd) || sd === 0) return xs.map(() => 0);
  return xs.map((x) => (x - m) / sd);
}

/** Linear-interpolated quantile of an ascending-sorted array, q in [0, 1]. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Which third of the distribution a value falls in: 1 (low), 2, or 3 (high). */
export function tertile(value: number, sorted: number[]): 1 | 2 | 3 {
  const t1 = quantileSorted(sorted, 1 / 3);
  const t2 = quantileSorted(sorted, 2 / 3);
  if (value <= t1) return 1;
  if (value <= t2) return 2;
  return 3;
}

/** Clamp x into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometres between two lon/lat points. */
export function haversineKm(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Two-sided p-value for a standard normal z statistic, via the
 * Abramowitz–Stegun erfc approximation (max error ~1.5e-7).
 */
export function normalTwoSidedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfc = poly * Math.exp(-x * x);
  return Math.min(1, erfc);
}

/**
 * Deterministic PRNG (mulberry32) so permutation tests are reproducible
 * across runs and across the API and MCP surfaces.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
