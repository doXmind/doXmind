import { create } from "zustand";
import { persist } from "zustand/middleware";

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

  // Mobile selection state
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

  // Home page
  homeViewMode: "grid" | "list";

  // Version history panel
  isVersionHistoryOpen: boolean;

  // Focus mode
  isFocusMode: boolean;

  // Search bar (Cmd+F)
  isSearchBarOpen: boolean;
  shouldOpenSearchWithAI: boolean; // Flag to open search in AI mode

  // Quick file switcher
  isQuickSwitcherOpen: boolean;

  // Editor content width preference
  editorWidth: "narrow" | "normal" | "wide" | "full";

  // Typography preferences
  fontFamily: "sans" | "serif" | "mono";
  fontSize: "small" | "normal" | "large";
  lineHeight: "compact" | "normal" | "relaxed";

  // Resizable panel widths (pixels)
  sidebarWidth: number;
  chatPanelWidth: number;

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

  // Home page actions
  setHomeViewMode: (mode: "grid" | "list") => void;

  // Focus mode actions
  setFocusMode: (enabled: boolean) => void;
  toggleFocusMode: () => void;

  // Version history actions
  setVersionHistoryOpen: (open: boolean) => void;
  toggleVersionHistory: () => void;

  // Search bar actions
  setSearchBarOpen: (open: boolean) => void;
  toggleSearchBar: () => void;
  openSearchBarWithAI: () => void; // Opens search bar in AI mode

  // Quick switcher actions
  setQuickSwitcherOpen: (open: boolean) => void;
  toggleQuickSwitcher: () => void;

  // Editor width actions
  setEditorWidth: (width: "narrow" | "normal" | "wide" | "full") => void;
  cycleEditorWidth: () => void;

  // Typography actions
  setFontFamily: (font: "sans" | "serif" | "mono") => void;
  setFontSize: (size: "small" | "normal" | "large") => void;
  setLineHeight: (height: "compact" | "normal" | "relaxed") => void;

  // Resizable panel actions
  setSidebarWidth: (width: number) => void;
  setChatPanelWidth: (width: number) => void;
  resetPanelWidths: () => void;

  // Mobile selection actions
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

      // Mobile selection state
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

      // Home page
      homeViewMode: "grid" as const,

      // Focus mode
      isFocusMode: false,

      // Version history panel
      isVersionHistoryOpen: false,

      // Search bar
      isSearchBarOpen: false,
      shouldOpenSearchWithAI: false,

      // Quick file switcher
      isQuickSwitcherOpen: false,

      // Editor content width
      editorWidth: "normal" as const,

      // Typography preferences
      fontFamily: "sans" as const,
      fontSize: "normal" as const,
      lineHeight: "normal" as const,

      // Resizable panel widths
      sidebarWidth: 256,
      chatPanelWidth: 384,

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

      // Home page actions
      setHomeViewMode: (mode: "grid" | "list") => {
        set({ homeViewMode: mode });
      },

      // Focus mode actions
      setFocusMode: (enabled: boolean) => {
        set({ isFocusMode: enabled });
      },

      toggleFocusMode: () => {
        set((state) => ({ isFocusMode: !state.isFocusMode }));
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
      setFontFamily: (font: "sans" | "serif" | "mono") => {
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

      setChatPanelWidth: (width: number) => {
        set({ chatPanelWidth: Math.max(300, Math.min(600, width)) });
      },

      resetPanelWidths: () => {
        set({ sidebarWidth: 256, chatPanelWidth: 384 });
      },

      // Mobile selection actions
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
        homeViewMode: state.homeViewMode,
        editorWidth: state.editorWidth,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
        sidebarWidth: state.sidebarWidth,
        chatPanelWidth: state.chatPanelWidth,
      }),
    }
  )
);
