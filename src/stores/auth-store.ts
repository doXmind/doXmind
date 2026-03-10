import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, type User } from "@/lib/api";
import { authLogger } from "@/lib/logger";
import { eventBus } from "@/lib/events";

const log = authLogger;

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  showLogoutAnimation: boolean;

  // Actions
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<string>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  handleOAuthCallback: (token: string) => Promise<void>;
  setUser: (user: User) => void;
  updateProfile: (updates: {
    username?: string;
    avatar_url?: string;
    avatar_frame?: string;
    bio?: string;
    website?: string;
    social_links?: Record<string, string>;
  }) => Promise<void>;
  refreshUser: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  setShowLogoutAnimation: (show: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,
      isInitialized: false,
      showLogoutAnimation: false,

      initialize: async () => {
        if (get().isInitialized) return;

        set({ isLoading: true });
        try {
          // If access token expired, try refreshing using the HttpOnly refresh token cookie.
          // This handles the case where the user returns after idle (sleep, background tab).
          if (!api.isLoggedIn()) {
            try {
              await api.refreshToken();
            } catch {
              // Refresh failed — user will need to log in again
            }
          }

          // Check if we have a valid token (either existing or just refreshed)
          if (api.isLoggedIn()) {
            const status = await api.getAuthStatus();
            if (status.authenticated && status.user) {
              set({ user: status.user });
              // Initialize billing store after auth
              import("@/stores/billing-store").then(({ useBillingStore }) => {
                useBillingStore.getState().initialize();
              });
            } else if (status.debug_mode) {
              // In debug mode, we're "authenticated" without a real user
              set({ user: null });
            }
          }
        } catch (error) {
          log.error("Failed to initialize auth", error);
          // Clear invalid token
          api.logout();
        } finally {
          set({ isLoading: false, isInitialized: true });
        }
      },

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await api.login(email, password);
          set({ user: response.user || null });
          // Initialize billing after login
          import("@/stores/billing-store").then(({ useBillingStore }) => {
            useBillingStore.getState().initialize();
          });
          eventBus.emit("auth:login");
        } finally {
          set({ isLoading: false });
        }
      },

      register: async (email: string, username: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await api.register(email, username, password);
          return response.message;
        } finally {
          set({ isLoading: false });
        }
      },

      verifyEmail: async (email: string, code: string) => {
        set({ isLoading: true });
        try {
          const response = await api.verifyEmail(email, code);
          set({ user: response.user || null });
          eventBus.emit("auth:login");
        } finally {
          set({ isLoading: false });
        }
      },

      resendCode: async (email: string) => {
        await api.resendCode(email);
      },

      logout: async () => {
        set({ showLogoutAnimation: true });

        try {
          // Wait for backend to revoke refresh token before clearing local state
          await api.logout();

          // Wait minimum display time for animation (1200ms)
          await new Promise((resolve) => setTimeout(resolve, 1200));

          // Reset billing store
          import("@/stores/billing-store").then(({ useBillingStore }) => {
            useBillingStore.getState().reset();
          });

          set({ user: null, showLogoutAnimation: false });
          eventBus.emit("auth:logout");
        } catch (error) {
          // On error, hide animation and propagate error
          set({ showLogoutAnimation: false });
          throw error;
        }
      },

      loginWithGoogle: async () => {
        try {
          const { authorization_url } = await api.getGoogleAuthUrl();
          // Redirect to Google OAuth
          window.location.href = authorization_url;
        } catch (error) {
          log.error("Failed to get Google auth URL", error);
          throw error;
        }
      },

      handleOAuthCallback: async (token: string) => {
        set({ isLoading: true });
        try {
          // Set the token in the API client (this also sets cookie for middleware)
          api.setAccessToken(token);

          // Then fetch user info
          const user = await api.getCurrentUser();
          set({ user });
          // Initialize billing after OAuth
          import("@/stores/billing-store").then(({ useBillingStore }) => {
            useBillingStore.getState().initialize();
          });
          eventBus.emit("auth:login");
        } finally {
          set({ isLoading: false });
        }
      },

      setUser: (user) => {
        set({ user });
        eventBus.emit("profile:updated", { user });
      },

      updateProfile: async (updates) => {
        set({ isLoading: true });
        try {
          const user = await api.updateProfile(updates);
          set({ user });
          eventBus.emit("profile:updated", { user });
        } finally {
          set({ isLoading: false });
        }
      },

      refreshUser: async () => {
        try {
          const user = await api.getCurrentUser();
          set({ user });
        } catch (error) {
          log.error("Failed to refresh user", error);
        }
      },

      deleteAccount: async () => {
        set({ isLoading: true });
        try {
          await api.deleteAccount();
          set({ user: null });
        } finally {
          set({ isLoading: false });
        }
      },

      setShowLogoutAnimation: (show) => set({ showLogoutAnimation: show }),
    }),
    {
      name: "auth-store",
      partialize: (state) => ({
        // Only persist user data, not loading states
        user: state.user,
      }),
    }
  )
);
