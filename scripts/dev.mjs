#!/usr/bin/env node
/**
 * doXmind Mini — local dev launcher.
 *
 * Finds a free port for the FastAPI backend and another for Next.js, wires
 * BACKEND_URL through so the frontend rewrites hit the right place, spawns
 * both, labels their output, and shuts them down cleanly on Ctrl-C.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolvePython() {
  if (process.env.DOXMIND_PYTHON) return process.env.DOXMIND_PYTHON;

  const venvPython = path.join(REPO_ROOT, "server", ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) return venvPython;

  for (const candidate of ["python3", "python"]) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (result.status === 0) return candidate;
  }

  console.error(
    "Could not find a Python interpreter. Create server/.venv first " +
      "(python3 -m venv server/.venv && server/.venv/bin/pip install -r server/requirements.txt) " +
      "or set DOXMIND_PYTHON to an explicit path."
  );
  process.exit(1);
}

// Check both 0.0.0.0 and 127.0.0.1 — on macOS a process bound to 0.0.0.0
// doesn't always block a 127.0.0.1 bind, so probing only one host lets stale
// listeners slip through and the new process ends up racing them.
function tryListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function findFreePort(preferred, max = preferred + 100) {
  for (let port = preferred; port <= max; port++) {
    const okAny = await tryListen(port, "0.0.0.0");
    if (!okAny) continue;
    const okLocal = await tryListen(port, "127.0.0.1");
    if (okLocal) return port;
  }
  throw new Error(`No free port found between ${preferred} and ${max}`);
}

function label(name, color) {
  return (line) => `\x1b[${color}m[${name}]\x1b[0m ${line}`;
}

function pipe(child, tag) {
  const prefix = label(tag.name, tag.color);
  const forward = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix(line) + "\n");
    });
    stream.on("end", () => {
      if (buf.length) out.write(prefix(buf) + "\n");
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
}

async function main() {
  const backendPort = await findFreePort(8000);
  const frontendPort = await findFreePort(3000);

  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;

  console.log(`\n  doXmind Mini (local)`);
  console.log(`  backend  → ${backendUrl}`);
  console.log(`  frontend → ${frontendUrl}\n`);

  const python = resolvePython();
  console.log(`  python   → ${python}\n`);

  const backend = spawn(
    python,
    ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(backendPort), "--reload"],
    {
      cwd: path.join(REPO_ROOT, "server"),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(backendPort) },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  pipe(backend, { name: "backend", color: "36" });

  const frontend = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(frontendPort)],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BACKEND_URL: backendUrl,
        NEXT_PUBLIC_API_URL: "",
        PORT: String(frontendPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  pipe(frontend, { name: "frontend", color: "35" });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  received ${signal}, stopping…`);
    for (const c of [frontend, backend]) {
      if (c && !c.killed) c.kill("SIGTERM");
    }
    setTimeout(() => {
      for (const c of [frontend, backend]) {
        if (c && !c.killed) c.kill("SIGKILL");
      }
      process.exit(0);
    }, 2000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const onExit = (who) => (code) => {
    if (shuttingDown) return;
    console.log(`  ${who} exited (code=${code}), shutting down the other…`);
    shutdown("child-exit");
  };
  backend.on("exit", onExit("backend"));
  frontend.on("exit", onExit("frontend"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
