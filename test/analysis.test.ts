import { describe, expect, it } from "vitest";
import { generateSession } from "../src/sample/generator.js";
import * as A from "../src/analysis/index.js";
import { loadSession } from "../src/data.js";

const s = generateSession({ seed: 1, laps: 5 });

describe("generator", () => {
  it("is deterministic and labelled SAMPLE DATA", () => {
    expect(generateSession({ seed: 1, laps: 5 })).toEqual(s);
    expect(s.sample).toBe(true);
    expect(s.label).toMatch(/SAMPLE DATA/);
    expect(s.circuit).toMatch(/fictional/);
  });
  it("sector times sum to lap time and wear grows", () => {
    for (const l of s.laps) expect(l.sectorTimesMs.reduce((a, b) => a + b)).toBe(l.lapTimeMs);
    expect(s.laps[4].tyreWear[3]).toBeGreaterThan(s.laps[0].tyreWear[3]);
  });
  it("bundled sample loads", () => {
    const b = loadSession();
    expect(b.sample).toBe(true);
    expect(b.laps.length).toBe(8);
  });
});

describe("analysis", () => {
  it("summary", () => {
    const sum = A.sessionSummary(s);
    expect(sum.totalLaps).toBe(5);
    expect(sum.topSpeedKph).toBeGreaterThan(250);
    expect(sum.fastestLap.lapTime).toMatch(/^\d:\d{2}\.\d{3}$/);
  });
  it("fmtLap", () => expect(A.fmtLap(83456)).toBe("1:23.456"));
  it("compare laps", () => {
    const c = A.compareLaps(s, 1, 2);
    expect(c.lapTimeDeltaMs).toBe(s.laps[1].lapTimeMs - s.laps[0].lapTimeMs);
    expect(c.deltaByDistance[0].distance).toBe(0);
  });
  it("fastest sector <= every lap's sector", () => {
    const f = A.fastestSector(s, 2, false);
    for (const l of s.laps) expect(f.sectorTimeMs).toBeLessThanOrEqual(l.sectorTimesMs[1]);
  });
  it("braking points: one zone per corner", () => {
    const b = A.brakingPoints(s, 1);
    expect(b.count).toBe(6);
    for (const z of b.zones) expect(z.minSpeedKph).toBeLessThan(z.entrySpeedKph);
  });
  it("car telemetry range + downsampling", () => {
    const t = A.carTelemetry(s, 1, 1000, 2000, 20);
    expect(t.samples.every((x) => x.distance >= 1000 && x.distance <= 2000)).toBe(true);
    expect(t.samples.length).toBeLessThanOrEqual(20);
  });
  it("unknown lap throws", () => expect(() => A.getLap(s, 99)).toThrow(/not found/));
  it("tyre wear", () => expect(A.tyreWear(s).laps).toHaveLength(5));
});
