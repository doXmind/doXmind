import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutState {
  isSidebarOpen: boolean;
  isChatOpen: boolean;
  theme: "light" | "dark" | "system";

  // Actions
  toggleSidebar: () => void;
  toggleChat: () => void;
  setSidebarOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      isSidebarOpen: true,
      isChatOpen: true,
      theme: "system",

      toggleSidebar: () => {
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
      },

      toggleChat: () => {
        set((state) => ({ isChatOpen: !state.isChatOpen }));
      },

      setSidebarOpen: (open: boolean) => {
        set({ isSidebarOpen: open });
      },

      setChatOpen: (open: boolean) => {
        set({ isChatOpen: open });
      },

      setTheme: (theme) => {
        set({ theme });
      },
    }),
    {
      name: "doxmind-layout",
    }
  )
);
