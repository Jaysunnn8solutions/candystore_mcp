import { loadCompetitors, loadDcs, loadManifest, loadStores } from "@/lib/data/load";

/** Stores, distribution centers, competitors and the manifest. */
export function GET() {
  return Response.json(
    { stores: loadStores(), dcs: loadDcs(), competitors: loadCompetitors(), manifest: loadManifest() },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
