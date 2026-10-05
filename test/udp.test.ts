import { describe, expect, it } from "vitest";
import { SessionAssembler } from "../src/ingest/udp.js";

const header = { player_car_index: 0 } as never;
const lap = (n: number, dist: number, last = 0) =>
  ({ m_header: header, m_lapData: [{ m_currentLapNum: n, m_lapDistance: dist, m_currentLapTimeInMS: dist * 20, m_lastLapTimeInMS: last, m_sector1TimeInMS: 25000, m_sector1TimeMinutes: 0, m_sector2TimeInMS: 30000, m_sector2TimeMinutes: 0 }] }) as never;
const tel = { m_header: header, m_carTelemetryData: [{ m_speed: 300, m_throttle: 1, m_brake: 0, m_gear: 8, m_engineRPM: 11800 }] } as never;

describe("SessionAssembler", () => {
  it("builds laps from packets", () => {
    const a = new SessionAssembler();
    a.onLapData(lap(1, 10));
    a.onCarTelemetry(tel);
    a.onCarDamage({ m_header: header, m_car_damage_data: [{ m_tyres_wear: [1, 2, 3, 4] }] } as never);
    a.onLapData(lap(2, 0, 84000));
    expect(a.session.laps).toHaveLength(1);
    expect(a.session.laps[0].sectorTimesMs).toEqual([25000, 30000, 29000]);
    expect(a.session.laps[0].tyreWear).toEqual([1, 2, 3, 4]);
    expect(a.session.laps[0].samples[0].speedKph).toBe(300);
  });
});
