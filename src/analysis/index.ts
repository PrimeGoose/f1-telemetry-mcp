/** Pure analysis functions over the Session model (no MCP concerns). */
import type { Lap, Session, TelemetrySample } from "../types.js";

export const fmtLap = (ms: number): string => {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
};

export function getLap(session: Session, lapNumber: number): Lap {
  const lap = session.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap) throw new Error(`Lap ${lapNumber} not found (session has ${session.laps.length} laps)`);
  return lap;
}

export function sessionSummary(session: Session) {
  const valid = session.laps.filter((l) => l.valid);
  const fastest = (valid.length ? valid : session.laps).reduce((a, b) => (b.lapTimeMs < a.lapTimeMs ? b : a));
  const topSpeed = Math.max(...session.laps.flatMap((l) => l.samples.map((s) => s.speedKph)));
  return {
    id: session.id,
    sample: session.sample,
    label: session.label,
    driver: session.driver,
    team: session.team,
    circuit: session.circuit,
    sessionType: session.sessionType,
    trackLengthM: session.trackLengthM,
    totalLaps: session.laps.length,
    validLaps: valid.length,
    fastestLap: { lapNumber: fastest.lapNumber, lapTimeMs: fastest.lapTimeMs, lapTime: fmtLap(fastest.lapTimeMs) },
    topSpeedKph: topSpeed,
    finalTyreWear: session.laps.at(-1)?.tyreWear ?? null,
  };
}

export function lapTimes(session: Session, validOnly = false) {
  return session.laps
    .filter((l) => !validOnly || l.valid)
    .map((l) => ({
      lapNumber: l.lapNumber,
      lapTimeMs: l.lapTimeMs,
      lapTime: fmtLap(l.lapTimeMs),
      sectorTimesMs: l.sectorTimesMs,
      valid: l.valid,
    }));
}

function sampleAt(samples: TelemetrySample[], d: number): TelemetrySample {
  let best = samples[0];
  for (const s of samples) if (Math.abs(s.distance - d) < Math.abs(best.distance - d)) best = s;
  return best;
}

export function compareLaps(session: Session, lapA: number, lapB: number, stepM = 500) {
  const a = getLap(session, lapA);
  const b = getLap(session, lapB);
  const deltas = [];
  for (let d = 0; d <= session.trackLengthM; d += stepM) {
    const sa = sampleAt(a.samples, d);
    const sb = sampleAt(b.samples, d);
    deltas.push({ distance: d, deltaMs: sb.timeMs - sa.timeMs, speedA: sa.speedKph, speedB: sb.speedKph });
  }
  return {
    lapA,
    lapB,
    lapTimeDeltaMs: b.lapTimeMs - a.lapTimeMs,
    sectorDeltasMs: b.sectorTimesMs.map((t, i) => t - a.sectorTimesMs[i]),
    topSpeedA: Math.max(...a.samples.map((s) => s.speedKph)),
    topSpeedB: Math.max(...b.samples.map((s) => s.speedKph)),
    deltaByDistance: deltas,
  };
}

export function fastestSector(session: Session, sector: 1 | 2 | 3, validOnly = true) {
  const laps = session.laps.filter((l) => !validOnly || l.valid);
  if (!laps.length) throw new Error("No laps available");
  const idx = sector - 1;
  const best = laps.reduce((x, y) => (y.sectorTimesMs[idx] < x.sectorTimesMs[idx] ? y : x));
  const theoreticalBestMs = [0, 1, 2].reduce((acc, i) => acc + Math.min(...laps.map((l) => l.sectorTimesMs[i])), 0);
  return { sector, lapNumber: best.lapNumber, sectorTimeMs: best.sectorTimesMs[idx], theoreticalBestMs, theoreticalBest: fmtLap(theoreticalBestMs) };
}

export function brakingPoints(session: Session, lapNumber: number, threshold = 0.2) {
  const lap = getLap(session, lapNumber);
  const zones: { startDistance: number; endDistance: number; entrySpeedKph: number; minSpeedKph: number; peakBrake: number }[] = [];
  let cur: (typeof zones)[number] | null = null;
  for (const s of lap.samples) {
    if (s.brake >= threshold) {
      if (!cur) cur = { startDistance: s.distance, endDistance: s.distance, entrySpeedKph: s.speedKph, minSpeedKph: s.speedKph, peakBrake: s.brake };
      cur.endDistance = s.distance;
      cur.minSpeedKph = Math.min(cur.minSpeedKph, s.speedKph);
      cur.peakBrake = Math.max(cur.peakBrake, s.brake);
    } else if (cur) {
      zones.push(cur);
      cur = null;
    }
  }
  if (cur) zones.push(cur);
  return { lapNumber, threshold, count: zones.length, zones };
}

export function tyreWear(session: Session) {
  const laps = session.laps.map((l) => ({ lapNumber: l.lapNumber, compound: l.tyreCompound, wear: { RL: l.tyreWear[0], RR: l.tyreWear[1], FL: l.tyreWear[2], FR: l.tyreWear[3] } }));
  const last = session.laps.at(-1);
  const n = session.laps.length;
  const avgPerLap = last && n ? last.tyreWear.map((w) => Math.round((w / n) * 100) / 100) : [0, 0, 0, 0];
  return { order: "RL,RR,FL,FR", laps, avgWearPerLapPct: { RL: avgPerLap[0], RR: avgPerLap[1], FL: avgPerLap[2], FR: avgPerLap[3] } };
}

export function carTelemetry(session: Session, lapNumber: number, fromM = 0, toM?: number, maxPoints = 200) {
  const lap = getLap(session, lapNumber);
  const end = toM ?? session.trackLengthM;
  if (end < fromM) throw new Error("toM must be >= fromM");
  const pts = lap.samples.filter((s) => s.distance >= fromM && s.distance <= end);
  const stride = Math.max(1, Math.ceil(pts.length / maxPoints));
  return { lapNumber, fromM, toM: end, totalPoints: pts.length, stride, samples: pts.filter((_, i) => i % stride === 0) };
}
