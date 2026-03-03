"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useLayoutStore } from "@/stores/layout-store";
import { getTheme, getThemesByBaseMode, THEME_LIST } from "@/lib/themes/registry";
import { applyTheme } from "@/lib/themes/apply-theme";
import type { ThemeDefinition } from "@/lib/themes/types";

export function useThemeManager() {
  const { setTheme: setNextTheme } = useTheme();
  const {
    themeId,
    preferredLightTheme,
    preferredDarkTheme,
    systemThemeEnabled,
    setThemeId,
    setPreferredLightTheme,
    setPreferredDarkTheme,
    setSystemThemeEnabled,
  } = useLayoutStore();

  // Wait for Zustand persist to hydrate before applying theme
  const [hydrated, setHydrated] = useState(useLayoutStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) return;
    const unsub = useLayoutStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, [hydrated]);

  const currentTheme = getTheme(themeId);

  // Apply a theme to the DOM
  const applyThemeToDOM = useCallback(
    (theme: ThemeDefinition) => {
      setNextTheme(theme.baseMode);
      applyTheme(theme);
    },
    [setNextTheme]
  );

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

      applyThemeToDOM(theme);
    },
    [
      setThemeId,
      setPreferredLightTheme,
      setPreferredDarkTheme,
      setSystemThemeEnabled,
      applyThemeToDOM,
    ]
  );

  // Toggle between preferred light and dark themes
  const toggleBaseMode = useCallback(() => {
    if (currentTheme.baseMode === "dark") {
      const lightTheme = getTheme(preferredLightTheme);
      setThemeId(lightTheme.id);
      applyThemeToDOM(lightTheme);
    } else {
      const darkTheme = getTheme(preferredDarkTheme);
      setThemeId(darkTheme.id);
      applyThemeToDOM(darkTheme);
    }
  }, [currentTheme.baseMode, preferredLightTheme, preferredDarkTheme, setThemeId, applyThemeToDOM]);

  // Set system theme mode
  const setSystemMode = useCallback(
    (enabled: boolean) => {
      setSystemThemeEnabled(enabled);
      if (enabled && typeof window !== "undefined") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const newThemeId = isDark ? preferredDarkTheme : preferredLightTheme;
        const theme = getTheme(newThemeId);
        setThemeId(theme.id);
        applyThemeToDOM(theme);
      }
    },
    [setSystemThemeEnabled, preferredLightTheme, preferredDarkTheme, setThemeId, applyThemeToDOM]
  );

  // Apply theme on mount and when themeId changes — only after Zustand hydration
  // to prevent overwriting the blocking script's theme with default values
  useEffect(() => {
    if (!hydrated) return;
    applyThemeToDOM(currentTheme);
  }, [hydrated, themeId, applyThemeToDOM, currentTheme]);

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
      applyThemeToDOM(theme);
    };

    // Apply current system preference immediately
    const isDark = mq.matches;
    const resolvedId = isDark ? preferredDarkTheme : preferredLightTheme;
    if (resolvedId !== themeId) {
      const theme = getTheme(resolvedId);
      setThemeId(theme.id);
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
