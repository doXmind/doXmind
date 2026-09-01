import * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageHistoryPanel, type PageHistoryServices } from "@/components/editor/page-history-panel";
import en from "@/messages/en.json";
import { useLayoutStore } from "@/stores/layout-store";
import type { FileItem } from "@/types";

const page: FileItem = {
  id: "page-1",
  name: "Note.md",
  content: "now\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 1,
  preview: "now",
  documentType: "markdown",
  storageHandle: {
    mode: "disk",
    id: "page-1",
    kind: "document",
    documentType: "markdown",
    path: "Note.md",
    relPath: "Note.md",
  },
};

function services(overrides: Partial<PageHistoryServices> = {}): PageHistoryServices {
  return {
    list: vi.fn().mockResolvedValue([{ id: "1700000000000", capturedAt: 1700000000000 }]),
    read: vi.fn().mockResolvedValue("earlier\n"),
    saveCurrentPage: vi.fn().mockResolvedValue(true),
    restore: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const withIntl = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

describe("PageHistoryPanel", () => {
  beforeEach(() => {
    useLayoutStore.setState({ isVersionHistoryOpen: false });
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: vi.fn(),
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
  });

  it("restores a snapshot through the ordinary write, after flushing the editor", async () => {
    const user = userEvent.setup();
    const svc = services();
    render(withIntl(<PageHistoryPanel file={page} services={svc} />));

    await user.click(screen.getByRole("button", { name: "History" }));
    const entry = await screen.findByRole("button", { name: /Restore the version from/ });
    await user.click(entry);

    // Flushed first: with a dirty editor the pending autosave would overwrite the restore.
    expect(svc.saveCurrentPage).toHaveBeenCalledWith("page-1");
    expect(svc.restore).toHaveBeenCalledWith("page-1", "earlier\n");
    expect(useLayoutStore.getState().isVersionHistoryOpen).toBe(false);
  });

  it("refuses to restore over an unsaved Page rather than losing the edit", async () => {
    const user = userEvent.setup();
    const svc = services({ saveCurrentPage: vi.fn().mockResolvedValue(false) });
    render(withIntl(<PageHistoryPanel file={page} services={svc} />));

    await user.click(screen.getByRole("button", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: /Restore the version from/ }));

    expect(svc.restore).not.toHaveBeenCalled();
    expect(await screen.findByText(/Save the Page before restoring/)).toBeInTheDocument();
  });

  it("says so when a Page has nothing to come back to", async () => {
    const user = userEvent.setup();
    render(
      withIntl(
        <PageHistoryPanel
          file={page}
          services={services({ list: vi.fn().mockResolvedValue([]) })}
        />
      )
    );

    await user.click(screen.getByRole("button", { name: "History" }));

    expect(await screen.findByText("No earlier versions yet.")).toBeInTheDocument();
  });
});
