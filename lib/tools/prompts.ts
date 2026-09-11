import { z } from "zod";

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export const expansionPrompt = {
  name: "expansion_plan",
  config: {
    title: "Plan an expansion",
    description: "Where to open new general and specialty candy stores with a given budget, and what it does to supply.",
    argsSchema: z.object({ budget: z.number().min(100_000).max(1_000_000_000).default(10_000_000) }),
  },
  handler: ({ budget }: { budget: number }) =>
    userMessage(
      [
        `Plan a ${budget.toLocaleString("en-US")}-dollar expansion of our candy store chain in metro Atlanta.`,
        `1. Call describe_market to understand the baseline.`,
        `2. Call find_sites with budget ${budget}.`,
        `3. Call what_if with the picks as add, then forecast_orders with the same add for 26 weeks from week 36.`,
        `4. If a distribution center caps revenue, test capacityScale on that center and category and say what the extra capacity is worth.`,
        `Report: the sites in order, revenue added per site net of cannibalization, the general/specialty split and why, which centers bind, and the supplier order forecast with p90 for the peak weeks. State that costs, spend and capacities are mock assumptions.`,
      ].join("\n")
    ),
};

export const segmentPrompt = {
  name: "segment_brief",
  config: {
    title: "Brief on a heritage segment",
    description: "Where a heritage segment's specialty demand sits, how much we capture, and where a specialty store would go.",
    argsSchema: z.object({ segment: z.string() }),
  },
  handler: ({ segment }: { segment: string }) =>
    userMessage(
      [
        `Brief me on the ${segment} specialty candy market in metro Atlanta.`,
        `Call segment_markets for ${segment}, then get_tract on the top two uncaptured tracts, then find_sites with types ["specialty"] and a budget of 3000000.`,
        `Explain where the segment lives, how big the specialty demand is, what our existing specialty store captures, and where new specialty stores would go. Note the supply cap for that segment's category at each distribution center.`,
      ].join("\n")
    ),
};

export const supplierPrompt = {
  name: "supplier_forecast",
  config: {
    title: "Supplier order forecast",
    description: "Expected weekly orders per distribution center and category, with ranges, for the coming season.",
    argsSchema: z.object({ weeks: z.number().int().min(4).max(52).default(26), startWeek: z.number().int().min(1).max(52).default(36) }),
  },
  handler: ({ weeks, startWeek }: { weeks: number; startWeek: number }) =>
    userMessage(
      [
        `Prepare a supplier order forecast for the next ${weeks} weeks starting calendar week ${startWeek}.`,
        `Call store_performance for current utilization, then forecast_orders with weeks ${weeks} and startWeek ${startWeek}.`,
        `Write it for a supplier: expected order per center and category per week, the p90 for peak weeks, the risk from outages, and which categories are close to capacity.`,
      ].join("\n")
    ),
};
