"use strict";

/**
 * Auto-update via Electron's built-in Squirrel.Mac autoUpdater, fed by
 * update.electronjs.org reading the public releases repo. No runtime npm
 * deps; the zip asset produced by electron-builder is the update payload.
 *
 * Flow: check on launch (after a short delay) and every few hours. Squirrel
 * downloads in the background. Every state transition is broadcast to the
 * renderers as an `os://update-state` event (see update-state.js), which
 * drives the in-app "update ready — restart" pill and the Settings → About
 * controls — a quiet push instead of a modal ambush. Native dialogs remain
 * only on the user-initiated menu path ("Check for Updates…"), where an
 * explicit answer is expected. `quitAndInstall` triggers the normal
 * window-close path, so close-to-save still flushes pending edits (main.js
 * destroys each window within 3s).
 *
 * Requirements for updates to actually flow:
 *   - app is signed (Squirrel.Mac validates the downloaded update)
 *   - the repo below is PUBLIC and its releases carry a *-mac.zip asset
 */

const { app, autoUpdater, dialog } = require("electron");
const { createUpdateState } = require("./update-state");

const UPDATE_OWNER = "doXmind";
const UPDATE_REPO = "releases";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let initialized = false;
let interactive = false; // a user-initiated check reports "no update" / errors
let updateState = null; // created lazily so app.getVersion() is ready
let broadcastFn = () => {};

function feedUrl() {
  return `https://update.electronjs.org/${UPDATE_OWNER}/${UPDATE_REPO}/${process.platform}-${process.arch}/${app.getVersion()}`;
}

function ensureState() {
  if (!updateState) updateState = createUpdateState(app.getVersion());
  return updateState;
}

function transition(event, payload) {
  const next = ensureState().apply(event, payload);
  if (next) broadcastFn(next);
  return next;
}

/** Renderer-facing snapshot. `unsupported` outside the packaged app. */
function getUpdateState() {
  if (!app.isPackaged) {
    return {
      status: "unsupported",
      currentVersion: app.getVersion(),
      availableVersion: null,
      error: null,
      lastCheckedAt: null,
    };
  }
  return ensureState().snapshot();
}

function initAutoUpdater({ broadcast } = {}) {
  if (initialized || !app.isPackaged) return;
  initialized = true;
  if (typeof broadcast === "function") broadcastFn = broadcast;

  try {
    autoUpdater.setFeedURL({ url: feedUrl() });
  } catch (err) {
    console.error("[updater] setFeedURL failed:", err);
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    transition("checking");
  });

  autoUpdater.on("update-available", () => {
    transition("available");
  });

  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    transition("downloaded", { version: releaseName || null });
    // Background downloads surface through the in-app pill only. A modal
    // here would ambush whatever the user is typing; the menu path still
    // answers with a dialog because the user explicitly asked.
    if (interactive) {
      interactive = false;
      promptRestart(releaseName, releaseNotes);
    }
  });

  autoUpdater.on("update-not-available", () => {
    transition("not-available");
    if (!interactive) return;
    interactive = false;
    dialog.showMessageBox({
      type: "info",
      message: "You're up to date",
      detail: `doXmind ${app.getVersion()} is the latest version.`,
    });
  });

  autoUpdater.on("error", (err) => {
    // Offline / rate-limited background checks shouldn't nag.
    console.error("[updater] error:", err);
    transition("error", { message: String((err && err.message) || err) });
    if (!interactive) return;
    interactive = false;
    dialog.showMessageBox({
      type: "warning",
      message: "Could not check for updates",
      detail: String((err && err.message) || err),
    });
  });

  setTimeout(() => checkForUpdates(), 15_000);
  setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
}

function checkForUpdates() {
  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    console.error("[updater] checkForUpdates failed:", err);
  }
}

/** Renderer button path — silent; state events carry the outcome. */
function requestCheck() {
  if (!app.isPackaged) return;
  if (ensureState().snapshot().status === "downloaded") return; // already staged
  checkForUpdates();
}

/** Renderer pill path — apply the staged update now. */
function quitAndInstallNow() {
  if (getUpdateState().status !== "downloaded") return;
  autoUpdater.quitAndInstall();
}

function promptRestart(releaseName, releaseNotes) {
  const detailParts = [`doXmind ${releaseName || ""}`.trim() + " has been downloaded."];
  if (releaseNotes) detailParts.push(String(releaseNotes).slice(0, 500));
  dialog
    .showMessageBox({
      type: "info",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: "Update ready",
      detail: detailParts.join("\n\n") + "\n\nRestart to apply. Unsaved edits are flushed on close.",
    })
    .then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
      // "Later": Squirrel applies the staged update on the next quit/relaunch.
    });
}

/** Menu entry point — reports the result even when nothing is available. */
function checkForUpdatesInteractive() {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: "info",
      message: "Updates run in the packaged app only",
      detail: "Dev builds launched from the repo do not auto-update.",
    });
    return;
  }
  const { status, availableVersion } = getUpdateState();
  if (status === "downloaded") {
    promptRestart(availableVersion, null);
    return;
  }
  interactive = true;
  checkForUpdates();
}

module.exports = {
  initAutoUpdater,
  checkForUpdatesInteractive,
  getUpdateState,
  requestCheck,
  quitAndInstallNow,
};
