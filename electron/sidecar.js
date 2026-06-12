"use strict";

/**
 * FastAPI sidecar lifecycle for the Electron shell — the Node equivalent of
 * the Rust `spawn_backend_*` helpers in src-tauri/src/lib.rs.
 *
 *   - dev:     run `python run_sidecar.py` from `server/` with PORT in env.
 *   - packaged: spawn the bundled PyInstaller one-dir binary from resources.
 *
 * There is no readiness signal today, and PyInstaller cold-extracts CPython,
 * so the caller MUST `waitForHealth()` before loading the renderer.
 *
 * Pure Node (no `electron` import) so scripts/electron-smoke.mjs can drive it.
 */

const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function resolvePython(repoRoot) {
  if (process.env.DOXMIND_PYTHON) return process.env.DOXMIND_PYTHON;
  const venv =
    process.platform === "win32"
      ? path.join(repoRoot, "server", ".venv", "Scripts", "python.exe")
      : path.join(repoRoot, "server", ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

/**
 * @param {{repoRoot:string, port:number, packaged?:boolean, resourcesPath?:string}} opts
 * @returns {import('node:child_process').ChildProcess}
 */
function spawnSidecar({ repoRoot, port, packaged = false, resourcesPath = "" }) {
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    // run_sidecar.py's watchdog self-terminates when this pid dies — covers
    // force-quit/crash, where 'will-quit' never fires and kill() never runs.
    DOXMIND_PARENT_PID: String(process.pid),
  };
  // PyInstaller appends .exe to the one-dir binary on Windows.
  const exeExt = process.platform === "win32" ? ".exe" : "";
  if (packaged) {
    const bin = path.join(resourcesPath, "doxmind-server", `doxmind-server${exeExt}`);
    return spawn(bin, [], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  }
  const python = resolvePython(repoRoot);
  return spawn(python, ["run_sidecar.py"], {
    cwd: path.join(repoRoot, "server"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function waitForHealth(baseUrl, { timeoutMs = 20000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL("/health", baseUrl);
  for (;;) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return true;
    } catch {
      // sidecar not accepting connections yet
    }
    if (Date.now() > deadline) {
      throw new Error(`sidecar did not become healthy within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = { findFreePort, resolvePython, spawnSidecar, waitForHealth };
