import { loadCompetitors, loadDcs, loadManifest, loadStores } from "@/lib/data/load";

/**
 * Four small JSON files, milliseconds even cold. Stated for the same reason as
 * every other route here: no route should ride on a platform default nobody
 * chose.
 */
export const maxDuration = 15;

/** Stores, distribution centers, competitors and the manifest. */
export function GET() {
  return Response.json(
    { stores: loadStores(), dcs: loadDcs(), competitors: loadCompetitors(), manifest: loadManifest() },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
