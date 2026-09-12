import { describe, expect, it } from "vitest";
import { autoSegments, computeAutoSegments, runMarket } from "./market";
import { DEFAULT_STORE_COSTS, planSites } from "./optimizer";
import {
  DEFAULT_DEMAND,
  DEFAULT_GRAVITY,
  DEFAULT_PARAMS,
  EMPTY_OVERRIDES,
  parseOverrides,
} from "./params";
import { DEFAULT_SIMULATION, seasonIndex, simulate } from "./simulate";
import type { ScenarioParams, Store } from "./types";

describe("runMarket on committed data", () => {
  const started = performance.now();
  const m = runMarket(DEFAULT_PARAMS);
  const elapsed = performance.now() - started;

  it("scores every tract and store quickly", () => {
    expect(m.tracts).toHaveLength(1200);
    expect(m.stores).toHaveLength(5);
    expect(elapsed).toBeLessThan(3000);
  });

  it("produces a plausible market and a small share for five stores", () => {
    expect(m.totals.marketDemand).toBeGreaterThan(100_000_000);
    expect(m.totals.ourShare).toBeGreaterThan(0.005);
    expect(m.totals.ourShare).toBeLessThan(0.3);
    expect(m.totals.ourRevenue).toBeLessThanOrEqual(m.totals.ourDemand);
  });

  it("finds specialty markets for the big segments", () => {
    const byId = Object.fromEntries(m.segments.map((s) => [s.id, s]));
    expect(byId.latam.markets).toBeGreaterThan(100);
    expect(byId.eastasia.markets).toBeGreaterThan(50);
    expect(byId.easteurope.markets).toBe(0);
  });

  it("closing a store removes its revenue and adding one adds some", () => {
    const closed = runMarket(DEFAULT_PARAMS, { ...EMPTY_OVERRIDES, remove: ["s1"] });
    expect(closed.stores.find((s) => s.id === "s1")).toBeUndefined();
    expect(closed.totals.ourRevenue).toBeLessThan(m.totals.ourRevenue);
    const added = runMarket(
      DEFAULT_PARAMS,
      parseOverrides({ add: [{ type: "specialty", lon: -84.16, lat: 33.95, segments: [] }] })
    );
    const s = added.stores.find((x) => x.id === "new-0")!;
    expect(s.demand).toBeGreaterThan(0);
    expect(added.totals.ourRevenue).toBeGreaterThan(m.totals.ourRevenue);
  });

  it("supply caps reduce revenue below demand when a DC is squeezed", () => {
    const squeezed = runMarket(DEFAULT_PARAMS, {
      ...EMPTY_OVERRIDES,
      capacityScale: [{ dc: "dc-east", category: "*", factor: 0.05 }],
    });
    const dc = squeezed.dcs.find((d) => d.id === "dc-east")!;
    expect(Math.min(...Object.values(dc.fillRate))).toBeLessThan(1);
    expect(squeezed.totals.lostToCaps).toBeGreaterThan(m.totals.lostToCaps);
  });
});

describe("planSites", () => {
  it("spends within budget and adds revenue net of cannibalization", () => {
    const started = performance.now();
    const plan = planSites(
      { budget: 5_000_000, costs: DEFAULT_STORE_COSTS, types: ["general", "specialty"], shortlist: 6 },
      DEFAULT_PARAMS,
      EMPTY_OVERRIDES
    );
    const elapsed = performance.now() - started;
    expect(plan.spent).toBeLessThanOrEqual(5_000_000);
    expect(plan.picks.length).toBeGreaterThan(0);
    expect(plan.after.ourRevenue).toBeGreaterThan(plan.baseline.ourRevenue);
    for (const p of plan.picks) {
      expect(p.gain).toBeGreaterThan(0);
      expect(p.cannibalized).toBeGreaterThanOrEqual(0);
    }
    expect(elapsed).toBeLessThan(30_000);
  });
});

