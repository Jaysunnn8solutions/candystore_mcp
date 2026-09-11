import { handleApiError, requestInput } from "@/lib/api";
import { runMarketCached } from "@/lib/model/market";
import { parseRequestBody } from "@/lib/model/params";

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
