import { readFileSync } from "node:fs";
import type { Session } from "./types.js";

/** Loads the bundled SAMPLE DATA session (or a path given via F1_SESSION_FILE). */
export function loadSession(path?: string): Session {
  const file = path ?? process.env.F1_SESSION_FILE ?? new URL("../data/sample-session.json", import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as Session;
}
