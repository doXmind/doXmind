import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutState {
  // Desktop panel visibility
  isSidebarOpen: boolean;
  isChatOpen: boolean;
  isMindlinesOpen: boolean;
  theme: "light" | "dark" | "system";
  isHighContrast: boolean;

  // Mobile-specific state (sheet/overlay approach - editor always visible)
  isMobileSidebarOpen: boolean;
  isMobileChatOpen: boolean;
  isMobileOutlineOpen: boolean;

  // Keyboard shortcuts modal
  isKeyboardShortcutsOpen: boolean;

  // Command palette
  isCommandPaletteOpen: boolean;

  // Actions
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleMindlines: () => void;
  setSidebarOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setMindlinesOpen: (open: boolean) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setHighContrast: (enabled: boolean) => void;
  toggleHighContrast: () => void;

  // Mobile actions
  setMobileSidebarOpen: (open: boolean) => void;
  setMobileChatOpen: (open: boolean) => void;
  setMobileOutlineOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  toggleMobileChat: () => void;
  toggleMobileOutline: () => void;

  // Keyboard shortcuts modal actions
  setKeyboardShortcutsOpen: (open: boolean) => void;
  toggleKeyboardShortcuts: () => void;

  // Command palette actions
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // Desktop panel visibility
      isSidebarOpen: true,
      isChatOpen: true,
      isMindlinesOpen: true,
      theme: "system",
      isHighContrast: false,

      // Mobile-specific state (sheet/overlay approach)
      isMobileSidebarOpen: false,
      isMobileChatOpen: false,
      isMobileOutlineOpen: false,

      // Keyboard shortcuts modal
      isKeyboardShortcutsOpen: false,

      // Command palette
      isCommandPaletteOpen: false,

      // Desktop actions
      toggleSidebar: () => {
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
      },

      toggleChat: () => {
        set((state) => ({ isChatOpen: !state.isChatOpen }));
      },

      toggleMindlines: () => {
        set((state) => ({ isMindlinesOpen: !state.isMindlinesOpen }));
      },

      setSidebarOpen: (open: boolean) => {
        set({ isSidebarOpen: open });
      },

      setChatOpen: (open: boolean) => {
        set({ isChatOpen: open });
      },

      setMindlinesOpen: (open: boolean) => {
        set({ isMindlinesOpen: open });
      },

      setTheme: (theme) => {
        set({ theme });
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

      // Mobile actions
      setMobileSidebarOpen: (open: boolean) => {
        set({ isMobileSidebarOpen: open });
      },

      setMobileChatOpen: (open: boolean) => {
        set({ isMobileChatOpen: open });
      },

      setMobileOutlineOpen: (open: boolean) => {
        set({ isMobileOutlineOpen: open });
      },

      toggleMobileSidebar: () => {
        set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen }));
      },

      toggleMobileChat: () => {
        set((state) => ({ isMobileChatOpen: !state.isMobileChatOpen }));
      },

      toggleMobileOutline: () => {
        set((state) => ({ isMobileOutlineOpen: !state.isMobileOutlineOpen }));
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

      toggleCommandPalette: () => {
        set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen }));
      },
    }),
    {
      name: "doxmind-layout",
      partialize: (state) => ({
        // Only persist these fields (not modals state)
        isSidebarOpen: state.isSidebarOpen,
        isChatOpen: state.isChatOpen,
        isMindlinesOpen: state.isMindlinesOpen,
        theme: state.theme,
        isHighContrast: state.isHighContrast,
      }),
    }
  )
);
