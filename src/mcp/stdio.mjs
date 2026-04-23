/**
 * USPhoneBook OSINT MCP — stdio. Use: npm run mcp
 * Logs must go to stderr; stdout is JSON-RPC.
 */
import "../env.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/db.mjs";
import { getFullGraph, getNeighborhood, searchEntitiesByLabel } from "../graphQuery.mjs";
import { getVectorStatus } from "../vectorStore.mjs";
import { getPhoneCache, cacheStats } from "../phoneCache.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();

const server = new McpServer({
  name: "usphonebook-osint",
  version: "1.0.0",
});

server.tool(
  "graph_get_full",
  "Return the full entity graph (nodes and edges) from the local SQLite store.",
  {},
  async () => {
    const g = getFullGraph();
    return {
      content: [{ type: "text", text: JSON.stringify(g) }],
    };
  }
);

server.tool(
  "graph_get_neighborhood",
  "Subgraph around one entity id to a small depth (default 1).",
  {
    entityId: z.string(),
    depth: z.number().int().min(1).max(3).optional().default(1),
  },
  async ({ entityId, depth }) => {
    const g = getNeighborhood(entityId, depth);
    return { content: [{ type: "text", text: JSON.stringify(g) }] };
  }
);

server.tool(
  "entity_search",
  "Search entity labels and dedupe keys (LIKE).",
  {
    q: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional().default(20),
  },
  async ({ q, limit }) => {
    const rows = searchEntitiesByLabel(q, limit);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  }
);

server.tool(
  "entity_get",
  "Fetch one entity row by id.",
  { id: z.string() },
  async ({ id }) => {
    const row = getDb()
      .prepare("SELECT * FROM entities WHERE id = ?")
      .get(id);
    if (!row) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "not found" }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(row) }] };
  }
);

server.tool(
  "vector_status",
  "Return ruvector (optional) init status and storage path.",
  {},
  async () => {
    const s = await getVectorStatus();
    return { content: [{ type: "text", text: JSON.stringify(s) }] };
  }
);

server.tool(
  "cache_get_phone",
  "Read a cached Flare+parse result for a dashed number (e.g. 207-242-0526) if not expired.",
  { dashed: z.string() },
  async ({ dashed }) => {
    const b = getPhoneCache(dashed.trim());
    return {
      content: [
        { type: "text", text: JSON.stringify(b ? { hit: true, body: b } : { hit: false }) },
      ],
    };
  }
);

server.tool("cache_stats", "Phone result cache row count and TTL (SQLite).", {}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(cacheStats()) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
