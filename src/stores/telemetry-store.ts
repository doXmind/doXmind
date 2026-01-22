/**
 * Telemetry Settings Store
 *
 * Manages user preferences for telemetry data collection.
 * Syncs with backend and persists locally.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { telemetry, type TelemetrySettings } from "@/lib/telemetry";
import { api } from "@/lib/api";

interface TelemetryState extends TelemetrySettings {
  // Loading state
  isLoading: boolean;
  isSynced: boolean;

  // Actions
  setProductImprovementEnabled: (enabled: boolean) => void;
  setCollectEditFeedback: (enabled: boolean) => void;
  setCollectChatFeedback: (enabled: boolean) => void;
  setCollectAutocompleteStats: (enabled: boolean) => void;
  setCollectUsageStats: (enabled: boolean) => void;
  updateAllSettings: (settings: Partial<TelemetrySettings>) => void;
  syncWithBackend: () => Promise<void>;
  loadFromBackend: () => Promise<void>;
}

export const useTelemetryStore = create<TelemetryState>()(
  persist(
    (set, get) => ({
      // Default settings (all enabled)
      productImprovementEnabled: true,
      collectEditFeedback: true,
      collectChatFeedback: true,
      collectAutocompleteStats: true,
      collectUsageStats: true,

      isLoading: false,
      isSynced: false,

      setProductImprovementEnabled: (enabled) => {
        set({ productImprovementEnabled: enabled });
        telemetry.updateSettings({ productImprovementEnabled: enabled });
        get().syncWithBackend();
      },

      setCollectEditFeedback: (enabled) => {
        set({ collectEditFeedback: enabled });
        telemetry.updateSettings({ collectEditFeedback: enabled });
        get().syncWithBackend();
      },

      setCollectChatFeedback: (enabled) => {
        set({ collectChatFeedback: enabled });
        telemetry.updateSettings({ collectChatFeedback: enabled });
        get().syncWithBackend();
      },

      setCollectAutocompleteStats: (enabled) => {
        set({ collectAutocompleteStats: enabled });
        telemetry.updateSettings({ collectAutocompleteStats: enabled });
        get().syncWithBackend();
      },

      setCollectUsageStats: (enabled) => {
        set({ collectUsageStats: enabled });
        telemetry.updateSettings({ collectUsageStats: enabled });
        get().syncWithBackend();
      },

      updateAllSettings: (settings) => {
        set(settings);
        telemetry.updateSettings(settings);
        get().syncWithBackend();
      },

      syncWithBackend: async () => {
        const state = get();
        try {
          await fetch("/api/telemetry/settings", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({
              product_improvement_enabled: state.productImprovementEnabled,
              collect_edit_feedback: state.collectEditFeedback,
              collect_chat_feedback: state.collectChatFeedback,
              collect_autocomplete_stats: state.collectAutocompleteStats,
              collect_usage_stats: state.collectUsageStats,
            }),
          });
          set({ isSynced: true });
        } catch (error) {
          console.warn("[TelemetryStore] Failed to sync settings:", error);
          set({ isSynced: false });
        }
      },

      loadFromBackend: async () => {
        set({ isLoading: true });
        try {
          const response = await fetch("/api/telemetry/settings", {
            headers: api.getAuthorizationHeaders(),
          });

          if (response.ok) {
            const data = await response.json();
            const settings: Partial<TelemetrySettings> = {
              productImprovementEnabled: data.product_improvement_enabled,
              collectEditFeedback: data.collect_edit_feedback,
              collectChatFeedback: data.collect_chat_feedback,
              collectAutocompleteStats: data.collect_autocomplete_stats,
              collectUsageStats: data.collect_usage_stats,
            };

            set({ ...settings, isSynced: true });
            telemetry.updateSettings(settings);
          }
        } catch (error) {
          console.warn(
            "[TelemetryStore] Failed to load settings from backend:",
            error
          );
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: "telemetry-settings",
      partialize: (state) => ({
        productImprovementEnabled: state.productImprovementEnabled,
        collectEditFeedback: state.collectEditFeedback,
        collectChatFeedback: state.collectChatFeedback,
        collectAutocompleteStats: state.collectAutocompleteStats,
        collectUsageStats: state.collectUsageStats,
      }),
    }
  )
);
