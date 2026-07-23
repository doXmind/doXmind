"use strict";

const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 1;
const DEFAULT_RENDERER_READY_TIMEOUT_MS = 15_000;
const RECOVERY_STABILITY_MS = 10_000;

function attachRendererRecovery({
  win,
  target,
  recoveryAttempt,
  recover,
  fail,
  close,
  timeoutMs = DEFAULT_RENDERER_READY_TIMEOUT_MS,
}) {
  let handled = false;
  let startupTimer = null;
  let stabilityTimer = null;

  function clearStartupTimer() {
    if (startupTimer === null) return;
    clearTimeout(startupTimer);
    startupTimer = null;
  }

  function clearStabilityTimer() {
    if (stabilityTimer === null) return;
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }

  function clearTimers() {
    clearStartupTimer();
    clearStabilityTimer();
  }

  function handleFailure(failure) {
    if (handled || win.isDestroyed()) return;
    if (win._doxmindClosing || win._doxmindClosePending) {
      handled = true;
      clearTimers();
      win._doxmindRendererGone = true;
      if (win._doxmindClosePending && !win._doxmindClosing) close(win);
      return;
    }
    handled = true;
    clearTimers();
    win._doxmindRendererGone = true;

    if (recoveryAttempt < MAX_AUTOMATIC_RECOVERY_ATTEMPTS) {
      recover({
        win,
        target,
        recoveryAttempt: recoveryAttempt + 1,
        failure,
      });
      return;
    }
    fail({ win, target, failure });
  }

  win.once("ready-to-show", () => {
    clearStartupTimer();
    win._doxmindRendererGone = false;
    if (recoveryAttempt === 0) return;
    stabilityTimer = setTimeout(() => {
      recoveryAttempt = 0;
      stabilityTimer = null;
    }, RECOVERY_STABILITY_MS);
    stabilityTimer.unref?.();
  });
  win.once("closed", clearTimers);

  win.webContents.on("render-process-gone", (_event, details) => {
    handleFailure({
      kind: "render-process-gone",
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      handleFailure({
        kind: "did-fail-load",
        errorCode,
        errorDescription,
      });
    }
  );

  if (timeoutMs > 0) {
    startupTimer = setTimeout(() => handleFailure({ kind: "startup-timeout" }), timeoutMs);
    startupTimer.unref?.();
  }

  return {
    handleLoadFailure(error) {
      handleFailure({
        kind: "load-url-rejected",
        message: error?.message || String(error),
      });
    },
  };
}

module.exports = {
  attachRendererRecovery,
  DEFAULT_RENDERER_READY_TIMEOUT_MS,
  MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
  RECOVERY_STABILITY_MS,
};
