import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WebToolsSettings {
  webSearchEnabled: boolean;
}

interface SettingsState extends WebToolsSettings {
  // Actions
  setWebSearchEnabled: (enabled: boolean) => void;
  getWebToolsSettings: () => WebToolsSettings;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Web search is off by default (costs $0.01 per search)
      webSearchEnabled: false,

      setWebSearchEnabled: (enabled) => set({ webSearchEnabled: enabled }),

      getWebToolsSettings: () => ({
        webSearchEnabled: get().webSearchEnabled,
      }),
    }),
    {
      name: "doxmind-settings",
      partialize: (state) => ({
        webSearchEnabled: state.webSearchEnabled,
      }),
    }
  )
);
