# jump-review — narrated video walk-through generator

Produces a per-jumper MP4 review of a test case in two separated stages:

1. **Analyst** (`analyze-jump.js`, skill: `jump-analyst`) — decides *what*
   matters: runs the data-quality preflight, applies judgment thresholds, and
   emits `out/findings.json` (ordered findings with severity, evidence
   pointers, and provenance).
2. **Narrator** (`make-review.js`, skill: `narrator`) — decides *how* it is
   said and shown: speakifies statements into house style (`vocalize.js`),
   groups findings into scenes by evidence chart, captures the rendered
   jumper page, voices each scene with Kokoro, and assembles with ffmpeg.

```
analyze API ─► analyze-jump.js ─► out/findings.json ─► make-review.js ─► out/scenes.json
                                                             │  Kokoro TTS per scene
                              Playwright 2× stills ──────────┴─► ffmpeg ─► out/jump-review.mp4
```

Scene duration is derived from each scene's narration length, so timing never
needs manual sync. `analyze-jump.js` also runs standalone to inspect the
report without rendering video.

## One-time setup

```bash
# Python venv for Kokoro TTS (Apache-2.0, local, CPU-only)
python3 -m venv venv
venv/bin/pip install kokoro-onnx soundfile

# model + voices (~350 MB, gitignored)
mkdir -p models
curl -L -o models/kokoro-v1.0.onnx \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o models/voices-v1.0.bin \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

# system espeak-ng data (phonemizer backend; see note below)
sudo apt install espeak-ng-data libespeak-ng1

# browsers for capture (repo devDependency `playwright`)
npx playwright install chromium
```

> **espeak note:** the `espeakng-loader` wheel that kokoro-onnx depends on
> ships incomplete espeak data (no `phontab`) with a baked build path.
> `kokoro_say.py` works around it by pointing the loader at the system
> espeak-ng 1.51 library + data pair.

## Usage

```bash
# testbed dev server must be running on localhost:3000
node make-review.js 08-solo-bb-20260703 bb
# -> out/jump-review.mp4 (plus out/scenes.json, per-scene stills/WAVs/MP4s)
```

Voice: Kokoro `bm_daniel` (British male), set in `make-review.js` and recorded
in `out/scenes.json`. Audition alternatives with:

```bash
echo "Exit at 13,630 feet." | venv/bin/python kokoro_say.py bm_george /tmp/sample.wav
```

## Status

Prototype (2026-07-15): two scenes (logbook, altitude overview). Planned:
freefall zoom via live scrubber-sweep capture, deployment IMU close-up, GNSS
map descent scene, burned-in captions from the narration text.
