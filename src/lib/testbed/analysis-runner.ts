// lib/testbed/analysis-runner.ts
import { LogParser } from '@tempo/core/analysis/log-parser';
import { EventDetector } from '@tempo/core/analysis/event-detector';
import { calibrateFallRate } from '@tempo/core/formation/coordinates';
import { computeFallRateSeries } from '@tempo/core/analysis/fall-rate-series';
import {
  estimateTorsoCalibration,
  torsoAttitudeSeries,
} from '@tempo/core/analysis/torso-orientation';
import type {
  TorsoAttitude,
  QuatConvention,
  ImuSample,
  TrackSample,
  QuatSample,
} from '@tempo/core/analysis/torso-orientation';
import type { ParsedLogData } from '@tempo/core/analysis/log-parser';
import type { JumpEvents } from '@tempo/core/analysis/event-detector';
import type { FallRateSeriesPoint } from '@tempo/core/analysis/fall-rate-series';
import type { JumperBaseline } from './data-loader';

export type { FallRateSeriesPoint };

export interface VelocityBinEntry {
  fallRate_mph: number;
  elapsed_sec: number;
  calibrated_elapsed_sec: number;
}

export interface VelocityBinSummary {
  raw: {
    totalAnalysisTime: number;
    averageFallRate: number;
    minFallRate: number | null;
    maxFallRate: number | null;
  };
  calibrated: {
    totalAnalysisTime: number;
    averageFallRate: number;
    minFallRate: number | null;
    maxFallRate: number | null;
  };
  analysisWindow: {
    startOffset: number;
    endOffset: number;
    duration: number;
  };
}

export interface TorsoResult {
  /** Torso attitude (20 Hz) over the landing window [landing-40, landing+5]. */
  attitude: TorsoAttitude[];
  calibration: {
    window: [number, number];
    forwardSign: 1 | -1;
    quatConvention: QuatConvention;
    yawOffset_deg: number;
    tiltResidual_deg: number;
  };
}

export interface AnalysisResult {
  parsedData: ParsedLogData;
  events: JumpEvents;
  velocityBins: VelocityBinEntry[] | null;
  velocitySummary: VelocityBinSummary | null;
  fallRateSeries: FallRateSeriesPoint[] | null;
  baseline: JumperBaseline;
  /** Torso orientation for the landing phase — null when the log is too old
   *  (firmware < 1.2.0), events are missing, or calibration diagnostics fail. */
  torso: TorsoResult | null;
}

/**
 * Run the full analysis pipeline on a raw flight log buffer
 */
export function runAnalysis(rawLog: Buffer): AnalysisResult {
  // Step 1: Parse the log
  const parsedData = LogParser.parseLog(rawLog);

  // Step 2: Detect events
  const events = EventDetector.analyzeJump(parsedData);

  // Step 3: Compute velocity bins (if exit and deployment were detected)
  let velocityBins: VelocityBinEntry[] | null = null;
  let velocitySummary: VelocityBinSummary | null = null;
  let fallRateSeries: FallRateSeriesPoint[] | null = null;

  if (events.exitOffsetSec != null && events.deploymentOffsetSec != null) {
    const binResult = computeVelocityBins(parsedData, events);
    velocityBins = binResult.bins;
    velocitySummary = binResult.summary;
    fallRateSeries = binResult.series;
  }

  // Step 4: Build baseline structure
  const baseline = buildBaseline(parsedData, events, velocityBins, velocitySummary);

  // Step 5: Torso orientation for the landing phase (firmware >= 1.2.0 only)
  const torso = computeTorsoOrientation(parsedData, events);

  return { parsedData, events, velocityBins, velocitySummary, fallRateSeries, baseline, torso };
}

/**
 * Calibrate the pocket transform + AHRS yaw offset over a quiet canopy window
 * and return the torso attitude series for the landing phase. Returns null
 * whenever the result can't be trusted: log version < 112 (the calibrator
 * refuses those), missing events, no qualifying calibration window, or a
 * tilt residual too large to believe.
 */
