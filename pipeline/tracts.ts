/**
 * Stage 1: tract boundaries.
 *
 * Downloads the Census cartographic boundary shapefile for Georgia, keeps
 * the study counties, computes queen-contiguity neighbors on the
 * full-precision geometry, labels each tract with the city or
 * census-designated place its centroid falls in, then truncates
 * coordinates for a smaller file. Neighbors are computed before
 * truncation so shared borders still touch.
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
  /** City or census-designated place containing the centroid, or "Unincorporated <County> County". */
  place: string;
  landKm2: number;
  cx: number;
  cy: number;
  neighbors: string[];
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

  // Queen contiguity via bounding-box prefilter, then a real intersection test.
  const boxes = features.map((f) => turf.bbox(f));
  const neighbors: string[][] = features.map(() => []);
  let pairs = 0;
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue;
      pairs++;
      if (turf.booleanIntersects(features[i], features[j])) {
        neighbors[i].push(features[j].properties.GEOID);
        neighbors[j].push(features[i].properties.GEOID);
      }
    }
  }
  const islands = neighbors.filter((n) => n.length === 0).length;
  log(`contiguity: ${pairs} candidate pairs checked, ${islands} islands`);

  // Place lookup: bbox prefilter then point-in-polygon on the centroid.
  const placeBoxes = places.features.map((f) => turf.bbox(f));
  const placeFor = (lon: number, lat: number, county: string): string => {
    for (let k = 0; k < places.features.length; k++) {
      const b = placeBoxes[k];
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (turf.booleanPointInPolygon([lon, lat], places.features[k])) {
        return places.features[k].properties.NAME;
      }
    }
    return `Unincorporated ${county} County`;
  };

  const placeCounts = new Map<string, number>();
  const out: TractGeo[] = features.map((f, i) => {
    const centroid = turf.centerOfMass(f).geometry.coordinates;
    const truncated = turf.truncate(f as Feature<Polygon | MultiPolygon>, {
      precision: 5,
      mutate: false,
    });
    const county = countyNames.get(f.properties.COUNTYFP)!;
    const place = placeFor(centroid[0], centroid[1], county);
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
      neighbors: neighbors[i],
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
