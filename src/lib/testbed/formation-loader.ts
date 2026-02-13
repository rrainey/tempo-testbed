// lib/testbed/formation-loader.ts
//
// Bridge between the per-jumper analysis pipeline (KMLDataV1[])
// and the formation viewer (ParticipantData[] / FormationData).

import { LogParser } from '../analysis/log-parser';
import type { ParsedLogData } from '../analysis/log-parser';
import type { KMLDataV1 } from '../analysis/dropkick-reader';
import { EventDetector } from '../analysis/event-detector';
import { calibrateFallRate } from '../formation/coordinates';
import type { TimeSeriesPoint, ParticipantData } from '../formation/coordinates';
import type { FormationData } from '../../components/formation/FormationViewer';
import type { GeodeticCoordinates } from '../formation/types';
import type { TestCaseMetadata } from './data-loader';
import { loadFlightData } from './data-loader';

// Distinct colors for up to 8 participants
const PARTICIPANT_COLORS = [
  '#339af0', // blue  (base jumper default)
  '#ff6b6b', // red
  '#51cf66', // green
  '#fcc419', // yellow
  '#cc5de8', // purple
  '#ff922b', // orange
  '#20c997', // teal
  '#f06595', // pink
];

/**
 * Convert KMLDataV1[] entries to TimeSeriesPoint[] for the formation viewer.
 *
 * Filters out entries with null location (no GNSS fix) — the viewer's
 * interpolatePosition() handles non-uniform time spacing smoothly.
 *
 * This is the future integration point for adjBaroAlt_ftAGL calibration.
 */
export function kmlToTimeSeries(entries: KMLDataV1[]): TimeSeriesPoint[] {
  const result: TimeSeriesPoint[] = [];

  for (const entry of entries) {
    // Skip entries without valid GNSS position
    if (entry.location === null) continue;

    // Compute vertical speed from GNSS-derived rate of descent
    let verticalSpeed_mps: number | undefined;
    if (entry.rateOfDescent_fpm !== null) {
      verticalSpeed_mps = entry.rateOfDescent_fpm * 0.00508; // fpm → m/s (positive = descending)
    }

    // Compute normalized fall rate via density calibration
    let normalizedFallRate_mph: number | undefined;
    if (verticalSpeed_mps !== undefined && entry.baroAlt_ft !== null) {
      normalizedFallRate_mph = calibrateFallRate(verticalSpeed_mps, entry.baroAlt_ft);
    }

    result.push({
      timeOffset: entry.timeOffset,
      timestamp: entry.timestamp ?? undefined,
      location: entry.location,
      baroAlt_ft: entry.baroAlt_ft ?? 0,
      groundspeed_kmph: entry.groundspeed_kmph ?? undefined,
      groundtrack_degT: entry.groundtrack_degT ?? undefined,
      verticalSpeed_mps,
      normalizedFallRate_mph,
    });
  }

  return result;
}

/**
 * Interpolate barometric altitude at a given timeOffset within a time series.
 */
function findBaroAtTimeOffset(timeSeries: TimeSeriesPoint[], targetOffset: number): number | undefined {
  if (timeSeries.length === 0) return undefined;

  // Clamp to bounds
  if (targetOffset <= timeSeries[0].timeOffset) return timeSeries[0].baroAlt_ft;
  if (targetOffset >= timeSeries[timeSeries.length - 1].timeOffset) {
    return timeSeries[timeSeries.length - 1].baroAlt_ft;
  }

  // Find bracketing samples
  for (let i = 0; i < timeSeries.length - 1; i++) {
    if (timeSeries[i].timeOffset <= targetOffset && timeSeries[i + 1].timeOffset > targetOffset) {
      const dt = timeSeries[i + 1].timeOffset - timeSeries[i].timeOffset;
      const t = (targetOffset - timeSeries[i].timeOffset) / dt;
      return timeSeries[i].baroAlt_ft + t * (timeSeries[i + 1].baroAlt_ft - timeSeries[i].baroAlt_ft);
    }
  }
  return undefined;
}

/**
 * Find the nearest time series entry that has a valid UTC timestamp.
 */
function findNearestEntryWithTimestamp(
  timeSeries: TimeSeriesPoint[],
  targetOffset: number
): TimeSeriesPoint | undefined {
  let best: TimeSeriesPoint | undefined;
  let bestDist = Infinity;
  for (const pt of timeSeries) {
    if (pt.timestamp) {
      const dist = Math.abs(pt.timeOffset - targetOffset);
      if (dist < bestDist) {
        bestDist = dist;
        best = pt;
      }
    }
  }
  return best;
}

/**
 * Find the timeOffset in `otherTimeSeries` that corresponds to the same UTC instant
 * as `baseTimeOffset` in `baseTimeSeries`. Uses UTC timestamps for cross-device sync.
 */
