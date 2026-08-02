import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedHeader } from "@/components/editor/unified-header";
import en from "@/messages/en.json";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

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

const HEADER_ACTIONS = [/^Hide Files$/, /^Search \(/, /^More actions$/];

function headerAction(label: RegExp) {
  return screen.getByRole("button", { name: label });
}

describe("Header control alignment", () => {
  beforeEach(() => {
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: vi.fn(),
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
    useFileStore.setState({
      files: [page],
      currentFileId: page.id,
      openTabIds: [page.id],
      openTarget: "folder",
      rootPath: "/workspace",
    });
    useEditorStore.setState({ isDirty: false, isSaving: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // On macOS every control in the 44px bar — the tab strip, the title chip and
  // the two left buttons — is nudged 5px down to sit level with the native
  // traffic lights. "More actions" was the one control left on the header's
  // geometric centre, 5px above its neighbours, so the bar had no horizon.
  it("puts every header button on the same macOS traffic-light line", () => {
    renderHeader();

    for (const label of HEADER_ACTIONS) {
      expect(headerAction(label).className.split(/\s+/)).toContain("top-[5px]");
    }
  });

  // 13px, 15px and 15px across three adjacent 28px buttons read as three
  // different stroke weights. Chrome action buttons carry one glyph size.
  it("gives every header action button a 16px glyph", () => {
    renderHeader();

    for (const label of HEADER_ACTIONS) {
      const glyph = headerAction(label).querySelector("svg");
      expect(glyph, String(label)).not.toBeNull();
      expect(glyph!.getAttribute("class")?.split(/\s+/), String(label)).toEqual(
        expect.arrayContaining(["h-4", "w-4"])
      );
    }
  });
});
