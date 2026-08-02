import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * One highlight fill per menu.
 *
 * Measured on the packaged app, the block actions menu painted two: its own "Turn into" row hovered
 * to `accent` (rgb(240,240,240), cursor pointer) while the five shared `DropdownMenuItem`s below it
 * hovered to `--sidebar-hover` (rgb(236,238,241), cursor default) — a hue shift and a cursor flip
 * between row 1 and row 2 of one 265px panel. `accent` is also what the slash panel uses, so the
 * shared item moved onto it.
 */
describe("DropdownMenuItem highlight", () => {
  it("paints the focused row with accent, not the sidebar token", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const first = screen.getByRole("menuitem", { name: "Copy Markdown" });
    expect(first.className).not.toContain("bg-accent");

    await user.keyboard("{ArrowDown}");
    expect(first.className).toContain("bg-accent");
    expect(first.className).not.toContain("sidebar-hover");
  });

  it("acknowledges the pointer at the editor's 20ms, not Tailwind's default 150ms", () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const item = screen.getByRole("menuitem", { name: "Copy Markdown" });
    expect(item.className).toContain("duration-[20ms]");
    // The custom rows a caller renders into the same panel are `cursor-pointer`; these were the
    // only rows in the menu reading `cursor-default`.
    expect(item.className).toContain("cursor-pointer");
    expect(item.className).not.toContain("cursor-default");
  });
});

/**
 * `--sidebar-active` is `#ffffff`. That reads as an elevated pill against the sidebar's tinted
 * ground, which is what it is for — but `--popover` is also `#ffffff`, so on any overlay the token
 * paints nothing at all. The command palette used it for the keyboard-selected row: measured on the
 * packaged app, the selected row was rgb(255,255,255) on a rgb(255,255,255) panel, so arrowing
 * through the palette moved an invisible selection while the *unselected* rows still had a visible
 * hover fill.
 */
describe("overlay rows never use the sidebar's active token", () => {
  const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("is the same colour as a popover in the light theme, which is why it cannot be used there", () => {
    const root = globals.slice(globals.indexOf(":root"), globals.indexOf(".dark"));
    expect(/--sidebar-active:\s*#ffffff/.test(root)).toBe(true);
    expect(/--popover:\s*0 0% 100%/.test(root)).toBe(true);
  });

  it("is absent from every overlay component", () => {
    const dir = join(process.cwd(), "src/components/ui");
    // Comments stripped: the components that were fixed name the token in the note explaining why
    // they no longer use it, and that note should not read as a regression.
    const code = (name: string) =>
      readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    const offenders = readdirSync(dir)
      .filter((name) => /\.tsx?$/.test(name))
      .filter((name) => code(name).includes("--sidebar-active"));
    expect(offenders).toEqual([]);
  });
});
