import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutState {
  // Desktop panel visibility
  isSidebarOpen: boolean; // Outline sidebar
  isFilesSidebarOpen: boolean; // Files sidebar (independent)
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

  // Mobile formatting toolbar
  isMobileBlockInsertOpen: boolean;

  // Keyboard shortcuts modal
  isKeyboardShortcutsOpen: boolean;

  // Command palette
  isCommandPaletteOpen: boolean;

  // Home page
  homeViewMode: "grid" | "list";
  homeActiveTab: "documents" | "shares" | "forks" | "bookmarks";

  // Version history panel
  isVersionHistoryOpen: boolean;

  // Focus mode
  isFocusMode: boolean;

  // Presentation mode
  isPresentationMode: boolean;

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

  // Chat display mode
  chatMode: "sidebar" | "floating";

  // Resizable panel widths (pixels)
  sidebarWidth: number; // Outline sidebar width
  filesSidebarWidth: number; // Files sidebar width
  chatPanelWidth: number;

  // Actions
  toggleSidebar: () => void;
  toggleFilesSidebar: () => void;
  setFilesSidebarOpen: (open: boolean) => void;
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
  setHomeActiveTab: (tab: "documents" | "shares" | "forks" | "bookmarks") => void;

  // Focus mode actions
  setFocusMode: (enabled: boolean) => void;
  toggleFocusMode: () => void;

  // Presentation mode actions
  setPresentationMode: (enabled: boolean) => void;

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

  // Chat mode actions
  setChatMode: (mode: "sidebar" | "floating") => void;

  // Resizable panel actions
  setSidebarWidth: (width: number) => void;
  setFilesSidebarWidth: (width: number) => void;
  setChatPanelWidth: (width: number) => void;
  resetPanelWidths: () => void;

  // Mobile selection actions
  setPendingSelectionForAI: (text: string) => void;
  clearPendingSelectionForAI: () => void;

  // Mobile V3 actions (new design)
  setMobileChatOverlayOpen: (open: boolean) => void;
  showMobileAnswerBubble: (content: string) => void;
  hideMobileAnswerBubble: () => void;
  showMobileEditSuccessIndicator: (editCount: number) => void;
  hideMobileEditSuccessIndicator: () => void;
  toggleMobileEditMode: () => void;
  setMobileEditMode: (enabled: boolean) => void;

  // Mobile formatting toolbar actions
  setMobileBlockInsertOpen: (open: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // Desktop panel visibility
      isSidebarOpen: true,
      isFilesSidebarOpen: false,
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
      isMobileEditMode: true,

      // Mobile formatting toolbar
      isMobileBlockInsertOpen: false,

      // Keyboard shortcuts modal
      isKeyboardShortcutsOpen: false,

      // Command palette
      isCommandPaletteOpen: false,

      // Home page
      homeViewMode: "grid" as const,
      homeActiveTab: "documents" as const,

      // Focus mode
      isFocusMode: false,

      // Presentation mode
      isPresentationMode: false,

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

      // Chat display mode
      chatMode: "sidebar" as const,

      // Resizable panel widths
      sidebarWidth: 256,
      filesSidebarWidth: 256,
      chatPanelWidth: 384,

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

      setHomeActiveTab: (tab: "documents" | "shares" | "forks" | "bookmarks") => {
        set({ homeActiveTab: tab });
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

      // Chat mode actions
      setChatMode: (mode: "sidebar" | "floating") => {
        set({ chatMode: mode });
      },

      // Resizable panel actions
      setSidebarWidth: (width: number) => {
        set({ sidebarWidth: Math.max(200, Math.min(400, width)) });
      },

      setFilesSidebarWidth: (width: number) => {
        set({ filesSidebarWidth: Math.max(200, Math.min(400, width)) });
      },

      setChatPanelWidth: (width: number) => {
        set({ chatPanelWidth: Math.max(300, Math.min(600, width)) });
      },

      resetPanelWidths: () => {
        set({ sidebarWidth: 256, filesSidebarWidth: 256, chatPanelWidth: 384 });
      },

      // Mobile selection actions
      setPendingSelectionForAI: (text: string) => {
        set({ pendingSelectionForAI: text });
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

      // Mobile formatting toolbar actions
      setMobileBlockInsertOpen: (open: boolean) => {
        set({ isMobileBlockInsertOpen: open });
      },
    }),
    {
      name: "doxmind-layout",
      partialize: (state) => ({
        // Only persist these fields (not modals state)
        isSidebarOpen: state.isSidebarOpen,
        isFilesSidebarOpen: state.isFilesSidebarOpen,
        isChatOpen: state.isChatOpen,
        isMindlinesOpen: state.isMindlinesOpen,
        isMindlinesCollapsed: state.isMindlinesCollapsed,
        theme: state.theme,
        isHighContrast: state.isHighContrast,
        homeViewMode: state.homeViewMode,
        homeActiveTab: state.homeActiveTab,
        editorWidth: state.editorWidth,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
        chatMode: state.chatMode,
        sidebarWidth: state.sidebarWidth,
        filesSidebarWidth: state.filesSidebarWidth,
        chatPanelWidth: state.chatPanelWidth,
      }),
    }
  )
);
