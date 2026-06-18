import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWindowLifecycle } = require("../../../electron/window-lifecycle.js") as {
  createWindowLifecycle: typeof import("../../../electron/window-lifecycle.js").createWindowLifecycle;
};

class FakeWindow extends EventEmitter {
  _doxmindClosing = false;
  readonly webContents: { id: number };
  private destroyed = false;

  constructor(id: number) {
    super();
    this.webContents = { id };
  }

  close() {
    const event = { preventDefault: vi.fn() };
    this.emit("close", event);
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

  it("treats red-window close like VS Code: close the window, keep the app alive", () => {
    const deliver = vi.fn();
    const quit = vi.fn();
    const win = new FakeWindow(1);
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => (win.isDestroyed() ? [] : [win]),
      quit,
      closeTimeoutMs: 50,
    });

    lifecycle.attachCloseToSave(win);
    const closeEvent = win.close();

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith("shell://close-requested", null, new Set([1]));
    expect(win.isDestroyed()).toBe(false);
    expect(quit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(win.isDestroyed()).toBe(true);
    expect(quit).not.toHaveBeenCalled();
  });

  it("treats explicit Quit like VS Code: save windows, close them, then quit the app", () => {
    const deliver = vi.fn();
    const quit = vi.fn();
    const windows = [new FakeWindow(1), new FakeWindow(2)];
    const lifecycle = createWindowLifecycle({
      deliver,
      getAllWindows: () => windows.filter((win) => !win.isDestroyed()),
      quit,
      closeTimeoutMs: 50,
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
});
