import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, flattenParams } from "./model/params";
import type { Store } from "./model/types";
import { DEFAULT_VIEW, hashFromInput, parseViewHash, readViewHash, serializeViewHash, type ViewState } from "./view-state";

const SEGMENTS = ["latam", "caribbean", "eastasia", "southasia", "mideast", "africa", "easteurope"];

function store(segments: string[]): Store {
  return { id: "new-0", name: "Proposed specialty store", type: "specialty", lat: 33.95, lon: -84.16, size: 1, segments, proposed: true };
}

function view(patch: Partial<ViewState>): ViewState {
  return { ...DEFAULT_VIEW, ...patch };
}

describe("scenario stores through the hash", () => {
  it("round-trips two segments", () => {
    const hash = serializeViewHash(view({ scenario: [store(["eastasia", "southasia"])] }));
    const back = parseViewHash(hash).scenario;
    expect(back).toHaveLength(1);
    expect(back[0].segments).toEqual(["eastasia", "southasia"]);
    expect(back[0].type).toBe("specialty");
    expect(back[0].lat).toBeCloseTo(33.95, 5);
    expect(back[0].lon).toBeCloseTo(-84.16, 5);
    expect(back[0].size).toBe(1);
  });

  it("round-trips every segment id at once", () => {
    const hash = serializeViewHash(view({ scenario: [store(SEGMENTS)] }));
    expect(parseViewHash(hash).scenario[0].segments).toEqual(SEGMENTS);
  });

  it("round-trips a store with no segments", () => {
    const hash = serializeViewHash(view({ scenario: [{ ...store([]), type: "general", name: "Proposed general store" }] }));
    const back = parseViewHash(hash).scenario;
    expect(back).toHaveLength(1);
    expect(back[0].segments).toEqual([]);
    expect(back[0].type).toBe("general");
  });

  it("round-trips several stores and a non-default size", () => {
    const hash = serializeViewHash(view({ scenario: [store(["latam"]), { ...store(["mideast", "africa"]), size: 1.5 }] }));
    const back = parseViewHash(hash).scenario;
    expect(back.map((s) => s.segments)).toEqual([["latam"], ["mideast", "africa"]]);
    expect(back[1].size).toBe(1.5);
  });

  // The serializer leaves "+" literal, but a link can also arrive percent-encoded
  // (pasted from a client that re-encoded it), and URLSearchParams decodes the two
  // differently: "+" becomes a space, "%2B" a plus.
  it("accepts a percent-encoded separator", () => {
    const back = parseViewHash("scn=specialty@33.95000,-84.16000@1@eastasia%2Bsouthasia").scenario;
    expect(back).toHaveLength(1);
    expect(back[0].segments).toEqual(["eastasia", "southasia"]);
  });

  it("keeps the segments of the documented test-client link", () => {
    const link =
      "https://candystore-mcp.vercel.app/#mode=specialty&seg=latam&scn=specialty@33.95000,-84.16000@1@eastasia+southasia";
    const v = parseViewHash(hashFromInput(link));
    expect(v.mode).toBe("specialty");
    expect(v.segment).toBe("latam");
    expect(v.scenario).toHaveLength(1);
    expect(v.scenario[0].segments).toEqual(["eastasia", "southasia"]);
  });

  it("drops only the malformed items", () => {
    const v = parseViewHash(
      "scn=coffee@33.95,-84.16@1@latam|specialty@here,-84.16@1@latam|specialty@33.95,-84.16@1@eastasia southasia"
    );
    expect(v.scenario).toHaveLength(1);
    expect(v.scenario[0].segments).toEqual(["eastasia", "southasia"]);
  });

  // The server ids an added store by its position in the `add` array it is
  // sent, so a store that survives a dropped neighbour has to be ided by how
  // many were kept, not by where it sat in the link.
  it("ids the surviving store by the count kept, not its place in the hash", () => {
    const v = parseViewHash("scn=coffee@33.95,-84.16@1@latam|general@33.93012,-84.32587@1@");
    expect(v.scenario).toHaveLength(1);
    expect(v.scenario[0].id).toBe("new-0");
    expect(v.scenario[0].type).toBe("general");
  });

  it("round-trips names that tell the stores apart", () => {
    const scenario = [
      { ...store([]), type: "general" as const, name: "Proposed general store 1" },
      { ...store(["latam"]), name: "Proposed specialty near Census Tract 232.12" },
    ];
    const back = parseViewHash(serializeViewHash(view({ scenario }))).scenario;
    expect(back.map((s) => s.name)).toEqual(["Proposed general store 1", "Proposed specialty near Census Tract 232.12"]);
    expect(back.map((s) => s.id)).toEqual(["new-0", "new-1"]);
  });

  it("leaves the name out of the hash when it is the one the parser would give", () => {
    const hash = serializeViewHash(view({ scenario: [store(["latam"])] }));
    expect(hash).toBe("scn=specialty@33.95000,-84.16000@1@latam");
    expect(parseViewHash(hash).scenario[0].name).toBe("Proposed specialty store");
  });

  it("keeps a hand-edited name to the characters the hash round-trips", () => {
    const back = parseViewHash("scn=general@33.95,-84.16@1@@<b>Store</b>").scenario;
    expect(back[0].name).toBe("b Store b");
  });
});

