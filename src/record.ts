#!/usr/bin/env node
/**
 * Records a live F1 23 UDP capture into a session JSON file usable via F1_SESSION_FILE.
 *
 *   f1-telemetry-record --out my-session.json [--port 20777] [--laps 5] [--driver Name] [--circuit Name]
 *
 * Stops after --laps completed laps or on Ctrl+C, then writes the file.
 */
import { writeFileSync } from "node:fs";
import { startLiveIngest } from "./ingest/udp.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = flag("--out") ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const maxLaps = flag("--laps") ? Number(flag("--laps")) : Infinity;
const port = Number(flag("--port") ?? 20777);

const live = startLiveIngest({ port, driver: flag("--driver"), circuit: flag("--circuit") });
console.error(`recording UDP on port ${port} -> ${out} (Ctrl+C to stop)`);

let done = false;
function finish() {
  if (done) return;
  done = true;
  clearInterval(timer);
  live.stop();
  const s = live.session;
  // derive sector boundaries from the last lap's samples when possible
  const last = s.laps.at(-1);
  if (last) {
    const at = (ms: number) => last.samples.find((x) => x.timeMs >= ms)?.distance ?? 0;
    s.sectorBoundariesM = [at(last.sectorTimesMs[0]), at(last.sectorTimesMs[0] + last.sectorTimesMs[1])];
  }
  writeFileSync(out, JSON.stringify(s) + "\n");
  console.error(`saved ${s.laps.length} lap(s) to ${out}`);
  process.exit(0);
}
const timer = setInterval(() => {
  if (live.session.laps.length >= maxLaps) finish();
}, 500);
process.on("SIGINT", finish);
process.on("SIGTERM", finish);
