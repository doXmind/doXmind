"use strict";

/**
 * Allow-list for the doxmind-asset:// protocol.
 *
 * The protocol turns absolute disk paths into webview-loadable URLs
 * (preload.js convertFileSrc), so without a scope check it is an arbitrary
 * local-file read for anything running in the renderer — including an
 * `<img src="/…">` injected through document content. Confine it to
 * directories the user has actually put in play:
 *
 *   - a workspace folder chosen via the native picker,
 *   - the workspace roots the renderer passes to sidecar commands
 *     (workspace_scan, doc_read, …) and the sidecar's default root,
 *   - the parent directory of any file opened via Finder / argv / picker.
 *
 * Pure Node (no `electron` import) so it stays unit-testable.
 */

const fs = require("fs");
const path = require("path");

function canonical(p) {
  let resolved;
  try {
    resolved = fs.realpathSync(p);
  } catch {
    return null; // nonexistent paths are never registered nor served
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function createAssetScope() {
  /** Canonicalized directory roots the protocol may serve from. */
  const roots = new Set();

  /** Register a directory as servable. Silently ignores non-directories. */
  function addRoot(dirPath) {
    if (typeof dirPath !== "string" || !dirPath) return;
    const resolved = canonical(dirPath);
    if (!resolved) return;
    try {
      if (!fs.statSync(resolved).isDirectory()) return;
    } catch {
      return;
    }
    roots.add(resolved);
  }

  /** Register the parent directory of a file (picker / open-file / argv). */
  function addRootForFile(filePath) {
    if (typeof filePath !== "string" || !filePath) return;
    addRoot(path.dirname(filePath));
  }

  /**
   * True when `filePath` resolves (symlinks included) inside a registered
   * root. Nonexistent files are rejected — they are unservable anyway.
   */
  function allows(filePath) {
    if (typeof filePath !== "string" || !filePath) return false;
    const resolved = canonical(filePath);
    if (!resolved) return false;
    for (const root of roots) {
      if (resolved === root || resolved.startsWith(root + path.sep)) return true;
    }
    return false;
  }

  return { addRoot, addRootForFile, allows };
}

module.exports = { createAssetScope };
