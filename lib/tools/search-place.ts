import { geocode } from "../geocode";
import { haversineKm } from "../spatial/stats";
import { loadTracts } from "../data/load";
import { market, money, pct, placeLabel, readOnly, segmentLabel, text, toolParamsShape, type ToolParams, z } from "./shared";

export const searchPlaceConfig = {
  title: "Search a place",
  description:
    "Geocode a neighbourhood, address or landmark in metro Atlanta and list the " +
    "tracts around it with their candy demand and our capture.",
  inputSchema: z
    .object({
      query: z.string().min(2).max(120),
      withinKm: z.number().min(0.5).max(15).default(3),
      limit: z.number().int().min(1).max(40).default(10),
      ...toolParamsShape,
    })
    .strict(),
  annotations: { ...readOnly, openWorldHint: true },
};

interface Args extends ToolParams {
  query: string;
  withinKm: number;
  limit: number;
}

export async function searchPlaceHandler({ query, withinKm, limit, ...params }: Args) {
  const matches = await geocode(query);
  if (matches.length === 0) return text(`Nothing found for "${query}" inside metro Atlanta.`);
  const best = matches[0];
  const r = market(params);
  const results = new Map(r.tracts.map((t) => [t.geoid, t]));
  const rows = loadTracts()
    .features.map((f) => ({ p: f.properties, km: haversineKm(best.lon, best.lat, f.properties.cx, f.properties.cy) }))
    .filter((x) => x.km <= withinKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
  const total = rows.reduce((s, x) => s + (results.get(x.p.geoid)?.total ?? 0), 0);
  return text(
    [
      `Matched "${query}" to ${best.label} (${best.lat.toFixed(4)}, ${best.lon.toFixed(4)}) via ${best.source}. ${rows.length} tracts within ${withinKm} km, ${money(total)}/yr candy demand combined.`,
      ``,
      ...rows.map(({ p, km }) => {
        const t = results.get(p.geoid)!;
        const segs = t.specialtySegments.map(segmentLabel).join(", ");
        const ourShare = t.total > 0 ? Object.entries(t.byCategory).reduce((s, [c, v]) => s + v * (t.captured[c] ?? 0), 0) / t.total : 0;
        return `- ${p.name}, ${placeLabel(p.place, p.county)} (${p.geoid}) — ${km.toFixed(1)} km; ${money(t.total)}/yr, we capture ${pct(ourShare)}${segs ? `; specialty: ${segs}` : ""}`;
      }),
      matches.length > 1 ? `\nOther matches: ${matches.slice(1).map((m) => m.label).join("; ")}.` : "",
    ].join("\n")
  );
}
