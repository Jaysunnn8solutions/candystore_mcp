/**
 * Site selection under a budget: which new general and specialty stores
 * add the most annual revenue, net of cannibalizing our own stores and
 * after supply caps?
 *
 * Greedy by revenue gain per dollar of capital. Each candidate is a tract
 * centroid with a store type; a specialty candidate carries the strongest
 * local segments. Gains are evaluated by re-running the market with the
 * candidate added, so cannibalization and caps are always included.
 * Candidates are pre-screened on uncaptured demand within reach to keep
 * the full evaluations to a short list per step.
 */

import { haversineKm } from "../spatial/stats";
import { loadTracts } from "../data/load";
import { allDemand } from "./demand";
import { autoSegments, runMarket } from "./market";
import type { ScenarioOverrides } from "./params";
import type { MarketResult, ScenarioParams, Store, StoreType } from "./types";

export interface SiteBudgetOptions {
  budget: number;
  costs: Record<StoreType, number>;
  /** Which store types may be built. */
  types: StoreType[];
  /** How many screened candidates get a full evaluation per step. */
  shortlist?: number;
  /** Stop when the best remaining candidate adds less than this annual revenue. */
  minGain?: number;
}

import { DEFAULT_STORE_COSTS } from "./optimizer-defaults";
export { DEFAULT_STORE_COSTS };

export interface SitePick {
  store: Store;
  geoid: string;
  tractName: string;
  place: string;
  county: string;
  cost: number;
  /** Annual revenue added to the chain, net of cannibalization and caps. */
  gain: number;
  /** Revenue this store itself takes. */
  storeRevenue: number;
  /** Revenue pulled from our other stores. */
  cannibalized: number;
  step: number;
}

export interface SitePlan {
  options: SiteBudgetOptions;
  picks: SitePick[];
  spent: number;
  remaining: number;
  baseline: { ourRevenue: number; ourShare: number };
  after: { ourRevenue: number; ourShare: number };
}

export function planSites(
  opts: SiteBudgetOptions,
  params: ScenarioParams,
  overrides: ScenarioOverrides
): SitePlan {
  const tracts = loadTracts().features.map((f) => f.properties);
  const demand = allDemand(tracts, params.demand);
  const shortlist = opts.shortlist ?? 20;
  const minGain = opts.minGain ?? 10_000;

  let current: ScenarioOverrides = { ...overrides, add: [...overrides.add] };
  let base = runMarket(params, current);
  const baseline = { ourRevenue: base.totals.ourRevenue, ourShare: base.totals.ourShare };
  const picks: SitePick[] = [];
  let spent = 0;
  const used = new Set<string>();

  for (let step = 0; step < 40; step++) {
    // Screen: uncaptured demand within reach of each tract, per type.
    const captured = new Map(base.tracts.map((t) => [t.geoid, t]));
    const screened: Array<{ type: StoreType; geoid: string; score: number }> = [];
    for (const type of opts.types) {
      const cost = opts.costs[type];
      if (spent + cost > opts.budget) continue;
      for (let i = 0; i < tracts.length; i++) {
        const t = tracts[i];
        if (t.pop === 0 || used.has(`${type}:${t.geoid}`)) continue;
        let score = 0;
        for (let j = 0; j < tracts.length; j++) {
          const u = tracts[j];
          if (Math.abs(u.cy - t.cy) > params.gravity.maxKm / 110) continue;
          const d = haversineKm(t.cx, t.cy, u.cx, u.cy);
          if (d > params.gravity.maxKm) continue;
          const c = captured.get(u.geoid)!;
          const w = 1 / Math.pow(Math.max(d, 0.3), params.gravity.beta);
          for (const [cat, dollars] of Object.entries(demand[j].byCategory)) {
            const isSpecialty = cat.startsWith("specialty:");
            if ((type === "general") === isSpecialty) continue;
            score += dollars * (1 - (c.captured[cat] ?? 0)) * w;
          }
        }
        screened.push({ type, geoid: t.geoid, score });
      }
    }
    if (screened.length === 0) break;
    // Shortlist per type, so cheaper-but-smaller specialty candidates are
    // always evaluated against the general ones on gain per dollar.
    const shortlisted = opts.types.flatMap((type) =>
      screened.filter((c) => c.type === type).sort((a, b) => b.score - a.score).slice(0, shortlist)
    );

    // Evaluate the shortlist fully.
    let best: { pick: SitePick; overrides: ScenarioOverrides; result: MarketResult; ratio: number } | null = null;
    for (const cand of shortlisted) {
      const t = tracts.find((x) => x.geoid === cand.geoid)!;
      const store: Store = {
        id: `plan-${step}-${cand.type}-${cand.geoid}`,
        name: `Proposed ${cand.type} near ${t.name}`,
        type: cand.type,
        lon: t.cx,
        lat: t.cy,
        size: 1,
        segments: [],
        proposed: true,
      };
      if (cand.type === "specialty") {
        store.segments = autoSegments(store, params);
        if (store.segments.length === 0) continue;
      }
      const trial: ScenarioOverrides = { ...current, add: [...current.add, store] };
      const result = runMarket(params, trial);
      const gain = result.totals.ourRevenue - base.totals.ourRevenue;
      const storeRevenue = result.stores.find((s) => s.id === store.id)?.revenue ?? 0;
      const cost = opts.costs[cand.type];
      const ratio = gain / cost;
      if (gain >= minGain && (!best || ratio > best.ratio)) {
        best = {
          pick: { store, geoid: cand.geoid, tractName: t.name, place: t.place, county: t.county, cost, gain, storeRevenue, cannibalized: Math.max(0, storeRevenue - gain), step: step + 1 },
          overrides: trial,
          result,
          ratio,
        };
      }
    }
    if (!best) break;
    picks.push(best.pick);
    used.add(`${best.pick.store.type}:${best.pick.geoid}`);
    current = best.overrides;
    base = best.result;
    spent += best.pick.cost;
  }

  return {
    options: opts,
    picks,
    spent,
    remaining: opts.budget - spent,
    baseline,
    after: { ourRevenue: base.totals.ourRevenue, ourShare: base.totals.ourShare },
  };
}
