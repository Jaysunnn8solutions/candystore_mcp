/**
 * Stage 2: ACS demographics, including heritage segments from the
 * foreign-born place-of-birth table, plus prior-vintage population through
 * the 2010→2020 tract crosswalk.
 *
 * B05006 cell numbers shift between vintages as countries are added, so
 * the region cells are resolved by label from the table's group
 * definition at run time rather than hardcoded.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ACS_PRIOR_VINTAGE,
  ACS_VARIABLES,
  ACS_VINTAGE,
  CACHE_DIR,
  COUNTIES,
  HERITAGE_SEGMENTS,
  STATE_FIPS,
  TRACT_RELATIONSHIP_URL,
} from "./config";
import { parseCsvObjects } from "./lib/csv";
import { censusApiKey } from "./lib/env";
import { fetchCached, log } from "./lib/http";

type AcsRow = Record<string, number | null>;

function toEstimate(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= -222222222) return null;
  return n;
}

/** Map each heritage segment to the B05006 cells whose labels match. */
async function resolveHeritageCodes(vintage: number): Promise<Record<string, string[]>> {
  const url = `https://api.census.gov/data/${vintage}/acs/acs5/groups/B05006.json`;
  const buf = await fetchCached(url, `group-B05006-${vintage}.json`);
  const group = JSON.parse(buf.toString("utf8")) as {
    variables: Record<string, { label: string }>;
  };
  const byLabel = new Map<string, string>();
  for (const [code, v] of Object.entries(group.variables)) {
    if (!code.endsWith("E")) continue;
    byLabel.set(v.label.replace(/^Estimate!!Total:!!/, ""), code);
  }
  const out: Record<string, string[]> = {};
  for (const seg of HERITAGE_SEGMENTS) {
    out[seg.id] = seg.regions.map((label) => {
      // Region labels in config omit the continent prefix for the Americas.
      const code =
        byLabel.get(label) ??
        byLabel.get(`Americas:!!${label}`) ??
        [...byLabel.entries()].find(([l]) => l.endsWith(label))?.[1];
      if (!code) throw new Error(`B05006 ${vintage}: no cell labelled "${label}"`);
      return code;
    });
  }
  log(`B05006 ${vintage}: resolved ${Object.values(out).flat().length} region cells for ${HERITAGE_SEGMENTS.length} segments`);
  return out;
}

async function fetchVintage(vintage: number, codes: string[]): Promise<Map<string, AcsRow>> {
  const rows = new Map<string, AcsRow>();
  for (const county of COUNTIES) {
    const url =
      `https://api.census.gov/data/${vintage}/acs/acs5?get=${codes.join(",")}` +
      `&for=tract:*&in=state:${STATE_FIPS}%20county:${county.fips}&key=${censusApiKey()}`;
    const buf = await fetchCached(url, `acs-${vintage}-${county.fips}.json`);
    const text = buf.toString("utf8");
    if (text.trimStart().startsWith("<")) {
      throw new Error(`Census API returned an error page for ${vintage}/${county.fips}`);
    }
    const table = JSON.parse(text) as string[][];
    const header = table[0];
    for (const r of table.slice(1)) {
      const rec: Record<string, string> = {};
      header.forEach((h, i) => (rec[h] = r[i]));
      const geoid = `${rec.state}${rec.county}${rec.tract}`;
      const row: AcsRow = {};
      for (const c of codes) row[c] = toEstimate(rec[c]);
      rows.set(geoid, row);
    }
  }
  log(`ACS ${vintage}: ${rows.size} tracts`);
  return rows;
}

function ratio(num: number | null, den: number | null): number | null {
  if (num == null || den == null || den === 0) return null;
  return Math.round((num / den) * 10000) / 10000;
}

export interface AcsCurrent {
  pop: number;
  households: number;
  medianIncome: number | null;
  childShare: number | null;
  noVehicleRate: number | null;
  foreignBornShare: number | null;
  /** Segment id → share of total population born in that region group. */
  heritage: Record<string, number>;
}

export interface AcsPrior {
  pop2019: number | null;
  /** "direct" when one unchanged 2010 tract supplied the whole figure. */
  basis: "direct" | "apportioned";
}

