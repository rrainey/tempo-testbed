// lib/testbed/gopro-telemetry.ts
//
// Extracts GPS timing data from GoPro MP4 files and caches it.
// Used to synchronize GoPro video playback with the formation timeline.

import fs from 'fs';
import path from 'path';
import GPMFExtract from 'gpmf-extract';
import GoProTelemetry from 'gopro-telemetry';

const TEST_DATA_DIR = path.join(process.cwd(), 'test-data');
const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB for streaming large files

/** Cached telemetry for a GoPro video */
export interface GoProVideoInfo {
  /** Original MP4 filename (HEVC source, used for telemetry extraction) */
  fileName: string;
  /** Web-playable filename (H.264 transcoded variant if available, else original) */
  serveFileName: string;
  /** Jumper who captured the video */
  jumperId: string;
  /** Video duration in seconds */
  videoDuration_sec: number;
  /** UTC timestamp of the first GPS fix with valid date */
  firstGPSDate: string; // ISO string
  /** UTC timestamp of the last GPS sample */
  lastGPSDate: string;  // ISO string
  /** Video CTS (composition timestamp, ms) of the first GPS fix */
  firstGPS_cts_ms: number;
  /** Offset to apply: formationTimeOffset = videoTime + this value (seconds) */
  videoToFormationOffset_sec: number | null;
}

/**
 * Stream-read an MP4 file and extract GPMF metadata.
 * Handles files > 2GB that can't be read with readFileSync.
 */
async function extractGPMF(filePath: string) {
  const stat = fs.statSync(filePath);
  return GPMFExtract((mp4boxFile: any) => {
    const fd = fs.openSync(filePath, 'r');
    let offset = 0;
    const buf = Buffer.alloc(CHUNK_SIZE);

    while (offset < stat.size) {
      const bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, offset);
      const chunk = buf.slice(0, bytesRead);
      const ab = chunk.buffer.slice(
        chunk.byteOffset, chunk.byteOffset + chunk.byteLength
      ) as ArrayBuffer;
      (ab as any).fileStart = offset;
      mp4boxFile.appendBuffer(ab);
      offset += bytesRead;
    }

    fs.closeSync(fd);
    mp4boxFile.flush();
  }, { browserMode: false });
}

/**
 * Extract GPS timing from a GoPro MP4, returning video sync info.
 * Results are cached as {filename}.telemetry.json alongside the MP4.
 */
export async function extractGoProVideoInfo(
  testCaseId: string,
  jumperId: string,
  fileName: string,
  serveFileName: string,
  formationStartTime?: Date
): Promise<GoProVideoInfo | null> {
  const mp4Path = path.join(TEST_DATA_DIR, testCaseId, jumperId, fileName);
  const cachePath = mp4Path.replace(/\.MP4$/i, '.telemetry.json');

  // Return cached if available
  if (fs.existsSync(cachePath)) {
    try {
      const cached: GoProVideoInfo = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      // Always update serveFileName (may change if _web variant is added later)
      cached.serveFileName = serveFileName;
      // Recompute offset if formation start time is provided
      if (formationStartTime && cached.firstGPSDate) {
        cached.videoToFormationOffset_sec = computeOffset(
          cached.firstGPSDate, cached.firstGPS_cts_ms, formationStartTime
        );
      }
      return cached;
    } catch {
      // Cache corrupted, re-extract
    }
  }

  if (!fs.existsSync(mp4Path)) {
    console.warn(`[GoPro] Video not found: ${mp4Path}`);
    return null;
  }

  console.log(`[GoPro] Extracting telemetry from ${fileName} (this may take a moment)...`);

  try {
    const extracted = await extractGPMF(mp4Path);
    const telemetry = await GoProTelemetry(extracted);

    // Find the GPS5 stream
    let gps5Samples: any[] | null = null;
    for (const dk of Object.keys(telemetry)) {
      const streams = (telemetry as any)[dk].streams || {};
      for (const stream of Object.values(streams) as any[]) {
        if (stream.name?.includes('GPS') && stream.samples?.length > 0) {
          gps5Samples = stream.samples;
          break;
        }
      }
      if (gps5Samples) break;
    }

    if (!gps5Samples || gps5Samples.length === 0) {
      console.warn(`[GoPro] No GPS data found in ${fileName}`);
      return null;
    }

    // Find first sample with a valid date
    const firstWithDate = gps5Samples.find(s => s.date);
    const lastWithDate = [...gps5Samples].reverse().find(s => s.date);

    if (!firstWithDate?.date) {
      console.warn(`[GoPro] No GPS samples with UTC dates in ${fileName}`);
      return null;
    }

    const info: GoProVideoInfo = {
      fileName,
      serveFileName,
      jumperId,
      videoDuration_sec: extracted.timing.videoDuration,
      firstGPSDate: firstWithDate.date,
      lastGPSDate: lastWithDate?.date ?? firstWithDate.date,
      firstGPS_cts_ms: firstWithDate.cts,
      videoToFormationOffset_sec: formationStartTime
        ? computeOffset(firstWithDate.date, firstWithDate.cts, formationStartTime)
        : null,
    };

    // Cache
    fs.writeFileSync(cachePath, JSON.stringify(info, null, 2));
    console.log(
      `[GoPro] Extracted: duration=${info.videoDuration_sec.toFixed(1)}s, ` +
      `GPS range ${info.firstGPSDate} to ${info.lastGPSDate}`
    );

    return info;
  } catch (err) {
    console.error(`[GoPro] Extraction failed for ${fileName}:`, err);
    return null;
  }
}

