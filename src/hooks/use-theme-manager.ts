"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useLayoutStore } from "@/stores/layout-store";
import { getTheme, getThemesByBaseMode, THEME_LIST } from "@/lib/themes/registry";
import { applyTheme } from "@/lib/themes/apply-theme";
import type { ThemeDefinition } from "@/lib/themes/types";

const THEME_PREFS_KEY = "doxmind-theme-prefs";
const LAYOUT_STORAGE_KEY = "doxmind-layout";

interface StoredThemePrefs {
  themeId: string;
  preferredLightTheme: string;
  preferredDarkTheme: string;
  systemThemeEnabled: boolean;
}

function readStoredThemePrefs(): StoredThemePrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(THEME_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredThemePrefs>;
    if (
      typeof parsed.themeId !== "string" ||
      typeof parsed.preferredLightTheme !== "string" ||
      typeof parsed.preferredDarkTheme !== "string" ||
      typeof parsed.systemThemeEnabled !== "boolean"
    ) {
      return null;
    }
    return parsed as StoredThemePrefs;
  } catch {
    return null;
  }
}

function readLegacyLayoutThemePrefs(): StoredThemePrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as
      | {
          state?: Partial<StoredThemePrefs>;
        }
      | Partial<StoredThemePrefs>;

    const state =
      parsed && typeof parsed === "object" && "state" in parsed
        ? (parsed.state ?? null)
        : (parsed as Partial<StoredThemePrefs>);

    if (!state) return null;

    if (
      typeof state.themeId !== "string" ||
      typeof state.preferredLightTheme !== "string" ||
      typeof state.preferredDarkTheme !== "string" ||
      typeof state.systemThemeEnabled !== "boolean"
    ) {
      return null;
    }

    return {
      themeId: state.themeId,
      preferredLightTheme: state.preferredLightTheme,
      preferredDarkTheme: state.preferredDarkTheme,
      systemThemeEnabled: state.systemThemeEnabled,
    };
  } catch {
    return null;
  }
}

function writeStoredThemePrefs(prefs: StoredThemePrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(THEME_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable; silently ignore
  }
}