function findSyncedTimeOffset(
  baseTimeSeries: TimeSeriesPoint[],
  otherTimeSeries: TimeSeriesPoint[],
  baseTimeOffset: number
): number | undefined {
  // Find a base entry near the target offset that has a timestamp
  const baseEntry = findNearestEntryWithTimestamp(baseTimeSeries, baseTimeOffset);
  if (!baseEntry || !baseEntry.timestamp) return undefined;

  // Compute the UTC time at baseTimeOffset by offsetting from the nearest timestamped entry
  const baseUTC = baseEntry.timestamp.getTime() + (baseTimeOffset - baseEntry.timeOffset) * 1000;

  // Find the other device entry closest to this UTC time
  const otherEntry = findNearestEntryWithTimestamp(otherTimeSeries, otherTimeSeries[0]?.timeOffset ?? 0);
  if (!otherEntry || !otherEntry.timestamp) return undefined;

  // Compute the other device's timeOffset at the same UTC instant
  const otherUTC = otherEntry.timestamp.getTime();
  const otherOffset = otherEntry.timeOffset + (baseUTC - otherUTC) / 1000;

  return otherOffset;
}

/**
 * Compute per-participant reference barometric altitude at a synchronized time.
 * Stores `refBaroAlt_ft` on each participant so the client can recalibrate
 * when the user switches the base jumper.
 *
 * Also computes initial scale factors relative to `baseJumperId` and applies
 * `adjBaroAlt_ftAGL = baroAlt_ft * scaleFactor` to every sample.
 */
function computeAndApplyBaroCalibration(
  participants: ParticipantData[],
  baseJumperId: string,
  exitTimeOffset?: number
): void {
  const baseParticipant = participants.find(p => p.userId === baseJumperId);
  if (!baseParticipant || baseParticipant.timeSeries.length === 0) {
    // No base → everyone gets identity calibration
    for (const p of participants) {
      p.refBaroAlt_ft = undefined;
      for (const pt of p.timeSeries) pt.adjBaroAlt_ftAGL = pt.baroAlt_ft;
    }
    return;
  }

  // Reference time: 30s before exit, or 75% through the base's timeline
  const baseTimes = baseParticipant.timeSeries;
  let refTimeOffset: number;
  if (exitTimeOffset !== undefined) {
    refTimeOffset = exitTimeOffset - 30;
  } else {
    const duration = baseTimes[baseTimes.length - 1].timeOffset - baseTimes[0].timeOffset;
    refTimeOffset = baseTimes[0].timeOffset + duration * 0.75;
  }

  // Clamp to base's data range
  refTimeOffset = Math.max(refTimeOffset, baseTimes[0].timeOffset);
  refTimeOffset = Math.min(refTimeOffset, baseTimes[baseTimes.length - 1].timeOffset);

  // Store base's reference baro reading
  const baseBaro = findBaroAtTimeOffset(baseTimes, refTimeOffset);
  baseParticipant.refBaroAlt_ft = baseBaro;

  if (baseBaro === undefined || baseBaro < 100) {
    console.warn('[BaroCal] Base baro too low at reference time, skipping calibration');
    for (const p of participants) {
      p.refBaroAlt_ft = undefined;
      for (const pt of p.timeSeries) pt.adjBaroAlt_ftAGL = pt.baroAlt_ft;
    }
    return;
  }

  console.log(`[BaroCal] Reference: base=${baseJumperId} at timeOffset=${refTimeOffset.toFixed(1)}s, baseBaro=${baseBaro.toFixed(1)} ft AGL`);

  // Apply identity to base jumper
  for (const pt of baseParticipant.timeSeries) pt.adjBaroAlt_ftAGL = pt.baroAlt_ft;

  for (const participant of participants) {
    if (participant.userId === baseJumperId) continue;

    // Find the other device's timeOffset at the same UTC instant
    const syncedOffset = findSyncedTimeOffset(
      baseTimes,
      participant.timeSeries,
      refTimeOffset
    );

    if (syncedOffset === undefined) {
      console.warn(`[BaroCal] No UTC sync for ${participant.userId}, using scaleFactor=1.0`);
      participant.refBaroAlt_ft = undefined;
      for (const pt of participant.timeSeries) pt.adjBaroAlt_ftAGL = pt.baroAlt_ft;
      continue;
    }

    const otherBaro = findBaroAtTimeOffset(participant.timeSeries, syncedOffset);
    participant.refBaroAlt_ft = otherBaro;

    if (otherBaro === undefined || otherBaro < 100) {
      console.warn(`[BaroCal] Baro too low for ${participant.userId} at synced offset, using scaleFactor=1.0`);
      for (const pt of participant.timeSeries) pt.adjBaroAlt_ftAGL = pt.baroAlt_ft;
      continue;
    }

    const scaleFactor = baseBaro / otherBaro;

    // Reject outliers — factor should be close to 1.0
    if (scaleFactor < 0.90 || scaleFactor > 1.10) {
      console.warn(`[BaroCal] scaleFactor=${scaleFactor.toFixed(4)} out of range for ${participant.userId}, using 1.0`);
      for (const pt of participant.timeSeries) pt.adjBaroAlt_ftAGL = pt.baroAlt_ft;
    } else {
      console.log(`[BaroCal] ${participant.userId}: scaleFactor=${scaleFactor.toFixed(4)} (otherBaro=${otherBaro.toFixed(1)} ft)`);
      for (const pt of participant.timeSeries) {
        pt.adjBaroAlt_ftAGL = pt.baroAlt_ft * scaleFactor;
      }
    }
  }
}

