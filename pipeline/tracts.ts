/**
 * Stage 1: tract boundaries.
 *
 * Downloads the Census cartographic boundary shapefile for Georgia, keeps
 * the study counties, labels each tract with the city or census-designated
 * place that covers most of it, then truncates coordinates for a smaller
 * file. Place assignment runs on the full-precision geometry so a boundary
 * that two files share still lines up.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import shp from "shpjs";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { CACHE_DIR, COUNTIES, PLACE_SHAPE_URL, TRACT_SHAPE_URL } from "./config";
import { fetchCached, log } from "./lib/http";

export interface TractGeo {
  geoid: string;
  name: string;
  countyFips: string;
  county: string;
  /** City or census-designated place covering most of the tract, or "Unincorporated <County> County". */
  place: string;
  landKm2: number;
  cx: number;
  cy: number;
  geometry: Polygon | MultiPolygon;
}

interface CbProps {
  GEOID: string;
  NAME: string;
  NAMELSAD: string;
  COUNTYFP: string;
  ALAND: number;
}

interface PlaceProps {
  NAME: string;
  LSAD: string;
}

async function loadShapes<P>(url: string): Promise<FeatureCollection<Polygon | MultiPolygon, P>> {
  const zip = await fetchCached(url, path.basename(url));
  const parsed = await shp(zip);
  return (Array.isArray(parsed) ? parsed[0] : parsed) as FeatureCollection<Polygon | MultiPolygon, P>;
}

export async function buildTracts(): Promise<TractGeo[]> {
  const [fc, places] = await Promise.all([
    loadShapes<CbProps>(TRACT_SHAPE_URL),
    loadShapes<PlaceProps>(PLACE_SHAPE_URL),
  ]);

  const countyNames = new Map(COUNTIES.map((c) => [c.fips, c.name]));
  const features = fc.features.filter((f) => countyNames.has(f.properties.COUNTYFP));
  log(`tracts in study area: ${features.length} of ${fc.features.length} statewide`);

  // Place lookup: bbox prefilter, then the place holding more of the tract
  // than any other and more than the unincorporated remainder. A centroid
  // test mislabels tracts whose centre of mass lands in a notch the city
  // boundary leaves out, or across the line in a neighbouring place.
  const placeBoxes = places.features.map((f) => turf.bbox(f));
  const placeFor = (tract: Feature<Polygon | MultiPolygon>, county: string): string => {
    const tb = turf.bbox(tract);
    const shape = turf.feature(tract.geometry);
    let bestName = "";
    let bestArea = 0;
    let placeArea = 0;
    for (let k = 0; k < places.features.length; k++) {
      const b = placeBoxes[k];
      if (tb[0] > b[2] || b[0] > tb[2] || tb[1] > b[3] || b[1] > tb[3]) continue;
      let area = 0;
      try {
        const piece = turf.intersect(
          turf.featureCollection([shape, turf.feature(places.features[k].geometry)])
        );
        if (piece) area = turf.area(piece);
      } catch {
        // turf throws on slivers and self-touching rings in the place file;
        // skipping the pair loses at most a boundary sliver.
        continue;
      }
      placeArea += area;
      if (area > bestArea) {
        bestArea = area;
        bestName = places.features[k].properties.NAME;
      }
    }
    // Census places do not overlap, so whatever no place claims is
    // unincorporated and competes with the leader for the label.
    const unincorporated = turf.area(tract) - placeArea;
    return bestArea > 0 && bestArea >= unincorporated
      ? bestName
      : `Unincorporated ${county} County`;
  };

  const placeCounts = new Map<string, number>();
  const out: TractGeo[] = features.map((f) => {
    const centroid = turf.centerOfMass(f).geometry.coordinates;
    const truncated = turf.truncate(f as Feature<Polygon | MultiPolygon>, {
      precision: 5,
      mutate: false,
    });
    const county = countyNames.get(f.properties.COUNTYFP)!;
    const place = placeFor(f as Feature<Polygon | MultiPolygon>, county);
    placeCounts.set(place, (placeCounts.get(place) ?? 0) + 1);
    return {
      geoid: f.properties.GEOID,
      name: f.properties.NAMELSAD,
      countyFips: f.properties.COUNTYFP,
      county,
      place,
      landKm2: Math.round((f.properties.ALAND / 1e6) * 1000) / 1000,
      cx: Math.round(centroid[0] * 1e6) / 1e6,
      cy: Math.round(centroid[1] * 1e6) / 1e6,
      geometry: truncated.geometry,
    };
  });
  log(`places: ${placeCounts.size} distinct; top: ${[...placeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path.join(CACHE_DIR, "tracts-geo.json"), JSON.stringify(out));
  log(`wrote cache/tracts-geo.json`);
  return out;
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  buildTracts().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
