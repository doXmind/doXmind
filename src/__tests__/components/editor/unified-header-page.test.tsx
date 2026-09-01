import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedHeader } from "@/components/editor/unified-header";
import en from "@/messages/en.json";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

const copyPageMarkdownSourceMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("@/lib/markdown-source-copy", () => ({
  copyPageMarkdownSource: copyPageMarkdownSourceMock,
}));

const page: FileItem = {
  id: "page-1",
  name: "Page.md",
  content: "Draft\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 1,
  preview: "Draft",
  documentType: "markdown",
};

function renderHeader() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <UnifiedHeader />
    </NextIntlClientProvider>
  );
}

describe("UnifiedHeader Page safety", () => {
  beforeEach(() => {
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: vi.fn(),
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
    copyPageMarkdownSourceMock.mockClear();
    useFileStore.setState({
      files: [page],
      currentFileId: page.id,
      openTabIds: [page.id],
      openTarget: "folder",
      rootPath: "/workspace",
    });
    useEditorStore.setState({ isDirty: true, isSaving: false });
    useEditorRefStore.setState({ requestSave: null, discardPendingChanges: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes the header Save action through the mounted editor", async () => {
    const user = userEvent.setup();
    const requestSave = vi.fn().mockResolvedValue(true);
    useEditorRefStore.setState({ requestSave });
    renderHeader();

    await user.click(screen.getByLabelText("More actions"));
    await user.click(screen.getByRole("menuitem", { name: /^Save/ }));

    expect(requestSave).toHaveBeenCalledOnce();
  });

  it("offers an exact Markdown source-copy action in the desktop shell", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByLabelText("More actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Copy Markdown Source" }));

    expect(copyPageMarkdownSourceMock).toHaveBeenCalledWith(page.id, "Copy Markdown Source");
  });

  it("cancels pending editor writes before a confirmed discard closes the Page", async () => {
    const user = userEvent.setup();
    const discardPendingChanges = vi.fn(() => {
      expect(useFileStore.getState().currentFileId).toBe(page.id);
    });
    // Registered as a real editor rather than stubbed onto the mirror: the discard is looked
    // up by Page now, so that closing the other pane's tab cannot discard the focused one.
    useEditorRefStore.getState().registerEditor("pane-left", {
      fileId: page.id,
      requestSave: vi.fn(async () => true),
      requestUndo: vi.fn(),
      requestRedo: vi.fn(),
      requestFoldAll: vi.fn(),
      discardPendingChanges,
    });
    renderHeader();

    await user.click(screen.getByLabelText("Close"));
    await user.click(screen.getByRole("button", { name: "Don't Save" }));

    expect(discardPendingChanges).toHaveBeenCalledOnce();
    expect(useFileStore.getState().currentFileId).toBeNull();
  });
});