function computeTorsoOrientation(parsedData: ParsedLogData, events: JumpEvents): TorsoResult | null {
  const exit = events.exitOffsetSec;
  const deploy = events.deploymentOffsetSec;
  const landing = events.landingOffsetSec;
  if (exit == null || deploy == null || landing == null) return null;

  const imu: ImuSample[] = parsedData.imuPackets
    .filter(p => p.timeOffset !== undefined)
    .map(p => ({
      t: p.timeOffset!,
      ax: p.accX_mps2, ay: p.accY_mps2, az: p.accZ_mps2,
      gx: p.rotX_rps, gy: p.rotY_rps, gz: p.rotZ_rps,
    }));
  const track: TrackSample[] = parsedData.gps
    .filter(p => p.groundTrack_degT !== undefined && p.groundspeed_kmph !== undefined)
    .map(p => ({ t: p.timestamp, track_degT: p.groundTrack_degT!, speed_mps: p.groundspeed_kmph! / 3.6 }));
  const quat: QuatSample[] = parsedData.im2Packets
    .filter(p => p.timeOffset !== undefined)
    .map(p => ({ t: p.timeOffset!, w: p.q0, x: p.q1, y: p.q2, z: p.q3 }));

  const cal = estimateTorsoCalibration(imu, track, quat, deploy + 20, landing - 8, {
    logVersion: parsedData.logVersion,
    freefall: [exit + 8, deploy - 5],
  });
  if (!cal) return null;
  if (cal.tiltResidual_deg > 15) {
    console.log(`[TORSO] calibration rejected: tilt residual ${cal.tiltResidual_deg.toFixed(1)}°`);
    return null;
  }

  const landingQuat = quat.filter(q => q.t >= landing - 40 && q.t <= landing + 5);
  return {
    attitude: torsoAttitudeSeries(landingQuat, cal),
    calibration: {
      window: [cal.window.t0, cal.window.t1],
      forwardSign: cal.forwardSign,
      quatConvention: cal.quatConvention,
      yawOffset_deg: cal.yawOffset_deg,
      tiltResidual_deg: cal.tiltResidual_deg,
    },
  };
}

/**
 * Compute velocity bins for the freefall analysis window
 * Analysis window: exit + 12s to deployment - 2s
 */
