// Generate a 1024x1024 source icon, then run `tauri icon` to regenerate every
// platform-specific size.
//
// The DMG/Finder surfaces already sit on a dark material background, so the
// icon itself should not carry an extra black tile. Keep the app icon as a
// transparent canvas with a high-contrast black/white doXmind mark that remains
// readable at 16px and 32px.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outDir = resolve(projectRoot, "src-tauri");
const sourcePath = resolve(outDir, "app-icon.png");

const SIZE = 1024;
const MARK_UNITS = 70;
const MARK_SIZE = 760;
const markScale = MARK_SIZE / MARK_UNITS;
const markSize = MARK_UNITS * markScale;
const markOffset = (SIZE - markSize) / 2;

function markPath() {
  return [
    `<g filter="url(#hairlineLift)" transform="translate(${markOffset} ${markOffset}) scale(${markScale})">`,
    `  <path d="M5 0 Q0 0 0 5 L0 28 L35 35 L28 0 Z" fill="#FFFFFF" stroke="#050505" stroke-width="2.3" stroke-linejoin="round"/>`,
    `  <path d="M42 0 L35 35 L70 28 L70 5 Q70 0 65 0 Z" fill="#FFFFFF" stroke="#050505" stroke-width="2.3" stroke-linejoin="round"/>`,
    `  <path d="M0 42 L35 35 L28 70 L5 70 Q0 70 0 65 Z" fill="#FFFFFF" stroke="#050505" stroke-width="2.3" stroke-linejoin="round"/>`,
    `  <path d="M35 35 L70 42 L70 65 Q70 70 65 70 L42 70 Z" fill="#FFFFFF" stroke="#050505" stroke-width="2.3" stroke-linejoin="round"/>`,
    `  <circle cx="35" cy="35" r="5.5" fill="#FFFFFF" stroke="#050505" stroke-width="1.8"/>`,
    `</g>`,
  ].join("\n");
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <filter id="hairlineLift" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000000" flood-opacity="0.18"/>
    </filter>
  </defs>
  ${markPath()}
</svg>`;

mkdirSync(outDir, { recursive: true });

await sharp(Buffer.from(svg)).png().toFile(sourcePath);
console.log(`wrote ${sourcePath}`);

// Regenerate every platform icon from the new source.
execSync(`npx tauri icon "${sourcePath}"`, {
  stdio: "inherit",
  cwd: projectRoot,
});

// macOS menu-bar (tray) template icon — black silhouette on transparent.
// Apple's HIG asks for 22pt logical / 44px @2x; the system tints it for the
// active menu bar appearance when icon_as_template(true) is set on the
// TrayIconBuilder.
const TRAY_BASE = 256;
const TRAY_PAD = 28; // ~11% breathing room so the mark doesn't kiss the edge
const traySize = TRAY_BASE - TRAY_PAD * 2;
const trayScale = traySize / 70;
const trayOffset = TRAY_PAD;

const traySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TRAY_BASE}" height="${TRAY_BASE}" viewBox="0 0 ${TRAY_BASE} ${TRAY_BASE}">
  <g transform="translate(${trayOffset} ${trayOffset}) scale(${trayScale})">
    <path d="M5 0 Q0 0 0 5 L0 28 L35 35 L28 0 Z" fill="#000000"/>
    <path d="M42 0 L35 35 L70 28 L70 5 Q70 0 65 0 Z" fill="#000000"/>
    <path d="M0 42 L35 35 L28 70 L5 70 Q0 70 0 65 Z" fill="#000000"/>
    <path d="M35 35 L70 42 L70 65 Q70 70 65 70 L42 70 Z" fill="#000000"/>
  </g>
</svg>`;

const trayPath = resolve(outDir, "icons", "tray-icon-template.png");
await sharp(Buffer.from(traySvg)).resize(44, 44).png().toFile(trayPath);
console.log(`wrote ${trayPath}`);
