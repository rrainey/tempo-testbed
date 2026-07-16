---
name: jump-analyst
description: How to analyze a jump and prepare a findings report — per-phase focus checklist, judgment thresholds, data-quality preflight, and the findings.json contract consumed by the narrator. Use when deciding WHAT to examine or report about a jump, adding analysis findings/tools, or reviewing detector output for a jumper.
---

# Jump analyst — what to look at, and what makes it a finding

The analyst decides **what matters** about a jump and emits a structured
report; presentation (speech, visuals) belongs entirely to the `narrator`
skill. The two meet only at `findings.json` (schema below), produced by
`tools/jump-review/analyze-jump.js`.

## The provenance rule (non-negotiable)

Every number in a finding comes from the analysis pipeline — a named field of
the analyze result or a computation over its series, recorded in the
finding's `provenance`. Never estimate, never restate a figure the data
doesn't support. If a value can't be derived, the finding is omitted and a
caveat says why. (Background on how the events themselves are detected:
`tempo-core/docs/event-algorithms.md`.)

## Data-quality preflight (run before asserting anything)

- **Exit detection basis** — if `events.exitOffsetSec` is missing, all
  jump-relative statements are off the table; report in log time with a
  caveat. (The detector's `$PST`-fallback path deserves a caveat even when
  present — see the algorithms paper.)
- **GNSS coverage** — `timeSeries.hasGPS`; gaps > 5 s inside the jump window
  degrade groundspeed/path findings.
- **Baro vs GNSS agreement** — mean |baro − GNSS| altitude over the jump
  > ~150 ft suggests surface-pressure drift; flag altitude findings.
- **Sentence corruption** — the reader counts rejected NMEA sentences
  (`rejectedSentenceCount`); *tool gap:* not yet surfaced through the
  analyze API. Expose it, then caveat any log where it is nonzero.

## Per-phase focus checklist

**Exit** — altitude (vs. typical for the aircraft/DZ); departure-edge
quality; on formations: door order and per-jumper separation (needs the
UTC-aligned formation timeline — future work).

**Freefall** — duration; average and peak fall rate; fall-rate *stability*
(std dev of the raw series inside the analysis window — a wide spread on a
solo suggests drills or instability; on RW it may just be the dive plan);
time to terminal.

**Deployment** — altitude margin (see thresholds); snivel duration
(deployment→activation; *tool gap:* `activationOffsetSec` is computed by
`detectDeployment` but not yet exported in `JumpEvents`); opening-shock peak
g over `[deploy, deploy+5 s]` of the acceleration series.

**Canopy** — average descent rate mid-flight; pattern shape from the GNSS
path; turn count/rates (*tool gap:* gyro data is parsed but unused).

**Landing** — touchdown time after exit; landing impulse character over
`[landing−1 s, landing+3 s]` (stand-up vs. slide vs. hard); **landing area**:
point-in-polygon of the GPS fix nearest `landingOffsetSec` against the DZ's
named areas, plus distance to the area's target when one exists.

## Landing areas (per-dropzone polygons)

- File: `test-data/dropzones/<dz>/landing-areas.geojson`, resolved per test
  case **by proximity** to the case's dropzone coordinates (within 15 km) via
  `/api/testcases/[id]/landing-areas` — no per-case configuration.
- Schema: Polygon features with `kind: "area"`, `name`, `class`
  (`student | main | alternate | swoop | hazard`), `license` (array of USPA
  tiers permitted, e.g. `["student","A","B","C","D"]`); Point features with
  `kind: "target"`, `name`, `area` (the containing area's name — kept inside
  its polygon so containment and the explicit link agree). Drawn/edited in
  geojson.io; normalize LineStrings to closed Polygons on import.
- Severity: `hazard` → attention (say so plainly); `swoop`/`alternate` →
  notable; `main`/`student` → normal; outside every polygon → notable
  ("outside the mapped landing areas"). License cross-check is future work —
  nothing carries the jumper's license yet (candidate: `device-owners.json`).

## Judgment thresholds (defaults — tune per jumper/license over time)

| Observation | notable | attention |
|---|---|---|
| Deployment altitude (AGL) | < 3,000 ft | < 2,500 ft (USPA C/D floor; A/B is 3,000) |
| Opening peak | > 3.5 g | > 5 g (hard opening) |
| Fall-rate std dev (window) | > 8 mph | — |
| Landing impulse peak | — | > 5 g |
| Snivel duration | > 5 s | > 8 s (once exposed) |

Everything else defaults to `normal` — reported as fact, not concern.

## findings.json contract

```json
{
  "case": "08-solo-bb-20260703", "jumper": "bb", "generatedAt": "…",
  "logbook": { "dateLocal": "…", "timeLocal": "…", "location": "…",
               "exitAltitudeFt": 13634.2, "freefallSec": 65.3,
               "deployAltitudeFt": 2974.8 },
  "findings": [
    { "id": "deployment-altitude",
      "severity": "normal | notable | attention",
      "statement": "Deployed at 2,970 ft, 65 seconds after exit.",
      "values": { "deployAltitudeFt": 2974.8 },
      "evidence": { "chart": "altitude-profile" },
      "provenance": "events.deployAltitudeFt (EventDetector.detectDeployment)" }
  ],
  "caveats": ["…preflight results that survived…"]
}
```

- `statement` is written English with **digits and units** ("2,970 ft") —
  the narrator vocalizes it; the analyst never phoneticizes.
- `evidence.chart` ∈ `logbook-card | altitude-profile | imu | fall-rate |
  flight-path` — names a visual, not how to frame it (that's narration).
- Findings are ordered as they should be told: chronological through the
  jump, with `attention` items never buried.
