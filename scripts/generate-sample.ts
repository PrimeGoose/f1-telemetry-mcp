import { writeFileSync } from "node:fs";
import { generateSession } from "../src/sample/generator.js";

const out = new URL("../data/sample-session.json", import.meta.url);
writeFileSync(out, JSON.stringify(generateSession({ seed: 42, laps: 8 }), null, 1) + "\n");
console.log(`SAMPLE DATA written to ${out.pathname}`);
