#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSession } from "./data.js";
import { startHttp } from "./http.js";
import { createServer } from "./server.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const useHttp = args.includes("--http") || process.env.MCP_TRANSPORT === "http";

const session = loadSession();
if (useHttp) {
  const port = Number(flag("--port") ?? process.env.PORT ?? 3333);
  const host = flag("--host") ?? process.env.HOST ?? "127.0.0.1";
  await startHttp(session, port, host);
  console.error(`f1-telemetry-mcp on http://${host}:${port}/mcp (session: ${session.label})`);
} else {
  await createServer(session).connect(new StdioServerTransport());
  console.error(`f1-telemetry-mcp running on stdio (session: ${session.label})`);
}
