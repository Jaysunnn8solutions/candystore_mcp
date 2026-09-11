import { loadCompetitors, loadDcs, loadManifest } from "../data/load";
import { categoryLabel, fmtInt, market, money, pct, readOnly, text, z } from "./shared";

export const describeMarketConfig = {
  title: "Describe the market",
  description:
    "What this server models, the data behind it, the heritage segments, the " +
    "existing stores and distribution centers, and the baseline numbers. Call " +
    "this first.",
  inputSchema: z.object({}).strict(),
  annotations: readOnly,
};

export function describeMarketHandler() {
  const m = loadManifest();
  const r = market({});
  const dcs = loadDcs();

  return text(
    [
      `# Candy store planning — metro Atlanta`,
      ``,
      `Site selection, demand by heritage segment, and supply-chain forecasting for a candy retailer. ` +
        `Study area: ${m.counties.map((c) => c.name).join(", ")} counties (${m.counts.tracts} census tracts, ${m.boundaryVintage} boundaries, ACS ${m.acsVintage}).`,
      ``,
      `## How it works`,
      `- **Demand**: annual candy spend per tract = households × base spend, scaled by income and by the share of children. ` +
        `Where a heritage segment (foreign-born by region of birth, ACS B05006) passes a critical-mass share, part of the spend becomes specialty demand for that segment's familiar candy.`,
      `- **Capture**: a Huff gravity model splits each tract's spend among nearby outlets by size and distance, with an outside option (grocery, online). ` +
        `General stores carry traditional candy; specialty stores carry the specialty categories for their segments. Cannibalization between our stores is explicit.`,
      `- **Supply**: each store draws from its nearest distribution center. Weekly capacity per category caps revenue; specialty caps are tight, traditional loose.`,
      `- **Planning**: find_sites picks new stores by revenue gain per dollar of capital, net of cannibalization and caps. forecast_orders simulates weekly orders with seasonality and random outages.`,
      ``,
      `## Segments (tracts at or above ${pct(r.params.demand.criticalMass)} of population)`,
      ...r.segments
        .filter((s) => s.markets > 0)
        .map((s) => `- ${s.label} (${s.id}): ${s.markets} tract markets, ${fmtInt(s.population)} residents, ${money(s.demand)} specialty demand/yr`),
      ...r.segments.filter((s) => s.markets === 0).map((s) => `- ${s.label} (${s.id}): no tract reaches critical mass`),
      ``,
      `## Baseline (default settings)`,
      `- Market: ${money(r.totals.marketDemand)}/yr across all candy; ${categoryLabel("traditional")} ${money(r.totals.marketByCategory.traditional)}.`,
      `- Our ${r.stores.length} stores: ${money(r.totals.ourRevenue)}/yr revenue, ${pct(r.totals.ourShare)} share; ${money(r.totals.lostToCaps)} lost to supply caps.`,
      ...r.stores.map((s) => `  - ${s.name} (${s.id}, ${s.type}, ${s.dc}): ${money(s.revenue)}/yr, fill ${pct(s.fillRate)}`),
      `- Distribution centers: ` +
        dcs.map((d) => `${d.name} (${d.id}) traditional ${money(d.capacity.traditional)}/wk cap`).join("; ") + `.`,
      `- Competitors: ${loadCompetitors().length} candy/confectionery shops from OpenStreetMap, treated as general stores.`,
      ``,
      `All dollar figures are model outputs from mock assumptions (base spend, costs, capacities); the demographics are real.`,
    ].join("\n")
  );
}
