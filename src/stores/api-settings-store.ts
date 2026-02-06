/**
 * API Settings Store
 *
 * Manages user's Anthropic API key and model preferences.
 * Syncs with backend and persists locally.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";

interface APISettingsState {
  // Settings
  hasAPIKey: boolean;
  preferredModel: string;
  availableModels: string[];

  // Loading state
  isLoading: boolean;
  isSynced: boolean;

  // Actions
  loadFromBackend: () => Promise<void>;
  saveAPIKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  deleteAPIKey: () => Promise<void>;
  setPreferredModel: (model: string) => Promise<void>;
}

export const useAPISettingsStore = create<APISettingsState>()(
  persist(
    (set, get) => ({
      // Default settings
      hasAPIKey: false,
      preferredModel: "claude-sonnet-4-5-20250929",
      availableModels: [],

      isLoading: false,
      isSynced: false,

      loadFromBackend: async () => {
        set({ isLoading: true });
        try {
          const response = await fetch("/api/user-settings/", {
            headers: api.getAuthorizationHeaders(),
          });

          if (response.ok) {
            const data = await response.json();
            set({
              hasAPIKey: data.has_api_key,
              preferredModel: data.preferred_model,
              availableModels: data.available_models,
              isSynced: true,
            });
          }
        } catch (error) {
          console.warn("[APISettingsStore] Failed to load settings from backend:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      saveAPIKey: async (apiKey: string) => {
        try {
          const response = await fetch("/api/user-settings/api-key", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({ api_key: apiKey }),
          });

          if (response.ok) {
            set({ hasAPIKey: true });
            return { success: true };
          } else {
            const error = await response.json();
            return {
              success: false,
              error: error.detail || "Failed to save API key",
            };
          }
        } catch (error) {
          console.warn("[APISettingsStore] Failed to save API key:", error);
          return { success: false, error: "Network error" };
        }
      },

      deleteAPIKey: async () => {
        try {
          const response = await fetch("/api/user-settings/api-key", {
            method: "DELETE",
            headers: api.getAuthorizationHeaders(),
          });
          if (response.ok) {
            set({ hasAPIKey: false });
          } else {
            console.warn("[APISettingsStore] Failed to delete API key:", response.status);
          }
        } catch (error) {
          console.warn("[APISettingsStore] Failed to delete API key:", error);
        }
      },

      setPreferredModel: async (model: string) => {
        const previousModel = get().preferredModel;
        set({ preferredModel: model }); // Optimistic update
        try {
          const response = await fetch("/api/user-settings/model", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({ model }),
          });

          if (!response.ok) {
            set({ preferredModel: previousModel }); // Rollback on failure
            console.warn("[APISettingsStore] Failed to update model preference:", response.status);
          }
        } catch (error) {
          set({ preferredModel: previousModel }); // Rollback on error
          console.warn("[APISettingsStore] Failed to update model preference:", error);
        }
      },
    }),
    {
      name: "api-settings",
      partialize: (state) => ({
        // Only persist non-sensitive data
        preferredModel: state.preferredModel,
        // Don't persist hasAPIKey - always load from backend for security
      }),
    }
  )
);
