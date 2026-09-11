import { describe, expect, it } from "vitest";
import { DEFAULT_DEMAND } from "./params";
import { regionStats, tractDemand } from "./demand";
import type { TractProps } from "./types";

function tract(over: Partial<TractProps>): TractProps {
  return {
    geoid: "1", name: "t", countyFips: "121", county: "Fulton", place: "Atlanta", landKm2: 1,
    cx: -84.4, cy: 33.7, neighbors: [], pop: 4000, households: 1500, medianIncome: 75_000,
    childShare: 0.22, noVehicleRate: 0.05, foreignBornShare: 0.1,
    heritage: { latam: 0.02, eastasia: 0.01 }, pop2019: 3800, ...over,
  };
}

const stats = { medianIncome: 75_000, meanChildShare: 0.22 };

describe("tractDemand", () => {
  it("spends base × households at median income and average child share", () => {
    const d = tractDemand(tract({}), DEFAULT_DEMAND, stats);
    expect(d.total).toBeCloseTo(1500 * DEFAULT_DEMAND.baseSpend, 3);
    expect(d.byCategory.traditional).toBeCloseTo(d.total, 3);
    expect(d.specialtySegments).toEqual([]);
  });

  it("rises with income and with children", () => {
    const base = tractDemand(tract({}), DEFAULT_DEMAND, stats).total;
    expect(tractDemand(tract({ medianIncome: 150_000 }), DEFAULT_DEMAND, stats).total).toBeGreaterThan(base);
    expect(tractDemand(tract({ childShare: 0.35 }), DEFAULT_DEMAND, stats).total).toBeGreaterThan(base);
    expect(tractDemand(tract({ childShare: 0.1 }), DEFAULT_DEMAND, stats).total).toBeLessThan(base);
  });

  it("splits off specialty demand only above critical mass", () => {
    const d = tractDemand(tract({ heritage: { latam: 0.25, eastasia: 0.03 } }), DEFAULT_DEMAND, stats);
    expect(d.specialtySegments).toEqual(["latam"]);
    expect(d.byCategory["specialty:latam"]).toBeCloseTo(d.total * 0.25 * DEFAULT_DEMAND.specialtyAffinity, 3);
    expect(d.byCategory.traditional + d.byCategory["specialty:latam"]).toBeCloseTo(d.total, 3);
    expect(d.byCategory["specialty:eastasia"]).toBeUndefined();
  });

  it("computes regional stats from the tracts given", () => {
    const s = regionStats([tract({ medianIncome: 50_000 }), tract({ medianIncome: 90_000 }), tract({ medianIncome: 70_000 })]);
    expect(s.medianIncome).toBe(70_000);
  });
});
