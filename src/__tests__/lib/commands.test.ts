import { describe, expect, it } from "vitest";

import { WORKSPACE_COMMANDS, bindingForEvent, formatBinding } from "@/lib/commands";
import { bindingFor, commandsByBinding, conflictingCommandIds } from "@/stores/hotkeys-store";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

const event = (init: Partial<KeyboardEvent>) =>
  ({
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    code: "",
    key: "",
    ...init,
  }) as KeyboardEvent;

describe("bindingForEvent", () => {
  it("reads a letter from the code, so a macOS Alt chord still matches", () => {
    // ⌥F emits "ƒ" as `key`; a binding read from `key` would never match once Alt is held.
    expect(bindingForEvent(event({ metaKey: true, altKey: true, code: "KeyF", key: "ƒ" }))).toBe(
      "Mod+Alt+F"
    );
  });

  it("normalizes Cmd and Ctrl to one Mod, so one binding describes both platforms", () => {
    expect(bindingForEvent(event({ metaKey: true, code: "KeyP", key: "p" }))).toBe("Mod+P");
    expect(bindingForEvent(event({ ctrlKey: true, code: "KeyP", key: "p" }))).toBe("Mod+P");
  });

  it("ignores a bare letter, which is typing rather than a command", () => {
    expect(bindingForEvent(event({ code: "KeyP", key: "p" }))).toBeNull();
  });

  it("keeps a function key bindable on its own", () => {
    expect(bindingForEvent(event({ key: "F11" }))).toBe("F11");
  });
});

describe("the registry", () => {
  it("has a label in both catalogs for every command", () => {
    // A missing label is invisible to the key-parity check — both catalogs lack it equally — and
    // shows up in the UI as the raw message key, which is how `commands.dailyNote` shipped.
    const missing = WORKSPACE_COMMANDS.filter(
      (command) =>
        !(command.labelKey in en.commands) || !(command.labelKey in (zh.commands as object))
    ).map((command) => command.labelKey);
    expect(missing).toEqual([]);
  });

  it("gives every command a unique id", () => {
    const ids = WORKSPACE_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no default conflicts", () => {
    expect([...conflictingCommandIds({})]).toEqual([]);
  });

  it("leaves Mod+K free for the editor's link editor", () => {
    expect(commandsByBinding({}).has("Mod+K")).toBe(false);
  });
});

describe("overrides", () => {
  it("uses the default until the user changes it, so a new default still reaches them", () => {
    const palette = WORKSPACE_COMMANDS.find((command) => command.id === "command-palette")!;
    expect(bindingFor(palette, {})).toBe("Mod+P");
    expect(bindingFor(palette, { "command-palette": "Mod+Shift+P" })).toBe("Mod+Shift+P");
  });

  it("treats a deliberate unbind as different from absent", () => {
    const palette = WORKSPACE_COMMANDS.find((command) => command.id === "command-palette")!;
    expect(bindingFor(palette, { "command-palette": null })).toBeNull();
    expect(commandsByBinding({ "command-palette": null }).has("Mod+P")).toBe(false);
  });

  it("flags both sides of a conflict, so the settings page can show it", () => {
    const conflicts = conflictingCommandIds({ "quick-switcher": "Mod+P" });
    expect(conflicts.has("quick-switcher")).toBe(true);
    expect(conflicts.has("command-palette")).toBe(true);
  });
});

describe("formatBinding", () => {
  it("writes the chord the way each platform writes it", () => {
    expect(formatBinding("Mod+Alt+F", true)).toBe("⌘⌥F");
    expect(formatBinding("Mod+Alt+F", false)).toBe("Ctrl+Alt+F");
  });
});
