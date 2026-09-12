/**
 * Site selection under a budget: which new general and specialty stores
 * add the most annual revenue, net of cannibalizing our own stores and
 * after supply caps?
 *
 * Greedy by revenue gain per dollar of capital. Each candidate is a tract
 * centroid with a store type; a specialty candidate carries the strongest
 * local segments. Gains are evaluated by re-running the market with the
 * candidate added, so cannibalization and caps are always included.
 * Candidates are pre-screened on uncaptured demand within reach that their
 * distribution center can still ship, to keep the full evaluations to a
 * short list per step.
 */

import { haversineKm } from "../spatial/stats";
import { loadDcs, loadTracts } from "../data/load";
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
  /** Most picks one run will make. A bound on run time, not a business rule: hitting it truncates the plan. */
  maxPicks?: number;
  /** Wall-clock bound on the whole run, so a request finishes inside its serverless timeout. Truncates like maxPicks. */
  timeBudgetMs?: number;
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
  /**
   * Why planning stopped: "budget" (nothing we may build still fits),
   * "minGain" (no shortlisted candidate cleared the minimum gain),
   * "exhausted" (every populated tract is already taken for every type we may
   * build, so no candidate is left at any price), or "maxPicks" (a run-time
   * bound cut the plan short — outOfTime says which).
   */
  stop: "budget" | "minGain" | "exhausted" | "maxPicks";
  /** True when the wall-clock budget, not the pick cap, ended a "maxPicks" run. */
  outOfTime: boolean;
  baseline: { ourRevenue: number; ourShare: number };
  after: { ourRevenue: number; ourShare: number };
}

/**
 * Screening weight for demand the candidate's distribution center cannot
 * ship. Small rather than zero so capped candidates still sort against each
 * other, which keeps the shortlist stable when every category is capped.
 */
const CAPPED_WEIGHT = 1e-3;

export function planSites(
  opts: SiteBudgetOptions,
  params: ScenarioParams,
  overrides: ScenarioOverrides
): SitePlan {
  const startedAt = Date.now();
  const tracts = loadTracts().features.map((f) => f.properties);
  const demand = allDemand(tracts, params.demand);
  const shortlist = opts.shortlist ?? 20;
  const minGain = opts.minGain ?? 10_000;
  const maxPicks = opts.maxPicks ?? 40;
  const deadline = startedAt + (opts.timeBudgetMs ?? 8_000);
  // A store with no dc of its own ships from the nearest one, the rule
  // effectiveStores applies, so a candidate's headroom is that center's.
  const dcs = loadDcs();
  const tractDc = tracts.map((t) =>
    dcs.reduce((a, b) =>
      haversineKm(t.cx, t.cy, b.lon, b.lat) < haversineKm(t.cx, t.cy, a.lon, a.lat) ? b : a
    ).id
  );

  let current: ScenarioOverrides = { ...overrides, add: [...overrides.add] };
  let base = runMarket(params, current);
  const baseline = { ourRevenue: base.totals.ourRevenue, ourShare: base.totals.ourShare };
  const picks: SitePick[] = [];
  let spent = 0;
  const used = new Set<string>();
  let stop: SitePlan["stop"] = "maxPicks";
  let outOfTime = false;

  for (let step = 0; step < maxPicks; step++) {
    if (Date.now() > deadline) {
      outOfTime = true;
      break;
    }
    const affordable = opts.types.filter((type) => spent + opts.costs[type] <= opts.budget);
    if (affordable.length === 0) {
      stop = "budget";
      break;
    }
    // Categories each center can still ship. Uncaptured demand in a category
    // whose center is already at capacity is unservable: winning it raises the
    // center's demand and lowers its fill rate, adding no revenue, so scoring
    // it like servable demand fills the shortlist with candidates that gain
    // nothing and ends planning while good sites remain.
    const headroom = new Map(
      base.dcs.map((d) => [
        d.id,
        new Set(Object.keys(d.capacity).filter((cat) => (d.weeklyDemand[cat] ?? 0) < d.capacity[cat])),
      ])
    );
    // Screen: uncaptured demand within reach of each tract, per type.
    const captured = new Map(base.tracts.map((t) => [t.geoid, t]));
    const screened: Array<{ type: StoreType; geoid: string; score: number }> = [];
    for (const type of affordable) {
      for (let i = 0; i < tracts.length; i++) {
        const t = tracts[i];
        if (t.pop === 0 || used.has(`${type}:${t.geoid}`)) continue;
        const room = headroom.get(tractDc[i])!;
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
            score += dollars * (1 - (c.captured[cat] ?? 0)) * w * (room.has(cat) ? 1 : CAPPED_WEIGHT);
          }
        }
        screened.push({ type, geoid: t.geoid, score });
      }
    }
    // Nothing left to screen means the region is built out, not that the best
    // remaining site was too small — reporting "minGain" here would send the
    // caller looking for a capacity problem that is not there.
    if (screened.length === 0) {
      stop = "exhausted";
      break;
    }
    // Shortlist per type, so cheaper-but-smaller specialty candidates are
    // always evaluated against the general ones on gain per dollar.
    const shortlisted = opts.types.flatMap((type) =>
      screened.filter((c) => c.type === type).sort((a, b) => b.score - a.score).slice(0, shortlist)
    );

    // Evaluate the shortlist fully.
    let best: { pick: SitePick; overrides: ScenarioOverrides; result: MarketResult; ratio: number } | null = null;
    for (const cand of shortlisted) {
      // Checked before each full market run, the unit of work that would
      // otherwise carry the request past its deadline.
      if (Date.now() > deadline) {
        outOfTime = true;
        break;
      }
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
    if (!best) {
      if (!outOfTime) stop = "minGain";
      break;
    }
    picks.push(best.pick);
    used.add(`${best.pick.store.type}:${best.pick.geoid}`);
    current = best.overrides;
    base = best.result;
    spent += best.pick.cost;
    // The pick above was evaluated in full, so it belongs in the plan even
    // though the clock ran out part-way through the shortlist.
    if (outOfTime) break;
  }

  return {
    options: opts,
    picks,
    spent,
    remaining: opts.budget - spent,
    stop,
    outOfTime,
    baseline,
    after: { ourRevenue: base.totals.ourRevenue, ourShare: base.totals.ourShare },
  };
}
