#!/usr/bin/env node
/**
 * macOS desktop dev launcher.
 *
 * The previous implementation shelled out to `tauri dev`, which spawns the
 * raw `target/debug/doxmind` Mach-O executable. That works for hot reload
 * but leaves the dev process without a LaunchServices bundle — so macOS
 * attributes the window to whatever launched the npm script (your IDE),
 * and Mission Control / window-preview corner badges show the wrong icon.
 *
 * This script instead:
 *   1. Picks a free port and starts `next dev` directly (so it survives
 *      independently of the Tauri shell).
 *   2. Compiles the cargo binary directly via `cargo build` in src-tauri/.
 *      We deliberately do NOT use `tauri build --debug --no-bundle` here:
 *      the Tauri CLI runs `beforeBuildCommand` (a production `next build`
 *      that writes static-export artifacts into .next/) which collides with
 *      the running `next dev` server's chunks. Plain cargo still triggers
 *      tauri-build (codegen, embedded Info.plist, capability checks) via
 *      `build.rs`, which is all we need. The cargo binary reads
 *      DOXMIND_DEV_URL at runtime (see lib.rs), so the dev port doesn't
 *      need to be baked in at compile time.
 *   3. Wraps the compiled binary in a thin .app under
 *      `src-tauri/target/debug/dev-app/doXmind.app` (see build-dev-app.mjs)
 *      with a real Info.plist + icon.icns + LSEnvironment.DOXMIND_DEV_URL.
 *   4. Launches that .app via `open --wait-apps`. macOS now treats the
 *      process as a proper app — dock tile, Cmd+Tab, AND the Mission
 *      Control / window-preview corner badges all show the doXmind logo.
 *
 * Trade-off vs. `tauri dev`: Rust changes don't auto-rebuild + relaunch.
 * Re-run `npm run dev:desktop` after editing any .rs file. Frontend
 * changes still hot-reload via Next.js.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { buildDevApp } from "./build-dev-app.mjs";

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
    if (!(await tryListen(port, "0.0.0.0"))) continue;
    if (await tryListen(port, "127.0.0.1")) return port;
  }
  throw new Error(`No free port between ${preferred} and ${max}`);
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      // Next.js returns 200 once the dev server is fully ready. Earlier
      // responses (during compilation) are 404/500 — keep polling.
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function spawnInherit(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    ...options,
  });
  return child;
}

function spawnAwait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnInherit(command, args, options);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function killAppByBundleId(bundleId) {
  // Best-effort: tell the app to quit cleanly via osascript, then SIGTERM
  // any lingering processes by bundle id. Suppress all errors — this runs
  // during teardown and we don't want noisy output.
  try {
    await spawnAwait(
      "osascript",
      ["-e", `tell application id "${bundleId}" to quit`],
      { stdio: "ignore" }
    );
  } catch {
    // not running, or osascript refused — fall through to pkill
  }
  try {
    await spawnAwait("pkill", ["-f", `dev-app/doXmind.app/Contents/MacOS/doXmind`], {
      stdio: "ignore",
    });
  } catch {
    // nothing to kill — fine
  }
}

async function main() {
  const port = await findFreePort(3000);
  const devUrl = `http://localhost:${port}`;
  const bundleId = "com.doxmind.desktop.dev";

  console.log("\n  doXmind desktop (dev)");
  console.log(`  next  → ${devUrl}\n`);

  // 1. Start Next.js. Stays alive until we kill it on exit.
  const next = spawnInherit("npx", ["next", "dev", "-p", String(port)]);

  let cleaningUp = false;
  const cleanup = async (signal = "SIGTERM") => {
    if (cleaningUp) return;
    cleaningUp = true;
    await killAppByBundleId(bundleId).catch(() => {});
    if (!next.killed) {
      try {
        next.kill(signal);
      } catch {
        // already gone
      }
    }
  };

  process.on("SIGINT", () => cleanup("SIGINT").then(() => process.exit(130)));
  process.on("SIGTERM", () => cleanup("SIGTERM").then(() => process.exit(143)));
  next.on("exit", (code) => {
    if (cleaningUp) return;
    cleanup("SIGTERM").then(() => process.exit(code ?? 1));
  });

  try {
    await waitForUrl(devUrl, 60_000);
  } catch (err) {
    console.error(`[desktop-dev] ${err.message}`);
    await cleanup();
    process.exit(1);
  }

  // 2. Compile the Tauri binary directly with cargo. tauri-build (invoked
  //    from build.rs) still runs, so codegen + the standard embedded
  //    Info.plist are produced — we just skip the CLI's `beforeBuildCommand`
  //    (which would clobber the running dev server's .next/ directory).
  console.log("[desktop-dev] compiling cargo binary…");
  try {
    await spawnAwait("cargo", ["build"], {
      cwd: path.join(REPO_ROOT, "src-tauri"),
    });
  } catch (err) {
    console.error(`[desktop-dev] cargo build failed: ${err.message}`);
    await cleanup();
    process.exit(1);
  }

  // 3. Build the .app wrapper.
  let appPath;
  try {
    appPath = await buildDevApp({ devUrl });
  } catch (err) {
    console.error(`[desktop-dev] failed to build .app wrapper: ${err.message}`);
    await cleanup();
    process.exit(1);
  }
  console.log(`[desktop-dev] launching ${appPath}`);

  // 4. Launch the .app. `--wait-apps` blocks until the app exits, so when
  //    the user closes the window we fall through to cleanup.
  //    `-n` forces a fresh instance even if a previous run is lingering.
  const opened = spawnInherit("open", ["-W", "-n", "-a", appPath]);
  opened.on("exit", () => {
    cleanup("SIGTERM").then(() => process.exit(0));
  });
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
