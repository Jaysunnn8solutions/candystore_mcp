import { z } from "zod";
import { loadManifest, loadTracts } from "../data/load";
import { runMarketCached } from "../model/market";
import {
  EMPTY_OVERRIDES,
  overridesSchema,
  paramsSchema,
  parseOverrides,
  toParams,
  type ScenarioOverrides,
} from "../model/params";
import type { MarketResult, ScenarioParams } from "../model/types";

/** Optional versions of every model parameter, for tool schemas. */
export const toolParamsShape = Object.fromEntries(
  Object.entries(paramsSchema.shape).map(([k, v]) => [k, v.optional()])
) as { [K in keyof typeof paramsSchema.shape]: z.ZodOptional<(typeof paramsSchema.shape)[K]> };

export const scenarioShape = {
  add: overridesSchema.shape.add.optional().describe("Stores to add before computing."),
  remove: overridesSchema.shape.remove.optional(),
  capacityScale: overridesSchema.shape.capacityScale.optional(),
};

export type ToolParams = Partial<Record<keyof typeof paramsSchema.shape, number>>;
export type ScenarioArgs = {
  add?: z.input<typeof overridesSchema>["add"];
  remove?: string[];
  capacityScale?: ScenarioOverrides["capacityScale"];
};

export function resolveParams(args: ToolParams | ScenarioParams): ScenarioParams {
  if ("demand" in args && "gravity" in args) return args as ScenarioParams;
  const defined = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  return toParams(paramsSchema.parse(defined));
}

export function resolveOverrides(args: ScenarioArgs): ScenarioOverrides {
  if (!args.add?.length && !args.remove?.length && !args.capacityScale?.length) return EMPTY_OVERRIDES;
  return parseOverrides({ add: args.add ?? [], remove: args.remove ?? [], capacityScale: args.capacityScale ?? [] });
}

export function market(args: ToolParams | ScenarioParams, scenario: ScenarioArgs = {}): MarketResult {
  return runMarketCached(resolveParams(args), resolveOverrides(scenario));
}

export const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function error(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true };
}

export function money(d: number): string {
  const abs = Math.abs(d);
  if (abs >= 1e6) return `$${(d / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `$${Math.round(d / 1e3)}k`;
  return `$${Math.round(d)}`;
}

export function fmtInt(x: number): string {
  return Math.round(x).toLocaleString("en-US");
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
}

export function segmentLabel(id: string): string {
  return loadManifest().segments.find((s) => s.id === id)?.label ?? id;
}

export function categoryLabel(cat: string): string {
  return cat === "traditional" ? "traditional" : `${segmentLabel(cat.replace("specialty:", ""))} specialty`;
}

export function describeParams(p: ScenarioParams): string {
  return (
    `spend $${p.demand.baseSpend}/household, income elasticity ${p.demand.incomeElasticity}, ` +
    `child boost ${p.demand.childBoost}, critical mass ${pct(p.demand.criticalMass)}, affinity ${p.demand.specialtyAffinity}; ` +
    `gravity beta ${p.gravity.beta}, alpha ${p.gravity.alpha}, reach ${p.gravity.maxKm} km, outside option ${p.gravity.outsideOption}`
  );
}

export function describeScenario(o: ScenarioOverrides): string {
  const parts: string[] = [];
  if (o.add.length) parts.push(`${o.add.length} added store${o.add.length > 1 ? "s" : ""} (${o.add.map((s) => s.type).join(", ")})`);
  if (o.remove.length) parts.push(`closed ${o.remove.join(", ")}`);
  if (o.capacityScale.length) parts.push(`capacity scaled: ${o.capacityScale.map((c) => `${c.dc} ${c.category} ×${c.factor}`).join("; ")}`);
  return parts.length ? ` Scenario: ${parts.join("; ")}.` : "";
}

export function placeLabel(place: string | undefined, county: string): string {
  if (!place) return `${county} County`;
  return place.startsWith("Unincorporated") ? place : `${place}, ${county} County`;
}

export function tractLabel(geoid: string): string {
  const f = loadTracts().features.find((t) => t.properties.geoid === geoid);
  return f ? `${f.properties.name} in ${placeLabel(f.properties.place, f.properties.county)} (${geoid})` : geoid;
}

export const geoidSchema = z.string().regex(/^13\d{9}$/).describe("11-digit tract GEOID in the ten-county region.");

export { z };
