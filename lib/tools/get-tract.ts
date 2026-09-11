import { haversineKm } from "../spatial/stats";
import { findTract, loadStores } from "../data/load";
import {
  categoryLabel,
  describeScenario,
  error,
  fmtInt,
  geoidSchema,
  market,
  money,
  pct,
  placeLabel,
  readOnly,
  resolveOverrides,
  scenarioShape,
  segmentLabel,
  text,
  toolParamsShape,
  type ScenarioArgs,
  type ToolParams,
  z,
} from "./shared";

export const getTractConfig = {
  title: "Get a tract profile",
  description:
    "One tract: where it is, demographics, heritage shares, candy demand by " +
    "category, how much of it our stores capture, and the nearest stores.",
  inputSchema: z.object({ geoid: geoidSchema, ...toolParamsShape, ...scenarioShape }).strict(),
  annotations: readOnly,
};

interface Args extends ToolParams, ScenarioArgs {
  geoid: string;
}

export function getTractHandler({ geoid, add, remove, capacityScale, ...params }: Args) {
  const f = findTract(geoid);
  if (!f) return error(`No tract ${geoid} in the ten-county region.`);
  const p = f.properties;
  const overrides = resolveOverrides({ add, remove, capacityScale });
  const r = market(params, { add, remove, capacityScale });
  const t = r.tracts.find((x) => x.geoid === geoid)!;
  const stores = [...loadStores().filter((s) => !overrides.remove.includes(s.id)), ...overrides.add];
  const nearest = stores
    .map((s) => ({ s, km: haversineKm(p.cx, p.cy, s.lon, s.lat) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 3);

  const heritage = Object.entries(p.heritage)
    .filter(([, v]) => v >= 0.02)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${segmentLabel(k)} ${pct(v)}`)
    .join(", ");

  return text(
    [
      `# ${p.name}, ${placeLabel(p.place, p.county)} (${p.geoid})`,
      `${fmtInt(p.pop)} residents, ${fmtInt(p.households)} households, ${p.landKm2} km² (${fmtInt(p.pop / Math.max(p.landKm2, 0.01))}/km²). ` +
        `Median income ${p.medianIncome == null ? "n/a" : money(p.medianIncome)}; under 18 ${p.childShare == null ? "n/a" : pct(p.childShare)}; ` +
        `foreign-born ${p.foreignBornShare == null ? "n/a" : pct(p.foreignBornShare)}` +
        (p.pop2019 ? `; population ${p.pop2019 < p.pop ? "+" : ""}${(((p.pop - p.pop2019) / p.pop2019) * 100).toFixed(0)}% since 2019` : "") + `.`,
      `Heritage shares: ${heritage || "none above 2%"}.`,
      ``,
      `## Candy demand (${money(t.total)}/yr)${describeScenario(overrides)}`,
      ...Object.entries(t.byCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, v]) => `- ${categoryLabel(cat)}: ${money(v)}/yr, we capture ${pct(t.captured[cat] ?? 0)}`),
      t.specialtySegments.length
        ? `Specialty market for: ${t.specialtySegments.map(segmentLabel).join(", ")}.`
        : `No segment reaches critical mass, so all demand is traditional.`,
      t.primaryStore ? `Primary store for this tract: ${stores.find((s) => s.id === t.primaryStore)?.name ?? t.primaryStore}.` : `None of our stores draws from this tract.`,
      ``,
      `## Nearest stores`,
      ...nearest.map(({ s, km }) => `- ${s.name} (${s.type}${s.type === "specialty" ? `: ${s.segments.map(segmentLabel).join(", ")}` : ""}) — ${km.toFixed(1)} km`),
    ].join("\n")
  );
}
