import { DEFAULT_SIMULATION, simulate } from "../model/simulate";
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

export const forecastOrdersConfig = {
  title: "Forecast supplier orders",
  description:
    "Simulate weekly orders per distribution center and category over a " +
    "horizon, with candy seasonality (Halloween, Christmas, Valentine's, Easter) " +
    "and random center outages, so suppliers get expected volumes with a range. " +
    "Works on the baseline or a scenario.",
  inputSchema: z
    .object({
      weeks: z.number().int().min(4).max(52).default(DEFAULT_SIMULATION.weeks),
      runs: z.number().int().min(50).max(2000).default(DEFAULT_SIMULATION.runs),
      outageProbability: z.number().min(0).max(0.5).default(DEFAULT_SIMULATION.outageProbability)
        .describe("Chance per week that a distribution center goes down."),
      outageWeeksMin: z.number().int().min(1).max(8).default(DEFAULT_SIMULATION.outageWeeks[0]),
      outageWeeksMax: z.number().int().min(1).max(12).default(DEFAULT_SIMULATION.outageWeeks[1]),
      startWeek: z.number().int().min(1).max(52).default(DEFAULT_SIMULATION.startWeek).describe("Calendar week the horizon starts (44 is Halloween week)."),
      ...toolParamsShape,
      ...scenarioShape,
    })
    .strict(),
  annotations: readOnly,
};

interface Args extends ToolParams, ScenarioArgs {
  weeks: number;
  runs: number;
  outageProbability: number;
  outageWeeksMin: number;
  outageWeeksMax: number;
  startWeek: number;
}

export function forecastOrdersHandler({ weeks, runs, outageProbability, outageWeeksMin, outageWeeksMax, startWeek, add, remove, capacityScale, ...params }: Args) {
  const m = market(params, { add, remove, capacityScale });
  const sim = simulate(m, {
    weeks,
    runs,
    outageProbability,
    outageWeeks: [outageWeeksMin, Math.max(outageWeeksMin, outageWeeksMax)],
    startWeek,
    seed: DEFAULT_SIMULATION.seed,
  });

  const dcNames = new Map(m.dcs.map((d) => [d.id, d.name]));
  const totals = Object.entries(sim.totals.expectedOrders).map(([dc, cats]) => {
    const parts = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `${categoryLabel(c)} ${money(v)}`)
      .join(", ");
    return `- ${dcNames.get(dc)}: ${parts}`;
  });

  // Weekly table: per DC, total across categories with p10–p90 on the total of the main category.
  const rows = sim.weekly.map((w) => {
    const cells = m.dcs.map((d) => {
      const mean = Object.values(w.mean[d.id] ?? {}).reduce((a, b) => a + b, 0);
      const lo = Object.values(w.p10[d.id] ?? {}).reduce((a, b) => a + b, 0);
      const hi = Object.values(w.p90[d.id] ?? {}).reduce((a, b) => a + b, 0);
      return `${money(mean)} (${money(lo)}–${money(hi)})`;
    });
    return `| ${w.week} | wk ${w.calendarWeek} | ${cells.join(" | ")} | ${money(w.lost)} |`;
  });

  return text(
    [
      `Order forecast: ${weeks} weeks from calendar week ${startWeek}, ${runs} runs, outage chance ${pct(outageProbability)}/week lasting ${outageWeeksMin}–${outageWeeksMax} weeks.${describeScenario(resolveOverrides({ add, remove, capacityScale }))}`,
      ``,
      `Expected orders over the horizon (${money(sim.totals.horizonRevenue)} total; expected lost revenue ${money(sim.totals.expectedLost)}):`,
      ...totals,
      `Runs with at least one outage: ${Object.entries(sim.totals.outageRuns).map(([dc, s]) => `${dcNames.get(dc)} ${pct(s)}`).join(", ")}.`,
      ``,
      `| # | week | ${m.dcs.map((d) => `${d.name} mean (p10–p90)`).join(" | ")} | expected lost |`,
      `|---|---|${m.dcs.map(() => "---").join("|")}|---|`,
      ...rows,
      ``,
      `Weekly figures are retail-dollar equivalents shipped; tell suppliers the mean and plan capacity for the p90.`,
    ].join("\n")
  );
}
