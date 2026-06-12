"use strict";

/**
 * doXmind Electron main process.
 *
 * Boot sequence (mirrors the Tauri shell in src-tauri/src/lib.rs):
 *   1. Serve the Next static export (./out) from http://127.0.0.1:<port>.
 *   2. Spawn the FastAPI sidecar on its own free port and WAIT for /health.
 *   3. Inject the sidecar URL into the renderer (preload -> __TAURI_BACKEND_URL__).
 *   4. Open the main window; dispatch shell:invoke commands.
 *   5. On quit, kill the sidecar and close the static server.
 *
 * Workspace/document commands are proxied to the sidecar (workspace-proxy.js).
 * Shell-native commands (dialogs, windows, save-pdf) are handled here.
 */

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, webContents, Menu, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { startStaticServer } = require("./static-server");
const { findFreePort, spawnSidecar, waitForHealth } = require("./sidecar");
const { isWorkspaceCommand, proxyWorkspace } = require("./workspace-proxy");
const { WindowRegistry, normalizeOpenPath } = require("./window-registry");
const menus = require("./menus");

const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "out");
const ICON_DIR = path.join(REPO_ROOT, "src-tauri", "icons");
const APP_ICON = path.join(ICON_DIR, "icon.png");
const TRAY_ICON = path.join(ICON_DIR, "tray-icon-template.png");

let rendererServer = null; // { url, port, close }
let sidecarUrl = null;
let sidecarChild = null;
let pendingOpenPaths = [];
let currentRecents = [];
let tray = null;

// Per-window open-target registry, keyed by webContents.id.
const registry = new WindowRegistry();
// Event listeners registered via @tauri-apps/api/event: {eventId, eventName, webContentsId, handlerId}.
const eventListeners = [];
let nextEventId = 1;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "doxmind-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

// Finder "Open With" / drag-to-dock. On a cold launch this fires before
// 'ready', so buffer the paths and drain them once a window exists (Phase 4
// adds normalization + single-instance routing).
app.on("open-file", (event, openedPath) => {
  event.preventDefault();
  if (enqueueOpenPath(openedPath)) notifyOpenPending();
});

function urlForTarget(target) {
  // `/` redirects to `/editor` via router.replace WITHOUT preserving the
  // query, so deep-link windows must load the editor route directly.
  const base = `${rendererServer.url}/editor/`;
  if (!target) return base;
  if (target.kind === "folder") return `${base}?folder=${encodeURIComponent(target.path)}`;
  if (target.kind === "file") return `${base}?file=${encodeURIComponent(target.path)}`;
  return base;
}

function createWindow(target) {
  const isMac = process.platform === "darwin";
  // macOS gets the frameless/vibrancy chrome the frontend's is-tauri-macos CSS
  // expects; other platforms use a normal native frame (title bar + min/max/
  // close) and an opaque background — the macOS-only chrome CSS never applies
  // there, so a transparent/frameless window would have no way to be moved or
  // closed.
  const platformArg = isMac ? "macos" : process.platform === "win32" ? "windows" : "linux";
  const chrome = isMac
    ? {
        titleBarStyle: "hiddenInset",
        // Align the traffic lights to the header's natural content center. The
        // header is h-11 (44px) and flex-centers its buttons at y=22. The native
        // traffic-light cluster's visual center sits ~5px below trafficLightPosition.y,
        // so y≈19 lands the dots' center on the toggle/search buttons' line (which
        // no longer carry any top-offset nudge). x=12 matches the sidebar's left
        // content edge and clears the 76px left-controls inset.
        trafficLightPosition: { x: 12, y: 19 },
        transparent: true,
        vibrancy: "sidebar",
        backgroundColor: "#00000000",
      }
    : {
        backgroundColor: "#ffffff",
        icon: APP_ICON,
      };
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "doXmind",
    ...chrome,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      additionalArguments: [`--doxmind-backend-url=${sidecarUrl}`, `--doxmind-platform=${platformArg}`],
    },
  });
  // Pre-register so a concurrent focus-existing lookup sees this window before
  // its JS calls register_window_target (mirrors create_editor_window).
  if (target) registry.set(win.webContents.id, target);
  const wcId = win.webContents.id;
  win.webContents.on("destroyed", () => {
    registry.clear(wcId);
    for (let i = eventListeners.length - 1; i >= 0; i--) {
      if (eventListeners[i].webContentsId === wcId) eventListeners.splice(i, 1);
    }
  });
  attachCloseToSave(win);
  win.loadURL(urlForTarget(target));
  return win;
}

