# Tempo Testbed — Source Code Analysis & Architecture (v2)

Based on full source code review of `lib/analysis/`, `lib/formation/`, `components/`, `prisma/schema.prisma`, and `package.json`.

---

## 1. Source Code Coupling Assessment

### `lib/analysis/` — ✅ ZERO coupling to database/API/auth

| File | Purpose | External Deps | DB/API/Auth? |
|------|---------|---------------|--------------|
| `dropkick-reader.ts` | NMEA parser → KMLDataV1[] | `nmea-simple`, `egm96-universal` | None |
| `log-parser.ts` | Buffer → ParsedLogData | wraps DropkickReader | None |
| `event-detector.ts` | Exit/deploy/landing detection | ParsedLogData types | None |
| `dropkick-tools.ts` | Unit conversions, `interp1()`, `plottableValuesFromSamples()` | `geodesy` | None |
| `gps-path-utils.ts` | Phase segmentation, GeoJSON | — | None |
| `kml-writer.ts` | KML export | — | None |
| `rr-geodesy.ts` | Vincenty ellipsoidal calcs | — | None |

**Verdict: Copy directly into testbed. No modifications needed.**

### `lib/formation/` — ✅ ZERO coupling

| File | Purpose | Coupling |
|------|---------|----------|
| `coordinates.ts` | WGS84→NED→BaseExitFrame, fall rate calibration, `projectFormationAtTime()` | None |
| `types.ts` | Vector3, GeodeticCoordinates interfaces | None |

**Verdict: Copy directly.**

### `components/` — ⚠️ MODERATE coupling (API fetch calls)

| Component | API Dependency | Testbed Fix |
|-----------|---------------|-------------|
| `JumpAltitudeChart` | **None** — pure props | Use directly |
| `VelocityBinChart` | **None** — pure props (imports `FALL_RATE_AVG_MIN/MAX` from constants) | Use directly, define constants locally |
| `GNSSPathMap` | **None** — pure props + MapLibre | Use directly, point to public tile server |
| `FormationViewer` | **None** — pure props + Three.js | Use directly |
| `FormationReview` | `fetch('/api/formations/${id}')` | Replace with static data loader |
| `JumpDetailsPanel` | `fetch('/api/jumps/${id}')`, `fetch('/api/jumps/${id}/velocity-bins')`, `fetch('/api/map-overlays')` | Replace with static data loader |
| `BaseInfoPanel` | **None** — pure props | Use directly |
| `JumperListPanel` | **None** — pure props | Use directly |

---

## 2. Critical Discovery: How Rate-of-Descent Is Actually Computed

### GNSS-based, not barometric

The `rateOfDescent_fpm` stored in each `KMLDataV1` entry is computed from **sequential GNSS altitude fixes** (dropkick-reader.ts line 517):

```typescript
this.curEntry.rateOfDescent_fpm = -(packet.altitudeMeters - this.lastGNSSAltitude_m) /
    (this.curEntry.timeOffset - this.lastGNSSTimeOffset_sec) * 196.850394; // m/s → fpm
```

This means the "rate of descent" used by the EventDetector is GNSS-derived (~3.7Hz), **not** the barometric data I had earlier theorized was the noise source.

### Barometric altitude: already filtered, used only for `baroAlt_ft` display

The DropkickReader applies an 8-sample moving average to PENV altitude (line 576-584):
```typescript
this.altFilterSum += packet.estimatedAlt_ft;
this.altFilter.push(packet.estimatedAlt_ft);
if (this.altFilter.length > this.altFilterMax) { /* shift oldest */ }
const baroAlt_ft = this.altFilterSum / this.altFilter.length;
```

Then in `onClose()`, barometric altitude is interpolated to match GNSS timestamps:
```typescript
entry.baroAlt_ft = interp1(this.envSampleTimeSeries_ft, this.envAltSeries_ft, entry.timeOffset);
```

So `baroAlt_ft` in the final KMLDataV1 entries is **already filtered and interpolated**. It's used for charting and for landing detection proximity checks, but NOT for exit/deployment detection.

---

## 3. Event Detection Algorithm Analysis

### Exit Detection (EventDetector.detectExit)

**Dual criteria — both must be true simultaneously:**
1. `entry.rateOfDescent_fpm > 5000` (GNSS-based, ~56 mph)
2. `accelMag < 9.81 * 0.8` (IMU: acceleration < 0.8g, indicates freefall)

