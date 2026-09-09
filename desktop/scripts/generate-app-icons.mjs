/**
 * generate-app-icons.mjs
 *
 * Generates crisp, production-grade application icons for Google Flow Desktop:
 *  - assets/icon.png (256x256 RGBA PNG)
 *  - assets/icon.ico (Windows multi-resolution ICO: 256, 128, 64, 48, 32, 16)
 *  - dist/assets/icon.png & dist/assets/icon.ico (runtime copies)
 *
 * Pure Node.js implementation using built-in zlib for zero-dependency portability.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(desktopRoot, 'assets');
const distAssetsDir = path.join(desktopRoot, 'dist', 'assets');

// Standard CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Creates a valid PNG buffer from raw RGBA pixel data.
 */
function createPng(width, height, rgbaBuffer) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA (6)
  ihdr[10] = 0; // Compression: Deflate
  ihdr[11] = 0; // Filter: Adaptive
  ihdr[12] = 0; // Interlace: None

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Scanlines with filter byte 0 (None)
  const scanlineWidth = width * 4 + 1;
  const rawData = Buffer.alloc(height * scanlineWidth);

  for (let y = 0; y < height; y++) {
    const rawOffset = y * scanlineWidth;
    rawData[rawOffset] = 0; // Filter: 0
    rgbaBuffer.copy(rawData, rawOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const deflated = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

/**
 * Procedurally draws the Google Flow icon at given resolution.
 */
function renderIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 256;

  // Squircle parameters
  const cornerRadius = 54 * scale;
  const center = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Distance from squircle bounding box
      const dx = Math.max(0, Math.abs(x - center) - (center - cornerRadius));
      const dy = Math.max(0, Math.abs(y - center) - (center - cornerRadius));
      const distFromCorner = Math.sqrt(dx * dx + dy * dy);

      if (distFromCorner > cornerRadius) {
        // Outside squircle - transparent
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Smooth anti-aliased edge
      const edgeDist = cornerRadius - distFromCorner;
      const alphaFactor = Math.min(1, Math.max(0, edgeDist * 1.5));

      // Base background: sleek dark theme (#0c1322 to #1e293b)
      const grad = y / size;
      let r = Math.round(12 + grad * 18);
      let g = Math.round(19 + grad * 22);
      let b = Math.round(34 + grad * 25);
      let a = 255 * alphaFactor;

      // Subtle top highlight border
      if (distFromCorner > cornerRadius - 1.5 * scale) {
        r = Math.round(r * 0.7 + 99 * 0.3);
        g = Math.round(g * 0.7 + 102 * 0.3);
        b = Math.round(b * 0.7 + 241 * 0.3);
      }

      // Normalized coordinates [0..1] relative to center
      const nx = (x / size - 0.5) * 2;
      const ny = (y / size - 0.5) * 2;

      // 1. Primary Flow Ribbon: Elegant flowing sine wave (Google Blue to Indigo)
      // Path: y = sin(x * 2.8) * 0.35 - 0.05
      const wave1Y = Math.sin(nx * 2.5) * 0.38 - 0.08;
      const distWave1 = Math.abs(ny - wave1Y);
      const wave1Thickness = 0.22 - Math.abs(nx) * 0.05;

      if (distWave1 < wave1Thickness && Math.abs(nx) < 0.72) {
        const ribbonEdge = (wave1Thickness - distWave1) / wave1Thickness;
        const ribbonT = (nx + 0.72) / 1.44; // 0 to 1 along wave

        // Gradient: Blue (#2563EB) -> Indigo (#6366F1) -> Purple (#8B5CF6)
        const wr = 37 + ribbonT * (139 - 37);
        const wg = 99 + ribbonT * (92 - 99);
        const wb = 235 + ribbonT * (246 - 235);
        const intensity = Math.sin(ribbonEdge * Math.PI);

        r = Math.round(r * (1 - intensity) + wr * intensity);
        g = Math.round(g * (1 - intensity) + wg * intensity);
        b = Math.round(b * (1 - intensity) + wb * intensity);
      }

      // 2. Secondary Flow Ribbon: Lower energetic stream (Cyan to Emerald)
      // Path: y = -sin(nx * 2.8 + 0.5) * 0.32 + 0.28
      const wave2Y = -Math.sin(nx * 2.6 + 0.4) * 0.32 + 0.26;
      const distWave2 = Math.abs(ny - wave2Y);
      const wave2Thickness = 0.16 - Math.abs(nx) * 0.04;

      if (distWave2 < wave2Thickness && Math.abs(nx) < 0.68) {
        const ribbonEdge = (wave2Thickness - distWave2) / wave2Thickness;
        const ribbonT = (nx + 0.68) / 1.36;

        // Gradient: Cyan (#06B6D4) -> Emerald (#10B981)
        const wr = 6 + ribbonT * (16 - 6);
        const wg = 182 + ribbonT * (185 - 182);
        const wb = 212 + ribbonT * (129 - 212);
        const intensity = Math.sin(ribbonEdge * Math.PI) * 0.9;

        r = Math.round(r * (1 - intensity) + wr * intensity);
        g = Math.round(g * (1 - intensity) + wg * intensity);
        b = Math.round(b * (1 - intensity) + wb * intensity);
      }

      // 3. Central AI Spark/Focus Node (Amber/Coral glowing spark at (0.18, -0.26))
      const sparkDx = nx - 0.18;
      const sparkDy = ny + 0.26;
      const sparkDist = Math.sqrt(sparkDx * sparkDx + sparkDy * sparkDy);
      if (sparkDist < 0.14) {
        const glow = Math.cos((sparkDist / 0.14) * (Math.PI / 2));
        r = Math.round(r * (1 - glow) + 251 * glow);
        g = Math.round(g * (1 - glow) + 191 * glow);
        b = Math.round(b * (1 - glow) + 36 * glow);
      }

      buf[idx] = Math.min(255, Math.max(0, r));
      buf[idx + 1] = Math.min(255, Math.max(0, g));
      buf[idx + 2] = Math.min(255, Math.max(0, b));
      buf[idx + 3] = Math.min(255, Math.max(0, Math.round(a)));
    }
  }

  return buf;
}