function focusOrCreate(target) {
  const id = registry.findId(target);
  if (id !== null) {
    const existing = BrowserWindow.getAllWindows().find((w) => w.webContents.id === id);
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return null;
    }
    registry.clear(id); // stale entry — fall through to create
  }
  createWindow(target);
  return null;
}

// ── Shell-native command handlers ──────────────────────────────────────────

async function pickFolder(win, title) {
  const result = await dialog.showOpenDialog(win, {
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    return fs.realpathSync(result.filePaths[0]);
  } catch {
    return result.filePaths[0];
  }
}

async function pickFile(win, title, filters) {
  const result = await dialog.showOpenDialog(win, {
    title,
    properties: ["openFile"],
    filters: filters || [],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

async function pickSave(win, title, defaultName, filters) {
  const result = await dialog.showSaveDialog(win, {
    title,
    defaultPath: defaultName || undefined,
    filters: filters || [],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

// Resolve a dropped path: follow symlinks and report whether it's a directory
// so the welcome screen can decide between openFolder and openFile. Returns
// null when the path can't be stat'd (deleted/permission), which the caller
// treats as "skip this drop".
function resolveDroppedPath(p) {
  if (typeof p !== "string" || !p) return null;
  let real = p;
  try {
    real = fs.realpathSync(p);
  } catch {
    // Keep the original path if realpath fails; stat below still validates it.
  }
  try {
    return { path: real, isDirectory: fs.statSync(real).isDirectory() };
  } catch {
    return null;
  }
}

function saveWindowPdf({ targetPath, bytes }) {
  if (!targetPath) throw new Error("save_window_pdf requires targetPath");
  const buf = Buffer.from(bytes || []);
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("payload is not a PDF (missing %PDF- header)");
  }
  fs.writeFileSync(targetPath, buf);
  return null;
}

function registerEventListener(sender, args) {
  const eventId = nextEventId++;
  eventListeners.push({
    eventId,
    eventName: args.event,
    webContentsId: sender.id,
    handlerId: args.handler,
  });
  return eventId;
}

// ── Native -> renderer event bridge ─────────────────────────────────────────
// @tauri-apps/api/event delivers events by invoking the transformCallback'd
// handler with the full event object; the preload's 'tauri://callback' channel
// looks up the handler id and calls it.
function deliver(eventName, payload, targetIds) {
  for (const l of eventListeners) {
    if (l.eventName !== eventName) continue;
    if (targetIds && !targetIds.has(l.webContentsId)) continue;
    const wc = webContents.fromId(l.webContentsId);
    if (wc && !wc.isDestroyed()) {
      wc.send("tauri://callback", {
        id: l.handlerId,
        data: { event: eventName, id: l.eventId, payload },
      });
    }
  }
}

function emitToAll(eventName, payload) {
  deliver(eventName, payload, null);
}

function emitToFocused(eventName, payload) {
  const focused = BrowserWindow.getFocusedWindow();
  // Mirror Rust's emit_to_focused: fall back to broadcast when nothing focused.
  deliver(eventName, payload, focused ? new Set([focused.webContents.id]) : null);
}

function focusMainWindow() {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length) {
    const win = wins[0];
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    createWindow(null);
  }
}

function focusThenEmitAll(eventName) {
  if (!BrowserWindow.getFocusedWindow()) focusMainWindow();
  emitToAll(eventName, null);
}

function menuDeps() {
  return { recents: currentRecents, emitToAll, emitToFocused, focusThenEmitAll, focusMainWindow };
}

async function refreshMenus() {
  const deps = menuDeps();
  Menu.setApplicationMenu(menus.buildAppMenu(deps));
  if (process.platform === "darwin" && app.dock) {
    app.dock.setMenu(await menus.buildDockMenu(deps));
  }
  if (tray) tray.setContextMenu(menus.buildTrayMenu(deps));
}

// Close-to-save: intercept the window close, ask the renderer to flush, and
// only then destroy. A max-wait timeout guards against a hung/listener-less
// renderer. The closing guard lives here (not in the renderer) keyed by window.
function attachCloseToSave(win) {
  win.on("close", (event) => {
    if (win._doxmindClosing) return;
    event.preventDefault();
    win._doxmindClosing = true;
    deliver("shell://close-requested", null, new Set([win.webContents.id]));
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, 3000);
  });
}

async function dispatch(event, cmd, args) {
  if (isWorkspaceCommand(cmd)) return proxyWorkspace(sidecarUrl, cmd, args);

  const sender = event.sender;
  const win = BrowserWindow.fromWebContents(sender);
  switch (cmd) {
    case "get_backend_url":
      return sidecarUrl;
    case "pick_workspace_folder":
      return pickFolder(win, args.title);
    case "pick_workspace_file":
      return pickFile(win, args.title, args.filters);
    case "pick_save_location":
      return pickSave(win, args.title, args.defaultName, args.filters);
    case "register_window_target":
      registry.set(sender.id, args.target);
      return null;
    case "unregister_window_target":
      registry.clear(sender.id);
      return null;
    case "current_window_open_target":
      return registry.get(sender.id);
    case "open_window_for_target":
      return focusOrCreate(args.target);
    case "force_open_new_window_for_target":
      createWindow(args.target);
      return null;
    case "open_new_window":
      createWindow(null);
      return null;
    case "dock_set_recents":
      currentRecents = Array.isArray(args.recents) ? args.recents : [];
      await refreshMenus();
      return null;
    case "take_pending_open_paths": {
      const drained = pendingOpenPaths;
      pendingOpenPaths = [];
      return drained;
    }
    case "resolve_dropped_path":
      return resolveDroppedPath(args.path);
    case "save_window_pdf":
      return saveWindowPdf(args);
    case "shell_close_window":
      if (win) {
        win._doxmindClosing = true;
        win.destroy();
      }
      return null;
    case "plugin:event|listen":
      return registerEventListener(sender, args);
    case "plugin:event|unlisten": {
      const idx = eventListeners.findIndex((l) => l.eventId === args.eventId);
      if (idx >= 0) eventListeners.splice(idx, 1);
      return null;
    }
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      return null; // renderer->renderer emit is unused by the app
    case "plugin:opener|open_url":
      if (typeof args.url === "string" && /^(https?:|mailto:)/i.test(args.url)) {
        await shell.openExternal(args.url);
      }
      return null;
    case "plugin:opener|open_path":
      if (typeof args.path === "string") await shell.openPath(args.path);
      return null;
    case "plugin:opener|reveal_item_in_dir":
      for (const p of args.paths || []) shell.showItemInFolder(p);
      return null;
    default:
      throw new Error(`unhandled shell command: ${cmd}`);
  }
}

function handleAsset(request) {
  // convertFileSrc emits doxmind-asset://local/<encoded-absolute-path>.
  const url = new URL(request.url);
  const filePath = decodeURIComponent(url.pathname.replace(/^\//, ""));
  // Phase 3 will confine this to the active workspace root.
  return net.fetch(pathToFileURL(filePath).toString());
}

function pipeChild(child) {
  const forward = (stream, sink) => {
    stream.on("data", (chunk) => sink.write(`[sidecar] ${chunk}`));
  };
  if (child.stdout) forward(child.stdout, process.stdout);
  if (child.stderr) forward(child.stderr, process.stderr);
  child.on("exit", (code) => console.error(`[doxmind] sidecar exited (code ${code})`));
}

async function boot() {
  // Set the Dock icon before the sidecar wait so the macOS-shaped logo shows
  // immediately. In a packaged build electron-builder's mac.icon (.icns) owns
  // the bundle icon; this is the dev/unbundled path (mirrors Rust's
  // apply_dock_icon via setApplicationIconImage on icons/icon.png).
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(APP_ICON);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  if (!fs.existsSync(path.join(OUT_DIR, "index.html"))) {
    throw new Error(`missing static export at ${OUT_DIR} — run \`npm run build\` first`);
  }
  rendererServer = await startStaticServer(OUT_DIR);

  const port = await findFreePort();
  sidecarUrl = `http://127.0.0.1:${port}`;
  sidecarChild = spawnSidecar({
    repoRoot: REPO_ROOT,
    port,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  pipeChild(sidecarChild);
  await waitForHealth(sidecarUrl);

  protocol.handle("doxmind-asset", handleAsset);
  ipcMain.handle("shell:invoke", dispatch);

  // Native menu bar + Dock menu + Tray. Recents are empty until the frontend
  // pushes them via dock_set_recents (which calls refreshMenus).
  if (process.platform === "darwin") {
    try {
      tray = menus.createTray(TRAY_ICON, menuDeps());
    } catch (err) {
      console.error("[doxmind] tray install failed:", err);
    }
  }
  await refreshMenus();

  // If the OS launched us on a file (Finder "Open With" fires 'open-file'
  // before 'ready' on a cold launch), point the first window straight at it
  // instead of flashing the welcome screen. Remaining paths stay queued for
  // the frontend to drain via take_pending_open_paths.
  const first = pendingOpenPaths.length ? pendingOpenPaths.shift() : null;
  createWindow(first ? { kind: "file", path: first } : null);

  // Background update checks (packaged builds only; no-op in dev).
  require("./updater").initAutoUpdater();
}

function enqueueOpenPath(raw) {
  const normalized = normalizeOpenPath(raw);
  if (normalized) {
    pendingOpenPaths.push(normalized);
    return true;
  }
  return false;
}

// Ping the frontend to drain queued paths (NativeMenuListener calls
// take_pending_open_paths -> openWindowForTarget). No-op on cold launch
// (no listener yet) — the first window pops the first path and the listener
// drains the rest on mount.
function notifyOpenPending() {
  if (app.isReady() && BrowserWindow.getAllWindows().length) {
    emitToAll("os://open-pending", null);
  }
}

// Single-instance: a second `open -a doXmind foo.md` (or Finder "Open With"
// while running) routes into the already-running process instead of spawning
// a duplicate.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    let added = false;
    for (const arg of argv.slice(1)) {
      if (arg.startsWith("-")) continue;
      if (enqueueOpenPath(arg)) added = true;
    }
    focusMainWindow();
    if (added) notifyOpenPending();
  });

  // Harvest file paths from this launch's argv (CLI / `open -a … file`).
  // normalizeOpenPath filters flags and non-document args (e.g. dev's ".").
  for (const arg of process.argv.slice(1)) {
    if (!arg.startsWith("-")) enqueueOpenPath(arg);
  }

  app.whenReady()
    .then(boot)
    .catch((err) => {
      console.error("[doxmind] boot failed:", err);
      app.quit();
    });

  // macOS dock-icon click after all windows closed: bring one back.
  app.on("activate", (_event, hasVisibleWindows) => {
    if (!hasVisibleWindows) focusMainWindow();
  });
}

app.on("window-all-closed", () => {
  // macOS apps stay resident until the user quits explicitly.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (sidecarChild) {
    try {
      sidecarChild.kill();
    } catch {
      // already gone
    }
    sidecarChild = null;
  }
  if (rendererServer) {
    rendererServer.close();
    rendererServer = null;
  }
});