function computeVelocityBins(
  data: ParsedLogData,
  events: JumpEvents
): { bins: VelocityBinEntry[]; summary: VelocityBinSummary; series: FallRateSeriesPoint[] } {
  const BIN_WIDTH_MPH = 5;
  const WINDOW_START_DELAY = 12; // seconds after exit
  const WINDOW_END_MARGIN = 2;   // seconds before deployment

  const exitSec = events.exitOffsetSec!;
  const deploySec = events.deploymentOffsetSec!;
  const windowStart = exitSec + WINDOW_START_DELAY;
  const windowEnd = deploySec - WINDOW_END_MARGIN;

  if (windowEnd <= windowStart) {
    return {
      bins: [],
      summary: {
        raw: { totalAnalysisTime: 0, averageFallRate: 0, minFallRate: null, maxFallRate: null },
        calibrated: { totalAnalysisTime: 0, averageFallRate: 0, minFallRate: null, maxFallRate: null },
        analysisWindow: { startOffset: windowStart, endOffset: windowEnd, duration: 0 },
      },
      series: [],
    };
  }

  // Filter log entries within the analysis window
  const windowEntries = data.logEntries.filter(
    e => e.timeOffset >= windowStart && e.timeOffset <= windowEnd
  );

  if (windowEntries.length < 2) {
    return {
      bins: [],
      summary: {
        raw: { totalAnalysisTime: 0, averageFallRate: 0, minFallRate: null, maxFallRate: null },
        calibrated: { totalAnalysisTime: 0, averageFallRate: 0, minFallRate: null, maxFallRate: null },
        analysisWindow: { startOffset: windowStart, endOffset: windowEnd, duration: 0 },
      },
      series: [],
    };
  }

  // Accumulate time in each velocity bin (raw and calibrated)
  const rawBins = new Map<number, number>();
  const calBins = new Map<number, number>();

  let totalRawTime = 0;
  let totalCalTime = 0;
  let rawRateSum = 0;
  let calRateSum = 0;
  let rawMin: number | null = null;
  let rawMax: number | null = null;
  let calMin: number | null = null;
  let calMax: number | null = null;

  for (let i = 1; i < windowEntries.length; i++) {
    const prev = windowEntries[i - 1];
    const cur = windowEntries[i];
    const dt = cur.timeOffset - prev.timeOffset;

    if (dt <= 0 || dt > 2) continue; // skip gaps

    // Raw fall rate from GNSS-derived rate of descent (fpm → mph)
    if (cur.rateOfDescent_fpm === null || cur.rateOfDescent_fpm < 0) continue;
    const rawRate_mph = cur.rateOfDescent_fpm / 88; // fpm to mph: /5280*60 = /88

    // Calibrated fall rate using density correction
    const altitude_ft = cur.baroAlt_ft ?? 7000; // fallback to reference alt
    const verticalSpeed_mps = cur.rateOfDescent_fpm * 0.00508; // fpm to m/s
    const calRate_mph = calibrateFallRate(verticalSpeed_mps, altitude_ft);

    // Bin the raw rate
    const rawBin = Math.round(rawRate_mph / BIN_WIDTH_MPH) * BIN_WIDTH_MPH;
    rawBins.set(rawBin, (rawBins.get(rawBin) || 0) + dt);
    totalRawTime += dt;
    rawRateSum += rawRate_mph * dt;
    if (rawMin === null || rawRate_mph < rawMin) rawMin = rawRate_mph;
    if (rawMax === null || rawRate_mph > rawMax) rawMax = rawRate_mph;

    // Bin the calibrated rate
    const calBin = Math.round(calRate_mph / BIN_WIDTH_MPH) * BIN_WIDTH_MPH;
    calBins.set(calBin, (calBins.get(calBin) || 0) + dt);
    totalCalTime += dt;
    calRateSum += calRate_mph * dt;
    if (calMin === null || calRate_mph < calMin) calMin = calRate_mph;
    if (calMax === null || calRate_mph > calMax) calMax = calRate_mph;
  }

  // Fall rate time series — same window as the bins, centered ±0.5 s
  // smoothing to drop GNSS-quantization stair-steps. Shared helper so the
  // formation page renders the same series.
  const series: FallRateSeriesPoint[] =
    computeFallRateSeries(data, events)?.series ?? [];

  // Merge bin keys and build output
  const allBinKeys = new Set([...rawBins.keys(), ...calBins.keys()]);
  const sortedKeys = Array.from(allBinKeys).sort((a, b) => a - b);

  const bins: VelocityBinEntry[] = sortedKeys.map(key => ({
    fallRate_mph: key,
    elapsed_sec: Math.round((rawBins.get(key) || 0) * 10) / 10,
    calibrated_elapsed_sec: Math.round((calBins.get(key) || 0) * 10) / 10,
  }));

  const summary: VelocityBinSummary = {
    raw: {
      totalAnalysisTime: Math.round(totalRawTime * 10) / 10,
      averageFallRate: totalRawTime > 0 ? Math.round(rawRateSum / totalRawTime) : 0,
      minFallRate: rawMin !== null ? Math.round(rawMin) : null,
      maxFallRate: rawMax !== null ? Math.round(rawMax) : null,
    },
    calibrated: {
      totalAnalysisTime: Math.round(totalCalTime * 10) / 10,
      averageFallRate: totalCalTime > 0 ? Math.round(calRateSum / totalCalTime) : 0,
      minFallRate: calMin !== null ? Math.round(calMin) : null,
      maxFallRate: calMax !== null ? Math.round(calMax) : null,
    },
    analysisWindow: {
      startOffset: Math.round(windowStart * 10) / 10,
      endOffset: Math.round(windowEnd * 10) / 10,
      duration: Math.round((windowEnd - windowStart) * 10) / 10,
    },
  };

  return { bins, summary, series };
}

/**
 * Build a JumperBaseline from analysis results
 */
function buildBaseline(
  parsedData: ParsedLogData,
  events: JumpEvents,
  velocityBins: VelocityBinEntry[] | null,
  velocitySummary: VelocityBinSummary | null
): JumperBaseline {
  return {
    analysisVersion: '1.0.0',
    analyzedAt: new Date().toISOString(),
    events: {
      exitOffsetSec: events.exitOffsetSec ?? null,
      deploymentOffsetSec: events.deploymentOffsetSec ?? null,
      landingOffsetSec: events.landingOffsetSec ?? null,
      exitAltitudeFt: events.exitAltitudeFt ?? null,
      deployAltitudeFt: events.deployAltitudeFt ?? null,
      exitLatitude: events.exitLatitude ?? null,
      exitLongitude: events.exitLongitude ?? null,
      maxDescentRateFpm: events.maxDescentRateFpm ?? null,
    },
    velocityBins: velocityBins && velocitySummary
      ? { bins: velocityBins, summary: velocitySummary }
      : null,
    metadata: {
      logDuration_sec: Math.round(parsedData.duration * 10) / 10,
      logEntryCount: parsedData.logEntries.length,
      hasGPS: parsedData.hasGPS,
      logVersion: parsedData.logVersion ?? null,
      logString: parsedData.logString ?? null,
      surfacePressureAlt_m: parsedData.dzSurfacePressureAltitude_m ?? null,
    },
  };
}
