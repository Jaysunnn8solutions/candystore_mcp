/**
 * Supply-chain simulation: weekly orders per distribution center and
 * category over a planning horizon, with seasonality and random outages,
 * so the numbers handed to suppliers carry a range rather than a point.
 *
 * Each week, each DC may start an outage (probability per week, random
 * length). While a DC is out, the volume it could have shipped healthy
 * reroutes to the other DCs' spare capacity for that category; whatever
 * cannot be rerouted is lost revenue, and so is any week's need above a
 * DC's own cap — per-DC caps are hard here exactly as they are in
 * runMarket, so an outage can never raise network throughput. Monte Carlo
 * over many runs with a fixed seed gives mean and p10/p90 orders per
 * category, a per-DC mean and observed peak, and expected lost revenue.
 */

import { seededRandom } from "../spatial/stats";
import type { MarketResult } from "./types";

export interface SimulationOptions {
  weeks: number;
  runs: number;
  /** Probability that a given DC starts an outage in a given week. */
  outageProbability: number;
  /** Outage length in weeks, uniform between these bounds. */
  outageWeeks: [number, number];
  /** Starting calendar week (1–52) for seasonality alignment. */
  startWeek: number;
  seed: number;
}

export const DEFAULT_SIMULATION: SimulationOptions = {
  weeks: 26,
  runs: 300,
  outageProbability: 0.03,
  outageWeeks: [1, 3],
  startWeek: 36,
  seed: 7,
};

/** Seasonal index by ISO-ish week of year. Candy peaks are well known. */
export function seasonIndex(week: number): number {
  const w = ((week - 1) % 52) + 1;
  if (w >= 42 && w <= 44) return w === 44 ? 2.4 : 1.6; // run-up to Halloween, peak week 44
  if (w >= 49 && w <= 52) return w >= 51 ? 1.9 : 1.4; // Christmas
  if (w === 6 || w === 7) return 1.7; // Valentine's
  if (w >= 13 && w <= 15) return 1.4; // Easter (approximate)
  if (w === 1) return 0.7;
  return 1;
}

/**
 * Mean of seasonIndex across a full year, derived from the function so it
 * stays right if the shape is edited. The published values are ratios
 * between weeks ("2.4x at Halloween"), which puts their mean above 1;
 * weekly need is an average week, so the index has to be divided by this
 * to redistribute the annual captured demand instead of inflating it.
 */
export const SEASON_MEAN =
  Array.from({ length: 52 }, (_, i) => seasonIndex(i + 1)).reduce((a, b) => a + b, 0) / 52;

export interface WeeklyOrder {
  week: number;
  calendarWeek: number;
  /** dc id → category → dollars (mean over runs). */
  mean: Record<string, Record<string, number>>;
  p10: Record<string, Record<string, number>>;
  p90: Record<string, Record<string, number>>;
  /**
   * dc id → whole-DC dollars summed across categories within each run.
   * Outages are rare enough that p10 and p90 of such a total both land on
   * the no-outage point mass, so this carries the observed maximum instead:
   * the reroute load capacity actually has to absorb, and never below mean.
   */
  total: Record<string, { mean: number; p50: number; peak: number }>;
  /** Expected lost revenue this week from outages and caps. */
  lost: number;
}

