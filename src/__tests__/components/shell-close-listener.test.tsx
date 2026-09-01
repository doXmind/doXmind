import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { onShellCloseRequestedMock } = vi.hoisted(() => ({
  onShellCloseRequestedMock: vi.fn(),
}));

vi.mock("@/lib/shell/close", () => ({
  onShellCloseRequested: onShellCloseRequestedMock,
}));

import { ShellCloseListener } from "@/components/providers";
import { useEditorRefStore } from "@/stores/editor-ref-store";

const handles = (fileId: string, requestSave: () => Promise<boolean>) => ({
  fileId,
  requestSave,
  requestUndo: vi.fn(),
  requestRedo: vi.fn(),
  requestFoldAll: vi.fn(),
  discardPendingChanges: vi.fn(),
});

/** The callback the shell will run when the window is asked to close. */
async function capturedFlush() {
  await waitFor(() => expect(onShellCloseRequestedMock).toHaveBeenCalled());
  return onShellCloseRequestedMock.mock.calls[0][0] as () => Promise<boolean>;
}

describe("ShellCloseListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onShellCloseRequestedMock.mockResolvedValue(() => {});
    useEditorRefStore.setState({ editors: {}, activeEditorId: null });
  });

  it("saves every open pane before the window closes, not just the focused one", async () => {
    const activeSave = vi.fn(async () => true);
    const otherSave = vi.fn(async () => true);
    useEditorRefStore.getState().registerEditor("pane-a", handles("a", activeSave));
    useEditorRefStore.getState().registerEditor("pane-b", handles("b", otherSave));

    render(<ShellCloseListener />);
    const flush = await capturedFlush();

    await expect(flush()).resolves.toBe(true);
    // The unfocused pane's edits are on screen and unsaved; closing must not drop them.
    expect(activeSave).toHaveBeenCalledTimes(1);
    expect(otherSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the window open when a pane's save is cancelled", async () => {
    useEditorRefStore.getState().registerEditor(
      "pane-a",
      handles("a", async () => true)
    );
    useEditorRefStore.getState().registerEditor(
      "pane-b",
      handles("b", async () => false)
    );

    render(<ShellCloseListener />);
    const flush = await capturedFlush();

    await expect(flush()).resolves.toBe(false);
  });
});