describe("simulate", () => {
  const base = runMarket(DEFAULT_PARAMS);

  it("has candy seasonality peaks", () => {
    expect(seasonIndex(44)).toBeGreaterThan(seasonIndex(30));
    expect(seasonIndex(51)).toBeGreaterThan(1.5);
  });

  it("produces weekly orders with ranges and is reproducible", () => {
    const m = runMarket(DEFAULT_PARAMS);
    const a = simulate(m, { ...DEFAULT_SIMULATION, runs: 50, weeks: 8 });
    const b = simulate(m, { ...DEFAULT_SIMULATION, runs: 50, weeks: 8 });
    expect(a.weekly).toHaveLength(8);
    expect(a.totals.horizonRevenue).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // The whole-DC total is what the tool reports, so its mean can never
    // exceed its peak, and a reroute spike has to land somewhere across
    // eight weeks of outages or the peak is measuring nothing.
    let spiked = 0;
    for (const wk of a.weekly) {
      for (const dc of Object.keys(wk.total)) {
        expect(wk.total[dc].mean).toBeLessThanOrEqual(wk.total[dc].peak);
        if (wk.total[dc].peak > wk.total[dc].mean) spiked++;
      }
      for (const dc of Object.keys(wk.mean)) {
        for (const cat of Object.keys(wk.mean[dc])) {
          expect(wk.p10[dc][cat]).toBeLessThanOrEqual(wk.p90[dc][cat]);
          expect(wk.mean[dc][cat]).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(spiked).toBeGreaterThan(0);
  });

  it("keeps per-center caps hard, so an outage cannot raise throughput", () => {
    const calm = simulate(base, { ...DEFAULT_SIMULATION, runs: 1, weeks: 26, outageProbability: 0 });
    const rough = simulate(base, { ...DEFAULT_SIMULATION, runs: 200, weeks: 26, outageProbability: 0.1 });
    expect(rough.totals.horizonRevenue).toBeLessThan(calm.totals.horizonRevenue);
    expect(rough.totals.expectedLost).toBeGreaterThan(calm.totals.expectedLost);
  });

  it("books a calm year's cap shortfall as runMarket does, bar the convexity term", () => {
    const squeezed = runMarket(DEFAULT_PARAMS, {
      ...EMPTY_OVERRIDES,
      capacityScale: [{ dc: "dc-east", category: "*", factor: 0.05 }],
    });
    const year = simulate(squeezed, {
      ...DEFAULT_SIMULATION,
      runs: 1,
      weeks: 52,
      startWeek: 1,
      outageProbability: 0,
    });
    // With nothing out, all that is left is each center's own shortfall, which
    // is what lostToCaps measures. The seasonal index redistributes the year
    // rather than adding to it, but a week's shortfall is max(0, need × index −
    // cap), and clipping at zero week by week loses slightly more than clipping
    // once at the average week: measured $9,824,798 against lostToCaps
    // $9,823,327, a $1,471 convexity term the tolerance below covers.
    expect(year.totals.expectedLost / squeezed.totals.lostToCaps).toBeCloseTo(1, 3);
  });

  it("redistributes the year rather than inflating it", () => {
    const year = simulate(base, {
      ...DEFAULT_SIMULATION,
      runs: 1,
      weeks: 52,
      startWeek: 1,
      outageProbability: 0,
    });
    // Shipped plus lost is the demand the stores captured, so a calm year has
    // to account for the annual figure rather than the 14% more that an
    // un-normalized seasonal index used to hand suppliers.
    expect((year.totals.horizonRevenue + year.totals.expectedLost) / base.totals.ourDemand).toBeCloseTo(1, 4);
    // Revenue lands just under the annual figure because the Halloween and
    // Christmas weeks run past dc-east's weekly capacity — a real shortfall
    // that runMarket cannot see, because it compares an average week to it.
    expect(year.totals.horizonRevenue / base.totals.ourRevenue).toBeGreaterThan(0.99);
    expect(year.totals.horizonRevenue).toBeLessThan(base.totals.ourRevenue);
  });

  it("loses more when outages are frequent", () => {
    const m = runMarket(DEFAULT_PARAMS);
    const calm = simulate(m, { ...DEFAULT_SIMULATION, runs: 100, weeks: 12, outageProbability: 0 });
    const rough = simulate(m, { ...DEFAULT_SIMULATION, runs: 100, weeks: 12, outageProbability: 0.3 });
    expect(calm.totals.expectedLost).toBeLessThanOrEqual(rough.totals.expectedLost);
  });
});

/**
 * A scenario mistake that the engine answers instead of refusing is the worst
 * kind of bug this model can have: it returns 200 with a confident number and
 * nothing says the number is meaningless. Each case below was once reachable.
 */
describe("scenario mistakes are refused, not answered", () => {
  it("refuses a store naming a distribution center that does not exist", () => {
    expect(() =>
      runMarket(
        DEFAULT_PARAMS,
        parseOverrides({ add: [{ type: "general", lon: -84.383, lat: 33.7816, dc: "dc-north" }] })
      )
    ).toThrowError(/Unknown distribution center .*dc-north[\s\S]*dc-west, dc-east/);
  });

  it("refuses a store naming a segment that does not exist", () => {
    expect(() =>
      runMarket(
        DEFAULT_PARAMS,
        parseOverrides({
          add: [{ type: "specialty", lon: -84.275, lat: 33.888, segments: ["eastasia", "nossuch"] }],
        })
      )
    ).toThrowError(/Unknown segment .*nossuch[\s\S]*latam/);
  });

  it("refuses a capacity scale naming a distribution center that does not exist", () => {
    expect(() =>
      runMarket(DEFAULT_PARAMS, {
        ...EMPTY_OVERRIDES,
        capacityScale: [{ dc: "dc-north", category: "*", factor: 0.01 }],
      })
    ).toThrowError(/Unknown distribution center .*dc-north/);
  });

  it("refuses a capacity scale naming a category that does not exist", () => {
    expect(() =>
      runMarket(DEFAULT_PARAMS, {
        ...EMPTY_OVERRIDES,
        capacityScale: [{ dc: "dc-east", category: "traditonal", factor: 0.01 }],
      })
    ).toThrowError(
      /Unknown category .*traditonal[\s\S]*traditional[\s\S]*specialty:latam[\s\S]*specialty:\*/
    );
  });

  it("accepts both wildcards, and scales only what each one covers", () => {
    const all = runMarket(DEFAULT_PARAMS, {
      ...EMPTY_OVERRIDES,
      capacityScale: [{ dc: "dc-east", category: "*", factor: 0.5 }],
    }).dcs.find((d) => d.id === "dc-east")!;
    const spec = runMarket(DEFAULT_PARAMS, {
      ...EMPTY_OVERRIDES,
      capacityScale: [{ dc: "dc-east", category: "specialty:*", factor: 0.5 }],
    }).dcs.find((d) => d.id === "dc-east")!;
    expect(all.capacity.traditional).toBe(160_000);
    expect(spec.capacity.traditional).toBe(320_000);
    expect(spec.capacity["specialty:latam"]).toBe(all.capacity["specialty:latam"]);
  });

  it("refuses a specialty store where no segment reaches critical mass in reach", () => {
    const nowhere: Store = {
      id: "probe",
      name: "Nowhere Specialty",
      type: "specialty",
      lon: -84.8,
      lat: 33.4,
      size: 1,
      segments: [],
    };
    expect(autoSegments(nowhere, DEFAULT_PARAMS)).toEqual([]);
    expect(() =>
      runMarket(
        DEFAULT_PARAMS,
        parseOverrides({ add: [{ type: "specialty", lon: -84.8, lat: 33.4, segments: [] }] })
      )
    ).toThrowError(/No heritage segment reaches critical mass within 8 km/);
  });

  it("lets the optimizer drop such a candidate rather than failing the plan", () => {
    // A budget far past what the region can absorb, so the shortlist reaches
    // well down the tract list where empty auto-picks live.
    const plan = planSites(
      { budget: 100_000_000, costs: DEFAULT_STORE_COSTS, types: ["general", "specialty"] },
      DEFAULT_PARAMS,
      EMPTY_OVERRIDES
    );
    expect(plan.picks.length).toBeGreaterThan(0);
    for (const p of plan.picks) {
      if (p.store.type === "specialty") expect(p.store.segments.length).toBeGreaterThan(0);
    }
  }, 120_000);
});

describe("totals and auto-picked segments", () => {
  it("reports ourShare as revenue over market demand, and moves it when supply alone changes", () => {
    const m = runMarket(DEFAULT_PARAMS);
    const squeezed = runMarket(DEFAULT_PARAMS, {
      ...EMPTY_OVERRIDES,
      capacityScale: [{ dc: "dc-east", category: "*", factor: 0.05 }],
    });
    expect(m.totals.ourShare).toBeCloseTo(m.totals.ourRevenue / m.totals.marketDemand, 12);
    expect(squeezed.totals.ourShare).toBeCloseTo(
      squeezed.totals.ourRevenue / squeezed.totals.marketDemand,
      12
    );
    // Same stores and same demand, so only the supplied half of the ratio can
    // move — which is the point of measuring share on revenue rather than on
    // captured demand.
    expect(squeezed.totals.marketDemand).toBeCloseTo(m.totals.marketDemand, 6);
    expect(squeezed.totals.ourDemand).toBeCloseTo(m.totals.ourDemand, 6);
    expect(squeezed.totals.ourShare).toBeLessThan(m.totals.ourShare);
  });

  it("clamps a negative outside option instead of flipping or exploding shares", () => {
    const negative = runMarket({
      ...DEFAULT_PARAMS,
      gravity: { ...DEFAULT_GRAVITY, outsideOption: -0.5 },
    });
    const shares = negative.tracts.flatMap((t) => Object.values(t.captured));
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...shares)).toBeLessThanOrEqual(1 + 1e-9);
    // Clamping at zero is the same market as asking for no outside option.
    const zero = runMarket({ ...DEFAULT_PARAMS, gravity: { ...DEFAULT_GRAVITY, outsideOption: 0 } });
    expect(negative.totals.ourRevenue).toBeCloseTo(zero.totals.ourRevenue, 6);
  });

  it("carries the resolved auto-pick on the store result", () => {
    const overrides = parseOverrides({
      add: [{ type: "specialty", lon: -84.275, lat: 33.888, segments: [] }],
    });
    const picked = autoSegments(overrides.add[0], DEFAULT_PARAMS);
    expect(picked.length).toBeGreaterThan(0);
    const s = runMarket(DEFAULT_PARAMS, overrides).stores.find((x) => x.id === "new-0")!;
    expect(s.segments).toEqual(picked);
    expect(s.revenue).toBeGreaterThan(0);
    // Every dollar it books is in a category the auto-pick actually gave it.
    expect(Object.keys(s.demandBy).sort()).toEqual(
      picked.map((id) => `specialty:${id}`).sort()
    );
  });

  it("memoizes autoSegments on everything that changes its answer", () => {
    // The memo key is built by hand, so widening what computeAutoSegments reads
    // without widening the key would return a stale pick and nothing would say
    // so. Varying parameters outside the key too is the whole point: they must
    // stay outside it only for as long as the computation ignores them.
    const sites: Array<[number, number]> = [
      [-84.275, 33.888],
      [-84.16, 33.95],
      [-84.383, 33.7816],
      [-84.55, 33.78],
    ];
    const variants: ScenarioParams[] = [
      DEFAULT_PARAMS,
      { ...DEFAULT_PARAMS, gravity: { ...DEFAULT_GRAVITY, maxKm: 2 } },
      { ...DEFAULT_PARAMS, gravity: { ...DEFAULT_GRAVITY, maxKm: 20 } },
      { ...DEFAULT_PARAMS, gravity: { ...DEFAULT_GRAVITY, beta: 4 } },
      { ...DEFAULT_PARAMS, gravity: { ...DEFAULT_GRAVITY, outsideOption: 0.5 } },
      { ...DEFAULT_PARAMS, demand: { ...DEFAULT_DEMAND, criticalMass: 0.02 } },
      { ...DEFAULT_PARAMS, demand: { ...DEFAULT_DEMAND, criticalMass: 0.3 } },
      { ...DEFAULT_PARAMS, demand: { ...DEFAULT_DEMAND, specialtyAffinity: 0.1 } },
      { ...DEFAULT_PARAMS, demand: { ...DEFAULT_DEMAND, incomeElasticity: 1.5 } },
    ];
    const answers = new Set<string>();
    for (const [lon, lat] of sites) {
      for (const p of variants) {
        const store: Store = {
          id: "memo",
          name: "Memo probe",
          type: "specialty",
          lon,
          lat,
          size: 1,
          segments: [],
        };
        const memoized = autoSegments(store, p);
        expect(memoized).toEqual(computeAutoSegments(store, p));
        answers.add(JSON.stringify(memoized));
      }
    }
    // Comparing the two is worth nothing unless the inputs move the answer.
    expect(answers.size).toBeGreaterThan(3);
    const store: Store = {
      id: "memo",
      name: "Memo probe",
      type: "specialty",
      lon: -84.275,
      lat: 33.888,
      size: 1,
      segments: [],
    };
    // Identity, so a repeat really came back from the cache.
    expect(autoSegments(store, DEFAULT_PARAMS)).toBe(autoSegments(store, DEFAULT_PARAMS));
  }, 60_000);
});
