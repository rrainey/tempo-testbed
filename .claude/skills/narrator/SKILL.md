---
name: narrator
description: How to READ a jump-analysis report aloud and what to show while narrating — vocalization rules for TTS, voice/delivery settings, the findings→scenes grammar, capture recipes. Use when editing narration style, scene visuals, or debugging TTS pronunciation. What gets reported is the jump-analyst skill's job, not this one's.
---

# Narrator — presentation of a prepared findings report

The narrator renders a `findings.json` report (produced by the **jump-analyst**
stage — see that skill) as speech plus visuals. It decides *how* things are
said and shown, never *what* is reported: it must not add, drop, reorder, or
re-judge findings. Pipeline: `tools/jump-review/make-review.js`.

## Vocalization rules

**Never hand the TTS a raw figure like `13,590 ft AGL`.** Analyst statements
arrive as written English with digits; convert at the narrator boundary with
`speakify()` from `tools/jump-review/vocalize.js` — the code is the source
of truth for house style:

| Written (analyst) | Spoken (narrator) |
|---|---|
| 13,590 ft AGL | thirteen-thousand, five-hundred and ninety feet |
| 2,430 ft AGL | two-thousand, four-hundred and thirty feet |
| 134 mph | one-hundred and thirty-four miles per hour |
| 65 seconds | sixty-five seconds |
| 2.3 g | two point three gees |
| 3.75 g | three point seven five gees |
| 40 meters | forty meters |

- Altitudes round to the nearest 10 ft and **drop "AGL"** (only formal
  contexts speak "above ground level" — `vocalizeAltitudeFt(x, {formal:true})`).
- Acceleration readings are spoken as "gees" with decimal digits spelled out
  individually ("3.75 g" → "three point seven five gees", never "seventy-five").
- Times of day stay as digits ("11:28 AM"), always DZ-local, say "local time".
- Capitalize a vocalized phrase that begins a sentence.

## Voice & delivery

- **Kokoro `bm_daniel`** (British male), `lang: en-gb`, `speed: 0.95`, via
  `tools/jump-review/kokoro_say.py`. Chosen by Riley 2026-07-14.
- `attention`-severity findings get a spoken cue ("Worth your attention: …");
  `notable` and `normal` are read plainly. Severity affects delivery only —
  the judgment itself came from the analyst.
- Report caveats are read last, prefixed "One note on data quality."

## Scene grammar (findings → visuals)

- Scene 1 is always the logbook intro, built from the report's `logbook`
  block over the logbook-card capture.
- Remaining findings group into one scene per `evidence.chart`, in
  first-appearance order. Capture recipes live in the `CAPTURES` map:
  `logbook-card | altitude-profile | fall-rate | imu | flight-path`. The
  flight-path capture inherits the web map's descent-focused framing and the
  blue landing-area demarcation (`LANDING_AREA_STYLE` in tempo-core) —
  the same view the jumper sees on the site.
- Scene duration = narration audio length + 1 s; Ken Burns zoom over a 2×
  still, 0.4 s fades. Planned: a `clip` capture kind (live scrubber-sweep
  recordings) and burned-in captions from the narration text.

## Gotchas

- `kokoro_say.py` monkeypatches `espeakng-loader` to the system espeak-ng
  1.51 data (the wheel's data lacks `phontab`); `apt install espeak-ng-data`
  on a new machine.
- Model files (~350 MB) are gitignored under `tools/jump-review/models/` —
  download commands in the README.
- The testbed dev server must be running; captures drive the real jumper
  page headlessly.
