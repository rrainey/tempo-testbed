// lib/testbed/diff-engine.ts
import type { JumperBaseline } from './data-loader';

export type DiffStatus = 'unchanged' | 'improved' | 'regressed' | 'changed' | 'new' | 'lost';

export interface FieldDiff {
  field: string;
  baselineValue: number | string | boolean | null;
  currentValue: number | string | boolean | null;
  status: DiffStatus;
  delta?: number;       // numeric difference if applicable
  tolerance?: number;   // tolerance used for comparison
}

export interface JumperDiff {
  testCaseId: string;
  jumperName: string;
  fields: FieldDiff[];
  overallStatus: DiffStatus;
}

// Tolerances for numeric comparisons
const TOLERANCES: Record<string, number> = {
  exitOffsetSec: 1.0,        // ±1 second
  deploymentOffsetSec: 1.0,
  landingOffsetSec: 2.0,     // landing is less precise
  exitAltitudeFt: 100,       // ±100 ft
  deployAltitudeFt: 100,
  exitLatitude: 0.0001,      // ~11 meters
  exitLongitude: 0.0001,
  maxDescentRateFpm: 200,    // ±200 fpm
  logDuration_sec: 0.5,
  logEntryCount: 0,          // must match exactly
  surfacePressureAlt_m: 0.1,
};

/**
 * Compare current analysis result against a baseline
 */
export function diffBaselines(
  baseline: JumperBaseline,
  current: JumperBaseline,
  testCaseId: string,
  jumperName: string
): JumperDiff {
  const fields: FieldDiff[] = [];

  // Compare event fields
  const eventFields = [
    'exitOffsetSec', 'deploymentOffsetSec', 'landingOffsetSec',
    'exitAltitudeFt', 'deployAltitudeFt',
    'exitLatitude', 'exitLongitude', 'maxDescentRateFpm',
  ] as const;

  for (const field of eventFields) {
    const bVal = baseline.events[field];
    const cVal = current.events[field];
    fields.push(compareNumericField(field, bVal, cVal, TOLERANCES[field]));
  }

  // Compare metadata fields
  const metaFields = [
    'logDuration_sec', 'logEntryCount', 'surfacePressureAlt_m',
  ] as const;

  for (const field of metaFields) {
    const bVal = baseline.metadata[field];
    const cVal = current.metadata[field];
    fields.push(compareNumericField(field, bVal as number | null, cVal as number | null, TOLERANCES[field]));
  }

  // Compare boolean/string metadata
  fields.push(compareField('hasGPS', baseline.metadata.hasGPS, current.metadata.hasGPS));
  fields.push(compareField('logVersion', baseline.metadata.logVersion, current.metadata.logVersion));

  // Velocity bin summary comparison
  if (baseline.velocityBins?.summary && current.velocityBins?.summary) {
    const bSummary = baseline.velocityBins.summary;
    const cSummary = current.velocityBins.summary;

    fields.push(compareNumericField(
      'avgFallRate_raw',
      bSummary.raw?.averageFallRate ?? null,
      cSummary.raw?.averageFallRate ?? null,
      5
    ));
    fields.push(compareNumericField(
      'avgFallRate_cal',
      bSummary.calibrated?.averageFallRate ?? null,
      cSummary.calibrated?.averageFallRate ?? null,
      5
    ));
  } else if (current.velocityBins?.summary) {
    fields.push({
      field: 'velocityBins',
      baselineValue: null,
      currentValue: 'computed',
      status: 'new',
    });
  }

  // Determine overall status
  const overallStatus = computeOverallStatus(fields);

  return { testCaseId, jumperName, fields, overallStatus };
}

function compareNumericField(
  field: string,
  baseline: number | null,
  current: number | null,
  tolerance: number = 0
): FieldDiff {
  if (baseline === null && current === null) {
    return { field, baselineValue: null, currentValue: null, status: 'unchanged', tolerance };
  }

  if (baseline === null && current !== null) {
    return { field, baselineValue: null, currentValue: current, status: 'new', tolerance };
  }

  if (baseline !== null && current === null) {
    return { field, baselineValue: baseline, currentValue: null, status: 'lost', tolerance };
  }

  // Both non-null
  const delta = current! - baseline!;
  const withinTolerance = Math.abs(delta) <= tolerance;

  return {
    field,
    baselineValue: baseline,
    currentValue: current,
    status: withinTolerance ? 'unchanged' : 'changed',
    delta,
    tolerance,
  };
}

function compareField(
  field: string,
  baseline: any,
  current: any
): FieldDiff {
  if (baseline === null && current === null) {
    return { field, baselineValue: null, currentValue: null, status: 'unchanged' };
  }
  if (baseline === null && current !== null) {
    return { field, baselineValue: null, currentValue: current, status: 'new' };
  }
  if (baseline !== null && current === null) {
    return { field, baselineValue: baseline, currentValue: null, status: 'lost' };
  }
  return {
    field,
    baselineValue: baseline,
    currentValue: current,
    status: baseline === current ? 'unchanged' : 'changed',
  };
}

function computeOverallStatus(fields: FieldDiff[]): DiffStatus {
  const hasLost = fields.some(f => f.status === 'lost');
  const hasNew = fields.some(f => f.status === 'new');
  const hasChanged = fields.some(f => f.status === 'changed');

  if (hasLost) return 'regressed';
  if (hasNew && !hasChanged) return 'improved';
  if (hasChanged) return 'changed';
  return 'unchanged';
}

/**
 * Get a human-readable summary of a diff
 */
export function summarizeDiff(diff: JumperDiff): string {
  const newFields = diff.fields.filter(f => f.status === 'new').length;
  const lostFields = diff.fields.filter(f => f.status === 'lost').length;
  const changedFields = diff.fields.filter(f => f.status === 'changed').length;
  const unchangedFields = diff.fields.filter(f => f.status === 'unchanged').length;

  const parts: string[] = [];
  if (newFields > 0) parts.push(`${newFields} new`);
  if (lostFields > 0) parts.push(`${lostFields} lost`);
  if (changedFields > 0) parts.push(`${changedFields} changed`);
  parts.push(`${unchangedFields} unchanged`);

  return parts.join(', ');
}
