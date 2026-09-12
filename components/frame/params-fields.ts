import { DEFAULT_PARAMS } from "@/lib/model/params";
import type { ScenarioParams } from "@/lib/model/types";
import { pct } from "../scales";

export interface ParamField {
  group: "demand" | "gravity";
  key: string;
  label: string;
  /** What fits in a 10px dial label. The full label carries the aria text. */
  short: string;
  min: number;
  max: number;
  step: number;
  hint: string;
  fmt?: (v: number) => string;
}

/**
 * `alpha` was always in the hash contract and in every copied link, but the old
 * sidebar had no control for it, so a link could carry a size effect the map
 * offered no way to see or change. Its bounds come from paramsSchema.
 */
export const PARAM_FIELDS: ParamField[] = [
  { group: "demand", key: "baseSpend", label: "Spend per household", short: "Spend / hh", min: 20, max: 400, step: 5, hint: "annual candy spend at the median income" },
  { group: "demand", key: "incomeElasticity", label: "Income effect", short: "Income", min: 0, max: 1.5, step: 0.05, hint: "how strongly spend rises with income" },
  { group: "demand", key: "childBoost", label: "Children effect", short: "Children", min: 0, max: 3, step: 0.1, hint: "how strongly a young population raises spend" },
  { group: "demand", key: "criticalMass", label: "Critical mass", short: "Crit. mass", min: 0.02, max: 0.3, step: 0.01, hint: "segment share needed for a specialty market", fmt: pct },
  { group: "demand", key: "specialtyAffinity", label: "Specialty affinity", short: "Spec. aff.", min: 0, max: 1, step: 0.05, hint: "share of a heritage household's spend on familiar candy" },
  { group: "gravity", key: "alpha", label: "Size effect", short: "Size", min: 0, max: 3, step: 0.05, hint: "how much store size matters" },
  { group: "gravity", key: "maxKm", label: "Store reach (km)", short: "Reach km", min: 2, max: 20, step: 0.5, hint: "beyond this a store draws nothing" },
  { group: "gravity", key: "beta", label: "Distance decay", short: "Decay", min: 0.5, max: 4, step: 0.1, hint: "higher means people travel less" },
  { group: "gravity", key: "outsideOption", label: "Buy elsewhere", short: "Buy elsew.", min: 0, max: 0.2, step: 0.005, hint: "pull of grocery and online", fmt: pct },
];

export function paramValue(params: ScenarioParams, f: ParamField): number {
  return (params[f.group] as unknown as Record<string, number>)[f.key];
}

export function paramDefault(f: ParamField): number {
  return (DEFAULT_PARAMS[f.group] as unknown as Record<string, number>)[f.key];
}

export function changedParamCount(params: ScenarioParams): number {
  return PARAM_FIELDS.filter((f) => paramValue(params, f) !== paramDefault(f)).length;
}
