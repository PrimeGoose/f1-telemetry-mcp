#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSession } from "./data.js";
import { createServer } from "./server.js";

const session = loadSession();
const server = createServer(session);
await server.connect(new StdioServerTransport());
console.error(`f1-telemetry-mcp running on stdio (session: ${session.label})`);
