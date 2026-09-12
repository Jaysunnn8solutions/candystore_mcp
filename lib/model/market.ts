/**
 * The market engine: demand → gravity capture → supply caps → results.
 * Pure over the committed data plus scenario overrides, so a run is fast
 * and safe per request.
 */

import { ZodRealError, type core } from "zod";
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

/**
 * An added store naming a distribution center or a segment that does not
 * exist would look ordinary and report nonsense: an unknown dc belongs to no
 * center, so no supply cap reaches the store and its fill rate reads 100%,
 * and an unknown segment maps to a category no tract spends on, so the store
 * earns nothing and nothing says why. Both are caller mistakes, so they are
 * raised as zod issues: the JSON routes turn those into a 400 with the issues
 * and the MCP tools into an error the model can correct. ZodRealError is the
 * Error subclass zod itself throws, so layers that test `instanceof Error`
 * still find a message and a stack.
 */
function checkAddedStores(added: Store[], dcs: DistributionCenter[]): void {
  const dcIds = dcs.map((d) => d.id);
  const segmentIds = loadManifest().segments.map((s) => s.id);
  const issues: core.$ZodIssue[] = [];
  added.forEach((s, i) => {
    if (s.dc != null && !dcIds.includes(s.dc)) {
      issues.push({
        code: "custom",
        path: ["add", i, "dc"],
        message: `Unknown distribution center "${s.dc}". Known: ${dcIds.join(", ")}. Omit dc to use the nearest one.`,
      });
    }
    const unknown = s.segments.filter((seg) => !segmentIds.includes(seg));
    if (unknown.length > 0) {
      issues.push({
        code: "custom",
        path: ["add", i, "segments"],
        message: `Unknown segment ${unknown.map((seg) => `"${seg}"`).join(", ")}. Known: ${segmentIds.join(", ")}.`,
      });
    }
  });
  if (issues.length > 0) throw new ZodRealError(issues);
}

/** Existing stores minus closures, plus scenario additions, with DCs resolved. */
export function effectiveStores(overrides: ScenarioOverrides = EMPTY_OVERRIDES): Store[] {
  const removed = new Set(overrides.remove);
  const dcs = loadDcs();
  checkAddedStores(overrides.add, dcs);
  const nearestDc = (lon: number, lat: number) =>
    dcs.reduce((a, b) => (haversineKm(lon, lat, b.lon, b.lat) < haversineKm(lon, lat, a.lon, a.lat) ? b : a)).id;
  const base = loadStores().filter((s) => !removed.has(s.id));
  return [...base, ...overrides.add].map((s) => ({ ...s, dc: s.dc ?? nearestDc(s.lon, s.lat) }));
}

/** The two wildcards the capacity loop below matches, beyond a literal category. */
const CATEGORY_WILDCARDS = ["*", "specialty:*"];

