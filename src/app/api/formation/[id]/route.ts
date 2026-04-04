// app/api/formation/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loadTestCase, loadCalibration, saveCalibration } from '@/lib/testbed/data-loader';
import type { OrientationCalibration } from '@/lib/testbed/data-loader';
import { loadFormationData } from '@/lib/testbed/formation-loader';
import { discoverGoProVideos, extractGoProVideoInfo } from '@/lib/testbed/gopro-telemetry';
import type { GoProVideoInfo } from '@/lib/testbed/gopro-telemetry';

function serializeFormation(
  formationData: ReturnType<typeof loadFormationData>,
  metadata: { dropzone: { lat_deg: number; lon_deg: number; elevation_m: number }; name: string; jumpers: string[] },
  calibration: OrientationCalibration | null,
  videos: GoProVideoInfo[]
) {
  return {
    ...formationData,
    startTime: formationData.startTime.toISOString(),
    dzCenter: {
      lat_deg: metadata.dropzone.lat_deg,
      lon_deg: metadata.dropzone.lon_deg,
      alt_m: metadata.dropzone.elevation_m,
    },
    testCaseName: metadata.name,
    calibration,
    videos,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testCaseId } = await params;

    const testCase = loadTestCase(testCaseId);
    if (!testCase) {
      return NextResponse.json(
        { error: `Test case not found: ${testCaseId}` },
        { status: 404 }
      );
    }

    if (testCase.metadata.isSolo) {
      return NextResponse.json(
        { error: 'Formation playback not available for solo jumps' },
        { status: 400 }
      );
    }

    // Load saved calibration if it exists
    const calibration = loadCalibration(testCaseId);

    const formationData = loadFormationData(testCaseId, testCase.metadata, calibration);

    if (formationData.participants.length < 2) {
      return NextResponse.json(
        { error: 'Need at least 2 jumpers with flight data for formation playback' },
        { status: 400 }
      );
    }

    // Discover and extract GoPro video telemetry
    const videoFiles = discoverGoProVideos(testCaseId, testCase.metadata.jumpers);
    const videos: GoProVideoInfo[] = [];
    for (const vf of videoFiles) {
      const info = await extractGoProVideoInfo(
        testCaseId, vf.jumperId, vf.fileName, vf.serveName, formationData.startTime
      );
      if (info) videos.push(info);
    }

    return NextResponse.json(
      serializeFormation(formationData, testCase.metadata, calibration, videos)
    );
  } catch (error) {
    console.error('Formation load error:', error);
    return NextResponse.json(
      { error: `Failed to load formation: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}

/**
 * PATCH: Save orientation calibration and return recomputed formation data.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testCaseId } = await params;

    const testCase = loadTestCase(testCaseId);
    if (!testCase) {
      return NextResponse.json(
        { error: `Test case not found: ${testCaseId}` },
        { status: 404 }
      );
    }

    const calibration: OrientationCalibration = await request.json();

    // Persist
    saveCalibration(testCaseId, calibration);

    // Rebuild with new calibration
    const formationData = loadFormationData(testCaseId, testCase.metadata, calibration);

    // Re-use cached video telemetry (no re-extraction needed for calibration changes)
    const videoFiles = discoverGoProVideos(testCaseId, testCase.metadata.jumpers);
    const videos: GoProVideoInfo[] = [];
    for (const vf of videoFiles) {
      const info = await extractGoProVideoInfo(
        testCaseId, vf.jumperId, vf.fileName, vf.serveName, formationData.startTime
      );
      if (info) videos.push(info);
    }

    return NextResponse.json(
      serializeFormation(formationData, testCase.metadata, calibration, videos)
    );
  } catch (error) {
    console.error('Calibration save error:', error);
    return NextResponse.json(
      { error: `Failed to save calibration: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
