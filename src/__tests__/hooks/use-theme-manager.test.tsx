import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThemeManager } from "@/hooks/use-theme-manager";
import { useLayoutStore } from "@/stores/layout-store";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "@/lib/themes/registry";

vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));

const THEME_PREFS_KEY = "doxmind-theme-prefs";

function storedPrefs() {
  return JSON.parse(localStorage.getItem(THEME_PREFS_KEY) ?? "{}");
}

describe("useThemeManager", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.setState({
      themeId: DEFAULT_DARK_THEME,
      preferredLightTheme: DEFAULT_LIGHT_THEME,
      preferredDarkTheme: DEFAULT_DARK_THEME,
      systemThemeEnabled: true,
    });
    // The appearance section's System row resolves against the OS, which reports dark here.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a light theme picked in system mode across a restart", () => {
    const { result } = renderHook(() => useThemeManager());

    // One click handler, two actions — exactly what the appearance section does.
    act(() => {
      result.current.selectTheme("solarized-light");
      result.current.setSystemMode(true);
    });

    // The persisted record is what the boot script reads before hydration.
    expect(storedPrefs().preferredLightTheme).toBe("solarized-light");
    expect(storedPrefs().systemThemeEnabled).toBe(true);
    // The OS is dark, so the active theme stays the dark preference.
    expect(storedPrefs().preferredDarkTheme).toBe(DEFAULT_DARK_THEME);
  });

  it("keeps a dark theme picked in system mode across a restart", () => {
    const { result } = renderHook(() => useThemeManager());

    act(() => {
      result.current.selectTheme("gruvbox-dark");
      result.current.setSystemMode(true);
    });

    expect(storedPrefs().preferredDarkTheme).toBe("gruvbox-dark");
    expect(storedPrefs().preferredLightTheme).toBe(DEFAULT_LIGHT_THEME);
    expect(storedPrefs().systemThemeEnabled).toBe(true);
  });
});