**Problems identified:**
- The 5000 fpm threshold is extremely high. Terminal velocity for belly-to-earth is ~9,000-12,000 fpm. At exit, the jumper hasn't reached terminal yet. The descent rate ramps from 0 → terminal over ~12 seconds.
- During early freefall (tumbling), GNSS altitude is noisy — the GNSS-derived RoD will bounce erratically.
- The acceleration check (< 0.8g) is sound for freefall detection, but combined with the 5000 fpm GNSS RoD requirement, detection could be delayed significantly.
- The code checks `logEntries[i]` through `logEntries[i+4]` but only tests the **single entry** at `i`, not a sustained window. The comment says "Need at least 4 samples for ~1 second" but the actual code doesn't enforce sustained descent.

**Recommendation:** Use the IMU acceleration criterion (< 0.5g) as primary. Require sustained < 0.5g for 2+ seconds. Cross-validate with PST state transition (`_ST` sentence with "freefall_detected") if available. Drop or lower the RoD threshold significantly (e.g., 1000 fpm) as a secondary sanity check.

### Deployment Detection (EventDetector.detectDeployment)

**Criteria:**
1. `rateOfDescent_fpm > 5000` (must still be in freefall)
2. `accelMag > 9.81 + 1.5*9.81 = 2.47g` (sudden deceleration)

**Issues:**
- Single-sample detection — first sample > 2.5g triggers it. No sustained-window requirement.
- The threshold is reasonable for canopy opening shock, but could false-trigger on turbulence bumps during freefall.
- Activation detection (RoD < 2000 after deployment) is good.

**Recommendation:** Require 2+ samples above threshold within 0.5s window. Add barometric rate confirmation (smoothed baro RoD dropping below 4000 fpm within 15s of trigger).

### Landing Detection (EventDetector.detectLanding)

**Criteria:**
1. `baroAlt_ft` within 100 ft of DZ surface altitude
2. Altitude stays within 20 ft of initial value for 20 seconds

**This is actually the most robust algorithm.** It doesn't depend on rate computation. The 20-ft tolerance over 20 seconds is generous enough to handle barometric drift on the ground.

**Minor issue:** The inner loop has a `continue` on `diff > 20.0` instead of `break`. This means a single noisy sample exceeding 20ft doesn't fail the window — it just skips that sample. This is actually a bug: it should break and restart the window search at the next candidate point.

---

## 4. Velocity Bin Analysis

The VelocityBinChart expects pre-computed data from an API endpoint (`/api/jumps/${id}/velocity-bins`). The analysis window is defined in the requirements as:
- Start: 12 seconds after exit (allow acceleration to terminal)
- End: 2 seconds before deployment

The testbed needs to implement this computation. From `coordinates.ts`, the `calibrateFallRate()` function already exists and uses the standard atmosphere density correction table (normalized to 7000 ft reference altitude).

The bin computation pipeline:
1. Extract barometric altitude time series between (exit + 12s) and (deployment - 2s)
2. Compute instantaneous fall rate from altitude deltas
3. Apply density calibration via `calibrateFallRate()`
4. Bin into 5 mph buckets (or similar)
5. Compute elapsed time in each bin

---

## 5. Testbed Architecture

### Project Structure

