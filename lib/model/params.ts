import { z } from "zod";
import type { DemandParams, GravityParams, ScenarioParams, Store } from "./types";

export const DEFAULT_DEMAND: DemandParams = {
  baseSpend: 120,
  incomeElasticity: 0.4,
  childBoost: 0.8,
  criticalMass: 0.08,
  specialtyAffinity: 0.6,
};

export const DEFAULT_GRAVITY: GravityParams = {
  beta: 2,
  alpha: 1,
  maxKm: 8,
  outsideOption: 0.02,
};

export const DEFAULT_PARAMS: ScenarioParams = { demand: DEFAULT_DEMAND, gravity: DEFAULT_GRAVITY };

/** Flat, query-string-friendly parameter schema shared by API and tools. */
export const paramsSchema = z
  .object({
    baseSpend: z.coerce.number().min(10).max(1000).default(DEFAULT_DEMAND.baseSpend)
      .describe("Annual candy spend per household at the regional median income, dollars."),
    incomeElasticity: z.coerce.number().min(0).max(2).default(DEFAULT_DEMAND.incomeElasticity)
      .describe("Spend scales with (income / median) to this power."),
    childBoost: z.coerce.number().min(0).max(5).default(DEFAULT_DEMAND.childBoost)
      .describe("How strongly a high share of children raises spend."),
    criticalMass: z.coerce.number().min(0.01).max(0.5).default(DEFAULT_DEMAND.criticalMass)
      .describe("Segment share of population at which a tract counts as a specialty market."),
    specialtyAffinity: z.coerce.number().min(0).max(1).default(DEFAULT_DEMAND.specialtyAffinity)
      .describe("Share of a heritage household's candy spend that goes to familiar candy."),
    beta: z.coerce.number().min(0.5).max(4).default(DEFAULT_GRAVITY.beta)
      .describe("Distance decay in the gravity model; higher means people travel less."),
    alpha: z.coerce.number().min(0).max(3).default(DEFAULT_GRAVITY.alpha)
      .describe("How much store size matters."),
    maxKm: z.coerce.number().min(1).max(30).default(DEFAULT_GRAVITY.maxKm)
      .describe("Beyond this distance a store draws nothing."),
    outsideOption: z.coerce.number().min(0).max(1).default(DEFAULT_GRAVITY.outsideOption)
      .describe("Pull of buying candy elsewhere (grocery, online). Higher means stores capture less."),
  })
  .strict();

export type ParamsInput = z.input<typeof paramsSchema>;

export function toParams(q: z.output<typeof paramsSchema>): ScenarioParams {
  return {
    demand: {
      baseSpend: q.baseSpend,
      incomeElasticity: q.incomeElasticity,
      childBoost: q.childBoost,
      criticalMass: q.criticalMass,
      specialtyAffinity: q.specialtyAffinity,
    },
    gravity: { beta: q.beta, alpha: q.alpha, maxKm: q.maxKm, outsideOption: q.outsideOption },
  };
}

export function parseParams(input: unknown): ScenarioParams {
  return toParams(paramsSchema.parse(input ?? {}));
}

/** Flatten ScenarioParams back to the query shape. */
export function flattenParams(p: ScenarioParams): z.output<typeof paramsSchema> {
  return { ...p.demand, ...p.gravity };
}

export const lonSchema = z.number().min(-85.5).max(-83.2);
export const latSchema = z.number().min(33.0).max(34.7);

export const storeSchema = z
  .object({
    type: z.enum(["general", "specialty"]),
    lon: lonSchema,
    lat: latSchema,
    size: z.number().min(0.2).max(5).default(1),
    segments: z.array(z.string().max(20)).max(7).default([])
      .describe("Specialty stores only: heritage segment ids they carry. Empty means 'pick the strongest local segments'."),
    name: z.string().max(80).optional(),
    dc: z.string().max(40).optional(),
  })
  .strict();

export interface ScenarioOverrides {
  add: Store[];
  remove: string[];
  /** Multiply a DC's capacity for a category (or all with "*") by a factor. */
  capacityScale: Array<{ dc: string; category: string; factor: number }>;
}

export const overridesSchema = z
  .object({
    add: z.array(storeSchema).max(100).default([]),
    remove: z.array(z.string().max(40)).max(100).default([]).describe("Ids of existing stores to close."),
    capacityScale: z
      .array(z.object({ dc: z.string().max(40), category: z.string().max(40), factor: z.number().min(0).max(10) }).strict())
      .max(50)
      .default([])
      .describe("Scale a distribution center's weekly capacity: category '*' means all categories."),
  })
  .strict();

export const EMPTY_OVERRIDES: ScenarioOverrides = { add: [], remove: [], capacityScale: [] };

export function parseOverrides(input: unknown): ScenarioOverrides {
  const o = overridesSchema.parse(input ?? {});
  return {
    add: o.add.map((s, i) => ({
      id: `new-${i}`,
      name: s.name ?? `Proposed ${s.type} store`,
      type: s.type,
      lon: s.lon,
      lat: s.lat,
      size: s.size,
      segments: s.segments,
      dc: s.dc,
      proposed: true,
    })),
    remove: o.remove,
    capacityScale: o.capacityScale,
  };
}

export function parseRequestBody(body: unknown): { params: ScenarioParams; overrides: ScenarioOverrides } {
  const record = (body ?? {}) as Record<string, unknown>;
  const { add, remove, capacityScale, ...rest } = record;
  return {
    params: parseParams(rest),
    overrides: parseOverrides({ add: add ?? [], remove: remove ?? [], capacityScale: capacityScale ?? [] }),
  };
}
