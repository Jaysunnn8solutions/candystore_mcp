/**
 * Smoke test. Against a running HTTP server:
 *   npm run test:client -- http://localhost:3000
 * Against the local stdio server (spawns it, exercises render_map too):
 *   npm run test:client -- stdio
 *
 * Covers every registered tool on the transport under test, both prompts and
 * resources, and the arguments that must be rejected: an unknown distribution
 * center, an unknown segment id, and render_map refusing to clobber a file.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const target = process.argv.slice(2).find((a) => a !== "--") ?? "http://localhost:3000";
const PREVIEW = 8;

// Out of the repo, and fixed rather than timestamped, so a re-run overwrites
// the same file instead of leaving one behind per run.
const MAP_DIR = path.join(os.tmpdir(), "candystore-smoke");
const MAP_FILE = path.join(MAP_DIR, "map.html");

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
  if (target === "stdio") {
    mkdirSync(MAP_DIR, { recursive: true });
    rmSync(MAP_FILE, { force: true });
    calls.push(["render_map", { mode: "specialty", segment: "eastasia", path: MAP_FILE }]);
  }

  // Arguments that must come back as an error. A silently wrong number here
  // is the failure these check for, so isError is the passing outcome.
  const rejects: Array<[string, string, Record<string, unknown>]> = [
    ["what_if", "unknown store dc", { add: [{ type: "general", lon: -84.16, lat: 33.95, dc: "dc-north" }] }],
    ["what_if", "unknown capacityScale dc", { capacityScale: [{ dc: "dc-eastt", category: "traditional", factor: 0.5 }] }],
    ["what_if", "unknown segment id", { add: [{ type: "specialty", lon: -84.16, lat: 33.95, segments: ["eastasian"] }] }],
  ];
  // render_map already wrote MAP_FILE above, so a second call without
  // overwrite has to refuse rather than replace it.
  if (target === "stdio") rejects.push(["render_map", "existing file, no overwrite", { mode: "demand", path: MAP_FILE }]);

  let failures = 0;
  for (const [name, args] of calls) {
    const started = Date.now();
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    const body = result.content?.find((c) => c.type === "text")?.text ?? JSON.stringify(result);
    if (result.isError) failures++;
    console.log(`\n=== ${name} (${result.isError ? "ERROR" : "ok"}, ${Date.now() - started} ms) ===`);
    console.log(body.split("\n").slice(0, PREVIEW).join("\n"));
  }

  // Prompt arguments arrive as strings over the wire, which is what these pass.
  const promptCalls: Array<[string, Record<string, string>]> = [
    ["expansion_plan", { budget: "25000000" }],
    ["segment_brief", { segment: "eastasia" }],
    ["supplier_forecast", { weeks: "12", startWeek: "42" }],
  ];
  for (const [name, args] of promptCalls) {
    try {
      const r = await client.getPrompt({ name, arguments: args });
      const body = r.messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("\n");
      console.log(`\n=== prompt ${name} (ok) ===`);
      console.log(body.split("\n").slice(0, PREVIEW).join("\n"));
    } catch (e) {
      failures++;
      console.log(`\n=== prompt ${name} (ERROR) ===\n${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const uri of ["candy://data/manifest", "candy://method"]) {
    try {
      const r = await client.readResource({ uri });
      const body = r.contents.map((c) => ("text" in c ? c.text : "")).join("\n");
      console.log(`\n=== resource ${uri} (ok, ${body.length} chars) ===`);
      console.log(body.split("\n").slice(0, 4).join("\n"));
    } catch (e) {
      failures++;
      console.log(`\n=== resource ${uri} (ERROR) ===\n${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const [name, label, args] of rejects) {
    let rejected = false;
    let body = "";
    try {
      const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      rejected = result.isError === true;
      body = result.content?.find((c) => c.type === "text")?.text ?? JSON.stringify(result);
    } catch (e) {
      rejected = true;
      body = e instanceof Error ? e.message : String(e);
    }
    if (!rejected) failures++;
    console.log(`\n=== ${name}: ${label} (${rejected ? "rejected, as it should be" : "ACCEPTED — should have been rejected"}) ===`);
    console.log(body.split("\n").slice(0, 4).join("\n"));
  }

  if (target === "stdio") {
    console.log(`\nrender_map wrote ${MAP_FILE}: ${existsSync(MAP_FILE) ? "yes" : "NO"}`);
  }

  await client.close();
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${calls.length + promptCalls.length + 2 + rejects.length} checks passed`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
