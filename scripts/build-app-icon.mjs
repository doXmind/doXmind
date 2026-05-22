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

// New logo authored at viewBox 312x365 (taller than wide). Center it inside
// the square mark slot using the larger of the two source dimensions.
const MARK_W = 312;
const MARK_H = 365;
const MARK_PATHS = [
  "M299.549 68.4403C306.094 68.5801 307.674 70.6253 311.067 75.7147C311.7 89.2549 312.588 192.228 310.608 198.01C309.931 199.973 307.143 200.99 305.337 201.761C297.999 204.894 289.575 206.335 281.836 208.31L209.711 226.757C197.982 229.76 194.735 232.632 182.956 227.878C174.11 224.743 166 221.134 166.342 209.861C167.194 182.012 167.026 154.255 167.34 126.393C167.398 118.7 169.968 115.822 177.146 113.375C217.792 99.5283 258.918 81.6449 299.549 68.4403Z",
  "M304.784 225.796C307.194 226.012 307.274 226.114 309.4 227.388C311.955 230.685 311.489 234.924 311.511 239.177L311.423 310.969C311.467 321.4 311.365 333.591 311.511 343.737C311.868 367.503 297.591 364.543 279.878 364.651C274.309 364.685 267.793 364.646 262.07 364.644L186.705 364.6C185.78 364.439 184.798 364.276 183.924 363.919C182.468 363.326 181.427 361.943 180.925 360.498C179.723 357.098 179.76 280.213 180.32 270.485C180.473 267.84 180.648 265.16 181.995 262.816C182.948 261.151 184.113 259.566 185.868 258.716C194.997 254.294 211.567 251.389 222.007 248.544L304.784 225.796Z",
  "M10.8653 0C15.2997 0.173285 51.7863 9.64718 56.2324 11.332C69.7343 16.4483 124.332 26.3917 133.298 33.5874C135.895 40.5021 135.7 67.7355 136.039 77.1562L138.539 143.821C138.837 154.053 139.245 164.282 139.762 174.505C140.068 180.52 142.448 196.704 137.367 201.658C135.988 203.001 133.413 202.545 131.55 202.311L49.2892 168.539C40.7268 165.049 4.65673 152.007 1.23719 146.574C-0.147519 140.627 0.336599 121.084 0.343151 113.845L0.546309 49.9272C0.595815 37.5068 -1.41354 19.3366 1.97761 7.20735C3.07329 3.28878 7.19971 1.36371 10.8653 0Z",
  "M3.82611 174.398C16.9634 175.105 74.0232 202.99 90.0617 207.778C101.544 211.207 149.03 230.065 155.946 237.687C158.88 240.921 157.744 292.324 157.715 302.793L157.992 351.087C158.006 356.84 158.53 360.629 154.614 364.547C142.332 364.79 129.703 364.678 117.4 364.619C83.4097 364.458 49.338 365.142 15.3733 364.311C4.77398 364.052 0.506303 357.162 0.464806 347.372C0.30828 309.853 0.389082 272.343 0.419659 234.83L0.454586 197.477C0.461866 191.458 0.391991 185.055 0.707955 179.035C0.792407 177.434 2.70276 175.575 3.82611 174.398Z",
];

const markScale = (INNER * 0.62) / Math.max(MARK_W, MARK_H);
const markRenderW = MARK_W * markScale;
const markRenderH = MARK_H * markScale;
const markOffsetX = (SIZE - markRenderW) / 2;
const markOffsetY = (SIZE - markRenderH) / 2;

function markPath(fill) {
  return [
    `<g transform="translate(${markOffsetX} ${markOffsetY}) scale(${markScale})" fill="${fill}">`,
    ...MARK_PATHS.map((d) => `  <path d="${d}"/>`),
    `</g>`,
  ].join("\n");
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <path d="${squirclePath(PAD, PAD, INNER, INNER, RADIUS)}" fill="#000000"/>
  ${markPath("#FFFFFF")}
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
const trayScale = traySize / Math.max(MARK_W, MARK_H);
const trayRenderW = MARK_W * trayScale;
const trayRenderH = MARK_H * trayScale;
const trayOffsetX = (TRAY_BASE - trayRenderW) / 2;
const trayOffsetY = (TRAY_BASE - trayRenderH) / 2;

const traySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TRAY_BASE}" height="${TRAY_BASE}" viewBox="0 0 ${TRAY_BASE} ${TRAY_BASE}">
  <g transform="translate(${trayOffsetX} ${trayOffsetY}) scale(${trayScale})" fill="#000000">
${MARK_PATHS.map((d) => `    <path d="${d}"/>`).join("\n")}
  </g>
</svg>`;

const trayPath = resolve(outDir, "icons", "tray-icon-template.png");
await sharp(Buffer.from(traySvg)).resize(44, 44).png().toFile(trayPath);
console.log(`wrote ${trayPath}`);