/**
 * Build a FormationData structure from parsed logs for all jumpers in a test case.
 */
export function buildFormationData(
  testCaseId: string,
  metadata: TestCaseMetadata,
  jumperLogs: Map<string, ParsedLogData>
): FormationData {
  const participants: ParticipantData[] = [];
  const exitTimes: number[] = [];
  const deploymentTimes: number[] = [];

  for (let i = 0; i < metadata.jumpers.length; i++) {
    const jumperName = metadata.jumpers[i];
    const parsedData = jumperLogs.get(jumperName);

    if (!parsedData || parsedData.logEntries.length === 0) continue;

    // Run event detection to get exit and deployment times
    const events = EventDetector.analyzeJump(parsedData);
    if (events.exitOffsetSec !== undefined) exitTimes.push(events.exitOffsetSec);
    if (events.deploymentOffsetSec !== undefined) deploymentTimes.push(events.deploymentOffsetSec);

    const timeSeries = kmlToTimeSeries(parsedData.logEntries);
    if (timeSeries.length === 0) continue;

    participants.push({
      userId: jumperName,
      jumpLogId: `${testCaseId}/${jumperName}`,
      name: jumperName,
      color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
      isBase: jumperName === metadata.baseJumper,
      isVisible: true,
      timeSeries,
    });
  }

  // Timeline: 10s before earliest exit → latest deployment (or end of data)
  const allTimes = participants.flatMap(p => p.timeSeries.map(ts => ts.timeOffset));
  const dataEnd = allTimes.length > 0 ? Math.max(...allTimes) : 0;

  const timelineStart = exitTimes.length > 0
    ? Math.min(...exitTimes) - 10
    : (allTimes.length > 0 ? Math.min(...allTimes) : 0);

  const timelineEnd = deploymentTimes.length > 0
    ? Math.max(...deploymentTimes) + 5 // 5s buffer after last deployment
    : dataEnd;

  // Determine jump run track from base jumper's ground track near exit
  const baseParticipant = participants.find(p => p.isBase);
  const baseExitTime = exitTimes.length > 0 ? Math.min(...exitTimes) : undefined;
  let jumpRunTrack = 0;
  if (baseParticipant && baseParticipant.timeSeries.length > 0 && baseExitTime !== undefined) {
    // Use ground track just before exit (within 5s before exit time)
    const nearExit = baseParticipant.timeSeries
      .filter(ts => ts.timeOffset >= baseExitTime - 5 && ts.timeOffset <= baseExitTime)
      .filter(ts => ts.groundtrack_degT !== undefined);
    if (nearExit.length > 0) {
      jumpRunTrack = nearExit[nearExit.length - 1].groundtrack_degT!;
    }
  } else if (baseParticipant && baseParticipant.timeSeries.length > 0) {
    // Fallback: middle of time series
    const midIdx = Math.floor(baseParticipant.timeSeries.length / 2);
    jumpRunTrack = baseParticipant.timeSeries[midIdx].groundtrack_degT ?? 0;
  }

  // Cross-device barometric calibration (also stores refBaroAlt_ft per participant)
  const firstExitTime = exitTimes.length > 0 ? Math.min(...exitTimes) : undefined;
  computeAndApplyBaroCalibration(participants, metadata.baseJumper, firstExitTime);

  // Find the first available timestamp for startTime
  let startTime = new Date();
  for (const [, parsedData] of jumperLogs) {
    if (parsedData.startTime) {
      startTime = parsedData.startTime;
      break;
    }
  }

  return {
    id: testCaseId,
    startTime,
    baseJumperId: metadata.baseJumper,
    jumpRunTrack_degTrue: jumpRunTrack,
    participants,
    dzElevation_m: metadata.dropzone.elevation_m,
    timelineStart,
    timelineEnd,
  };
}

/**
 * Load and build formation data for a test case.
 * This is the main entry point for the API route.
 */
export function loadFormationData(
  testCaseId: string,
  metadata: TestCaseMetadata
): FormationData {
  const jumperLogs = new Map<string, ParsedLogData>();

  for (const jumperName of metadata.jumpers) {
    const rawLog = loadFlightData(testCaseId, jumperName);
    if (!rawLog) continue;

    const parsedData = LogParser.parseLog(rawLog);
    if (parsedData.logEntries.length > 0) {
      jumperLogs.set(jumperName, parsedData);
    }
  }

  return buildFormationData(testCaseId, metadata, jumperLogs);
}
