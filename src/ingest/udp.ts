/**
 * Live ingest adapter for the F1 23 game UDP telemetry feed, built on the
 * `f1-23-udp` parser (https://github.com/raweceek-temeletry/f1-23-udp).
 *
 * It listens for lapData / carTelemetry / carDamage packets for the player car
 * and assembles them into the same `Session` model the MCP tools use.
 */
import { F123UDP } from "f1-23-udp";
import type { PacketCarDamageData, PacketCarTelemetryData, PacketLapData } from "f1-23-udp";
import type { Lap, Session, TelemetrySample, TyreWear } from "../types.js";

export interface LiveIngestOptions {
  port?: number;
  address?: string;
  driver?: string;
  circuit?: string;
}

/** Pure packet -> session assembler (unit-testable without a socket). */
export class SessionAssembler {
  readonly session: Session;
  private currentLap = 0;
  private samples: TelemetrySample[] = [];
  private lapDistance = 0;
  private lapTimeMs = 0;
  private s1 = 0;
  private s2 = 0;
  private wear: TyreWear = [0, 0, 0, 0];

  constructor(opts: LiveIngestOptions = {}) {
    this.session = {
      id: `live-${Date.now()}`,
      sample: false,
      label: "Live UDP capture",
      driver: opts.driver ?? "Player",
      team: "Unknown",
      circuit: opts.circuit ?? "Unknown",
      trackLengthM: 0,
      sessionType: "Unknown",
      sectorBoundariesM: [0, 0],
      laps: [],
    };
  }

  onLapData(p: PacketLapData): void {
    const d = p.m_lapData[p.m_header.player_car_index];
    if (!d) return;
    if (this.currentLap && d.m_currentLapNum !== this.currentLap) {
      const s3 = Math.max(0, d.m_lastLapTimeInMS - this.s1 - this.s2);
      const lap: Lap = {
        lapNumber: this.currentLap,
        lapTimeMs: d.m_lastLapTimeInMS,
        sectorTimesMs: [this.s1, this.s2, s3],
        valid: true,
        tyreCompound: "unknown",
        tyreWear: [...this.wear] as TyreWear,
        samples: this.samples,
      };
      this.session.laps.push(lap);
      this.session.trackLengthM = Math.max(this.session.trackLengthM, this.lapDistance);
      this.samples = [];
    }
    this.currentLap = d.m_currentLapNum;
    this.lapDistance = d.m_lapDistance;
    this.lapTimeMs = d.m_currentLapTimeInMS;
    if (d.m_sector1TimeInMS) this.s1 = d.m_sector1TimeInMS + d.m_sector1TimeMinutes * 60000;
    if (d.m_sector2TimeInMS) this.s2 = d.m_sector2TimeInMS + d.m_sector2TimeMinutes * 60000;
  }

  onCarTelemetry(p: PacketCarTelemetryData): void {
    const t = p.m_carTelemetryData[p.m_header.player_car_index];
    if (!t || !this.currentLap || this.lapDistance < 0) return;
    this.samples.push({
      distance: Math.round(this.lapDistance),
      timeMs: this.lapTimeMs,
      speedKph: t.m_speed,
      throttle: t.m_throttle,
      brake: t.m_brake,
      gear: t.m_gear,
      rpm: t.m_engineRPM,
    });
  }

  onCarDamage(p: PacketCarDamageData): void {
    const d = p.m_car_damage_data[p.m_header.player_car_index];
    if (d) this.wear = d.m_tyres_wear.slice(0, 4) as TyreWear;
  }
}

/** Binds a UDP socket (default port 20777) and feeds packets into a SessionAssembler. */
export function startLiveIngest(opts: LiveIngestOptions = {}) {
  const assembler = new SessionAssembler(opts);
  const client = new F123UDP({ port: opts.port ?? 20777, address: opts.address ?? "0.0.0.0" });
  client.on("lapData", (p) => assembler.onLapData(p));
  client.on("carTelemetry", (p) => assembler.onCarTelemetry(p));
  client.on("carDamage", (p) => assembler.onCarDamage(p));
  client.start();
  return { session: assembler.session, stop: () => client.stop() };
}
