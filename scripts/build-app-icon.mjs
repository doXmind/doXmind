// Generate a macOS-compliant 1024x1024 source icon, then run `tauri icon`
// to regenerate every platform-specific size.
//
// The product icon is the black rounded-square tile with the white doXmind
// mark. Keep the 1024 canvas transparent around the tile so macOS can place it
// cleanly in Finder, Dock, Launchpad, and DMG windows.
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
// Apple's icon-grid template reserves ~10% margin (PAD=100) for the system
// shadow. That looks correct in the Dock/Finder but appears as a "halo" of
// empty pixels in our DMG view, where the squircle sits on a flat HFS
// background with no shadow rendering. PAD=40 keeps a small visual breathing
// room while letting the squircle fill the icon slot.
const PAD = 40;
const INNER = SIZE - PAD * 2;
const RADIUS = 215;

function squirclePath(x, y, w, h, r) {
  const k = 0.5519;
  const c = r * (1 - k);
  const x1 = x + r;
  const x2 = x + w - r;
  const y1 = y + r;
  const y2 = y + h - r;
  return [
    `M ${x1} ${y}`,
    `L ${x2} ${y}`,
    `C ${x2 + c} ${y} ${x + w} ${y + c} ${x + w} ${y1}`,
    `L ${x + w} ${y2}`,
    `C ${x + w} ${y2 + c} ${x2 + c} ${y + h} ${x2} ${y + h}`,
    `L ${x1} ${y + h}`,
    `C ${x1 - c} ${y + h} ${x} ${y2 + c} ${x} ${y2}`,
    `L ${x} ${y1}`,
    `C ${x} ${y1 - c} ${x1 - c} ${y} ${x1} ${y}`,
    "Z",
  ].join(" ");
}

const markScale = (INNER * 0.62) / 70;
const markSize = 70 * markScale;
const markOffset = (SIZE - markSize) / 2;

function markPath() {
  return [
    `<g transform="translate(${markOffset} ${markOffset}) scale(${markScale})">`,
    `  <path d="M5 0 Q0 0 0 5 L0 28 L35 35 L28 0 Z" fill="#FFFFFF"/>`,
    `  <path d="M42 0 L35 35 L70 28 L70 5 Q70 0 65 0 Z" fill="#FFFFFF"/>`,
    `  <path d="M0 42 L35 35 L28 70 L5 70 Q0 70 0 65 Z" fill="#FFFFFF"/>`,
    `  <path d="M35 35 L70 42 L70 65 Q70 70 65 70 L42 70 Z" fill="#FFFFFF"/>`,
    `</g>`,
  ].join("\n");
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <path d="${squirclePath(PAD, PAD, INNER, INNER, RADIUS)}" fill="#000000"/>
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
