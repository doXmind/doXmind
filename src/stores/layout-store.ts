import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FontFamilyId } from "@/lib/font-options";
import { DEFAULT_FONT_FAMILY } from "@/lib/font-options";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  REMOVED_THEME_IDS,
  resolveThemeId,
} from "@/lib/themes/registry";

interface LayoutState {
  // Desktop panel visibility
  isFilesSidebarOpen: boolean; // Files sidebar (left edge, independent)
  /** Which view the left sidebar shows. Not persisted: a session starts on the file tree. */
  sidebarView: "files" | "search";
  /**
   * A search the sidebar should run, raised from outside it. The token distinguishes two requests
   * for the same query, so the second one still re-runs rather than looking inert.
   */
  sidebarSearchRequest: { query: string; token: number } | null;
  /** UI language. Both catalogs ship in the bundle, so switching needs no reload. */
  locale: "en" | "zh";
  themeId: string;
  preferredLightTheme: string;
  preferredDarkTheme: string;
  systemThemeEnabled: boolean;
  isHighContrast: boolean;

  // Keyboard shortcuts modal
  isKeyboardShortcutsOpen: boolean;

  // Command palette
  isCommandPaletteOpen: boolean;

  // Version history panel

  // Focus mode
  isFocusMode: boolean;

  // Search bar (Cmd+F)
  isSearchBarOpen: boolean;
  /** Whether the find bar also shows its replace row. Opening replace opens find. */
  isReplaceOpen: boolean;

  // Quick file switcher
  isQuickSwitcherOpen: boolean;

  // Typography preferences
  fontFamily: FontFamilyId;
  fontSize: "small" | "normal" | "large";
  lineHeight: "compact" | "normal" | "relaxed";
  // When off, edits are kept in the editor but not written to disk until the
  // user explicitly saves (⌘S). On by default.
  autosaveEnabled: boolean;

  // Resizable panel widths (pixels)
  filesSidebarWidth: number; // Files sidebar width

  // Actions
  toggleFilesSidebar: () => void;
  setFilesSidebarOpen: (open: boolean) => void;
  setSidebarView: (view: "files" | "search") => void;
  openSidebarSearch: (query: string) => void;
  setLocale: (locale: "en" | "zh") => void;
  setThemeId: (id: string) => void;
  setPreferredLightTheme: (id: string) => void;
  setPreferredDarkTheme: (id: string) => void;
  setSystemThemeEnabled: (enabled: boolean) => void;
  setHighContrast: (enabled: boolean) => void;
  toggleHighContrast: () => void;

  // Keyboard shortcuts modal actions
  setKeyboardShortcutsOpen: (open: boolean) => void;
  toggleKeyboardShortcuts: () => void;

  // Command palette actions
  setCommandPaletteOpen: (open: boolean) => void;
  openCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Focus mode actions
  setFocusMode: (enabled: boolean) => void;
  toggleFocusMode: () => void;

  // Version history actions

  // Search bar actions
  setSearchBarOpen: (open: boolean) => void;
  openReplaceBar: () => void;
  toggleSearchBar: () => void;

  // Quick switcher actions
  setQuickSwitcherOpen: (open: boolean) => void;
  toggleQuickSwitcher: () => void;

  // Typography actions
  setFontFamily: (font: FontFamilyId) => void;
  setFontSize: (size: "small" | "normal" | "large") => void;
  setLineHeight: (height: "compact" | "normal" | "relaxed") => void;
  setAutosaveEnabled: (enabled: boolean) => void;
  toggleAutosave: () => void;

  // Resizable panel actions
  setFilesSidebarWidth: (width: number) => void;
  resetPanelWidths: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // Desktop panel visibility
      isFilesSidebarOpen: true,
      sidebarView: "files",
      sidebarSearchRequest: null,
      locale: "en",
      themeId: DEFAULT_LIGHT_THEME,
      preferredLightTheme: DEFAULT_LIGHT_THEME,
      preferredDarkTheme: DEFAULT_DARK_THEME,
      systemThemeEnabled: true,
      isHighContrast: false,

