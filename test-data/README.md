# Test Data Directory

Each subdirectory represents a **test case** — either a solo jump or a formation skydive.

## Directory Structure

```
test-data/
├── 01-solo-billy/              # Test case directory (name is the ID)
│   ├── metadata.json           # Test case metadata (required)
│   ├── billy/                  # Jumper directory (name matches jumpers[] in metadata)
│   │   ├── flight.txt          # Raw Tempo-BT log file (required)
│   │   └── baseline.json       # Analysis baseline (auto-generated)
│   └── ...
└── 02-formation-3way/
    ├── metadata.json
    ├── billy/
    │   ├── flight.txt
    │   └── baseline.json
    ├── bob/
    │   └── flight.txt
    └── thornton/
        └── flight.txt
```

## Adding a New Test Case

1. Create a directory under `test-data/` with a descriptive name
2. Create `metadata.json` (see schema below)
3. Create a subdirectory for each jumper
4. Place the raw `flight.txt` log file in each jumper directory
5. Run analysis from the testbed UI to establish the initial baseline

## metadata.json Schema

```json
{
  "name": "Human readable name",
  "description": "What makes this test case interesting",
  "dropzone": {
    "name": "Skydive Elsinore",
    "lat_deg": 33.6320,
    "lon_deg": -117.2510,
    "elevation_m": 187.15,
    "timezone": "America/Los_Angeles"
  },
  "jumpers": ["billy", "bob"],
  "baseJumper": "billy",
  "isSolo": false,
  "tags": ["formation", "2way", "belly"]
}
```

## Useful Test Case Tags

- `solo` / `formation` — jump type
- `belly` / `freefly` / `wingsuit` — body position
- `13500ft` / `10000ft` — exit altitude
- `exit-detection-failure` — known issue with current algorithm
- `landing-detection-failure` — known issue
- `noisy-baro` — barometric data quality issue
- `gps-dropout` — GPS signal loss during freefall
