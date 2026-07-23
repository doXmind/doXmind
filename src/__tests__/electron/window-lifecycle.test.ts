import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWindowLifecycle } = require("../../../electron/window-lifecycle.js") as {
  createWindowLifecycle: typeof import("../../../electron/window-lifecycle.js").createWindowLifecycle;
};

class FakeWebContents extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }

  isDestroyed() {
    return false;
  }
}

class FakeWindow extends EventEmitter {
  _doxmindClosing = false;
  readonly webContents: FakeWebContents;
  private destroyed = false;

  constructor(id: number) {
    super();
    this.webContents = new FakeWebContents(id);
  }

  close() {
    let prevented = false;
    const event = {
      preventDefault: vi.fn(() => {
        prevented = true;
      }),
    };
    this.emit("close", event);
    if (!prevented) this.destroy();
    return event;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }

  isDestroyed() {
    return this.destroyed;
  }
}

describe("Electron window lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never destroys a window while its save decision is pending or refused", () => {
    const deliver = vi.fn();
    const quit = vi.fn();
    const win = new FakeWindow(1);
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => (win.isDestroyed() ? [] : [win]),
      quit,
    });

    lifecycle.attachCloseToSave(win);
    const closeEvent = win.close();

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith("shell://close-requested", null, new Set([1]));
    expect(win.isDestroyed()).toBe(false);
    expect(quit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(win.isDestroyed()).toBe(false);
    expect(quit).not.toHaveBeenCalled();

    const repeatedClose = win.close();
    expect(repeatedClose.preventDefault).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledTimes(1);

    lifecycle.cancelClose(win);
    win.close();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(win.isDestroyed()).toBe(false);

    lifecycle.closeWindowNow(win);
    expect(win.isDestroyed()).toBe(true);
  });

  it("treats explicit Quit like VS Code: save windows, close them, then quit the app", () => {
    const deliver = vi.fn();
    const quit = vi.fn();
    const windows = [new FakeWindow(1), new FakeWindow(2)];
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => windows.filter((win) => !win.isDestroyed()),
      quit,
    });
    windows.forEach((win) => lifecycle.attachCloseToSave(win));

    const quitEvent = { preventDefault: vi.fn() };
    lifecycle.requestQuit(quitEvent);

    expect(quitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(quit).not.toHaveBeenCalled();

    const secondQuitEvent = { preventDefault: vi.fn() };
    lifecycle.requestQuit(secondQuitEvent);
    expect(secondQuitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    lifecycle.closeWindowNow(windows[0]);
    expect(quit).not.toHaveBeenCalled();
    lifecycle.closeWindowNow(windows[1]);

    expect(quit).toHaveBeenCalledOnce();

    const finalQuitEvent = { preventDefault: vi.fn() };
    lifecycle.requestQuit(finalQuitEvent);
    expect(finalQuitEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("quits immediately when the renderer is already gone", () => {
    const deliver = vi.fn();
    const quit = vi.fn();
    const win = new FakeWindow(1);
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => (win.isDestroyed() ? [] : [win]),
      quit,
    });

    lifecycle.attachCloseToSave(win);
    win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });
    const quitEvent = { preventDefault: vi.fn() };
    lifecycle.requestQuit(quitEvent);

    expect(deliver).not.toHaveBeenCalled();
    expect(win.isDestroyed()).toBe(true);
    expect(quit).toHaveBeenCalledOnce();
  });

  it("closes immediately from the window controls when the renderer is gone", () => {
    const deliver = vi.fn();
    const win = new FakeWindow(1);
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => (win.isDestroyed() ? [] : [win]),
      quit: vi.fn(),
    });

    lifecycle.attachCloseToSave(win);
    win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });
    const closeEvent = win.close();

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(win.isDestroyed()).toBe(true);
  });

  it("closes immediately when webContents was destroyed without a crash event", () => {
    const deliver = vi.fn();
    const win = new FakeWindow(1);
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => (win.isDestroyed() ? [] : [win]),
      quit: vi.fn(),
    });

    lifecycle.attachCloseToSave(win);
    win.webContents.emit("destroyed");
    const closeEvent = win.close();

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(win.isDestroyed()).toBe(true);
  });

  it("finishes a pending close if the renderer disappears before replying", () => {
    const deliver = vi.fn();
    const quit = vi.fn();
    const win = new FakeWindow(1);
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => (win.isDestroyed() ? [] : [win]),
      quit,
    });

    lifecycle.attachCloseToSave(win);
    win.close();
    expect(deliver).toHaveBeenCalledOnce();
    expect(win.isDestroyed()).toBe(false);

    win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });

    expect(win.isDestroyed()).toBe(true);
    expect(quit).not.toHaveBeenCalled();
  });
});
