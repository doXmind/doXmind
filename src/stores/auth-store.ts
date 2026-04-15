/**
 * Auth store stub — local desktop edition has no auth.
 *
 * Returns a fixed local user so legacy components that read `user`
 * keep rendering. Initialize / login / logout are no-ops.
 */

import { create } from "zustand";

export interface LocalUser {
  id: string;
  email: string;
  username: string;
  is_verified: boolean;
  is_official: boolean;
  avatar_url: string | null;
  avatar_frame: string | null;
  bio: string | null;
  website: string | null;
  social_links: Record<string, string> | null;
  created_at: string;
}

const LOCAL_USER: LocalUser = {
  id: "local",
  email: "local@doxmind.local",
  username: "local",
  is_verified: true,
  is_official: false,
  avatar_url: null,
  avatar_frame: null,
  bio: null,
  website: null,
  social_links: null,
  created_at: new Date(0).toISOString(),
};

interface AuthState {
  user: LocalUser | null;
  isInitialized: boolean;
  isLoading: boolean;
  initialize: () => Promise<void>;
  login: (..._args: unknown[]) => Promise<void>;
  register: (..._args: unknown[]) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: LocalUser | null) => void;
  updateProfile: (updates: Partial<LocalUser>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: LOCAL_USER,
  isInitialized: true,
  isLoading: false,
  initialize: async () => {
    set({ user: LOCAL_USER, isInitialized: true });
  },
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refresh: async () => {},
  setUser: (user) => set({ user }),
  updateProfile: async (updates) => {
    const current = get().user ?? LOCAL_USER;
    set({ user: { ...current, ...updates } });
  },
}));
