import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FontFamilyId } from "@/lib/font-options";
import { DEFAULT_FONT_FAMILY } from "@/lib/font-options";

interface LayoutState {
  // Desktop panel visibility
  isSidebarOpen: boolean; // Outline sidebar (right edge)
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

  // Editor content width preference
  editorWidth: "narrow" | "normal" | "wide" | "full";

  // Typography preferences
  fontFamily: FontFamilyId;
  fontSize: "small" | "normal" | "large";
  lineHeight: "compact" | "normal" | "relaxed";

  // Resizable panel widths (pixels)
  sidebarWidth: number; // Outline sidebar width
  filesSidebarWidth: number; // Files sidebar width

  // Actions
  toggleSidebar: () => void;
  toggleFilesSidebar: () => void;
  setFilesSidebarOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
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

  // Editor width actions
  setEditorWidth: (width: "narrow" | "normal" | "wide" | "full") => void;
  cycleEditorWidth: () => void;

  // Typography actions
  setFontFamily: (font: FontFamilyId) => void;
  setFontSize: (size: "small" | "normal" | "large") => void;
  setLineHeight: (height: "compact" | "normal" | "relaxed") => void;

  // Resizable panel actions
  setSidebarWidth: (width: number) => void;
  setFilesSidebarWidth: (width: number) => void;
  resetPanelWidths: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // Desktop panel visibility
      isSidebarOpen: false,
      isFilesSidebarOpen: true,
      themeId: "notion",
      preferredLightTheme: "notion",
      preferredDarkTheme: "dark",
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

      // Editor content width
      editorWidth: "normal" as const,

      // Typography preferences
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: "normal" as const,
      lineHeight: "normal" as const,

      // Resizable panel widths
      sidebarWidth: 224,
      filesSidebarWidth: 304,

      // Desktop actions
      toggleSidebar: () => {
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
      },

      toggleFilesSidebar: () => {
        set((state) => ({ isFilesSidebarOpen: !state.isFilesSidebarOpen }));
      },

      setFilesSidebarOpen: (open: boolean) => {
        set({ isFilesSidebarOpen: open });
      },

      setSidebarOpen: (open: boolean) => {
        set({ isSidebarOpen: open });
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

      // Editor width actions
      setEditorWidth: (width: "narrow" | "normal" | "wide" | "full") => {
        set({ editorWidth: width });
      },

      cycleEditorWidth: () => {
        set((state) => {
          const widths: Array<"narrow" | "normal" | "wide" | "full"> = [
            "narrow",
            "normal",
            "wide",
            "full",
          ];
          const currentIndex = widths.indexOf(state.editorWidth);
          const nextIndex = (currentIndex + 1) % widths.length;
          return { editorWidth: widths[nextIndex] };
        });
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
      setSidebarWidth: (width: number) => {
        set({ sidebarWidth: Math.max(200, Math.min(400, width)) });
      },

      setFilesSidebarWidth: (width: number) => {
        set({ filesSidebarWidth: Math.max(200, Math.min(400, width)) });
      },

      resetPanelWidths: () => {
        set({ sidebarWidth: 224, filesSidebarWidth: 304 });
      },
    }),
    {
      name: "doxmind-layout",
      version: 5,
      migrate: (persistedState: unknown, version: number) => {
        let state = persistedState as Record<string, unknown>;
        if (version < 2) {
          // Migrate from old theme field to new themeId system
          const oldTheme = state.theme as string | undefined;
          const themeId = oldTheme === "dark" ? "dark" : "notion";
          const systemThemeEnabled = oldTheme === "system";
          state = {
            ...state,
            themeId,
            preferredLightTheme: "notion",
            preferredDarkTheme: "dark",
            systemThemeEnabled,
            theme: undefined,
          };
        }
        if (version < 3) {
          state = {
            ...state,
            isSidebarOpen: false,
            sidebarWidth: 224,
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
          // Drop dead mindlines fields persisted by older versions —
          // the outline panel is now driven purely by `isSidebarOpen`.
          const {
            isMindlinesOpen: _isMindlinesOpen,
            isMindlinesCollapsed: _isMindlinesCollapsed,
            ...rest
          } = state;
          state = rest;
        }
        return state;
      },
      partialize: (state) => ({
        // Only persist these fields (not modals state)
        isSidebarOpen: state.isSidebarOpen,
        isFilesSidebarOpen: state.isFilesSidebarOpen,
        themeId: state.themeId,
        preferredLightTheme: state.preferredLightTheme,
        preferredDarkTheme: state.preferredDarkTheme,
        systemThemeEnabled: state.systemThemeEnabled,
        isHighContrast: state.isHighContrast,
        editorWidth: state.editorWidth,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
        sidebarWidth: state.sidebarWidth,
        filesSidebarWidth: state.filesSidebarWidth,
      }),
    }
  )
);
