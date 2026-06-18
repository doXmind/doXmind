"use strict";

function createWindowLifecycle({ deliver, getAllWindows, quit, closeTimeoutMs = 3000 }) {
  let quitAfterWindowsClose = false;
  let allowFinalQuit = false;
  let quitFallbackTimer = null;

  function liveWindows() {
    return getAllWindows().filter((win) => !win.isDestroyed());
  }

  function maybeQuitAfterWindowsClose() {
    if (!quitAfterWindowsClose || liveWindows().length > 0) return;
    if (quitFallbackTimer) {
      clearTimeout(quitFallbackTimer);
      quitFallbackTimer = null;
    }
    allowFinalQuit = true;
    quit();
  }

  function destroyWindow(win) {
    if (!win.isDestroyed()) {
      win.destroy();
      return;
    }
    maybeQuitAfterWindowsClose();
  }

  function attachCloseToSave(win) {
    win.on("closed", maybeQuitAfterWindowsClose);
    win.on("close", (event) => {
      if (win._doxmindClosing) return;
      event.preventDefault();
      win._doxmindClosing = true;
      deliver("shell://close-requested", null, new Set([win.webContents.id]));
      setTimeout(() => destroyWindow(win), closeTimeoutMs);
    });
  }

  function closeWindowNow(win) {
    win._doxmindClosing = true;
    destroyWindow(win);
  }

  function requestQuit(event) {
    if (allowFinalQuit) return;
    if (quitAfterWindowsClose) {
      event.preventDefault();
      maybeQuitAfterWindowsClose();
      return;
    }
    const windows = liveWindows();
    if (windows.length === 0) return;

    event.preventDefault();
    quitAfterWindowsClose = true;
    for (const win of windows) win.close();
    quitFallbackTimer = setTimeout(maybeQuitAfterWindowsClose, closeTimeoutMs + 100);
  }

  return {
    attachCloseToSave,
    closeWindowNow,
    requestQuit,
  };
}

module.exports = { createWindowLifecycle };
