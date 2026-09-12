import { handleApiError, requestInput } from "@/lib/api";
import { runMarketCached } from "@/lib/model/market";
import { parseRequestBody } from "@/lib/model/params";

/**
 * One market run over 1,200 tracts, plus reading and serializing the data on
 * a cold start. Well under a second here; this is headroom on a slower
 * serverless vCPU rather than an expected cost.
 */
export const maxDuration = 15;

/** The market result for a parameter set (GET) or a scenario (POST). */
async function handle(request: Request) {
  try {
    const { params, overrides } = parseRequestBody(await requestInput(request));
    return Response.json(runMarketCached(params, overrides), {
      headers: { "Cache-Control": request.method === "GET" ? "public, max-age=300" : "no-store" },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export { handle as GET, handle as POST };