export interface SimulationResult {
  options: SimulationOptions;
  weekly: WeeklyOrder[];
  totals: {
    expectedOrders: Record<string, Record<string, number>>;
    expectedLost: number;
    /** Share of runs in which each DC had at least one outage. */
    outageRuns: Record<string, number>;
    horizonRevenue: number;
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function simulate(market: MarketResult, opts: SimulationOptions = DEFAULT_SIMULATION): SimulationResult {
  const rng = seededRandom(opts.seed);
  const dcs = market.dcs;
  const cats = [...new Set(dcs.flatMap((d) => [...Object.keys(d.weeklyDemand), ...Object.keys(d.capacity)]))];

  // samples[week][dc][cat] = array over runs
  const samples: number[][][][] = Array.from({ length: opts.weeks }, () =>
    dcs.map(() => cats.map(() => []))
  );
  // totalSamples[week][dc] = array over runs, summed across categories
  const totalSamples: number[][][] = Array.from({ length: opts.weeks }, () => dcs.map(() => []));
  const lostSamples: number[][] = Array.from({ length: opts.weeks }, () => []);
  const outageRuns = dcs.map(() => 0);

  for (let run = 0; run < opts.runs; run++) {
    const outUntil = dcs.map(() => -1);
    const hadOutage = dcs.map(() => false);
    for (let w = 0; w < opts.weeks; w++) {
      const season = seasonIndex(opts.startWeek + w) / SEASON_MEAN;
      // Start outages.
      dcs.forEach((_, i) => {
        if (outUntil[i] < w && rng() < opts.outageProbability) {
          const len = opts.outageWeeks[0] + Math.floor(rng() * (opts.outageWeeks[1] - opts.outageWeeks[0] + 1));
          outUntil[i] = w + len - 1;
          hadOutage[i] = true;
        }
      });
      const isOut = dcs.map((_, i) => outUntil[i] >= w);
      let lost = 0;
      const shippedTotal = dcs.map(() => 0);
      cats.forEach((cat, c) => {
        const need = dcs.map((d) => (d.weeklyDemand[cat] ?? 0) * season);
        const cap = dcs.map((d) => d.capacity[cat] ?? 0);
        const shipped = dcs.map((_, i) => (isOut[i] ? 0 : Math.min(need[i], cap[i])));
        // Need above a DC's own cap is a structural shortfall, lost whether or
        // not anything is out, so only what a DC could have shipped healthy
        // goes looking for another home — and only for a DC that is out. Pool
        // the two and a center with spare capacity would quietly ship the
        // other's overflow, which would make the per-DC cap no cap at all and
        // let an outage week move more volume than a calm one.
        let reroutable = 0;
        dcs.forEach((_, i) => {
          lost += Math.max(0, need[i] - cap[i]);
          if (isOut[i]) reroutable += Math.min(need[i], cap[i]);
        });
        dcs.forEach((_, i) => {
          if (isOut[i] || reroutable <= 0) return;
          const spare = Math.max(0, cap[i] - shipped[i]);
          const take = Math.min(spare, reroutable);
          shipped[i] += take;
          reroutable -= take;
        });
        lost += reroutable;
        dcs.forEach((_, i) => {
          samples[w][i][c].push(shipped[i]);
          shippedTotal[i] += shipped[i];
        });
      });
      dcs.forEach((_, i) => totalSamples[w][i].push(shippedTotal[i]));
      lostSamples[w].push(lost);
    }
    hadOutage.forEach((h, i) => {
      if (h) outageRuns[i]++;
    });
  }

  const weekly: WeeklyOrder[] = samples.map((byDc, w) => {
    const mean: Record<string, Record<string, number>> = {};
    const p10: Record<string, Record<string, number>> = {};
    const p90: Record<string, Record<string, number>> = {};
    dcs.forEach((d, i) => {
      mean[d.id] = {};
      p10[d.id] = {};
      p90[d.id] = {};
      cats.forEach((cat, c) => {
        const arr = [...byDc[i][c]].sort((a, b) => a - b);
        const m = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
        if (m === 0 && quantile(arr, 0.9) === 0) return;
        mean[d.id][cat] = Math.round(m);
        p10[d.id][cat] = Math.round(quantile(arr, 0.1));
        p90[d.id][cat] = Math.round(quantile(arr, 0.9));
      });
    });
    const total: Record<string, { mean: number; p50: number; peak: number }> = {};
    dcs.forEach((d, i) => {
      const arr = totalSamples[w][i];
      const sorted = [...arr].sort((a, b) => a - b);
      total[d.id] = {
        mean: Math.round(arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length)),
        p50: Math.round(quantile(sorted, 0.5)),
        peak: Math.round(arr.reduce((a, b) => Math.max(a, b), 0)),
      };
    });
    const lostArr = lostSamples[w];
    return {
      week: w + 1,
      calendarWeek: ((opts.startWeek + w - 1) % 52) + 1,
      mean,
      p10,
      p90,
      total,
      lost: Math.round(lostArr.reduce((a, b) => a + b, 0) / Math.max(1, lostArr.length)),
    };
  });

  const expectedOrders: Record<string, Record<string, number>> = {};
  let horizonRevenue = 0;
  for (const d of dcs) {
    expectedOrders[d.id] = {};
    for (const cat of cats) {
      const total = weekly.reduce((s, wk) => s + (wk.mean[d.id][cat] ?? 0), 0);
      if (total > 0) expectedOrders[d.id][cat] = total;
      horizonRevenue += total;
    }
  }
  const expectedLost = weekly.reduce((s, wk) => s + wk.lost, 0);

  return {
    options: opts,
    weekly,
    totals: {
      expectedOrders,
      expectedLost,
      outageRuns: Object.fromEntries(dcs.map((d, i) => [d.id, outageRuns[i] / opts.runs])),
      horizonRevenue,
    },
  };
}
