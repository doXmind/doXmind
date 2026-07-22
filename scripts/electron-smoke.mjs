#!/usr/bin/env node
/**
 * Headless smoke test for the Electron shell's non-GUI plumbing:
 *   - the static server resolves the Next export (incl. SPA deep routes),
 *   - the native recursive workspace watcher emits a scoped change,
 *   - the native Node workspace dispatcher scans and reads Markdown Pages,
 *   - no Python/FastAPI process is started.
 *
 * This deliberately does NOT launch a BrowserWindow (no display needed in CI /
 * agent contexts). Run after `npm run build`:  node scripts/electron-smoke.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { startStaticServer } = require("../electron/static-server.js");
const { createNativeWorkspaceDispatcher } = require("../electron/native-workspace.js");
const { WindowRegistry, normalizeOpenPath } = require("../electron/window-registry.js");
const { createWorkspaceWatchers } = require("../electron/workspace-watchers.js");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    console.error("  ✗", name, extra ? `\n      ${extra}` : "");
  }
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

async function main() {
  const out = path.join(REPO_ROOT, "out");
  if (!fs.existsSync(path.join(out, "index.html"))) {
    console.error("No ./out static export — run `npm run build` first.");
    process.exit(2);
  }

  console.log("window registry:");
  const reg = new WindowRegistry();
  const folderTarget = { kind: "folder", path: "/Users/x/docs" };
  reg.set(1, folderTarget);
  reg.set(2, { kind: "file", path: "/Users/x/a.md" });
  check(
    "findId dedupes by exact {kind,path}",
    reg.findId({ kind: "folder", path: "/Users/x/docs" }) === 1
  );
  check("findId distinguishes kind", reg.findId({ kind: "file", path: "/Users/x/docs" }) === null);
  check(
    "findId distinguishes trailing slash",
    reg.findId({ kind: "folder", path: "/Users/x/docs/" }) === null
  );
  reg.clear(1);
  check("clear removes the entry", reg.findId(folderTarget) === null && reg.get(2) !== null);

  const regWs = fs.mkdtempSync(path.join(os.tmpdir(), "doxmind-norm-"));
  const mdPath = path.join(regWs, "Note.md");
  fs.writeFileSync(mdPath, "# hi");
  fs.writeFileSync(path.join(regWs, "Note.txt"), "nope");
  check("normalizeOpenPath accepts an existing .md", normalizeOpenPath(mdPath) === mdPath);
  check(
    "normalizeOpenPath rejects unsupported extension",
    normalizeOpenPath(path.join(regWs, "Note.txt")) === null
  );
  check(
    "normalizeOpenPath rejects a missing file",
    normalizeOpenPath(path.join(regWs, "Ghost.md")) === null
  );
  fs.rmSync(regWs, { recursive: true, force: true });

  console.log("workspace watcher:");
  const watchWs = fs.mkdtempSync(path.join(os.tmpdir(), "doxmind-watch-"));
  let resolveChanged = null;
  const workspaceWatchers = createWorkspaceWatchers({
    onChanged: (webContentsId, payload) => resolveChanged?.({ webContentsId, payload }),
    debounceMs: 25,
    maxCoalesceMs: 100,
  });
  try {
    workspaceWatchers.watch(901, watchWs);
    // macOS may report a root event when FSEvents first attaches. Let that
    // initial coalesce window drain so only the write below can satisfy the
    // assertion.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const changed = new Promise((resolve) => {
      resolveChanged = resolve;
    });
    fs.writeFileSync(path.join(watchWs, "External.md"), "# external\n");
    const event = await Promise.race([
      changed,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    check(
      "recursive native watch emits a canonical, webContents-scoped change",
      event?.webContentsId === 901 && event?.payload?.root === fs.realpathSync(watchWs)
    );
  } finally {
    workspaceWatchers.remove(901);
    fs.rmSync(watchWs, { recursive: true, force: true });
  }

  console.log("static server:");
  const server = await startStaticServer(out);
  const idx = await fetch(`${server.url}/`);
  const idxType = idx.headers.get("content-type") || "";
  check("/ serves 200 html", idx.status === 200 && idxType.includes("text/html"));
  const html = await idx.text();
  check("/editor/ resolves", (await fetch(`${server.url}/editor/`)).status === 200);
  const assetMatch = html.match(/\/_next\/static\/[^"']+\.js/);
  if (assetMatch) {
    const asset = await fetch(`${server.url}${assetMatch[0]}`);
    const assetType = asset.headers.get("content-type") || "";
    check(
      "/_next/*.js asset serves 200 javascript",
      asset.status === 200 && assetType.includes("javascript")
    );
  } else {
    check("found a /_next asset reference in index.html", false);
  }
  check(
    "SPA deep route /editor/<uuid>/ falls back to editor index",
    (await fetch(`${server.url}/editor/abc-123/`)).status === 200
  );
  const rendererJavaScript = filesUnder(path.join(out, "_next", "static"))
    .filter((file) => file.endsWith(".js"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  check(
    "production renderer fails closed when the Electron preload bridge is unavailable",
    rendererJavaScript.includes("refusing browser HTTP fallback")
  );
  check(
    "production renderer excludes the browser-development workspace transport",
    !/127\.0\.0\.1:8000|\/api\/workspace\/invoke/.test(rendererJavaScript)
  );

  console.log("native workspace:");
  const invokeWorkspace = createNativeWorkspaceDispatcher();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "doxmind-smoke-"));
  try {
    fs.writeFileSync(path.join(ws, "Hello.md"), "---\nid: smoke-1\ntitle: Hello\n---\n\n# Hi\n");

    const scan = await invokeWorkspace("workspace_scan", { root: ws });
    check(
      "workspace_scan returns the doc",
      Array.isArray(scan.documents) && scan.documents.some((d) => d.path === "Hello.md")
    );

    const read = await invokeWorkspace("doc_read", { root: ws, path: "Hello.md" });
    check(
      "doc_read returns source + revision",
      read.markdown === "# Hi\n" && /^sha256:/.test(read.revision)
    );
  } catch (err) {
    check("native workspace dispatch", false, err.message);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    await server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
