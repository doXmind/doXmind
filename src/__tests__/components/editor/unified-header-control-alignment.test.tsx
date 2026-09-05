import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// The magnifier that sat between these two is gone: it opened the command palette, while the
// sidebar's own magnifier — the same glyph at the same size, forty pixels away in the same column —
// opened the workspace search. Two identical icons, and the one in the chrome gave the shallower
// results of the two. ⌘P and the Edit menu still reach the palette.
const HEADER_ACTIONS = [/^Hide Files$/, /^More actions$/];

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

  // The buttons carry no vertical nudge at all, so all three sit on the 44px
  // header's own centre line (y=22 measured in the packaged app). They used to
  // be pushed down 5px "to meet the traffic lights", but electron/main.js sets
  // `trafficLightPosition` from the assumption that these buttons are centred —
  // the nudge moved every control in the bar 5px below the centre it was
  // supposed to share, and nothing was aligned to anything.
  it("leaves every header button on the header's own centre line", () => {
    renderHeader();

    for (const label of HEADER_ACTIONS) {
      const classes = headerAction(label).className.split(/\s+/);
      expect(classes, String(label)).not.toContain("top-[5px]");
      expect(
        classes.filter((name) => /^-?top-/.test(name)),
        String(label)
      ).toEqual([]);
    }
  });

  // Nothing in the DOM can align to the traffic lights — they are native
  // NSViews, so electron/main.js has to place them on the line the header
  // centres its own buttons on. Measured on macOS: `trafficLightPosition` is
  // the cluster's top-left frame corner and the 12px dot's centre lands 7px
  // below it, so a 44px header wants y=15. The previous y=19 painted the dots
  // 4px below the toggle/search glyphs.
  it("places the native traffic lights on the header's centre line", () => {
    const HEADER_HEIGHT = 44; // h-11
    const DOT_CENTRE_BELOW_POSITION = 7;

    const main = readFileSync(join(process.cwd(), "electron/main.js"), "utf8");
    const y = /trafficLightPosition: \{ x: 12, y: (\d+) \}/.exec(main)?.[1];

    expect(y, "trafficLightPosition not found in electron/main.js").toBeDefined();
    expect(Number(y) + DOT_CENTRE_BELOW_POSITION).toBe(HEADER_HEIGHT / 2);
  });

  // Three things hang off the window's right edge — this button, the outline
  // rail and the word count. They stopped at 24px, 8px and 16px. One inset.
  it("pins the more-actions button to the one 16px chrome inset", () => {
    renderHeader();

    const rail = headerAction(/^More actions$/).closest("div.absolute");
    expect(rail).not.toBeNull();
    const classes = rail!.className.split(/\s+/);
    expect(classes).toContain("right-4");
    expect(classes.filter((name) => /^(md:)?right-/.test(name))).toEqual(["right-4"]);
  });

  // The tab strip hangs below the 44px header on purpose so the active tab
  // merges into the page behind it. At 5px its bottom edge measured y=49.0 on
  // the packaged app while the Page-properties row's top measured y=48.0, so
  // the strip — inside a z-30 floating header — painted over the first pixel of
  // a row it has nothing to do with. 4px lands it flush at y=48.0.
  it("hangs the tab strip 4px below the header, not 5px onto the row underneath", () => {
    renderHeader();

    const strip = screen.getByRole("tablist");
    const classes = strip.className.split(/\s+/);
    expect(classes).toContain("top-1");
    expect(classes).not.toContain("top-[5px]");
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
