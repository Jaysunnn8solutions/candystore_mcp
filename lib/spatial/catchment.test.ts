import { describe, expect, it } from "vitest";
import { decayWeight, supplyWithin, twoStepFca } from "./catchment";

// 0.01 degrees of latitude is ~1.1 km.
const near = { lon: -84.39, lat: 33.75 };
const alsoNear = { lon: -84.39, lat: 33.76 };
const far = { lon: -84.39, lat: 34.75 };

describe("decayWeight", () => {
  it("is a hard cutoff for binary decay", () => {
    const opts = { radiusKm: 2, decay: "binary" as const };
    expect(decayWeight(1.99, opts)).toBe(1);
    expect(decayWeight(2.01, opts)).toBe(0);
  });

  it("decays smoothly to ~0.14 at the radius for gaussian", () => {
    const opts = { radiusKm: 2, decay: "gaussian" as const };
    expect(decayWeight(0, opts)).toBe(1);
    expect(decayWeight(2, opts)).toBeCloseTo(Math.exp(-2), 5);
    expect(decayWeight(2.5, opts)).toBe(0);
  });
});

describe("twoStepFca", () => {
  it("splits one supplier's capacity across the population it reaches", () => {
    const demand = [
      { ...near, population: 100 },
      { ...alsoNear, population: 300 },
      { ...far, population: 1000 },
    ];
    const supply = [{ ...near, capacity: 10 }];
    const a = twoStepFca(demand, supply, { radiusKm: 2, decay: "binary" });
    // Ratio = 10 / (100 + 300) = 0.025; both reachable tracts get it.
    expect(a[0]).toBeCloseTo(0.025);
    expect(a[1]).toBeCloseTo(0.025);
    expect(a[2]).toBe(0);
  });

  it("gives the closer demand point more under gaussian decay", () => {
    const demand = [
      { ...near, population: 100 },
      { ...alsoNear, population: 100 },
    ];
    const supply = [{ ...near, capacity: 1 }];
    const a = twoStepFca(demand, supply, { radiusKm: 2, decay: "gaussian" });
    expect(a[0]).toBeGreaterThan(a[1]);
    expect(a[1]).toBeGreaterThan(0);
  });

  it("ignores suppliers that reach nobody", () => {
    const a = twoStepFca(
      [{ ...near, population: 100 }],
      [{ ...far, capacity: 5 }],
      { radiusKm: 1, decay: "binary" }
    );
    expect(a).toEqual([0]);
  });
});

describe("supplyWithin", () => {
  it("counts and sums capacity inside the radius only", () => {
    const r = supplyWithin(
      near,
      [
        { ...near, capacity: 2 },
        { ...alsoNear, capacity: 3 },
        { ...far, capacity: 100 },
      ],
      2
    );
    expect(r).toEqual({ count: 2, capacity: 5 });
  });
});
