/**
 * analyze-gps-distance.ts
 *
 * Standalone analysis: compare raw GPS positions between two jumpers
 * to investigate potential timing offset artifacts.
 *
 * For jump 05-formation-jump4-3way, compares scott (base) and russ
 * at each ~1-second GPS fix in a window around 862.4s on scott's timeline.
 *
 * Shows both UTC-synced and raw-timeOffset views so timing discrepancies
 * between devices become visible.
 *
 * Usage: npx tsx scripts/analyze-gps-distance.ts
 */

import fs from 'fs';
import path from 'path';
import { LogParser } from '../src/lib/analysis/log-parser';
import type { KMLDataV1 } from '../src/lib/analysis/dropkick-reader';

// ─── Configuration ──────────────────────────────────────────────────
const TEST_CASE = '05-formation-jump4-3way';
const BASE_JUMPER = 'scott';
const OTHER_JUMPER = 'russ';
const CENTER_TIME = 862.4;   // seconds on the base jumper's timeline
const WINDOW_HALF = 5;       // ±5 seconds → 10-second window

const TEST_DATA_DIR = path.join(process.cwd(), 'test-data');

// ─── Haversine distance (meters) ────────────────────────────────────
function haversineDistance(
  lat1_deg: number, lon1_deg: number,
  lat2_deg: number, lon2_deg: number
): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2_deg - lat1_deg);
  const dLon = toRad(lon2_deg - lon1_deg);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1_deg)) * Math.cos(toRad(lat2_deg)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── 3D distance in meters (haversine + altitude) ───────────────────
function distance3D(
  lat1: number, lon1: number, alt1_m: number,
  lat2: number, lon2: number, alt2_m: number
): number {
  const horiz = haversineDistance(lat1, lon1, lat2, lon2);
  const dAlt = alt2_m - alt1_m;
  return Math.sqrt(horiz * horiz + dAlt * dAlt);
}

// ─── Meters to feet ─────────────────────────────────────────────────
function mToFt(m: number): number {
  return m * 3.28084;
}

// ─── Find the nearest entry with a valid GPS fix ────────────────────
function findNearestWithLocation(
  entries: KMLDataV1[],
  timeOffset: number
): KMLDataV1 | undefined {
  let best: KMLDataV1 | undefined;
  let bestDist = Infinity;
  for (const e of entries) {
    if (e.location === null) continue;
    const dist = Math.abs(e.timeOffset - timeOffset);
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

// ─── Find entry at a given UTC instant ──────────────────────────────
function findNearestByUTC(
  entries: KMLDataV1[],
  targetUTC_ms: number
): KMLDataV1 | undefined {
  let best: KMLDataV1 | undefined;
  let bestDist = Infinity;
  for (const e of entries) {
    if (e.location === null || e.timestamp === null) continue;
    const dist = Math.abs(e.timestamp.getTime() - targetUTC_ms);
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

// ─── Load and parse a flight log ────────────────────────────────────
function loadAndParse(jumperName: string) {
  const flightPath = path.join(TEST_DATA_DIR, TEST_CASE, jumperName, 'flight.txt');
  if (!fs.existsSync(flightPath)) {
    throw new Error(`Flight data not found: ${flightPath}`);
  }
  const raw = fs.readFileSync(flightPath);
  return LogParser.parseLog(raw);
}

// ─── Compute UTC↔timeOffset mapping stats ───────────────────────────
function computeTimeMapping(entries: KMLDataV1[]) {
  // Find the first entry with both a timestamp and location
  const first = entries.find(e => e.timestamp !== null && e.location !== null);
  const last = [...entries].reverse().find(e => e.timestamp !== null && e.location !== null);
  return { first, last };
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════
function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' GPS Distance Analysis: scott vs russ');
  console.log(` Jump: ${TEST_CASE}`);
  console.log(` Window: ${CENTER_TIME - WINDOW_HALF}s – ${CENTER_TIME + WINDOW_HALF}s (center ${CENTER_TIME}s)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load and parse both logs
  console.log('Parsing scott...');
  const scottData = loadAndParse(BASE_JUMPER);
  console.log(`  ${scottData.logEntries.length} entries, duration ${scottData.duration.toFixed(1)}s`);

  console.log('Parsing russ...');
  const russData = loadAndParse(OTHER_JUMPER);
  console.log(`  ${russData.logEntries.length} entries, duration ${russData.duration.toFixed(1)}s`);

  // Show UTC mapping for both devices
  const scottMap = computeTimeMapping(scottData.logEntries);
  const russMap = computeTimeMapping(russData.logEntries);

  console.log('\n── UTC ↔ TimeOffset Mapping ──────────────────────────────────');
  if (scottMap.first?.timestamp && scottMap.last?.timestamp) {
    console.log(`  scott: timeOffset=${scottMap.first.timeOffset.toFixed(2)}s → UTC ${scottMap.first.timestamp.toISOString()}`);
    console.log(`         timeOffset=${scottMap.last.timeOffset.toFixed(2)}s → UTC ${scottMap.last.timestamp.toISOString()}`);
  }
  if (russMap.first?.timestamp && russMap.last?.timestamp) {
    console.log(`  russ:  timeOffset=${russMap.first.timeOffset.toFixed(2)}s → UTC ${russMap.first.timestamp.toISOString()}`);
    console.log(`         timeOffset=${russMap.last.timeOffset.toFixed(2)}s → UTC ${russMap.last.timestamp.toISOString()}`);
  }

  // Compute UTC offset between the two devices' timelines
  // scottUTC = scott.startTime + scott.timeOffset
  // russUTC  = russ.startTime + russ.timeOffset
  // At the same UTC instant: russ.timeOffset = scott.timeOffset + (scottStartUTC - russStartUTC)/1000
  if (scottMap.first?.timestamp && russMap.first?.timestamp) {
    const scottStartUTC = scottMap.first.timestamp.getTime() - scottMap.first.timeOffset * 1000;
    const russStartUTC = russMap.first.timestamp.getTime() - russMap.first.timeOffset * 1000;
    const offsetDiff_sec = (scottStartUTC - russStartUTC) / 1000;
    console.log(`\n  Timeline offset: russ.timeOffset ≈ scott.timeOffset + (${offsetDiff_sec.toFixed(3)}s)`);
    console.log(`  (positive means russ's log started ${Math.abs(offsetDiff_sec).toFixed(3)}s ${offsetDiff_sec > 0 ? 'after' : 'before'} scott's)`);
  }

  // ── Collect scott's GPS entries in the window ─────────────────────
  const windowStart = CENTER_TIME - WINDOW_HALF;
  const windowEnd = CENTER_TIME + WINDOW_HALF;

  const scottInWindow = scottData.logEntries.filter(
    e => e.location !== null && e.timestamp !== null &&
      e.timeOffset >= windowStart && e.timeOffset <= windowEnd
  );

  console.log(`\n  scott has ${scottInWindow.length} GPS fixes in the window [${windowStart}s, ${windowEnd}s]`);

  // ── Find approximate 1-second boundaries in scott's data ──────────
  // Group entries by their nearest whole-second UTC time
  const bySecond = new Map<number, KMLDataV1[]>();
  for (const e of scottInWindow) {
    const utcSec = Math.round(e.timestamp!.getTime() / 1000);
    if (!bySecond.has(utcSec)) bySecond.set(utcSec, []);
    bySecond.get(utcSec)!.push(e);
  }

  // Pick the entry closest to each whole-second boundary
  const scottAtSeconds: KMLDataV1[] = [];
  for (const [utcSec, entries] of [...bySecond.entries()].sort((a, b) => a[0] - b[0])) {
    const targetMs = utcSec * 1000;
    let best = entries[0];
    let bestDist = Infinity;
    for (const e of entries) {
      const d = Math.abs(e.timestamp!.getTime() - targetMs);
      if (d < bestDist) { bestDist = d; best = e; }
    }
    scottAtSeconds.push(best);
  }

  console.log(`  Identified ${scottAtSeconds.length} 1-second GPS time markers\n`);

  // ── Header ────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' SECTION 1: UTC-SYNCED COMPARISON (positions at the same UTC instant)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  console.log(
    'scott_t(s)'.padStart(11) + '  ' +
    'UTC_time'.padEnd(15) + '  ' +
    'scott_lat'.padStart(12) + '  ' +
    'scott_lon'.padStart(13) + '  ' +
    'scott_alt(ft)'.padStart(14) + '  │  ' +
    'russ_t(s)'.padStart(10) + '  ' +
    'russ_lat'.padStart(12) + '  ' +
    'russ_lon'.padStart(13) + '  ' +
    'russ_alt(ft)'.padStart(13) + '  │  ' +
    'dist_2D(ft)'.padStart(12) + '  ' +
    'dist_3D(ft)'.padStart(12) + '  ' +
    'dAlt(ft)'.padStart(9)
  );
  console.log('─'.repeat(185));

  for (const scottEntry of scottAtSeconds) {
    const scottUTC = scottEntry.timestamp!.getTime();
    const scottLoc = scottEntry.location!;

    // Find russ's nearest entry at the same UTC time
    const russEntry = findNearestByUTC(russData.logEntries, scottUTC);
    if (!russEntry || !russEntry.location || !russEntry.timestamp) {
      console.log(`  ${scottEntry.timeOffset.toFixed(2).padStart(9)}  (no russ data at this UTC time)`);
      continue;
    }

    const russLoc = russEntry.location;
    const dist2D = haversineDistance(scottLoc.lat_deg, scottLoc.lon_deg, russLoc.lat_deg, russLoc.lon_deg);
    const dist3D_m = distance3D(
      scottLoc.lat_deg, scottLoc.lon_deg, scottLoc.alt_m,
      russLoc.lat_deg, russLoc.lon_deg, russLoc.alt_m
    );
    const dAlt_m = russLoc.alt_m - scottLoc.alt_m;

    const utcStr = scottEntry.timestamp!.toISOString().slice(11, 23);
    const russUTCDelta = (russEntry.timestamp!.getTime() - scottUTC) / 1000;

    console.log(
      scottEntry.timeOffset.toFixed(2).padStart(11) + '  ' +
      utcStr.padEnd(15) + '  ' +
      scottLoc.lat_deg.toFixed(7).padStart(12) + '  ' +
      scottLoc.lon_deg.toFixed(7).padStart(13) + '  ' +
      mToFt(scottLoc.alt_m).toFixed(1).padStart(14) + '  │  ' +
      russEntry.timeOffset.toFixed(2).padStart(10) + '  ' +
      russLoc.lat_deg.toFixed(7).padStart(12) + '  ' +
      russLoc.lon_deg.toFixed(7).padStart(13) + '  ' +
      mToFt(russLoc.alt_m).toFixed(1).padStart(13) + '  │  ' +
      mToFt(dist2D).toFixed(1).padStart(12) + '  ' +
      mToFt(dist3D_m).toFixed(1).padStart(12) + '  ' +
      mToFt(dAlt_m).toFixed(1).padStart(9) +
      (Math.abs(russUTCDelta) > 0.3 ? `  ⚠ russ UTC off by ${russUTCDelta.toFixed(3)}s` : '')
    );
  }

  // ── Section 2: Same-timeOffset comparison ─────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' SECTION 2: SAME-TIMEOFFSET COMPARISON (what if we ignore UTC and just use matching timeOffset?)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  console.log(
    'timeOff(s)'.padStart(11) + '  ' +
    'scott_UTC'.padEnd(15) + '  ' +
    'russ_UTC'.padEnd(15) + '  ' +
    'UTC_diff(ms)'.padStart(13) + '  │  ' +
    'dist_2D(ft)'.padStart(12) + '  ' +
    'dist_3D(ft)'.padStart(12) + '  ' +
    'dAlt(ft)'.padStart(9)
  );
  console.log('─'.repeat(105));

  for (const scottEntry of scottAtSeconds) {
    const scottLoc = scottEntry.location!;

    // Find russ's nearest entry at the same timeOffset (not UTC)
    const russEntry = findNearestWithLocation(russData.logEntries, scottEntry.timeOffset);
    if (!russEntry || !russEntry.location) {
      console.log(`  ${scottEntry.timeOffset.toFixed(2).padStart(9)}  (no russ data)`);
      continue;
    }

    const russLoc = russEntry.location;
    const dist2D = haversineDistance(scottLoc.lat_deg, scottLoc.lon_deg, russLoc.lat_deg, russLoc.lon_deg);
    const dist3D_m = distance3D(
      scottLoc.lat_deg, scottLoc.lon_deg, scottLoc.alt_m,
      russLoc.lat_deg, russLoc.lon_deg, russLoc.alt_m
    );
    const dAlt_m = russLoc.alt_m - scottLoc.alt_m;

    const scottUTCStr = scottEntry.timestamp?.toISOString().slice(11, 23) ?? 'N/A';
    const russUTCStr = russEntry.timestamp?.toISOString().slice(11, 23) ?? 'N/A';
    const utcDiff_ms = (scottEntry.timestamp && russEntry.timestamp)
      ? russEntry.timestamp.getTime() - scottEntry.timestamp.getTime()
      : NaN;

    console.log(
      scottEntry.timeOffset.toFixed(2).padStart(11) + '  ' +
      scottUTCStr.padEnd(15) + '  ' +
      russUTCStr.padEnd(15) + '  ' +
      (isNaN(utcDiff_ms) ? 'N/A' : utcDiff_ms.toFixed(0)).padStart(13) + '  │  ' +
      mToFt(dist2D).toFixed(1).padStart(12) + '  ' +
      mToFt(dist3D_m).toFixed(1).padStart(12) + '  ' +
      mToFt(dAlt_m).toFixed(1).padStart(9)
    );
  }

  // ── Section 3: Raw GPS sample dump ────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' SECTION 3: RAW GPS ENTRIES (every fix in the window, both jumpers)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  console.log('── scott ──');
  console.log(
    'seq'.padStart(5) + '  ' +
    'timeOff(s)'.padStart(11) + '  ' +
    'UTC'.padEnd(15) + '  ' +
    'lat'.padStart(12) + '  ' +
    'lon'.padStart(13) + '  ' +
    'alt_m(WGS84)'.padStart(13) + '  ' +
    'gndspd(kmph)'.padStart(13) + '  ' +
    'track(°T)'.padStart(10)
  );
  console.log('─'.repeat(100));

  for (const e of scottInWindow) {
    console.log(
      String(e.seq).padStart(5) + '  ' +
      e.timeOffset.toFixed(3).padStart(11) + '  ' +
      (e.timestamp?.toISOString().slice(11, 23) ?? 'N/A').padEnd(15) + '  ' +
      e.location!.lat_deg.toFixed(7).padStart(12) + '  ' +
      e.location!.lon_deg.toFixed(7).padStart(13) + '  ' +
      e.location!.alt_m.toFixed(2).padStart(13) + '  ' +
      (e.groundspeed_kmph?.toFixed(1) ?? 'N/A').padStart(13) + '  ' +
      (e.groundtrack_degT?.toFixed(1) ?? 'N/A').padStart(10)
    );
  }

  // Find russ's entries that span the same UTC time range
  const scottFirstUTC = scottInWindow[0].timestamp!.getTime();
  const scottLastUTC = scottInWindow[scottInWindow.length - 1].timestamp!.getTime();
  const russInWindow = russData.logEntries.filter(
    e => e.location !== null && e.timestamp !== null &&
      e.timestamp.getTime() >= scottFirstUTC - 1000 &&
      e.timestamp.getTime() <= scottLastUTC + 1000
  );

  console.log(`\n── russ (UTC-matched to scott's window ±1s) ──`);
  console.log(
    'seq'.padStart(5) + '  ' +
    'timeOff(s)'.padStart(11) + '  ' +
    'UTC'.padEnd(15) + '  ' +
    'lat'.padStart(12) + '  ' +
    'lon'.padStart(13) + '  ' +
    'alt_m(WGS84)'.padStart(13) + '  ' +
    'gndspd(kmph)'.padStart(13) + '  ' +
    'track(°T)'.padStart(10)
  );
  console.log('─'.repeat(100));

  for (const e of russInWindow) {
    console.log(
      String(e.seq).padStart(5) + '  ' +
      e.timeOffset.toFixed(3).padStart(11) + '  ' +
      (e.timestamp?.toISOString().slice(11, 23) ?? 'N/A').padEnd(15) + '  ' +
      e.location!.lat_deg.toFixed(7).padStart(12) + '  ' +
      e.location!.lon_deg.toFixed(7).padStart(13) + '  ' +
      e.location!.alt_m.toFixed(2).padStart(13) + '  ' +
      (e.groundspeed_kmph?.toFixed(1) ?? 'N/A').padStart(13) + '  ' +
      (e.groundtrack_degT?.toFixed(1) ?? 'N/A').padStart(10)
    );
  }

  // ── Section 4: Summary stats ──────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log(' SECTION 4: GPS SAMPLE RATE AROUND THE WINDOW');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Show the interval between consecutive fixes for each jumper
  for (const [name, entries] of [['scott', scottInWindow], ['russ', russInWindow]] as const) {
    const intervals: number[] = [];
    for (let i = 1; i < entries.length; i++) {
      intervals.push(entries[i].timeOffset - entries[i - 1].timeOffset);
    }
    if (intervals.length > 0) {
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const min = Math.min(...intervals);
      const max = Math.max(...intervals);
      console.log(`  ${name}: ${entries.length} fixes, interval avg=${(avg * 1000).toFixed(0)}ms, min=${(min * 1000).toFixed(0)}ms, max=${(max * 1000).toFixed(0)}ms (~${(1 / avg).toFixed(1)} Hz)`);
    }
  }

  // Show UTC timestamp intervals to check for clock anomalies
  console.log('\n── UTC timestamp intervals (ms between consecutive fixes) ──');
  for (const [name, entries] of [['scott', scottInWindow], ['russ', russInWindow]] as const) {
    const utcIntervals: number[] = [];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].timestamp && entries[i - 1].timestamp) {
        utcIntervals.push(entries[i].timestamp!.getTime() - entries[i - 1].timestamp!.getTime());
      }
    }
    if (utcIntervals.length > 0) {
      const avg = utcIntervals.reduce((a, b) => a + b, 0) / utcIntervals.length;
      console.log(`  ${name} UTC intervals: avg=${avg.toFixed(0)}ms, values=[${utcIntervals.map(v => v.toFixed(0)).join(', ')}]`);
    }
  }

  // ── Section 5: timeSinceMidnight_sec verification ───────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' SECTION 5: timeSinceMidnight_sec VERIFICATION');
  console.log(' (confirm that matching midnight times correspond to the same UTC instant)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  // Check that both devices have timeSinceMidnight_sec populated
  const scottWithMidnight = scottInWindow.filter(e => e.timeSinceMidnight_sec !== null);
  const russWithMidnight = russInWindow.filter(e => e.timeSinceMidnight_sec !== null);
  console.log(`  scott: ${scottWithMidnight.length}/${scottInWindow.length} entries have timeSinceMidnight_sec`);
  console.log(`  russ:  ${russWithMidnight.length}/${russInWindow.length} entries have timeSinceMidnight_sec`);

  if (scottWithMidnight.length > 0 && russWithMidnight.length > 0) {
    console.log('\n── Cross-device alignment at 1-second markers ──');
    console.log(
      'scott_t(s)'.padStart(11) + '  ' +
      'scott_midnight'.padStart(15) + '  ' +
      'russ_midnight'.padStart(15) + '  ' +
      'midnight_diff'.padStart(14) + '  │  ' +
      'dist_2D(ft)'.padStart(12) + '  ' +
      '(was_old)'.padStart(10) + '  ' +
      'improvement'.padStart(12)
    );
    console.log('─'.repeat(110));

    for (const scottEntry of scottAtSeconds) {
      if (scottEntry.timeSinceMidnight_sec === null) continue;
      const scottMid = scottEntry.timeSinceMidnight_sec;
      const scottLoc = scottEntry.location!;

      // Find russ entry nearest to scott's timeSinceMidnight_sec
      let bestRuss: typeof russData.logEntries[0] | undefined;
      let bestDist = Infinity;
      for (const e of russData.logEntries) {
        if (e.location === null || e.timeSinceMidnight_sec === null) continue;
        const d = Math.abs(e.timeSinceMidnight_sec - scottMid);
        if (d < bestDist) { bestDist = d; bestRuss = e; }
      }

      if (!bestRuss || !bestRuss.location || bestRuss.timeSinceMidnight_sec === null) continue;

      const russLoc = bestRuss.location;
      const dist2D_new = haversineDistance(scottLoc.lat_deg, scottLoc.lon_deg, russLoc.lat_deg, russLoc.lon_deg);

      // Old distance (same-timeOffset, for comparison)
      const oldRuss = findNearestWithLocation(russData.logEntries, scottEntry.timeOffset);
      const dist2D_old = oldRuss?.location
        ? haversineDistance(scottLoc.lat_deg, scottLoc.lon_deg, oldRuss.location.lat_deg, oldRuss.location.lon_deg)
        : NaN;

      const midDiff = (bestRuss.timeSinceMidnight_sec - scottMid) * 1000; // ms

      console.log(
        scottEntry.timeOffset.toFixed(2).padStart(11) + '  ' +
        scottMid.toFixed(3).padStart(15) + '  ' +
        bestRuss.timeSinceMidnight_sec.toFixed(3).padStart(15) + '  ' +
        (midDiff.toFixed(0) + 'ms').padStart(14) + '  │  ' +
        mToFt(dist2D_new).toFixed(1).padStart(12) + '  ' +
        (isNaN(dist2D_old) ? 'N/A' : mToFt(dist2D_old).toFixed(1)).padStart(10) + '  ' +
        (isNaN(dist2D_old) ? 'N/A' : (mToFt(dist2D_old) - mToFt(dist2D_new)).toFixed(1) + ' ft').padStart(12)
      );
    }
  } else {
    console.log('\n  ⚠ timeSinceMidnight_sec not populated — re-run after rebuilding the parser');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Done.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main();
