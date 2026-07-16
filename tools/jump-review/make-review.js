#!/usr/bin/env node
// tools/jump-review/make-review.js — the NARRATOR stage.
//
// Renders a findings report (from analyze-jump.js, the analyst stage) as a
// narrated video: statements are speakified into house style, findings are
// grouped into scenes by their evidence chart, captures are framed, Kokoro
// voices each scene, and ffmpeg assembles the result. This stage decides HOW
// things are said and shown — never WHAT is reported (that is the analyst's
// job; see .claude/skills/jump-analyst and .claude/skills/narrator).
//
// Usage: node make-review.js [testCaseId] [jumperName]
//   -> out/findings.json, out/scenes.json, out/jump-review.mp4
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildFindings } = require('./analyze-jump');
const { vocalizeAltitudeFt, vocalizeSeconds, speakify } = require('./vocalize');

const BASE = __dirname;
const OUT = path.join(BASE, 'out');
const VOICE = 'bm_daniel'; // kokoro voice id (see kokoro_say.py)
const KOKORO = [path.join(BASE, 'venv/bin/python'), path.join(BASE, 'kokoro_say.py')];
const CASE_ID = process.argv[2] || '08-solo-bb-20260703';
const JUMPER = process.argv[3] || 'bb';
const FPS = 30;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// evidence.chart -> capture recipe (the narrator's scene grammar)
const CAPTURES = {
  'logbook-card': { kind: 'region', anchorTop: '[data-testid="logbook-summary"]', anchorBottomText: 'Max Descent' },
  'altitude-profile': { kind: 'element', titleText: 'Altitude Profile' },
  'fall-rate': { kind: 'element', titleText: 'Fall Rate vs Time' },
  'imu': { kind: 'element', titleText: 'IMU Acceleration' },
  'flight-path': { kind: 'element', titleText: 'Flight Path' },
};

/** Findings -> scenes: opening logbook scene, then one scene per evidence
 *  chart in first-appearance order; attention findings get a spoken cue. */
function buildScenes(report) {
  const scenes = [];

  const lb = report.logbook;
  const intro = [
    `Jump review for ${report.jumper}.`,
    lb.dateLocal ? `${lb.dateLocal}, at ${lb.location}.` : `At ${lb.location}.`,
    lb.timeLocal && lb.exitAltitudeFt != null
      ? `Exit at ${lb.timeLocal} local time, from ${vocalizeAltitudeFt(lb.exitAltitudeFt)}.` : '',
    lb.freefallSec != null && lb.deployAltitudeFt != null
      ? `${cap(vocalizeSeconds(lb.freefallSec))} of freefall, deploying at ${vocalizeAltitudeFt(lb.deployAltitudeFt)}.` : '',
  ].filter(Boolean).join(' ');
  scenes.push({ id: 'logbook', narration: intro, capture: CAPTURES['logbook-card'] });

  const byChart = new Map();
  for (const f of report.findings) {
    const chart = f.evidence?.chart ?? 'altitude-profile';
    if (!byChart.has(chart)) byChart.set(chart, []);
    byChart.get(chart).push(f);
  }
  for (const [chart, findings] of byChart) {
    if (!CAPTURES[chart]) continue;
    const narration = findings
      .map(f => (f.severity === 'attention' ? 'Worth your attention: ' : '') + speakify(f.statement))
      .join(' ');
    scenes.push({ id: chart, narration, capture: CAPTURES[chart] });
  }

  if (report.caveats.length > 0) {
    scenes.push({
      id: 'caveats',
      narration: 'One note on data quality. ' + report.caveats.map(speakify).join(' '),
      capture: CAPTURES['logbook-card'],
    });
  }
  return scenes;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // ── 1. analyst stage: the findings report ───────────────────────────────
  const report = await buildFindings(CASE_ID, JUMPER);
  fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(report, null, 2));

  // ── 2. narrator stage: scenes from findings ─────────────────────────────
  const scenes = buildScenes(report);
  fs.writeFileSync(path.join(OUT, 'scenes.json'),
    JSON.stringify({ case: CASE_ID, jumper: JUMPER, voice: VOICE, scenes }, null, 2));

  // ── 3. capture stills at 2x ─────────────────────────────────────────────
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 2400 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:3000/testcase/${CASE_ID}/jumper/${encodeURIComponent(JUMPER)}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run Analysis' }).click();
  await page.waitForSelector('[data-testid="logbook-summary"]', { timeout: 30000 });
  await page.waitForTimeout(2500);

  for (const scene of scenes) {
    const file = path.join(OUT, `${scene.id}.png`);
    if (scene.capture.kind === 'region') {
      const top = await page.locator(scene.capture.anchorTop).boundingBox();
      const bottomEl = page.getByText(scene.capture.anchorBottomText).first()
        .locator('xpath=ancestor::*[contains(@class,"mantine-Card-root")][1]');
      const bottom = await bottomEl.boundingBox();
      await page.screenshot({ path: file, clip: {
        x: top.x - 6, y: top.y - 6,
        width: top.width + 12, height: (bottom.y + bottom.height) - top.y + 12,
      }});
    } else {
      const el = page.getByText(scene.capture.titleText).first()
        .locator('xpath=ancestor::*[contains(@class,"mantine-Card-root")][1]');
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const box = await el.boundingBox();
      await page.screenshot({ path: file, clip: box });
    }
    console.log('captured', scene.id);
  }
  await browser.close();

  // ── 4. narration WAVs ───────────────────────────────────────────────────
  for (const scene of scenes) {
    execFileSync(KOKORO[0], [KOKORO[1], VOICE, path.join(OUT, `${scene.id}.wav`)],
      { input: scene.narration });
    console.log('spoke', scene.id);
  }

  // ── 5. per-scene clips: Ken Burns over the still, faded, audio-timed ────
  for (const scene of scenes) {
    const wav = path.join(OUT, `${scene.id}.wav`);
    const dur = parseFloat(run('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav])) + 1.0;
    const frames = Math.round(dur * FPS);
    const vf =
      // fit-within scaling handles both wide cards and the tall square-map card
      `scale=1904:1064:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x09090b,` +
      `zoompan=z='min(1.0+0.10*on/${frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${FPS},` +
      `fade=t=in:st=0:d=0.4,fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5,format=yuv420p`;
    run('ffmpeg', ['-y', '-i', path.join(OUT, `${scene.id}.png`), '-i', wav,
      '-filter_complex', `[0:v]${vf}[v];[1:a]adelay=400|400,apad,afade=t=out:st=${(dur - 0.4).toFixed(2)}:d=0.4[a]`,
      '-map', '[v]', '-map', '[a]', '-t', dur.toFixed(2),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-ar', '24000',
      path.join(OUT, `${scene.id}.mp4`)]);
    console.log('rendered', scene.id, `${dur.toFixed(1)}s`);
  }

  // ── 6. concat ───────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(OUT, 'list.txt'), scenes.map(s => `file '${s.id}.mp4'`).join('\n'));
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'list.txt'), '-c', 'copy',
    path.join(OUT, 'jump-review.mp4')]);
  const total = run('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0',
    path.join(OUT, 'jump-review.mp4')]).toString().trim();
  console.log(`DONE: ${path.join(OUT, 'jump-review.mp4')} (${parseFloat(total).toFixed(1)}s)`);
}

main().catch(e => { console.error(e); process.exit(1); });
