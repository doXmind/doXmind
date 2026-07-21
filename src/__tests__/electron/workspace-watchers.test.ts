import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWorkspaceWatchers } = require("../../../electron/workspace-watchers.js") as {
  createWorkspaceWatchers: (options: {
    onChanged: (webContentsId: number, payload: { root: string }) => void;
    resolveRoot?: (root: string) => string;
    watchFactory?: (
      root: string,
      options: { recursive: boolean },
      listener: (eventType: string, filename: string | null) => void
    ) => FakeWatcher;
    debounceMs?: number;
    maxCoalesceMs?: number;
  }) => {
    watch: (webContentsId: number, root: string) => void;
    unwatch: (webContentsId: number, root: string) => void;
    remove: (webContentsId: number) => void;
  };
};

class FakeWatcher {
  readonly close = vi.fn();
  private listener: (eventType: string, filename: string | null) => void;

  constructor(listener: (eventType: string, filename: string | null) => void) {
    this.listener = listener;
  }

  emit(filename: string | null) {
    this.listener("rename", filename);
  }

  on() {
    return this;
  }
}

describe("Electron workspace watchers", () => {
  let created: Array<{ root: string; watcher: FakeWatcher }>;
  let watchFactory: (
    root: string,
    options: { recursive: boolean },
    listener: (eventType: string, filename: string | null) => void
  ) => FakeWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
    watchFactory = vi.fn((root, options, listener) => {
      expect(options).toEqual({ recursive: true });
      const watcher = new FakeWatcher(listener);
      created.push({ root, watcher });
      return watcher;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces relevant changes and emits only to the owning webContents", () => {
    const onChanged = vi.fn();
    const watchers = createWorkspaceWatchers({
      onChanged,
      resolveRoot: (root) => `/canonical${root}`,
      watchFactory,
      debounceMs: 40,
      maxCoalesceMs: 80,
    });

    watchers.watch(17, "/workspace");
    created[0].watcher.emit("Notes/Plan.md");
    created[0].watcher.emit("Notes/Other.md");

    vi.advanceTimersByTime(39);
    expect(onChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledWith(17, { root: "/canonical/workspace" });
  });

  it("caps a continuously extended coalesce window", () => {
    const onChanged = vi.fn();
    const watchers = createWorkspaceWatchers({
      onChanged,
      resolveRoot: (root) => root,
      watchFactory,
      debounceMs: 20,
      maxCoalesceMs: 50,
    });
    watchers.watch(17, "/workspace");

    created[0].watcher.emit("Plan.md");
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(15);
      created[0].watcher.emit("Plan.md");
    }
    vi.advanceTimersByTime(4);
    expect(onChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("keeps a replacement watcher when a stale unwatch arrives", () => {
    const watchers = createWorkspaceWatchers({
      onChanged: vi.fn(),
      resolveRoot: (root) => `/canonical${root}`,
      watchFactory,
    });

    watchers.watch(17, "/folder-a");
    watchers.watch(17, "/folder-b");
    watchers.unwatch(17, "/folder-a");

    expect(created[0].watcher.close).toHaveBeenCalledOnce();
    expect(created[1].watcher.close).not.toHaveBeenCalled();

    watchers.unwatch(17, "/folder-b");
    expect(created[1].watcher.close).toHaveBeenCalledOnce();
  });

  it("treats a single trailing separator as the same raw root", () => {
    const watchers = createWorkspaceWatchers({
      onChanged: vi.fn(),
      resolveRoot: (root) => `/canonical${root}`,
      watchFactory,
    });

    watchers.watch(17, `/workspace${sep}`);
    watchers.watch(17, "/workspace");

    expect(watchFactory).toHaveBeenCalledOnce();
    expect(created[0].watcher.close).not.toHaveBeenCalled();
  });

  it("leaves the existing watcher alive when a replacement cannot start", () => {
    const watchers = createWorkspaceWatchers({
      onChanged: vi.fn(),
      resolveRoot: (root) => {
        if (root === "/missing") throw new Error("missing workspace");
        return `/canonical${root}`;
      },
      watchFactory,
    });

    watchers.watch(17, "/workspace");
    expect(() => watchers.watch(17, "/missing")).toThrow("missing workspace");
    expect(created[0].watcher.close).not.toHaveBeenCalled();
  });

  it("ignores generated sidecars and scan-excluded directories", () => {
    const onChanged = vi.fn();
    const watchers = createWorkspaceWatchers({
      onChanged,
      resolveRoot: (root) => root,
      watchFactory,
      debounceMs: 10,
      maxCoalesceMs: 20,
    });
    watchers.watch(17, "/workspace");

    for (const filename of [
      ".Page.doxmind",
      ".Page.doxmind.lock",
      ".Page.doxmind.bak",
      ".Page.doxmind.corrupt-20260721",
      ".doxmind/index.json",
      ".git/index",
      "node_modules/pkg/index.js",
    ]) {
      created[0].watcher.emit(filename);
    }
    vi.advanceTimersByTime(100);

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not ignore a real change just because the workspace has an ignored ancestor", () => {
    const root = resolve("build", "nested-workspace");
    const onChanged = vi.fn();
    const watchers = createWorkspaceWatchers({
      onChanged,
      resolveRoot: () => root,
      watchFactory,
      debounceMs: 10,
      maxCoalesceMs: 20,
    });
    watchers.watch(17, root);

    created[0].watcher.emit(join(root, "Plan.md"));
    vi.advanceTimersByTime(10);

    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("stops pending delivery and closes the watcher when a window is destroyed", () => {
    const onChanged = vi.fn();
    const watchers = createWorkspaceWatchers({
      onChanged,
      resolveRoot: (root) => root,
      watchFactory,
      debounceMs: 10,
      maxCoalesceMs: 20,
    });
    watchers.watch(17, "/workspace");
    created[0].watcher.emit("Plan.md");

    watchers.remove(17);
    vi.advanceTimersByTime(100);

    expect(created[0].watcher.close).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
