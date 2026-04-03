// lib/testbed/data-loader.ts
import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = path.join(process.cwd(), 'test-data');

export interface DropzoneInfo {
  name: string;
  lat_deg: number;
  lon_deg: number;
  elevation_m: number;
  timezone: string;
}

export interface TestCaseMetadata {
  name: string;
  description: string;
  dropzone: DropzoneInfo;
  jumpers: string[];
  baseJumper: string;
  isSolo: boolean;
  tags: string[];
}

export interface JumperBaseline {
  analysisVersion: string;
  analyzedAt: string | null;
  events: {
    exitOffsetSec: number | null;
    deploymentOffsetSec: number | null;
    landingOffsetSec: number | null;
    exitAltitudeFt: number | null;
    deployAltitudeFt: number | null;
    exitLatitude: number | null;
    exitLongitude: number | null;
    maxDescentRateFpm: number | null;
  };
  velocityBins: any | null;
  metadata: {
    logDuration_sec: number | null;
    logEntryCount: number | null;
    hasGPS: boolean | null;
    logVersion: number | null;
    logString: string | null;
    surfacePressureAlt_m: number | null;
  };
}

export interface TestCaseSummary {
  id: string;           // directory name, e.g. "01-solo-billy"
  metadata: TestCaseMetadata;
  jumperCount: number;
  hasBaseline: boolean;
}

export interface TestCaseDetail extends TestCaseSummary {
  jumpers: {
    name: string;
    hasFlightData: boolean;
    baseline: JumperBaseline | null;
  }[];
}

/**
 * List all test cases found in test-data/
 */
export function listTestCases(): TestCaseSummary[] {
  if (!fs.existsSync(TEST_DATA_DIR)) return [];

  const entries = fs.readdirSync(TEST_DATA_DIR, { withFileTypes: true });
  const cases: TestCaseSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const metadataPath = path.join(TEST_DATA_DIR, entry.name, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;

    try {
      const metadata: TestCaseMetadata = JSON.parse(
        fs.readFileSync(metadataPath, 'utf-8')
      );

      // Check if any jumper has a baseline
      const hasBaseline = metadata.jumpers.some(j => {
        const baselinePath = path.join(TEST_DATA_DIR, entry.name, j, 'baseline.json');
        if (!fs.existsSync(baselinePath)) return false;
        const bl: JumperBaseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
        return bl.analyzedAt !== null;
      });

      cases.push({
        id: entry.name,
        metadata,
        jumperCount: metadata.jumpers.length,
        hasBaseline,
      });
    } catch (e) {
      console.error(`Error reading test case ${entry.name}:`, e);
    }
  }

  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Load detailed test case data
 */
export function loadTestCase(testCaseId: string): TestCaseDetail | null {
  const caseDir = path.join(TEST_DATA_DIR, testCaseId);
  const metadataPath = path.join(caseDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) return null;

  const metadata: TestCaseMetadata = JSON.parse(
    fs.readFileSync(metadataPath, 'utf-8')
  );

  const jumpers = metadata.jumpers.map(name => {
    const jumperDir = path.join(caseDir, name);
    const flightPath = path.join(jumperDir, 'flight.txt');
    const baselinePath = path.join(jumperDir, 'baseline.json');

    let baseline: JumperBaseline | null = null;
    if (fs.existsSync(baselinePath)) {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    }

    return {
      name,
      hasFlightData: fs.existsSync(flightPath),
      baseline,
    };
  });

  const hasBaseline = jumpers.some(j => j.baseline?.analyzedAt !== null);

  return {
    id: testCaseId,
    metadata,
    jumperCount: metadata.jumpers.length,
    hasBaseline,
    jumpers,
  };
}

/**
 * Load raw flight data for a jumper
 */
export function loadFlightData(testCaseId: string, jumperName: string): Buffer | null {
  const flightPath = path.join(TEST_DATA_DIR, testCaseId, jumperName, 'flight.txt');
  if (!fs.existsSync(flightPath)) return null;
  return fs.readFileSync(flightPath);
}

/**
 * Save analysis results as a new baseline
 */
export function saveBaseline(
  testCaseId: string,
  jumperName: string,
  baseline: JumperBaseline
): void {
  const baselinePath = path.join(TEST_DATA_DIR, testCaseId, jumperName, 'baseline.json');
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
}

// ─── Orientation Calibration Persistence ────────────────────────

export interface OrientationCalibration {
  method: 'automatic' | 'humanAssisted';
  /** Time offset (seconds) of the calibration point — stable freefall */
  calibrationTimeOffset?: number;
  /** Per-jumper azimuth in degrees (0–360) relative to the jump run track */
  jumperAzimuths?: Record<string, number>;
}

/**
 * Load orientation calibration for a test case, if it exists.
 */
export function loadCalibration(testCaseId: string): OrientationCalibration | null {
  const calPath = path.join(TEST_DATA_DIR, testCaseId, 'calibration.json');
  if (!fs.existsSync(calPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(calPath, 'utf-8'));
  } catch (e) {
    console.error(`Error reading calibration for ${testCaseId}:`, e);
    return null;
  }
}

/**
 * Save orientation calibration for a test case.
 */
export function saveCalibration(
  testCaseId: string,
  calibration: OrientationCalibration
): void {
  const calPath = path.join(TEST_DATA_DIR, testCaseId, 'calibration.json');
  fs.writeFileSync(calPath, JSON.stringify(calibration, null, 2));
}