      // Keyboard shortcuts modal
      isKeyboardShortcutsOpen: false,

      // Command palette
      isCommandPaletteOpen: false,

      // Focus mode
      isFocusMode: false,

      // Version history panel

      // Search bar
      isSearchBarOpen: false,
      isReplaceOpen: false,

      // Quick file switcher
      isQuickSwitcherOpen: false,

      // Typography preferences
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: "normal" as const,
      lineHeight: "normal" as const,
      autosaveEnabled: true,

      // Resizable panel widths
      filesSidebarWidth: 304,

      // Desktop actions
      toggleFilesSidebar: () => {
        set((state) => ({ isFilesSidebarOpen: !state.isFilesSidebarOpen }));
      },

      setFilesSidebarOpen: (open: boolean) => {
        set({ isFilesSidebarOpen: open });
      },

      setSidebarView: (view) => {
        set({ sidebarView: view });
      },

      openSidebarSearch: (query) => {
        set((state) => ({
          isFilesSidebarOpen: true,
          sidebarView: "search",
          sidebarSearchRequest: {
            query,
            token: (state.sidebarSearchRequest?.token ?? 0) + 1,
          },
        }));
      },

      setLocale: (locale) => {
        set({ locale });
        // The provider reads this cookie on a cold start, before the persisted store has
        // hydrated, so the two have to agree or the first paint would flip languages.
        if (typeof document !== "undefined") {
          document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`;
        }
      },

      setThemeId: (id: string) => {
        set({ themeId: id });
      },

      setPreferredLightTheme: (id: string) => {
        set({ preferredLightTheme: id });
      },

      setPreferredDarkTheme: (id: string) => {
        set({ preferredDarkTheme: id });
      },

      setSystemThemeEnabled: (enabled: boolean) => {
        set({ systemThemeEnabled: enabled });
      },

      setHighContrast: (enabled: boolean) => {
        set({ isHighContrast: enabled });
        // Apply/remove class on document
        if (typeof document !== "undefined") {
          if (enabled) {
            document.documentElement.classList.add("high-contrast");
          } else {
            document.documentElement.classList.remove("high-contrast");
          }
        }
      },

      toggleHighContrast: () => {
        set((state) => {
          const newValue = !state.isHighContrast;
          if (typeof document !== "undefined") {
            if (newValue) {
              document.documentElement.classList.add("high-contrast");
            } else {
              document.documentElement.classList.remove("high-contrast");
            }
          }
          return { isHighContrast: newValue };
        });
      },

      // Keyboard shortcuts modal actions
      setKeyboardShortcutsOpen: (open: boolean) => {
        set({ isKeyboardShortcutsOpen: open });
      },

      toggleKeyboardShortcuts: () => {
        set((state) => ({ isKeyboardShortcutsOpen: !state.isKeyboardShortcutsOpen }));
      },

      // Command palette actions
      setCommandPaletteOpen: (open: boolean) => {
        set({ isCommandPaletteOpen: open });
      },

      openCommandPalette: () => {
        set({ isCommandPaletteOpen: true });
      },

      toggleCommandPalette: () => {
        set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen }));
      },

      // Focus mode actions
      setFocusMode: (enabled: boolean) => {
        set({ isFocusMode: enabled });
      },

      toggleFocusMode: () => {
        set((state) => ({ isFocusMode: !state.isFocusMode }));
      },

      // Version history actions

      // Search bar actions
      openReplaceBar: () => {
        set({ isSearchBarOpen: true, isReplaceOpen: true });
      },

      setSearchBarOpen: (open: boolean) => {
        // Closing find closes replace with it: a replace row over a closed find bar has no
        // matches to act on.
        set(open ? { isSearchBarOpen: true } : { isSearchBarOpen: false, isReplaceOpen: false });
      },

      toggleSearchBar: () => {
        set((state) => ({ isSearchBarOpen: !state.isSearchBarOpen }));
      },

      // Quick switcher actions
      setQuickSwitcherOpen: (open: boolean) => {
        set({ isQuickSwitcherOpen: open });
      },

      toggleQuickSwitcher: () => {
        set((state) => ({ isQuickSwitcherOpen: !state.isQuickSwitcherOpen }));
      },

      // Typography actions
      setFontFamily: (font: FontFamilyId) => {
        set({ fontFamily: font });
      },

      setFontSize: (size: "small" | "normal" | "large") => {
        set({ fontSize: size });
      },

      setLineHeight: (height: "compact" | "normal" | "relaxed") => {
        set({ lineHeight: height });
      },

      setAutosaveEnabled: (enabled: boolean) => {
        set({ autosaveEnabled: enabled });
      },
      toggleAutosave: () => {
        set((state) => ({ autosaveEnabled: !state.autosaveEnabled }));
      },

      // Resizable panel actions
      setFilesSidebarWidth: (width: number) => {
        set({ filesSidebarWidth: Math.max(200, Math.min(400, width)) });
      },

      resetPanelWidths: () => {
        set({ filesSidebarWidth: 304 });
      },
    }),
    {
      name: "doxmind-layout",
      version: 8,
      migrate: (persistedState: unknown, version: number) => {
        let state = persistedState as Record<string, unknown>;
        if (version < 2) {
          // Migrate from old theme field to new themeId system
          const oldTheme = state.theme as string | undefined;
          const themeId = oldTheme === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
          const systemThemeEnabled = oldTheme === "system";
          state = {
            ...state,
            themeId,
            preferredLightTheme: DEFAULT_LIGHT_THEME,
            preferredDarkTheme: DEFAULT_DARK_THEME,
            systemThemeEnabled,
            theme: undefined,
          };
        }
        if (version < 3) {
          state = {
            ...state,
            filesSidebarWidth: 304,
          };
        }
        if (version < 4) {
          state = {
            ...state,
            filesSidebarWidth: 304,
          };
        }
        if (version < 5) {
          const {
            isMindlinesOpen: _isMindlinesOpen,
            isMindlinesCollapsed: _isMindlinesCollapsed,
            ...rest
          } = state;
          state = rest;
        }
        if (version < 6) {
          const { isSidebarOpen: _isSidebarOpen, sidebarWidth: _sidebarWidth, ...rest } = state;
          state = rest;
        }
        if (version < 7) {
          const { editorWidth: _editorWidth, ...rest } = state;
          state = rest;
        }
        if (version < 8) {
          // Theme registry was curated down to 5 themes. Map removed IDs to
          // the closest surviving equivalent so persisted prefs don't fall
          // back to a default that flips the user's base mode.
          const remap = (id: unknown): string => {
            const s = typeof id === "string" ? id : "";
            if (REMOVED_THEME_IDS[s]) return REMOVED_THEME_IDS[s];
            return resolveThemeId(s);
          };
          state = {
            ...state,
            themeId: remap(state.themeId),
            preferredLightTheme: remap(state.preferredLightTheme),
            preferredDarkTheme: remap(state.preferredDarkTheme),
          };
        }
        return state;
      },
      partialize: (state) => ({
        // Only persist these fields (not modals state)
        isFilesSidebarOpen: state.isFilesSidebarOpen,
        themeId: state.themeId,
        preferredLightTheme: state.preferredLightTheme,
        preferredDarkTheme: state.preferredDarkTheme,
        systemThemeEnabled: state.systemThemeEnabled,
        isHighContrast: state.isHighContrast,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
        autosaveEnabled: state.autosaveEnabled,
        filesSidebarWidth: state.filesSidebarWidth,
        locale: state.locale,
      }),
    }
  )
);
