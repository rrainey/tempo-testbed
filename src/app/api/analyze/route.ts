// app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loadFlightData, loadTestCase, saveBaseline } from '@/lib/testbed/data-loader';
import { runAnalysis } from '@/lib/testbed/analysis-runner';
import { diffBaselines } from '@/lib/testbed/diff-engine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { testCaseId, jumperName, accept } = body;

    if (!testCaseId || !jumperName) {
      return NextResponse.json(
        { error: 'testCaseId and jumperName are required' },
        { status: 400 }
      );
    }

    // Load raw flight data
    const rawLog = loadFlightData(testCaseId, jumperName);
    if (!rawLog) {
      return NextResponse.json(
        { error: `No flight data found for ${testCaseId}/${jumperName}` },
        { status: 404 }
      );
    }

    // Run analysis
    const result = runAnalysis(rawLog);

    // Load existing baseline for comparison
    const testCase = loadTestCase(testCaseId);
    const jumperData = testCase?.jumpers.find(j => j.name === jumperName);
    const existingBaseline = jumperData?.baseline ?? null;

    // Compute diff if baseline exists
    let diff = null;
    if (existingBaseline && existingBaseline.analyzedAt) {
      diff = diffBaselines(existingBaseline, result.baseline, testCaseId, jumperName);
    }

    // Accept: save current results as new baseline
    if (accept) {
      saveBaseline(testCaseId, jumperName, result.baseline);
    }

    // Serialize ParsedLogData for the client (strip raw logEntries to keep response small)
    const clientData = {
      events: result.events,
      velocityBins: result.velocityBins,
      velocitySummary: result.velocitySummary,
      baseline: result.baseline,
      diff,
      accepted: !!accept,
      timeSeries: {
        altitude: result.parsedData.altitude,
        vspeed: result.parsedData.vspeed,
        gps: result.parsedData.gps,
        gpsAltitude: result.parsedData.gpsAltitude,
        staticPressure: result.parsedData.staticPressure,
        duration: result.parsedData.duration,
        sampleRate: result.parsedData.sampleRate,
        hasGPS: result.parsedData.hasGPS,
        logVersion: result.parsedData.logVersion,
        logString: result.parsedData.logString,
        dzSurfacePressureAltitude_m: result.parsedData.dzSurfacePressureAltitude_m,
      },
    };

    return NextResponse.json(clientData);
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: `Analysis failed: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
