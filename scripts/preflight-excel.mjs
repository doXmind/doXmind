#!/usr/bin/env node
/**
 * Cross-platform launcher for the Excel preflight pytest suite.
 *
 * Picks the right venv interpreter for the host OS, then runs pytest in
 * server/. Mirrors the resolution logic in scripts/dev.mjs so contributors
 * can run `npm run preflight:excel` from any platform without remembering
 * to swap `.venv/bin/python` for `.venv\Scripts\python.exe`.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");

function resolvePython() {
  if (process.env.DOXMIND_PYTHON) return process.env.DOXMIND_PYTHON;

  const isWindows = process.platform === "win32";
  const venvPython = isWindows
    ? path.join(SERVER_DIR, ".venv", "Scripts", "python.exe")
    : path.join(SERVER_DIR, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) return venvPython;

  const candidates = isWindows ? ["python", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (result.status === 0) return candidate;
  }

  console.error(
    "Could not find a Python interpreter. Create server/.venv first or " +
      "set DOXMIND_PYTHON to an explicit path."
  );
  process.exit(1);
}

const python = resolvePython();
const extra = process.argv.slice(2);
const child = spawn(
  python,
  ["-m", "pytest", "tests/test_excel_preflight_workflows.py", ...extra],
  { cwd: SERVER_DIR, stdio: "inherit" }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
