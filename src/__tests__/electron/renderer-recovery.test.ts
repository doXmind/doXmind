import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { attachRendererRecovery, DEFAULT_RENDERER_READY_TIMEOUT_MS, RECOVERY_STABILITY_MS } =
  require("../../../electron/renderer-recovery.js") as {
    attachRendererRecovery: typeof import("../../../electron/renderer-recovery.js").attachRendererRecovery;
    DEFAULT_RENDERER_READY_TIMEOUT_MS: number;
    RECOVERY_STABILITY_MS: number;
  };

class FakeWindow extends EventEmitter {
  _doxmindClosePending = false;
  _doxmindRendererGone = false;
  readonly webContents = new EventEmitter();

  isDestroyed() {
    return false;
  }
}

describe("Electron renderer recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("automatically rebuilds the window once when its renderer disappears", () => {
    const win = new FakeWindow();
    const target = { kind: "file", path: "/notes/Plan.md" };
    const recover = vi.fn();
    const fail = vi.fn();

    attachRendererRecovery({
      win,
      target,
      recoveryAttempt: 0,
      recover,
      fail,
      close: vi.fn(),
      timeoutMs: 0,
    });
    win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });

    expect(win._doxmindRendererGone).toBe(true);
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith({
      win,
      target,
      recoveryAttempt: 1,
      failure: {
        kind: "render-process-gone",
        reason: "killed",
        exitCode: 9,
      },
    });
    expect(fail).not.toHaveBeenCalled();
  });

  it("restores the automatic retry budget after the replacement stays stable", () => {
    const win = new FakeWindow();
    const recover = vi.fn();
    const fail = vi.fn();

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 1,
      recover,
      fail,
      close: vi.fn(),
      timeoutMs: 0,
    });
    win.emit("ready-to-show");
    vi.advanceTimersByTime(RECOVERY_STABILITY_MS);
    win.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 5 });

    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ recoveryAttempt: 1 }));
    expect(fail).not.toHaveBeenCalled();
  });

  it("surfaces a replacement that crashes again before becoming stable", () => {
    const win = new FakeWindow();
    const recover = vi.fn();
    const fail = vi.fn();

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 1,
      recover,
      fail,
      close: vi.fn(),
      timeoutMs: 0,
    });
    win.emit("ready-to-show");
    win.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 5 });

    expect(recover).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });

  it("surfaces a failure instead of looping when the automatic rebuild also dies", () => {
    const win = new FakeWindow();
    const recover = vi.fn();
    const fail = vi.fn();

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 1,
      recover,
      fail,
      close: vi.fn(),
      timeoutMs: 0,
    });
    win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });

    expect(recover).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith({
      win,
      target: null,
      failure: {
        kind: "render-process-gone",
        reason: "killed",
        exitCode: 9,
      },
    });
  });

  it("recovers when no renderer becomes ready before the startup deadline", () => {
    const win = new FakeWindow();
    const recover = vi.fn();

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 0,
      recover,
      fail: vi.fn(),
      close: vi.fn(),
    });
    vi.advanceTimersByTime(DEFAULT_RENDERER_READY_TIMEOUT_MS);

    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryAttempt: 1,
        failure: { kind: "startup-timeout" },
      })
    );
  });

  it("cancels the startup deadline after the window is ready", () => {
    const win = new FakeWindow();
    const recover = vi.fn();
    const fail = vi.fn();

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 0,
      recover,
      fail,
      close: vi.fn(),
    });
    win.emit("ready-to-show");
    vi.advanceTimersByTime(DEFAULT_RENDERER_READY_TIMEOUT_MS);

    expect(recover).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("recovers when the main frame fails to load", () => {
    const win = new FakeWindow();
    const recover = vi.fn();

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 0,
      recover,
      fail: vi.fn(),
      close: vi.fn(),
      timeoutMs: 0,
    });
    win.webContents.emit(
      "did-fail-load",
      {},
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "http://127.0.0.1/editor/",
      true
    );

    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: {
          kind: "did-fail-load",
          errorCode: -105,
          errorDescription: "ERR_NAME_NOT_RESOLVED",
        },
      })
    );
  });

  it("ignores aborted navigations and subframe load failures", () => {
    const win = new FakeWindow();
    const recover = vi.fn();

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 0,
      recover,
      fail: vi.fn(),
      close: vi.fn(),
      timeoutMs: 0,
    });
    win.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "", true);
    win.webContents.emit("did-fail-load", {}, -105, "ERR_FAILED", "", false);

    expect(recover).not.toHaveBeenCalled();
  });

  it("recovers when loadURL rejects without a load-failure event", () => {
    const win = new FakeWindow();
    const recover = vi.fn();

    const recovery = attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 0,
      recover,
      fail: vi.fn(),
      close: vi.fn(),
      timeoutMs: 0,
    });
    recovery.handleLoadFailure(new Error("renderer refused the navigation"));

    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: {
          kind: "load-url-rejected",
          message: "renderer refused the navigation",
        },
      })
    );
  });

  it("deduplicates overlapping load and renderer failure signals", () => {
    const win = new FakeWindow();
    const recover = vi.fn();

    const recovery = attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 0,
      recover,
      fail: vi.fn(),
      close: vi.fn(),
      timeoutMs: 0,
    });
    win.webContents.emit("did-fail-load", {}, -105, "ERR_FAILED", "", true);
    recovery.handleLoadFailure(new Error("load failed"));
    win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });

    expect(recover).toHaveBeenCalledOnce();
  });

  it("finishes a pending close when the renderer startup times out", () => {
    const win = new FakeWindow();
    const recover = vi.fn();
    const fail = vi.fn();
    const close = vi.fn();
    win._doxmindClosePending = true;

    attachRendererRecovery({
      win,
      target: null,
      recoveryAttempt: 0,
      recover,
      fail,
      close,
      timeoutMs: 50,
    });
    vi.advanceTimersByTime(50);

    expect(recover).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(win);
  });
});
