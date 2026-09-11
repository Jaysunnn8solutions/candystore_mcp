import { loadManifest, loadTracts } from "../data/load";
import {
  describeScenario,
  fmtInt,
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

export const segmentMarketsConfig = {
  title: "Find specialty markets",
  description:
    "Where a heritage segment has critical mass: the tracts with the most " +
    "specialty demand for that segment, how much of it we capture today, and " +
    "the biggest uncaptured pockets. Use it to decide where a specialty store " +
    "for that segment would go.",
  inputSchema: z
    .object({
      segment: z.string().describe("Segment id: latam, caribbean, eastasia, southasia, mideast, africa, easteurope."),
      limit: z.number().int().min(1).max(40).default(12),
      ...toolParamsShape,
      ...scenarioShape,
    })
    .strict(),
  annotations: readOnly,
};

interface Args extends ToolParams, ScenarioArgs {
  segment: string;
  limit: number;
}

export function segmentMarketsHandler({ segment, limit, add, remove, capacityScale, ...params }: Args) {
  const known = loadManifest().segments.map((s) => s.id);
  if (!known.includes(segment)) return text(`Unknown segment "${segment}". Known: ${known.join(", ")}.`);
  const r = market(params, { add, remove, capacityScale });
  const cat = `specialty:${segment}`;
  const props = new Map(loadTracts().features.map((f) => [f.properties.geoid, f.properties]));
  const rows = r.tracts
    .filter((t) => (t.byCategory[cat] ?? 0) > 0)
    .map((t) => ({ t, p: props.get(t.geoid)!, d: t.byCategory[cat], u: t.byCategory[cat] * (1 - (t.captured[cat] ?? 0)) }));
  const seg = r.segments.find((s) => s.id === segment)!;
  const captured = rows.reduce((s, x) => s + x.d * (x.t.captured[cat] ?? 0), 0);

  const byDemand = [...rows].sort((a, b) => b.d - a.d).slice(0, limit);
  const byUncaptured = [...rows].sort((a, b) => b.u - a.u).slice(0, 5);

  return text(
    [
      `${segmentLabel(segment)} specialty market${describeScenario(resolveOverrides({ add, remove, capacityScale }))}`,
      `${seg.markets} tracts at or above critical mass (${pct(r.params.demand.criticalMass)} of population), ${fmtInt(seg.population)} residents, ` +
        `${money(seg.demand)}/yr specialty demand, of which we capture ${money(captured)} (${pct(seg.demand > 0 ? captured / seg.demand : 0)}).`,
      ``,
      `Largest markets:`,
      ...byDemand.map(
        ({ t, p, d }, i) =>
          `${i + 1}. ${p.name}, ${placeLabel(p.place, p.county)} (${t.geoid}) — ${pct(p.heritage[segment])} ${segmentLabel(segment)}, ` +
          `${money(d)}/yr specialty demand, we capture ${pct(t.captured[cat] ?? 0)}`
      ),
      ``,
      `Biggest uncaptured pockets (where a specialty store would land):`,
      ...byUncaptured.map(({ t, p, u }) => `- ${p.name}, ${placeLabel(p.place, p.county)} (${t.geoid}) — ${money(u)}/yr uncaptured; centroid ${p.cy.toFixed(4)}, ${p.cx.toFixed(4)}`),
    ].join("\n")
  );
}
