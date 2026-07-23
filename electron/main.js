"use strict";

/**
 * doXmind Electron main process.
 *
 * Boot sequence:
 *   1. Serve the Next static export (./out) from http://127.0.0.1:<port>.
 *   2. Register the native Node filesystem workspace dispatcher.
 *   3. Open the main window; dispatch shell:invoke commands.
 *   4. On quit, close workspace watchers and the static renderer server.
 *
 * Workspace/document commands run in-process (native-workspace.js).
 * Shell-native commands (dialogs, windows, local PDF export) are handled here.
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  webContents,
  Menu,
  nativeImage,
  session,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { startStaticServer } = require("./static-server");
const { createNativeWorkspaceDispatcher, isNativeWorkspaceCommand } = require("./native-workspace");
const {
  isExternallyOpenable,
  isTrustedRendererUrl,
  lockDownRendererPermissions,
} = require("./renderer-boundary");
const { WindowRegistry, normalizeOpenPath } = require("./window-registry");
const menus = require("./menus");
const { attachRendererRecovery } = require("./renderer-recovery");
const { createWindowLifecycle } = require("./window-lifecycle");
const { createWorkspaceWatchers } = require("./workspace-watchers");
const { exportPagePdf } = require("./local-pdf-export");
const updater = require("./updater");

const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "out");
const ICON_DIR = path.join(__dirname, "assets");
const APP_ICON = path.join(ICON_DIR, "icon.png");
const TRAY_ICON = path.join(ICON_DIR, "tray-icon-template.png");

let rendererServer = null; // { url, port, close }
let pendingOpenPaths = [];
let currentRecents = [];
let tray = null;

// Per-window open-target registry, keyed by webContents.id.
const registry = new WindowRegistry();
let windowLifecycle = null;
const workspaceWatchers = createWorkspaceWatchers({
  onChanged: (webContentsId, payload) =>
    deliver("workspace://changed", payload, new Set([webContentsId])),
  onError: (error, webContentsId, root) => {
    console.error(
      `[doxmind] workspace watcher failed for webContents ${webContentsId} (${root}):`,
      error
    );
  },
});
const dispatchNativeWorkspace = createNativeWorkspaceDispatcher({
  trashItem: (target) => shell.trashItem(target),
});

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

function targetForRecovery(win, fallback) {
  if (win.isDestroyed()) return fallback;
  return registry.get(win.webContents.id) ?? fallback;
}

function logRendererFailure(failure) {
  console.error(`[doxmind] renderer failure (${failure.kind})`, {
    reason: failure.reason,
    exitCode: failure.exitCode,
    errorCode: failure.errorCode,
  });
}

function replaceFailedWindow(win, target, recoveryAttempt) {
  const replacement = createWindow(targetForRecovery(win, target), recoveryAttempt);
  windowLifecycle.closeWindowNow(win);
  return replacement;
}

function recoverRendererWindow({ win, target, recoveryAttempt, failure }) {
  logRendererFailure(failure);
  replaceFailedWindow(win, target, recoveryAttempt);
}

function failRendererWindow({ win, target, failure }) {
  logRendererFailure(failure);
  const failedTarget = targetForRecovery(win, target);
  void dialog
    .showMessageBox({
      type: "error",
      title: "doXmind couldn't open",
      message: "The editor process could not start.",
      detail:
        "doXmind retried once, but the editor is still unavailable. Your Markdown files were not modified.",
      buttons: ["Retry", "Quit"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (win.isDestroyed()) return;
      if (response === 0) {
        replaceFailedWindow(win, failedTarget, 0);
        return;
      }
      windowLifecycle.closeWindowNow(win);
      app.quit();
    })
    .catch((error) => {
      if (win.isDestroyed()) return;
      console.error("[doxmind] renderer failure dialog failed:", error);
      dialog.showErrorBox(
        "doXmind couldn't open",
        "The editor process could not start. Your Markdown files were not modified."
      );
      if (!win.isDestroyed()) windowLifecycle.closeWindowNow(win);
      app.quit();
    });
}

function createWindow(target, recoveryAttempt = 0) {
  const isMac = process.platform === "darwin";
  // macOS gets the frameless/vibrancy chrome the frontend's Electron CSS
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
    // Start hidden and reveal on first paint. With the transparent + vibrancy
    // macOS chrome, showing before the renderer paints flashes the bare
    // vibrancy material through the unpainted webview — in dark mode this reads
    // as a "broken"/see-through sidebar until React renders the opaque chrome.
    show: false,
    ...chrome,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--doxmind-platform=${platformArg}`],
    },
  });
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    if (isTrustedRendererUrl(rendererServer?.url, navigationUrl)) return;
    event.preventDefault();
    if (isExternallyOpenable(navigationUrl)) void shell.openExternal(navigationUrl);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Pre-register so a concurrent focus-existing lookup sees this window before
  // its JS calls register_window_target (mirrors create_editor_window).
  if (target) registry.set(win.webContents.id, target);
  const wcId = win.webContents.id;
  win.webContents.on("destroyed", () => {
    registry.clear(wcId);
    workspaceWatchers.remove(wcId);
  });
  windowLifecycle.attachCloseToSave(win);
  const rendererRecovery = attachRendererRecovery({
    win,
    target,
    recoveryAttempt,
    recover: recoverRendererWindow,
    fail: failRendererWindow,
    close: (failedWindow) => windowLifecycle.closeWindowNow(failedWindow),
  });
  win.once("ready-to-show", () => win.show());
  void win.loadURL(urlForTarget(target)).catch(rendererRecovery.handleLoadFailure);
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

// ── Native -> renderer event bridge ─────────────────────────────────────────
function deliver(eventName, payload, targetIds) {
  const targets = targetIds
    ? [...targetIds].map((id) => webContents.fromId(id)).filter(Boolean)
    : BrowserWindow.getAllWindows().map((window) => window.webContents);
  for (const target of targets) {
    if (!target.isDestroyed()) target.send("desktop:event", { event: eventName, payload });
  }
}

function emitToAll(eventName, payload) {
  deliver(eventName, payload, null);
}

function emitToFocused(eventName, payload) {
  const focused = BrowserWindow.getFocusedWindow();
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

async function dispatch(event, cmd, args) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || "";
  if (!isTrustedRendererUrl(rendererServer?.url, senderUrl)) {
    throw new Error("shell command rejected from an untrusted renderer");
  }
  if (isNativeWorkspaceCommand(cmd)) {
    return dispatchNativeWorkspace(cmd, args || {});
  }

  const sender = event.sender;
  const win = BrowserWindow.fromWebContents(sender);
  switch (cmd) {
    case "update_get_state":
      return updater.getUpdateState();
    case "update_check":
      updater.requestCheck();
      return null;
    case "update_restart":
      updater.quitAndInstallNow();
      return null;
    case "workspace_watch":
      workspaceWatchers.watch(sender.id, args.root);
      return null;
    case "workspace_unwatch":
      workspaceWatchers.unwatch(sender.id, args.root);
      return null;
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
    case "export_page_pdf":
      return exportPagePdf({
        contents: sender,
        ownerWindow: win,
        suggestedName: args.suggestedName,
        targetFileId: args.targetFileId,
        showSaveDialog: (ownerWindow, options) => dialog.showSaveDialog(ownerWindow, options),
      });
    case "shell_close_window":
      if (win) {
        windowLifecycle.closeWindowNow(win);
      }
      return null;
    case "shell_cancel_close":
      if (win) {
        windowLifecycle.cancelClose(win);
      }
      return null;
    case "shell_open_external":
      if (typeof args.url === "string" && /^(https?:|mailto:)/i.test(args.url)) {
        await shell.openExternal(args.url);
      }
      return null;
    case "shell_open_path":
      if (typeof args.path === "string") await shell.openPath(args.path);
      return null;
    case "shell_reveal_path":
      if (typeof args.path === "string") shell.showItemInFolder(args.path);
      return null;
    default:
      throw new Error(`unhandled shell command: ${cmd}`);
  }
}

async function boot() {
  lockDownRendererPermissions(session.defaultSession);

  // Set the Dock icon before renderer startup so the macOS-shaped logo shows
  // immediately. In a packaged build electron-builder's mac.icon (.icns) owns
  // the bundle icon; this is the dev/unbundled path.
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(APP_ICON);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  if (!fs.existsSync(path.join(OUT_DIR, "index.html"))) {
    throw new Error(`missing static export at ${OUT_DIR} — run \`npm run build\` first`);
  }
  rendererServer = await startStaticServer(OUT_DIR);

  ipcMain.handle("shell:invoke", dispatch);
  windowLifecycle = createWindowLifecycle({
    deliver,
    getAllWindows: () => BrowserWindow.getAllWindows(),
    quit: () => app.quit(),
  });

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

  // Configure renderer state delivery without contacting the update feed.
  // The updater initializes and checks only after an explicit user action.
  updater.configure({ broadcast: (state) => emitToAll("os://update-state", state) });
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

  app
    .whenReady()
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

app.on("before-quit", (event) => {
  windowLifecycle?.requestQuit(event);
});

app.on("will-quit", () => {
  if (rendererServer) {
    rendererServer.close();
    rendererServer = null;
  }
});
