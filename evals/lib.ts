/** Shared eval helpers: case loading, in-memory MCP client, path extraction, scoring, reporting. */
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { loadSession } from "../src/data.js";

export interface EvalCase {
  id: string;
  question: string;
  tools: string[];
  call: { tool: string; args: Record<string, unknown> };
  /** Dot path into the tool's JSON result. Segments: key, array index, `@max:f`/`@min:f` (pick element), `@argmax` (key of largest value). */
  path: string;
  expected: string | number | boolean;
  tolerance?: number;
  unit?: string;
}

export interface CaseResult {
  id: string;
  question: string;
  expected: EvalCase["expected"];
  actual: unknown;
  pass: boolean;
  latencyMs: number;
  toolCalls: string[];
  error?: string;
}

export const evalDir = new URL(".", import.meta.url);
export const loadCases = (): EvalCase[] => JSON.parse(readFileSync(new URL("cases.json", evalDir), "utf8"));

export async function connectClient(): Promise<Client> {
  const server = createServer(loadSession());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "f1-eval", version: "0.1.0" });
  await client.connect(ct);
  return client;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text?: string }[];
  return { text: content.map((c) => c.text ?? "").join("\n"), isError: Boolean(res.isError) };
}

export function extract(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    const m = /^@(max|min):(.+)$/.exec(seg);
    if (m && Array.isArray(cur)) {
      const [, op, f] = m;
      cur = cur.reduce((a, b) => ((op === "max" ? b[f] > a[f] : b[f] < a[f]) ? b : a));
    } else if (seg === "@argmax" && typeof cur === "object") {
      cur = Object.entries(cur as Record<string, number>).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

export function matches(c: EvalCase, actual: unknown): boolean {
  if (typeof c.expected === "number") {
    const n = typeof actual === "number" ? actual : Number(String(actual).replace(/[^0-9.+-eE]/g, ""));
    return Number.isFinite(n) && Math.abs(n - c.expected) <= (c.tolerance ?? 0);
  }
  if (typeof c.expected === "boolean") return actual === c.expected || String(actual).toLowerCase() === String(c.expected);
  return String(actual).trim().toLowerCase() === c.expected.toLowerCase();
}

export function writeReport(mode: string, results: CaseResult[], extra: Record<string, unknown> = {}): { passRate: number } {
  const passed = results.filter((r) => r.pass).length;
  const passRate = results.length ? passed / results.length : 0;
  const avgLatencyMs = results.length ? results.reduce((a, r) => a + r.latencyMs, 0) / results.length : 0;
  const summary = { mode, generatedAt: new Date().toISOString(), total: results.length, passed, passRate, avgLatencyMs, ...extra };
  const suffix = mode === "deterministic" ? "" : `-${mode}`;
  writeFileSync(new URL(`report${suffix}.json`, evalDir), JSON.stringify({ summary, results }, null, 2) + "\n");
  const rows = results.map(
    (r) => `| ${r.id} | ${r.pass ? "PASS" : "FAIL"} | ${r.question.replace(/\|/g, "/")} | ${JSON.stringify(r.expected)} | ${JSON.stringify(r.actual ?? null)} | ${r.latencyMs.toFixed(1)} | ${r.toolCalls.join(", ")} |`,
  );
  const md = [
    `# Eval report (${mode})`,
    "",
    `Sample data only (synthetic session). Generated ${summary.generatedAt}.`,
    "",
    `- Pass rate: **${passed}/${results.length} (${(passRate * 100).toFixed(1)}%)**`,
    `- Avg latency: ${avgLatencyMs.toFixed(1)} ms`,
    ...Object.entries(extra).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`),
    "",
    "| id | result | question | expected | actual | latency ms | tool calls |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(new URL(`report${suffix}.md`, evalDir), md);
  return { passRate };
}
