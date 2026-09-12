import { z } from "zod";
import { handleApiError, requestInput } from "@/lib/api";
import { runMarketCached } from "@/lib/model/market";
import { parseRequestBody } from "@/lib/model/params";
import { DEFAULT_SIMULATION, simulate } from "@/lib/model/simulate";

const schema = z
  .object({
    weeks: z.coerce.number().int().min(4).max(52).default(DEFAULT_SIMULATION.weeks),
    runs: z.coerce.number().int().min(50).max(2000).default(DEFAULT_SIMULATION.runs),
    outageProbability: z.coerce.number().min(0).max(0.5).default(DEFAULT_SIMULATION.outageProbability),
    outageWeeksMin: z.coerce.number().int().min(1).max(8).default(DEFAULT_SIMULATION.outageWeeks[0]),
    outageWeeksMax: z.coerce.number().int().min(1).max(12).default(DEFAULT_SIMULATION.outageWeeks[1]),
    startWeek: z.coerce.number().int().min(1).max(52).default(DEFAULT_SIMULATION.startWeek),
  })
  .passthrough();

/**
 * A market run plus the largest simulation the schema allows (52 weeks ×
 * 2,000 runs) measures about a third of a second here, so this is headroom
 * for a cold start on a slower serverless vCPU rather than an expected cost.
 */
export const maxDuration = 15;

/** Weekly supplier order forecast with outages. */
export async function POST(request: Request) {
  try {
    const { weeks, runs, outageProbability, outageWeeksMin, outageWeeksMax, startWeek, ...rest } = schema.parse(await requestInput(request));
    const { params, overrides } = parseRequestBody(rest);
    const market = runMarketCached(params, overrides);
    const sim = simulate(market, {
      weeks,
      runs,
      outageProbability,
      outageWeeks: [outageWeeksMin, Math.max(outageWeeksMin, outageWeeksMax)],
      startWeek,
      seed: DEFAULT_SIMULATION.seed,
    });
    return Response.json(sim, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}
