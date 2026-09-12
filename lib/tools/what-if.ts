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
  utilization,
  type ScenarioArgs,
  type ToolParams,
  z,
} from "./shared";

export const whatIfConfig = {
  title: "Test a scenario",
  description:
    "Compare the baseline with a scenario: stores added or closed, distribution " +
    "capacity scaled. Reports chain revenue, share, per-store changes, and where " +
    "supply caps bind.",
  inputSchema: z.object({ ...toolParamsShape, ...scenarioShape }).strict(),
  annotations: readOnly,
};

export function whatIfHandler({ add, remove, capacityScale, ...params }: ToolParams & ScenarioArgs) {
  const overrides = resolveOverrides({ add, remove, capacityScale });
  if (!overrides.add.length && !overrides.remove.length && !overrides.capacityScale.length) {
    return text("Nothing to test: pass stores in `add`, ids in `remove`, or `capacityScale` entries.");
  }
  const base = market(params);
  const scen = market(params, { add, remove, capacityScale });
  const baseBy = new Map(base.stores.map((s) => [s.id, s]));

  const storeLines = scen.stores.map((s) => {
    const b = baseBy.get(s.id);
    if (!b) return `- NEW ${s.name} (${s.type}, ${s.dc}): ${money(s.revenue)}/yr, fill ${pct(s.fillRate)}`;
    const d = s.revenue - b.revenue;
    return `- ${s.name}: ${money(b.revenue)} → ${money(s.revenue)}/yr (${d >= 0 ? "+" : ""}${money(d)})${s.fillRate < 0.999 ? `, fill ${pct(s.fillRate)}` : ""}`;
  });
  for (const b of base.stores) if (!scen.stores.find((s) => s.id === b.id)) storeLines.push(`- CLOSED ${b.name}: −${money(b.revenue)}/yr`);

  const capLines = scen.dcs.flatMap((d) =>
    Object.entries(d.fillRate)
      .filter(([, f]) => f < 0.999)
      .map(([c, f]) => `- ${d.name}: ${categoryLabel(c)} ${utilization(d.weeklyDemand[c] ?? 0, d.capacity[c] ?? 0)}, fill ${pct(f)}`)
  );

  return text(
    [
      `Scenario result.${describeScenario(overrides)}`,
      ``,
      `- Chain revenue: ${money(base.totals.ourRevenue)} → ${money(scen.totals.ourRevenue)}/yr (${scen.totals.ourRevenue >= base.totals.ourRevenue ? "+" : ""}${money(scen.totals.ourRevenue - base.totals.ourRevenue)}).`,
      `- Market share: ${pct(base.totals.ourShare)} → ${pct(scen.totals.ourShare)}.`,
      `- Lost to supply caps: ${money(base.totals.lostToCaps)} → ${money(scen.totals.lostToCaps)}/yr.`,
      ``,
      `By store:`,
      ...storeLines,
      ``,
      capLines.length ? `Supply caps binding:` : `No distribution center is at capacity.`,
      ...capLines,
    ].join("\n")
  );
}
