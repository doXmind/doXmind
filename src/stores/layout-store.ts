import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MobileNavMode, AIPanelState } from "@/lib/constants";

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

  // Mobile V2 state
  mobileNavMode: MobileNavMode;
  aiPanelState: AIPanelState;
  isFloatingToolbarVisible: boolean;
  isBlockSelectorOpen: boolean;

  // Keyboard shortcuts modal
  isKeyboardShortcutsOpen: boolean;

  // Command palette
  isCommandPaletteOpen: boolean;

  // Search bar (Cmd+F)
  isSearchBarOpen: boolean;
  shouldOpenSearchWithAI: boolean; // Flag to open search in AI mode

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
  openCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Search bar actions
  setSearchBarOpen: (open: boolean) => void;
  toggleSearchBar: () => void;
  openSearchBarWithAI: () => void; // Opens search bar in AI mode

  // Mobile V2 actions
  setMobileNavMode: (mode: MobileNavMode) => void;
  setAIPanelState: (state: AIPanelState) => void;
  setFloatingToolbarVisible: (visible: boolean) => void;
  setBlockSelectorOpen: (open: boolean) => void;
  openAIPanel: () => void;
  closeAIPanel: () => void;
  expandAIPanel: () => void;
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

      // Mobile V2 state
      mobileNavMode: "idle" as MobileNavMode,
      aiPanelState: "closed" as AIPanelState,
      isFloatingToolbarVisible: false,
      isBlockSelectorOpen: false,

      // Keyboard shortcuts modal
      isKeyboardShortcutsOpen: false,

      // Command palette
      isCommandPaletteOpen: false,

      // Search bar
      isSearchBarOpen: false,
      shouldOpenSearchWithAI: false,

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

      openCommandPalette: () => {
        set({ isCommandPaletteOpen: true });
      },

      toggleCommandPalette: () => {
        set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen }));
      },

      // Search bar actions
      setSearchBarOpen: (open: boolean) => {
        set({ isSearchBarOpen: open, shouldOpenSearchWithAI: false });
      },

      toggleSearchBar: () => {
        set((state) => ({
          isSearchBarOpen: !state.isSearchBarOpen,
          shouldOpenSearchWithAI: false,
        }));
      },

      openSearchBarWithAI: () => {
        set({ isSearchBarOpen: true, shouldOpenSearchWithAI: true });
      },

      // Mobile V2 actions
      setMobileNavMode: (mode: MobileNavMode) => {
        set({ mobileNavMode: mode });
      },

      setAIPanelState: (state: AIPanelState) => {
        set({ aiPanelState: state });
      },

      setFloatingToolbarVisible: (visible: boolean) => {
        set({ isFloatingToolbarVisible: visible });
      },

      setBlockSelectorOpen: (open: boolean) => {
        set({ isBlockSelectorOpen: open });
      },

      openAIPanel: () => {
        set({ aiPanelState: "peek" as AIPanelState, isMobileChatOpen: true });
      },

      closeAIPanel: () => {
        set({ aiPanelState: "closed" as AIPanelState, isMobileChatOpen: false });
      },

      expandAIPanel: () => {
        set((state) => {
          const currentState = state.aiPanelState;
          if (currentState === "peek") return { aiPanelState: "chat" as AIPanelState };
          if (currentState === "chat") return { aiPanelState: "full" as AIPanelState };
          return state;
        });
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
