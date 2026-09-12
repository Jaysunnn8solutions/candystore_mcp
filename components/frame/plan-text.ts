import type { SitePlan } from "@/lib/model/optimizer";
import { money } from "../scales";

/** Why capital is left over. Only the minimum-gain exit is one that more capacity can fix. */
export function remainderNote(plan: SitePlan): string {
  // Leftover below the cheapest store we may build is the budget exit, and it is
  // also the truth when a truncated plan happens to end with small change, where
  // "more sites remain" would be wrong.
  const cheapest = Math.min(...plan.options.types.map((t) => plan.options.costs[t]));
  if (plan.remaining < cheapest) return `less than the ${money(cheapest)} the cheapest store we may build costs.`;
  if (plan.stop === "minGain") return "no shortlisted site cleared the minimum gain, which can mean a distribution center is at capacity. Raise capacity below and plan again.";
  if (plan.stop === "exhausted") return "every tract we may build in is already taken, so no site is left at any price.";
  if (plan.outOfTime) return "planning ran out of time, so the plan is truncated and more sites remain.";
  if (plan.stop === "maxPicks") return `planning stopped at its limit of ${plan.picks.length} stores, so the plan is truncated and more sites remain.`;
  // A stop reason this panel does not know about says nothing about whether
  // sites remain, so it says only what is certain: the money went unspent.
  return "planning stopped before spending it.";
}

/** True when the leftover is the one the deck's capacity meters can relieve. */
export function remainderIsCapacity(plan: SitePlan): boolean {
  const cheapest = Math.min(...plan.options.types.map((t) => plan.options.costs[t]));
  return plan.remaining >= cheapest && plan.stop === "minGain";
}
