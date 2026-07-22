"use strict";

/**
 * Explicit desktop updates via Electron's built-in Squirrel.Mac autoUpdater.
 *
 * Importing and configuring this Module are offline operations. The update
 * feed is configured and contacted only after the user chooses Check for
 * Updates from the native menu or the Settings UI. State transitions are
 * broadcast to renderers for the Settings controls and staged-update pill.
 */

const { app, autoUpdater, dialog } = require("electron");
const { createUpdateState } = require("./update-state");

const UPDATE_OWNER = "doXmind";
const UPDATE_REPO = "releases";

let initialized = false;
let interactive = false;
let updateState = null;
let broadcastFn = () => {};

function configure({ broadcast } = {}) {
  if (typeof broadcast === "function") broadcastFn = broadcast;
}

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

function ensureUpdaterInitialized() {
  if (initialized) return true;
  if (!app.isPackaged) return false;

  try {
    autoUpdater.setFeedURL({ url: feedUrl() });
  } catch (error) {
    console.error("[updater] setFeedURL failed:", error);
    transition("error", { message: String(error?.message || error) });
    return false;
  }

  initialized = true;
  autoUpdater.on("checking-for-update", () => {
    transition("checking");
  });
  autoUpdater.on("update-available", () => {
    transition("available");
  });
  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    transition("downloaded", { version: releaseName || null });
    if (interactive) {
      interactive = false;
      promptRestart(releaseName, releaseNotes);
    }
  });
  autoUpdater.on("update-not-available", () => {
    transition("not-available");
    if (!interactive) return;
    interactive = false;
    void dialog.showMessageBox({
      type: "info",
      message: "You're up to date",
      detail: `doXmind ${app.getVersion()} is the latest version.`,
    });
  });
  autoUpdater.on("error", (error) => {
    console.error("[updater] error:", error);
    transition("error", { message: String(error?.message || error) });
    if (!interactive) return;
    interactive = false;
    void dialog.showMessageBox({
      type: "warning",
      message: "Could not check for updates",
      detail: String(error?.message || error),
    });
  });
  return true;
}

function checkForUpdates() {
  try {
    autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("[updater] checkForUpdates failed:", error);
    transition("error", { message: String(error?.message || error) });
  }
}

/** Settings button path: explicit, quiet, and reflected through state events. */
function requestCheck() {
  if (!app.isPackaged || ensureState().snapshot().status === "downloaded") return;
  interactive = false;
  if (!ensureUpdaterInitialized()) return;
  checkForUpdates();
}

/** Renderer pill path: apply the already-staged update now. */
function quitAndInstallNow() {
  if (getUpdateState().status !== "downloaded") return;
  autoUpdater.quitAndInstall();
}

function promptRestart(releaseName, releaseNotes) {
  const detailParts = [`doXmind ${releaseName || ""}`.trim() + " has been downloaded."];
  if (releaseNotes) detailParts.push(String(releaseNotes).slice(0, 500));
  void dialog
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
    });
}

/** Native menu path: explicitly report success, no update, or failure. */
function checkForUpdatesInteractive() {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
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
  if (!ensureUpdaterInitialized()) {
    interactive = false;
    return;
  }
  checkForUpdates();
}

module.exports = {
  configure,
  checkForUpdatesInteractive,
  getUpdateState,
  requestCheck,
  quitAndInstallNow,
};
