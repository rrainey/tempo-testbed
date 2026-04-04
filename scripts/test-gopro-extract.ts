import fs from 'fs';
import GPMFExtract from 'gpmf-extract';
import GoProTelemetry from 'gopro-telemetry';

async function main() {
  const filePath = process.argv[2] || 'test-data/05-formation-jump4-3way/riley/GX011978.MP4';
  const stat = fs.statSync(filePath);
  console.log(`File size: ${(stat.size / 1e6).toFixed(1)} MB`);

  // Stream the file in chunks to avoid the 2GB readFileSync limit
  const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB
  const extracted = await GPMFExtract((mp4boxFile: any) => {
    const fd = fs.openSync(filePath, 'r');
    let offset = 0;
    const buf = Buffer.alloc(CHUNK_SIZE);

    while (offset < stat.size) {
      const bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, offset);
      const chunk = buf.slice(0, bytesRead);
      const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
      (ab as any).fileStart = offset;
      mp4boxFile.appendBuffer(ab);
      offset += bytesRead;
    }

    fs.closeSync(fd);
    mp4boxFile.flush();
  }, { browserMode: false });

  console.log(`Video duration: ${extracted.timing.videoDuration.toFixed(1)}s`);
  console.log(`Video start: ${extracted.timing.start.toISOString()}`);
  console.log(`GPMF samples: ${extracted.timing.samples.length}`);

  const telemetry = await GoProTelemetry(extracted);
  const deviceKeys = Object.keys(telemetry);
  console.log(`Devices: ${deviceKeys}`);

  for (const dk of deviceKeys) {
    const streams = (telemetry as any)[dk].streams || {};
    for (const [sk, stream] of Object.entries(streams) as any[]) {
      console.log(`  Stream ${sk}: "${stream.name}" — ${stream.samples?.length ?? 0} samples`);
      if (stream.name?.includes('GPS') && stream.samples?.length > 0) {
        const first = stream.samples[0];
        const last = stream.samples[stream.samples.length - 1];
        console.log('  First:', JSON.stringify(first).slice(0, 300));
        console.log('  Last:', JSON.stringify(last).slice(0, 300));
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
