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
  // A proposed specialty store with no segments listed has them picked for it
  // inside the market run, so read the carried segments off the result rather
  // than off the raw store, which still shows none.
  const carried = new Map(r.stores.map((s) => [s.id, s.segments]));
  const nearest = stores
    .map((s) => ({ s, km: haversineKm(p.cx, p.cy, s.lon, s.lat) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 3);

  // Most tracts' 2019 population is apportioned by land area from the 2010
  // boundaries, which makes one tract's change since 2019 rough — the extreme
  // swings are nearly all apportioned. Qualify those rather than assert them,
  // and treat a tract with no recorded basis as one of them: an absent flag is
  // no evidence the count is exact.
  const exact = p.pop2019Basis === "direct";
  const caveat = p.pop2019Basis === "apportioned"
    ? ` (the 2019 count is apportioned from re-delineated tracts, so this tract's change is approximate)`
    : ` (this tract records no basis for its 2019 count, so the change is approximate)`;
  const since2019 = p.pop2019
    ? `; population ${exact ? "" : "~"}${p.pop >= p.pop2019 ? "+" : ""}${(((p.pop - p.pop2019) / p.pop2019) * 100).toFixed(0)}% since 2019` +
      (exact ? "" : caveat)
    : "";

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
        since2019 + `.`,
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
      ...nearest.map(({ s, km }) => `- ${s.name} (${s.type}${s.type === "specialty" ? `: ${(carried.get(s.id) ?? s.segments).map(segmentLabel).join(", ")}` : ""}) — ${km.toFixed(1)} km`),
    ].join("\n")
  );
}
