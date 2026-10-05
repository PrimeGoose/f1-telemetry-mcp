/** Deterministic eval: calls the expected tool for each case via an in-memory MCP client and checks the answer. */
import { callTool, connectClient, extract, loadCases, matches, writeReport, type CaseResult } from "./lib.js";

const client = await connectClient();
const results: CaseResult[] = [];
for (const c of loadCases()) {
  const t0 = performance.now();
  try {
    const res = await callTool(client, c.call.tool, c.call.args);
    if (res.isError) throw new Error(res.text);
    const actual = extract(JSON.parse(res.text), c.path);
    results.push({ id: c.id, question: c.question, expected: c.expected, actual, pass: matches(c, actual), latencyMs: performance.now() - t0, toolCalls: [c.call.tool] });
  } catch (e) {
    results.push({ id: c.id, question: c.question, expected: c.expected, actual: null, pass: false, latencyMs: performance.now() - t0, toolCalls: [c.call.tool], error: (e as Error).message });
  }
}
await client.close();
const { passRate } = writeReport("deterministic", results);
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL ${r.id}: expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)} ${r.error ?? ""}`);
console.log(`deterministic eval: ${results.filter((r) => r.pass).length}/${results.length} passed (${(passRate * 100).toFixed(1)}%) -> evals/report.md`);
process.exit(passRate === 1 ? 0 : 1);
