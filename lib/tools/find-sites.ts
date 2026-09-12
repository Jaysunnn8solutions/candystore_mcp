import { DEFAULT_STORE_COSTS, planSites } from "../model/optimizer";
import {
  describeParams,
  describeScenario,
  money,
  pct,
  placeLabel,
  readOnly,
  resolveOverrides,
  resolveParams,
  scenarioShape,
  segmentLabel,
  text,
  toolParamsShape,
  type ScenarioArgs,
  type ToolParams,
  z,
} from "./shared";

export const findSitesConfig = {
  title: "Find new store sites",
  description:
    "Given capital and a cost per store type, choose new general and specialty " +
    "stores that add the most annual revenue net of cannibalizing our own " +
    "stores and after distribution-center caps. Greedy by gain per dollar. " +
    "Returns picks you can pass to what_if as `add`.",
  inputSchema: z
    .object({
      budget: z.number().min(100_000).max(1_000_000_000).describe("Capital available, dollars."),
      costGeneral: z.number().positive().default(DEFAULT_STORE_COSTS.general),
      costSpecialty: z.number().positive().default(DEFAULT_STORE_COSTS.specialty),
      types: z.array(z.enum(["general", "specialty"])).min(1).default(["general", "specialty"]),
      ...toolParamsShape,
      ...scenarioShape,
    })
    .strict(),
  annotations: readOnly,
};

interface Args extends ToolParams, ScenarioArgs {
  budget: number;
  costGeneral: number;
  costSpecialty: number;
  types: Array<"general" | "specialty">;
}

export function findSitesHandler({ budget, costGeneral, costSpecialty, types, add, remove, capacityScale, ...params }: Args) {
  const p = resolveParams(params);
  const overrides = resolveOverrides({ add, remove, capacityScale });
  const plan = planSites({ budget, costs: { general: costGeneral, specialty: costSpecialty }, types }, p, overrides);

  const picks = plan.picks.map(
    (k) =>
      `${k.step}. ${k.store.type}${k.store.segments.length ? ` (${k.store.segments.map(segmentLabel).join(", ")})` : ""} near ${k.tractName}, ${placeLabel(k.place, k.county)} — ` +
      `${money(k.cost)}; adds ${money(k.gain)}/yr to the chain (store takes ${money(k.storeRevenue)}, ${money(k.cannibalized)} of it from our other stores); ` +
      `${k.store.lat.toFixed(4)}, ${k.store.lon.toFixed(4)}`
  );
  const addJson = JSON.stringify(
    plan.picks.map((k) => ({ type: k.store.type, lon: k.store.lon, lat: k.store.lat, segments: k.store.segments, name: k.store.name }))
  );

  // Why the capital is not fully spent. Leftover below the cheapest store we
  // are allowed to build is checked first: that is the "budget" exit, and it
  // is also the truth when a truncated plan happens to end with small change,
  // where "more sites remain" would be wrong.
  const cheapest = Math.min(...types.map((t) => (t === "general" ? costGeneral : costSpecialty)));
  const why =
    plan.remaining < cheapest
      ? `less than the ${money(cheapest)} the cheapest store we may build costs`
      : plan.stop === "minGain"
        ? "no shortlisted site cleared the minimum gain, which can mean a distribution center is at capacity"
        : plan.stop === "exhausted"
          ? "every tract we may build in is already taken, so no site is left at any price"
          : plan.outOfTime
            ? "planning ran out of time, so the plan is truncated and more sites remain"
            : `planning stopped at its limit of ${plan.picks.length} stores, so the plan is truncated and more sites remain`;

  return text(
    [
      `Expansion plan for ${money(budget)} (general ${money(costGeneral)}, specialty ${money(costSpecialty)}; ${describeParams(p)}).${describeScenario(overrides)}`,
      `Spent ${money(plan.spent)} on ${plan.picks.length} stores, ${money(plan.remaining)} left` +
        (plan.remaining > 0 ? ` (${why})` : "") +
        `.`,
      `Chain revenue ${money(plan.baseline.ourRevenue)} → ${money(plan.after.ourRevenue)}/yr; market share ${pct(plan.baseline.ourShare)} → ${pct(plan.after.ourShare)}.`,
      ``,
      ...(picks.length ? picks : ["No sites picked."]),
      ``,
      `Sites are tract centroids. To test the plan with supply changes, call what_if with add=${addJson}`,
    ].join("\n")
  );
}
