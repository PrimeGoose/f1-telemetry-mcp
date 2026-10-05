/**
 * Deterministic synthetic session generator. Produces SAMPLE DATA only:
 * the driver, team and circuit are fictional.
 */
import type { Lap, Session, TelemetrySample, TyreWear } from "../types.js";

/** Simple seeded PRNG (mulberry32) so the bundled sample is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fictional circuit layout: straights followed by braking zones into corners. */
export interface Segment {
  kind: "straight" | "corner";
  lengthM: number;
  /** For corners: apex speed (kph). */
  apexKph?: number;
}

export const FICTIONAL_CIRCUIT: { name: string; segments: Segment[] } = {
  name: "Aurora Valley Circuit (fictional)",
  segments: [
    { kind: "straight", lengthM: 900 },
    { kind: "corner", lengthM: 150, apexKph: 95 },
    { kind: "straight", lengthM: 500 },
    { kind: "corner", lengthM: 200, apexKph: 160 },
    { kind: "straight", lengthM: 650 },
    { kind: "corner", lengthM: 120, apexKph: 75 },
    { kind: "straight", lengthM: 400 },
    { kind: "corner", lengthM: 250, apexKph: 210 },
    { kind: "straight", lengthM: 700 },
    { kind: "corner", lengthM: 180, apexKph: 115 },
    { kind: "straight", lengthM: 350 },
    { kind: "corner", lengthM: 100, apexKph: 85 },
  ],
};

const V_MAX = 325;
const ACCEL = 9; // kph per 10 m (rough)
const DECEL = 28; // kph per 10 m under full braking

function gearFor(kph: number): number {
  const ups = [0, 80, 120, 155, 190, 225, 260, 290];
  let g = 1;
  for (let i = 0; i < ups.length; i++) if (kph >= ups[i]) g = i + 1;
  return Math.min(g, 8);
}

/** Builds the target speed profile at 10 m resolution (the "ideal" line). */
function speedProfile(segments: Segment[], grip: number): number[] {
  const pts: { target: number; corner: boolean }[] = [];
  for (const s of segments) {
    const n = Math.round(s.lengthM / 10);
    for (let i = 0; i < n; i++)
      pts.push({ target: s.kind === "corner" ? (s.apexKph ?? 100) * grip : V_MAX, corner: s.kind === "corner" });
  }
  const v = pts.map((p) => p.target);
  // forward pass: acceleration limit
  for (let i = 1; i < v.length; i++) v[i] = Math.min(v[i], v[i - 1] + ACCEL * (1 - v[i - 1] / 400));
  // backward pass: braking limit
  for (let i = v.length - 2; i >= 0; i--) v[i] = Math.min(v[i], v[i + 1] + DECEL);
  return v;
}

export interface GenerateOptions {
  seed?: number;
  laps?: number;
}

export function generateSession(opts: GenerateOptions = {}): Session {
  const rand = rng(opts.seed ?? 42);
  const nLaps = opts.laps ?? 8;
  const segs = FICTIONAL_CIRCUIT.segments;
  const trackLengthM = segs.reduce((a, s) => a + s.lengthM, 0);
  const b1 = Math.round(trackLengthM / 3 / 10) * 10;
  const b2 = Math.round((2 * trackLengthM) / 3 / 10) * 10;
  const wear: TyreWear = [0, 0, 0, 0];
  const laps: Lap[] = [];

  for (let lapNumber = 1; lapNumber <= nLaps; lapNumber++) {
    const avgWear = wear.reduce((a, b) => a + b, 0) / 4;
    const grip = 1.02 - avgWear / 400 + (rand() - 0.5) * 0.02;
    const v = speedProfile(segs, grip);
    // Per-sector pace variation so sector bests land on different laps
    // (theoretical best lap < fastest actual lap).
    const sectorPace = [0, 1, 2].map(() => 1 + (rand() - 0.5) * 0.03);
    for (let i = 0; i < v.length; i++) v[i] *= sectorPace[i * 10 < b1 ? 0 : i * 10 < b2 ? 1 : 2];
    const samples: TelemetrySample[] = [];
    let t = 0;
    for (let i = 0; i < v.length; i++) {
      const speed = Math.max(60, v[i] + (rand() - 0.5) * 3);
      const prev = i > 0 ? v[i - 1] : v[v.length - 1];
      const braking = v[i] < prev - 2;
      const accelerating = v[i] > prev + 0.5;
      const brake = braking ? Math.min(1, (prev - v[i]) / DECEL + 0.1) : 0;
      const throttle = braking ? 0 : accelerating || v[i] >= V_MAX - 1 ? 1 : 0.55 + rand() * 0.2;
      const gear = gearFor(speed);
      samples.push({
        distance: i * 10,
        timeMs: Math.round(t),
        speedKph: Math.round(speed * 10) / 10,
        throttle: Math.round(throttle * 100) / 100,
        brake: Math.round(brake * 100) / 100,
        gear,
        rpm: Math.round(10500 + ((speed % 40) / 40) * 1500),
      });
      t += (10 / (speed / 3.6)) * 1000;
    }
    const lapTimeMs = Math.round(t);
    const at = (d: number) => samples.find((s) => s.distance >= d)?.timeMs ?? lapTimeMs;
    const s1 = at(b1);
    const s2 = at(b2) - s1;
    const s3 = lapTimeMs - s1 - s2;
    // rear-left, rear-right, front-left, front-right
    const base = [1.6, 1.7, 2.0, 2.2];
    for (let k = 0; k < 4; k++) wear[k] = Math.round((wear[k] + base[k] + rand() * 0.4) * 100) / 100;
    laps.push({
      lapNumber,
      lapTimeMs,
      sectorTimesMs: [s1, s2, s3],
      valid: rand() > 0.1,
      tyreCompound: "medium",
      tyreWear: [...wear] as TyreWear,
      samples,
    });
  }

  return {
    id: "sample-aurora-valley-practice",
    sample: true,
    label: "SAMPLE DATA - synthetic session, fictional driver and circuit",
    driver: "Alex Testdriver (fictional)",
    team: "Example Racing (fictional)",
    circuit: FICTIONAL_CIRCUIT.name,
    trackLengthM,
    sessionType: "Practice",
    sectorBoundariesM: [b1, b2],
    laps,
  };
}
