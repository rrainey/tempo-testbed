# GoPro Video Fusion with Formation Playback

*Implementation notes, April 2026*

---

## Overview

The Formation Viewer overlays synchronized GoPro helmet-camera video in the upper-left corner of the 3D viewport. Video playback is time-locked to the formation timeline using GPS timestamps embedded in both the GoPro MP4 and the Tempo device logs.

---

## GoPro MP4 File Structure

GoPro cameras (Hero5 and later) embed telemetry in a dedicated GPMF (GoPro Metadata Format) track alongside video and audio. Key characteristics:

- **Codec tag:** `gpmd` in the MP4 container
- **GPS5 stream:** Latitude, longitude, altitude, 2D speed, 3D speed — sampled at ~18Hz
- **Each GPS sample has:** `cts` (composition timestamp in ms, relative to video start) and `date` (UTC from GPS fix)
- **Additional streams:** Accelerometer (200Hz), gyroscope (200Hz), camera orientation, gravity vector

### HEVC and Browser Compatibility

GoPro Hero 10+ records in HEVC (H.265) at 4K. Most browsers on Linux (and some on other platforms) cannot decode HEVC. A transcoded H.264 variant is required for web playback.

**Transcoding command:**
```bash
ffmpeg -i ORIGINAL.MP4 \
  -c:v libx264 -preset fast -crf 23 \
  -vf scale=1920:1080 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  -y ORIGINAL_web.mp4
```

The `_web.mp4` suffix convention is used. The discovery logic automatically prefers the `_web.mp4` variant when present, falling back to the original.

### The `moov` Atom Problem

GoPro writes the `moov` atom (MP4 index/metadata) at the **end** of the file. Browsers need `moov` before they can play or seek. The `-movflags +faststart` flag in ffmpeg moves `moov` to the front.

For original (non-transcoded) files, the video API route implements virtual faststart: it reads the `moov` atom, patches the `stco`/`co64` chunk offset tables to account for the new layout, and serves `ftyp + moov(patched) + mdat` without modifying the original file on disk. However, this path cannot solve the HEVC codec problem — transcoding to H.264 is still required for browser playback.

### Serving Strategy

Faststart files (`_web.mp4` with moov at front) are served using Node.js `fs.createReadStream` with native backpressure handling. This avoids event loop stalls under the many concurrent range requests browsers make during video playback.

Non-faststart files (original GoPro recordings) use synchronous reads through the virtual reorder layer. This path is primarily a fallback; in practice, the `_web.mp4` variant should always be used for playback.

---

## Time Synchronization

The Tempo device logs and GoPro video each have independent GPS-derived UTC timestamps. Synchronization works as follows:

1. **Extract GPS telemetry** from the original GoPro MP4 using `gpmf-extract` + `gopro-telemetry` (npm packages). The original file is used for extraction even when the `_web.mp4` is used for playback — both have identical timing.
2. **Find the first GPS sample** with a valid UTC `date` field and its video-relative `cts` (ms).
3. **Compute the offset:**

```
videoToFormationOffset = (firstGPSDate - formationStartTime) / 1000 - firstGPS_cts / 1000
```

4. **At any formation time `t`:**

```
videoTime = t - videoToFormationOffset
```

The extracted telemetry is cached as `{filename}.telemetry.json` alongside the MP4 to avoid re-parsing the multi-GB file on every load.

---

## File Layout

Videos are placed in the test-data directory alongside the jumper's flight log:

```
test-data/
  05-formation-jump4-3way/
    metadata.json
    riley/
      flight.txt              ← Tempo device log
      GX011978.MP4            ← Original GoPro (HEVC 4K, used for telemetry extraction)
      GX011978_web.mp4        ← Transcoded (H.264 1080p, faststart, used for playback)
      GX011978.telemetry.json ← Cached GPS timing (auto-generated on first load)
```

Discovery is automatic: the formation loader scans each jumper's directory for `*.MP4` files (excluding `_web` variants, which are treated as derivatives of the original).

---

## Architecture

### Server Side

| Component | File | Role |
|---|---|---|
| Telemetry extraction | `src/lib/testbed/gopro-telemetry.ts` | Streams large MP4 in 64MB chunks via `gpmf-extract`, parses GPS with `gopro-telemetry`, caches result |
| Video streaming | `src/app/api/video/[...path]/route.ts` | HTTP range-request server; native `fs.createReadStream` for faststart files, virtual atom reorder for non-faststart |
| Formation API | `src/app/api/formation/[id]/route.ts` | Discovers videos, extracts telemetry, returns `GoProVideoInfo[]` with sync offsets and serve filenames |

### Client Side

| Component | File | Role |
|---|---|---|
| Video overlay | `src/components/formation/VideoOverlay.tsx` | `<video>` element in the upper-left third of viewport, synced to formation timeline |
| Formation viewer | `src/components/formation/FormationViewer.tsx` | "Video" toggle button, passes `currentTime` and `isPlaying` to overlay |
| Formation page | `src/app/formation/[id]/page.tsx` | Converts API video info to `VideoInfo` with streaming URLs |

### Sync Flow

```
Formation scrubber → currentTime changes
  → VideoOverlay sets video.currentTime = formationTime - offset
  → Video seeks to corresponding frame

Video plays → onTimeUpdate fires
  → VideoOverlay computes formationTime = video.currentTime + offset
  → Feeds back to formation scrubber
```

When the formation time is outside the video's range, the overlay dims to 30% opacity and shows a hint with the valid time range. Play/pause state is synchronized bidirectionally.

---

## Dependencies

- **gpmf-extract** (v0.3.3) — Extracts raw GPMF binary from MP4 containers
- **gopro-telemetry** (v1.2.11) — Parses GPMF into structured JSON (GPS, accelerometer, gyroscope, etc.)
- **mp4box** — Transitive dependency of gpmf-extract
- **ffmpeg** (system) — Required once per video for HEVC → H.264 transcoding (not an npm dependency)

---

## Limitations and Future Work

- **Manual transcoding required:** The `_web.mp4` must be created with ffmpeg before the video can play in the browser. Automating this on first load is possible but slow for large files.
- **Single video per formation:** Currently one video is supported. Multiple cameras (different jumpers) would require a video selector UI.
- **Audio:** Video is muted by default to avoid autoplay restrictions and audio interference.
- **GPS fix delay:** The GoPro's GPS may not have a fix at the start of recording. The first valid GPS timestamp may be seconds into the video — handled by the `cts` offset in the sync calculation.
- **Telemetry extraction time:** First load of a new GoPro file takes 10–30 seconds to parse the GPMF track from the original multi-GB file. Subsequent loads use the cached `.telemetry.json`.
