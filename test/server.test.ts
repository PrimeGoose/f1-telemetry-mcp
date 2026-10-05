import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { generateSession } from "../src/sample/generator.js";

async function connect() {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createServer(generateSession({ seed: 3, laps: 4 })).connect(st);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(ct);
  return client;
}
const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

describe("MCP server", () => {
  it("lists all tools", async () => {
    const c = await connect();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["compare_laps", "find_braking_points", "get_car_telemetry", "get_fastest_sector", "get_lap_times", "get_session_summary", "get_tyre_wear"],
    );
  });
  it("calls tools", async () => {
    const c = await connect();
    expect(text(await c.callTool({ name: "get_session_summary", arguments: {} })).totalLaps).toBe(4);
    expect(text(await c.callTool({ name: "get_lap_times", arguments: {} }))).toHaveLength(4);
    expect(text(await c.callTool({ name: "compare_laps", arguments: { lapA: 1, lapB: 2 } })).lapA).toBe(1);
    expect(text(await c.callTool({ name: "get_car_telemetry", arguments: { lapNumber: 2, fromM: 0, toM: 500 } })).toM).toBe(500);
  });
  it("rejects invalid input and reports domain errors", async () => {
    const c = await connect();
    const bad = await c.callTool({ name: "get_fastest_sector", arguments: { sector: 4 } });
    expect(bad.isError).toBe(true);
    const missing = await c.callTool({ name: "find_braking_points", arguments: { lapNumber: 42 } });
    expect(missing.isError).toBe(true);
  });
  it("serves resources", async () => {
    const c = await connect();
    const list = await c.listResources();
    expect(list.resources.map((r) => r.uri)).toContain("f1://session/laps/1");
    const r = await c.readResource({ uri: "f1://session/laps/2" });
    expect(JSON.parse((r.contents[0] as { text: string }).text).lapNumber).toBe(2);
  });
});
