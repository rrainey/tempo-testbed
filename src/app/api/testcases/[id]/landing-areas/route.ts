// app/api/testcases/[id]/landing-areas/route.ts
//
// Landing-area polygons for the drop zone a test case was jumped at.
// Resolution is by proximity, not configuration: scan
// test-data/dropzones/*/landing-areas.geojson and return the file whose
// features lie nearest the case's dropzone coordinates (within 15 km).
// Returns { landingAreas: FeatureCollection | null, dropzone: string | null }.
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { loadTestCase } from '@/lib/testbed/data-loader';
import { haversineMeters } from '@tempo/core/analysis/gps-path-utils';

const DROPZONES_DIR = path.join(process.cwd(), 'test-data', 'dropzones');
const MAX_DISTANCE_M = 15000;

function centroidOf(geojson: any): [number, number] | null {
  let lonSum = 0, latSum = 0, n = 0;
  const walk = (coords: any) => {
    if (typeof coords[0] === 'number') { lonSum += coords[0]; latSum += coords[1]; n++; }
    else for (const c of coords) walk(c);
  };
  for (const f of geojson.features ?? []) {
    if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  }
  return n ? [lonSum / n, latSum / n] : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const testCase = loadTestCase(id);
    if (!testCase) {
      return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
    }
    const dz = testCase.metadata.dropzone;

    let best: { dir: string; geojson: any; dist: number } | null = null;
    if (fs.existsSync(DROPZONES_DIR)) {
      for (const entry of fs.readdirSync(DROPZONES_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = path.join(DROPZONES_DIR, entry.name, 'landing-areas.geojson');
        if (!fs.existsSync(file)) continue;
        const geojson = JSON.parse(fs.readFileSync(file, 'utf8'));
        const centroid = centroidOf(geojson);
        if (!centroid) continue;
        const dist = haversineMeters(dz.lat_deg, dz.lon_deg, centroid[1], centroid[0]);
        if (dist <= MAX_DISTANCE_M && (!best || dist < best.dist)) {
          best = { dir: entry.name, geojson, dist };
        }
      }
    }

    return NextResponse.json({
      landingAreas: best?.geojson ?? null,
      dropzone: best?.dir ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `landing-areas failed: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
