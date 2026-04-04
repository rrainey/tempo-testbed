// app/api/video/[...path]/route.ts
//
// Streams MP4 video files from test-data/ with HTTP range request support.
// Handles GoPro-style MP4 files where the moov atom is at the end by
// creating a virtual "faststart" layout: ftyp + moov(patched) + mdat.
// The moov's chunk offset tables (stco/co64) are patched to reflect
// the new mdat position.
//
// URL: /api/video/{testCaseId}/{jumperId}/{filename}

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = path.join(process.cwd(), 'test-data');

interface AtomLayout {
  ftyp: [number, number];   // [offset, size] in original file
  moov: [number, number];
  mdat: [number, number];
  virtualSize: number;
  patchedMoov: Buffer;      // moov with patched chunk offsets
}

const layoutCache = new Map<string, AtomLayout | null>();

/**
 * Scan top-level MP4 atoms to find ftyp, moov, mdat positions.
 */
function scanTopLevelAtoms(fd: number, fileSize: number): Record<string, [number, number]> {
  const atoms: Record<string, [number, number]> = {};
  const buf = Buffer.alloc(16);
  let offset = 0;

  while (offset < fileSize) {
    const bytesRead = fs.readSync(fd, buf, 0, 8, offset);
    if (bytesRead < 8) break;

    let size = buf.readUInt32BE(0);
    const type = buf.toString('ascii', 4, 8);

    if (size === 0) {
      size = fileSize - offset;
    } else if (size === 1) {
      fs.readSync(fd, buf, 0, 8, offset + 8);
      const hi = buf.readUInt32BE(0);
      const lo = buf.readUInt32BE(4);
      size = hi * 0x100000000 + lo;
    }

    if (type === 'ftyp' || type === 'moov' || type === 'mdat') {
      atoms[type] = [offset, size];
    }

    offset += size;
  }

  return atoms;
}

/**
 * Patch stco (32-bit) and co64 (64-bit) chunk offset tables in a moov buffer.
 * offsetDelta is added to every chunk offset entry.
 */
function patchChunkOffsets(moovBuf: Buffer, offsetDelta: number): void {
  // Recursively scan for stco and co64 boxes inside the moov buffer
  function scanAndPatch(buf: Buffer, start: number, end: number) {
    let pos = start;
    while (pos + 8 <= end) {
      let boxSize = buf.readUInt32BE(pos);
      const boxType = buf.toString('ascii', pos + 4, pos + 8);

      if (boxSize === 0) boxSize = end - pos;
      if (boxSize < 8 || pos + boxSize > end) break;

      if (boxType === 'stco') {
        // stco: version(1) + flags(3) + entry_count(4) + entries(4 each)
        const headerOffset = pos + 8; // past box header
        const entryCount = buf.readUInt32BE(headerOffset + 4);
        for (let i = 0; i < entryCount; i++) {
          const entryPos = headerOffset + 8 + i * 4;
          const oldOffset = buf.readUInt32BE(entryPos);
          buf.writeUInt32BE(oldOffset + offsetDelta, entryPos);
        }
      } else if (boxType === 'co64') {
        // co64: version(1) + flags(3) + entry_count(4) + entries(8 each)
        const headerOffset = pos + 8;
        const entryCount = buf.readUInt32BE(headerOffset + 4);
        for (let i = 0; i < entryCount; i++) {
          const entryPos = headerOffset + 8 + i * 8;
          const hi = buf.readUInt32BE(entryPos);
          const lo = buf.readUInt32BE(entryPos + 4);
          const oldOffset = hi * 0x100000000 + lo;
          const newOffset = oldOffset + offsetDelta;
          buf.writeUInt32BE(Math.floor(newOffset / 0x100000000), entryPos);
          buf.writeUInt32BE(newOffset >>> 0, entryPos + 4);
        }
      } else if (boxType === 'moov' || boxType === 'trak' || boxType === 'mdia' ||
                 boxType === 'minf' || boxType === 'stbl' || boxType === 'edts' ||
                 boxType === 'udta' || boxType === 'mvex') {
        // Container box — recurse into children
        scanAndPatch(buf, pos + 8, pos + boxSize);
      }

      pos += boxSize;
    }
  }

  scanAndPatch(moovBuf, 0, moovBuf.length);
}

/**
 * Build the virtual faststart layout for an MP4 file.
 * Reads the moov atom, patches its chunk offsets, and caches the result.
 */
