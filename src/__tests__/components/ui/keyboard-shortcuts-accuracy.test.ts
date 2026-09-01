import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKSPACE_COMMANDS } from "@/lib/commands";

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const modal = read("src/components/ui/keyboard-shortcuts-modal.tsx");
const menus = read("electron/menus.js");

const binding = (id: string) =>
  WORKSPACE_COMMANDS.find((command) => command.id === id)?.defaultBinding;

describe("the shortcut reference matches the bindings", () => {
  // The modal is a hand-written table, so nothing stops it drifting from the code it documents.
  // It had been advertising Ctrl+K for the command palette after that moved.
  it("advertises the palette and the switcher on the keys the registry binds", () => {
    expect(modal).toContain('{ keys: ["Ctrl", "P"], descriptionKey: "commandPalette" }');
    expect(modal).toContain('{ keys: ["Ctrl", "O"], descriptionKey: "quickSwitcher" }');

    // One registry, so the reference and the binding cannot disagree the way they used to.
    expect(binding("command-palette")).toBe("Mod+P");
    expect(binding("quick-switcher")).toBe("Mod+O");
  });

  it("gives every registered command a unique default chord", () => {
    const bindings = WORKSPACE_COMMANDS.map((command) => command.defaultBinding).filter(Boolean);
    expect(new Set(bindings).size).toBe(bindings.length);
  });

  it("keeps the native menu on the same keys as the renderer", () => {
    expect(menus).toMatch(/label: "Quick Switcher…",\s*\n\s*accelerator: "CmdOrCtrl\+O"/);
    expect(menus).toMatch(/label: "Command Palette…",\s*\n\s*accelerator: "CmdOrCtrl\+P"/);
    // Open File… had to move off ⌘O to make room, and its own accelerator must stay unique.
    expect(menus).toMatch(/label: "Open File…",\s*\n\s*accelerator: "CmdOrCtrl\+Alt\+O"/);
  });

  it("leaves Mod+K to the editor's link editor", () => {
    // No command may claim it: with a selection, Mod+K opens the link editor instead.
    expect(WORKSPACE_COMMANDS.some((command) => command.defaultBinding === "Mod+K")).toBe(false);
    expect(modal).toContain('{ keys: ["Ctrl", "K"], descriptionKey: "insertLink" }');
  });

  it("leaves the accelerator unregistered exactly where the renderer owns the key", () => {
    // A registered accelerator is consumed by the native menu and never reaches the page. Two
    // things need the page to see the key anyway: a menu item that toggles something the
    // renderer also closes, and — since Settings ▸ Hotkeys — any key the user can reassign,
    // because an accelerator registered here would outlive their rebinding.
    const optedOut = menus.match(/^\s*registerAccelerator: false,$/gm) ?? [];
    const rebindableInMenu = [
      "CmdOrCtrl+N",
      "CmdOrCtrl+P",
      "CmdOrCtrl+O",
      "CmdOrCtrl+F",
      "CmdOrCtrl+Alt+F",
      "CmdOrCtrl+B",
      "F11",
    ].filter((accelerator) => menus.includes(`accelerator: "${accelerator}"`));
    expect(optedOut).toHaveLength(rebindableInMenu.length);
    expect(menus).toMatch(
      /label: "Command Palette…",\s*\n\s*accelerator: "CmdOrCtrl\+P",\s*\n\s*registerAccelerator: false/
    );
    expect(menus).toMatch(
      /label: "Toggle Sidebar",\s*\n\s*accelerator: "CmdOrCtrl\+B",\s*\n\s*registerAccelerator: false/
    );
  });
});
