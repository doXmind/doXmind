"use strict";

/** Pure URL checks shared by Electron navigation and IPC authorization. */

function isTrustedRendererUrl(rendererUrl, candidateUrl) {
  if (typeof rendererUrl !== "string" || typeof candidateUrl !== "string") return false;
  try {
    const renderer = new URL(rendererUrl);
    const candidate = new URL(candidateUrl);
    return candidate.origin === renderer.origin && candidate.protocol === renderer.protocol;
  } catch {
    return false;
  }
}

function isExternallyOpenable(candidateUrl) {
  if (typeof candidateUrl !== "string") return false;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(candidateUrl).protocol);
  } catch {
    return false;
  }
}

function lockDownRendererPermissions(targetSession) {
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  );
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setDevicePermissionHandler(() => false);
}

module.exports = { isTrustedRendererUrl, isExternallyOpenable, lockDownRendererPermissions };
