import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as A from "./analysis/index.js";
import type { Session } from "./types.js";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

/** Wraps a handler so domain errors become MCP tool errors instead of protocol failures. */
const safe =
  <T>(fn: (args: T) => unknown) =>
  async (args: T) => {
    try {
      return json(fn(args));
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
    }
  };

const lapNumber = z.number().int().min(1).describe("Lap number (1-based)");

export function createServer(session: Session): McpServer {
  const server = new McpServer({ name: "f1-telemetry-mcp", version: "0.1.0" });

  server.registerTool(
    "get_session_summary",
    { description: "Overview of the loaded session: driver, circuit, laps, fastest lap, top speed, final tyre wear.", inputSchema: {} },
    safe(() => A.sessionSummary(session)),
  );

  server.registerTool(
    "get_lap_times",
    {
      description: "Lap and sector times for every lap.",
      inputSchema: { validOnly: z.boolean().default(false).describe("Exclude invalidated laps") },
    },
    safe(({ validOnly }: { validOnly: boolean }) => A.lapTimes(session, validOnly)),
  );

  server.registerTool(
    "compare_laps",
    {
      description: "Compare two laps: total and per-sector delta, plus time delta by distance (positive = lapB slower).",
      inputSchema: { lapA: lapNumber, lapB: lapNumber, stepM: z.number().int().min(50).max(2000).default(500) },
    },
    safe(({ lapA, lapB, stepM }: { lapA: number; lapB: number; stepM: number }) => A.compareLaps(session, lapA, lapB, stepM)),
  );

  server.registerTool(
    "get_fastest_sector",
    {
      description: "Fastest time for a given sector and the theoretical best lap.",
      inputSchema: { sector: z.union([z.literal(1), z.literal(2), z.literal(3)]), validOnly: z.boolean().default(true) },
    },
    safe(({ sector, validOnly }: { sector: 1 | 2 | 3; validOnly: boolean }) => A.fastestSector(session, sector, validOnly)),
  );

  server.registerTool(
    "find_braking_points",
    {
      description: "Detect braking zones on a lap (start/end distance, entry and minimum speed).",
      inputSchema: { lapNumber, threshold: z.number().min(0.01).max(1).default(0.2).describe("Brake input threshold 0..1") },
    },
    safe(({ lapNumber, threshold }: { lapNumber: number; threshold: number }) => A.brakingPoints(session, lapNumber, threshold)),
  );

  server.registerTool(
    "get_tyre_wear",
    { description: "Tyre wear (%) per corner per lap and average wear rate.", inputSchema: {} },
    safe(() => A.tyreWear(session)),
  );

  server.registerTool(
    "get_car_telemetry",
    {
      description: "Speed/throttle/brake/gear/RPM samples for a lap within a distance range (downsampled to maxPoints).",
      inputSchema: {
        lapNumber,
        fromM: z.number().min(0).default(0),
        toM: z.number().min(0).optional(),
        maxPoints: z.number().int().min(10).max(1000).default(200),
      },
    },
    safe(({ lapNumber, fromM, toM, maxPoints }: { lapNumber: number; fromM: number; toM?: number; maxPoints: number }) =>
      A.carTelemetry(session, lapNumber, fromM, toM, maxPoints),
    ),
  );

  server.registerResource(
    "session-summary",
    "f1://session/summary",
    { title: "Session summary", description: "Summary of the loaded session", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(A.sessionSummary(session), null, 2) }] }),
  );

  server.registerResource(
    "lap",
    new ResourceTemplate("f1://session/laps/{lapNumber}", {
      list: async () => ({
        resources: session.laps.map((l) => ({ uri: `f1://session/laps/${l.lapNumber}`, name: `Lap ${l.lapNumber}`, mimeType: "application/json" })),
      }),
    }),
    { title: "Lap detail", description: "Lap metadata (times, sectors, tyre wear) without raw samples", mimeType: "application/json" },
    async (uri, { lapNumber }) => {
      const { samples, ...meta } = A.getLap(session, Number(lapNumber));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ...meta, sampleCount: samples.length }, null, 2) }] };
    },
  );

  return server;
}
