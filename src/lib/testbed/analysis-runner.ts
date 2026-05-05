// lib/testbed/analysis-runner.ts
import { LogParser } from '@tempo/core/analysis/log-parser';
import { EventDetector } from '@tempo/core/analysis/event-detector';
import { calibrateFallRate } from '@tempo/core/formation/coordinates';
import type { ParsedLogData } from '@tempo/core/analysis/log-parser';
import type { JumpEvents } from '@tempo/core/analysis/event-detector';
import type { JumperBaseline } from './data-loader';

export interface VelocityBinEntry {
  fallRate_mph: number;
  elapsed_sec: number;
  calibrated_elapsed_sec: number;
}

export interface FallRateSeriesPoint {
  time: number; // seconds from log start
  raw_mph: number | null;
  calibrated_mph: number | null;
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

export interface AnalysisResult {
  parsedData: ParsedLogData;
  events: JumpEvents;
  velocityBins: VelocityBinEntry[] | null;
  velocitySummary: VelocityBinSummary | null;
  fallRateSeries: FallRateSeriesPoint[] | null;
  baseline: JumperBaseline;
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

  return { parsedData, events, velocityBins, velocitySummary, fallRateSeries, baseline };
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

  // Build the fall rate time series across the full log so its X-axis
  // aligns categorically with the other time-series charts (which use
  // entry.timeOffset as the implicit category at non-uniform sample rate).
  // Values are populated only for timestamps inside the analysis window.
  //
  // The reader's rateOfDescent_fpm is computed from consecutive GNSS
  // samples; with ~10 Hz GPS at 0.1 m altitude resolution that quantizes
  // the rate to ~2.24 mph steps. Recompute here over a centered ±0.5 s
  // altitude window so the quantization shrinks to ~0.22 mph — invisible
  // on the chart — without touching the value used elsewhere.
  const RATE_WINDOW_HALF_SEC = 0.5;
  type AltSample = { t: number; alt_m: number };
  const gnss: AltSample[] = [];
  for (const e of data.logEntries) {
    if (e.location !== null && !isNaN(e.location.alt_m)) {
      gnss.push({ t: e.timeOffset, alt_m: e.location.alt_m });
    }
  }
  const lowerBound = (target: number): number => {
    let lo = 0;
    let hi = gnss.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (gnss[mid].t < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const smoothedRate_mps = (t: number): number | null => {
    if (gnss.length < 2) return null;
    const tA = t - RATE_WINDOW_HALF_SEC;
    const tB = t + RATE_WINDOW_HALF_SEC;
    // First sample at or after tA, and at or after tB.
    const iA = lowerBound(tA);
    const iB = lowerBound(tB);
    const a = iA < gnss.length ? gnss[iA] : null;
    const b = iB < gnss.length ? gnss[iB] : null;
    if (!a || !b || b.t <= a.t) return null;
    return -(b.alt_m - a.alt_m) / (b.t - a.t);
  };

  const series: FallRateSeriesPoint[] = [];
  for (const entry of data.logEntries) {
    if (entry.rateOfDescent_fpm === null) continue;
    const inWindow =
      entry.timeOffset >= windowStart &&
      entry.timeOffset <= windowEnd &&
      entry.rateOfDescent_fpm >= 0;
    if (inWindow) {
      const windowRate_mps = smoothedRate_mps(entry.timeOffset);
      const rate_mps = windowRate_mps ?? entry.rateOfDescent_fpm * 0.00508;
      const rawRate_mph = rate_mps * 2.23694;
      const altitude_ft = entry.baroAlt_ft ?? 7000;
      const calRate_mph = calibrateFallRate(rate_mps, altitude_ft);
      series.push({
        time: entry.timeOffset,
        raw_mph: rawRate_mph,
        calibrated_mph: calRate_mph,
      });
    } else {
      series.push({
        time: entry.timeOffset,
        raw_mph: null,
        calibrated_mph: null,
      });
    }
  }

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
