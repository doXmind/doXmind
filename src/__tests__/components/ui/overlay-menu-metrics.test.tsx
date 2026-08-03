import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "@/components/ui/command-palette";
import { QuickSwitcher } from "@/components/ui/quick-switcher";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "@/components/ui/dropdown-menu";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import en from "@/messages/en.json";

/**
 * The two centred overlay lists were the last surfaces still running their own
 * menu geometry. Measured on the packaged app before this: the command palette
 * was a 512px panel at radius 12px with a 1px border and shadow-2xl, holding
 * square-cornered 33.4px rows — 36.00px on the two rows that carried a bordered
 * ⌘ chip — and the quick switcher was a second panel at 448px with 38.4px rows.
 * Every other menu in the app was already 28px rows / 6px radius / 20ms inside a
 * 10px panel with a hairline ring. After: both draw from MENU_PANEL_CLASS and
 * MENU_ROW_CLASS, every row measures 28.00px at radius 6px in both themes, and
 * the two panels share one width.
 *
 * Asserted on the classes rather than on layout because jsdom does not lay out;
 * the pixel numbers above come from the packaged app.
 */

// Both overlays keep the keyboard selection in view; jsdom has no layout and
// therefore no `scrollIntoView`.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const withIntl = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

const panelTokens = (el: Element) => el.className.split(/\s+/);

function expectSharedSurface(panel: Element) {
  const classes = panelTokens(panel);
  // The panel is the menus' surface with their 6px row padding turned off —
  // this dialog's header and footer are full-bleed rows with their own divider.
  for (const token of MENU_PANEL_CLASS.split(/\s+/)) {
    if (token === "p-1.5") continue;
    expect(classes).toContain(token);
  }
  expect(classes).toContain("p-0");
  // The recipes these panels used to carry.
  expect(classes).not.toContain("rounded-xl");
  expect(classes).not.toContain("shadow-2xl");
  expect(classes).not.toContain("border");
}

function expectSharedRows(rows: HTMLElement[]) {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const classes = panelTokens(row);
    for (const token of MENU_ROW_CLASS.split(/\s+/)) expect(classes).toContain(token);
    // A row's own vertical padding is what made these 33.4px and 38.4px; the
    // shared class carries a 28px min-height instead.
    expect(classes.some((c) => /^py-/.test(c))).toBe(false);
  }
}

describe("Command palette", () => {
  beforeEach(() => {
    useFileStore.setState({ files: [], rootPath: null, currentFileId: null });
  });

  it("draws its panel and rows from the shared menu classes", () => {
    render(withIntl(<CommandPalette open onClose={vi.fn()} />));

    expectSharedSurface(screen.getByRole("dialog", { name: "Command palette" }));
    expectSharedRows(screen.getAllByRole("option"));
  });

  it("renders a shortcut as the menus' plain right-aligned hint, not a bordered chip", () => {
    render(withIntl(<CommandPalette open onClose={vi.fn()} />));

    // Two rows carried an `h-5` bordered <kbd> each, which is the only reason
    // they measured 36.00px against their neighbours' 33.4px.
    for (const row of screen.getAllByRole("option")) {
      expect(row.querySelector("kbd")).toBeNull();
    }
    // The hint itself survives — only its packaging changed.
    expect(screen.getByRole("option", { name: /New Page/ }).textContent).toMatch(/N$/);
    // The footer legend is not a menu row and keeps its keycaps. The palette
    // renders through a portal, so it is not inside `container`.
    expect(document.body.querySelectorAll("kbd").length).toBeGreaterThan(0);
  });

  it("puts a row's icon and the search glyph on the same left edge", () => {
    render(withIntl(<CommandPalette open onClose={vi.fn()} />));

    // 6px of list padding plus the row's own 8px = 14px, so the header, the
    // group labels and the footer are all px-3.5 / px-2 to match.
    const input = screen.getByRole("textbox", { name: "Search commands" });
    expect(panelTokens(input.parentElement!)).toContain("px-3.5");
    const list = screen.getByRole("listbox", { name: "Commands" });
    expect(panelTokens(list)).toContain("p-1.5");
  });
});

describe("Quick switcher", () => {
  beforeEach(() => {
    useLayoutStore.setState({ isQuickSwitcherOpen: true });
    useFileStore.setState({
      currentFileId: "a",
      files: [
        {
          id: "a",
          name: "Alpha.md",
          isFolder: false,
          updatedAt: new Date().toISOString(),
        },
        {
          id: "b",
          name: "Beta.md",
          isFolder: false,
          updatedAt: new Date().toISOString(),
        },
      ] as never,
    });
  });

  it("draws its panel and rows from the shared menu classes", () => {
    render(withIntl(<QuickSwitcher />));

    const panel = screen.getByRole("dialog");
    expectSharedSurface(panel);
    expectSharedRows(screen.getAllByRole("option"));
  });

  it("is the same width as the command palette", () => {
    render(withIntl(<QuickSwitcher />));
    expect(panelTokens(screen.getByRole("dialog"))).toContain("max-w-lg");
    expect(panelTokens(screen.getByRole("dialog"))).not.toContain("max-w-md");
  });
});
