import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const modal = read("src/components/ui/keyboard-shortcuts-modal.tsx");
const hook = read("src/hooks/use-editor-keyboard-shortcuts.ts");
const menus = read("electron/menus.js");

describe("the shortcut reference matches the bindings", () => {
  // The modal is a hand-written table, so nothing stops it drifting from the code it documents.
  // It had been advertising Ctrl+K for the command palette after that moved.
  it("advertises the palette and the switcher on the keys that actually open them", () => {
    expect(modal).toContain('{ keys: ["Ctrl", "P"], descriptionKey: "commandPalette" }');
    expect(modal).toContain('{ keys: ["Ctrl", "O"], descriptionKey: "quickSwitcher" }');

    expect(hook).toContain('e.key === "p"');
    expect(hook).toContain('(e.key === "Tab" || e.key === "o")');
  });

  it("keeps the native menu on the same keys as the renderer", () => {
    expect(menus).toMatch(/label: "Quick Switcher…",\s*\n\s*accelerator: "CmdOrCtrl\+O"/);
    expect(menus).toMatch(/label: "Command Palette…",\s*\n\s*accelerator: "CmdOrCtrl\+P"/);
    // Open File… had to move off ⌘O to make room, and its own accelerator must stay unique.
    expect(menus).toMatch(/label: "Open File…",\s*\n\s*accelerator: "CmdOrCtrl\+Alt\+O"/);
  });

  it("leaves Mod+K to the editor's link editor", () => {
    // The hook must not claim it: with a selection, Mod+K opens the link editor instead.
    expect(hook).not.toContain('e.key === "k"');
    expect(modal).toContain('{ keys: ["Ctrl", "K"], descriptionKey: "insertLink" }');
  });

  it("leaves the accelerator unregistered only where the renderer owns the toggle", () => {
    // A registered accelerator is consumed by the native menu and never reaches the page, so a
    // menu item that only *opens* something can stay registered. These two also close.
    const unregistered = menus.match(/^\s*registerAccelerator: false,$/gm) ?? [];
    expect(unregistered).toHaveLength(2);
    expect(menus).toMatch(
      /label: "Command Palette…",\s*\n\s*accelerator: "CmdOrCtrl\+P",\s*\n\s*registerAccelerator: false/
    );
    expect(menus).toMatch(
      /label: "Toggle Sidebar",\s*\n\s*accelerator: "CmdOrCtrl\+B",\s*\n\s*registerAccelerator: false/
    );
  });
});
