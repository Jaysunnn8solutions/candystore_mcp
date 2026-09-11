/**
 * Demand: how much each tract spends on candy per year, split into
 * traditional and specialty categories.
 *
 * Spend per household starts from a base figure at the regional median
 * income, scales with income (elasticity) and with the share of children,
 * and is multiplied by households. A tract is a specialty market for a
 * heritage segment when that segment's share of the population is at or
 * above the critical mass; that share of spend, times the affinity, moves
 * from traditional to the segment's specialty category.
 */

import type { DemandParams, TractDemand, TractProps } from "./types";

export interface RegionStats {
  medianIncome: number;
  meanChildShare: number;
}

export function regionStats(tracts: TractProps[]): RegionStats {
  const incomes = tracts.map((t) => t.medianIncome).filter((v): v is number => v != null).sort((a, b) => a - b);
  const childShares = tracts.map((t) => t.childShare).filter((v): v is number => v != null);
  return {
    medianIncome: incomes.length ? incomes[Math.floor(incomes.length / 2)] : 75_000,
    meanChildShare: childShares.length ? childShares.reduce((a, b) => a + b, 0) / childShares.length : 0.22,
  };
}

export function categoryFor(segment: string): string {
  return `specialty:${segment}`;
}

export function tractDemand(t: TractProps, p: DemandParams, stats: RegionStats): TractDemand {
  const income = t.medianIncome ?? stats.medianIncome;
  const incomeFactor = Math.pow(Math.max(income, 10_000) / stats.medianIncome, p.incomeElasticity);
  const childShare = t.childShare ?? stats.meanChildShare;
  const childFactor = Math.max(0.2, 1 + p.childBoost * (childShare - stats.meanChildShare) / Math.max(stats.meanChildShare, 0.01));
  const total = t.households * p.baseSpend * incomeFactor * childFactor;

  const byCategory: Record<string, number> = {};
  const specialtySegments: string[] = [];
  let specialtyTotal = 0;
  for (const [seg, share] of Object.entries(t.heritage ?? {})) {
    if (share >= p.criticalMass) {
      const amount = total * share * p.specialtyAffinity;
      byCategory[categoryFor(seg)] = amount;
      specialtyTotal += amount;
      specialtySegments.push(seg);
    }
  }
  byCategory.traditional = Math.max(0, total - specialtyTotal);
  return { geoid: t.geoid, byCategory, total, specialtySegments };
}

export function allDemand(tracts: TractProps[], p: DemandParams): TractDemand[] {
  const stats = regionStats(tracts);
  return tracts.map((t) => tractDemand(t, p, stats));
}