interface RelPart {
  geoid20: string;
  geoid10: string;
  /** Part's land as a share of the 2010 tract: the apportionment weight. */
  share: number;
  /** Part's land as a share of the 2020 tract, which says whether this one donor covers it. */
  share20: number;
}

async function loadRelationship(): Promise<RelPart[]> {
  const buf = await fetchCached(TRACT_RELATIONSHIP_URL, path.basename(TRACT_RELATIONSHIP_URL));
  const rows = parseCsvObjects(buf.toString("utf8"), "|");
  const parts: RelPart[] = [];
  for (const r of rows) {
    const land10 = Number(r.AREALAND_TRACT_10);
    const land20 = Number(r.AREALAND_TRACT_20);
    const part = Number(r.AREALAND_PART);
    if (!(land10 > 0)) continue;
    parts.push({
      geoid20: r.GEOID_TRACT_20,
      geoid10: r.GEOID_TRACT_10,
      share: part / land10,
      share20: land20 > 0 ? part / land20 : 0,
    });
  }
  log(`relationship file: ${parts.length} tract parts statewide`);
  return parts;
}

export interface AcsOutput {
  current: Record<string, AcsCurrent>;
  prior: Record<string, AcsPrior>;
}

export async function buildAcs(): Promise<AcsOutput> {
  const V = ACS_VARIABLES;
  const heritageCodes = await resolveHeritageCodes(ACS_VINTAGE);
  const currentCodes = [...Object.values(V), ...Object.values(heritageCodes).flat()];
  const [current, prior, parts] = await Promise.all([
    fetchVintage(ACS_VINTAGE, currentCodes),
    fetchVintage(ACS_PRIOR_VINTAGE, [V.pop]),
    loadRelationship(),
  ]);

  const shapedCurrent: Record<string, AcsCurrent> = {};
  for (const [geoid, row] of current) {
    const pop = row[V.pop] ?? 0;
    const heritage: Record<string, number> = {};
    for (const seg of HERITAGE_SEGMENTS) {
      let n = 0;
      for (const c of heritageCodes[seg.id]) n += row[c] ?? 0;
      heritage[seg.id] = pop > 0 ? Math.round((n / pop) * 10000) / 10000 : 0;
    }
    shapedCurrent[geoid] = {
      pop,
      households: row[V.households] ?? 0,
      medianIncome: row[V.medianIncome],
      childShare: ratio(row[V.under18], pop),
      noVehicleRate: ratio(row[V.noVehicle], row[V.households]),
      foreignBornShare: ratio(row[V.foreignBorn], pop),
      heritage,
    };
  }

  // Apportion 2019 population onto 2020 tracts by land-area share, which
  // assumes each donor's population was spread evenly over its land. Where
  // the re-delineation split a donor that assumption is wrong by an unknown
  // amount, so record which tracts it was needed for.
  const acc = new Map<string, number>();
  const wholeDonor = new Set<string>();
  for (const p of parts) {
    const row = prior.get(p.geoid10);
    if (!row) continue;
    acc.set(p.geoid20, (acc.get(p.geoid20) ?? 0) + (row[V.pop] ?? 0) * p.share);
    // One donor covering essentially all of both tracts means nothing was
    // apportioned; a tenth of a percent absorbs the boundary corrections the
    // re-delineation made without letting a real split through.
    if (p.share >= 0.999 && p.share20 >= 0.999) wholeDonor.add(p.geoid20);
  }
  const shapedPrior: Record<string, AcsPrior> = {};
  let matched = 0;
  let direct = 0;
  for (const geoid of current.keys()) {
    const v = acc.get(geoid);
    if (v != null) {
      const basis = wholeDonor.has(geoid) ? "direct" : "apportioned";
      shapedPrior[geoid] = { pop2019: Math.round(v), basis };
      matched++;
      if (basis === "direct") direct++;
    }
  }
  log(`crosswalk: ${matched} of ${current.size} tracts have a prior-vintage match`);
  log(`crosswalk: ${direct} direct from one unchanged 2010 tract, ${matched - direct} apportioned from split donors`);

  const out = { current: shapedCurrent, prior: shapedPrior };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path.join(CACHE_DIR, "acs.json"), JSON.stringify(out));
  log(`wrote cache/acs.json`);
  return out;
}
