"use strict";

/**
 * Minimal Electron renderer bridge. The renderer never receives Node or
 * Electron objects; every privileged operation crosses a named IPC command.
 */

const { contextBridge, ipcRenderer, webUtils } = require("electron");

function argValue(prefix) {
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const platform = argValue("--doxmind-platform=") || "macos";
const listeners = new Map();

ipcRenderer.on("desktop:event", (_event, message) => {
  if (!message || typeof message.event !== "string") return;
  const callbacks = listeners.get(message.event);
  if (!callbacks) return;
  const desktopEvent = { event: message.event, payload: message.payload };
  for (const callback of [...callbacks]) callback(desktopEvent);
});

contextBridge.exposeInMainWorld("__DOXMIND_DESKTOP__", {
  platform,
  invoke(command, payload = {}) {
    return ipcRenderer.invoke("shell:invoke", command, payload);
  },
  listen(event, callback) {
    if (typeof event !== "string" || typeof callback !== "function") {
      throw new TypeError("desktop event name and callback are required");
    }
    let callbacks = listeners.get(event);
    if (!callbacks) {
      callbacks = new Set();
      listeners.set(event, callbacks);
    }
    callbacks.add(callback);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) listeners.delete(event);
    };
  },
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
});
