# Tempo Color Inventory

Audit of all color values used across tempo-testbed and tempo-core, to inform
dark-theme experimentation.

---

## 1. Mantine Dark Theme Palette (layout.tsx)

The custom `dark` color tuple replaces Mantine's defaults. These 10 slots drive
nearly all surface, border, and text colors throughout the app.

| Index | Value     | Role                              |
|-------|-----------|-----------------------------------|
| 0     | `#c5c0c9` | Primary text foreground            |
| 1     | `#c0d6ea` | Lighter text / hover              |
| 2     | `#99aabb` | Secondary text                    |
| 3     | `#778899` | Muted text / borders              |
| 4     | `#556677` | Subtle borders / dividers         |
| 5     | `#334455` | Card / elevated surface           |
| 6     | `#11425d` | Secondary background              |
| 7     | `#002233` | Primary background (body)         |
| 8     | `#001a29` | Deep background                   |
| 9     | `#001120` | Deepest background                |

Primary color: `yellow` (Mantine's built-in yellow scale).

Current hue family: **deep teal-blue** (hue ~200).

## 2. Brand / Accent Color

`#ddff55` — bright yellow-green, used for:
- Page titles across all routes (inline `style={{ color: '#ddff55' }}`)
  - `page.tsx:53` (dashboard)
  - `testcase/[id]/page.tsx:171`
  - `formation/[id]/page.tsx:186`
  - `diff/page.tsx:159`
  - `jumper/[name]/page.tsx:128`
- Calibrated fall-rate bars in VelocityBinChart (`#ddff55`, active: `#eeff88`)
- "All phases" fallback in gps-path-utils (`PHASE_COLORS.all`)
- Faint card tint in VelocityBinChart (`rgba(221, 255, 85, 0.05)`)

## 3. Semantic / Icon Accent Colors

| Value     | Usage                                     | Files                      |
|-----------|-------------------------------------------|----------------------------|
| `#855bf0` | IconUsers (multi-jumper indicator)         | page.tsx                   |
| `#228be6` | ViewControls selected button bg/border    | ViewControls.tsx           |

## 4. Jump-Phase Event Colors

Consistent across charts and GPS path analysis:

| Phase   | Value     | Where                                                    |
|---------|-----------|----------------------------------------------------------|
| Exit    | `#00ff88` | JumpAltitudeChart, AccelerationChart, gps-path-utils     |
| Deploy  | `#ffaa00` | JumpAltitudeChart, AccelerationChart, gps-path-utils     |
| Landing | `#ff3355` | JumpAltitudeChart, AccelerationChart, gps-path-utils     |
| Landed  | `#555555` | gps-path-utils                                           |

## 5. Chart Styling Colors

Used for axes, grids, and data lines in Recharts components:

| Value     | Role                             | Files                                          |
|-----------|----------------------------------|-------------------------------------------------|
| `#c5c0c9` | Axis labels and tick marks       | All 4 chart components, FormationViewer legend  |
| `#004455` | CartesianGrid stroke             | All 4 chart components                          |
| `#556677` | Brush stroke                     | AccelerationChart, VelocityBinChart             |
| `#001a29` | Brush fill                       | AccelerationChart, VelocityBinChart             |
| `#66ccff` | Barometric altitude line         | AltitudeComparisonChart, JumpAltitudeChart      |
| `#ff9944` | GPS altitude line                | AltitudeComparisonChart                         |
| `#855bf0` | Vertical speed line              | JumpAltitudeChart                               |
| `#88cc88` | Pressure reading text            | AltitudeComparisonChart                         |
| `#ff6b9d` | Acceleration line                | AccelerationChart                               |
| `#0088ff` | Raw fall-rate bars               | VelocityBinChart (active: `#00aaff`)            |
| `#ddff55` | Calibrated fall-rate bars        | VelocityBinChart (active: `#eeff88`)            |
| `#888888` | Reference lines (average bands)  | VelocityBinChart                                |
| `#555555` | ReferenceArea fill               | VelocityBinChart                                |
| `#ffffff` | Reference-area labels            | VelocityBinChart                                |

## 6. 3D Scene Colors (Three.js — FormationViewer)

| Value (hex int) | Role                        | File                    |
|-----------------|-----------------------------|-------------------------|
| `0x002233`      | Scene background            | FormationViewer.tsx:229  |
| `0x444444`      | Grid primary lines          | FormationViewer.tsx:248  |
| `0x222222`      | Grid secondary lines        | FormationViewer.tsx:248  |
| `0xffffff`      | Ambient + directional light | FormationViewer.tsx:260  |
| `#444`          | Viewport border             | FormationViewer.tsx:604  |

### Axis Indicator Colors (AxisIndicator.ts)

| Value      | Axis     |
|------------|----------|
| `0xff4444` | X (fwd)  |
| `0x44ff44` | Y (right)|
| `0x4488ff` | Z (down) |
| `0x888888` | Elbow joint |

## 7. Participant Colors (formation-loader.ts)

Assigned round-robin to jumpers:

| Index | Value     | Name   |
|-------|-----------|--------|
| 0     | `#339af0` | Blue   |
| 1     | `#ff6b6b` | Red    |
| 2     | `#51cf66` | Green  |
| 3     | `#fcc419` | Yellow |
| 4     | `#cc5de8` | Purple |
| 5     | `#ff922b` | Orange |
| 6     | `#20c997` | Teal   |
| 7     | `#f06595` | Pink   |

## 8. Video Overlay Colors (VideoOverlay.tsx)

| Value                  | Role               |
|------------------------|--------------------|
| `#000`                 | Video background   |
| `rgba(0,0,0,0.7)`     | Paper background   |
| `rgba(0,0,0,0.5)`     | Box shadow         |
| `#888`                 | Duration text      |

## 9. Mantine Semantic Color Props

Used via component props (`color="..."`, `c="..."`), resolved by Mantine's
theme system. These will automatically adapt if the underlying color scales change.

| Name     | Usage                                            |
|----------|--------------------------------------------------|
| `gray`   | Neutral badges, "no baseline" indicators         |
| `red`    | Error alerts, "regressed" diff status            |
| `green`  | Success, "improved" status, baseline badges      |
| `yellow` | Warnings, "changed" diff status                  |
| `blue`   | Info alerts, "new" diff status                   |
| `violet` | Formation link badge, formation page button      |
| `dimmed` | All secondary/muted text (Mantine semantic)      |

---

## Notes for Theme Experimentation

**Highest-impact change points:**
1. **`dark[7]` / `dark[8]` / `dark[9]`** — body and deep backgrounds (current hue ~200, deep teal)
2. **`dark[5]` / `dark[6]`** — card surfaces and secondary backgrounds
3. **`dark[0]` through `dark[3]`** — text hierarchy
4. **3D scene background** (`0x002233` in FormationViewer) should stay coordinated with `dark[7]`
5. **Chart grid** (`#004455`) and **brush fill** (`#001a29`) are derived from the same teal-blue family and should track with dark palette changes

**Independently themed (won't auto-track dark palette changes):**
- All chart colors (axes, grids, data lines) — hardcoded hex in tempo-core components
- 3D scene background and grid — hardcoded hex ints in FormationViewer
- Brand color `#ddff55` — hardcoded inline styles in tempo-testbed pages
- Participant colors — hardcoded in formation-loader.ts
- Phase event colors — hardcoded in gps-path-utils.ts and chart components