describe("a link the model cannot use", () => {
  it("drops a store outside the region and says so, keeping the rest", () => {
    const { view: v, dropped } = readViewHash("scn=general@99.0,99.0@1@|general@33.93012,-84.32587@1@");
    expect(v.scenario).toHaveLength(1);
    expect(v.scenario[0].id).toBe("new-0");
    expect(dropped).toEqual([expect.stringContaining("lon, lat")]);
  });

  it("drops a store size, a closure id and a capacity factor the tools reject", () => {
    const { view: v, dropped } = readViewHash(
      `scn=general@33.93012,-84.32587@99@&closed=${"s".repeat(41)}&cap=dc-east:traditional=99`
    );
    expect(v.scenario).toEqual([]);
    expect(v.closed).toEqual([]);
    expect(v.capacityScale).toEqual([]);
    expect(dropped).toHaveLength(3);
  });

  it("reports packed settings outside the model's domain", () => {
    const flat = { ...flattenParams(DEFAULT_PARAMS), baseSpend: -120 };
    const { view: v, dropped } = readViewHash(`p=${[
      flat.baseSpend, flat.incomeElasticity, flat.childBoost, flat.criticalMass, flat.specialtyAffinity,
      flat.beta, flat.alpha, flat.maxKm, flat.outsideOption,
    ].join(",")}`);
    expect(v.params).toEqual(DEFAULT_PARAMS);
    expect(dropped).toEqual([expect.stringContaining("baseSpend")]);
  });

  it("has nothing to report about a link it can use whole", () => {
    expect(readViewHash("mode=share&scn=general@33.93012,-84.32587@1@").dropped).toEqual([]);
  });
});

describe("model parameters in the hash", () => {
  it("round-trips values inside the model's domain", () => {
    const params = { demand: { ...DEFAULT_PARAMS.demand, baseSpend: 200 }, gravity: { ...DEFAULT_PARAMS.gravity, beta: 1.5 } };
    const back = parseViewHash(serializeViewHash(view({ params })));
    expect(back.params).toEqual(params);
  });

  it("omits parameters that are still at their defaults", () => {
    expect(serializeViewHash(DEFAULT_VIEW)).toBe("");
    expect(parseViewHash("").params).toEqual(DEFAULT_PARAMS);
  });

  it("falls back to the defaults when a link is outside the domain", () => {
    const flat = { ...flattenParams(DEFAULT_PARAMS), baseSpend: -120 };
    const hash = `p=${[
      flat.baseSpend, flat.incomeElasticity, flat.childBoost, flat.criticalMass, flat.specialtyAffinity,
      flat.beta, flat.alpha, flat.maxKm, flat.outsideOption,
    ].join(",")}`;
    expect(parseViewHash(hash).params).toEqual(DEFAULT_PARAMS);
  });

  it("falls back to the defaults when the packed list is the wrong shape", () => {
    expect(parseViewHash("p=120,0.4").params).toEqual(DEFAULT_PARAMS);
    expect(parseViewHash("p=a,b,c,d,e,f,g,h,i").params).toEqual(DEFAULT_PARAMS);
  });
});

describe("the rest of the view", () => {
  it("round-trips closures, capacity scales, the selected tract and the competitor toggle", () => {
    const v = view({
      mode: "uncaptured",
      segment: "eastasia",
      closed: ["s1", "s3"],
      capacityScale: [{ dc: "dc-east", category: "specialty:eastasia", factor: 2 }, { dc: "dc-west", category: "*", factor: 0.5 }],
      selected: "13135050537",
      showCompetitors: false,
    });
    const back = parseViewHash(serializeViewHash(v));
    expect(back.mode).toBe("uncaptured");
    expect(back.segment).toBe("eastasia");
    expect(back.closed).toEqual(["s1", "s3"]);
    expect(back.capacityScale).toEqual(v.capacityScale);
    expect(back.selected).toBe("13135050537");
    expect(back.showCompetitors).toBe(false);
  });

  it("rejects a segment id it does not recognise", () => {
    expect(parseViewHash("mode=specialty&seg=<script>notasegment").segment).toBe(DEFAULT_VIEW.segment);
    expect(parseViewHash("mode=specialty&seg=eastasia").segment).toBe("eastasia");
  });

  it("rejects a mode, a tract id and a capacity scale it does not recognise", () => {
    const v = parseViewHash("mode=profit&sel=99999999999&cap=dc-east:traditional=x");
    expect(v.mode).toBe(DEFAULT_VIEW.mode);
    expect(v.selected).toBeNull();
    expect(v.capacityScale).toEqual([]);
  });
});
