import { describe, expect, it } from "vitest";
import { captureForTract, outletsFrom } from "./gravity";
import { DEFAULT_GRAVITY } from "./params";
import type { Store, TractDemand, TractProps } from "./types";

const tract: TractProps = {
  geoid: "1", name: "t", countyFips: "121", county: "Fulton", place: "Atlanta", landKm2: 1,
  cx: -84.4, cy: 33.7, neighbors: [], pop: 4000, households: 1500, medianIncome: 75_000,
  childShare: 0.22, noVehicleRate: 0.05, foreignBornShare: 0.3, heritage: { latam: 0.3 }, pop2019: null,
};
const demand: TractDemand = {
  geoid: "1",
  byCategory: { traditional: 100_000, "specialty:latam": 20_000 },
  total: 120_000,
  specialtySegments: ["latam"],
};
const near = (id: string, type: Store["type"], dx: number, segments: string[] = []): Store => ({
  id, name: id, type, lon: -84.4 + dx, lat: 33.7, size: 1, segments,
});

describe("captureForTract", () => {
  it("gives a lone nearby store most of the traditional demand and none of the specialty", () => {
    const outlets = outletsFrom([near("g1", "general", 0.005)], []);
    const cap = captureForTract(tract, demand, outlets, DEFAULT_GRAVITY);
    expect(cap.ourShare.traditional).toBeGreaterThan(0.9);
    expect(cap.ourShare["specialty:latam"]).toBe(0);
    expect(cap.byOutlet.get("g1")?.traditional).toBeGreaterThan(90_000);
    expect(cap.primaryStore).toBe("g1");
  });

  it("splits demand between two equal stores and lets a competitor take a share", () => {
    const ours = outletsFrom([near("g1", "general", 0.005), near("g2", "general", -0.005)], []);
    const cap = captureForTract(tract, demand, ours, DEFAULT_GRAVITY);
    const a = cap.byOutlet.get("g1")!.traditional;
    const b = cap.byOutlet.get("g2")!.traditional;
    expect(a).toBeCloseTo(b, 0);
    const withRival = outletsFrom([near("g1", "general", 0.005)], [{ id: "c1", name: "rival", kind: "candy", lon: -84.395, lat: 33.7 }]);
    const cap2 = captureForTract(tract, demand, withRival, DEFAULT_GRAVITY);
    expect(cap2.ourShare.traditional).toBeLessThan(cap.ourShare.traditional + 0.01);
    expect(cap2.byOutlet.get("c1")!.traditional).toBeGreaterThan(0);
  });

  it("only a specialty store with the segment captures specialty demand", () => {
    const outlets = outletsFrom([near("s1", "specialty", 0.005, ["latam"]), near("s2", "specialty", 0.005, ["eastasia"])], []);
    const cap = captureForTract(tract, demand, outlets, DEFAULT_GRAVITY);
    expect(cap.byOutlet.get("s1")!["specialty:latam"]).toBeGreaterThan(0);
    expect(cap.byOutlet.get("s2")).toBeUndefined();
    expect(cap.ourShare.traditional).toBe(0);
  });

  it("draws nothing beyond maxKm", () => {
    const outlets = outletsFrom([near("far", "general", 0.5)], []);
    const cap = captureForTract(tract, demand, outlets, DEFAULT_GRAVITY);
    expect(cap.ourShare.traditional).toBe(0);
    expect(cap.primaryStore).toBeNull();
  });
});