/**
 * Builds a multi-resolution Windows ICO file containing PNG-encoded frames.
 */
function buildIco(sizes) {
  const pngBuffers = sizes.map((sz) => {
    const rgba = renderIconRgba(sz);
    return { size: sz, buf: createPng(sz, sz, rgba) };
  });

  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirTotalSize = headerSize + numImages * dirEntrySize;

  let currentOffset = dirTotalSize;
  const entries = [];

  for (const item of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry[0] = item.size === 256 ? 0 : item.size; // Width (0 = 256)
    entry[1] = item.size === 256 ? 0 : item.size; // Height (0 = 256)
    entry[2] = 0; // Palette count
    entry[3] = 0; // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(item.buf.length, 8); // Image data size
    entry.writeUInt32LE(currentOffset, 12); // Image data offset
    entries.push(entry);
    currentOffset += item.buf.length;
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(numImages, 4); // Image count

  const allParts = [header, ...entries, ...pngBuffers.map((item) => item.buf)];
  return Buffer.concat(allParts);
}

function main() {
  console.log('Generating Google Flow Desktop application icons...');

  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  if (!fs.existsSync(distAssetsDir)) {
    fs.mkdirSync(distAssetsDir, { recursive: true });
  }

  // 1. Generate 256x256 PNG
  const rgba256 = renderIconRgba(256);
  const png256 = createPng(256, 256, rgba256);
  const targetPng = path.join(assetsDir, 'icon.png');
  fs.writeFileSync(targetPng, png256);
  fs.writeFileSync(path.join(distAssetsDir, 'icon.png'), png256);
  console.log(`✓ Generated: ${targetPng} (${png256.length} bytes)`);

  // 2. Generate Multi-Resolution Windows ICO (256, 128, 64, 48, 32, 16)
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const icoBuffer = buildIco(icoSizes);
  const targetIco = path.join(assetsDir, 'icon.ico');
  fs.writeFileSync(targetIco, icoBuffer);
  fs.writeFileSync(path.join(distAssetsDir, 'icon.ico'), icoBuffer);
  console.log(`✓ Generated: ${targetIco} (${icoBuffer.length} bytes with ${icoSizes.length} resolutions)`);

  console.log('App icons generated successfully.');
}

main();
