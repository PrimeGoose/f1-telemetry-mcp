/**
 * Regenerates expected answers in cases.json from the current sample session.
 * Run after `npm run generate:sample`, then review the diff by hand before committing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { callTool, connectClient, extract, loadCases } from "./lib.js";

const file = new URL("./cases.json", import.meta.url);
const cases = loadCases();
const client = await connectClient();
for (const c of cases) {
  const res = await callTool(client, c.call.tool, c.call.args);
  if (res.isError) throw new Error(`${c.id}: ${res.text}`);
  const actual = extract(JSON.parse(res.text), c.path);
  if (JSON.stringify(actual) !== JSON.stringify(c.expected)) console.log(`${c.id}: ${JSON.stringify(c.expected)} -> ${JSON.stringify(actual)}`);
  c.expected = actual as typeof c.expected;
}
await client.close();
JSON.parse(readFileSync(file, "utf8"));
writeFileSync(file, JSON.stringify(cases, null, 2) + "\n");
