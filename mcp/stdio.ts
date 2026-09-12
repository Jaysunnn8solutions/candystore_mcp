/**
 * Local MCP server over stdio. Same tools as the Vercel endpoint, plus
 * render_map, which writes a self-contained HTML map to disk. Add it to
 * Claude Code with:
 *
 *   claude mcp add candy -- npx tsx C:/path/to/candystore_mcp/mcp/stdio.ts
 *
 * The data directory is resolved relative to this file, so the server
 * works from any working directory.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { renderMapHtml } from "../lib/render/html";
import { registerTools } from "../lib/tools/register";
import { error, market, resolveOverrides, scenarioShape, text, toolParamsShape, z, type ScenarioArgs, type ToolParams } from "../lib/tools/shared";

// Point the loaders at this repo's data regardless of cwd. ||= rather than
// ??=, because the loaders test the variable for truthiness, so an empty
// string has to be replaced too.
process.env.CANDY_DATA_DIR ||= path.resolve(import.meta.dirname, "..", "data");

const server = new McpServer({ name: "candystore-mcp", version: "0.1.0" });
registerTools(server);

const renderConfig = {
  title: "Render the map to an HTML file",
  description:
    "Write a self-contained HTML map (Leaflet inlined, no server needed) of the " +
    "current scenario: demand, specialty demand by segment, our share, " +
    "uncaptured demand, stores, centers and competitors. Returns the file path. " +
    "Local only.",
  inputSchema: z
    .object({
      path: z.string().max(400).optional().describe("Output file path. Defaults to ./candy-map-<timestamp>.html in the current directory."),
      overwrite: z.boolean().default(false).describe("Replace the file if it already exists. Off by default, so a map never overwrites an existing file."),
      mode: z.enum(["demand", "specialty", "share", "uncaptured"]).default("demand"),
      segment: z.string().default("latam"),
      title: z.string().max(120).optional(),
      ...toolParamsShape,
      ...scenarioShape,
    })
    .strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

interface RenderArgs extends ToolParams, ScenarioArgs {
  path?: string;
  overwrite: boolean;
  mode: "demand" | "specialty" | "share" | "uncaptured";
  segment: string;
  title?: string;
}

server.registerTool("render_map", renderConfig, ({ path: outPath, overwrite, mode, segment, title, add, remove, capacityScale, ...params }: RenderArgs) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.resolve(outPath ?? `candy-map-${stamp}.html`);
  // destructiveHint: false is only honest if the tool never replaces a file
  // the caller did not mean to lose, so ask before clobbering one.
  if (!overwrite && existsSync(file)) {
    return error(`${file} already exists. Pass overwrite: true to replace it, or omit path for a fresh timestamped file.`);
  }
  const overrides = resolveOverrides({ add, remove, capacityScale });
  const result = market(params, { add, remove, capacityScale });
  const html = renderMapHtml(result, overrides, { mode, segment, title });
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, html, "utf8");
  return text(
    `Wrote ${file} (${(html.length / 1024).toFixed(0)} KB). Open it in a browser; it needs no server. ` +
      `Layer: ${mode}${mode === "specialty" ? ` (${segment})` : ""}; ${result.stores.length} stores; chain revenue $${Math.round(result.totals.ourRevenue / 1e3)}k/yr.`
  );
});

const transport = new StdioServerTransport();
await server.connect(transport);
