#!/usr/bin/env node
/**
 * Headless smoke test for the Electron shell's non-GUI plumbing:
 *   - the static server resolves the Next export (incl. SPA deep routes),
 *   - the sidecar spawns and reports /health,
 *   - the workspace proxy reaches the sidecar (scan / doc_read / import_asset),
 *     exercising the Phase 0 additions.
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
const { findFreePort, spawnSidecar, waitForHealth } = require("../electron/sidecar.js");
const { proxyWorkspace } = require("../electron/workspace-proxy.js");
const { WindowRegistry, normalizeOpenPath } = require("../electron/window-registry.js");

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
  check("findId dedupes by exact {kind,path}", reg.findId({ kind: "folder", path: "/Users/x/docs" }) === 1);
  check("findId distinguishes kind", reg.findId({ kind: "file", path: "/Users/x/docs" }) === null);
  check("findId distinguishes trailing slash (Rust exact-equality)", reg.findId({ kind: "folder", path: "/Users/x/docs/" }) === null);
  reg.clear(1);
  check("clear removes the entry", reg.findId(folderTarget) === null && reg.get(2) !== null);

  const regWs = fs.mkdtempSync(path.join(os.tmpdir(), "doxmind-norm-"));
  const mdPath = path.join(regWs, "Note.md");
  fs.writeFileSync(mdPath, "# hi");
  fs.writeFileSync(path.join(regWs, "Note.txt"), "nope");
  check("normalizeOpenPath accepts an existing .md", normalizeOpenPath(mdPath) === mdPath);
  check("normalizeOpenPath rejects unsupported extension", normalizeOpenPath(path.join(regWs, "Note.txt")) === null);
  check("normalizeOpenPath rejects a missing file", normalizeOpenPath(path.join(regWs, "Ghost.md")) === null);
  fs.rmSync(regWs, { recursive: true, force: true });

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
    check("/_next/*.js asset serves 200 javascript", asset.status === 200 && assetType.includes("javascript"));
  } else {
    check("found a /_next asset reference in index.html", false);
  }
  check("SPA deep route /editor/<uuid>/ falls back to editor index", (await fetch(`${server.url}/editor/abc-123/`)).status === 200);

  console.log("sidecar + workspace proxy:");
  const port = await findFreePort();
  const sidecarUrl = `http://127.0.0.1:${port}`;
  const child = spawnSidecar({ repoRoot: REPO_ROOT, port, packaged: false });
  try {
    await waitForHealth(sidecarUrl, { timeoutMs: 30000 });
    check("sidecar /health ok", true);

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "doxmind-smoke-"));
    fs.writeFileSync(path.join(ws, "Hello.md"), "---\nid: smoke-1\ntitle: Hello\n---\n\n# Hi\n");

    const scan = await proxyWorkspace(sidecarUrl, "workspace_scan", { root: ws });
    check("workspace_scan returns the doc", Array.isArray(scan.documents) && scan.documents.some((d) => d.path === "Hello.md"));

    const read = await proxyWorkspace(sidecarUrl, "doc_read", { path: path.join(ws, "Hello.md") });
    check("doc_read returns markdown + correlation envelope", typeof read.markdown === "string" && "correlation" in read);

    const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x78];
    const imported = await proxyWorkspace(sidecarUrl, "workspace_import_asset", {
      root: ws,
      documentPath: "Hello.md",
      filename: "Pic.png",
      bytes: pngBytes,
    });
    check(
      "workspace_import_asset writes ./assets/Pic.png",
      imported.path === "./assets/Pic.png" && fs.existsSync(path.join(ws, "assets", "Pic.png"))
    );

    fs.rmSync(ws, { recursive: true, force: true });
  } catch (err) {
    check("sidecar boot + proxy", false, err.message);
  } finally {
    try {
      child.kill();
    } catch {
      // already gone
    }
    await server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
