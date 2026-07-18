#!/usr/bin/env node
// tools/jump-review/analyze-jump.js — the ANALYST stage.
//
// Decides WHAT matters about a jump and emits findings.json (schema and
// judgment thresholds: .claude/skills/jump-analyst/SKILL.md). Contains no
// presentation: statements are written English with digits; the narrator
// stage vocalizes and frames them.
//
// Usage: node analyze-jump.js [testCaseId] [jumperName]   -> out/findings.json
// Also usable as a module: const { buildFindings } = require('./analyze-jump')

const fs = require('fs');
const path = require('path');
const { haversineMeters, findContainingPolygon } = require('./geo');

const OUT = path.join(__dirname, 'out');

const fmtFt = f => `${(Math.round(f / 10) * 10).toLocaleString('en-US')} ft`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = xs => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) * (x - m))));
};

/** Peak of a {timestamp,value} series inside [t0, t1]; null if no samples. */
function peakIn(series, t0, t1) {
  let peak = null;
  for (const p of series) {
    if (p.timestamp >= t0 && p.timestamp <= t1 && Number.isFinite(p.value)) {
      if (peak === null || p.value > peak) peak = p.value;
    }
  }
  return peak;
}

async function buildFindings(caseId, jumper) {
  const analyze = await (await fetch('http://localhost:3000/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testCaseId: caseId, jumperName: jumper }),
  })).json();
  if (analyze.error) throw new Error(`analyze failed: ${analyze.error}`);
  const tc = (await (await fetch(`http://localhost:3000/api/testcases/${caseId}`)).json()).testCase;
  const ev = analyze.events;
  const ts = analyze.timeSeries;
  const dz = tc.metadata.dropzone;
  const G = 9.81;

  const findings = [];
  const caveats = [];

  // ── preflight ─────────────────────────────────────────────────────────
  const hasExit = ev.exitOffsetSec != null;
  if (!hasExit) caveats.push('No exit detected — times are from log start, jump-phase findings omitted.');
  if (!ts.hasGPS) caveats.push('No GNSS data — speed and path findings omitted.');
  if (hasExit && ts.hasGPS) {
    const jump = ts.gps.filter(p => p.timestamp >= ev.exitOffsetSec && p.timestamp <= (ev.landingOffsetSec ?? Infinity));
    let maxGap = 0;
    for (let i = 1; i < jump.length; i++) maxGap = Math.max(maxGap, jump[i].timestamp - jump[i - 1].timestamp);
    if (maxGap > 5) caveats.push(`GNSS gap of ${maxGap.toFixed(1)} s inside the jump — path findings degraded.`);
  }

  // ── logbook header ────────────────────────────────────────────────────
  const exitUTC = ev.exitTimestampUTC ? new Date(ev.exitTimestampUTC) : null;
  const logbook = {
    dateLocal: exitUTC ? new Intl.DateTimeFormat('en-US', { timeZone: dz.timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(exitUTC) : null,
    timeLocal: exitUTC ? new Intl.DateTimeFormat('en-US', { timeZone: dz.timezone, hour: 'numeric', minute: '2-digit' }).format(exitUTC) : null,
    location: dz.name.replace(/\s*\(/, ', ').replace(/\)/, ''),
    exitAltitudeFt: ev.exitAltitudeFt ?? null,
    freefallSec: hasExit && ev.deploymentOffsetSec != null ? ev.deploymentOffsetSec - ev.exitOffsetSec : null,
    deployAltitudeFt: ev.deployAltitudeFt ?? null,
  };

  // ── freefall ──────────────────────────────────────────────────────────
  if (hasExit && ev.maxDescentRateFpm != null) {
    const maxMph = Math.round(ev.maxDescentRateFpm / 88);
    let stabilityNote = '';
    let sev = 'normal';
    const win = analyze.velocitySummary?.analysisWindow;
    if (analyze.fallRateSeries && win) {
      const rates = analyze.fallRateSeries
        .filter(p => p.time >= win.startOffset && p.time <= win.endOffset && p.raw_mph != null)
        .map(p => p.raw_mph);
      if (rates.length > 10) {
        const avg = Math.round(mean(rates));
        const sd = std(rates);
        stabilityNote = ` Average fall rate ${avg} mph` +
          (sd > 8 ? `, varying by ${Math.round(sd)} mph across the window.` : ', held steady.');
        if (sd > 8) sev = 'notable';
      }
    }
    findings.push({
      id: 'freefall',
      severity: sev,
      statement: `Freefall peaked at ${maxMph} mph.${stabilityNote}`,
      values: { maxDescentRateFpm: ev.maxDescentRateFpm },
      evidence: { chart: 'fall-rate' },
      provenance: 'events.maxDescentRateFpm; fallRateSeries std over velocitySummary.analysisWindow',
    });
  }

  // ── fall-rate distribution (raw vs density-calibrated) ────────────────
  const vs = analyze.velocitySummary;
  if (hasExit && vs?.raw?.totalAnalysisTime > 0 && vs?.calibrated) {
    const raw = Math.round(vs.raw.averageFallRate);
    const cal = Math.round(vs.calibrated.averageFallRate);
    // Average-jumper reference range: FALL_RATE_AVG_MIN/MAX (tempo-core constants.ts)
    const [lo, hi] = [115, 125];
    let rangePart = 'inside the 115 to 125 mph average-jumper range';
    let sev = 'normal';
    if (cal < lo) { rangePart = `${lo - cal} mph slower than the 115 to 125 mph average-jumper range`; sev = 'notable'; }
    else if (cal > hi) { rangePart = `${cal - hi} mph faster than the 115 to 125 mph average-jumper range`; sev = 'notable'; }
    findings.push({
      id: 'fall-rate-distribution',
      severity: sev,
      statement: `Corrected for air density, average fall rate was ${cal} mph against ${raw} mph raw — ${rangePart}.`,
      values: { rawAverageFallRateMph: vs.raw.averageFallRate,
                calibratedAverageFallRateMph: vs.calibrated.averageFallRate },
      evidence: { chart: 'fall-rate-distribution' },
      provenance: 'velocitySummary.raw/calibrated.averageFallRate over analysisWindow; range FALL_RATE_AVG_MIN/MAX (tempo-core constants.ts)',
    });
  }

  // ── deployment ────────────────────────────────────────────────────────
  if (ev.deploymentOffsetSec != null && ev.deployAltitudeFt != null) {
    const alt = ev.deployAltitudeFt;
    const sev = alt < 2500 ? 'attention' : alt < 3000 ? 'notable' : 'normal';
    const after = hasExit ? `, ${Math.round(ev.deploymentOffsetSec - ev.exitOffsetSec)} seconds after exit` : '';
    findings.push({
      id: 'deployment-altitude',
      severity: sev,
      statement: `Deployed at ${fmtFt(alt)}${after}.` +
        (sev === 'attention' ? ' That is below the 2,500 ft C and D license floor.' : ''),
      values: { deployAltitudeFt: alt },
      evidence: { chart: 'altitude-profile' },
      provenance: 'events.deployAltitudeFt (EventDetector.detectDeployment)',
    });

    const openPeakMps2 = peakIn(ts.acceleration, ev.deploymentOffsetSec, ev.deploymentOffsetSec + 5);
    if (openPeakMps2 != null) {
      const g = openPeakMps2 / G;
      const sevG = g > 5 ? 'attention' : g > 3.5 ? 'notable' : 'normal';
      findings.push({
        id: 'opening-shock',
        severity: sevG,
        statement: `Opening peaked at ${g.toFixed(1)} g` +
          (sevG === 'attention' ? ' — a hard opening.' : sevG === 'notable' ? ' — brisk but unremarkable.' : '.'),
        values: { openingPeakG: g },
        evidence: { chart: 'imu' },
        provenance: 'peak of timeSeries.acceleration over [deploy, deploy+5s]',
      });
    }
  }

  // ── opening anomalies (off-heading, line twist — torso-yaw based) ─────
  // The GNSS map is the natural evidence for both (heading swings and the
  // spin show in the ground track); fall back to the IMU chart without GPS.
  const op = analyze.torso?.opening;
  const openingChart = ts.hasGPS ? 'flight-path' : 'imu';
  if (op?.determinate && op.offHeadingOpening && op.offHeading_deg != null) {
    const d = Math.round(op.offHeading_deg);
    const [phrase, sev] =
      d > 120 ? [`, reversing the jumper's ground track`, 'attention'] :
      d >= 50 ? [' — a pronounced off-heading opening', 'notable'] :
                [' — a notable off-heading opening', 'notable'];
    findings.push({
      id: 'off-heading-opening',
      severity: sev,
      statement: `The canopy opened ${d} degrees off heading${phrase}.`,
      values: { offHeadingDeg: op.offHeading_deg,
                freefallHeadingDegT: op.freefallHeading_degT ?? null,
                canopyHeadingDegT: op.canopyHeading_degT ?? null },
      evidence: { chart: openingChart },
      provenance: 'torso.opening.offHeading_deg = |wrap180(canopyHeading − freefallHeading)| (opening-anomalies.ts)',
    });
  }
  if (op && op.lineTwist !== 'none') {
    const aggressive = op.lineTwist === 'aggressive';
    findings.push({
      id: 'line-twist',
      severity: aggressive ? 'attention' : 'notable',
      statement: `${aggressive ? 'Aggressive line' : 'Line'} twists on opening — ` +
        `${Math.round(op.yawExcursion_deg)} degrees of yaw under a peak load of ${op.peakLoad_g.toFixed(1)} g.`,
      values: { lineTwist: op.lineTwist, yawExcursionDeg: op.yawExcursion_deg, peakLoadG: op.peakLoad_g },
      evidence: { chart: openingChart },
      provenance: 'torso.opening.lineTwist/yawExcursion_deg/peakLoad_g (opening-anomalies.ts §line twist)',
    });
  }

  // ── landing area (dropzone polygons, resolved by proximity) ───────────
  if (ev.landingOffsetSec != null && ts.hasGPS && ts.gps.length > 0) {
    const la = await (await fetch(`http://localhost:3000/api/testcases/${caseId}/landing-areas`)).json();
    if (la.landingAreas) {
      const fix = ts.gps.reduce((best, p) =>
        Math.abs(p.timestamp - ev.landingOffsetSec) < Math.abs(best.timestamp - ev.landingOffsetSec) ? p : best);
      const area = findContainingPolygon(la.landingAreas, fix.longitude, fix.latitude);
      if (area) {
        const cls = area.properties.class;
        const sev = cls === 'hazard' ? 'attention' : (cls === 'swoop' || cls === 'alternate') ? 'notable' : 'normal';
        const target = (la.landingAreas.features ?? []).find(f =>
          f.geometry?.type === 'Point' && f.properties?.kind === 'target' &&
          f.properties?.area === area.properties.name);
        let targetPart = '';
        if (target) {
          const [tLon, tLat] = target.geometry.coordinates;
          const dist = Math.round(haversineMeters(fix.latitude, fix.longitude, tLat, tLon));
          targetPart = `, ${dist} meters from the target`;
        }
        findings.push({
          id: 'landing-area',
          severity: sev,
          statement: `Landed in the ${area.properties.name}${targetPart}.` +
            (cls === 'hazard' ? ' That area is briefed as a hazard.' : ''),
          values: { landingArea: area.properties.name, landingAreaClass: cls,
                    landingLat: fix.latitude, landingLon: fix.longitude },
          evidence: { chart: 'flight-path' },
          provenance: 'GPS fix nearest events.landingOffsetSec vs dropzones landing-areas.geojson (point-in-polygon)',
        });
      } else {
        findings.push({
          id: 'landing-area',
          severity: 'notable',
          statement: 'Touched down outside the mapped landing areas.',
          values: { landingLat: fix.latitude, landingLon: fix.longitude },
          evidence: { chart: 'flight-path' },
          provenance: 'GPS fix nearest events.landingOffsetSec; no containing polygon in landing-areas.geojson',
        });
      }
    }
  }

  // ── landing ───────────────────────────────────────────────────────────
  if (ev.landingOffsetSec != null) {
    const after = hasExit ? `${Math.round(ev.landingOffsetSec - ev.exitOffsetSec)} seconds after exit` : `at ${ev.landingOffsetSec.toFixed(0)} s into the log`;
    const peakMps2 = peakIn(ts.acceleration, ev.landingOffsetSec - 1, ev.landingOffsetSec + 3);
    const g = peakMps2 != null ? peakMps2 / G : null;
    const sev = g != null && g > 5 ? 'attention' : 'normal';
    findings.push({
      id: 'landing',
      severity: sev,
      statement: `Touchdown ${after}` +
        (g != null ? `, with a landing impulse of ${g.toFixed(1)} g${sev === 'attention' ? ' — a hard landing' : ''}.` : '.'),
      values: { landingOffsetSec: ev.landingOffsetSec, landingPeakG: g },
      evidence: { chart: 'imu' },
      provenance: 'events.landingOffsetSec (IMU-refined); peak of acceleration over [landing-1s, landing+3s]',
    });
  }

  // ── landing profile (final approach → touchdown, closes the review) ───
  if (ev.landingOffsetSec != null && ts.hasGPS) {
    const tL = ev.landingOffsetSec;
    // availability floor mirrors the Landing Flare Profile chart (buildFlareProfile)
    const fixes = ts.gps.filter(p => p.timestamp >= tL - 18 && p.timestamp <= tL + 2);
    if (fixes.length >= 8) {
      const KMPH_TO_MPH = 0.621371; // VTG groundspeed arrives in km/h; speak statute mph
      const spd = ps => {
        const v = ps.map(p => p.groundspeed_kmph).filter(x => x != null && Number.isFinite(x));
        return v.length ? mean(v) * KMPH_TO_MPH : null;
      };
      const approach = spd(fixes.filter(p => p.timestamp >= tL - 12 && p.timestamp <= tL - 6));
      const touchdown = spd(fixes.filter(p => Math.abs(p.timestamp - tL) <= 1));
      if (approach != null && touchdown != null) {
        const a = Math.round(approach);
        const t = Math.round(touchdown);
        findings.push({
          id: 'landing-profile',
          severity: 'normal',
          statement: `On final approach, groundspeed averaged ${a} mph, ` +
            (t < a ? `slowing to ${t} mph at touchdown.` : `${t} mph at touchdown.`),
          values: { approachGroundspeedMph: approach, touchdownGroundspeedMph: touchdown },
          evidence: { chart: 'landing-profile' },
          provenance: 'mean GNSS VTG groundspeed over [landing-12s, landing-6s] and [landing±1s] (statute mph)',
        });
      }
    }
  }

  // attention findings must not be buried: stable-sort them ahead of later normals
  // while preserving chronology otherwise (already chronological here).

  return {
    case: caseId, jumper,
    generatedAt: new Date().toISOString(),
    logbook, findings, caveats,
  };
}

module.exports = { buildFindings };

if (require.main === module) {
  const caseId = process.argv[2] || '08-solo-bb-20260703';
  const jumper = process.argv[3] || 'bb';
  buildFindings(caseId, jumper).then(report => {
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, 'findings.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`${file}: ${report.findings.length} findings, ${report.caveats.length} caveats`);
    for (const f of report.findings) console.log(` [${f.severity}] ${f.statement}`);
  }).catch(e => { console.error(e); process.exit(1); });
}
