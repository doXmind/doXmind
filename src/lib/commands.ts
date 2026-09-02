/**
 * Every action the app can be asked to perform, in one place.
 *
 * The three surfaces that used to each carry their own list — the command palette's hardcoded
 * array, the keyboard hook's chain of `if` statements, and the native menu — disagreed about what
 * existed: about forty actions were reachable somehow, five of them from the palette, and none of
 * their keys could be changed. A registry means adding a command once makes it searchable,
 * bindable and rebindable at the same time.
 *
 * `run` reads its store at call time rather than closing over one, so a command is a plain value
 * that can live in a module and be listed without mounting anything.
 */

import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { createPageForContext } from "@/lib/new-page";
import { openTodayDailyNote } from "@/lib/daily-notes";

export type CommandCategory = "file" | "view" | "navigation" | "editor";

export interface WorkspaceCommand {
  id: string;
  /** Key under the `commands` message namespace. */
  labelKey: string;
  category: CommandCategory;
  /**
   * Default chord, in the normalized form `Mod+Shift+Alt+Key`. `Mod` is ⌘ on macOS and Ctrl
   * elsewhere, so one string describes both platforms.
   */
  defaultBinding: string | null;
  /** Extra words this command should be findable by, beyond its label. */
  keywords?: string[];
  run: () => void | Promise<void>;
}

export const WORKSPACE_COMMANDS: readonly WorkspaceCommand[] = [
  {
    id: "new-page",
    labelKey: "newPage",
    category: "file",
    defaultBinding: "Mod+N",
    keywords: ["create", "new", "document"],
    run: async () => {
      const id = await createPageForContext(useFileStore.getState());
      await navigateToEditorFile(id);
    },
  },
  {
    id: "daily-note",
    labelKey: "dailyNote",
    category: "file",
    defaultBinding: null,
    keywords: ["today", "journal", "daily"],
    run: async () => {
      await openTodayDailyNote();
    },
  },
  {
    id: "command-palette",
    labelKey: "commandPalette",
    category: "navigation",
    defaultBinding: "Mod+P",
    run: () => useLayoutStore.getState().toggleCommandPalette(),
  },
  {
    id: "quick-switcher",
    labelKey: "quickSwitcher",
    category: "navigation",
    defaultBinding: "Mod+O",
    keywords: ["open", "switch", "file"],
    run: () => useLayoutStore.getState().setQuickSwitcherOpen(true),
  },
  {
    id: "search-workspace",
    labelKey: "searchWorkspace",
    category: "navigation",
    defaultBinding: "Mod+Shift+F",
    keywords: ["find", "grep", "workspace"],
    run: () => useLayoutStore.getState().openSidebarSearch(""),
  },
  {
    id: "find-in-page",
    labelKey: "findInPage",
    category: "editor",
    defaultBinding: "Mod+F",
    run: () => useLayoutStore.getState().toggleSearchBar(),
  },
  {
    id: "find-and-replace",
    labelKey: "findAndReplace",
    category: "editor",
    defaultBinding: "Mod+Alt+F",
    run: () => useLayoutStore.getState().openReplaceBar(),
  },
  {
    id: "fold-all",
    labelKey: "foldAll",
    category: "editor",
    defaultBinding: null,
    keywords: ["collapse", "sections", "outline"],
    run: () => useEditorRefStore.getState().requestFoldAll?.(true),
  },
  {
    id: "unfold-all",
    labelKey: "unfoldAll",
    category: "editor",
    defaultBinding: null,
    keywords: ["expand", "sections", "outline"],
    run: () => useEditorRefStore.getState().requestFoldAll?.(false),
  },
  {
    id: "split-right",
    labelKey: "splitRight",
    category: "editor",
    // Obsidian's ⌘\ is not expressible in `bindingForEvent`'s grammar, and nothing asked for a
    // chord: the palette and the options menu are both one gesture away.
    defaultBinding: null,
    keywords: ["split", "pane", "side by side"],
    run: () => useFileStore.getState().splitRight(),
  },
  {
    id: "focus-other-pane",
    labelKey: "focusOtherPane",
    category: "editor",
    // The only keyboard route into the second pane: the pane switch is otherwise a
    // pointerdown, so without this a keyboard user can split and never leave the first Page.
    defaultBinding: null,
    keywords: ["split", "pane", "focus", "switch"],
    run: () => useFileStore.getState().focusOtherPane(),
  },
  {
    id: "close-other-pane",
    labelKey: "closeOtherPane",
    category: "editor",
    defaultBinding: null,
    keywords: ["split", "pane", "unsplit"],
    run: () => useFileStore.getState().closeOtherPane(),
  },
  {
    id: "toggle-sidebar",
    labelKey: "toggleSidebar",
    category: "view",
    defaultBinding: "Mod+B",
    run: () => useLayoutStore.getState().toggleFilesSidebar(),
  },
  {
    id: "toggle-focus-mode",
    labelKey: "toggleFocusMode",
    category: "view",
    defaultBinding: "F11",
    keywords: ["zen", "distraction"],
    run: () => useLayoutStore.getState().toggleFocusMode(),
  },
  {
    id: "toggle-high-contrast",
    labelKey: "toggleHighContrast",
    category: "view",
    defaultBinding: null,
    keywords: ["contrast", "accessibility", "a11y"],
    run: () => useLayoutStore.getState().toggleHighContrast(),
  },
  {
    id: "keyboard-shortcuts",
    labelKey: "keyboardShortcuts",
    category: "view",
    defaultBinding: "Mod+Shift+?",
    run: () => useLayoutStore.getState().toggleKeyboardShortcuts(),
  },
];

/**
 * The chord a keyboard event represents, in the registry's normalized form, or null.
 *
 * `event.code` for letters, not `event.key`: on macOS ⌥F emits "ƒ", so a binding read from `key`
 * would never match once Alt is held.
 */
export function bindingForEvent(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  let key: string;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F[0-9]{1,2}$/.test(event.key)) key = event.key;
  else if (event.key === "?") key = "?";
  else if (event.key.length === 1) key = event.key.toUpperCase();
  else return null;

  parts.push(key);
  // A bare letter is typing, not a command.
  if (parts.length === 1 && !/^F[0-9]{1,2}$/.test(key)) return null;
  return parts.join("+");
}

/** The chord, written the way this platform writes it. */
export function formatBinding(binding: string, isMac: boolean): string {
  return binding
    .replace("Mod", isMac ? "⌘" : "Ctrl")
    .replace("Shift", isMac ? "⇧" : "Shift")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .split("+")
    .join(isMac ? "" : "+");
}
