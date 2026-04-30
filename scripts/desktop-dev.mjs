#!/usr/bin/env node
/**
 * Wrapper around `tauri dev` that picks a free port for Next.js and
 * threads it through both `beforeDevCommand` and `devUrl`.
 *
 * Without this, when port 3000 is already in use (a stray previous
 * `next dev`, another project, etc.) `next dev` silently falls back to
 * 3001 — but tauri.conf.json still points devUrl at 3000, so the Tauri
 * WebView ends up loading whatever happens to be on 3000 (often a 500
 * "Internal Server Error" from an orphaned process). Picking the port
 * up front and overriding both ends of the wiring keeps dev mode
 * deterministic.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tryListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function findFreePort(preferred, max = preferred + 200) {
  for (let port = preferred; port <= max; port++) {
    const okAny = await tryListen(port, "0.0.0.0");
    if (!okAny) continue;
    const okLocal = await tryListen(port, "127.0.0.1");
    if (okLocal) return port;
  }
  throw new Error(`No free port between ${preferred} and ${max}`);
}

async function main() {
  const port = await findFreePort(3000);
  const devUrl = `http://localhost:${port}`;

  // Override two fields in tauri.conf.json: the URL the WebView loads,
  // and the command that boots the dev server (must match the URL).
  //
  // Desktop validation needs the dev server to prioritize stability over
  // fastest cold boot. Turbopack can leave the Tauri WebView stuck behind
  // React Client Manifest overlays after hot restarts, so use Next's
  // standard dev server for the desktop shell.
  const overrideConfig = {
    build: {
      devUrl,
      beforeDevCommand: `next dev -p ${port}`,
    },
  };

  console.log(`\n  doXmind desktop (dev)`);
  console.log(`  next  → ${devUrl}\n`);

  const child = spawn(
    "tauri",
    ["dev", "--config", JSON.stringify(overrideConfig)],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env },
    }
  );

  const forward = (signal) => () => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
