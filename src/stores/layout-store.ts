import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MobileNavMode, AIPanelState } from "@/lib/constants";

interface LayoutState {
  // Desktop panel visibility
  isSidebarOpen: boolean;
  isChatOpen: boolean;
  isMindlinesOpen: boolean;
  isMindlinesCollapsed: boolean; // Collapsed = minimal line indicators, Expanded = full outline
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
  pendingSelectionForAI: string | null; // Selected text to pass to AI panel

  // Mobile V3 state (new design)
  isMobileChatOverlayOpen: boolean;
  isMobileAnswerBubbleVisible: boolean;
  mobileAnswerBubbleContent: string;
  mobileEditCount: number; // Number of edits applied in last operation
  showMobileEditSuccess: boolean;
  isMobileEditMode: boolean; // When true, editor uses desktop-style cursor editing instead of block selection

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
  toggleMindlinesCollapsed: () => void;
  setSidebarOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setMindlinesOpen: (open: boolean) => void;
  setMindlinesCollapsed: (collapsed: boolean) => void;
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
  openAIPanelWithSelection: (text: string) => void;
  closeAIPanel: () => void;
  expandAIPanel: () => void;
  clearPendingSelectionForAI: () => void;

  // Mobile V3 actions (new design)
  setMobileChatOverlayOpen: (open: boolean) => void;
  showMobileAnswerBubble: (content: string) => void;
  hideMobileAnswerBubble: () => void;
  showMobileEditSuccessIndicator: (editCount: number) => void;
  hideMobileEditSuccessIndicator: () => void;
  toggleMobileEditMode: () => void;
  setMobileEditMode: (enabled: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // Desktop panel visibility
      isSidebarOpen: true,
      isChatOpen: true,
      isMindlinesOpen: true,
      isMindlinesCollapsed: false, // false = expanded (full outline), true = collapsed (line indicators)
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
      pendingSelectionForAI: null,

      // Mobile V3 state (new design)
      isMobileChatOverlayOpen: false,
      isMobileAnswerBubbleVisible: false,
      mobileAnswerBubbleContent: "",
      mobileEditCount: 0,
      showMobileEditSuccess: false,
      isMobileEditMode: false,

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

      toggleMindlinesCollapsed: () => {
        set((state) => ({ isMindlinesCollapsed: !state.isMindlinesCollapsed }));
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

      setMindlinesCollapsed: (collapsed: boolean) => {
        set({ isMindlinesCollapsed: collapsed });
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

      openAIPanelWithSelection: (text: string) => {
        set({
          aiPanelState: "peek" as AIPanelState,
          isMobileChatOpen: true,
          pendingSelectionForAI: text,
        });
      },

      closeAIPanel: () => {
        set({
          aiPanelState: "closed" as AIPanelState,
          isMobileChatOpen: false,
          pendingSelectionForAI: null,
        });
      },

      expandAIPanel: () => {
        set((state) => {
          const currentState = state.aiPanelState;
          if (currentState === "peek") return { aiPanelState: "chat" as AIPanelState };
          if (currentState === "chat") return { aiPanelState: "full" as AIPanelState };
          return state;
        });
      },

      clearPendingSelectionForAI: () => {
        set({ pendingSelectionForAI: null });
      },

      // Mobile V3 actions (new design)
      setMobileChatOverlayOpen: (open: boolean) => {
        set({ isMobileChatOverlayOpen: open });
      },

      showMobileAnswerBubble: (content: string) => {
        set({
          isMobileAnswerBubbleVisible: true,
          mobileAnswerBubbleContent: content,
        });
      },

      hideMobileAnswerBubble: () => {
        set({
          isMobileAnswerBubbleVisible: false,
          mobileAnswerBubbleContent: "",
        });
      },

      showMobileEditSuccessIndicator: (editCount: number) => {
        set({
          showMobileEditSuccess: true,
          mobileEditCount: editCount,
        });
      },

      hideMobileEditSuccessIndicator: () => {
        set({
          showMobileEditSuccess: false,
          mobileEditCount: 0,
        });
      },

      toggleMobileEditMode: () => {
        set((state) => ({ isMobileEditMode: !state.isMobileEditMode }));
      },

      setMobileEditMode: (enabled: boolean) => {
        set({ isMobileEditMode: enabled });
      },
    }),
    {
      name: "doxmind-layout",
      partialize: (state) => ({
        // Only persist these fields (not modals state)
        isSidebarOpen: state.isSidebarOpen,
        isChatOpen: state.isChatOpen,
        isMindlinesOpen: state.isMindlinesOpen,
        isMindlinesCollapsed: state.isMindlinesCollapsed,
        theme: state.theme,
        isHighContrast: state.isHighContrast,
      }),
    }
  )
);
