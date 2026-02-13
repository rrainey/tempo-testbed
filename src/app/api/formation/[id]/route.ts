// app/api/formation/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loadTestCase } from '@/lib/testbed/data-loader';
import { loadFormationData } from '@/lib/testbed/formation-loader';

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

    const formationData = loadFormationData(testCaseId, testCase.metadata);

    if (formationData.participants.length < 2) {
      return NextResponse.json(
        { error: 'Need at least 2 jumpers with flight data for formation playback' },
        { status: 400 }
      );
    }

    // Serialize: Date → ISO string for JSON transport
    const serialized = {
      ...formationData,
      startTime: formationData.startTime.toISOString(),
      dzCenter: {
        lat_deg: testCase.metadata.dropzone.lat_deg,
        lon_deg: testCase.metadata.dropzone.lon_deg,
        alt_m: testCase.metadata.dropzone.elevation_m,
      },
      testCaseName: testCase.metadata.name,
    };

    return NextResponse.json(serialized);
  } catch (error) {
    console.error('Formation load error:', error);
    return NextResponse.json(
      { error: `Failed to load formation: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
