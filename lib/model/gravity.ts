/**
 * Huff gravity model: each tract splits each category's spend among the
 * stores that carry that category, in proportion to size^alpha /
 * distance^beta, with an "outside option" so distant or weak stores never
 * capture everything. Competitors take their share too.
 *
 * General stores carry traditional candy. Specialty stores carry the
 * specialty categories for their segments. Cannibalization falls out of
 * the shares: two of our general stores near one tract split it.
 */

import { haversineKm } from "../spatial/stats";
import { categoryFor } from "./demand";
import type { Competitor, GravityParams, Store, TractDemand, TractProps } from "./types";

export interface Outlet {
  id: string;
  ours: boolean;
  lon: number;
  lat: number;
  size: number;
  /** Categories this outlet carries. */
  categories: Set<string>;
}

export function outletsFrom(stores: Store[], competitors: Competitor[]): Outlet[] {
  const ours = stores.map((s) => ({
    id: s.id,
    ours: true,
    lon: s.lon,
    lat: s.lat,
    size: s.size,
    categories: new Set(s.type === "general" ? ["traditional"] : s.segments.map(categoryFor)),
  }));
  const theirs = competitors.map((c) => ({
    id: c.id,
    ours: false,
    lon: c.lon,
    lat: c.lat,
    size: 0.8,
    categories: new Set(["traditional"]),
  }));
  return [...ours, ...theirs];
}

/** Attraction of an outlet from a point, or 0 if out of range. */
export function attraction(outlet: Outlet, lon: number, lat: number, g: GravityParams): number {
  const dLat = g.maxKm / 110.574;
  if (Math.abs(outlet.lat - lat) > dLat) return 0;
  const d = haversineKm(lon, lat, outlet.lon, outlet.lat);
  if (d > g.maxKm) return 0;
  return Math.pow(outlet.size, g.alpha) / Math.pow(Math.max(d, 0.3), g.beta);
}

export interface Capture {
  /** outlet id → category → annual dollars captured from this tract. */
  byOutlet: Map<string, Record<string, number>>;
  /** category → share captured by our outlets combined. */
  ourShare: Record<string, number>;
  primaryStore: string | null;
}

/** Split one tract's demand across outlets. */
export function captureForTract(
  t: TractProps,
  demand: TractDemand,
  outlets: Outlet[],
  g: GravityParams
): Capture {
  const byOutlet = new Map<string, Record<string, number>>();
  const ourShare: Record<string, number> = {};
  let best: { id: string; amount: number } | null = null;

  const attr = outlets.map((o) => attraction(o, t.cx, t.cy, g));

  for (const [category, dollars] of Object.entries(demand.byCategory)) {
    if (dollars <= 0) continue;
    let denom = g.outsideOption;
    for (let i = 0; i < outlets.length; i++) {
      if (attr[i] > 0 && outlets[i].categories.has(category)) denom += attr[i];
    }
    let ours = 0;
    for (let i = 0; i < outlets.length; i++) {
      if (attr[i] <= 0 || !outlets[i].categories.has(category)) continue;
      const amount = (dollars * attr[i]) / denom;
      const rec = byOutlet.get(outlets[i].id) ?? {};
      rec[category] = (rec[category] ?? 0) + amount;
      byOutlet.set(outlets[i].id, rec);
      if (outlets[i].ours) {
        ours += amount;
        const total = Object.values(rec).reduce((a, b) => a + b, 0);
        if (!best || total > best.amount) best = { id: outlets[i].id, amount: total };
      }
    }
    ourShare[category] = ours / dollars;
  }
  return { byOutlet, ourShare, primaryStore: best?.id ?? null };
}
