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
