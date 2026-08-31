import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "public", "nixo-logo.png");
const ICONS = path.join(ROOT, "public", "icons");
const APP = path.join(ROOT, "src", "app");

/** Exact paths/colors from src/components/nixo-mark.tsx — not a new design. */
const MARK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 48 48">
  <rect x="1.5" y="1.5" width="45" height="45" rx="14" fill="#102824" stroke="#fbbf24" stroke-width="1.5"/>
  <path d="M14 14 L34 34 M34 14 L14 34" stroke="#34d399" stroke-width="4.2" stroke-linecap="round" fill="none"/>
  <path d="M14 14 L34 34 M34 14 L14 34" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round" fill="none"/>
</svg>`;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureSource() {
  if (await exists(SRC)) return;
  await sharp(Buffer.from(MARK_SVG)).png().toFile(SRC);
}

async function squareIcon(srcBuf, size, padRatio) {
  const pad = Math.round(size * padRatio);
  const inner = Math.max(1, size - pad * 2);
  const resized = await sharp(srcBuf)
    .resize(inner, inner, {
      fit: "contain",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, gravity: "centre" }])
    .png()
    .toBuffer();
}

function icoFromPngs(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const entries = [];
  for (const img of images) {
    const meta = img.size;
    const entry = Buffer.alloc(16);
    entry.writeUInt8(meta >= 256 ? 0 : meta, 0);
    entry.writeUInt8(meta >= 256 ? 0 : meta, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += img.buf.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
}

async function main() {
  await mkdir(ICONS, { recursive: true });
  await ensureSource();
  const srcBuf = await readFile(SRC);
  const sizes = [16, 32, 48, 180, 192, 512, 1024];
  const pngs = {};
  for (const size of sizes) {
    const buf = await squareIcon(srcBuf, size, 0.06);
    pngs[size] = buf;
    await writeFile(path.join(ICONS, `icon-${size}.png`), buf);
  }
  const maskable = await squareIcon(srcBuf, 512, 0.2);
  await writeFile(path.join(ICONS, "icon-512-maskable.png"), maskable);
  const ico = icoFromPngs([
    { size: 16, buf: pngs[16] },
    { size: 32, buf: pngs[32] },
    { size: 48, buf: pngs[48] },
  ]);
  await writeFile(path.join(ROOT, "public", "favicon.ico"), ico);
  await writeFile(path.join(APP, "favicon.ico"), ico);
  await writeFile(path.join(APP, "icon.png"), pngs[192]);
  await writeFile(path.join(APP, "apple-icon.png"), pngs[180]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
