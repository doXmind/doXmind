/**
 * API Settings Store — multi-provider edition.
 *
 * Lets the user configure one OpenAI / Anthropic / Google API key at a time
 * (one key unlocks one provider's models). Feature "roles" (chat, thinking,
 * fast, review, file_conversion) map to a model on the active provider.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";

const API_ROOT = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ProviderId = "openai" | "anthropic" | "google" | "claude_code";
export type FeatureRole = "chat" | "thinking" | "fast" | "review" | "file_conversion";
export type AuthMode = "api_key" | "oauth";

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
  prompt_price: number | null;
  completion_price: number | null;
  supports_reasoning: boolean;
  supports_vision: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  base_url: string;
  docs_url: string;
  api_key_hint: string;
  has_api_key: boolean;
  key_preview: string | null;
  models: ModelInfo[];
  role_defaults: Record<FeatureRole, string>;
  role_overrides: Record<FeatureRole, string | null>;
  has_reasoning: boolean;
  auth_mode: AuthMode;
  oauth_expires_at: number | null;
}

interface APISettingsState {
  activeProvider: ProviderId | null;
  providers: ProviderInfo[];
  roles: FeatureRole[];
  webSearchEnabled: boolean;
  codeExecutionEnabled: boolean;

  isLoading: boolean;
  isSynced: boolean;

  loadFromBackend: () => Promise<void>;
  saveProviderKey: (
    providerId: ProviderId,
    apiKey: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteProviderKey: (providerId: ProviderId) => Promise<void>;
  setActiveProvider: (providerId: ProviderId | null) => Promise<void>;
  setRoleModel: (providerId: ProviderId, role: FeatureRole, model: string | null) => Promise<void>;

  // OAuth sign-in (Claude Code subscription).
  startClaudeOAuthLogin: () => Promise<
    { success: true; sessionId: string; authUrl: string } | { success: false; error: string }
  >;
  pollClaudeOAuthStatus: (
    sessionId: string
  ) => Promise<{ status: "pending" | "success" | "error" | "unknown"; error?: string | null }>;
  claudeLogout: () => Promise<void>;

  // Back-compat for callers that only cared about "do we have any key"
  hasAPIKey: boolean;
  availableModels: ModelInfo[]; // active provider's models (empty if none)
  preferredModel: string; // the active provider's chat-role model
}

const EMPTY_STATE: Omit<
  APISettingsState,
  | "loadFromBackend"
  | "saveProviderKey"
  | "deleteProviderKey"
  | "setActiveProvider"
  | "setRoleModel"
  | "startClaudeOAuthLogin"
  | "pollClaudeOAuthStatus"
  | "claudeLogout"
> = {
  activeProvider: null,
  providers: [],
  roles: ["chat", "thinking", "fast", "review", "file_conversion"],
  webSearchEnabled: true,
  codeExecutionEnabled: false,
  isLoading: false,
  isSynced: false,
  hasAPIKey: false,
  availableModels: [],
  preferredModel: "",
};

function deriveHelpers(providers: ProviderInfo[], activeProvider: ProviderId | null) {
  const active = activeProvider ? (providers.find((p) => p.id === activeProvider) ?? null) : null;
  const hasAPIKey = providers.some((p) => p.has_api_key);
  const availableModels = active?.models ?? [];
  const chat = active?.role_overrides.chat || active?.role_defaults.chat || "";
  return { hasAPIKey, availableModels, preferredModel: chat };
}

export const useAPISettingsStore = create<APISettingsState>()(
  persist(
    (set, get) => ({
      ...EMPTY_STATE,

      loadFromBackend: async () => {
        set({ isLoading: true });
        try {
          const res = await fetch(`${API_ROOT}/api/user-settings/`, {
            headers: api.getAuthorizationHeaders(),
          });
          if (!res.ok) return;
          const data = await res.json();
          const providers = (data.providers || []) as ProviderInfo[];
          const activeProvider = (data.active_provider ?? null) as ProviderId | null;
          const helpers = deriveHelpers(providers, activeProvider);
          set({
            activeProvider,
            providers,
            roles: data.roles || EMPTY_STATE.roles,
            webSearchEnabled: !!data.web_search_enabled,
            codeExecutionEnabled: !!data.code_execution_enabled,
            isSynced: true,
            ...helpers,
          });
        } catch (error) {
          console.warn("[APISettingsStore] load failed:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      saveProviderKey: async (providerId, apiKey) => {
        try {
          const res = await fetch(`${API_ROOT}/api/user-settings/providers/${providerId}/key`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({ api_key: apiKey }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return {
              success: false,
              error: body.detail || "Failed to save API key",
            };
          }
          await get().loadFromBackend();
          return { success: true };
        } catch (error) {
          console.warn("[APISettingsStore] save key failed:", error);
          return { success: false, error: "Network error" };
        }
      },

      deleteProviderKey: async (providerId) => {
        try {
          const res = await fetch(`${API_ROOT}/api/user-settings/providers/${providerId}/key`, {
            method: "DELETE",
            headers: api.getAuthorizationHeaders(),
          });
          if (res.ok) await get().loadFromBackend();
        } catch (error) {
          console.warn("[APISettingsStore] delete key failed:", error);
        }
      },

      setActiveProvider: async (providerId) => {
        const previous = get().activeProvider;
        const providers = get().providers;
        set({
          activeProvider: providerId,
          ...deriveHelpers(providers, providerId),
        });
        try {
          const res = await fetch(`${API_ROOT}/api/user-settings/active-provider`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({ provider_id: providerId }),
          });
          if (!res.ok) {
            set({
              activeProvider: previous,
              ...deriveHelpers(providers, previous),
            });
          }
        } catch {
          set({
            activeProvider: previous,
            ...deriveHelpers(providers, previous),
          });
        }
      },

      startClaudeOAuthLogin: async () => {
        try {
          const res = await fetch(`${API_ROOT}/api/oauth/claude/login`, {
            method: "POST",
            headers: api.getAuthorizationHeaders(),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return { success: false, error: body.detail || "Failed to start Claude login" };
          }
          const data = await res.json();
          return { success: true, sessionId: data.session_id, authUrl: data.auth_url };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Network error",
          };
        }
      },

      pollClaudeOAuthStatus: async (sessionId) => {
        try {
          const res = await fetch(
            `${API_ROOT}/api/oauth/claude/status?session_id=${encodeURIComponent(sessionId)}`,
            { headers: api.getAuthorizationHeaders() }
          );
          if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
          const data = await res.json();
          if (data.status === "success") await get().loadFromBackend();
          return { status: data.status, error: data.error };
        } catch (error) {
          return {
            status: "error",
            error: error instanceof Error ? error.message : "Network error",
          };
        }
      },

      claudeLogout: async () => {
        try {
          const res = await fetch(`${API_ROOT}/api/oauth/claude/logout`, {
            method: "POST",
            headers: api.getAuthorizationHeaders(),
          });
          if (res.ok) await get().loadFromBackend();
        } catch (error) {
          console.warn("[APISettingsStore] claude logout failed:", error);
        }
      },

      setRoleModel: async (providerId, role, model) => {
        const providers = get().providers;
        const updated = providers.map((p) =>
          p.id === providerId
            ? {
                ...p,
                role_overrides: { ...p.role_overrides, [role]: model },
              }
            : p
        );
        set({
          providers: updated,
          ...deriveHelpers(updated, get().activeProvider),
        });
        try {
          await fetch(`${API_ROOT}/api/user-settings/role-assignment`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({
              provider_id: providerId,
              role,
              model,
            }),
          });
        } catch (error) {
          console.warn("[APISettingsStore] set role failed:", error);
        }
      },
    }),
    {
      name: "api-settings-v2",
      partialize: (state) => ({
        activeProvider: state.activeProvider,
      }),
    }
  )
);
