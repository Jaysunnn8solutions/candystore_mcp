/** Properties attached to each tract by the offline pipeline. */
export interface TractProps {
  geoid: string;
  name: string;
  countyFips: string;
  county: string;
  place: string;
  landKm2: number;
  cx: number;
  cy: number;
  neighbors: string[];
  pop: number;
  households: number;
  medianIncome: number | null;
  childShare: number | null;
  noVehicleRate: number | null;
  foreignBornShare: number | null;
  /** Heritage segment id → share of population born in that region group. */
  heritage: Record<string, number>;
  pop2019: number | null;
}

export type StoreType = "general" | "specialty";

/** A store we operate (existing or proposed). */
export interface Store {
  id: string;
  name: string;
  type: StoreType;
  lon: number;
  lat: number;
  /** Relative draw in the gravity model; 1 is a typical store. */
  size: number;
  /** Specialty stores carry these heritage segments. */
  segments: string[];
  /** Distribution center id; resolved to the nearest if omitted. */
  dc?: string;
  /** True for a store added by a scenario or the optimizer. */
  proposed?: boolean;
}

/** A competitor from OpenStreetMap. Treated as a general store of size 0.8. */
export interface Competitor {
  id: string;
  name: string;
  kind: string;
  lon: number;
  lat: number;
}

/** Candy categories: traditional plus one per heritage segment. */
export type Category = "traditional" | `specialty:${string}`;

export interface DistributionCenter {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Weekly capacity in retail-dollar equivalents by category. */
  capacity: Record<string, number>;
}

export interface DemandParams {
  /** Annual candy spend per household at the regional median income, dollars. */
  baseSpend: number;
  /** Spend ∝ (income / median)^elasticity. */
  incomeElasticity: number;
  /** Multiplier per unit of child share above/below the regional average. */
  childBoost: number;
  /** Segment share at which a tract becomes a specialty market. */
  criticalMass: number;
  /** Share of a heritage household's candy spend that goes to familiar (specialty) candy. */
  specialtyAffinity: number;
}

export interface GravityParams {
  /** Distance decay exponent. */
  beta: number;
  /** Size exponent. */
  alpha: number;
  /** Beyond this, a store draws nothing. */
  maxKm: number;
  /** Utility of "buy candy somewhere else" (grocery, online). Higher means stores capture less. */
  outsideOption: number;
}

export interface ScenarioParams {
  demand: DemandParams;
  gravity: GravityParams;
}

export interface TractDemand {
  geoid: string;
  /** Annual dollars by category. */
  byCategory: Record<string, number>;
  total: number;
  /** Segments at or above critical mass. */
  specialtySegments: string[];
}

export interface StoreResult {
  id: string;
  name: string;
  type: StoreType;
  dc: string;
  /** Annual revenue captured before supply caps, by category. */
  demandBy: Record<string, number>;
  demand: number;
  /** After supply caps. */
  revenueBy: Record<string, number>;
  revenue: number;
  /** Share of demand fulfilled after caps (0–1). */
  fillRate: number;
}

export interface DcResult {
  id: string;
  name: string;
  /** Weekly demand routed here by category, versus weekly capacity. */
  weeklyDemand: Record<string, number>;
  capacity: Record<string, number>;
  fillRate: Record<string, number>;
  stores: string[];
}

export interface MarketResult {
  params: ScenarioParams;
  tracts: Array<
    TractDemand & {
      /** Share of the tract's spend captured by our stores, by category. */
      captured: Record<string, number>;
      /** Our best-placed store for the tract, if any. */
      primaryStore: string | null;
    }
  >;
  stores: StoreResult[];
  dcs: DcResult[];
  totals: {
    marketDemand: number;
    marketByCategory: Record<string, number>;
    ourDemand: number;
    ourRevenue: number;
    ourShare: number;
    lostToCaps: number;
  };
  segments: Array<{ id: string; label: string; markets: number; population: number; demand: number }>;
}
