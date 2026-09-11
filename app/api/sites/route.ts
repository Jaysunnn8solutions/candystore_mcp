import { z } from "zod";
import { handleApiError, requestInput } from "@/lib/api";
import { DEFAULT_STORE_COSTS, planSites } from "@/lib/model/optimizer";
import { parseRequestBody } from "@/lib/model/params";

const schema = z
  .object({
    budget: z.coerce.number().min(100_000).max(1_000_000_000),
    costGeneral: z.coerce.number().positive().default(DEFAULT_STORE_COSTS.general),
    costSpecialty: z.coerce.number().positive().default(DEFAULT_STORE_COSTS.specialty),
    types: z.array(z.enum(["general", "specialty"])).min(1).default(["general", "specialty"]),
  })
  .passthrough();

/** Budget-constrained store site selection. */
export async function POST(request: Request) {
  try {
    const { budget, costGeneral, costSpecialty, types, ...rest } = schema.parse(await requestInput(request));
    const { params, overrides } = parseRequestBody(rest);
    const plan = planSites({ budget, costs: { general: costGeneral, specialty: costSpecialty }, types }, params, overrides);
    return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}
