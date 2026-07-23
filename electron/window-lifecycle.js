"use strict";

function createWindowLifecycle({ deliver, getAllWindows, quit }) {
  let quitAfterWindowsClose = false;
  let allowFinalQuit = false;

  function liveWindows() {
    return getAllWindows().filter((win) => !win.isDestroyed());
  }

  function maybeQuitAfterWindowsClose() {
    if (!quitAfterWindowsClose || liveWindows().length > 0) return;
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
    const markRendererGone = () => {
      win._doxmindRendererGone = true;
      if (win._doxmindClosing) return;
      if (win._doxmindClosePending || quitAfterWindowsClose) closeWindowNow(win);
    };
    win.webContents.on("render-process-gone", markRendererGone);
    win.webContents.on("destroyed", markRendererGone);
    win.on("closed", maybeQuitAfterWindowsClose);
    win.on("close", (event) => {
      if (win._doxmindClosing) return;
      if (win._doxmindRendererGone || win.webContents.isDestroyed()) {
        win._doxmindClosing = true;
        return;
      }
      event.preventDefault();
      if (win._doxmindClosePending) return;
      win._doxmindClosePending = true;
      deliver("shell://close-requested", null, new Set([win.webContents.id]));
    });
  }

  function closeWindowNow(win) {
    win._doxmindClosePending = false;
    win._doxmindClosing = true;
    destroyWindow(win);
  }

  function cancelClose(win) {
    win._doxmindClosePending = false;
    if (quitAfterWindowsClose) quitAfterWindowsClose = false;
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
  }

  return {
    attachCloseToSave,
    cancelClose,
    closeWindowNow,
    requestQuit,
  };
}

module.exports = { createWindowLifecycle };
