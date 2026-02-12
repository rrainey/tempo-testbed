# Tempo Testbed

A standalone development and regression-testing environment for the Tempo Insights analysis algorithms. This testbed runs the same `lib/analysis/` and `lib/formation/` code from the main app against captured flight data, without requiring a database, Bluetooth, or authentication.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000 to see the test case dashboard.

## Architecture

```
flight.txt  →  DropkickReader  →  LogParser  →  EventDetector  →  Charts + Diff
                (NMEA parse)      (time series)   (exit/deploy/    (JumpAltitudeChart,
                                                   landing)         VelocityBinChart)
```

### Key Principles

- **`lib/analysis/` and `lib/formation/` are exact copies** from `tempo-insights`. No testbed-specific modifications. When you improve an algorithm, copy the changed file back to `tempo-insights`.
- **No database.** Test cases live as files in `test-data/`. Baselines are JSON files.
- **No auth, no Bluetooth.** Pure analysis pipeline testing.
- **Diff-driven workflow.** Run analysis → compare against baseline → accept or revert.

## Workflow

1. **Add a test case**: Drop `flight.txt` files into `test-data/<case-name>/<jumper>/`
2. **Run analysis**: Click "Analyze All" in the UI (or use the CLI)
3. **Review**: Charts show altitude profile, event markers, velocity bins
4. **Accept baseline**: Click "Accept as Baseline" to save current results
5. **Iterate**: Modify `lib/analysis/event-detector.ts`, re-analyze, compare diffs
6. **Copy back**: When satisfied, copy changed files back to `tempo-insights/src/lib/analysis/`

## Project Structure

```
src/
├── lib/
│   ├── analysis/          # ← COPIED from tempo-insights (DO NOT MODIFY here)
│   ├── formation/         # ← COPIED from tempo-insights
│   └── testbed/           # Testbed-specific: data loader, runner, diff engine
├── components/
│   ├── analysis/          # ← COPIED from tempo-insights (chart components)
│   ├── formation/         # ← COPIED from tempo-insights (3D viewer)
│   └── testbed/           # Testbed-specific UI components
└── app/
    ├── page.tsx           # Dashboard: list all test cases
    ├── testcase/[id]/     # Per-test-case analysis + charts + diff
    └── api/               # Server-side analysis endpoints

test-data/
├── 01-solo-billy/         # Test case with one jumper
│   ├── metadata.json
│   └── billy/
│       ├── flight.txt     # Raw Tempo-BT log
│       └── baseline.json  # Saved analysis results
└── README.md
```

## Analysis Pipeline

The pipeline runs entirely server-side via API routes:

1. `POST /api/analyze` with `{ testCaseId, jumperName }` triggers:
   - `LogParser.parseLog(buffer)` → `ParsedLogData`
   - `EventDetector.analyzeJump(data)` → `JumpEvents` (exit, deploy, landing)
   - Velocity bin computation → `VelocityBinEntry[]`
   - Diff against existing baseline → `JumperDiff`

2. Add `accept: true` to save current results as the new baseline.

## Event Detection (Current Algorithm — Known Issues)

| Event | Method | Issue |
|-------|--------|-------|
| Exit | GNSS RoD > 5000 fpm AND accel < 0.8g | Threshold too high; misses early freefall |
| Deploy | accel > 2.5g during freefall | Single-sample; no sustained-window check |
| Landing | baro alt within 100ft of surface for 20s | Inner loop `continue` bug (should `break`) |

See `tempo-testbed-analysis-v2.md` for detailed algorithm analysis and improvement recommendations.

## Tech Stack

- Next.js 15 (App Router)
- Mantine 8 (dark theme, matching Tempo Insights)
- Recharts (altitude/velocity charts)
- Three.js (formation 3D viewer — future)
- TypeScript throughout
