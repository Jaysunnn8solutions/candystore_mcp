/**
 * Runs every stage in order. Raw downloads are cached under pipeline/cache.
 *
 *   npm run pipeline
 */

import { buildAcs } from "./acs";
import { assemble } from "./assemble";
import { buildCompetitors } from "./competitors";
import { log } from "./lib/http";
import { buildTracts } from "./tracts";

async function main() {
  const started = Date.now();
  const tracts = await buildTracts();
  const [acs, competitors] = await Promise.all([buildAcs(), buildCompetitors(tracts)]);
  assemble(tracts, acs, competitors.length);
  log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
