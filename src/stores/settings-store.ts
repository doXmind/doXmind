import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WebToolsSettings {
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
}

interface SettingsState extends WebToolsSettings {
  // Actions
  setWebSearchEnabled: (enabled: boolean) => void;
  setThinkingEnabled: (enabled: boolean) => void;
  getWebToolsSettings: () => WebToolsSettings;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Web search is on by default
      webSearchEnabled: true,
      // Thinking mode off by default (uses minimax model when enabled)
      thinkingEnabled: false,

      setWebSearchEnabled: (enabled) => set({ webSearchEnabled: enabled }),
      setThinkingEnabled: (enabled) => set({ thinkingEnabled: enabled }),

      getWebToolsSettings: () => ({
        webSearchEnabled: get().webSearchEnabled,
        thinkingEnabled: get().thinkingEnabled,
      }),
    }),
    {
      name: "doxmind-settings",
      partialize: (state) => ({
        webSearchEnabled: state.webSearchEnabled,
        thinkingEnabled: state.thinkingEnabled,
      }),
    }
  )
);
