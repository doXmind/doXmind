"use strict";

/**
 * Per-window open-target registry — the Node port of the Rust `WindowRegistry`
 * + `normalize_open_path` in src-tauri/src/lib.rs.
 *
 * Targets are `{ kind: 'file' | 'folder', path }`. De-duplication is by EXACT
 * `{kind, path}` equality (mirroring Rust's `t == target`), so the frontend is
 * the source of truth for a window's canonical path: it calls
 * register_window_target after openFolder/openFile resolves, and a window
 * created for a target is pre-registered so a concurrent focus-existing lookup
 * sees it before the JS side reports in.
 *
 * Pure Node (no `electron` import) so it can be unit-tested headlessly.
 */

const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED_EXTS = [".md", ".markdown", ".pdf", ".xlsx", ".xlsm"];

/**
 * Resolve an argv / file:// path into a canonical absolute path that points at
 * a document type doXmind can open, or null. Absolute paths are taken as-is
 * (matching the Rust behavior); relative paths are realpath-resolved.
 */
function normalizeOpenPath(input) {
  if (!input || typeof input !== "string") return null;
  let abs;
  if (path.isAbsolute(input)) {
    abs = input;
  } else {
    try {
      abs = fs.realpathSync(input);
    } catch {
      return null;
    }
  }
  if (!fs.existsSync(abs)) return null;
  const lower = abs.toLowerCase();
  if (!SUPPORTED_EXTS.some((ext) => lower.endsWith(ext))) return null;
  return abs;
}

function sameTarget(a, b) {
  return Boolean(a && b && a.kind === b.kind && a.path === b.path);
}

class WindowRegistry {
  constructor() {
    /** @type {Map<number, {kind:string, path:string}>} keyed by webContents id */
    this.targets = new Map();
  }

  set(id, target) {
    if (target) this.targets.set(id, target);
  }

  clear(id) {
    this.targets.delete(id);
  }

  get(id) {
    return this.targets.get(id) ?? null;
  }

  /** First window id whose target equals `target`, or null. */
  findId(target) {
    for (const [id, t] of this.targets) {
      if (sameTarget(t, target)) return id;
    }
    return null;
  }
}

module.exports = { normalizeOpenPath, sameTarget, WindowRegistry, SUPPORTED_EXTS };
