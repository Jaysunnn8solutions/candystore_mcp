import {
  categoryLabel,
  describeScenario,
  market,
  money,
  pct,
  readOnly,
  resolveOverrides,
  scenarioShape,
  text,
  toolParamsShape,
  type ScenarioArgs,
  type ToolParams,
  z,
} from "./shared";

export const storePerformanceConfig = {
  title: "Store and supply performance",
  description:
    "Revenue by store and category, fill rates, and distribution-center " +
    "utilization by category, for the baseline or a scenario.",
  inputSchema: z.object({ ...toolParamsShape, ...scenarioShape }).strict(),
  annotations: readOnly,
};

export function storePerformanceHandler({ add, remove, capacityScale, ...params }: ToolParams & ScenarioArgs) {
  const r = market(params, { add, remove, capacityScale });
  const lines = [
    `Chain: ${money(r.totals.ourRevenue)}/yr revenue on ${money(r.totals.ourDemand)} captured demand (${pct(r.totals.ourShare)} of a ${money(r.totals.marketDemand)} market); ` +
      `${money(r.totals.lostToCaps)} lost to supply caps.${describeScenario(resolveOverrides({ add, remove, capacityScale }))}`,
    ``,
    `## Stores`,
    ...r.stores
      .sort((a, b) => b.revenue - a.revenue)
      .map(
        (s) =>
          `- ${s.name} (${s.id}, ${s.type}, ${s.dc}): ${money(s.revenue)}/yr, fill ${pct(s.fillRate)}; ` +
          Object.entries(s.revenueBy)
            .sort((a, b) => b[1] - a[1])
            .map(([c, v]) => `${categoryLabel(c)} ${money(v)}`)
            .join(", ")
      ),
    ``,
    `## Distribution centers (weekly demand vs capacity)`,
    ...r.dcs.map((d) => {
      const cats = Object.keys(d.weeklyDemand).filter((c) => d.weeklyDemand[c] > 0);
      return (
        `- ${d.name} (${d.id}), ${d.stores.length} stores: ` +
        cats
          .map((c) => `${categoryLabel(c)} ${money(d.weeklyDemand[c])}/wk of ${money(d.capacity[c] ?? 0)} (${pct(Math.min(1, d.weeklyDemand[c] / Math.max(1, d.capacity[c] ?? 0)))} used)`)
          .join("; ")
      );
    }),
  ];
  return text(lines.join("\n"));
}
