"use strict";

/**
 * Auto-update via Electron's built-in Squirrel.Mac autoUpdater, fed by
 * update.electronjs.org reading the public releases repo. No runtime npm
 * deps; the zip asset produced by electron-builder is the update payload.
 *
 * Flow: check on launch (after a short delay) and every few hours. Squirrel
 * downloads in the background; on `update-downloaded` we offer a restart.
 * `quitAndInstall` triggers the normal window-close path, so close-to-save
 * still flushes pending edits (main.js destroys each window within 3s).
 *
 * Requirements for updates to actually flow:
 *   - app is signed (Squirrel.Mac validates the downloaded update)
 *   - the repo below is PUBLIC and its releases carry a *-mac.zip asset
 */

const { app, autoUpdater, dialog } = require("electron");

const UPDATE_OWNER = "doXmind";
const UPDATE_REPO = "releases";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let initialized = false;
let downloadedVersion = null;
let interactive = false; // a user-initiated check reports "no update" / errors

function feedUrl() {
  return `https://update.electronjs.org/${UPDATE_OWNER}/${UPDATE_REPO}/${process.platform}-${process.arch}/${app.getVersion()}`;
}

function initAutoUpdater() {
  if (initialized || !app.isPackaged) return;
  initialized = true;

  try {
    autoUpdater.setFeedURL({ url: feedUrl() });
  } catch (err) {
    console.error("[updater] setFeedURL failed:", err);
    return;
  }

  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    downloadedVersion = releaseName || "new version";
    promptRestart(releaseName, releaseNotes);
  });

  autoUpdater.on("update-not-available", () => {
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
  if (downloadedVersion) {
    promptRestart(downloadedVersion, null);
    return;
  }
  interactive = true;
  checkForUpdates();
}

module.exports = { initAutoUpdater, checkForUpdatesInteractive };