/**
 * Compute the offset between video time and formation time.
 *
 * Given: at video CTS = firstGPS_cts_ms, the UTC time is firstGPSDate.
 * Formation time 0 = formationStartTime (UTC).
 *
 * So for any video time t_video (seconds):
 *   UTC = firstGPSDate + (t_video - firstGPS_cts_ms/1000)
 *   formationTimeOffset = (UTC - formationStartTime) / 1000
 *   formationTimeOffset = t_video - firstGPS_cts_ms/1000 + (firstGPSDate - formationStartTime)/1000
 *
 * Therefore: videoToFormationOffset = -firstGPS_cts_ms/1000 + (firstGPSDate - formationStartTime)/1000
 * And: formationTimeOffset = t_video + videoToFormationOffset
 */
function computeOffset(
  firstGPSDate: string,
  firstGPS_cts_ms: number,
  formationStartTime: Date
): number {
  const gpsEpoch = new Date(firstGPSDate).getTime();
  const formationEpoch = formationStartTime.getTime();
  return -firstGPS_cts_ms / 1000 + (gpsEpoch - formationEpoch) / 1000;
}

/**
 * Discover GoPro MP4 files in a test case's jumper directories.
 * Also ensures symlinks exist in public/ for static serving
 * (browsers need native range request support to seek in large MP4s
 * with moov atom at end of file).
 */
export function discoverGoProVideos(
  testCaseId: string,
  jumpers: string[]
): { jumperId: string; fileName: string; serveName: string }[] {
  const results: { jumperId: string; fileName: string; serveName: string }[] = [];
  const publicBase = path.join(process.cwd(), 'public', 'test-data');

  for (const jumperId of jumpers) {
    const jumperDir = path.join(TEST_DATA_DIR, testCaseId, jumperId);
    if (!fs.existsSync(jumperDir)) continue;

    const files = fs.readdirSync(jumperDir);
    for (const file of files) {
      if (/\.(mp4|MP4)$/.test(file) && !file.startsWith('.') && !file.includes('_web')) {
        // Prefer _web.mp4 transcoded variant (H.264, faststart) if available
        const webName = file.replace(/\.(mp4|MP4)$/, '_web.mp4');
        const serveName = files.includes(webName) ? webName : file;
        results.push({ jumperId, fileName: file, serveName });

        // Ensure symlink exists in public/ for static serving
        const srcPath = path.join(jumperDir, file);
        const linkDir = path.join(publicBase, testCaseId, jumperId);
        const linkPath = path.join(linkDir, file);
        if (!fs.existsSync(linkPath)) {
          fs.mkdirSync(linkDir, { recursive: true });
          fs.symlinkSync(srcPath, linkPath);
          console.log(`[GoPro] Created symlink: public/test-data/${testCaseId}/${jumperId}/${file}`);
        }
      }
    }
  }
  return results;
}
