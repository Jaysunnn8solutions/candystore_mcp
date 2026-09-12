import { geocode } from "@/lib/geocode";

/**
 * geocode() tries Nominatim and then the Census geocoder in turn, each with
 * its own 8s timeout, so a run where both hang takes about 16 seconds before
 * the fallbacks hand back an empty match list. The 10s Hobby default would
 * kill that request mid-flight and lose the answer the timeouts are there to
 * produce; 60s is the most Hobby allows, so this keeps margin in hand.
 */
export const maxDuration = 30;

/** Place search proxied through the server so the browser never calls the geocoders directly. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 120) {
    return Response.json({ error: "q must be 2–120 characters" }, { status: 400 });
  }
  const matches = await geocode(q);
  return Response.json(
    { query: q, matches },
    { headers: { "Cache-Control": "public, max-age=86400" } }
  );
}
