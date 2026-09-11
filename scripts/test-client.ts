/**
 * Smoke test. Against a running HTTP server:
 *   npm run test:client -- http://localhost:3000
 * Against the local stdio server (spawns it, exercises render_map too):
 *   npm run test:client -- stdio
 */
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const target = process.argv.slice(2).find((a) => a !== "--") ?? "http://localhost:3000";
const PREVIEW = 8;

async function main() {
  const client = new Client({ name: "candystore-smoke", version: "0.1.0" });
  if (target === "stdio") {
    const root = path.resolve(import.meta.dirname, "..");
    await client.connect(
      new StdioClientTransport({
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["tsx", path.join(root, "mcp", "stdio.ts")],
        cwd: root,
      })
    );
    console.log("Connected to local stdio server");
  } else {
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", `${target}/`)));
    console.log("Connected to", target);
  }

  const { tools } = await client.listTools();
  console.log(`Tools (${tools.length}):`, tools.map((t) => t.name).join(", "));
  const { prompts } = await client.listPrompts();
  console.log(`Prompts (${prompts.length}):`, prompts.map((p) => p.name).join(", "));
  const { resources } = await client.listResources();
  console.log(`Resources (${resources.length}):`, resources.map((r) => r.uri).join(", "));

  const calls: Array<[string, Record<string, unknown>]> = [
    ["describe_market", {}],
    ["get_tract", { geoid: "13135050537" }],
    ["segment_markets", { segment: "eastasia", limit: 5 }],
    ["store_performance", {}],
    ["find_sites", { budget: 6_000_000 }],
    ["what_if", { add: [{ type: "specialty", lon: -84.16, lat: 33.95, segments: ["eastasia", "southasia"] }], capacityScale: [{ dc: "dc-east", category: "specialty:eastasia", factor: 2 }] }],
    ["forecast_orders", { weeks: 8, runs: 100, startWeek: 40 }],
    ["search_place", { query: "Buford Highway", withinKm: 2, limit: 4 }],
    ["load_view", { link: "https://candystore-mcp.vercel.app/#mode=specialty&seg=latam&scn=specialty@33.95000,-84.16000@1@eastasia+southasia" }],
  ];
  if (target === "stdio") calls.push(["render_map", { mode: "specialty", segment: "eastasia" }]);

  let failures = 0;
  for (const [name, args] of calls) {
    const started = Date.now();
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    const body = result.content?.find((c) => c.type === "text")?.text ?? JSON.stringify(result);
    if (result.isError) failures++;
    console.log(`\n=== ${name} (${result.isError ? "ERROR" : "ok"}, ${Date.now() - started} ms) ===`);
    console.log(body.split("\n").slice(0, PREVIEW).join("\n"));
  }

  await client.close();
  if (failures > 0) {
    console.error(`\n${failures} tool call(s) returned isError`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
