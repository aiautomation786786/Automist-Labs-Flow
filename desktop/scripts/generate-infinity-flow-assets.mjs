/**
 * generate-infinity-flow-assets.mjs
 *
 * Generates all master brand assets for Infinity Flow:
 *  - Master SVGs:
 *      - assets/infinity-flow-mark.svg
 *      - assets/infinity-flow-logo.svg
 *      - assets/infinity-flow-mark-light.svg
 *      - assets/infinity-flow-mark-white.svg
 *      - assets/infinity-flow-logo-light.svg
 *  - Multi-resolution Windows ICOs:
 *      - assets/infinity-flow.ico (256, 128, 64, 48, 32, 16)
 *      - assets/icon.ico (synced)
 *  - High-res PNGs:
 *      - assets/infinity-flow-mark.png (512x512)
 *      - assets/icon.png (256x256)
 *  - Copies all generated assets to dist/assets/
 *
 * Pure Node.js implementation for 100% reproducible zero-dependency builds.
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

// Ensure directories exist
for (const dir of [assetsDir, distAssetsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. Master Vector SVG Templates
// ---------------------------------------------------------------------------

export const INFINITY_FLOW_MARK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" fill="none">
  <defs>
    <!-- Left Ribbon: Cyan to Electric Blue to Indigo -->
    <linearGradient id="if-ribbon-left" x1="0%" y1="50%" x2="50%" y2="50%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#6366f1" />
    </linearGradient>

    <!-- Right Ribbon: Indigo to Violet to Purple -->
    <linearGradient id="if-ribbon-right" x1="50%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="50%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#c084fc" />
    </linearGradient>

    <!-- Foreground Crossing Ribbon (Overpass from bottom-left to top-right) -->
    <linearGradient id="if-ribbon-fore" x1="20%" y1="80%" x2="80%" y2="20%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="35%" stop-color="#3b82f6" />
      <stop offset="65%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#c084fc" />
    </linearGradient>

    <!-- Background Crossing Ribbon (Underpass with negative space break) -->
    <linearGradient id="if-ribbon-back" x1="20%" y1="20%" x2="80%" y2="80%">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="35%" stop-color="#4f46e5" />
      <stop offset="70%" stop-color="#7c3aed" />
      <stop offset="100%" stop-color="#9333ea" />
    </linearGradient>

    <!-- Soft glow -->
    <filter id="if-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.5" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <g filter="url(#if-glow)">
    <!-- Underpass Ribbon: Upper-Left down towards center (breaks before crossing) -->
    <path
      d="M 26 31 C 36 31 43 40 45 44"
      stroke="url(#if-ribbon-back)"
      stroke-width="10"
      stroke-linecap="round"
    />

    <!-- Underpass Ribbon: Center-out towards Bottom-Right (resumes after crossing gap) -->
    <path
      d="M 55 56 C 57 60 64 69 74 69 C 85 69 92 61 92 50 C 92 39 85 31 74 31"
      stroke="url(#if-ribbon-back)"
      stroke-width="10"
      stroke-linecap="round"
    />

    <!-- Left Outer Loop connector -->
    <path
      d="M 26 31 C 15 31 8 39 8 50 C 8 61 15 69 26 69"
      stroke="url(#if-ribbon-left)"
      stroke-width="10"
      stroke-linecap="round"
    />

    <!-- Foreground Continuous Overpass Ribbon: Sweeps gracefully over center -->
    <path
      d="M 26 69 C 37 69 44 59 50 50 C 56 41 63 31 74 31"
      stroke="url(#if-ribbon-fore)"
      stroke-width="10"
      stroke-linecap="round"
    />

    <!-- Luminous Spark / Core at overpass apex -->
    <circle cx="50" cy="50" r="2.2" fill="#ffffff" opacity="0.95" />
  </g>
</svg>`;

export const INFINITY_FLOW_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 90" width="100%" height="100%" fill="none">
  <defs>
    <linearGradient id="logo-brand-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#a855f7" />
    </linearGradient>

    <linearGradient id="logo-text-accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#c084fc" />
    </linearGradient>

    <filter id="logo-mark-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Left Mark Container -->
  <g transform="translate(10, 10)" filter="url(#logo-mark-glow)">
    <path
      d="M 21 24 C 29 24 34 31 36 34"
      stroke="url(#logo-brand-grad)"
      stroke-width="8"
      stroke-linecap="round"
    />
    <path
      d="M 44 46 C 46 49 51 56 59 56 C 68 56 73 50 73 40 C 73 30 68 24 59 24"
      stroke="url(#logo-brand-grad)"
      stroke-width="8"
      stroke-linecap="round"
    />
    <path
      d="M 21 24 C 12 24 7 30 7 40 C 7 50 12 56 21 56"
      stroke="url(#logo-brand-grad)"
      stroke-width="8"
      stroke-linecap="round"
    />
    <path
      d="M 21 56 C 30 56 35 48 40 40 C 45 32 50 24 59 24"
      stroke="url(#logo-text-accent)"
      stroke-width="8"
      stroke-linecap="round"
    />
    <circle cx="40" cy="40" r="1.8" fill="#ffffff" opacity="0.95" />
  </g>

  <!-- Typography -->
  <g transform="translate(100, 0)">
    <text x="0" y="46" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="27" font-weight="800" letter-spacing="0.05em" fill="#ffffff">
      INFINITY <tspan fill="url(#logo-text-accent)">FLOW</tspan>
    </text>
    <text x="2" y="68" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10.5" font-weight="600" letter-spacing="0.22em" fill="#94a3b8">
      AI VIDEO AUTOMATION
    </text>
  </g>
</svg>`;

export const INFINITY_FLOW_MARK_WHITE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" fill="none">
  <g stroke="#ffffff" stroke-width="10" stroke-linecap="round">
    <path d="M 26 31 C 36 31 43 40 45 44" opacity="0.8" />
    <path d="M 55 56 C 57 60 64 69 74 69 C 85 69 92 61 92 50 C 92 39 85 31 74 31" opacity="0.8" />
    <path d="M 26 31 C 15 31 8 39 8 50 C 8 61 15 69 26 69" opacity="0.8" />
    <path d="M 26 69 C 37 69 44 59 50 50 C 56 41 63 31 74 31" opacity="1.0" />
  </g>
  <circle cx="50" cy="50" r="2.2" fill="#ffffff" />
</svg>`;

export const INFINITY_FLOW_MARK_LIGHT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" fill="none">
  <defs>
    <linearGradient id="if-light-fore" x1="20%" y1="80%" x2="80%" y2="20%">
      <stop offset="0%" stop-color="#0891b2" />
      <stop offset="50%" stop-color="#4f46e5" />
      <stop offset="100%" stop-color="#7c3aed" />
    </linearGradient>
    <linearGradient id="if-light-back" x1="20%" y1="20%" x2="80%" y2="80%">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="50%" stop-color="#4338ca" />
      <stop offset="100%" stop-color="#6d28d9" />
    </linearGradient>
  </defs>
  <g stroke-width="10" stroke-linecap="round">
    <path d="M 26 31 C 36 31 43 40 45 44" stroke="url(#if-light-back)" opacity="0.9" />
    <path d="M 55 56 C 57 60 64 69 74 69 C 85 69 92 61 92 50 C 92 39 85 31 74 31" stroke="url(#if-light-back)" opacity="0.9" />
    <path d="M 26 31 C 15 31 8 39 8 50 C 8 61 15 69 26 69" stroke="url(#if-light-back)" opacity="0.9" />
    <path d="M 26 69 C 37 69 44 59 50 50 C 56 41 63 31 74 31" stroke="url(#if-light-fore)" />
  </g>
</svg>`;

export const INFINITY_FLOW_LOGO_LIGHT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 90" width="100%" height="100%" fill="none">
  <defs>
    <linearGradient id="logo-light-accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0891b2" />
      <stop offset="50%" stop-color="#4f46e5" />
      <stop offset="100%" stop-color="#7c3aed" />
    </linearGradient>
  </defs>
  <g transform="translate(10, 10)">
    <path d="M 21 24 C 29 24 34 31 36 34" stroke="url(#logo-light-accent)" stroke-width="8" stroke-linecap="round" />
    <path d="M 44 46 C 46 49 51 56 59 56 C 68 56 73 50 73 40 C 73 30 68 24 59 24" stroke="url(#logo-light-accent)" stroke-width="8" stroke-linecap="round" />
    <path d="M 21 24 C 12 24 7 30 7 40 C 7 50 12 56 21 56" stroke="url(#logo-light-accent)" stroke-width="8" stroke-linecap="round" />
    <path d="M 21 56 C 30 56 35 48 40 40 C 45 32 50 24 59 24" stroke="url(#logo-light-accent)" stroke-width="8" stroke-linecap="round" />
  </g>
  <g transform="translate(100, 0)">
    <text x="0" y="46" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="27" font-weight="800" letter-spacing="0.05em" fill="#0f172a">
      INFINITY <tspan fill="url(#logo-light-accent)">FLOW</tspan>
    </text>
    <text x="2" y="68" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10.5" font-weight="600" letter-spacing="0.22em" fill="#64748b">
      AI VIDEO AUTOMATION
    </text>
  </g>
</svg>`;

// ---------------------------------------------------------------------------
// 2. Multi-Resolution Rasterizer (PNG + Windows ICO)
// ---------------------------------------------------------------------------

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

function createPng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const scanlineWidth = width * 4 + 1;
  const rawData = Buffer.alloc(height * scanlineWidth);

  for (let y = 0; y < height; y++) {
    const rawOffset = y * scanlineWidth;
    rawData[rawOffset] = 0;
    rgbaBuffer.copy(rawData, rawOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const deflated = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Procedurally draws the Infinity Flow icon at any given resolution (16 to 512).
 */
function renderInfinityFlowRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 256;
  const cornerRadius = 56 * scale;
  const center = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      const dx = Math.max(0, Math.abs(x - center) - (center - cornerRadius));
      const dy = Math.max(0, Math.abs(y - center) - (center - cornerRadius));
      const distFromCorner = Math.sqrt(dx * dx + dy * dy);

      if (distFromCorner > cornerRadius) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      const edgeDist = cornerRadius - distFromCorner;
      const alphaFactor = Math.min(1, Math.max(0, edgeDist * 1.5));

      // Container background: deep space dark (#07090e -> #0f172a)
      const grad = y / size;
      let r = Math.round(7 + grad * 8);
      let g = Math.round(9 + grad * 14);
      let b = Math.round(14 + grad * 28);
      let a = 255 * alphaFactor;

      // Subtle luminous outer border highlight
      if (distFromCorner > cornerRadius - 1.5 * scale) {
        r = Math.round(r * 0.6 + 60 * 0.4);
        g = Math.round(g * 0.6 + 130 * 0.4);
        b = Math.round(b * 0.6 + 246 * 0.4);
      }

      const nx = (x / size - 0.5) * 2;
      const ny = (y / size - 0.5) * 2;

      const leftDist = Math.sqrt((nx + 0.46) * (nx + 0.46) + ny * ny);
      const rightDist = Math.sqrt((nx - 0.46) * (nx - 0.46) + ny * ny);

      const loopRadius = 0.34;
      const ribbonThickness = 0.13;

      const diag1 = Math.abs(ny - (nx * 0.70));
      const inCenterDiag1 = Math.abs(nx) < 0.35 && diag1 < ribbonThickness;

      const diag2 = Math.abs(ny - (-nx * 0.70));
      const inCenterDiag2 = Math.abs(nx) < 0.35 && diag2 < ribbonThickness;

      const distFromCenter = Math.sqrt(nx * nx + ny * ny);
      const inNegativeSpaceGap = inCenterDiag2 && distFromCenter < 0.16;

      const leftLoopDist = Math.abs(leftDist - loopRadius);
      const rightLoopDist = Math.abs(rightDist - loopRadius);

      let isRibbon = false;
      let ribbonT = 0;
      let ribbonWeight = 0;

      if (inCenterDiag1) {
        const edge = (ribbonThickness - diag1) / ribbonThickness;
        ribbonWeight = Math.sin(edge * (Math.PI / 2));
        ribbonT = (nx + 0.35) / 0.70;
        isRibbon = true;
      } else if (inCenterDiag2 && !inNegativeSpaceGap) {
        const edge = (ribbonThickness - diag2) / ribbonThickness;
        const fade = Math.min(1, Math.max(0, (distFromCenter - 0.14) / 0.10));
        ribbonWeight = Math.sin(edge * (Math.PI / 2)) * fade;
        ribbonT = (0.35 - nx) / 0.70;
        if (ribbonWeight > 0.05) isRibbon = true;
      } else if (leftLoopDist < ribbonThickness && nx < -0.15) {
        const edge = (ribbonThickness - leftLoopDist) / ribbonThickness;
        ribbonWeight = Math.sin(edge * (Math.PI / 2));
        ribbonT = Math.max(0, Math.min(0.4, (nx + 0.8) / 1.0));
        isRibbon = true;
      } else if (rightLoopDist < ribbonThickness && nx > 0.15) {
        const edge = (ribbonThickness - rightLoopDist) / ribbonThickness;
        ribbonWeight = Math.sin(edge * (Math.PI / 2));
        ribbonT = Math.max(0.6, Math.min(1.0, 0.6 + (nx - 0.15) / 0.9));
        isRibbon = true;
      }

      if (isRibbon && ribbonWeight > 0) {
        let wr, wg, wb;
        if (ribbonT < 0.35) {
          const u = ribbonT / 0.35;
          wr = 6 + u * (59 - 6);
          wg = 182 + u * (130 - 182);
          wb = 212 + u * (246 - 212);
        } else if (ribbonT < 0.70) {
          const u = (ribbonT - 0.35) / 0.35;
          wr = 59 + u * (99 - 59);
          wg = 130 + u * (102 - 130);
          wb = 246 + u * (241 - 246);
        } else {
          const u = (ribbonT - 0.70) / 0.30;
          wr = 99 + u * (192 - 99);
          wg = 102 + u * (132 - 102);
          wb = 241 + u * (252 - 241);
        }

        const rw = Math.min(1, Math.max(0, ribbonWeight));
        r = Math.round(r * (1 - rw) + wr * rw);
        g = Math.round(g * (1 - rw) + wg * rw);
        b = Math.round(b * (1 - rw) + wb * rw);
      }

      if (distFromCenter < 0.06) {
        const spark = Math.cos((distFromCenter / 0.06) * (Math.PI / 2));
        r = Math.round(r * (1 - spark) + 255 * spark);
        g = Math.round(g * (1 - spark) + 255 * spark);
        b = Math.round(b * (1 - spark) + 255 * spark);
      }

      buf[idx] = Math.min(255, Math.max(0, r));
      buf[idx + 1] = Math.min(255, Math.max(0, g));
      buf[idx + 2] = Math.min(255, Math.max(0, b));
      buf[idx + 3] = Math.min(255, Math.max(0, Math.round(a)));
    }
  }

  return buf;
}

