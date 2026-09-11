import { describe, expect, it } from "vitest";
import { buildWeights, spatialLag } from "./weights";

describe("buildWeights", () => {
  it("row-standardizes and drops unknown or self neighbors", () => {
    const w = buildWeights(
      ["a", "b", "c"],
      [
        ["b", "c", "zzz"],
        ["a", "b"],
        [],
      ]
    );
    expect(w.neighbors[0]).toEqual([1, 2]);
    expect(w.weights[0]).toEqual([0.5, 0.5]);
    expect(w.neighbors[1]).toEqual([0]);
    expect(w.weights[1]).toEqual([1]);
    expect(w.islands).toEqual([2]);
  });

  it("rejects mismatched inputs", () => {
    expect(() => buildWeights(["a"], [])).toThrow();
  });
});

describe("spatialLag", () => {
  it("averages neighbor values and gives islands a lag of zero", () => {
    const w = buildWeights(
      ["a", "b", "c", "d"],
      [["b", "c"], ["a"], ["a"], []]
    );
    const lag = spatialLag([10, 2, 4, 99], w);
    expect(lag).toEqual([3, 10, 10, 0]);
  });
});
