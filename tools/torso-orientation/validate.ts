// tools/torso-orientation/validate.ts
//
// Corpus validation for the torso-orientation calibration in @tempo/core
// (analysis/torso-orientation.ts). Parses a flight log, runs event detection,
// calibrates the pocket transform + AHRS yaw offset over a quiet canopy
// window, and prints torso attitude at key phases of the jump.
//
// Run (from tempo-testbed/):
//   npm run torso-validate -- test-data/08-solo-bb-20260703/bb/flight.txt
//
// Acceptance heuristics (firmware >= 1.2.0 / log version >= 112):
//   - tiltResidual and quatGravityAgreement small (< ~10 deg)
//   - quatConvention = sensor-to-earth
//   - freefall mean pitch strongly negative (belly-ish; the harness-recline
//     reference and body arch keep it above -90)
// Firmware 1.0.0 (110) logs use an incompatible AHRS and will show a large
// tiltResidual — that flag means "do not trust the attitude series".

import * as fs from 'fs';
import {
  LogParser, EventDetector,
  estimateTorsoCalibration, torsoAttitudeSeries,
  ImuSample, TrackSample, QuatSample, TorsoAttitude,
} from '@tempo/core';

const logPath = process.argv[2];
if (!logPath) { console.error('usage: validate <flight.txt>'); process.exit(1); }

const data = LogParser.parseLog(fs.readFileSync(logPath));
const events = EventDetector.analyzeJump(data);

const exit = events.exitOffsetSec;
const deploy = events.deploymentOffsetSec;
const landing = events.landingOffsetSec;
console.log(`log: ${logPath}`);
console.log(`events: exit=${exit?.toFixed(1)} deploy=${deploy?.toFixed(1)} landing=${landing?.toFixed(1)}`);
if (exit === undefined || deploy === undefined || landing === undefined) {
  console.error('missing events; cannot pick calibration intervals'); process.exit(1);
}

const imu: ImuSample[] = data.imuPackets
  .filter(p => p.timeOffset !== undefined)
  .map(p => ({
    t: p.timeOffset!,
    ax: p.accX_mps2, ay: p.accY_mps2, az: p.accZ_mps2,
    gx: p.rotX_rps, gy: p.rotY_rps, gz: p.rotZ_rps,
  }));
const track: TrackSample[] = data.gps
  .filter(p => p.groundTrack_degT !== undefined && p.groundspeed_kmph !== undefined)
  .map(p => ({ t: p.timestamp, track_degT: p.groundTrack_degT!, speed_mps: p.groundspeed_kmph! / 3.6 }));
const quat: QuatSample[] = data.im2Packets
  .filter(p => p.timeOffset !== undefined)
  .map(p => ({ t: p.timeOffset!, w: p.q0, x: p.q1, y: p.q2, z: p.q3 }));

console.log(`streams: imu=${imu.length} track=${track.length} quat=${quat.length}`);

// Calibration search: mid-canopy, clear of the opening and the landing pattern.
const cal = estimateTorsoCalibration(imu, track, quat, deploy + 20, landing - 8, {
  freefall: [exit + 8, deploy - 5],
});
if (!cal) { console.error('calibration failed (no qualifying window)'); process.exit(1); }

const w = cal.window;
console.log('\n--- calibration ---');
console.log(`window: ${w.t0.toFixed(1)}..${w.t1.toFixed(1)} s  score=${w.score.toFixed(3)}`);
console.log(`  |f| mean=${w.stats.fMagMean_mps2.toFixed(3)} m/s²  std=${w.stats.fMagStd_mps2.toFixed(3)}`);
console.log(`  gyro RMS=${w.stats.gyroRms_rps.toFixed(4)} rad/s  trackStd=${w.stats.trackStd_deg.toFixed(2)}°`);
console.log(`  mean track=${w.meanTrack_degT.toFixed(1)}°T  speed=${w.meanSpeed_mps.toFixed(1)} m/s`);
console.log(`forwardSign=${cal.forwardSign}  quatConvention=${cal.quatConvention}  yawOffset=${cal.yawOffset_deg.toFixed(1)}°`);
console.log(`tiltResidual=${cal.tiltResidual_deg.toFixed(2)}°  quatGravityAgreement=${cal.quatGravityAgreement_deg.toFixed(2)}°`);
if (cal.tiltResidual_deg > 15) {
  console.log('!! large tilt residual — attitude series unreliable (old firmware or bad window)');
}

const att = torsoAttitudeSeries(quat, cal);
const at = (t: number) => att.reduce((b, a) => (Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b));
const fmt = (a: TorsoAttitude) =>
  `t=${a.t.toFixed(1).padStart(7)}  roll=${a.roll_deg.toFixed(1).padStart(7)}  pitch=${a.pitch_deg.toFixed(1).padStart(7)}  yaw=${a.yaw_degT.toFixed(1).padStart(6)}°T`;

console.log('\n--- torso attitude at key phases ---');
console.log(`aircraft (exit-60s):   ${fmt(at(exit - 60))}`);
console.log(`aircraft (exit-15s):   ${fmt(at(exit - 15))}`);
for (const dt of [5, 10, 20, 30, 40]) {
  if (exit + dt < deploy) console.log(`freefall (exit+${dt}s):   ${fmt(at(exit + dt))}`);
}
console.log(`canopy (cal window):   ${fmt(at((w.t0 + w.t1) / 2))}`);

const ffAtt = att.filter(a => a.t > exit + 8 && a.t < deploy - 5);
const meanPitch = ffAtt.reduce((s, a) => s + a.pitch_deg, 0) / ffAtt.length;
console.log(`\nfreefall mean pitch (${ffAtt.length} samples): ${meanPitch.toFixed(1)}°  (belly-to-earth ≈ -90°)`);

console.log('\n--- final approach & flare (1 s cadence) ---');
for (let t = Math.ceil(landing - 20); t <= landing + 2; t++) {
  console.log(fmt(at(t)));
}
