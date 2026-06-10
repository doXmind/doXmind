"use strict";

/**
 * Native macOS application menu bar, Dock menu, and Tray — Electron ports of
 * src-tauri/src/menu_bar.rs, dock_menu.rs, and the tray builder in lib.rs.
 *
 * Menu clicks emit the same menu:// / dock:// / tray:// events that the
 * frontend's NativeMenuListener (and editor-client) already bridge to store
 * actions. Per Rust semantics, window-scoped actions go to the focused window
 * (emitToFocused); app-scoped actions broadcast to all windows (emitToAll).
 *
 * `deps` provides: recents (OpenTarget[]), emitToAll, emitToFocused,
 * focusThenEmitAll(event), focusMainWindow().
 */

const { app, Menu, Tray, nativeImage } = require("electron");

function basename(p) {
  const normalized = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  const name = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  return name || String(p);
}

function appRecentSubmenu(recents, emitToAll) {
  const items = recents.length
    ? recents.slice(0, 12).map((r) => ({
        label: basename(r.path),
        click: () => emitToAll("menu://open-recent", { kind: r.kind, path: r.path }),
      }))
    : [{ label: "No Recent Items", enabled: false }];
  items.push({ type: "separator" });
  items.push({
    label: "Clear Recents",
    enabled: recents.length > 0,
    click: () => emitToAll("menu://clear-recents", null),
  });
  return items;
}

function buildAppMenu(deps) {
  const { recents, emitToAll, emitToFocused, focusThenEmitAll } = deps;
  return Menu.buildFromTemplate([
    {
      label: "doXmind",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => emitToFocused("menu://settings", null) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Document", accelerator: "CmdOrCtrl+N", click: () => focusThenEmitAll("menu://new-file") },
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => emitToAll("menu://new-window", null) },
        { type: "separator" },
        { label: "Open File…", accelerator: "CmdOrCtrl+O", click: () => focusThenEmitAll("menu://open-file") },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+Shift+O", click: () => focusThenEmitAll("menu://open-folder") },
        { label: "Open Recent", submenu: appRecentSubmenu(recents, emitToAll) },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => emitToFocused("menu://save", null) },
        { type: "separator" },
        { label: "Reveal in Finder", accelerator: "CmdOrCtrl+Alt+R", click: () => emitToFocused("menu://reveal", null) },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Find in Document…", accelerator: "CmdOrCtrl+F", click: () => emitToFocused("menu://find", null) },
        { label: "Quick Switcher…", accelerator: "CmdOrCtrl+P", click: () => emitToFocused("menu://quick-switcher", null) },
        { label: "Command Palette…", accelerator: "CmdOrCtrl+K", click: () => emitToFocused("menu://command-palette", null) },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+B", click: () => emitToFocused("menu://toggle-sidebar", null) },
        { label: "Toggle Focus Mode", accelerator: "F11", click: () => emitToFocused("menu://toggle-focus", null) },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => emitToAll("menu://new-window", null) },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "doXmind on GitHub", click: () => emitToAll("menu://open-url", "https://github.com/doXmind") },
        { label: "Email Support", click: () => emitToAll("menu://open-url", "mailto:support@waxis.org?subject=doXmind%20Support") },
      ],
    },
  ]);
}

async function buildDockMenu(deps) {
  const { recents, emitToAll } = deps;
  const files = recents.filter((r) => r.kind === "file");
  const folders = recents.filter((r) => r.kind === "folder");
  const items = [];
  const pushRecent = async (r) => {
    let icon;
    try {
      icon = await app.getFileIcon(r.path, { size: "small" });
    } catch {
      icon = undefined;
    }
    items.push({
      label: basename(r.path),
      icon,
      click: () => emitToAll("dock://open-recent", { kind: r.kind, path: r.path }),
    });
  };
  for (const r of files) await pushRecent(r);
  if (files.length && folders.length) items.push({ type: "separator" });
  for (const r of folders) await pushRecent(r);
  if (recents.length) items.push({ type: "separator" });
  items.push({ label: "New Window", click: () => emitToAll("dock://open-new-window", null) });
  return Menu.buildFromTemplate(items);
}

function buildTrayMenu(deps) {
  const { recents, emitToAll, focusMainWindow } = deps;
  const recentItems = recents.length
    ? recents.slice(0, 10).map((r) => ({
        label: basename(r.path),
        click: () => emitToAll("tray://open-recent", { kind: r.kind, path: r.path }),
      }))
    : [{ label: "No Recent Items", enabled: false }];
  return Menu.buildFromTemplate([
    { label: "New Document", accelerator: "CmdOrCtrl+N", click: () => { focusMainWindow(); emitToAll("tray://new-file", null); } },
    { type: "separator" },
    { label: "Open File…", click: () => { focusMainWindow(); emitToAll("tray://open-file", null); } },
    { label: "Open Folder…", click: () => { focusMainWindow(); emitToAll("tray://open-folder", null); } },
    { label: "Recent Files", submenu: recentItems },
    { type: "separator" },
    { label: "Open doXmind", click: () => focusMainWindow() },
    { label: "Settings…", click: () => { focusMainWindow(); emitToAll("tray://settings", null); } },
    { type: "separator" },
    { role: "quit", label: "Quit doXmind" },
  ]);
}

function createTray(iconPath, deps) {
  // The source template is 44x44; the macOS menu bar is ~22px tall. Unlike
  // Tauri's tray-icon crate, Electron renders the nativeImage at its point
  // size, so we resize to an ~18pt menu-bar icon with a crisp @2x rep.
  const source = nativeImage.createFromPath(iconPath);
  const image = nativeImage.createEmpty();
  image.addRepresentation({
    scaleFactor: 1,
    buffer: source.resize({ width: 18, height: 18, quality: "best" }).toPNG(),
  });
  image.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: 36, height: 36, quality: "best" }).toPNG(),
  });
  image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip("doXmind");
  tray.setContextMenu(buildTrayMenu(deps));
  return tray;
}

module.exports = { buildAppMenu, buildDockMenu, buildTrayMenu, createTray };
