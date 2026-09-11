/**
 * One registration function for both transports: the HTTP handler on
 * Vercel and the stdio server run locally. The stdio server adds
 * render_map on top, because only a local process can write a file.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { describeMarketConfig, describeMarketHandler } from "./describe-market";
import { findSitesConfig, findSitesHandler } from "./find-sites";
import { forecastOrdersConfig, forecastOrdersHandler } from "./forecast-orders";
import { getTractConfig, getTractHandler } from "./get-tract";
import { loadViewConfig, loadViewHandler } from "./load-view";
import { expansionPrompt, segmentPrompt, supplierPrompt } from "./prompts";
import { manifestResource, methodResource } from "./resources";
import { searchPlaceConfig, searchPlaceHandler } from "./search-place";
import { segmentMarketsConfig, segmentMarketsHandler } from "./segment-markets";
import { storePerformanceConfig, storePerformanceHandler } from "./store-performance";
import { whatIfConfig, whatIfHandler } from "./what-if";

export function registerTools(server: McpServer): void {
  server.registerTool("describe_market", describeMarketConfig, describeMarketHandler);
  server.registerTool("load_view", loadViewConfig, loadViewHandler);
  server.registerTool("get_tract", getTractConfig, getTractHandler);
  server.registerTool("search_place", searchPlaceConfig, searchPlaceHandler);
  server.registerTool("segment_markets", segmentMarketsConfig, segmentMarketsHandler);
  server.registerTool("store_performance", storePerformanceConfig, storePerformanceHandler);
  server.registerTool("find_sites", findSitesConfig, findSitesHandler);
  server.registerTool("what_if", whatIfConfig, whatIfHandler);
  server.registerTool("forecast_orders", forecastOrdersConfig, forecastOrdersHandler);

  server.registerPrompt(expansionPrompt.name, expansionPrompt.config, expansionPrompt.handler);
  server.registerPrompt(segmentPrompt.name, segmentPrompt.config, segmentPrompt.handler);
  server.registerPrompt(supplierPrompt.name, supplierPrompt.config, supplierPrompt.handler);
  server.registerResource(manifestResource.name, manifestResource.uri, manifestResource.config, manifestResource.handler);
  server.registerResource(methodResource.name, methodResource.uri, methodResource.config, methodResource.handler);
}
