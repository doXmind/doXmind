// Generate the DMG installer background.
//
// The bundled DMG view uses Finder's icon view on a flat HFS canvas. With
// no background image, macOS Tahoe's Finder draws the canvas in dark mode
// (matching system theme), which (a) makes the app icon's transparent
// squircle margin look like a black halo and (b) prevents the standard
// Applications-folder icon from rendering — it falls back to a dashed
// "drop target" placeholder.
//
// A solid light background fixes both: the icon padding blends in, and
// Finder draws the standard folder icon over a known surface.
//
// Output: src-tauri/dmg/background.png (660x400) and background@2x.png
// (1320x800). bundle_dmg.sh picks @2x automatically when the suffix is
// present, but Tauri only reads the 1x path from tauri.conf.json — the
// @2x sibling is consumed by macOS Finder via the .DS_Store HiDPI hint.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outDir = resolve(projectRoot, "src-tauri", "dmg");
mkdirSync(outDir, { recursive: true });

// Window size from tauri.conf.json bundle.macOS.dmg.windowSize.
const W = 660;
const H = 400;

function svgFor(scale) {
  const sw = W * scale;
  const sh = H * scale;
  // Soft off-white field with a subtle vertical gradient. Matches the
  // tone Apple's own installer DMGs use, and reads well in both light and
  // dark Finder appearances.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fbfbfd"/>
      <stop offset="100%" stop-color="#f1f1f3"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
</svg>`;
}

await sharp(Buffer.from(svgFor(1)))
  .png()
  .toFile(resolve(outDir, "background.png"));
await sharp(Buffer.from(svgFor(2)))
  .png()
  .toFile(resolve(outDir, "background@2x.png"));

console.log(`wrote ${resolve(outDir, "background.png")} (${W}x${H})`);
console.log(`wrote ${resolve(outDir, "background@2x.png")} (${W * 2}x${H * 2})`);
