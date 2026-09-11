/**
 * Stage 3: existing candy and confectionery shops from OpenStreetMap, as
 * competitors in the gravity model. Coverage is thin (a few dozen shops
 * for the region), which is itself a finding: OSM under-tags small retail.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Competitor } from "../lib/model/types";
import { DATA_DIR, OVERPASS_URL } from "./config";
import { fetchCached, log } from "./lib/http";
import type { TractGeo } from "./tracts";

const BUFFER_DEG = 0.03;

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function bbox(tracts: TractGeo[]): [number, number, number, number] {
  let s = 90, w = 180, n = -90, e = -180;
  for (const t of tracts) {
    const polys = t.geometry.type === "Polygon" ? [t.geometry.coordinates] : t.geometry.coordinates;
    for (const poly of polys) {
      for (const [lon, lat] of poly[0]) {
        if (lat < s) s = lat;
        if (lat > n) n = lat;
        if (lon < w) w = lon;
        if (lon > e) e = lon;
      }
    }
  }
  return [s - BUFFER_DEG, w - BUFFER_DEG, n + BUFFER_DEG, e + BUFFER_DEG];
}

export async function buildCompetitors(tracts: TractGeo[]): Promise<Competitor[]> {
  const [s, w, n, e] = bbox(tracts);
  const box = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  const query = `
[out:json][timeout:120];
(
  nwr["shop"~"^(confectionery|candy|chocolate|sweets)$"](${box});
);
out center tags;`;
  const buf = await fetchCached(OVERPASS_URL, "overpass-candy.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  const json = JSON.parse(buf.toString("utf8")) as { elements: OverpassElement[] };
  const out: Competitor[] = [];
  for (const el of json.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    out.push({
      id: `${el.type[0]}${el.id}`,
      name: el.tags?.name ?? el.tags?.brand ?? "(unnamed candy shop)",
      kind: el.tags?.shop ?? "confectionery",
      lon: Math.round(lon * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
    });
  }
  log(`competitors: ${out.length} candy/confectionery shops`);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, "competitors.json"), JSON.stringify(out));
  log(`wrote data/competitors.json`);
  return out;
}