export function effectiveDcs(overrides: ScenarioOverrides = EMPTY_OVERRIDES): DistributionCenter[] {
  const dcs = loadDcs();
  const categories = [...new Set(dcs.flatMap((dc) => Object.keys(dc.capacity)))];
  // A scale naming a center or a category that does not exist would simply
  // never apply, while the response still echoes it — a typo would read as
  // "capacity scaled" beside "no distribution center is at capacity".
  const issues: core.$ZodIssue[] = [];
  overrides.capacityScale.forEach((scale, i) => {
    if (!dcs.some((dc) => dc.id === scale.dc)) {
      issues.push({
        code: "custom",
        path: ["capacityScale", i, "dc"],
        message: `Unknown distribution center "${scale.dc}". Known: ${dcs.map((d) => d.id).join(", ")}.`,
      });
    }
    if (!categories.includes(scale.category) && !CATEGORY_WILDCARDS.includes(scale.category)) {
      issues.push({
        code: "custom",
        path: ["capacityScale", i, "category"],
        message: `Unknown category "${scale.category}". Known: ${[...categories, ...CATEGORY_WILDCARDS].join(", ")}.`,
      });
    }
  });
  if (issues.length > 0) throw new ZodRealError(issues);
  return dcs.map((dc) => {
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
 *
 * Memoized on everything the answer depends on, because each miss prices
 * every tract in the region: find_sites evaluates the same candidate sites
 * step after step, and each of its hundreds of market runs re-resolves the
 * scenario's own segment-less stores.
 */
export function autoSegments(store: Store, params: ScenarioParams): string[] {
  const key = JSON.stringify([store.lon, store.lat, params.gravity.maxKm, params.demand]);
  const hit = segmentsCache.get(key);
  if (hit) return hit;
  const picked = computeAutoSegments(store, params);
  if (segmentsCache.size >= MAX_CACHED_SEGMENTS) {
    const oldest = segmentsCache.keys().next().value;
    if (oldest !== undefined) segmentsCache.delete(oldest);
  }
  segmentsCache.set(key, picked);
  return picked;
}

/** Exported so a test can check the memo above answers what an uncached run would. */
export function computeAutoSegments(store: Store, params: ScenarioParams): string[] {
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

/**
 * Fill in the segments of every specialty store that named none.
 *
 * An auto-pick can come back empty: no heritage segment reaches critical mass
 * anywhere within the store's reach. Left alone that store carries nothing,
 * so it captures nothing and reports $0 revenue at a 100% fill rate, which
 * reads like a perfectly supplied store rather than a store in the wrong
 * place. It is a siting mistake, so it is raised the same way an unknown dc
 * or an unknown segment is. The optimizer never reaches here with one: it
 * calls autoSegments itself and drops a candidate whose pick is empty.
 */
function resolveSegments(stores: Store[], params: ScenarioParams, addedCount: number): Store[] {
  // effectiveStores returns the surviving existing stores followed by the
  // scenario's own, so anything from this index on came from `add`.
  const firstAdded = stores.length - addedCount;
  const issues: core.$ZodIssue[] = [];
  const resolved = stores.map((s, i) => {
    if (s.type !== "specialty" || s.segments.length > 0) return s;
    const segments = autoSegments(s, params);
    if (segments.length === 0) {
      issues.push({
        code: "custom",
        path: i >= firstAdded ? ["add", i - firstAdded, "segments"] : ["stores", s.id, "segments"],
        message:
          `No heritage segment reaches critical mass within ${params.gravity.maxKm} km of ` +
          `${s.name} (lat ${s.lat}, lon ${s.lon}), so a specialty store there would carry nothing ` +
          `and earn nothing. Site it nearer a segment market — segment_markets lists them — or ` +
          `name its segments explicitly.`,
      });
    }
    return { ...s, segments };
  });
  if (issues.length > 0) throw new ZodRealError(issues);
  return resolved;
}

export function runMarket(
  params: ScenarioParams,
  overrides: ScenarioOverrides = EMPTY_OVERRIDES
): MarketResult {
  const tracts = loadTracts().features.map((f) => f.properties);
  const manifest = loadManifest();
  const demand = allDemand(tracts, params.demand);
  const stores = resolveSegments(effectiveStores(overrides), params, overrides.add.length);
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
    return { id: s.id, name: s.name, type: s.type, dc: s.dc!, segments: s.segments, demandBy, demand: d, revenueBy, revenue: r, fillRate: d > 0 ? r / d : 1 };
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
    totals: { marketDemand, marketByCategory, ourDemand, ourRevenue, ourShare: marketDemand > 0 ? ourRevenue / marketDemand : 0, lostToCaps: ourDemand - ourRevenue },
    segments,
  };
}

function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

// ---- Memoization -------------------------------------------------------------
const MAX_CACHED = 16;
const cache = new Map<string, MarketResult>();

// Far larger bound than the market cache: an entry is a key plus up to three
// segment ids, and one find_sites run asks about the scenario's own stores
// plus up to 800 candidate sites. Evicting inside a run would put the work
// straight back.
const MAX_CACHED_SEGMENTS = 2048;
const segmentsCache = new Map<string, string[]>();

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
