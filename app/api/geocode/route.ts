import { geocode } from "@/lib/geocode";

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
