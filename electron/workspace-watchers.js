"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_MAX_COALESCE_MS = 800;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "target",
  ".next",
  "out",
  "dist",
  "build",
]);

function workspaceWatchKey(root) {
  if (typeof root !== "string" || !root)
    throw new Error("workspace watch root must be a non-empty string");
  return root.endsWith(path.sep) ? root.slice(0, -path.sep.length) : root;
}

function resolveWorkspaceRoot(root) {
  const canonical = fs.realpathSync(root);
  if (!fs.statSync(canonical).isDirectory())
    throw new Error(`workspace root is not a directory: ${root}`);
  return canonical;
}

function isIgnoredSegment(name) {
  return (
    name === ".doxmind" ||
    IGNORED_DIRECTORIES.has(name) ||
    (name.startsWith(".") && name.includes(".doxmind"))
  );
}

function watchPathIsRelevant(root, filename) {
  if (filename === null || filename === undefined) return true;
  let relative = Buffer.isBuffer(filename) ? filename.toString() : String(filename);
  if (!relative) return true;

  if (path.isAbsolute(relative)) {
    const fromRoot = path.relative(root, relative);
    if (fromRoot.startsWith(`..${path.sep}`) || fromRoot === ".." || path.isAbsolute(fromRoot))
      return true;
    relative = fromRoot;
  }

  return !relative.split(/[\\/]+/).some(isIgnoredSegment);
}

function defaultWatchFactory(root, options, listener) {
  return fs.watch(root, options, listener);
}

function createWorkspaceWatchers({
  onChanged,
  onError = () => {},
  resolveRoot = resolveWorkspaceRoot,
  watchFactory = defaultWatchFactory,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxCoalesceMs = DEFAULT_MAX_COALESCE_MS,
} = {}) {
  if (typeof onChanged !== "function") throw new TypeError("onChanged must be a function");

  const byWebContentsId = new Map();

  function clearTimers(entry) {
    if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
    if (entry.maxTimer !== null) clearTimeout(entry.maxTimer);
    entry.debounceTimer = null;
    entry.maxTimer = null;
    entry.pending = false;
  }

  function closeEntry(entry) {
    entry.active = false;
    clearTimers(entry);
    try {
      entry.watcher?.close();
    } catch {
      // The OS watcher is already closed.
    }
  }

  function flush(webContentsId, entry) {
    if (!entry.active || byWebContentsId.get(webContentsId) !== entry) return;
    clearTimers(entry);
    try {
      onChanged(webContentsId, { root: entry.root });
    } catch (error) {
      onError(error, webContentsId, entry.root);
    }
  }

  function queueChange(webContentsId, entry, filename) {
    if (!entry.active || byWebContentsId.get(webContentsId) !== entry) return;
    // Once a relevant change starts a coalesce window, every subsequent event
    // extends the quiet-period timer just like the Tauri receiver drain does.
    if (!entry.pending && !watchPathIsRelevant(entry.root, filename)) return;

    if (!entry.pending) {
      entry.pending = true;
      entry.maxTimer = setTimeout(() => flush(webContentsId, entry), maxCoalesceMs);
    }
    if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => flush(webContentsId, entry), debounceMs);
  }

  function watch(webContentsId, root) {
    const key = workspaceWatchKey(root);
    const previous = byWebContentsId.get(webContentsId);
    if (previous?.key === key) return;

    // Resolve and start the replacement before touching the registry. A failed
    // folder swap therefore leaves the existing watcher alive.
    const canonical = resolveRoot(root);
    const entry = {
      key,
      root: canonical,
      watcher: null,
      debounceTimer: null,
      maxTimer: null,
      pending: false,
      active: true,
    };
    let watcher;
    try {
      watcher = watchFactory(canonical, { recursive: true }, (_eventType, filename) => {
        queueChange(webContentsId, entry, filename);
      });
      if (!watcher || typeof watcher.close !== "function")
        throw new Error("workspace watcher did not return a closeable handle");
      entry.watcher = watcher;
      if (typeof watcher.on === "function") {
        watcher.on("error", (error) => {
          if (byWebContentsId.get(webContentsId) !== entry) return;
          byWebContentsId.delete(webContentsId);
          closeEntry(entry);
          onError(error, webContentsId, canonical);
        });
      }
    } catch (error) {
      try {
        watcher?.close();
      } catch {
        // The partially-created watcher is already closed.
      }
      throw error;
    }

    byWebContentsId.set(webContentsId, entry);
    if (previous) closeEntry(previous);
  }

  function unwatch(webContentsId, root) {
    const entry = byWebContentsId.get(webContentsId);
    if (!entry || entry.key !== workspaceWatchKey(root)) return;
    byWebContentsId.delete(webContentsId);
    closeEntry(entry);
  }

  function remove(webContentsId) {
    const entry = byWebContentsId.get(webContentsId);
    if (!entry) return;
    byWebContentsId.delete(webContentsId);
    closeEntry(entry);
  }

  return { watch, unwatch, remove };
}

module.exports = { createWorkspaceWatchers, watchPathIsRelevant, workspaceWatchKey };
