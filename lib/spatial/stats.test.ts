import { describe, expect, it } from "vitest";
import {
  haversineKm,
  mean,
  normalTwoSidedP,
  quantileSorted,
  seededRandom,
  stddev,
  tertile,
  zscores,
} from "./stats";

describe("basic moments", () => {
  it("computes mean and population sd", () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it("z-scores a series and maps a constant series to zeros", () => {
    const z = zscores([1, 2, 3]);
    expect(z[1]).toBeCloseTo(0);
    expect(z[0]).toBeCloseTo(-z[2]);
    expect(zscores([5, 5, 5])).toEqual([0, 0, 0]);
  });
});

describe("quantiles and tertiles", () => {
  it("interpolates quantiles of a sorted array", () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([10], 0.9)).toBe(10);
  });

  it("assigns tertiles at the boundaries", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(tertile(1, sorted)).toBe(1);
    expect(tertile(5, sorted)).toBe(2);
    expect(tertile(9, sorted)).toBe(3);
  });
});

describe("haversine", () => {
  it("measures one degree of longitude at the equator as ~111.2 km", () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it("measures Five Points to Hartsfield-Jackson as roughly 13 km", () => {
    const km = haversineKm(-84.3915, 33.7539, -84.4277, 33.6407);
    expect(km).toBeGreaterThan(12);
    expect(km).toBeLessThan(14);
  });
});

describe("normal p-value", () => {
  it("matches known critical values", () => {
    expect(normalTwoSidedP(0)).toBeCloseTo(1, 5);
    expect(normalTwoSidedP(1.96)).toBeCloseTo(0.05, 3);
    expect(normalTwoSidedP(-2.576)).toBeCloseTo(0.01, 3);
  });
});

describe("seeded random", () => {
  it("is deterministic for a seed and stays in [0, 1)", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
