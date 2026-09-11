/**
 * The market engine: demand → gravity capture → supply caps → results.
 * Pure over the committed data plus scenario overrides, so a run is fast
 * and safe per request.
 */

import { haversineKm } from "../spatial/stats";
import { loadCompetitors, loadDcs, loadManifest, loadStores, loadTracts } from "../data/load";
import { allDemand } from "./demand";
import { captureForTract, outletsFrom } from "./gravity";
import { EMPTY_OVERRIDES, type ScenarioOverrides } from "./params";
import type {
  DcResult,
  DistributionCenter,
  MarketResult,
  ScenarioParams,
  Store,
  StoreResult,
} from "./types";

/** Existing stores minus closures, plus scenario additions, with DCs resolved. */
export function effectiveStores(overrides: ScenarioOverrides = EMPTY_OVERRIDES): Store[] {
  const removed = new Set(overrides.remove);
  const dcs = loadDcs();
  const nearestDc = (lon: number, lat: number) =>
    dcs.reduce((a, b) => (haversineKm(lon, lat, b.lon, b.lat) < haversineKm(lon, lat, a.lon, a.lat) ? b : a)).id;
  const base = loadStores().filter((s) => !removed.has(s.id));
  return [...base, ...overrides.add].map((s) => ({ ...s, dc: s.dc ?? nearestDc(s.lon, s.lat) }));
}

export function effectiveDcs(overrides: ScenarioOverrides = EMPTY_OVERRIDES): DistributionCenter[] {
  return loadDcs().map((dc) => {
    const capacity = { ...dc.capacity };
    for (const scale of overrides.capacityScale) {
      if (scale.dc !== dc.id) continue;
      for (const cat of Object.keys(capacity)) {
        const match =
          scale.category === "*" ||
          scale.category === cat ||
          (scale.category === "specialty:*" && cat.startsWith("specialty:"));
        if (match) capacity[cat] *= scale.factor;
      }
    }
    return { ...dc, capacity };
  });
}

/**
 * Pick segments for a specialty store with none specified: the strongest
 * specialty categories within reach, up to three.
 */
export function autoSegments(store: Store, params: ScenarioParams): string[] {
  const tracts = loadTracts().features.map((f) => f.properties);
  const demand = allDemand(tracts, params.demand);
  const totals = new Map<string, number>();
  tracts.forEach((t, i) => {
    if (haversineKm(store.lon, store.lat, t.cx, t.cy) > params.gravity.maxKm) return;
    for (const [cat, dollars] of Object.entries(demand[i].byCategory)) {
      if (!cat.startsWith("specialty:")) continue;
      totals.set(cat, (totals.get(cat) ?? 0) + dollars);
    }
  });
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat.replace("specialty:", ""));
}

export function runMarket(
  params: ScenarioParams,
  overrides: ScenarioOverrides = EMPTY_OVERRIDES
): MarketResult {
  const tracts = loadTracts().features.map((f) => f.properties);
  const manifest = loadManifest();
  const demand = allDemand(tracts, params.demand);
  const stores = effectiveStores(overrides).map((s) =>
    s.type === "specialty" && s.segments.length === 0 ? { ...s, segments: autoSegments(s, params) } : s
  );
  const dcs = effectiveDcs(overrides);
  const outlets = outletsFrom(stores, loadCompetitors());

  // ---- Capture -------------------------------------------------------------
  const storeDemand = new Map<string, Record<string, number>>(stores.map((s) => [s.id, {}]));
  const tractResults = tracts.map((t, i) => {
    const cap = captureForTract(t, demand[i], outlets, params.gravity);
    for (const s of stores) {
      const rec = cap.byOutlet.get(s.id);
      if (!rec) continue;
      const acc = storeDemand.get(s.id)!;
      for (const [cat, v] of Object.entries(rec)) acc[cat] = (acc[cat] ?? 0) + v;
    }
    return { ...demand[i], captured: cap.ourShare, primaryStore: cap.primaryStore };
  });

  // ---- Supply caps ---------------------------------------------------------
  const dcResults: DcResult[] = dcs.map((dc) => {
    const weeklyDemand: Record<string, number> = {};
    const members = stores.filter((s) => s.dc === dc.id);
    for (const s of members) {
      for (const [cat, v] of Object.entries(storeDemand.get(s.id)!)) {
        weeklyDemand[cat] = (weeklyDemand[cat] ?? 0) + v / 52;
      }
    }
    const fillRate: Record<string, number> = {};
    for (const cat of new Set([...Object.keys(weeklyDemand), ...Object.keys(dc.capacity)])) {
      const need = weeklyDemand[cat] ?? 0;
      const cap = dc.capacity[cat] ?? 0;
      fillRate[cat] = need <= 0 ? 1 : Math.min(1, cap / need);
    }
    return { id: dc.id, name: dc.name, weeklyDemand, capacity: dc.capacity, fillRate, stores: members.map((s) => s.id) };
  });
  const fillFor = (dcId: string, cat: string) => dcResults.find((d) => d.id === dcId)?.fillRate[cat] ?? 1;

  const storeResults: StoreResult[] = stores.map((s) => {
    const demandBy = storeDemand.get(s.id)!;
    const revenueBy: Record<string, number> = {};
    for (const [cat, v] of Object.entries(demandBy)) revenueBy[cat] = v * fillFor(s.dc!, cat);
    const d = sum(demandBy);
    const r = sum(revenueBy);
    return { id: s.id, name: s.name, type: s.type, dc: s.dc!, demandBy, demand: d, revenueBy, revenue: r, fillRate: d > 0 ? r / d : 1 };
  });

  // ---- Totals and segments ---------------------------------------------------
  const marketByCategory: Record<string, number> = {};
  for (const d of demand) for (const [cat, v] of Object.entries(d.byCategory)) marketByCategory[cat] = (marketByCategory[cat] ?? 0) + v;
  const marketDemand = sum(marketByCategory);
  const ourDemand = storeResults.reduce((a, s) => a + s.demand, 0);
  const ourRevenue = storeResults.reduce((a, s) => a + s.revenue, 0);

  const segments = manifest.segments.map((seg) => {
    const cat = `specialty:${seg.id}`;
    let markets = 0;
    let population = 0;
    tracts.forEach((t, i) => {
      if (demand[i].specialtySegments.includes(seg.id)) {
        markets++;
        population += t.pop;
      }
    });
    return { id: seg.id, label: seg.label, markets, population, demand: marketByCategory[cat] ?? 0 };
  });

  return {
    params,
    tracts: tractResults,
    stores: storeResults,
    dcs: dcResults,
    totals: { marketDemand, marketByCategory, ourDemand, ourRevenue, ourShare: marketDemand > 0 ? ourDemand / marketDemand : 0, lostToCaps: ourDemand - ourRevenue },
    segments,
  };
}

function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

// ---- Memoization -------------------------------------------------------------
const MAX_CACHED = 16;
const cache = new Map<string, MarketResult>();

export function runMarketCached(params: ScenarioParams, overrides: ScenarioOverrides = EMPTY_OVERRIDES): MarketResult {
  const key = JSON.stringify([params, overrides]);
  const hit = cache.get(key);
  if (hit) return hit;
  const result = runMarket(params, overrides);
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}
