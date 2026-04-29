// Generate a macOS-compliant 1024x1024 source icon, then run `tauri icon`
// to regenerate every platform-specific size.
//
// macOS Big Sur+ icon spec:
//   - 1024x1024 transparent canvas
//   - Visible content sits in an 824x824 squircle, centered (100px padding)
//   - Apple uses a continuous-curvature ("squircle") corner, ~185px radius
//
// We approximate the squircle with cubic beziers using Figma's well-known
// control-point ratio (k = 0.5519).
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
const PAD = 100; // 10% transparent margin around the squircle
const INNER = SIZE - PAD * 2; // 824 — the squircle's bounding box
const RADIUS = 185; // squircle corner radius for the 824 box (Apple ~22.4%)

// Squircle path using cubic-bezier corner approximation
function squirclePath(x, y, w, h, r) {
  const k = 0.5519; // bezier control offset for circular-ish corners
  const c = r * (1 - k); // distance from corner endpoint to control point
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

// The pinwheel mark, sized to fit inside the inner squircle with breathing room.
// Coordinates below were lifted from public/icon.svg and re-centred for 1024.
const markScale = INNER * 0.62 / 70; // pinwheel art is 70 units wide originally
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
