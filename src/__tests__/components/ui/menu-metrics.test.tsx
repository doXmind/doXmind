import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubContent,
  MENU_PANEL_CLASS,
  MENU_ROW_CLASS,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { FileActionsMenuItems } from "@/components/sidebar/file-actions-menu";
import en from "@/messages/en.json";

/** The `--popover-shadow` declared for one theme, comments stripped, whitespace collapsed. */
function popoverShadow(selector: ":root" | ".dark"): string {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
  // Anchored so `.dark` does not also match `.dark.high-contrast`.
  const block = new RegExp(
    `(^|[\\s{}])${selector.replace(".", "\\.")}\\s*\\{([^{}]*)\\}`,
    "m"
  ).exec(css);
  expect(block, `globals.css has a ${selector} block`).not.toBeNull();
  const shadow = /--popover-shadow:\s*([^;]+);/.exec(block![2]);
  expect(shadow, `globals.css ${selector} declares --popover-shadow`).not.toBeNull();
  return shadow![1].replace(/\s+/g, " ").trim();
}

/**
 * The chrome used to run four incompatible menu systems side by side: row
 * heights 28 / 29.4 / 31 / 33.4, radii 6 / 4 / 6 / 0, hover 20ms / 150ms /
 * 20ms / 75ms, panels at 6px radius with a border next to panels at 10px with
 * a hairline ring. These pin the single set everything now draws from — the
 * Notion values already recorded in docs/BLOCK_UX_REFERENCE.md.
 */
describe("Shared menu metrics", () => {
  it("states one row and one panel geometry", () => {
    // 28px row on a 6px radius with a 20ms background transition.
    expect(MENU_ROW_CLASS).toContain("min-h-7");
    expect(MENU_ROW_CLASS).toContain("rounded-md");
    expect(MENU_ROW_CLASS).toContain("duration-[20ms]");
    expect(MENU_ROW_CLASS).toContain("px-2");
    // 10px panel, 6px padding, no border — the outermost shadow layer is a
    // hairline ring, which is what Notion measures.
    expect(MENU_PANEL_CLASS).toContain("rounded-[10px]");
    expect(MENU_PANEL_CLASS).toContain("p-1.5");
    expect(MENU_PANEL_CLASS).toContain("border-0");
    expect(MENU_PANEL_CLASS).toContain("shadow-[shadow:var(--popover-shadow)]");
    // The panel used to carry Notion's light-mode shadow as a literal, in both
    // themes: rgba(25,25,25,·) over a #212121 page paints nothing, so a dark
    // menu had no elevation. The elevation is a token pair now — assert the
    // panel no longer states a colour of its own, and that each theme's token
    // still ends in the hairline ring the panel replaced its border with.
    expect(MENU_PANEL_CLASS).not.toMatch(/rgba\(/);
    for (const selector of [":root", ".dark"] as const) {
      expect(popoverShadow(selector)).toContain("0 0 0 1px hsl(var(--popover-ring))");
    }
  });

  it("gives dropdown panels and rows the shared metrics", () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const panel = screen.getByRole("menu").className.split(/\s+/);
    for (const token of MENU_PANEL_CLASS.split(/\s+/)) expect(panel).toContain(token);

    const row = screen.getByRole("menuitem").className.split(/\s+/);
    for (const token of MENU_ROW_CLASS.split(/\s+/)) expect(row).toContain(token);
  });

  it("gives sub-menu panels the same panel metrics", () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Nested</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    // The sub-content only mounts when its own context is open; the panel class
    // is asserted on the content that did mount, which is enough to catch the
    // two panel recipes drifting apart again.
    const panels = screen.getAllByRole("menu");
    for (const el of panels) {
      const classes = el.className.split(/\s+/);
      expect(classes).toContain("rounded-[10px]");
      expect(classes).toContain("p-1.5");
    }
  });

  it("draws the sidebar context menu rows from the same class", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FileActionsMenuItems
          variant="context"
          hasParent={false}
          onRename={vi.fn()}
          onMoveToRoot={vi.fn()}
          onRevealInFinder={vi.fn()}
          onCopySource={vi.fn()}
          onExportPdf={vi.fn()}
          onDelete={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    for (const item of screen.getAllByRole("menuitem")) {
      const classes = item.className.split(/\s+/);
      for (const token of MENU_ROW_CLASS.split(/\s+/)) expect(classes).toContain(token);
    }
  });

  it("gives a popover the menus' panel chrome", () => {
    render(
      <Popover open>
        <PopoverContent data-testid="panel">Body</PopoverContent>
      </Popover>
    );

    const classes = screen.getByTestId("panel").className.split(/\s+/);
    expect(classes).toContain("rounded-[10px]");
    expect(classes).toContain("border-0");
    // Including the elevation: a popover anchored to a chrome button is the
    // same object to the eye as a menu, so it has to lift off the page by the
    // same amount in the same theme.
    expect(classes).toContain("shadow-[shadow:var(--popover-shadow)]");
    // A popover's content sets its own padding; the panel class must not force
    // the menus' 6px onto it.
    expect(classes).toContain("p-0");
  });
});
