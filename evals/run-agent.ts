/**
 * Optional LLM-agent eval: an LLM answers each question using the MCP tools (in-memory client) and is scored.
 * Uses ANTHROPIC_API_KEY or OPENAI_API_KEY (model override: EVAL_MODEL). Exits 0 with "skipped" if no key is set.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, connectClient, loadCases, matches, writeReport, type CaseResult } from "./lib.js";

const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null;
if (!provider) {
  console.log("eval:agent skipped (set ANTHROPIC_API_KEY or OPENAI_API_KEY)");
  process.exit(0);
}
const model = process.env.EVAL_MODEL ?? (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o-mini");
const MAX_TURNS = 8;
const SYSTEM =
  "You answer questions about an F1 telemetry session using the provided tools. Always use tools; never guess. " +
  'When done, reply with ONLY a JSON object {"answer": <value>} where value is a bare number (in the unit asked, no unit text), boolean, or short string.';

type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type Msg = Record<string, unknown>;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

function parseAnswer(text: string): unknown {
  const m = /\{[\s\S]*\}/.exec(text);
  if (m) {
    try {
      return (JSON.parse(m[0]) as { answer: unknown }).answer;
    } catch {
      /* fall through */
    }
  }
  return text.trim();
}

async function runTool(client: Client, name: string, args: unknown, calls: string[]): Promise<string> {
  calls.push(name);
  const r = await callTool(client, name, (args ?? {}) as Record<string, unknown>);
  return r.isError ? `ERROR: ${r.text}` : r.text;
}

async function askAnthropic(client: Client, tools: Tool[], question: string, calls: string[]): Promise<unknown> {
  const messages: Msg[] = [{ role: "user", content: question }];
  const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  for (let i = 0; i < MAX_TURNS; i++) {
    const res = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      { model, max_tokens: 1024, system: SYSTEM, tools: defs, messages },
    );
    const content = res.content as { type: string; id?: string; name?: string; input?: unknown; text?: string }[];
    messages.push({ role: "assistant", content });
    const uses = content.filter((c) => c.type === "tool_use");
    if (!uses.length) return parseAnswer(content.map((c) => c.text ?? "").join(""));
    const results = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await runTool(client, u.name!, u.input, calls) });
    messages.push({ role: "user", content: results });
  }
  throw new Error("max turns exceeded");
}

async function askOpenAI(client: Client, tools: Tool[], question: string, calls: string[]): Promise<unknown> {
  const messages: Msg[] = [{ role: "system", content: SYSTEM }, { role: "user", content: question }];
  const defs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  for (let i = 0; i < MAX_TURNS; i++) {
    const res = await post("https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, { model, messages, tools: defs });
    const msg = (res.choices as { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[])[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return parseAnswer(msg.content ?? "");
    for (const tc of msg.tool_calls) {
      const out = await runTool(client, tc.function.name, JSON.parse(tc.function.arguments || "{}"), calls);
      messages.push({ role: "tool", tool_call_id: tc.id, content: out });
    }
  }
  throw new Error("max turns exceeded");
}

const client = await connectClient();
const { tools } = await client.listTools();
const results: CaseResult[] = [];
for (const c of loadCases()) {
  const calls: string[] = [];
  const t0 = performance.now();
  try {
    const actual = await (provider === "anthropic" ? askAnthropic : askOpenAI)(client, tools as Tool[], c.question, calls);
    results.push({ id: c.id, question: c.question, expected: c.expected, actual, pass: matches(c, actual), latencyMs: performance.now() - t0, toolCalls: calls });
  } catch (e) {
    results.push({ id: c.id, question: c.question, expected: c.expected, actual: null, pass: false, latencyMs: performance.now() - t0, toolCalls: calls, error: (e as Error).message });
  }
  const r = results.at(-1)!;
  console.log(`${r.pass ? "PASS" : "FAIL"} ${c.id} (${calls.join(",") || "no tools"}) -> ${JSON.stringify(r.actual)}`);
}
await client.close();
const usedExpectedTool = results.filter((r, i) => loadCases()[i].tools.some((t) => r.toolCalls.includes(t))).length;
const { passRate } = writeReport("agent", results, { provider, model, usedExpectedTool: `${usedExpectedTool}/${results.length}` });
console.log(`agent eval (${provider}/${model}): ${(passRate * 100).toFixed(1)}% -> evals/report-agent.md`);
