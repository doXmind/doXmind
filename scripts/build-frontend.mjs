#!/usr/bin/env node
/**
 * Electron release frontend builder. Runs `next build` with the
 * optional browser-development tooling URL removed from the static bundle.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env };
delete env.NEXT_PUBLIC_API_URL;

const npmCli =
  process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : "npm";
const result = spawnSync(process.platform === "win32" ? process.execPath : npmCli, [
  ...(process.platform === "win32" ? [npmCli] : []),
  "run",
  "build",
], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
