import { readFileSync } from "node:fs";
import path from "node:path";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Competitor, DistributionCenter, Store, TractProps } from "../model/types";

export type TractFeature = Feature<Polygon | MultiPolygon, TractProps>;
export type TractCollection = FeatureCollection<Polygon | MultiPolygon, TractProps>;

export interface DataManifest {
  generatedAt: string;
  acsVintage: number;
  acsPriorVintage: number;
  boundaryVintage: number;
  counties: Array<{ fips: string; name: string }>;
  segments: Array<{ id: string; label: string }>;
  counts: { tracts: number; competitors: number };
}

/**
 * Committed pipeline outputs and hand-written mock inputs, read once per
 * process. The production path is statically scoped to ./data so Next.js
 * traces just that folder; CANDY_DATA_DIR overrides it for tests.
 */
function readJson<T>(name: string): T {
  const override = process.env.CANDY_DATA_DIR;
  const text = override
    ? readFileSync(/* turbopackIgnore: true */ path.join(override, name), "utf8")
    : readFileSync(path.join(process.cwd(), "data", name), "utf8");
  return JSON.parse(text) as T;
}

let tracts: TractCollection | null = null;
let competitors: Competitor[] | null = null;
let stores: Store[] | null = null;
let dcs: DistributionCenter[] | null = null;
let manifest: DataManifest | null = null;

export function loadTracts(): TractCollection {
  if (!tracts) tracts = readJson<TractCollection>("tracts.json");
  return tracts;
}

export function loadCompetitors(): Competitor[] {
  if (!competitors) competitors = readJson<Competitor[]>("competitors.json");
  return competitors;
}

/** The five existing stores: four general, one specialty. Mock. */
export function loadStores(): Store[] {
  if (!stores) stores = readJson<Store[]>("stores.json");
  return stores;
}

/** Two mock distribution centers with per-category weekly caps. */
export function loadDcs(): DistributionCenter[] {
  if (!dcs) dcs = readJson<DistributionCenter[]>("dcs.json");
  return dcs;
}

export function loadManifest(): DataManifest {
  if (!manifest) manifest = readJson<DataManifest>("manifest.json");
  return manifest;
}

export function findTract(geoid: string): TractFeature | undefined {
  return loadTracts().features.find((f) => f.properties.geoid === geoid);
}
