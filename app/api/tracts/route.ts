import { loadTracts } from "@/lib/data/load";

/** Tract geometry and demographics. Static between parameter tweaks. */
export function GET() {
  return Response.json(loadTracts(), {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
