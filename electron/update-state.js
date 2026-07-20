"use strict";

/**
 * Auto-update state machine, decoupled from Electron so it stays
 * unit-testable. updater.js feeds Squirrel autoUpdater events in; the
 * resulting snapshots are broadcast to every renderer, which drives the
 * in-app "update ready — restart" pill and the Settings → About controls.
 *
 * Statuses:
 *   idle         nothing checked yet (packaged app, before first check)
 *   checking     a check is in flight
 *   downloading  an update exists; Squirrel is downloading it in background
 *   downloaded   update staged — restart applies it
 *   up-to-date   last check found nothing newer
 *   error        last check/download failed (recoverable — re-check allowed)
 *
 * `downloaded` is sticky: later checks/errors must not un-stage a staged
 * update, so every transition out of `downloaded` is ignored.
 */

function createUpdateState(currentVersion) {
  let state = {
    status: "idle",
    currentVersion,
    availableVersion: null,
    error: null,
    lastCheckedAt: null,
  };

  function snapshot() {
    return { ...state };
  }

  /** Apply an updater event; returns the new snapshot, or null if ignored. */
  function apply(event, payload = {}) {
    if (state.status === "downloaded" && event !== "downloaded") return null;
    switch (event) {
      case "checking":
        state = { ...state, status: "checking", error: null };
        return snapshot();
      case "available":
        state = { ...state, status: "downloading", error: null };
        return snapshot();
      case "not-available":
        state = {
          ...state,
          status: "up-to-date",
          error: null,
          lastCheckedAt: payload.at ?? new Date().toISOString(),
        };
        return snapshot();
      case "downloaded":
        state = {
          ...state,
          status: "downloaded",
          availableVersion: payload.version ?? state.availableVersion ?? null,
          error: null,
        };
        return snapshot();
      case "error":
        state = { ...state, status: "error", error: payload.message ?? "update failed" };
        return snapshot();
      default:
        return null;
    }
  }

  return { snapshot, apply };
}

module.exports = { createUpdateState };