```
tempo-testbed/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Mantine + dark theme setup
│   │   ├── page.tsx                  # Test case index / dashboard
│   │   ├── testcase/
│   │   │   └── [id]/
│   │   │       ├── page.tsx          # Formation review (multi-jumper)
│   │   │       └── jumper/
│   │   │           └── [name]/
│   │   │               └── page.tsx  # Individual jump detail
│   │   └── diff/
│   │       └── page.tsx              # Analysis diff dashboard
│   │
│   ├── lib/
│   │   ├── analysis/                 # COPIED from tempo-insights (unmodified)
│   │   │   ├── dropkick-reader.ts
│   │   │   ├── log-parser.ts
│   │   │   ├── event-detector.ts
│   │   │   ├── dropkick-tools.ts
│   │   │   ├── gps-path-utils.ts
│   │   │   ├── kml-writer.ts
│   │   │   └── rr-geodesy.ts
│   │   │
│   │   ├── formation/                # COPIED from tempo-insights (unmodified)
│   │   │   ├── coordinates.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── testbed/                  # NEW: testbed-specific code
│   │   │   ├── data-loader.ts        # Load flight.txt + metadata.json from /test-data
│   │   │   ├── velocity-bins.ts      # Velocity bin computation (extracted from API route)
│   │   │   ├── analysis-runner.ts    # Run full analysis pipeline on test data
│   │   │   ├── diff-engine.ts        # Compare analysis results against baselines
│   │   │   └── constants.ts          # FALL_RATE_AVG_MIN/MAX, other constants
│   │   │
│   │   └── utils/
│   │       └── constants.ts          # Shared constants (from tempo-insights)
│   │
│   ├── components/                   # Mix of copied + new
│   │   ├── analysis/                 # COPIED (unmodified)
│   │   │   ├── JumpAltitudeChart.tsx
│   │   │   ├── VelocityBinChart.tsx
│   │   │   └── GNSSPathMap.tsx
│   │   │
│   │   ├── formation/                # COPIED (unmodified)
│   │   │   ├── FormationViewer.tsx
│   │   │   ├── BaseInfoPanel.tsx
│   │   │   ├── JumperListPanel.tsx
│   │   │   └── ViewControls.tsx
│   │   │
│   │   └── testbed/                  # NEW: testbed UI
│   │       ├── TestCaseIndex.tsx      # List all test cases
│   │       ├── JumpDetailView.tsx     # Standalone jump review (replaces JumpDetailsPanel)
│   │       ├── FormationView.tsx      # Standalone formation review (replaces FormationReview)
│   │       ├── AnalysisDiffTable.tsx  # Side-by-side diff results
│   │       ├── AnalysisDiffDetail.tsx # Per-jump diff with chart overlays
│   │       └── ReanalyzeControls.tsx  # Buttons: "Re-analyze All", "Accept", "Revert"
│   │
│   └── hooks/
│       ├── useTestCase.ts            # Load test case data
│       └── useAnalysisDiff.ts        # Diff state management
│
├── test-data/
│   ├── 01-solo-billy/                # Test case: solo jump
│   │   ├── metadata.json             # Formation-level metadata + baseline results
│   │   └── billy/
│   │       ├── flight.txt            # Raw log
│   │       └── baseline.json         # Per-jumper baseline analysis results
│   │
│   ├── 02-formation-3way/            # Test case: 3-way formation
│   │   ├── metadata.json
│   │   ├── billy/
│   │   │   ├── flight.txt
│   │   │   └── baseline.json
│   │   ├── bob/
│   │   │   ├── flight.txt
│   │   │   └── baseline.json
│   │   └── thornton/
│   │       ├── flight.txt
│   │       └── baseline.json
│   │
│   └── README.md                     # How to add test cases
│
├── package.json
├── tsconfig.json
├── next.config.js
└── README.md
```

### Metadata Schemas

**Test case metadata** (`test-data/01/metadata.json`):
```json
{
  "name": "Solo Jump - Billy (2025-01-15)",
  "description": "Standard solo belly jump from 13,500 ft",
  "dropzone": {
    "name": "Skydive Elsinore",
    "lat_deg": 33.6320,
    "lon_deg": -117.2510,
    "elevation_m": 436.5,
    "timezone": "America/Los_Angeles"
  },
  "jumpers": ["billy"],
  "baseJumper": "billy",
  "isSolo": true,
  "tags": ["solo", "belly", "13500ft"]
}
```

**Per-jumper baseline** (`test-data/01/billy/baseline.json`):
```json
{
  "analysisVersion": "1.0.0",
  "analyzedAt": "2025-02-11T10:00:00Z",
  "events": {
    "exitOffsetSec": null,
    "deploymentOffsetSec": null,
    "landingOffsetSec": null,
    "exitAltitudeFt": null,
    "deployAltitudeFt": null,
    "exitLatitude": null,
    "exitLongitude": null,
    "maxDescentRateFpm": null
  },
  "velocityBins": {
    "bins": [],
    "summary": {
      "raw": { "totalAnalysisTime": 0, "averageFallRate": 0 },
      "calibrated": { "totalAnalysisTime": 0, "averageFallRate": 0 },
      "analysisWindow": { "startOffset": 0, "endOffset": 0, "duration": 0 }
    }
  },
  "metadata": {
    "logDuration_sec": 0,
    "logEntryCount": 0,
    "hasGPS": false,
    "logVersion": 0,
    "logString": "",
    "surfacePressureAlt_m": 0
  }
}
```

### Data Flow

