/** Core telemetry domain model shared by the sample generator, live ingest and MCP tools. */
export interface TelemetrySample {
  /** Distance into the lap in metres. */
  distance: number;
  /** Time into the lap in milliseconds. */
  timeMs: number;
  speedKph: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 = reverse, 0 = neutral, 1..8 */
  gear: number;
  rpm: number;
}

/** Tyre wear in percent, order: RL, RR, FL, FR (matches the F1 game UDP spec). */
export type TyreWear = [number, number, number, number];

export interface Lap {
  lapNumber: number;
  lapTimeMs: number;
  sectorTimesMs: [number, number, number];
  valid: boolean;
  tyreCompound: string;
  /** Wear at end of lap. */
  tyreWear: TyreWear;
  samples: TelemetrySample[];
}

export interface Session {
  id: string;
  /** Always true for generated data; false for live captures. */
  sample: boolean;
  label: string;
  driver: string;
  team: string;
  circuit: string;
  trackLengthM: number;
  sessionType: string;
  /** Distance (m) at which sector 2 and sector 3 start. */
  sectorBoundariesM: [number, number];
  laps: Lap[];
}
