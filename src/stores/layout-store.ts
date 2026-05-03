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
  isVersionHistoryOpen: boolean;

  // Focus mode
  isFocusMode: boolean;

  // Presentation mode
  isPresentationMode: boolean;
  presentationTextAlign: "left" | "center" | "right";

  // Search bar (Cmd+F)
  isSearchBarOpen: boolean;

  // Quick file switcher
  isQuickSwitcherOpen: boolean;

  // Typography preferences
  fontFamily: FontFamilyId;
  fontSize: "small" | "normal" | "large";
  lineHeight: "compact" | "normal" | "relaxed";

  // Resizable panel widths (pixels)
  filesSidebarWidth: number; // Files sidebar width

  // Actions
  toggleFilesSidebar: () => void;
  setFilesSidebarOpen: (open: boolean) => void;
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

  // Presentation mode actions
  setPresentationMode: (enabled: boolean) => void;
  setPresentationTextAlign: (align: "left" | "center" | "right") => void;

  // Version history actions
  setVersionHistoryOpen: (open: boolean) => void;
  toggleVersionHistory: () => void;

  // Search bar actions
  setSearchBarOpen: (open: boolean) => void;
  toggleSearchBar: () => void;

  // Quick switcher actions
  setQuickSwitcherOpen: (open: boolean) => void;
  toggleQuickSwitcher: () => void;

  // Typography actions
  setFontFamily: (font: FontFamilyId) => void;
  setFontSize: (size: "small" | "normal" | "large") => void;
  setLineHeight: (height: "compact" | "normal" | "relaxed") => void;

  // Resizable panel actions
  setFilesSidebarWidth: (width: number) => void;
  resetPanelWidths: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // Desktop panel visibility
      isFilesSidebarOpen: true,
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

      // Presentation mode
      isPresentationMode: false,
      presentationTextAlign: "center" as const,

      // Version history panel
      isVersionHistoryOpen: false,

      // Search bar
      isSearchBarOpen: false,

      // Quick file switcher
      isQuickSwitcherOpen: false,

      // Typography preferences
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: "normal" as const,
      lineHeight: "normal" as const,

      // Resizable panel widths
      filesSidebarWidth: 304,

      // Desktop actions
      toggleFilesSidebar: () => {
        set((state) => ({ isFilesSidebarOpen: !state.isFilesSidebarOpen }));
      },

      setFilesSidebarOpen: (open: boolean) => {
        set({ isFilesSidebarOpen: open });
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

      // Presentation mode actions
      setPresentationMode: (enabled: boolean) => {
        set({ isPresentationMode: enabled });
      },
      setPresentationTextAlign: (align: "left" | "center" | "right") => {
        set({ presentationTextAlign: align });
      },

      // Version history actions
      setVersionHistoryOpen: (open: boolean) => {
        set({ isVersionHistoryOpen: open });
      },

      toggleVersionHistory: () => {
        set((state) => ({ isVersionHistoryOpen: !state.isVersionHistoryOpen }));
      },

      // Search bar actions
      setSearchBarOpen: (open: boolean) => {
        set({ isSearchBarOpen: open });
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
        filesSidebarWidth: state.filesSidebarWidth,
      }),
    }
  )
);
