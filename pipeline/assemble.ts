/**
 * Stage 4: join geometry and demographics into the committed tract file
 * and write a manifest.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TractProps } from "../lib/model/types";
import type { DataManifest, TractCollection } from "../lib/data/load";
import type { AcsOutput } from "./acs";
import { ACS_PRIOR_VINTAGE, ACS_VINTAGE, BOUNDARY_VINTAGE, COUNTIES, DATA_DIR, HERITAGE_SEGMENTS } from "./config";
import { log } from "./lib/http";
import type { TractGeo } from "./tracts";

export function assemble(tracts: TractGeo[], acs: AcsOutput, competitorCount: number): TractCollection {
  let missing = 0;
  const features = tracts.map((t) => {
    const cur = acs.current[t.geoid];
    const prior = acs.prior[t.geoid];
    if (!cur) missing++;
    const props: TractProps = {
      geoid: t.geoid,
      name: t.name,
      countyFips: t.countyFips,
      county: t.county,
      place: t.place,
      landKm2: t.landKm2,
      cx: t.cx,
      cy: t.cy,
      pop: cur?.pop ?? 0,
      households: cur?.households ?? 0,
      medianIncome: cur?.medianIncome ?? null,
      childShare: cur?.childShare ?? null,
      noVehicleRate: cur?.noVehicleRate ?? null,
      foreignBornShare: cur?.foreignBornShare ?? null,
      heritage: cur?.heritage ?? Object.fromEntries(HERITAGE_SEGMENTS.map((s) => [s.id, 0])),
      pop2019: prior?.pop2019 ?? null,
      pop2019Basis: prior?.basis,
    };
    return { type: "Feature" as const, properties: props, geometry: t.geometry };
  });
  if (missing > 0) log(`warning: ${missing} tracts have no current ACS row`);

  const fc: TractCollection = { type: "FeatureCollection", features };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, "tracts.json"), JSON.stringify(fc));
  log(`wrote data/tracts.json (${features.length} tracts)`);

  const manifest: DataManifest = {
    generatedAt: new Date().toISOString(),
    acsVintage: ACS_VINTAGE,
    acsPriorVintage: ACS_PRIOR_VINTAGE,
    boundaryVintage: BOUNDARY_VINTAGE,
    counties: COUNTIES,
    segments: HERITAGE_SEGMENTS.map((s) => ({ id: s.id, label: s.label })),
    counts: { tracts: features.length, competitors: competitorCount },
  };
  writeFileSync(path.join(DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  log(`wrote data/manifest.json`);
  return fc;
}
