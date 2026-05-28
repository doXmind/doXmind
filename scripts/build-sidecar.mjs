#!/usr/bin/env node
/**
 * Build the FastAPI sidecar with PyInstaller and copy it to the location
 * Tauri's externalBin lookup expects:
 *
 *   src-tauri/binaries/doxmind-server-<rustc-host-target-triple>
 *
 * Tauri reads externalBin paths relative to src-tauri/, so the file the
 * `tauri build` step actually picks up is `binaries/doxmind-server-<triple>`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");
const VENV_PYTHON =
  process.platform === "win32"
    ? path.join(SERVER_DIR, ".venv", "Scripts", "python.exe")
    : path.join(SERVER_DIR, ".venv", "bin", "python");
const TARGET_DIR = path.join(REPO_ROOT, "src-tauri", "binaries");

function rustHostTriple() {
  // `rustc -vV` prints a `host: aarch64-apple-darwin` line on macOS arm64.
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = out.match(/^host:\s*(.+)$/m);
  if (!match) throw new Error(`Could not parse rustc -vV output:\n${out}`);
  return match[1].trim();
}

function resolvePython() {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  console.error(
    `\nNo venv at ${VENV_PYTHON}.\n` +
      `Create it first:\n` +
      `  python3 -m venv server/.venv\n` +
      `  server/.venv/bin/pip install -r server/requirements.txt pyinstaller\n`
  );
  process.exit(1);
}

function ensurePyInstaller(python) {
  const probe = spawnSync(python, ["-c", "import PyInstaller, sys; print(PyInstaller.__version__)"], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    console.log("[sidecar] installing PyInstaller into the venv...");
    const pip = spawnSync(python, ["-m", "pip", "install", "pyinstaller"], { stdio: "inherit" });
    if (pip.status !== 0) {
      console.error("[sidecar] failed to install PyInstaller");
      process.exit(pip.status ?? 1);
    }
  }
}

function run(cmd, args, opts = {}) {
  console.log(`[sidecar] $ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const triple = rustHostTriple();
  const python = resolvePython();
  ensurePyInstaller(python);

  // Run PyInstaller with the spec file. CWD must be server/ so the
  // `pathex=["."]` in the spec resolves correctly.
  run(
    python,
    [
      "-m",
      "PyInstaller",
      "--clean",
      "--noconfirm",
      "--distpath",
      path.join(SERVER_DIR, "dist"),
      "--workpath",
      path.join(SERVER_DIR, "build"),
      "doxmind-server.spec",
    ],
    { cwd: SERVER_DIR }
  );

  const exeExt = process.platform === "win32" ? ".exe" : "";
  const built = path.join(SERVER_DIR, "dist", `doxmind-server${exeExt}`);
  if (!fs.existsSync(built)) {
    console.error(`[sidecar] expected output at ${built} but it's missing`);
    process.exit(1);
  }

  fs.mkdirSync(TARGET_DIR, { recursive: true });
  const dest = path.join(TARGET_DIR, `doxmind-server-${triple}${exeExt}`);
  fs.copyFileSync(built, dest);
  fs.chmodSync(dest, 0o755);

  console.log(`\n[sidecar] ✓ ${dest}`);
}

main();
