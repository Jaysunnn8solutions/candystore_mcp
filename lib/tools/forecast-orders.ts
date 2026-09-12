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
    "and random center outages, so suppliers get expected volumes with the " +
    "heaviest week to plan capacity against. " +
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
  // Printed as well as simulated, so a max below the min is described as the
  // range that actually ran rather than the one that was asked for.
  const outageMax = Math.max(outageWeeksMin, outageWeeksMax);
  const sim = simulate(m, {
    weeks,
    runs,
    outageProbability,
    outageWeeks: [outageWeeksMin, outageMax],
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

  // Mean and observed peak rather than a p10–p90 band: outages are rare
  // enough that both tails land on the no-outage point mass, so the band came
  // out zero-width and to one side of the mean rather than around it — above
  // it where an outage drags the average down, below it where a reroute from
  // the other center lifts the average instead. At the defaults not one of the
  // 52 cells contained the mean. The peak is the reroute week capacity has to
  // survive, which is what a supplier conversation is actually about.
  const rows = sim.weekly.map((w) => {
    const cells = m.dcs.map((d) => {
      const t = w.total[d.id];
      return `${money(t.mean)} (peak ${money(t.peak)})`;
    });
    return `| ${w.week} | wk ${w.calendarWeek} | ${cells.join(" | ")} | ${money(w.lost)} |`;
  });

  return text(
    [
      `Order forecast: ${weeks} weeks from calendar week ${startWeek}, ${runs} runs, outage chance ${pct(outageProbability)}/week lasting ${outageWeeksMin}–${outageMax} weeks.${describeScenario(resolveOverrides({ add, remove, capacityScale }))}`,
      ``,
      `Expected orders over the horizon (${money(sim.totals.horizonRevenue)} total; expected lost revenue ${money(sim.totals.expectedLost)}):`,
      ...totals,
      `Runs with at least one outage: ${Object.entries(sim.totals.outageRuns).map(([dc, s]) => `${dcNames.get(dc)} ${pct(s)}`).join(", ")}.`,
      ``,
      `| # | week | ${m.dcs.map((d) => `${d.name} mean (peak)`).join(" | ")} | expected lost |`,
      `|---|---|${m.dcs.map(() => "---").join("|")}|---|`,
      ...rows,
      ``,
      `Weekly figures are retail-dollar equivalents shipped, across all categories at that center; tell suppliers the mean and plan capacity for the peak, which is the heaviest week seen in ${runs} runs.`,
      `Lost revenue is demand the network could not ship: an outage with no spare capacity to reroute into, or a seasonal week running past a center's own weekly capacity. The annual lost-to-caps figure carries no outages and compares an average week to capacity, so a calm horizon here can still show a loss where that figure shows none.`,
    ].join("\n")
  );
}