function getLayout(filePath: string): AtomLayout | null {
  if (layoutCache.has(filePath)) return layoutCache.get(filePath)!;

  const fd = fs.openSync(filePath, 'r');
  const fileSize = fs.fstatSync(fd).size;
  const atoms = scanTopLevelAtoms(fd, fileSize);

  if (!atoms.ftyp || !atoms.moov || !atoms.mdat) {
    fs.closeSync(fd);
    console.warn(`[Video] Missing atoms in ${filePath}: found ${Object.keys(atoms).join(', ')}`);
    layoutCache.set(filePath, null);
    return null;
  }

  const needsReorder = atoms.moov[0] > atoms.mdat[0];

  if (!needsReorder) {
    // Already faststart — no patching needed, read moov as-is
    const moovBuf = Buffer.alloc(atoms.moov[1]);
    fs.readSync(fd, moovBuf, 0, atoms.moov[1], atoms.moov[0]);
    fs.closeSync(fd);

    const layout: AtomLayout = {
      ftyp: atoms.ftyp,
      moov: atoms.moov,
      mdat: atoms.mdat,
      virtualSize: fileSize,
      patchedMoov: moovBuf,
    };
    layoutCache.set(filePath, layout);
    console.log(`[Video] ${path.basename(filePath)}: already faststart`);
    return layout;
  }

  // Read the moov atom
  const moovBuf = Buffer.alloc(atoms.moov[1]);
  fs.readSync(fd, moovBuf, 0, atoms.moov[1], atoms.moov[0]);
  fs.closeSync(fd);

  // Virtual layout: [ftyp][moov][mdat]
  // mdat moves from original offset to ftyp.size + moov.size
  const newMdatOffset = atoms.ftyp[1] + atoms.moov[1];
  const originalMdatOffset = atoms.mdat[0];
  const offsetDelta = newMdatOffset - originalMdatOffset;

  // Patch chunk offsets in the moov copy
  patchChunkOffsets(moovBuf, offsetDelta);

  const virtualSize = atoms.ftyp[1] + atoms.moov[1] + atoms.mdat[1];
  const layout: AtomLayout = {
    ftyp: atoms.ftyp,
    moov: atoms.moov,
    mdat: atoms.mdat,
    virtualSize,
    patchedMoov: moovBuf,
  };
  layoutCache.set(filePath, layout);

  console.log(
    `[Video] ${path.basename(filePath)}: virtual faststart — ` +
    `moov@${atoms.moov[0]} (${(atoms.moov[1]/1024).toFixed(0)}KB), ` +
    `mdat offset delta=${offsetDelta}`
  );

  return layout;
}

/**
 * Read bytes from the virtual faststart layout.
 * Virtual layout: [ftyp (from file)] [patched moov (from buffer)] [mdat (from file)]
 */
function readVirtual(
  fd: number,
  layout: AtomLayout,
  virtualOffset: number,
  length: number
): Buffer {
  const result = Buffer.alloc(length);
  let written = 0;
  let vPos = virtualOffset;

  const ftypEnd = layout.ftyp[1];
  const moovEnd = ftypEnd + layout.patchedMoov.length;

  while (written < length) {
    const remaining = length - written;

    if (vPos < ftypEnd) {
      // Reading from ftyp region — read from file at original ftyp offset
      const bytesInRegion = Math.min(remaining, ftypEnd - vPos);
      fs.readSync(fd, result, written, bytesInRegion, layout.ftyp[0] + vPos);
      written += bytesInRegion;
      vPos += bytesInRegion;
    } else if (vPos < moovEnd) {
      // Reading from patched moov buffer
      const moovLocal = vPos - ftypEnd;
      const bytesInRegion = Math.min(remaining, layout.patchedMoov.length - moovLocal);
      layout.patchedMoov.copy(result, written, moovLocal, moovLocal + bytesInRegion);
      written += bytesInRegion;
      vPos += bytesInRegion;
    } else {
      // Reading from mdat region — read from file at original mdat offset
      const mdatLocal = vPos - moovEnd;
      const bytesInRegion = Math.min(remaining, layout.mdat[1] - mdatLocal);
      if (bytesInRegion <= 0) break;
      fs.readSync(fd, result, written, bytesInRegion, layout.mdat[0] + mdatLocal);
      written += bytesInRegion;
      vPos += bytesInRegion;
    }
  }

  return result.subarray(0, written);
}

// ─── Route Handler ─────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;
  if (segments.length < 3) {
    return NextResponse.json({ error: 'Invalid video path' }, { status: 400 });
  }
  if (segments.some(s => s.includes('..'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const filePath = path.join(TEST_DATA_DIR, ...segments);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }

  const layout = getLayout(filePath);
  if (!layout) {
    return NextResponse.json({ error: 'Invalid MP4 file' }, { status: 500 });
  }

  const needsReorder = layout.moov[0] > layout.mdat[0];
  // For faststart files (moov before mdat), serve directly from disk.
  // For non-faststart files, use the virtual reorder with patched moov.
  const fileSize = needsReorder ? layout.virtualSize : fs.statSync(filePath).size;
  const rangeHeader = request.headers.get('range');

  if (!rangeHeader) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return new NextResponse('Invalid range', { status: 416 });
  }

  const start = parseInt(match[1], 10);
  const end = Math.min(
    match[2] ? parseInt(match[2], 10) : fileSize - 1,
    fileSize - 1
  );
  const totalBytes = end - start + 1;

  const headers = {
    'Content-Type': 'video/mp4',
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': totalBytes.toString(),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };

  if (!needsReorder) {
    // Faststart file: pipe directly from disk using Node's native stream
    const nodeStream = fs.createReadStream(filePath, { start, end });
    const readable = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => {
          try { controller.enqueue(chunk); } catch { nodeStream.destroy(); }
        });
        nodeStream.on('end', () => {
          try { controller.close(); } catch { /* */ }
        });
        nodeStream.on('error', () => {
          try { controller.close(); } catch { /* */ }
        });
      },
      cancel() { nodeStream.destroy(); },
    });
    return new NextResponse(readable as any, { status: 206, headers });
  }

  // Non-faststart: read via virtual layout (synchronous for simplicity)
  const fd = fs.openSync(filePath, 'r');
  const data = readVirtual(fd, layout, start, totalBytes);
  fs.closeSync(fd);

  return new NextResponse(data as unknown as BodyInit, { status: 206, headers });
}
