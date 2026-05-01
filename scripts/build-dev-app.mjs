#!/usr/bin/env node
/**
 * Build a thin macOS .app wrapper around the cargo debug binary.
 *
 * Why this exists: in `tauri dev`, `target/debug/doxmind` is launched as a
 * raw Mach-O executable. Without an `Info.plist` LaunchServices can read,
 * macOS attributes the process to its parent (the IDE that ran `npm run
 * dev:desktop`), which is why Mission Control / window-preview corner
 * badges show the wrong icon. Wrapping the binary in a real .app gives the
 * dev process its own bundle identity and lets the OS draw the doXmind
 * logo as the corner badge — matching the production build's behavior.
 *
 * The wrapper hardlinks the cargo binary into Contents/MacOS so cargo
 * rebuilds reflect into the bundle without a copy step. The dev URL is
 * threaded in via LSEnvironment so the binary's runtime
 * `DOXMIND_DEV_URL` lookup (see lib.rs) picks up the right port.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildInfoPlist({ devUrl, backendUrl }) {
  const env = { DOXMIND_DEV_URL: devUrl };
  if (backendUrl) env.DOXMIND_BACKEND_URL = backendUrl;
  const envEntries = Object.entries(env)
    .map(
      ([key, value]) =>
        `        <key>${escapeXml(key)}</key>\n        <string>${escapeXml(value)}</string>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>doXmind</string>
    <key>CFBundleExecutable</key>
    <string>doXmind</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundleIdentifier</key>
    <string>com.doxmind.desktop.dev</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>doXmind</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0-dev</string>
    <key>CFBundleVersion</key>
    <string>0.1.0-dev</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.productivity</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>LSEnvironment</key>
    <dict>
${envEntries}
    </dict>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
</dict>
</plist>
`;
}

async function rmIfExists(p) {
  try {
    await fs.unlink(p);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

/**
 * Build the .app wrapper. Returns the absolute path to the .app.
 * @param {{ devUrl: string, backendUrl?: string }} opts
 */
export async function buildDevApp({ devUrl, backendUrl } = {}) {
  if (!devUrl) throw new Error("buildDevApp: devUrl is required");

  // Cargo.toml at the repo root declares a workspace, so cargo builds into
  // `<repo>/target/` — not `<repo>/src-tauri/target/`. The latter is a stale
  // pre-workspace directory; reading from it would hardlink an outdated
  // binary and silently mask any capability/code edits.
  const binaryPath = path.join(REPO_ROOT, "target/debug/doxmind");
  await fs.access(binaryPath).catch(() => {
    throw new Error(
      `Cargo binary not found at ${binaryPath}. Run \`cargo build\` in src-tauri first.`
    );
  });

  const appPath = path.join(REPO_ROOT, "target/debug/dev-app/doXmind.app");
  const macOSDir = path.join(appPath, "Contents/MacOS");
  const resourcesDir = path.join(appPath, "Contents/Resources");
  const wrappedBinary = path.join(macOSDir, "doXmind");
  const wrappedIcon = path.join(resourcesDir, "icon.icns");
  const infoPlistPath = path.join(appPath, "Contents/Info.plist");

  await fs.mkdir(macOSDir, { recursive: true });
  await fs.mkdir(resourcesDir, { recursive: true });

  // Hardlink the cargo binary so subsequent rebuilds are picked up without
  // a copy. Some target dirs (FUSE mounts, cross-volume builds) reject
  // hardlinks — fall back to copy in that case.
  await rmIfExists(wrappedBinary);
  try {
    await fs.link(binaryPath, wrappedBinary);
  } catch {
    await fs.copyFile(binaryPath, wrappedBinary);
  }
  await fs.chmod(wrappedBinary, 0o755);

  // Icon. The Info.plist references CFBundleIconFile=icon, so AppKit looks
  // up Resources/icon.icns.
  await fs.copyFile(path.join(REPO_ROOT, "src-tauri/icons/icon.icns"), wrappedIcon);

  await fs.writeFile(infoPlistPath, buildInfoPlist({ devUrl, backendUrl }), "utf8");

  // Bump the bundle's mtime so LaunchServices re-reads it next launch.
  const now = new Date();
  await fs.utimes(appPath, now, now);

  return appPath;
}

// CLI form: `node scripts/build-dev-app.mjs http://localhost:3000`
if (import.meta.url === `file://${process.argv[1]}`) {
  const devUrl = process.argv[2];
  if (!devUrl) {
    console.error("usage: build-dev-app.mjs <devUrl>");
    process.exit(1);
  }
  buildDevApp({ devUrl })
    .then((appPath) => {
      console.log(appPath);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