function buildIco(sizes) {
  const pngBuffers = sizes.map((sz) => {
    const rgba = renderInfinityFlowRgba(sz);
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
    entry[0] = item.size === 256 ? 0 : item.size;
    entry[1] = item.size === 256 ? 0 : item.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(item.buf.length, 8);
    entry.writeUInt32LE(currentOffset, 12);
    entries.push(entry);
    currentOffset += item.buf.length;
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(numImages, 4);

  return Buffer.concat([header, ...entries, ...pngBuffers.map((item) => item.buf)]);
}

// ---------------------------------------------------------------------------
// 3. Execution Pipeline
// ---------------------------------------------------------------------------

export function generateAllAssets() {
  console.log('Generating Infinity Flow Master Brand Assets...');

  // 1. Master Vector SVGs
  const svgFiles = [
    { name: 'infinity-flow-mark.svg', content: INFINITY_FLOW_MARK_SVG },
    { name: 'infinity-flow-logo.svg', content: INFINITY_FLOW_LOGO_SVG },
    { name: 'infinity-flow-mark-white.svg', content: INFINITY_FLOW_MARK_WHITE_SVG },
    { name: 'infinity-flow-mark-light.svg', content: INFINITY_FLOW_MARK_LIGHT_SVG },
    { name: 'infinity-flow-logo-light.svg', content: INFINITY_FLOW_LOGO_LIGHT_SVG },
  ];

  for (const { name, content } of svgFiles) {
    const assetPath = path.join(assetsDir, name);
    const distPath = path.join(distAssetsDir, name);
    fs.writeFileSync(assetPath, content, 'utf8');
    fs.writeFileSync(distPath, content, 'utf8');
    console.log(`  ✓ Master SVG: ${name}`);
  }

  // 2. High-Resolution Master PNGs
  const png512 = createPng(512, 512, renderInfinityFlowRgba(512));
  fs.writeFileSync(path.join(assetsDir, 'infinity-flow-mark.png'), png512);
  fs.writeFileSync(path.join(distAssetsDir, 'infinity-flow-mark.png'), png512);
  console.log(`  ✓ Master PNG 512x512: infinity-flow-mark.png (${png512.length} bytes)`);

  const png256 = createPng(256, 256, renderInfinityFlowRgba(256));
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), png256);
  fs.writeFileSync(path.join(distAssetsDir, 'icon.png'), png256);
  console.log(`  ✓ Master Icon PNG 256x256: icon.png (${png256.length} bytes)`);

  // 3. Multi-Resolution Windows ICOs
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const icoBuffer = buildIco(icoSizes);

  fs.writeFileSync(path.join(assetsDir, 'infinity-flow.ico'), icoBuffer);
  fs.writeFileSync(path.join(distAssetsDir, 'infinity-flow.ico'), icoBuffer);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join(distAssetsDir, 'icon.ico'), icoBuffer);
  console.log(`  ✓ Windows Multi-Res ICO: infinity-flow.ico & icon.ico (${icoBuffer.length} bytes, 6 resolutions: ${icoSizes.join(', ')})`);

  console.log('Infinity Flow master assets generated successfully.');
}

// Auto-run when executed directly
generateAllAssets();
