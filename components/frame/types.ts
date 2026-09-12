import type { MarketResult, StoreType, TractProps } from "@/lib/model/types";

export interface SelectedTract {
  props: TractProps;
  result: MarketResult["tracts"][number] | undefined;
}

export interface BudgetRequest {
  budget: number;
  costGeneral: number;
  costSpecialty: number;
  types: StoreType[];
}

export interface ForecastRequest {
  weeks: number;
  startWeek: number;
  outageProbability: number;
}

/** The budget panel's draft, lifted so every region is presentational. */
export interface BudgetDraft {
  budgetM: number;
  costG: number;
  costS: number;
  general: boolean;
  specialty: boolean;
}

export interface ForecastDraft {
  weeks: number;
  startWeek: number;
  outage: number;
}

/**
 * Which single popover is open, app-wide. One owner because four things claim
 * Esc and independent listeners would close the wrong one.
 */
export type PopoverId = "about" | "share" | "search" | `cap:${string}` | null;
