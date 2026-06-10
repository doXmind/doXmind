#!/usr/bin/env node
/**
 * beforeBuildCommand for `tauri build`. Runs `next build` with the env
 * cleared so Next.js doesn't accidentally bake the dev rewrites' BACKEND_URL
 * into the static bundle.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env };
delete env.BACKEND_URL;
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
