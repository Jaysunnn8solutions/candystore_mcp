/**
 * Place search for the study area. Nominatim (OpenStreetMap) handles
 * neighbourhoods, stations and landmarks; the Census Bureau geocoder is
 * the fallback for street addresses Nominatim misses. Both are free and
 * keyless. Results are cached per process and requests carry an
 * identifying user agent, as both services' usage policies ask.
 */

export interface GeoMatch {
  label: string;
  lon: number;
  lat: number;
  source: "nominatim" | "census";
  kind?: string;
}

const USER_AGENT = "atl-mcp/0.1 (+https://github.com/Jaysunnn8solutions/atl-mcp)";
const TIMEOUT_MS = 8000;
/** Metro Atlanta, generously. left,top,right,bottom for Nominatim. */
const VIEWBOX = "-85.0,34.3,-83.7,33.3";

const cache = new Map<string, GeoMatch[]>();
const MAX_CACHED = 200;

interface NominatimRow {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
}

interface CensusResponse {
  result?: {
    addressMatches?: Array<{
      matchedAddress: string;
      coordinates: { x: number; y: number };
    }>;
  };
}

async function nominatim(query: string): Promise<GeoMatch[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("viewbox", VIEWBOX);
  url.searchParams.set("bounded", "1");
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);
  const rows = (await res.json()) as NominatimRow[];
  return rows.map((r) => ({
    label: shortenLabel(r.display_name),
    lon: Number(r.lon),
    lat: Number(r.lat),
    source: "nominatim" as const,
    kind: r.addresstype ?? r.type,
  }));
}

async function censusGeocoder(query: string): Promise<GeoMatch[]> {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
  );
  url.searchParams.set("address", /\b(GA|Georgia)\b/i.test(query) ? query : `${query}, GA`);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Census geocoder returned HTTP ${res.status}`);
  const json = (await res.json()) as CensusResponse;
  return (json.result?.addressMatches ?? []).slice(0, 5).map((m) => ({
    label: titleCase(m.matchedAddress),
    lon: m.coordinates.x,
    lat: m.coordinates.y,
    source: "census" as const,
    kind: "address",
  }));
}

/** "Bankhead, Atlanta, Fulton County, Georgia, 30314, United States" → "Bankhead, Atlanta". */
function shortenLabel(displayName: string): string {
  const parts = displayName.split(",").map((s) => s.trim());
  const keep = parts.filter(
    (p) => !/^\d+$/.test(p) && p !== "United States" && p !== "Georgia" && !/County$/.test(p)
  );
  // Drop consecutive duplicates such as "Bankhead, Bankhead, Atlanta".
  const dedup = keep.filter((p, i) => i === 0 || p !== keep[i - 1]);
  return dedup.slice(0, 3).join(", ");
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/, Ga\b/, ", GA");
}

export async function geocode(query: string): Promise<GeoMatch[]> {
  const key = query.trim().toLowerCase();
  if (key.length < 2) return [];
  const hit = cache.get(key);
  if (hit) return hit;

  let matches: GeoMatch[] = [];
  try {
    matches = await nominatim(query);
  } catch {
    // fall through to the Census geocoder
  }
  if (matches.length === 0) {
    try {
      matches = await censusGeocoder(query);
    } catch {
      matches = [];
    }
  }

  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, matches);
  return matches;
}