export function useThemeManager() {
  const { setTheme: setNextTheme } = useTheme();
  const {
    themeId,
    preferredLightTheme,
    preferredDarkTheme,
    systemThemeEnabled,
    setThemeId,
    setSystemThemeEnabled,
    setPreferredLightTheme,
    setPreferredDarkTheme,
  } = useLayoutStore();

  // Wait for Zustand persist to hydrate before applying theme
  // Guard against SSR where .persist may be undefined
  const [hydrated, setHydrated] = useState(() => useLayoutStore.persist?.hasHydrated?.() ?? false);
  const [initialThemeReady, setInitialThemeReady] = useState(false);
  const fallbackSyncedRef = useRef(false);

  useEffect(() => {
    if (hydrated) return;

    if (!useLayoutStore.persist?.onFinishHydration) {
      setHydrated(true);
      return;
    }

    const unsub = useLayoutStore.persist?.onFinishHydration?.(() => setHydrated(true));
    // Handle race: hydration may complete between render and subscription.
    if (useLayoutStore.persist?.hasHydrated?.()) {
      setHydrated(true);
    }
    return unsub;
  }, [hydrated]);

  const currentTheme = getTheme(themeId);

  const persistThemePrefs = useCallback(
    (overrides: Partial<StoredThemePrefs>) => {
      writeStoredThemePrefs({
        themeId,
        preferredLightTheme,
        preferredDarkTheme,
        systemThemeEnabled,
        ...overrides,
      });
    },
    [themeId, preferredLightTheme, preferredDarkTheme, systemThemeEnabled]
  );

  // Apply a theme to the DOM
  const applyThemeToDOM = useCallback(
    (theme: ThemeDefinition) => {
      setNextTheme(theme.baseMode);
      applyTheme(theme);
    },
    [setNextTheme]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const domThemeId = document.documentElement.getAttribute("data-theme");
    if (!domThemeId) return;
    const theme = getTheme(domThemeId);
    applyThemeToDOM(theme);
  }, [applyThemeToDOM]);

  // Select a specific theme
  const selectTheme = useCallback(
    (id: string) => {
      const theme = getTheme(id);
      setThemeId(id);

      // Update the preferred theme for this base mode
      if (theme.baseMode === "light") {
        setPreferredLightTheme(id);
      } else {
        setPreferredDarkTheme(id);
      }

      // If user explicitly picks a theme, disable system mode
      setSystemThemeEnabled(false);
      persistThemePrefs({
        themeId: id,
        preferredLightTheme: theme.baseMode === "light" ? id : preferredLightTheme,
        preferredDarkTheme: theme.baseMode === "dark" ? id : preferredDarkTheme,
        systemThemeEnabled: false,
      });

      applyThemeToDOM(theme);
    },
    [
      setThemeId,
      setPreferredLightTheme,
      setPreferredDarkTheme,
      setSystemThemeEnabled,
      preferredLightTheme,
      preferredDarkTheme,
      persistThemePrefs,
      applyThemeToDOM,
    ]
  );

  // Toggle between preferred light and dark themes
  const toggleBaseMode = useCallback(() => {
    if (currentTheme.baseMode === "dark") {
      const lightTheme = getTheme(preferredLightTheme);
      setThemeId(lightTheme.id);
      setSystemThemeEnabled(false);
      persistThemePrefs({ themeId: lightTheme.id, systemThemeEnabled: false });
      applyThemeToDOM(lightTheme);
    } else {
      const darkTheme = getTheme(preferredDarkTheme);
      setThemeId(darkTheme.id);
      setSystemThemeEnabled(false);
      persistThemePrefs({ themeId: darkTheme.id, systemThemeEnabled: false });
      applyThemeToDOM(darkTheme);
    }
  }, [
    currentTheme.baseMode,
    preferredLightTheme,
    preferredDarkTheme,
    setThemeId,
    setSystemThemeEnabled,
    persistThemePrefs,
    applyThemeToDOM,
  ]);

  // Set system theme mode
  const setSystemMode = useCallback(
    (enabled: boolean) => {
      setSystemThemeEnabled(enabled);
      if (enabled && typeof window !== "undefined") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const newThemeId = isDark ? preferredDarkTheme : preferredLightTheme;
        const theme = getTheme(newThemeId);
        setThemeId(theme.id);
        persistThemePrefs({ themeId: theme.id, systemThemeEnabled: true });
        applyThemeToDOM(theme);
      } else {
        persistThemePrefs({ themeId, systemThemeEnabled: false });
      }
    },
    [
      themeId,
      setSystemThemeEnabled,
      preferredLightTheme,
      preferredDarkTheme,
      setThemeId,
      persistThemePrefs,
      applyThemeToDOM,
    ]
  );

  useEffect(() => {
    if (!hydrated || fallbackSyncedRef.current) return;
    fallbackSyncedRef.current = true;

    const stored = readStoredThemePrefs() ?? readLegacyLayoutThemePrefs();
    if (!stored) {
      setInitialThemeReady(true);
      return;
    }

    // Migrate legacy layout-persisted theme into dedicated prefs key.
    writeStoredThemePrefs(stored);

    const resolvedThemeId =
      stored.systemThemeEnabled && typeof window !== "undefined"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? stored.preferredDarkTheme
          : stored.preferredLightTheme
        : stored.themeId;

    if (themeId !== resolvedThemeId) {
      setThemeId(resolvedThemeId);
    }
    if (preferredLightTheme !== stored.preferredLightTheme) {
      setPreferredLightTheme(stored.preferredLightTheme);
    }
    if (preferredDarkTheme !== stored.preferredDarkTheme) {
      setPreferredDarkTheme(stored.preferredDarkTheme);
    }
    if (systemThemeEnabled !== stored.systemThemeEnabled) {
      setSystemThemeEnabled(stored.systemThemeEnabled);
    }

    setInitialThemeReady(true);
  }, [
    hydrated,
    themeId,
    preferredLightTheme,
    preferredDarkTheme,
    systemThemeEnabled,
    setThemeId,
    setPreferredLightTheme,
    setPreferredDarkTheme,
    setSystemThemeEnabled,
  ]);

  // Apply theme on mount and when themeId changes — only after Zustand hydration
  // to prevent overwriting the blocking script's theme with default values
  useEffect(() => {
    if (!hydrated || !initialThemeReady) return;
    applyThemeToDOM(currentTheme);
  }, [hydrated, initialThemeReady, themeId, applyThemeToDOM, currentTheme]);

  // Listen for system theme changes when systemThemeEnabled is true
  useEffect(() => {
    if (!hydrated || !systemThemeEnabled || typeof window === "undefined") {
      return;
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const handler = (e: MediaQueryListEvent) => {
      const newThemeId = e.matches ? preferredDarkTheme : preferredLightTheme;
      const theme = getTheme(newThemeId);
      setThemeId(theme.id);
      persistThemePrefs({ themeId: theme.id, systemThemeEnabled: true });
      applyThemeToDOM(theme);
    };

    // Apply current system preference immediately
    const isDark = mq.matches;
    const resolvedId = isDark ? preferredDarkTheme : preferredLightTheme;
    if (resolvedId !== themeId) {
      const theme = getTheme(resolvedId);
      setThemeId(theme.id);
      persistThemePrefs({ themeId: theme.id, systemThemeEnabled: true });
      applyThemeToDOM(theme);
    }

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [
    hydrated,
    systemThemeEnabled,
    preferredLightTheme,
    preferredDarkTheme,
    themeId,
    setThemeId,
    persistThemePrefs,
    applyThemeToDOM,
  ]);

  return {
    currentThemeId: themeId,
    currentTheme,
    selectTheme,
    toggleBaseMode,
    isSystemMode: systemThemeEnabled,
    setSystemMode,
    preferredLightTheme,
    preferredDarkTheme,
    lightThemes: getThemesByBaseMode("light"),
    darkThemes: getThemesByBaseMode("dark"),
    allThemes: THEME_LIST,
  };
}
