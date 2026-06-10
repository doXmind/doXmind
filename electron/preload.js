"use strict";

/**
 * Makes the Electron renderer look like the Tauri WebView to the existing
 * frontend, so no React/store code has to branch on the shell:
 *
 *   - window.__TAURI_BACKEND_URL__  — sidecar base URL (read by lib/api/base).
 *   - window.__TAURI_PLATFORM__     — 'macos' (read by the layout bootstrap
 *                                     script to flip is-tauri / vibrancy CSS).
 *   - window.__TAURI_INTERNALS__    — the object @tauri-apps/api/core delegates
 *                                     to: invoke / transformCallback /
 *                                     convertFileSrc. invoke() forwards every
 *                                     command to the main-process dispatcher.
 *
 * The sidecar URL and platform arrive via webPreferences.additionalArguments.
 */

const { contextBridge, ipcRenderer } = require("electron");

function argValue(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const backendUrl = argValue("--doxmind-backend-url=") || "";
const platform = argValue("--doxmind-platform=") || "macos";

// Event callback registry. @tauri-apps/api/event's listen() registers a
// handler via transformCallback and gets back an id; native code later
// delivers events by invoking that id. Main forwards events on the
// 'tauri://callback' channel; Phase 1 registers them but nothing emits yet.
const callbacks = new Map();
let nextCallbackId = 1;

ipcRenderer.on("tauri://callback", (_event, { id, data }) => {
  const entry = callbacks.get(id);
  if (!entry) return;
  try {
    entry.cb(data);
  } finally {
    if (entry.once) callbacks.delete(id);
  }
});

const internals = {
  invoke(cmd, args) {
    return ipcRenderer.invoke("shell:invoke", cmd, args ?? {});
  },
  transformCallback(cb, once = false) {
    const id = nextCallbackId++;
    callbacks.set(id, { cb, once: Boolean(once) });
    return id;
  },
  convertFileSrc(filePath, protocol = "doxmind-asset") {
    return `${protocol}://local/${encodeURIComponent(filePath)}`;
  },
};

contextBridge.exposeInMainWorld("__TAURI_INTERNALS__", internals);
contextBridge.exposeInMainWorld("__TAURI_BACKEND_URL__", backendUrl);
contextBridge.exposeInMainWorld("__TAURI_PLATFORM__", platform);
