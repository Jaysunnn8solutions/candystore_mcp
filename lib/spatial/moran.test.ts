import { describe, expect, it } from "vitest";
import { globalMoran, localMoran } from "./moran";
import { buildWeights } from "./weights";

/**
 * Square lattice. Rook contiguity shares an edge (4 neighbors); queen also
 * shares a corner (8 neighbors), which is what the pipeline computes for
 * real tracts.
 */
function lattice(size: number, contiguity: "rook" | "queen" = "rook") {
  const ids: string[] = [];
  const nbs: string[][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      ids.push(`${r},${c}`);
      const n: string[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (contiguity === "rook" && dr !== 0 && dc !== 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          n.push(`${rr},${cc}`);
        }
      }
      nbs.push(n);
    }
  }
  return buildWeights(ids, nbs);
}

function cell(id: string): [number, number] {
  return id.split(",").map(Number) as [number, number];
}

describe("globalMoran", () => {
  it("is strongly negative on a checkerboard", () => {
    const w = lattice(6);
    const values = w.ids.map((id) => {
      const [r, c] = cell(id);
      return (r + c) % 2 === 0 ? 1 : 0;
    });
    const g = globalMoran(values, w);
    expect(g.I).toBeLessThan(-0.9);
    expect(g.p).toBeLessThan(0.001);
  });

  it("is strongly positive on a smooth gradient", () => {
    const w = lattice(6);
    const values = w.ids.map((id) => {
      const [r, c] = cell(id);
      return r + c;
    });
    const g = globalMoran(values, w);
    expect(g.I).toBeGreaterThan(0.6);
    expect(g.z).toBeGreaterThan(3);
    expect(g.expected).toBeCloseTo(-1 / 35);
  });

  it("degrades gracefully on a constant surface", () => {
    const w = lattice(3);
    const g = globalMoran(w.ids.map(() => 4), w);
    expect(g.I).toBe(0);
    expect(g.p).toBe(1);
  });
});

describe("localMoran", () => {
  it("flags the centre of a high plateau as HH", () => {
    const w = lattice(8, "queen");
    const values = w.ids.map((id) => {
      const [r, c] = cell(id);
      return r >= 2 && r <= 4 && c >= 2 && c <= 4 ? 10 : 0;
    });
    const l = localMoran(values, w, { permutations: 499 });
    const centre = w.index.get("3,3")!;
    expect(l.cluster[centre]).toBe("HH");
    expect(l.I[centre]).toBeGreaterThan(0);
    expect(l.p[centre]).toBeLessThan(0.01);
  });

  it("flags the centre of a low pocket as LL", () => {
    const w = lattice(8, "queen");
    const values = w.ids.map((id) => {
      const [r, c] = cell(id);
      return r >= 2 && r <= 4 && c >= 2 && c <= 4 ? 0 : 10;
    });
    const l = localMoran(values, w, { permutations: 499 });
    expect(l.cluster[w.index.get("3,3")!]).toBe("LL");
  });

  it("does not flag a low cell that is merely part of the majority", () => {
    // 55 of 64 cells are 0, so a 0 surrounded by 0s is exactly what random
    // assignment would produce. Conditional permutation must say "ns".
    const w = lattice(8, "queen");
    const values = w.ids.map((id) => {
      const [r, c] = cell(id);
      return r >= 2 && r <= 4 && c >= 2 && c <= 4 ? 10 : 0;
    });
    const l = localMoran(values, w, { permutations: 499 });
    expect(l.cluster[w.index.get("0,0")!]).toBe("ns");
  });

  it("flags a spike inside a low region as a high-low outlier", () => {
    // Left half high, right half low, one spike deep in the low half.
    const w = lattice(8, "queen");
    const values = w.ids.map((id) => {
      const [, c] = cell(id);
      if (id === "4,6") return 50;
      return c < 4 ? 10 : 0;
    });
    const l = localMoran(values, w, { permutations: 499 });
    expect(l.cluster[w.index.get("4,6")!]).toBe("HL");
  });

  it("is reproducible for the same seed", () => {
    const w = lattice(5);
    const values = w.ids.map((_, i) => Math.sin(i));
    const a = localMoran(values, w, { seed: 3 });
    const b = localMoran(values, w, { seed: 3 });
    expect(a.p).toEqual(b.p);
  });
});
