import { describe, expect, it } from "vitest";
import { runMarket } from "./market";
import { DEFAULT_STORE_COSTS, planSites } from "./optimizer";
import { DEFAULT_PARAMS, EMPTY_OVERRIDES, parseOverrides } from "./params";
import { DEFAULT_SIMULATION, seasonIndex, simulate } from "./simulate";

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
    // Outages make the distribution two-sided and skewed (zero weeks on one
    // side, rerouting spikes on the other), so the mean can sit outside
    // p10–p90. The invariant is only p10 ≤ p90, and all three non-negative.
    const wk = a.weekly[0];
    for (const dc of Object.keys(wk.mean)) {
      for (const cat of Object.keys(wk.mean[dc])) {
        expect(wk.p10[dc][cat]).toBeLessThanOrEqual(wk.p90[dc][cat]);
        expect(wk.mean[dc][cat]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("loses more when outages are frequent", () => {
    const m = runMarket(DEFAULT_PARAMS);
    const calm = simulate(m, { ...DEFAULT_SIMULATION, runs: 100, weeks: 12, outageProbability: 0 });
    const rough = simulate(m, { ...DEFAULT_SIMULATION, runs: 100, weeks: 12, outageProbability: 0.3 });
    expect(calm.totals.expectedLost).toBeLessThanOrEqual(rough.totals.expectedLost);
  });
});
