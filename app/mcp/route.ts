import { createMcpHandler } from "mcp-handler";
import { registerTools } from "@/lib/tools/register";

/** Remote MCP endpoint. Same tools as the local stdio server, minus render_map. */
const handler = createMcpHandler((server) => registerTools(server), {
  serverInfo: { name: "candystore-mcp", version: "0.1.0" },
});

export { handler as GET, handler as POST };
