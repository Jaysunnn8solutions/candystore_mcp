import { describe, expect, it } from "vitest";
import { distanceMatrix, planRoute, routeLength } from "./tsp";
import { seededRandom } from "./stats";

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  const out: number[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

describe("planRoute", () => {
  it("untangles a crossing on a square", () => {
    // Corners in an order that crosses: 0 → 2 → 1 → 3.
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 0.01, lat: 0.01 },
      { lon: 0.01, lat: 0 },
      { lon: 0, lat: 0.01 },
    ];
    const r = planRoute(pts, { roundTrip: true });
    const side = 1.1119;
    expect(r.totalKm).toBeCloseTo(4 * side, 1);
    expect(r.order[0]).toBe(0);
    expect(r.legsKm).toHaveLength(4);
  });

  it("matches brute force on small random instances", () => {
    const rng = seededRandom(11);
    for (let trial = 0; trial < 5; trial++) {
      const pts = Array.from({ length: 7 }, () => ({
        lon: -84.4 + rng() * 0.2,
        lat: 33.7 + rng() * 0.2,
      }));
      const dist = distanceMatrix(pts);
      const best = Math.min(
        ...permutations([1, 2, 3, 4, 5, 6]).map((p) => routeLength([0, ...p], dist, true))
      );
      const r = planRoute(pts, { roundTrip: true });
      // 2-opt is a heuristic; allow a small gap but it usually hits optimum.
      expect(r.totalKm).toBeLessThanOrEqual(best * 1.08 + 1e-9);
      expect([...r.order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it("respects the start index and open paths", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 0.03, lat: 0 },
      { lon: 0.01, lat: 0 },
      { lon: 0.02, lat: 0 },
    ];
    const r = planRoute(pts, { start: 1 });
    expect(r.order).toEqual([1, 3, 2, 0]);
    expect(r.legsKm).toHaveLength(3);
    expect(r.totalKm).toBeCloseTo(3 * 1.1119, 1);
  });

  it("handles degenerate inputs", () => {
    expect(planRoute([]).order).toEqual([]);
    expect(planRoute([{ lon: 0, lat: 0 }]).totalKm).toBe(0);
    expect(() => planRoute([{ lon: 0, lat: 0 }], { start: 3 })).toThrow();
  });
});