```
flight.txt
    │
    ▼
DropkickReader.onData(line)     ← lib/analysis/dropkick-reader.ts
    │
    ▼
LogParser.parseLog(buffer)      ← lib/analysis/log-parser.ts
    │ produces: ParsedLogData { altitude[], vspeed[], gps[], logEntries[] }
    │
    ├──▶ EventDetector.analyzeJump(data) → JumpEvents
    │
    ├──▶ velocityBinAnalysis(data, events) → VelocityBinData[]
    │
    ├──▶ JumpAltitudeChart (altitude[], events)
    ├──▶ VelocityBinChart (bins, summary)
    ├──▶ GNSSPathMap (gps[], events)
    │
    └──▶ For formations:
         projectFormationAtTime(participants, t, baseId, dzCenter)
            → FormationViewer (3D positions)
```

### Analysis Diff Workflow

1. First run: analyze all test data → save as `baseline.json` files
2. Make algorithm changes in `lib/analysis/event-detector.ts`
3. Click "Re-analyze All" → runs pipeline again → produces `current` results
4. Diff engine compares `baseline` vs `current` field-by-field:

```
┌─────────────────────────────────────────────────────────────┐
│ Analysis Diff Dashboard                    [Re-analyze All] │
├────────────┬────────────────┬──────────────┬───────────────┤
│ Test Case  │ Field          │ Baseline     │ Current       │
├────────────┼────────────────┼──────────────┼───────────────┤
│ 01/billy   │ exitOffsetSec  │ ✗ null       │ ✓ 575.2   ▲  │
│            │ deployOffsetSec│ ✗ null       │ ✓ 650.8   ▲  │
│            │ landingOffsetSec│ ✗ null      │ ✓ 773.1   ▲  │
│            │ avgFallRate    │ ✗ null       │ ✓ 112     ▲  │
├────────────┼────────────────┼──────────────┼───────────────┤
│ 02/bob     │ exitOffsetSec  │ 412.3        │ 412.5    ≈   │
│            │ deployOffsetSec│ 478.1        │ 477.9    ≈   │
│            │ landingOffsetSec│ 595.0       │ 594.8    ≈   │
└────────────┴────────────────┴──────────────┴───────────────┘
                                        [Accept All] [Revert]
```

Color coding:
- 🟢 Green: New detection (was null, now has value) — improvement
- 🟡 Yellow: Value changed within tolerance — review
- 🔴 Red: Lost detection (had value, now null) — regression
- ⚪ Gray: Unchanged — stable

---

## 6. Implementation Priority

### Phase 1: Scaffold + Single Jump Analysis
1. Create Next.js project with Mantine 8 dark theme
2. Copy `lib/analysis/` and `lib/formation/` verbatim
3. Create `data-loader.ts` to read flight.txt from `/test-data/`
4. Wire up: flight.txt → parse → detect → chart
5. Place the single uploaded `flight.txt` in `test-data/01-solo-billy/billy/`
6. Run current EventDetector, capture baseline (even if null for some fields)
7. Display: JumpAltitudeChart + event markers + raw data stats

### Phase 2: Fix Event Detection
8. Implement improved exit detection (sustained low-g, lower RoD threshold)
9. Implement improved landing detection (fix inner-loop break bug)
10. Add smoothed barometric rate overlay on altitude chart
11. Re-analyze, compare to baseline, accept improvements

### Phase 3: Velocity Bins + Formation
12. Implement velocity bin computation in testbed
13. Add VelocityBinChart display
14. Add GNSSPathMap display
15. Add formation view (when multi-jumper test data is available)

### Phase 4: Diff Workflow
16. Implement diff engine
17. Diff dashboard page
18. Accept/Revert controls
19. Detail view with chart overlays (old vs new event markers)

---

## 7. NPM Dependencies for Testbed

From tempo-insights `package.json`, the testbed needs:

**Core (must have):**
- `next` ^15.5
- `react` / `react-dom` 19.1
- `@mantine/core` ^8.3, `@mantine/hooks`, `@mantine/notifications`
- `@tabler/icons-react`
- `recharts` ^3.1
- `three` ^0.180 + `@types/three`
- `nmea-simple` ^3.3
- `egm96-universal` ^1.1
- `geodesy` ^2.4 + `@types/geodesy`
- `typescript` ^5

**NOT needed (testbed eliminates):**
- `@prisma/client`, `prisma` — no database
- `@supabase/supabase-js` — no storage
- `bcrypt`, `jsonwebtoken`, `cookie` — no auth
- `maplibre-gl` — only if GNSSPathMap is included (Phase 3)
- `formidable`, `archiver`, `qrcode` — server utilities
- `zod` — validation for API routes

**New for testbed:**
- (nothing major — file reading is built into Next.js API routes or server components)
