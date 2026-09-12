import { createMcpHandler } from "mcp-handler";
import { registerTools } from "@/lib/tools/register";

/**
 * find_sites is served here too, and it is the most expensive tool in the set:
 * planSites' own budget lets it run for eight seconds plus the market pass in
 * flight when the clock expires. Matches /api/sites, and stays inside the 60s
 * ceiling Vercel Hobby allows.
 */
export const maxDuration = 30;

/** Remote MCP endpoint. Same tools as the local stdio server, minus render_map. */
const handler = createMcpHandler((server) => registerTools(server), {
  serverInfo: { name: "candystore-mcp", version: "0.1.0" },
});

export { handler as GET, handler as POST };
