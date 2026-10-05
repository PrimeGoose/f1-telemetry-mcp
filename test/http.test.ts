import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server, AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttp } from "../src/http.js";
import { loadSession } from "../src/data.js";

let http: Server;
beforeAll(async () => {
  http = await startHttp(loadSession(), 0);
});
afterAll(() => new Promise<void>((r) => http.close(() => r())));

describe("streamable HTTP transport", () => {
  it("lists and calls tools over HTTP", async () => {
    const { port } = http.address() as AddressInfo;
    const c = new Client({ name: "t", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    expect((await c.listTools()).tools).toHaveLength(7);
    const r = await c.callTool({ name: "get_session_summary", arguments: {} });
    expect(JSON.parse((r.content as { text: string }[])[0].text).totalLaps).toBe(8);
    await c.close();
  });
});
