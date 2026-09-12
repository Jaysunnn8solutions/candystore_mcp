import { loadTracts } from "@/lib/data/load";

/**
 * Reading and serializing a 1.5 MB tract file on a cold start, cached in the
 * process after that. Well under a second here; this is headroom on a slower
 * serverless vCPU rather than an expected cost, stated so the route does not
 * ride on a platform default.
 */
export const maxDuration = 15;

/** Tract geometry and demographics. Static between parameter tweaks. */
export function GET() {
  return Response.json(loadTracts(), {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
